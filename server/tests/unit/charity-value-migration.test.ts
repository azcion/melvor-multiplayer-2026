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

test('preserves existing Charitree stacks as unknown until the value backfill', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply_migrations(database, version => version < 64);
	database.run(
		"INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`) VALUES " +
		"(1, 'melvorD:Logs', 5, 1700001000000, 1700000000000), " +
		"(1, 'melvorD:Weird_Gloop', 2, 1700001000000, 1700000000000)"
	);
	apply_migrations(database, version => version === 64);

	expect(database.query(
		'SELECT `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item` ' +
		'FROM `charity_items` ORDER BY `item_id`'
	).all()).toEqual([
		{
			item_id: 'melvorD:Logs', qty: 5, expires_at: 1700001000000, donated_at: 1700000000000,
			value_currency_id: null, value_per_item: null
		},
		{
			item_id: 'melvorD:Weird_Gloop', qty: 2, expires_at: 0, donated_at: 0,
			value_currency_id: null, value_per_item: null
		}
	]);
	expect(database.query(
		"SELECT `value` FROM `service_settings` WHERE `key` = 'charity_value_backfill_pending'"
	).get()).toEqual({ value: '1' });
	database.close();
});

test('does not require a value backfill for a fresh empty database', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply_migrations(database, () => true);
	expect(database.query(
		"SELECT `value` FROM `service_settings` WHERE `key` = 'charity_value_backfill_pending'"
	).get()).toEqual({ value: '0' });
	database.close();
});
