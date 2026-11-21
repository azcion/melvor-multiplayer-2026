import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema/migrations';
import { create_test_database } from '../support/database';
import { settle_expedition_work_for_launch_cutover } from '../../expedition-work';
import { claim_expedition_ending, get_expedition_launch_bonus_estimate } from '../../expedition-ending';
import { db } from '../../db';
import { register_for_expedition, maintain_expedition_launch, get_expedition_state, expedition_scope_for_guild } from '../../guild-expedition';
import { trigger_global_expedition_launch, cast_global_expedition_launch_ballot, get_global_expedition_guild_state,
	apply_global_expedition_participation_petition } from '../../global-expedition-governance';

test('rebuilds Global Expedition scope without losing active parent and child rows or tenure history', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	try {
		for (const migration of migrations.filter(entry => entry.version < 230)) {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
			try {
				database.transaction(() => {
					if (migration.preflight_sql) {
						const result = database.query<{ problems: number }, []>(migration.preflight_sql).get();
						expect(result?.problems).toBe(0);
					}
					database.run(migration.sql);
					database.run(`PRAGMA user_version = ${migration.version}`);
				}).immediate();
			} finally {
				if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = ON');
			}
		}

		database.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(1,'migration-global-run','key','migration-global-code','Runner','melvorD:Plant')");
		database.run("INSERT INTO guilds(id,name,icon_id) VALUES(7,'Migration Guild','melvorD:Plant')");
		const membership = database.query<{ id: number }, [number, number]>(
			'INSERT INTO guild_memberships(client_id,guild_id) VALUES(?,?) RETURNING id').get(1, 7)!;
		database.run(`INSERT INTO expeditions(id,guild_id,status,content_version,content_snapshot,registered_at,
			registration_ends_at,current_visit_id,last_qualifying_activity_at,ended_at,revision)
			VALUES(41,7,'active',1,'{}',100,200,44,150,NULL,3)`);
		database.run('INSERT INTO expedition_registrations(expedition_id,client_id,registered_at) VALUES(41,1,100)');
		database.run(`INSERT INTO expedition_personal_records(expedition_id,client_id,source_guild_id,source_guild_name,
			registered_at,status) VALUES(41,1,7,'Migration Guild',100,'active')`);
		database.run(`INSERT INTO expedition_visits(id,expedition_id,chamber_id,entered_at,participant_count,charted_on_arrival)
			VALUES(44,41,'entrance',110,1,0)`);
		database.run("INSERT INTO expedition_tasks(visit_id,task_id,target_ms,unlocked_at) VALUES(44,'work',10800000,110)");
		database.run(`INSERT INTO expedition_membership_tenures(id,expedition_id,source_guild_id,membership_id,client_id,started_at,ended_at)
			VALUES(43,41,7,?,1,100,200)`, [membership.id]);
		database.run(`INSERT INTO expedition_work_sessions(id,expedition_id,visit_id,client_id,tenure_id,task_id,started_at,
			start_statistics,start_activities) VALUES(45,41,44,1,43,'work',120,'{}','[]')`);

		const migration = migrations.find(entry => entry.version === 230)!;
		database.run('PRAGMA foreign_keys = OFF');
		try {
			database.transaction(() => database.run(migration.sql)).immediate();
		} finally {
			database.run('PRAGMA foreign_keys = ON');
		}

		expect(database.query('SELECT id,guild_id,status FROM expeditions WHERE id=41').get())
			.toEqual({ id: 41, guild_id: 7, status: 'active' });
		expect(database.query('SELECT expedition_id,client_id FROM expedition_registrations').all())
			.toEqual([{ expedition_id: 41, client_id: 1 }]);
		expect(database.query('SELECT id,expedition_id,chamber_id FROM expedition_visits WHERE id=44').get())
			.toEqual({ id: 44, expedition_id: 41, chamber_id: 'entrance' });
		expect(database.query('SELECT id,expedition_id,visit_id,tenure_id FROM expedition_work_sessions WHERE id=45').get())
			.toEqual({ id: 45, expedition_id: 41, visit_id: 44, tenure_id: 43 });
		database.run(`INSERT INTO expedition_membership_tenures(expedition_id,source_guild_id,membership_id,client_id,started_at)
			VALUES(41,7,?,1,210)`, [membership.id]);
		expect(database.query('SELECT id,ended_at FROM expedition_membership_tenures WHERE expedition_id=41 ORDER BY id').all())
			.toEqual([{ id: 43, ended_at: 200 }, { id: 44, ended_at: null }]);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {
		database.close();
	}
});

