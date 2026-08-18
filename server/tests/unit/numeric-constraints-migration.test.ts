import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('tightens value-bearing quantity constraints while preserving positive rows', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 31)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
		"VALUES (1, 'numeric-client', 'key', '111-111-111', 'Numeric Client', 'melvorD:Plant')"
	);
	database.run('INSERT INTO guild_memberships (client_id, guild_id) VALUES (1, 1)');
	database.run('INSERT INTO gifts (gift_id, client_id, sender_id) VALUES (1, 1, 1)');
	database.run(
		"INSERT INTO gift_items (id, gift_id, item_id, qty) VALUES " +
		"(1, 1, 'melvorD:Coal_Ore', 0), (2, 1, 'melvorD:Iron_Ore', 2)"
	);
	database.run(
		"INSERT INTO trade_items (id, trade_id, item_id, qty, counter) VALUES " +
		"(1, 1, 'melvorD:Coal_Ore', 0, 0), (2, 1, 'melvorD:Iron_Ore', 3, 0)"
	);
	database.run(
		"INSERT INTO market_items (id, guild_id, client_id, item_id, qty, available, price, payout) VALUES " +
		"(1, 1, 1, 'melvorD:Coal_Ore', 0, 0, 1, 0), " +
		"(2, 1, 1, 'melvorD:Iron_Ore', 4, 4, 2, 0)"
	);
	database.run(
		"INSERT INTO charity_items (guild_id, item_id, qty, expires_at) VALUES " +
		"(1, 'melvorD:Coal_Ore', 0, 100), (1, 'melvorD:Iron_Ore', 5, 100)"
	);

	const migration = migrations.find(entry => entry.version === 31);
	expect(migration?.foreign_keys_disabled).not.toBe(true);
	database.transaction(() => {
		database.run(migration?.sql ?? '');
		database.run('PRAGMA user_version = 31');
	}).immediate();

	expect(database.query('SELECT id, qty FROM gift_items').all()).toEqual([{ id: 2, qty: 2 }]);
	expect(database.query('SELECT id, qty FROM trade_items').all()).toEqual([{ id: 2, qty: 3 }]);
	expect(database.query('SELECT id, qty, price FROM market_items').all()).toEqual([{ id: 2, qty: 4, price: 2 }]);
	expect(database.query('SELECT item_id, qty FROM charity_items').all())
		.toEqual([{ item_id: 'melvorD:Iron_Ore', qty: 5 }]);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	expect(() => database.run(
		"INSERT INTO gift_items (gift_id, item_id, qty) VALUES (1, 'melvorD:Coal_Ore', 0)"
	)).toThrow();
	expect(() => database.run(
		"INSERT INTO market_items (guild_id, client_id, item_id, qty, available, price) " +
		"VALUES (1, 1, 'melvorD:Coal_Ore', 1, 1, 0)"
	)).toThrow();
	database.close();
});
