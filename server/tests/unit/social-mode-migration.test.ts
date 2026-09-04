import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema/migrations';

test('adds constrained Social mode state with a Full default', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 55)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run(
		'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
		"VALUES(1, 'social-mode-migration', 'migration-key', '111-111-111', 'Migration Client', 'melvorD:Plant')"
	);

	const migration = migrations.find(entry => entry.version === 55);
	database.transaction(() => database.run(migration?.sql ?? '')).immediate();
	expect(database.query<{ social_mode: string }, []>(
		'SELECT `social_mode` FROM `clients` WHERE `id` = 1'
	).get()).toEqual({ social_mode: 'full' });
	expect(() => database.run("UPDATE `clients` SET `social_mode` = 'invalid' WHERE `id` = 1")).toThrow();
	database.run("UPDATE `clients` SET `social_mode` = 'social' WHERE `id` = 1");
	expect(database.query<{ social_mode: string }, []>(
		'SELECT `social_mode` FROM `clients` WHERE `id` = 1'
	).get()).toEqual({ social_mode: 'social' });
	database.close();
});
