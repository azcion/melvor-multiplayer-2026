import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { claim_expedition_ending, get_expedition_return_summary, unclaimed_expedition_endings } from '../../expedition-ending';

// Independent database transactions cover retries, owner isolation, late earnings and durable claims.
test('only opted-in successful runs grant a claimed 20% bonus, with exact incremental late credit', () => {
	const db = create_test_database();
	try {
		db.run('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(1,?,?,?,?,?)',
			['ending-one','key','ending-code','Returner','melvorD:Plant']);
		for (const [id, status, eligible] of [[1,'completed',1],[2,'completed',0],[3,'inactive',1],[4,'dissolved',1]] as const) {
			db.run('INSERT INTO expedition_personal_records(expedition_id,client_id,source_guild_id,source_guild_name,registered_at,status,ended_at,ending_bonus_eligible) VALUES(?,1,1,?,100,?,200,?)', [id,'Guild',status,eligible]);
			db.run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(1,'work',?,123456789,200,?)",[id,id]);
		}
		expect(claim_expedition_ending(db,2,1,300)).toBeNull();
		for (const id of [2,3,4]) expect(claim_expedition_ending(db,1,id,300)).toBeNull();
		expect(get_expedition_return_summary(db,1,1)?.bonus_available_micros).toBe(24691357);
		expect(unclaimed_expedition_endings(db,1)).toEqual([{expedition_id:1,bonus_available_micros:24691357}]);
		expect(claim_expedition_ending(db,1,1,300)?.claimed_points_micros).toBe(24691357);
		expect(claim_expedition_ending(db,1,1,301)?.claimed_points_micros).toBe(0);
		expect(unclaimed_expedition_endings(db,1)).toEqual([]);
		db.run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(1,'supply',5,11,400,1)");
		expect(claim_expedition_ending(db,1,1,401)?.claimed_points_micros).toBe(3);
		expect(claim_expedition_ending(db,1,1,402)?.claimed_points_micros).toBe(0);
		expect(db.query('SELECT points_micros FROM expedition_ep_balances WHERE client_id=1').get()).toEqual({points_micros:24691360});
		expect(get_expedition_return_summary(db,1,1)).toMatchObject({earned_points_micros:123456800,bonus_claimed_micros:24691360,bonus_available_micros:0,contributed_ms:0,chamber_count:0});
		db.run('UPDATE expedition_ep_balances SET points_micros=? WHERE client_id=1',[Number.MAX_SAFE_INTEGER]);
		db.run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(1,'work',9,100,500,1)");
		expect(claim_expedition_ending(db,1,1,501)).toBeNull();
		expect(get_expedition_return_summary(db,1,1)?.bonus_available_micros).toBe(20);
	} finally { db.close(); }
});

test('ending migration preserves historical earnings, indexes, and deleted ledger ID high-water', async () => {
	const { Database } = await import('bun:sqlite');
	const { migrations } = await import('../../db/schema');
	const db = new Database(':memory:');
	try {
		for (const migration of migrations.filter(entry => entry.version < 213)) db.run(migration.sql);
		db.run('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(1,?,?,?,?,?)', ['migration-return','key','migration-code','Returner','melvorD:Plant']);
		db.run("INSERT INTO expedition_ep_ledger(id,client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(5,1,'work',1,100,200,10),(100,1,'supply',2,1,200,10)");
		db.run('DELETE FROM expedition_ep_ledger WHERE id=100');
		db.run('INSERT INTO expedition_personal_records(expedition_id,client_id,source_guild_id,source_guild_name,registered_at,status,ended_at) VALUES(10,1,1,?,100,?,200)', ['Guild','completed']);
		db.transaction(() => db.run(migrations.find(entry => entry.version === 213)!.sql))();
		expect(db.query('SELECT id,points_micros FROM expedition_ep_ledger').all()).toEqual([{id:5,points_micros:100}]);
		expect(db.query('SELECT ending_bonus_eligible FROM expedition_personal_records').get()).toEqual({ending_bonus_eligible:0});
		const insert = db.run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(1,'ending',1,20,300,10)");
		expect(Number(insert.lastInsertRowid)).toBe(101);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
		expect(db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='expedition_ep_ledger'").all()).toHaveLength(3);
	} finally { db.close(); }
});
