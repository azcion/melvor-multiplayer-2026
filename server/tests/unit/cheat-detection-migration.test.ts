import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';

test('adds an optional bounded cheat-detection timestamp without flagging existing clients', () => {
	const database = new Database(':memory:');
	for (const migration of migrations.filter(entry => entry.version < 87)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.query(
		"INSERT INTO clients (client_identifier, client_key, friend_code, display_name, icon_id) " +
		"VALUES ('cheat-migration', 'key', '111-111-111', 'Migration Client', 'melvorD:Plant')"
	).run();

	const migration = migrations.find(entry => entry.version === 87);
	expect(migration).toBeDefined();
	database.transaction(() => database.run(migration!.sql)).immediate();

	expect(database.query<{ cheats_detected_at: number | null }, []>(
		'SELECT cheats_detected_at FROM clients'
	).all()).toEqual([{ cheats_detected_at: null }]);
	expect(() => database.query('UPDATE clients SET cheats_detected_at = -1').run()).toThrow();
	database.close();
});

test('backfills only recognized mods from the retained snapshot without inventing earlier detections', () => {
	const database = new Database(':memory:');
	database.run('CREATE TABLE clients (id INTEGER PRIMARY KEY); CREATE TABLE client_runtime_snapshots (client_id INTEGER, active_mods TEXT, reported_at INTEGER);');
	database.run('INSERT INTO clients VALUES (1), (2)');
	database.query('INSERT INTO client_runtime_snapshots VALUES (?, ?, ?)').run(1,
		JSON.stringify(['dev.Console', 'Add Items', 'Private Unrelated Mod']), 1234);
	database.query('INSERT INTO client_runtime_snapshots VALUES (?, ?, ?)').run(2, JSON.stringify(['Private Unrelated Mod']), 5678);
	database.run(migrations.find(entry => entry.version === 163)!.sql);
	expect(database.query('SELECT * FROM client_cheat_mod_detections ORDER BY mod_name').all()).toEqual([
		{ client_id: 1, mod_name: 'Add Items', detected_at: 1234 },
		{ client_id: 1, mod_name: 'dev.Console', detected_at: 1234 }
	]);
	database.close();
});
