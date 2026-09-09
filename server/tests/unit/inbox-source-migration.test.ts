import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('migrates flat Inbox rows into the fallback source group', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 63)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
		"VALUES (1, 'inbox-source-client', 'key', '111-111-111', 'Inbox Client', 'melvorD:Plant')"
	);
	database.run(
		"INSERT INTO inbox_items (client_id, item_id, qty, created_at, updated_at) " +
		"VALUES (1, 'melvorD:Topaz', 10, 20, 30)"
	);

	const migration = migrations.find(entry => entry.version === 63);
	expect(migration).toBeDefined();
	database.transaction(() => database.run(migration?.sql ?? '')).immediate();

	expect(database.query(
		'SELECT client_id, source_type, source_name, item_id, qty, created_at, updated_at FROM inbox_items'
	).all()).toEqual([{
		client_id: 1,
		source_type: 'other',
		source_name: '',
		item_id: 'melvorD:Topaz',
		qty: 10,
		created_at: 20,
		updated_at: 30
	}]);
	database.run(
		"INSERT INTO inbox_items (client_id, source_type, source_name, item_id, qty) " +
		"VALUES (1, 'charitree', '', 'melvorD:Topaz', 2)"
	);
	expect(database.query('SELECT COUNT(*) AS count FROM inbox_items').get()).toEqual({ count: 2 });
	database.close();
});
