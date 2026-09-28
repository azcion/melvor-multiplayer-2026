import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema/migrations';

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

test('removes the Raid contributor ceiling while preserving Raid children', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 80))
		apply_migration(database, migration);
	database.run('PRAGMA foreign_keys = ON');

	database.run(
		'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
		"VALUES (1, 'raid-migration', 'raid-key', '111-111-111', 'Raid Migrator', 'melvorD:Crab')"
	);
	const guild_id = database.query<{ id: number }, []>(
		"SELECT `id` FROM `guilds` WHERE `type` = 'free_fellowship'"
	).get()?.id as number;
	database.run('INSERT INTO `guild_memberships` (`id`, `client_id`, `guild_id`) VALUES(1, 1, ?)', [guild_id]);
	database.run(
		'INSERT INTO `guild_raids` (`id`, `guild_id`, `started_at`, `expires_at`, `active_member_count`, ' +
		'`required_contributors`, `max_health`, `remaining_health`) VALUES(1, ?, 10, 100, 13, 5, 9000, 7000)',
		[guild_id]
	);
	database.run(
		'INSERT INTO `guild_raid_roster` (`raid_id`, `membership_id`, `client_id`, `contribution`) ' +
		'VALUES(1, 1, 1, 2000)'
	);
	database.run(
		'INSERT INTO `guild_raid_assaults` (`id`, `raid_id`, `membership_id`, `client_id`, `tier`, `loaded_session_id`, ' +
		'`settlement_key`, `reserved_at`, `combat_deadline`, `settlement_deadline`) ' +
		"VALUES('assault', 1, 1, 1, 1, 'session', 'settlement', 20, 30, 40)"
	);

	const migration = migrations.find(entry => entry.version === 80);
	expect(migration).toBeDefined();
	apply_migration(database, migration!);

	expect(database.query('SELECT `id`, `required_contributors` FROM `guild_raids`').all())
		.toEqual([{ id: 1, required_contributors: 5 }]);
	expect(database.query('SELECT `raid_id`, `membership_id`, `contribution` FROM `guild_raid_roster`').all())
		.toEqual([{ raid_id: 1, membership_id: 1, contribution: 2000 }]);
	expect(database.query('SELECT `id`, `raid_id`, `membership_id` FROM `guild_raid_assaults`').all())
		.toEqual([{ id: 'assault', raid_id: 1, membership_id: 1 }]);
	database.run(
		'INSERT INTO `guild_raids` (`guild_id`, `started_at`, `expires_at`, `active_member_count`, ' +
		'`required_contributors`, `max_health`, `remaining_health`) VALUES(?, 110, 200, 20, 8, 9000, 9000)',
		[guild_id]
	);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});

test('backfills Raid defeat totals without granting tier unlocks', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('CREATE TABLE clients (id INTEGER PRIMARY KEY)');
	database.run('CREATE TABLE guild_raid_assaults (id TEXT PRIMARY KEY, client_id INTEGER, ' +
		'tier INTEGER, outcome TEXT)');
	database.run('INSERT INTO clients(id) VALUES(1), (2)');
	database.run("INSERT INTO guild_raid_assaults(id, client_id, tier, outcome) VALUES " +
		"('a', 1, 2, 'success'), ('b', 1, 2, 'success'), ('c', 1, 2, 'death'), " +
		"('d', 1, 3, 'success'), ('e', 2, 2, 'success')");
	const migration = migrations.find(entry => entry.version === 148);
	expect(migration).toBeDefined();
	apply_migration(database, migration!);
	expect(database.query('SELECT client_id, tier, defeats FROM raid_defeat_totals ORDER BY client_id, tier').all())
		.toEqual([
			{ client_id: 1, tier: 2, defeats: 2 },
			{ client_id: 1, tier: 3, defeats: 1 },
			{ client_id: 2, tier: 2, defeats: 1 }
		]);
	expect(database.query('SELECT DISTINCT fortified_resistance FROM guild_raid_assaults').all())
		.toEqual([{ fortified_resistance: 99 }]);
	const unlock_migration = migrations.find(entry => entry.version === 150);
	expect(unlock_migration).toBeDefined();
	apply_migration(database, unlock_migration!);
	expect(database.query('SELECT * FROM raid_tier_unlocks').all()).toEqual([]);
	expect(database.query('SELECT client_id, tier, defeats FROM raid_defeat_totals ORDER BY client_id, tier').all())
		.toEqual([
			{ client_id: 1, tier: 2, defeats: 2 },
			{ client_id: 1, tier: 3, defeats: 1 },
			{ client_id: 2, tier: 2, defeats: 1 }
		]);
	database.close();
});
