import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';

function apply_migrations(database: Database, predicate: (version: number) => boolean): void {
	for (const migration of migrations.filter(entry => predicate(entry.version))) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
}

test('account Poll migration collapses sibling votes and clears obsolete deletion markers', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	apply_migrations(database, version => version <= 97);
	database.run("INSERT INTO `melvor_accounts` (`id`, `cloud_username`, `playfab_id`, `created_at`) VALUES (1, 'Poll Account', 'poll-account', 1)");
	database.run(
		"INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, `melvor_account_id`) VALUES " +
		"(1, 'poll-creator', 'key-1', '111-111-111', 'Creator', 'melvorD:Plant', NULL), " +
		"(2, 'poll-sibling-a', 'key-2', '222-222-222', 'Sibling A', 'melvorD:Plant', 1), " +
		"(3, 'poll-sibling-b', 'key-3', '333-333-333', 'Sibling B', 'melvorD:Plant', 1), " +
		"(4, 'poll-unlinked', 'key-4', '444-444-444', 'Unlinked', 'melvorD:Plant', NULL)"
	);
	database.run(
		"INSERT INTO `polls` (`id`, `creator_id`, `idempotency_key`, `content`, `choice_mode`, `created_at`, `revision`) VALUES " +
		"(1, 1, 'single', 'Single?', 'single', 1, 1), (2, 1, 'multi', 'Multi?', 'multi', 2, 2)"
	);
	database.run(
		"INSERT INTO `poll_options` (`id`, `poll_id`, `position`, `content`, `created_at`) VALUES " +
		"(1, 1, 0, 'Old', 1), (2, 1, 1, 'New', 1), (3, 2, 0, 'Shared', 2), (4, 2, 1, 'Extra', 2)"
	);
	database.run(
		"INSERT INTO `poll_votes` (`poll_id`, `option_id`, `client_id`, `created_at`) VALUES " +
		"(1, 1, 2, 10), (1, 2, 3, 20), (1, 1, 4, 30), " +
		"(2, 3, 2, 40), (2, 3, 3, 50), (2, 4, 2, 60)"
	);
	database.run(
		"INSERT INTO `poll_interactions` (`poll_id`, `client_id`, `interacted_at`) VALUES " +
		"(1, 2, 10), (1, 3, 20), (1, 4, 30)"
	);
	database.run(
		"INSERT INTO `poll_vote_throttles` (`poll_id`, `client_id`, `last_mutated_at`) VALUES " +
		"(1, 2, 10), (1, 3, 20), (1, 4, 30)"
	);
	database.run('INSERT INTO `poll_deletions` (`poll_id`, `revision`) VALUES (90, 90), (91, 91)');

	apply_migrations(database, version => version === 98);

	expect(database.query('SELECT `poll_id`, `option_id`, `owner_key`, `client_id`, `created_at` FROM `poll_votes` ORDER BY `poll_id`, `owner_key`, `option_id`').all()).toEqual([
		{ poll_id: 1, option_id: 2, owner_key: 'account:1', client_id: 3, created_at: 20 },
		{ poll_id: 1, option_id: 1, owner_key: 'client:4', client_id: 4, created_at: 30 },
		{ poll_id: 2, option_id: 3, owner_key: 'account:1', client_id: 3, created_at: 50 },
		{ poll_id: 2, option_id: 4, owner_key: 'account:1', client_id: 2, created_at: 60 }
	]);
	expect(database.query('SELECT `poll_id`, `owner_key`, `interacted_at` FROM `poll_interactions` ORDER BY `owner_key`').all()).toEqual([
		{ poll_id: 1, owner_key: 'account:1', interacted_at: 10 },
		{ poll_id: 1, owner_key: 'client:4', interacted_at: 30 }
	]);
	expect(database.query('SELECT `poll_id`, `owner_key`, `last_mutated_at` FROM `poll_vote_throttles` ORDER BY `owner_key`').all()).toEqual([
		{ poll_id: 1, owner_key: 'account:1', last_mutated_at: 20 },
		{ poll_id: 1, owner_key: 'client:4', last_mutated_at: 30 }
	]);
	expect(database.query<{ count: number }, []>('SELECT COUNT(*) AS `count` FROM `poll_deletions`').get()?.count).toBe(0);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});
