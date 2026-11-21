import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import {
	cast_global_expedition_launch_ballot,
	get_global_expedition_guild_state,
	global_expedition_guild_participates,
	maintain_global_expedition_launch,
	trigger_global_expedition_launch,
	GLOBAL_EXPEDITION_LAUNCH_VOTE_MS,
	GLOBAL_EXPEDITION_SWITCH_DELAY_MS
} from '../../global-expedition-governance';

function client(database: ReturnType<typeof create_test_database>, id: number, last_active_at: number) {
	database.query(`INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id,last_multiplayer_active_at)
		VALUES(?,?,?,?,?,?,?)`).run(id, `global-expedition-${id}`, `key-${id}`, `friend-${id}`, `Voter ${id}`, 'melvorD:Plant', last_active_at);
}

function guild(database: ReturnType<typeof create_test_database>, id: number, now: number) {
	database.query('INSERT INTO guilds(id,name,icon_id,created_at) VALUES(?,?,?,?)')
		.run(id, `Guild ${id}`, 'melvorD:Farmlands', now);
}

test('launch ballots are one per active character and per-Guild frozen results use tie and zero-vote pass', () => {
	const database = create_test_database();
	const now = Date.now() - GLOBAL_EXPEDITION_SWITCH_DELAY_MS - 1000;
	try {
		const seeded_guild_ids = database.query<{ id: number }, []>('SELECT id FROM guilds ORDER BY id').all().map(row => row.id);
		for (const id of [1, 2, 3, 4]) client(database, id, now);
		for (const id of [10, 11, 12]) guild(database, id, now);
		database.query('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(?,?,?)').run(1, 10, now);
		database.query('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(?,?,?)').run(2, 10, now);
		database.query('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(?,?,?)').run(3, 11, now);
		expect(trigger_global_expedition_launch(now, database)).toBe(true);
		guild(database, 13, now + 1);
		expect(database.query('SELECT opted_in,source,effective_at FROM global_expedition_guild_participation WHERE guild_id=13').get())
			.toEqual({ opted_in: 1, source: 'launch_default', effective_at: now + GLOBAL_EXPEDITION_SWITCH_DELAY_MS });
		const state = get_global_expedition_guild_state(10, 1, now + 1, database);
		expect(state).toMatchObject({ scope: 'guild', enabled: false, starts_at: null, registration_pending: false,
			ballot: { aye: 0, nay: 0, choice: null, can_vote: true, result: null } });
		database.query(`INSERT INTO global_expedition_launch_votes(client_id,guild_id,choice,cast_at) VALUES(1,10,'aye',?)`).run(now + 1);
		database.query(`INSERT INTO global_expedition_launch_votes(client_id,guild_id,choice,cast_at) VALUES(2,10,'nay',?)`).run(now + 1);
		database.query(`INSERT INTO global_expedition_launch_votes(client_id,guild_id,choice,cast_at) VALUES(3,11,'nay',?)`).run(now + 1);
		const locked_at = now + GLOBAL_EXPEDITION_LAUNCH_VOTE_MS;
		expect(maintain_global_expedition_launch(locked_at, () => { throw new Error('cutover is not due'); }, database)).toBe(false);
		expect(database.query('SELECT guild_id,vote_result,aye_count,nay_count FROM global_expedition_launch_guilds WHERE guild_id IN (10,11,12) ORDER BY guild_id').all())
			.toEqual([
				{ guild_id: 10, vote_result: 'passed', aye_count: 1, nay_count: 1 },
				{ guild_id: 11, vote_result: 'failed', aye_count: 0, nay_count: 1 },
				{ guild_id: 12, vote_result: 'passed', aye_count: 0, nay_count: 0 }
			]);
		const closed = get_global_expedition_guild_state(10, 1, locked_at, database);
		expect(closed?.ballot).toMatchObject({ aye: 1, nay: 1, choice: 'aye', can_vote: false, result: 'aye' });
		const switched_at = now + GLOBAL_EXPEDITION_SWITCH_DELAY_MS;
		let callback_state: unknown;
		expect(maintain_global_expedition_launch(switched_at, (guild_ids, start) => {
			callback_state = { guild_ids, start, applied: database.query('SELECT applied_at FROM global_expedition_launch WHERE id=1').get() };
		}, database)).toBe(true);
		expect(callback_state).toEqual({ guild_ids: [...seeded_guild_ids, 10, 12, 13].sort((a, b) => a - b), start: switched_at, applied: { applied_at: null } });
		expect(global_expedition_guild_participates(10, database)).toBe(true);
		expect(global_expedition_guild_participates(11, database)).toBe(false);
		expect(global_expedition_guild_participates(13, database)).toBe(true);
		expect(get_global_expedition_guild_state(13, 4, switched_at, database)).toMatchObject({
			scope: 'global', enabled: true, ballot: null, starts_at: null, registration_pending: false
		});
	} finally { database.close(); }
});