test('cutover settles a 12-hour open session beyond its 3-hour task allowance exactly once and includes it in the ending bonus', () => {
	const database = create_test_database();
	const hour = 3_600_000;
	const now = 20 * hour;
	try {
		database.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(1,'cutover-runner','key','cutover-code','Runner','melvorD:Plant')");
		database.run("INSERT INTO guilds(id,name,icon_id) VALUES(7,'Cutover Guild','melvorD:Plant')");
		const membership = database.query<{ id: number }, []>(
			'INSERT INTO guild_memberships(client_id,guild_id) VALUES(1,7) RETURNING id').get()!;
		database.run(`INSERT INTO expeditions(id,guild_id,status,content_version,content_snapshot,registered_at,
			registration_ends_at,current_visit_id,last_qualifying_activity_at,revision)
			VALUES(41,7,'active',1,'{}',0,10,44,?,1)`, [now]);
		database.run('INSERT INTO expedition_registrations(expedition_id,client_id,registered_at) VALUES(41,1,0)');
		database.run(`INSERT INTO expedition_personal_records(expedition_id,client_id,source_guild_id,source_guild_name,
			registered_at,status) VALUES(41,1,7,'Cutover Guild',0,'active')`);
		database.run(`INSERT INTO expedition_visits(id,expedition_id,chamber_id,entered_at,participant_count,charted_on_arrival)
			VALUES(44,41,'entrance',0,1,0)`);
		database.run("INSERT INTO expedition_tasks(visit_id,task_id,target_ms,unlocked_at) VALUES(44,'work',?,0)", [3 * hour]);
		database.run(`INSERT INTO expedition_membership_tenures(expedition_id,source_guild_id,membership_id,client_id,started_at)
			VALUES(41,7,?,1,0)`, [membership.id]);
		const tenure = database.query<{ id: number }, [number, number]>(
			'SELECT id FROM expedition_membership_tenures WHERE expedition_id=41 AND client_id=1').get(41, 1)!;
		database.run(`INSERT INTO expedition_work_sessions(id,expedition_id,visit_id,client_id,tenure_id,task_id,started_at,
			start_statistics,start_activities,reward_remaining_ms)
			VALUES(45,41,44,1,?,'work',?, '{}','[]',?)`, [tenure.id, now - 12 * hour, 3 * hour]);

		expect(get_expedition_launch_bonus_estimate(database, 1, 7)).toBe(0);
		expect(settle_expedition_work_for_launch_cutover(database, 41, now, now)).toBe(1);
		expect(get_expedition_launch_bonus_estimate(database, 1, 7)).toBe(2_400_000);
		expect(database.query('SELECT ended_at,credited_ms,guild_ms,end_reason FROM expedition_work_sessions WHERE id=45').get())
			.toEqual({ ended_at: now, credited_ms: 12 * hour, guild_ms: 0, end_reason: 'launch_cutover' });
		expect(database.query('SELECT points_micros FROM expedition_ep_balances WHERE client_id=1').get())
			.toEqual({ points_micros: 12_000_000 });
		expect(settle_expedition_work_for_launch_cutover(database, 41, now, now + 1)).toBe(0);
		database.run("UPDATE expeditions SET status='completed',ended_at=? WHERE id=41", [now]);
		database.run('UPDATE expedition_personal_records SET ending_bonus_eligible=1 WHERE expedition_id=41');
		expect(claim_expedition_ending(database, 1, 41, now + 2)).toEqual({ success: true, claimed_points_micros: 2_400_000 });
		expect(claim_expedition_ending(database, 1, 41, now + 3)).toEqual({ success: true, claimed_points_micros: 0 });
		expect(database.query('SELECT points_micros FROM expedition_ep_balances WHERE client_id=1').get())
			.toEqual({ points_micros: 14_400_000 });
	} finally {
		database.close();
	}
});

