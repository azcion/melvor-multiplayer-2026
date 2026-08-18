import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('moves Support authority to Clients while preserving legacy authorship and read state', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 28)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		"INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES " +
		"(1, 'Legacy Support', 'LEGACY-SUPPORT-ID', 1)"
	);
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id) " +
		"VALUES (1, 'support-client', 'key-one', '111-111-111', 'Support Character', 'melvorD:Plant', 1), " +
		"(2, 'player-client', 'key-two', '222-222-222', 'Player', 'melvorD:Crab', NULL)"
	);
	database.run(
		'INSERT INTO support_team_memberships (id, team_id, melvor_account_id, created_at) VALUES (1, 1, 1, 2)'
	);
	database.run(
		'INSERT INTO support_conversations (id, team_id, player_client_id, created_at) VALUES (1, 1, 2, 3)'
	);
	database.run(
		"INSERT INTO support_messages (id, conversation_id, author_kind, membership_id, sending_client_id, " +
		"idempotency_scope, idempotency_key, content, created_at) VALUES " +
		"(1, 1, 'member', 1, 1, 'member:1', 'legacy-message', 'Retained reply', 4)"
	);
	database.run(
		'INSERT INTO support_member_message_reads (message_id, membership_id, read_at) VALUES (1, 1, 5)'
	);
	database.run(
		'INSERT INTO client_deletion_requests ' +
		'(`id`, `target_client_id`, `requester_client_id`, `requested_at`, `execute_at`) VALUES (1, 2, 1, 6, 7)'
	);
	database.run(
		"INSERT INTO client_deletion_returns " +
		"(`id`, `request_id`, `client_id`, `source_display_name`, `created_at`) VALUES (1, 1, 1, 'Player', 8)"
	);

	const migration = migrations.find(entry => entry.version === 28);
	expect(migration?.foreign_keys_disabled).toBe(true);
	database.run('PRAGMA foreign_keys = OFF');
	try {
		database.transaction(() => {
			database.run(migration?.sql ?? '');
			expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
			database.run('PRAGMA user_version = 28');
		}).immediate();
	} finally {
		database.run('PRAGMA foreign_keys = ON');
	}

	expect(database.query(
		'SELECT id, team_id, client_id, member_display_name, active, created_at FROM support_team_memberships'
	).all()).toEqual([{
		id: 1,
		team_id: 1,
		client_id: null,
		member_display_name: 'Legacy Support',
		active: 0,
		created_at: 2
	}]);
	expect(database.query('SELECT id, membership_id, content FROM support_messages').all()).toEqual([{
		id: 1,
		membership_id: 1,
		content: 'Retained reply'
	}]);
	expect(database.query('SELECT message_id, membership_id, read_at FROM support_member_message_reads').all())
		.toEqual([{ message_id: 1, membership_id: 1, read_at: 5 }]);
	expect(database.query(
		'SELECT id, target_client_id, requester_client_id FROM client_deletion_requests'
	).all()).toEqual([{ id: 1, target_client_id: 2, requester_client_id: 1 }]);
	expect(database.query('SELECT id, request_id, client_id FROM client_deletion_returns').all())
		.toEqual([{ id: 1, request_id: 1, client_id: 1 }]);
	database.run(
		'INSERT INTO client_deletion_requests ' +
		'(`target_client_id`, `requester_client_id`, `requested_at`, `execute_at`) VALUES (1, 1, 9, 10)'
	);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});
