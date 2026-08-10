import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('removes only conversations with no retained Messages', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 23)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) VALUES " +
		"(1, 'chat-one', 'key-one', 'friend-one', 'One', 'melvorD:Plant'), " +
		"(2, 'chat-two', 'key-two', 'friend-two', 'Two', 'melvorD:Seagull'), " +
		"(3, 'chat-three', 'key-three', 'friend-three', 'Three', 'melvorD:Crab')"
	);
	database.run(
		'INSERT INTO chat_conversations (id, participant_low_id, participant_high_id, created_at) VALUES ' +
		'(1, 1, 2, 100), (2, 1, 3, 200)'
	);
	database.run(
		'INSERT INTO chat_participants (conversation_id, client_id) VALUES ' +
		'(1, 1), (1, 2), (2, 1), (2, 3)'
	);
	database.run(
		"INSERT INTO chat_messages (id, conversation_id, sender_id, idempotency_key, content, created_at) " +
		"VALUES (1, 2, 1, 'retained-message', 'Deleted everywhere', 201)"
	);
	database.run(
		'INSERT INTO chat_message_deletions (message_id, client_id, deleted_at) VALUES ' +
		'(1, 1, 202), (1, 3, 202)'
	);

	const migration = migrations.find(entry => entry.version === 23);
	expect(migration).toBeDefined();
	database.transaction(() => database.run(migration?.sql ?? '')).immediate();

	expect(database.query('SELECT id FROM chat_conversations ORDER BY id').all()).toEqual([{ id: 2 }]);
	expect(database.query('SELECT conversation_id, client_id FROM chat_participants ORDER BY client_id').all()).toEqual([
		{ conversation_id: 2, client_id: 1 },
		{ conversation_id: 2, client_id: 3 }
	]);
	expect(database.query('SELECT message_id, client_id FROM chat_message_deletions ORDER BY client_id').all()).toEqual([
		{ message_id: 1, client_id: 1 },
		{ message_id: 1, client_id: 3 }
	]);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});