test('eligible players can replace their one ballot in the same Guild until the lock', () => {
	const database = create_test_database();
	const now = Date.now();
	try {
		client(database, 1, now);
		client(database, 2, now - 4 * 86400000 - 1);
		guild(database, 10, now);
		guild(database, 11, now);
		database.query('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(1,10,?)').run(now);
		database.query('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(2,10,?)').run(now);
		trigger_global_expedition_launch(now, database);
		expect(cast_global_expedition_launch_ballot(1, 'aye', now + 1, database)).toEqual({ success: true });
		expect(cast_global_expedition_launch_ballot(1, 'nay', now + 2, database)).toEqual({ success: true });
		expect(cast_global_expedition_launch_ballot(2, 'aye', now + 1, database)).toBeNull();
		expect(get_global_expedition_guild_state(10, 1, now + 2, database)?.ballot).toMatchObject({
			aye: 0, nay: 1, eligible: 1, choice: 'nay', can_vote: true
		});
		database.query('UPDATE guild_memberships SET guild_id=11 WHERE client_id=1').run();
		expect(get_global_expedition_guild_state(11, 1, now + 3, database)?.ballot).toMatchObject({
			aye: 0, nay: 0, choice: null, can_vote: false
		});
		expect(cast_global_expedition_launch_ballot(1, 'aye', now + 3, database)).toBeNull();
		database.query('UPDATE guild_memberships SET guild_id=10 WHERE client_id=1').run();
		const lock = now + GLOBAL_EXPEDITION_LAUNCH_VOTE_MS;
		expect(cast_global_expedition_launch_ballot(1, 'aye', lock, database)).toBeNull();
		maintain_global_expedition_launch(lock, () => {}, database);
		expect(get_global_expedition_guild_state(10, 1, lock, database)?.ballot).toMatchObject({
			aye: 0, nay: 1, choice: 'nay', can_vote: false, result: 'nay'
		});
	} finally { database.close(); }
});

test('v229 preserves Council Petition history, discussion links, child ballots, and ID high-water', async () => {
	const { Database } = await import('bun:sqlite');
	const { migrations } = await import('../../db/schema');
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys=ON');
	try {
		for (const migration of migrations.filter(entry => entry.version < 229)) {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys=OFF');
			try {
				database.transaction(() => database.run(migration.sql)).immediate();
			} finally {
				if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys=ON');
			}
		}
		client(database, 1, 1000);
		guild(database, 10, 1000);
		database.query('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(1,10,1000)').run();
		database.query(`INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,
			proposed_name,created_at,expires_at,rule_version,show_creator) VALUES(5,10,'Guild 10','appellation','name',1,'Guild old',1000,999999,2,1)`).run();
		database.query('INSERT INTO guild_petition_voters(petition_id,client_id) VALUES(5,1)').run();
		database.query(`INSERT INTO guild_petition_votes(petition_id,client_id,choice,submitted_at) VALUES(5,1,'aye',2000)`).run();
		database.query("UPDATE sqlite_sequence SET seq=900 WHERE name='guild_petitions'").run();
		const migration = migrations.find(entry => entry.version === 229)!;
		database.run('PRAGMA foreign_keys=OFF');
		try {
			database.transaction(() => {
				database.run(migration.sql);
				expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
			}).immediate();
		} finally {
			database.run('PRAGMA foreign_keys=ON');
		}
		expect(database.query('SELECT id,type,show_creator,rule_version FROM guild_petitions WHERE id=5').get())
			.toEqual({ id: 5, type: 'appellation', show_creator: 1, rule_version: 2 });
		expect(database.query('SELECT petition_id,client_id,choice FROM guild_petition_votes').get())
			.toEqual({ petition_id: 5, client_id: 1, choice: 'aye' });
		expect(database.query('SELECT discussion_id FROM petition_discussion_links WHERE petition_id=5').get())
			.toEqual({ discussion_id: 5 });
		expect(database.query("SELECT seq FROM sqlite_sequence WHERE name='guild_petitions'").get())
			.toEqual({ seq: 900 });
		database.query(`INSERT INTO guild_petitions(guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,rule_version)
			VALUES(10,'Guild 10','global_expedition_opt_in','guild:global-expedition',1,3000,999999,2)`).run();
		expect(database.query("SELECT type FROM guild_petitions WHERE id=901").get()).toEqual({ type: 'global_expedition_opt_in' });
		expect(database.query('SELECT discussion_id FROM petition_discussion_links WHERE petition_id=901').get())
			.toEqual({ discussion_id: 901 });
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { database.close(); }
});
