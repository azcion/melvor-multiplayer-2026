import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('backfills Skills availability from skill rows and Activity availability from status snapshots', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations.filter(entry => entry.version < 53)) {
		database.transaction(() => database.run(migration.sql)).immediate();
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
	database.run(
		'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, `status_visible`) ' +
		"VALUES (1, 'skills-migration', 'migration-key-1', '111-111-111', 'Skills Migration', 'melvorD:Plant', 1), " +
		"(2, 'activity-migration', 'migration-key-2', '222-222-222', 'Activity Migration', 'melvorD:Plant', 1)"
	);
	database.run("INSERT INTO `status_snapshots` (`client_id`, `activity_type`) VALUES (1, 'idle'), (2, 'combat')");
	database.run(
		"INSERT INTO `status_snapshot_skills` (`client_id`, `skill_id`, `level`) VALUES (1, 'melvorD:Mining', 99)"
	);

	const migration = migrations.find(entry => entry.version === 53);
	database.transaction(() => database.run(migration?.sql ?? '')).immediate();

	expect(database.query<{ id: number; skills_available: number; activity_available: number }, []>(
		'SELECT `id`, `skills_available`, `activity_available` FROM `clients` ORDER BY `id`'
	).all()).toEqual([
		{ id: 1, skills_available: 1, activity_available: 1 },
		{ id: 2, skills_available: 0, activity_available: 1 }
	]);
	database.close();
});
