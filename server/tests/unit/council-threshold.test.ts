import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { can_cast_council_vote, snapshot_council_threshold, resolve_threshold_vote, COUNCIL_MEMBERSHIP_WAIT } from '../../council-voting';

function fixture() {
	const db = create_test_database();
	db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(1,'threshold','key','threshold','Voter','melvorD:Plant')");
	db.run("INSERT INTO guilds(id,name,icon_id,created_at) VALUES(2,'Threshold','melvorD:Farmlands',0)");
	db.run('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(1,2,1000)');
	db.run("INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,proposed_name,created_at,expires_at,rule_version) VALUES(1,2,'Threshold','appellation','name',1,'New',1000,999999999,2)");
	return db;
}

test('zero active members need one ballot and thresholds cannot drift', () => {
	const db = fixture();
	try {
		snapshot_council_threshold(1, 2, 10 * 86400000, db);
		expect(db.query('SELECT snapshot_active_count,voting_threshold FROM guild_petitions').get()).toEqual({ snapshot_active_count: 0, voting_threshold: 1 });
		expect(resolve_threshold_vote(1, 0, 0)).toBeNull();
		expect(resolve_threshold_vote(1, 1, 0)).toBe('granted');
		expect(resolve_threshold_vote(1, 0, 1)).toBe('denied');
		expect(() => db.run('UPDATE guild_petitions SET voting_threshold=2')).toThrow();
		expect(() => db.run('UPDATE guild_petitions SET snapshot_active_count=2')).toThrow();
	} finally { db.close(); }
});

test('membership eligibility switches exactly at 20 hours independently of the snapshot', () => {
	const db = fixture();
	try {
		const petition = { id: 1, guild_id: 2, voting_threshold: 1 };
		expect(can_cast_council_vote(petition, 1, 1000 + COUNCIL_MEMBERSHIP_WAIT - 1, db)).toBe(false);
		expect(can_cast_council_vote(petition, 1, 1000 + COUNCIL_MEMBERSHIP_WAIT, db)).toBe(true);
		expect(can_cast_council_vote({ ...petition, voting_threshold: null }, 1, 1000 + COUNCIL_MEMBERSHIP_WAIT, db)).toBe(false);
		db.run('INSERT INTO guild_petition_voters VALUES(1,1)');
		expect(can_cast_council_vote({ ...petition, voting_threshold: null }, 1, 1000, db)).toBe(true);
		db.run('DELETE FROM guild_memberships');
		expect(can_cast_council_vote(petition, 1, 1000 + COUNCIL_MEMBERSHIP_WAIT, db)).toBe(false);
	} finally { db.close(); }
});

test('equal requirements use ceiling and first to threshold resolves at 24-24', () => {
	for (const count of [0, 1, 2, 3, 50, 51]) {
		const threshold = Math.max(1, Math.ceil(count / 2));
		expect(resolve_threshold_vote(threshold, threshold - 1, threshold - 1)).toBeNull();
		expect(resolve_threshold_vote(threshold, threshold, threshold - 1)).toBe('granted');
		expect(resolve_threshold_vote(threshold, threshold - 1, threshold)).toBe('denied');
	}
});

