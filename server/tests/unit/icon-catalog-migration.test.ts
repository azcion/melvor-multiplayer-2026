import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('upgrades a representative migration-40 database through all icon catalog migrations', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations.filter(entry => entry.version < 41)) {
		database.transaction(() => database.run(migration.sql)).immediate();
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
	database.run(
		'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
		"VALUES (1, 'migration-client', 'migration-key', '111-111-111', 'Migration Client', 'melvorD:Plant')"
	);
	database.run("INSERT INTO `status_snapshots` (`client_id`, `activity_type`) VALUES (1, 'idle')");
	database.run(
		"INSERT INTO `status_snapshot_skills` (`client_id`, `skill_id`, `level`) VALUES (1, 'mod-migration:Mining', 99)"
	);

	for (const migration of migrations.filter(entry => entry.version >= 41)) {
		database.transaction(() => database.run(migration.sql)).immediate();
		database.run(`PRAGMA user_version = ${migration.version}`);
	}

	expect(database.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(45);
	expect(database.query<{ id: number }, []>('SELECT `id` FROM `clients`').all()).toEqual([{ id: 1 }]);
	expect(database.query<{ client_id: number; skill_id: string; level: number }, []>(
		'SELECT `client_id`, `skill_id`, `level` FROM `status_snapshot_skills`'
	).all()).toEqual([{ client_id: 1, skill_id: 'mod-migration:Mining', level: 99 }]);
	expect(database.query<{ name: string }, []>(
		"SELECT `name` FROM `sqlite_schema` WHERE `type` = 'table' AND `name` LIKE 'icon_catalog_%' ORDER BY `name`"
	).all()).toEqual([
		{ name: 'icon_catalog_blobs' },
		{ name: 'icon_catalog_observations' }
	]);
	expect(database.query<{ value: string }, [string]>(
		'SELECT `value` FROM `service_settings` WHERE `key` = ?'
	).get('icon_collection_enabled')?.value).toBe('1');
	expect(database.query<{ key: string; value: string }, []>(
		"SELECT `key`, `value` FROM `service_settings` WHERE `key` LIKE 'icon_collection_max_%' ORDER BY `key`"
	).all()).toHaveLength(4);
	expect(database.query<{ name: string }, []>(
		"SELECT `name` FROM `sqlite_schema` WHERE `type` = 'table' AND `name` = 'guild_activity_events'"
	).get()?.name).toBe('guild_activity_events');
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});

test('defaults icon collection to enabled in a fully migrated database', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations) {
		database.transaction(() => database.run(migration.sql)).immediate();
		database.run(`PRAGMA user_version = ${migration.version}`);
	}

	expect(database.query<{ value: string }, []>(
		"SELECT `value` FROM `service_settings` WHERE `key` = 'icon_collection_enabled'"
	).get()?.value).toBe('1');
	expect(database.query<{ key: string; value: string }, []>(
		"SELECT `key`, `value` FROM `service_settings` WHERE `key` LIKE 'icon_collection_max_%' ORDER BY `key`"
	).all()).toEqual([
		{ key: 'icon_collection_max_catalog_bytes', value: '268435456' },
		{ key: 'icon_collection_max_icon_bytes', value: '1048576' },
		{ key: 'icon_collection_max_manifest_items', value: '64' },
		{ key: 'icon_collection_max_observations', value: '16384' }
	]);
	database.close();
});
