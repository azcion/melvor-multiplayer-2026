import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';

test('equipment slot migration preserves existing equipment and project references', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys=ON');
	try {
		for (const migration of migrations.filter(entry => entry.version <= 199)) {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys=OFF');
			try {
				database.transaction(() => {
					database.run(migration.sql);
					database.run(`PRAGMA user_version=${migration.version}`);
				}).immediate();
			} finally {
				if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys=ON');
			}
		}
		database.query('INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?)')
			.run('migration-client', 'key', 'friend-code', 'Migration Test', 'melvorD:Default');
			database.query('INSERT INTO combat_characters(client_id) VALUES(1)').run();
		database.query('INSERT INTO combat_equipment_slots(client_id,slot,tier,equipped_item) VALUES(?,?,?,?)')
			.run(1, 'Weapon', 1, 'melvorD:Bronze_Dagger');
		database.query('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at) VALUES(?,?,?,?)')
			.run(1, 'melvorD:Bronze_Dagger', '{"melvorD:Mining|melvorD:Copper_Ore":123}', 1);
		database.query('INSERT INTO combat_project_tracking(client_id,project_id,task_id,started_at,start_clock_offset_ms,epoch,counter_ms,statistics_json) VALUES(?,?,?,?,?,?,?,?)')
			.run(1, 1, 'melvorD:Mining|melvorD:Copper_Ore', 2, 0, '00000000-0000-0000-0000-000000000001', 123, '{}');
		database.query('INSERT INTO combat_project_reports(client_id,operation_id,request_hash,response) VALUES(?,?,?,?)')
			.run(1, 'operation', 'hash', '{"success":true}');

		const migration = migrations.find(entry => entry.version === 200)!;
		expect(migration.foreign_keys_disabled).toBe(true);
		database.run('PRAGMA foreign_keys=OFF');
		try {
			database.transaction(() => {
				database.run(migration.sql);
				const violations = database.query('PRAGMA foreign_key_check').all();
				expect(violations).toEqual([]);
				database.run('PRAGMA user_version=200');
			}).immediate();
		} finally {
			database.run('PRAGMA foreign_keys=ON');
		}

		expect(database.query('SELECT slot,tier,equipped_item FROM combat_equipment_slots').all()).toEqual([
			{ slot: 'Weapon', tier: 1, equipped_item: 'melvorD:Bronze_Dagger' }
		]);
		expect(database.query('SELECT item_id,progress_json FROM combat_equipment_projects').all()).toEqual([
			{ item_id: 'melvorD:Bronze_Dagger', progress_json: '{"melvorD:Mining|melvorD:Copper_Ore":123}' }
		]);
		expect(database.query('SELECT task_id,counter_ms FROM combat_project_tracking').all()).toEqual([
			{ task_id: 'melvorD:Mining|melvorD:Copper_Ore', counter_ms: 123 }
		]);
		expect(database.query('SELECT operation_id,response FROM combat_project_reports').all()).toEqual([
			{ operation_id: 'operation', response: '{"success":true}' }
		]);
		database.query('INSERT INTO combat_equipment_slots(client_id,slot,tier) VALUES(?,?,?)').run(1, 'Gloves', 6);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {
		database.close();
	}
});
