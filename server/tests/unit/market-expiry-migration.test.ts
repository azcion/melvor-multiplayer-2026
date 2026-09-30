import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

function apply_migrations(database: Database, predicate: (version: number) => boolean): void {
	for (const migration of migrations.filter(entry => predicate(entry.version))) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
}

function insert_market_listing(database: Database, id: number, published_at: number, updated_at: number | null): void {
	database.run(
		'INSERT INTO market_items ' +
		'(id, guild_id, client_id, direction, item_id, qty, available, price, published_at, updated_at) ' +
		"VALUES (?, 100, 1, 'sell', ?, 1, 1, 1, ?, ?)",
		[id, `melvorD:Migration_71_${id}`, published_at, updated_at]
	);
}

test('backfills historical Marketplace timestamps from the oldest still-valid listing', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply_migrations(database, version => version <= 70);
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
		"VALUES (1, 'migration-71-client', 'key', '111-111-111', 'Migration 71 Client', 'melvorD:Plant')"
	);
	database.run("INSERT INTO guilds (id, name, icon_id) VALUES (100, 'Migration 71 Guild', 'multiplayer')");
	const now = Date.now();
	const oldest_valid = now - 10 * 24 * 60 * 60 * 1000;
	insert_market_listing(database, 1, oldest_valid, null);
	insert_market_listing(database, 2, now - 2 * 24 * 60 * 60 * 1000, now - 5 * 24 * 60 * 60 * 1000);
	insert_market_listing(database, 3, 0, null);

	apply_migrations(database, version => version === 71);

	expect(database.query<{ published_at: number; updated_at: number | null }, []>(
		'SELECT published_at, updated_at FROM market_items WHERE id = 3'
	).get()).toEqual({ published_at: oldest_valid, updated_at: null });
	database.close();
});

test('backfills historical Marketplace timestamps to migration time when no listing is valid', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply_migrations(database, version => version <= 70);
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
		"VALUES (1, 'migration-71-fallback-client', 'key', '111-111-112', 'Migration 71 Fallback', 'melvorD:Plant')"
	);
	database.run("INSERT INTO guilds (id, name, icon_id) VALUES (100, 'Migration 71 Fallback Guild', 'multiplayer')");
	insert_market_listing(database, 1, 1, null);
	insert_market_listing(database, 2, 0, null);
	const before = Date.now();

	apply_migrations(database, version => version === 71);

	const published_at = database.query<{ published_at: number }, []>(
		'SELECT published_at FROM market_items WHERE id = 2'
	).get()?.published_at ?? 0;
	expect(published_at).toBeGreaterThanOrEqual(before - 1000);
	expect(published_at).toBeLessThanOrEqual(Date.now());
	database.close();
});
