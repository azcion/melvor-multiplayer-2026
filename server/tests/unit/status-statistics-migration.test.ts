import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('adds nullable status statistics without losing existing snapshots', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 51)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
		"VALUES (1, 'statistics-migration', 'migration-key', '111-111-111', 'Statistics Migration', 'melvorD:Plant')"
	);
	database.run("INSERT INTO `status_snapshots` (`client_id`, `activity_type`) VALUES (1, 'idle')");

	const migration = migrations.find(entry => entry.version === 51);
	database.transaction(() => {
		database.run(migration?.sql ?? '');
		database.run('PRAGMA user_version = 51');
	}).immediate();

	expect(database.query(
		'SELECT `client_id`, `account_creation_date`, `total_skill_level` FROM `status_snapshots`'
	).all()).toEqual([{ client_id: 1, account_creation_date: null, total_skill_level: null }]);
	database.query(
		'UPDATE `status_snapshots` SET `account_creation_date` = ?, `total_skill_level` = ? WHERE `client_id` = ?',
	).run(1_700_000_000_000, 12_345, 1);
	expect(database.query(
		'SELECT `account_creation_date`, `total_skill_level` FROM `status_snapshots` WHERE `client_id` = 1'
	).get()).toEqual({ account_creation_date: 1_700_000_000_000, total_skill_level: 12_345 });
	database.close();
});
