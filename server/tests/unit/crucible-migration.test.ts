import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';
import { migrate_charitree_to_crucible } from '../../crucible-migration';
import { apply_crucible_petition, crucible_migration_complete } from '../../crucible-council';

function apply(database: Database, until: number, after = 0): void {
	for (const migration of migrations.filter(entry => entry.version > after && entry.version <= until)) {
		if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
		try {
			database.transaction(() => {
				database.run(migration.sql);
				if (migration.foreign_keys_disabled)
					expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
			}).immediate();
		} finally {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = ON');
		}
	}
}

test('pet vocabulary rebuild preserves old ownership and the snapshot copies without changing Charitree', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply(database, 136);
	const now = 1_800_000_000_000;
	database.run("INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES (1, 'Cloud', 'playfab', 1)");
	database.run("INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id) " +
		"VALUES (100, 'crucible-migration-client', 'key', '111-222-333', 'Client', 'melvorD:Plant', 1)");
	database.run("INSERT INTO multiplayer_pet_ownership (client_id, pet_id, created_at, updated_at) " +
		"VALUES (100, 'Multiplayer_Pet_Charity', 1, 1)");
	apply(database, 143, 136);
	apply(database, 162, 143);
	database.query('INSERT INTO crucible_guilds (guild_id, processed_minute, created_at) VALUES (1, ?, ?)')
		.run(Math.floor(now / 60_000), now);
	expect(crucible_migration_complete(database)).toBe(false);
	expect(() => apply_crucible_petition({ id: 1, guild_id: 1,
		type: 'crucible_sealing' } as Parameters<typeof apply_crucible_petition>[0], now, database))
		.toThrow('Crucible snapshot migration is incomplete');
	expect(database.query('SELECT is_open FROM crucible_guilds WHERE guild_id = 1').get())
		.toEqual({ is_open: 1 });
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	expect(database.query("SELECT pet_id FROM multiplayer_pet_ownership WHERE client_id = 100").all())
		.toEqual([{ pet_id: 'Multiplayer_Pet_Charity' }]);

	database.query('INSERT INTO charity_items (guild_id, item_id, qty, expires_at, donated_at, ' +
		'value_currency_id, value_per_item) VALUES (1, ?, 3, ?, ?, ?, 1)')
		.run('melvorD:SlayerCoins', now + 86 * 60 * 60_000, now - 10 * 60 * 60_000, 'melvorD:GP');
	database.query('INSERT INTO charity_contribution_lots ' +
		'(guild_id, item_id, client_id, qty, contributed_at) VALUES (1, ?, 100, 2, ?)')
		.run('melvorD:SlayerCoins', now - 1_000);
	database.query('INSERT INTO charity_currency_locks ' +
		'(guild_id, owner_key, currency_id, locked_until) VALUES (1, ?, ?, ?)')
		.run('account:1', 'melvorD:GP', now + 10_000);
	database.query('INSERT INTO charity_wishes ' +
		'(guild_id, owner_client_id, melvor_account_id, item_id, qty, required_gp, progress_gp, ' +
		'created_at, matures_at) VALUES (1, 100, 1, ?, 1, 1000, 200, ?, ?)')
		.run('melvorD:Coal_Ore', now - 10 * 60 * 60_000, now + 10 * 60 * 60_000);

	const report = migrate_charitree_to_crucible(now, database);
	expect(database.query("SELECT value FROM service_settings WHERE key = 'minimum_supported_mod_version'").get())
		.toEqual({ value: '1.5.16' });
	expect(report.source).toEqual(report.destination);
	expect(report.source).toMatchObject({ offerings: 1, offering_qty: 3, lots: 1, lot_qty: 2,
		wishes: 1, wish_progress_gp: 200, currency_locks: 1, pets: 1 });
	expect(database.query('SELECT qty, value_currency_id, value_per_item FROM charity_items').get())
		.toEqual({ qty: 3, value_currency_id: 'melvorD:GP', value_per_item: 1 });
	expect(database.query('SELECT qty, value_currency_id, value_per_item, meld_points FROM crucible_offerings').get())
		.toEqual({ qty: 3, value_currency_id: 'melvorD:SlayerCoins', value_per_item: 1, meld_points: 5040 });
	expect(database.query('SELECT formation_points, progress_gp FROM crucible_wishes').get())
		.toEqual({ formation_points: 5040, progress_gp: 200 });
	expect(database.query("SELECT position_kind, position_key, quantity FROM audit_value_lot_positions " +
		"WHERE position_kind = 'crucible'").all()).toEqual([
		{ position_kind: 'crucible', position_key: '1', quantity: 3 }
	]);
	expect(database.query("SELECT details_json FROM audit_events WHERE event_type = 'crucible.snapshot'").get())
		.toEqual({ details_json: '{"legacy_retained":true,"offerings":1}' });
	expect(migrate_charitree_to_crucible(now + 60_000, database)).toEqual(report);
	expect(() => migrate_charitree_to_crucible(now + 60_000, database, true))
		.toThrow('Existing Crucible test snapshot cannot be used for live cutover');
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});

test('live cutover requires maintenance, reconciles the snapshot, and switches the gate atomically', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply(database, 162);
	const now = 1_800_000_000_000;
	database.query('INSERT INTO charity_items (guild_id, item_id, qty, expires_at, donated_at) ' +
		'VALUES (1, ?, 2, ?, ?)').run('melvorD:Coal_Ore', now + 60_000, now - 1_000);
	expect(() => migrate_charitree_to_crucible(now, database, true))
		.toThrow('Crucible cutover requires maintenance mode');
	expect(database.query('SELECT COUNT(*) AS count FROM crucible_migration').get()).toEqual({ count: 0 });
	database.query("UPDATE service_settings SET value = '1' WHERE key = 'maintenance'").run();
	const report = migrate_charitree_to_crucible(now, database, true);
	expect(report.source).toEqual(report.destination);
	expect(report.source.offering_qty).toBe(2);
	expect(database.query("SELECT value FROM service_settings WHERE key = 'crucible_cutover'").get())
		.toEqual({ value: '1' });
	expect(database.query('SELECT qty FROM charity_items WHERE guild_id = 1').get()).toEqual({ qty: 2 });
	expect(migrate_charitree_to_crucible(now + 1, database, true)).toEqual(report);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});