test('switches only Aye Guilds and lets a later Petition join and rejoin the same shared run', () => {
	const now = Date.now() - 10_000;
	const hour = 3_600_000;
	const launch = now - 48 * hour;
	db.run('SAVEPOINT global_expedition_flow');
	try {
		db.run("INSERT INTO guilds(id,name,icon_id) VALUES(8001,'Shared Aye','melvorD:Plant'),(8002,'Shared Nay','melvorD:Plant')");
		db.run(`INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id,last_multiplayer_active_at)
			VALUES(8001,'shared-aye','key','shared-aye','Aye','melvorD:Plant',?),
			(8002,'shared-nay','key','shared-nay','Nay','melvorD:Plant',?)`, [launch, launch]);
		db.run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(8001,8001),(8002,8002)');
		const aye_local = register_for_expedition(8001, 8001, 'aye-local', launch - hour, 6)!;
		const nay_local = register_for_expedition(8002, 8002, 'nay-local', launch - hour, 6)!;
		db.run(`INSERT INTO expedition_visits(expedition_id,chamber_id,entered_at,departed_at,participant_count,charted_on_arrival)
			VALUES(?,'entrance',?,?,1,0)`, [aye_local, launch - hour, launch - hour]);
		expect(trigger_global_expedition_launch(launch)).toBe(true);
		expect(cast_global_expedition_launch_ballot(8002, 'nay', launch)).toEqual({ success: true });
		db.run("INSERT INTO guilds(id,name,icon_id) VALUES(8003,'Auto Guild','melvorD:Plant')");
		expect(get_global_expedition_guild_state(8003, 8001, launch + 3 * hour)?.starts_at).toBe(now);
		maintain_expedition_launch(launch + 40 * hour);
		expect(get_global_expedition_guild_state(8001, 8001, launch + 40 * hour)?.ballot?.result).toBe('aye');
		expect(expedition_scope_for_guild(8001)).toBe(8001);
		maintain_expedition_launch(now);
		maintain_expedition_launch(now + 1);

		const global = get_expedition_state(expedition_scope_for_guild(8001), 8001, now).expedition!;
		expect(global.registration_ends_at).toBe(now + 20 * hour);
		expect(global.history).toEqual([]);
		expect(expedition_scope_for_guild(8003)).toBeNull();
		expect(get_expedition_state(expedition_scope_for_guild(8002), 8002, now).expedition?.id).toBe(nay_local);
		expect(db.query('SELECT status FROM expeditions WHERE id=?').get(aye_local)).toEqual({ status: 'completed' });
		expect(db.query("SELECT chamber_id FROM expedition_shared_knowledge WHERE exit_id=''").all())
			.toEqual([{ chamber_id: 'entrance' }]);

		expect(apply_global_expedition_participation_petition(
			{ id: 8100, guild_id: 8002, type: 'global_expedition_opt_in' }, now + 2
		)).toBe('opted_in');
		expect(register_for_expedition(8002, 8002, 'register-global', now + 2, 6)).toBe(global.id);
		expect(apply_global_expedition_participation_petition(
			{ id: 8101, guild_id: 8002, type: 'global_expedition_opt_out' }, now + 3
		)).toBe('opted_out');
		expect(get_expedition_state(expedition_scope_for_guild(8002), 8002, now + 3).expedition?.id).toBe(nay_local);
		expect(apply_global_expedition_participation_petition(
			{ id: 8102, guild_id: 8002, type: 'global_expedition_opt_in' }, now + 4
		)).toBe('opted_in');
		expect(register_for_expedition(8002, 8002, 'register-global-again', now + 4, 6)).toBe(global.id);
		expect(db.query('SELECT ended_at FROM expedition_membership_tenures WHERE expedition_id=? AND client_id=? ORDER BY id')
			.all(global.id, 8002)).toEqual([{ ended_at: now + 3 }, { ended_at: null }]);
		expect(db.query('SELECT COUNT(*) AS count FROM expeditions WHERE guild_id IS NULL').get()).toEqual({ count: 1 });
	} finally {
		db.run('ROLLBACK TO global_expedition_flow');
		db.run('RELEASE global_expedition_flow');
	}
});
