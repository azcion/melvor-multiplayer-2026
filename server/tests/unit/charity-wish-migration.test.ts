import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

function apply_migrations(database: Database, predicate: (version: number) => boolean): void {
	for (const migration of migrations.filter(entry => predicate(entry.version))) {
		database.transaction(() => database.run(migration.sql)).immediate();
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
}

test('records the first ripe time and gives existing ripe Wishes a migration grace period', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply_migrations(database, version => version <= 84);

	const account = database.query(
		'INSERT INTO `melvor_accounts` (`cloud_username`, `playfab_id`, `created_at`) VALUES(?, ?, ?)'
	).run('Wish Migration Account', crypto.randomUUID(), 1);
	const client = database.query(
		'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, `melvor_account_id`) ' +
		'VALUES(?, ?, ?, ?, ?, ?)'
	).run(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), 'Wish Migration Owner', 'melvorD:Plant', account.lastInsertRowid);

	database.query(
		'INSERT INTO `charity_wishes` (`guild_id`, `owner_client_id`, `melvor_account_id`, `item_id`, `qty`, ' +
		'`required_gp`, `progress_gp`, `created_at`, `matures_at`) VALUES(1, ?, ?, ?, 1, 100, ?, 1, 1)'
	).run(client.lastInsertRowid, account.lastInsertRowid, 'test:Migration_Ripe', 100);

	const before = Date.now();
	apply_migrations(database, version => version === 85);
	const ripe_at = database.query<{ ripe_at: number }, []>(
		' SELECT `ripe_at` FROM `charity_wishes` WHERE `item_id` = \'test:Migration_Ripe\''
	).get()?.ripe_at ?? 0;

	expect(ripe_at).toBeGreaterThanOrEqual(before - 1000);
	expect(ripe_at).toBeLessThanOrEqual(Date.now());
	expect(database.query('SELECT `ripe_at` FROM `charity_wishes` WHERE `progress_gp` < `required_gp`').get()).toBeNull();
	database.close();
});

test('shortens existing Maturing Wishes to 20 hours without lengthening shorter or Ripe timers', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply_migrations(database, version => version <= 98);

	const insert_account = database.query(
		'INSERT INTO `melvor_accounts` (`cloud_username`, `playfab_id`, `created_at`) VALUES(?, ?, 1)'
	);
	const insert_client = database.query(
		'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, `melvor_account_id`) ' +
		'VALUES(?, ?, ?, ?, ?, ?)'
	);
	const insert_wish = database.query(
		'INSERT INTO `charity_wishes` (`guild_id`, `owner_client_id`, `melvor_account_id`, `item_id`, `qty`, ' +
		'`required_gp`, `progress_gp`, `created_at`, `matures_at`) VALUES(1, ?, ?, ?, 1, 100, ?, ?, ?)'
	);
	for (const [index, item_id, progress_gp, matures_at] of [
		[1, 'test:Long', 0, 96 * 60 * 60 * 1000],
		[2, 'test:Short', 0, 10 * 60 * 60 * 1000],
		[3, 'test:Ripe', 100, 96 * 60 * 60 * 1000]
	] as const) {
		const account = insert_account.run(`Account ${index}`, crypto.randomUUID());
		const client = insert_client.run(
			crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), `Owner ${index}`, 'melvorD:Plant', account.lastInsertRowid
		);
		insert_wish.run(client.lastInsertRowid, account.lastInsertRowid, item_id, progress_gp, 0, matures_at);
	}
	database.query("UPDATE `service_settings` SET `value` = '123' WHERE `key` LIKE 'charity_wish_promo_%'").run();

	apply_migrations(database, version => version === 99);

	const wishes = database.query<{ item_id: string; matures_at: number }, []>(
		'SELECT `item_id`, `matures_at` FROM `charity_wishes` ORDER BY `id`'
	).all();
	expect(wishes).toEqual([
		{ item_id: 'test:Long', matures_at: 20 * 60 * 60 * 1000 },
		{ item_id: 'test:Short', matures_at: 10 * 60 * 60 * 1000 },
		{ item_id: 'test:Ripe', matures_at: 96 * 60 * 60 * 1000 }
	]);
	expect(database.query<{ value: string }, []>(
		"SELECT `value` FROM `service_settings` WHERE `key` LIKE 'charity_wish_promo_%' AND `value` != '0'"
	).all()).toEqual([]);
	database.close();
});
