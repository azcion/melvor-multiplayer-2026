import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('backfills legacy status snapshots into serialized activity sets', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 40)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	for (const id of [1, 2, 3]) {
		database.run(
			'INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) ' +
			'VALUES (?, ?, ?, ?, ?, ?)',
			[id, `status-${id}`, `key-${id}`, `111-111-${id}`, `Status ${id}`, 'melvorD:Plant']
		);
	}
	database.run(
		'INSERT INTO status_snapshots ' +
		'(client_id, activity_type, activity_skill_id, activity_action_id, activity_area_id) VALUES ' +
		"(1, 'skill', 'melvorD:Woodcutting', 'melvorD:Oak', NULL), " +
		"(2, 'combat', NULL, NULL, 'melvorD:Volcanic_Cave'), " +
		"(3, 'idle', NULL, NULL, NULL)"
	);

	const migration = migrations.find(entry => entry.version === 40);
	database.transaction(() => {
		database.run(migration?.sql ?? '');
		database.run('PRAGMA user_version = 40');
	}).immediate();

	expect(database.query('SELECT client_id, activities FROM status_snapshots ORDER BY client_id').all()).toEqual([
		{ client_id: 1, activities: '[{"type":"skill","skill_id":"melvorD:Woodcutting","action_id":"melvorD:Oak"}]' },
		{ client_id: 2, activities: '[{"type":"combat","area_id":"melvorD:Volcanic_Cave"}]' },
		{ client_id: 3, activities: '[]' }
	]);
	database.close();
});
