import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';
import { parse_support_membership_ids, reconcile_support_memberships } from '../../support_chat';

function fixture_database(): Database {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.query(
		'INSERT INTO `melvor_accounts` (`cloud_username`, `playfab_id`, `created_at`) VALUES(?, ?, ?), (?, ?, ?)'
	).run('First', 'PLAYFAB-FIRST', 1, 'Second', 'PLAYFAB-SECOND', 2);
	return database;
}

test('validates and normalizes Support Team membership configuration before reconciliation', () => {
	expect(parse_support_membership_ids(undefined)).toBeUndefined();
	expect(parse_support_membership_ids('')).toEqual([]);
	expect(parse_support_membership_ids(' PLAYFAB-FIRST,PLAYFAB-SECOND,PLAYFAB-FIRST '))
		.toEqual(['PLAYFAB-FIRST', 'PLAYFAB-SECOND']);
	expect(() => parse_support_membership_ids('PLAYFAB-FIRST,,PLAYFAB-SECOND')).toThrow(
		'SUPPORT_TEAM_PLAYFAB_IDS must be a comma-separated list of PlayFab IDs'
	);
});

test('atomically activates configured accounts and deactivates omitted memberships', () => {
	const database = fixture_database();
	reconcile_support_memberships('PLAYFAB-FIRST,PLAYFAB-SECOND', 10, database);
	expect(database.query(
		'SELECT account.`playfab_id`, membership.`active` FROM `support_team_memberships` AS membership ' +
		'JOIN `melvor_accounts` AS account ON account.`id` = membership.`melvor_account_id` ORDER BY account.`playfab_id`'
	).all()).toEqual([
		{ playfab_id: 'PLAYFAB-FIRST', active: 1 },
		{ playfab_id: 'PLAYFAB-SECOND', active: 1 }
	]);
	reconcile_support_memberships('PLAYFAB-SECOND', 20, database);
	expect(database.query(
		'SELECT account.`playfab_id`, membership.`active` FROM `support_team_memberships` AS membership ' +
		'JOIN `melvor_accounts` AS account ON account.`id` = membership.`melvor_account_id` ORDER BY account.`playfab_id`'
	).all()).toEqual([
		{ playfab_id: 'PLAYFAB-FIRST', active: 0 },
		{ playfab_id: 'PLAYFAB-SECOND', active: 1 }
	]);
	reconcile_support_memberships('', 30, database);
	expect(database.query<{ active: number }, []>(
		'SELECT SUM(`active`) AS `active` FROM `support_team_memberships`'
	).get()?.active).toBe(0);
	database.close();
});
