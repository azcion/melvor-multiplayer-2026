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

test('rebuilds Guild Activity while preserving historical rows and foreign-key state', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 52))
		apply_migration(database, migration);
	database.run('PRAGMA foreign_keys = ON');

	database.run(
		'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
		"VALUES (1, 'activity-migration', 'activity-key', '111-111-111', 'Historical Actor', 'melvorD:Plant'), " +
		"(2, 'activity-migration-buyer', 'activity-key-buyer', '222-222-222', 'Historical Buyer', 'melvorD:Crab')"
	);
	const guild_id = database.query<{ id: number }, []>(
		"SELECT `id` FROM `guilds` WHERE `type` = 'free_fellowship'"
	).get()?.id as number;
	database.run('INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)', [1, guild_id]);
	database.run(
		'INSERT INTO `guild_activity_events` ' +
		'(`guild_id`, `event_type`, `actor_client_id`, `actor_display_name`, `metadata`, `source_key`, `created_at`) ' +
		"VALUES(?, 'joined', ?, ?, '{}', 'migration:joined', 10)",
		[guild_id, 1, 'Historical Actor']
	);

	const migration = migrations.find(entry => entry.version === 52);
	expect(migration).toBeDefined();
	apply_migration(database, migration!);

	expect(database.query(
		'SELECT `event_type`, `actor_client_id`, `actor_display_name`, `metadata`, `source_key`, `created_at`, ' +
		'`buyer_client_id`, `seller_client_id`, `item_id`, `quantity` FROM `guild_activity_events`'
	).all()).toEqual([{
		event_type: 'joined', actor_client_id: 1, actor_display_name: 'Historical Actor', metadata: '{}',
		source_key: 'migration:joined', created_at: 10,
		buyer_client_id: null, seller_client_id: null, item_id: null, quantity: null
	}]);
	expect(database.query('SELECT `client_id`, `guild_id` FROM `guild_memberships`').all())
		.toEqual([{ client_id: 1, guild_id }]);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	expect(database.query<{ name: string }, []>(
		"SELECT `name` FROM `sqlite_schema` WHERE `type` = 'index' AND `name` LIKE 'idx_guild_activity_private_%' ORDER BY `name`"
	).all()).toEqual([
		{ name: 'idx_guild_activity_private_buyer' },
		{ name: 'idx_guild_activity_private_seller' }
	]);
	database.close();
});