test('migration backfills current membership tenures and preserves old petitions and ballots', async () => {
	const { Database } = await import('bun:sqlite');
	const { migrations } = await import('../../db/schema');
	const db = new Database(':memory:', { strict: true });
	db.run('PRAGMA foreign_keys=ON');
	try {
		for (const migration of migrations.filter(m => m.version < 165)) {
			if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.run(migration.sql);
			db.run('PRAGMA foreign_keys=ON');
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(1,'migration-threshold','key','migration-threshold','Voter','melvorD:Plant')");
		db.run("INSERT INTO guilds(id,name,icon_id,created_at) VALUES(2,'Migration threshold','melvorD:Farmlands',0)");
		db.run('INSERT INTO guild_memberships(id,client_id,guild_id) VALUES(1,1,2)');
		db.run("INSERT INTO guild_activity_events(guild_id,event_type,actor_client_id,actor_display_name,metadata,source_key,created_at) VALUES(2,'joined',1,'Voter','{}','membership:1:joined',1234)");
		db.run("INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,proposed_name,created_at,expires_at,rule_version) VALUES(1,2,'Migration threshold','appellation','name',1,'New',1000,999999999,2)");
		db.run('INSERT INTO guild_petition_voters VALUES(1,1)');
		db.run("INSERT INTO guild_petition_votes VALUES(1,1,'nay',2000)");
		db.run(migrations.find(m => m.version === 165)!.sql);
		expect(db.query('SELECT joined_at FROM guild_memberships').get()).toEqual({ joined_at: 1234 });
		expect(db.query('SELECT rule_version,snapshot_active_count,voting_threshold,expires_at FROM guild_petitions').get())
			.toEqual({ rule_version: 2, snapshot_active_count: null, voting_threshold: null, expires_at: 999999999 });
		expect(db.query('SELECT * FROM guild_petition_votes').get()).toEqual({ petition_id: 1, client_id: 1, choice: 'nay', submitted_at: 2000 });
		db.run('DELETE FROM guild_memberships');
		const before = Date.now();
		db.run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(1,2)');
		const joined_at = db.query<{ joined_at: number }, []>('SELECT joined_at FROM guild_memberships').get()!.joined_at;
		expect(joined_at).toBeGreaterThanOrEqual(before - 1);
		expect(joined_at).toBeLessThanOrEqual(Date.now());
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});

test('cast majority waits for active turnout, excludes inactive and young members, and denies ties', async () => {
	const { resolve_council_vote } = await import('../../council-voting');
	const db = fixture();
	const now = 10 * 86400000;
	try {
		db.run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=1', [now]);
		for (const id of [2, 3, 4]) {
			db.run('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id,last_multiplayer_active_at) VALUES(?,?,?,?,?,?,?)',
				[id, `v${id}`, 'key', `v${id}`, 'Voter', 'melvorD:Plant', id === 3 ? now - 4 * 86400000 - 1 : now]);
			db.run('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(?,2,?)', [id, id === 4 ? now : 1000]);
		}
		snapshot_council_threshold(1, 2, now, db);
		const petition = { id: 1, guild_id: 2, voting_threshold: 2, expires_at: now + 86400000 };
		expect(resolve_council_vote(petition, now, db)).toBeNull();
		db.run("INSERT INTO guild_petition_votes VALUES(1,1,'aye',?)", [now]);
		expect(resolve_council_vote(petition, now, db)).toBeNull();
		// A threshold's worth of Ayes still waits for the other active eligible member.
		db.run('INSERT INTO guild_petition_voters VALUES(1,3)');
		db.run("INSERT INTO guild_petition_votes VALUES(1,3,'aye',?)", [now]);
		expect(resolve_council_vote(petition, now, db)).toBeNull();
		expect(resolve_council_vote({ ...petition, expires_at: now }, now, db)).toBe('granted');
		db.run("INSERT INTO guild_petition_votes VALUES(1,2,'nay',?)", [now]);
		expect(resolve_council_vote(petition, now, db)).toBe('granted');
		db.run('DELETE FROM guild_petition_votes WHERE client_id=3');
		expect(resolve_council_vote(petition, now, db)).toBe('denied');
		// Later activity and tenure can hold an unfinished vote open; departure removes that hold.
		db.run('UPDATE guild_memberships SET joined_at=1000 WHERE client_id=4');
		expect(resolve_council_vote(petition, now, db)).toBeNull();
		db.run('DELETE FROM guild_memberships WHERE client_id=4');
		expect(resolve_council_vote(petition, now, db)).toBe('denied');
		db.run('DELETE FROM guild_petition_votes');
		expect(resolve_council_vote({ ...petition, expires_at: now }, now, db)).toBe('denied');
	} finally { db.close(); }
});

test('deadline migration converts unfinished petitions from last ballot and preserves finished results and Alliance votes', async () => {
	const { migrations } = await import('../../db/schema');
	const db = fixture();
	try {
		db.run('INSERT INTO guild_petition_voters VALUES(1,1)');
		db.run("INSERT INTO guild_petition_votes VALUES(1,1,'aye',2000)");
		db.run("INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,rule_version,lifecycle) VALUES(2,2,'Threshold','fellowship','admission',1,3000,999999999,1,'active'),(3,2,'Threshold','fellowship','old-admission',1,3000,999999999,2,'denied')");
		db.run(migrations.find(m => m.version === 169)!.sql);
		expect(db.query('SELECT id,expires_at,lifecycle FROM guild_petitions ORDER BY id').all()).toEqual([
			{ id: 1, expires_at: 2000 + 86400000, lifecycle: 'active' },
			{ id: 2, expires_at: 3000 + 86400000, lifecycle: 'active' },
			{ id: 3, expires_at: 999999999, lifecycle: 'denied' }
		]);
		expect(db.query('SELECT * FROM guild_petition_votes').all()).toEqual([{ petition_id: 1, client_id: 1, choice: 'aye', submitted_at: 2000 }]);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});
