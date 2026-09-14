import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

function apply_migration(database: Database, migration: { version: number; sql: string; foreign_keys_disabled?: boolean }): void {
	if (migration.foreign_keys_disabled)
		database.run('PRAGMA foreign_keys = OFF');
	try {
		database.transaction(() => {
			database.run(migration.sql);
			if (migration.foreign_keys_disabled && database.query('PRAGMA foreign_key_check').all().length > 0)
				throw new Error(`Migration ${migration.version} introduced foreign-key violations`);
			database.run(`PRAGMA user_version = ${migration.version}`);
		}).immediate();
	} finally {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
}

test('adds a nullable Guild creation timestamp for historical backfill', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations.filter(entry => entry.version < 79))
		apply_migration(database, migration);

	const guild = database.query<{ id: number }, []>(
		"INSERT INTO `guilds` (`name`, `icon_id`, `type`, `charitree_enabled`) " +
		"VALUES ('Historical Guild', 'melvorD:Plant', 'private', 1) RETURNING `id`"
	).get() as { id: number };

	const migration = migrations.find(entry => entry.version === 79);
	expect(migration).toBeDefined();
	apply_migration(database, migration!);

	expect(database.query<{ created_at: number | null }, [number]>(
		'SELECT `created_at` FROM `guilds` WHERE `id` = ?',
	).get(guild.id)).toEqual({ created_at: null });
	database.run('INSERT INTO `guilds` (`name`, `icon_id`, `type`, `charitree_enabled`, `created_at`) VALUES (?, ?, ?, ?, ?)',
		['New Guild', 'melvorD:Plant', 'private', 1, 123]);
	expect(database.query<{ created_at: number }, [string]>(
		'SELECT `created_at` FROM `guilds` WHERE `name` = ?',
	).get('New Guild')).toEqual({ created_at: 123 });
	database.close();
});
