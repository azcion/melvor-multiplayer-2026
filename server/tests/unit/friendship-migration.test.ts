import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('canonicalizes reciprocal friendships while preserving one relationship', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 32)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	for (const id of [101, 102]) {
		database.run(
			'INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) ' +
			'VALUES (?, ?, ?, ?, ?, ?)',
			[id, `friend-${id}`, `key-${id}`, `111-111-${id}`, `Friend ${id}`, 'melvorD:Plant']
		);
	}
	database.run('INSERT INTO friends (client_id_a, client_id_b) VALUES (101, 102), (102, 101), (101, 101)');

	const migration = migrations.find(entry => entry.version === 32);
	expect(migration?.foreign_keys_disabled).not.toBe(true);
	database.transaction(() => {
		database.run(migration?.sql ?? '');
		database.run('PRAGMA user_version = 32');
	}).immediate();

	expect(database.query('SELECT client_id_a, client_id_b FROM friends').all()).toEqual([{
		client_id_a: 101,
		client_id_b: 102
	}]);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	expect(() => database.run('INSERT INTO friends (client_id_a, client_id_b) VALUES (102, 101)')).toThrow();
	expect(() => database.run('INSERT INTO friends (client_id_a, client_id_b) VALUES (101, 101)')).toThrow();
	database.close();
});
