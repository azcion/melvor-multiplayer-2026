import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('consolidates duplicate PlayFab account rows while preserving Client references', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 21)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.query(
		'INSERT INTO `melvor_accounts` (`id`, `cloud_username`, `playfab_id`, `created_at`) VALUES ' +
		'(4, ?, ?, 100), (7, ?, ?, 200), (9, ?, ?, 150)'
	).run('First Spelling', 'SAME-PLAYFAB', 'first spelling', 'SAME-PLAYFAB', 'Other', 'OTHER-PLAYFAB');
	database.query(
		'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, ' +
		'`melvor_account_id`) VALUES ' +
		"(1, 'client-one', 'key-one', 'friend-one', 'One', 'melvorD:Plant', 4), " +
		"(2, 'client-two', 'key-two', 'friend-two', 'Two', 'melvorD:Seagull', 7)"
	).run();

	const migration = migrations.find(entry => entry.version === 21);
	expect(migration?.foreign_keys_disabled).toBe(true);
	database.run('PRAGMA foreign_keys = OFF');
	try {
		database.transaction(() => {
			database.run(migration?.sql ?? '');
			expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
			database.run('PRAGMA user_version = 21');
		}).immediate();
	} finally {
		database.run('PRAGMA foreign_keys = ON');
	}

	expect(database.query(
		'SELECT `id`, `cloud_username`, `playfab_id` FROM `melvor_accounts` ORDER BY `id`'
	).all()).toEqual([
		{ id: 4, cloud_username: 'First Spelling', playfab_id: 'SAME-PLAYFAB' },
		{ id: 9, cloud_username: 'Other', playfab_id: 'OTHER-PLAYFAB' }
	]);
	expect(database.query(
		'SELECT `id`, `melvor_account_id` FROM `clients` ORDER BY `id`'
	).all()).toEqual([
		{ id: 1, melvor_account_id: 4 },
		{ id: 2, melvor_account_id: 4 }
	]);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	expect(database.query<{ foreign_keys: number }, []>('PRAGMA foreign_keys').get()?.foreign_keys).toBe(1);
	expect(database.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version).toBe(21);
	expect(() => database.query(
		'INSERT INTO `melvor_accounts` (`cloud_username`, `playfab_id`, `created_at`) VALUES (?, ?, ?)'
	).run('Later Spelling', 'SAME-PLAYFAB', 300)).toThrow();
	database.close();
});
