import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';
import {
	parse_support_membership_client_identifiers,
	reconcile_support_memberships
} from '../../support_chat';

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
	database.query(
		'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, ' +
		'`melvor_account_id`) VALUES(?, ?, ?, ?, ?, 1), (?, ?, ?, ?, ?, 2)'
	).run(
		'CLIENT-FIRST', 'key-first', '111-111-111', 'First Character', 'melvorD:Plant',
		'CLIENT-SECOND', 'key-second', '222-222-222', 'Second Character', 'melvorD:Crab'
	);
	return database;
}

test('validates and normalizes Support Team membership configuration before reconciliation', () => {
	expect(parse_support_membership_client_identifiers(undefined)).toBeUndefined();
	expect(parse_support_membership_client_identifiers('')).toEqual([]);
	expect(parse_support_membership_client_identifiers(' CLIENT-FIRST,CLIENT-SECOND,CLIENT-FIRST '))
		.toEqual(['CLIENT-FIRST', 'CLIENT-SECOND']);
	expect(() => parse_support_membership_client_identifiers('CLIENT-FIRST,,CLIENT-SECOND')).toThrow(
		'SUPPORT_TEAM_CLIENT_IDENTIFIERS must be a comma-separated list of Client identifiers'
	);
});

test('atomically activates configured Clients and deactivates omitted memberships', () => {
	const database = fixture_database();
	reconcile_support_memberships('CLIENT-FIRST,CLIENT-SECOND', 10, database);
	expect(database.query(
		'SELECT client.`client_identifier`, membership.`member_display_name`, membership.`active` ' +
		'FROM `support_team_memberships` AS membership JOIN `clients` AS client ' +
		'ON client.`id` = membership.`client_id` ORDER BY client.`client_identifier`'
	).all()).toEqual([
		{ client_identifier: 'CLIENT-FIRST', member_display_name: 'First Character', active: 1 },
		{ client_identifier: 'CLIENT-SECOND', member_display_name: 'Second Character', active: 1 }
	]);
	reconcile_support_memberships('CLIENT-SECOND', 20, database);
	expect(database.query(
		'SELECT client.`client_identifier`, membership.`active` FROM `support_team_memberships` AS membership ' +
		'JOIN `clients` AS client ON client.`id` = membership.`client_id` ORDER BY client.`client_identifier`'
	).all()).toEqual([
		{ client_identifier: 'CLIENT-FIRST', active: 0 },
		{ client_identifier: 'CLIENT-SECOND', active: 1 }
	]);
	reconcile_support_memberships('', 30, database);
	expect(database.query<{ active: number }, []>(
		'SELECT SUM(`active`) AS `active` FROM `support_team_memberships`'
	).get()?.active).toBe(0);
	database.close();
});
