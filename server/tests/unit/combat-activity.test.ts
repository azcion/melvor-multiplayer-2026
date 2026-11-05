import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';
import { dungeon_activity, parse_dungeon_activity_cursor, update_combat } from '../../combat-inventory';
import { create_test_database } from '../support/database';

test('dungeon activity includes repeated results across clients, excludes tests and old rulesets, and orders by completion', () => {
	const db = create_test_database();
	try {
		for (const id of [101,102,103]) db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)')
			.run(id,`activity-${id}`,'key',`activity-${id}`,`Player ${id}`,'melvorD:Shrimp');
		const insert = db.query(`INSERT INTO combat_encounters(id,client_id,controller,food_id,used,status,registration_json,created_at,raid_endpoint,raid_ruleset,completed_at)
			VALUES(?,?,'owner','',0,?,'{}',?,1,?,?)`);
		insert.run('older',101,'victory',100,'golbin-2',null);
		insert.run('newer',101,'defeat',90,'golbin-2',200);
		insert.run('other',102,'victory',150,'golbin-2',null);
		insert.run('debug',103,'victory',300,'golbin-2',null);
		insert.run('legacy',102,'victory',400,'golbin-1',null);
		insert.run('fled',102,'fled',500,'golbin-2',null);
		db.run('INSERT INTO combat_activity_exclusions(client_id) VALUES(103)');
		expect(dungeon_activity(db,'golbin-2').activity).toEqual([
			{client_id:101,display_name:'Player 101',icon_id:'melvorD:Shrimp',status:'defeat',tier:1,occurred_at:200},
			{client_id:102,display_name:'Player 102',icon_id:'melvorD:Shrimp',status:'victory',tier:1,occurred_at:150},
			{client_id:101,display_name:'Player 101',icon_id:'melvorD:Shrimp',status:'victory',tier:1,occurred_at:100}
		]);
		insert.run('settled',102,'active',600,'golbin-2',null);
		expect(update_combat(db,'owner','settled',0,'defeat',0,700)).toBe(true);
		expect(update_combat(db,'owner','settled',0,'defeat',0,800)).toBe(true);
		expect(dungeon_activity(db,'golbin-2').activity[0].occurred_at).toBe(700);
	} finally { db.close(); }
});

test('migration retains historical test identity exclusion after fighter reset', () => {
	const db = new Database(':memory:', {strict:true});
	try {
		for (const migration of migrations.filter(row => row.version < 219)) {
			if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.run(migration.sql);
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'activity-test','key','activity-test','Tester','melvorD:Shrimp')");
		db.run("INSERT INTO audit_events(occurred_at,event_type,actor_kind,actor_client_id,actor_display_name,source_key) VALUES(1,'combat-dungeon-test','client',101,'Tester','activity-test')");
		db.run(migrations.find(row => row.version === 219)!.sql);
		expect(db.query('SELECT client_id FROM combat_activity_exclusions').all()).toEqual([{client_id:101}]);
	} finally { db.close(); }
});

test('Dungeon activity pages tied timestamps without repeats after a new result arrives', () => {
	const db = create_test_database();
	try {
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'activity-pages','key','activity-pages','Player','melvorD:Shrimp')");
		const insert = db.query(`INSERT INTO combat_encounters(id,client_id,controller,food_id,used,status,registration_json,created_at,raid_endpoint,raid_ruleset)
			VALUES(?,101,'owner','',0,?,'{}',100,1,'golbin-2')`);
		for (let index = 0; index < 22; index++) insert.run(`attempt-${String(index).padStart(2,'0')}`, index < 2 ? 'defeat' : 'victory');
		const first = dungeon_activity(db,'golbin-2');
		expect(first.activity).toHaveLength(20);
		expect(first.activity.every(entry => entry.status === 'victory')).toBe(true);
		insert.run('newer','victory');
		const second = dungeon_activity(db,'golbin-2',parse_dungeon_activity_cursor(first.activity_next_cursor));
		expect(second.activity.map(entry => entry.status)).toEqual(['defeat','defeat']);
		expect(second.activity_next_cursor).toBeNull();
	} finally { db.close(); }
});
