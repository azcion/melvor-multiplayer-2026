import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('removes historic row snapshots while preserving semantic audit events', () => {
	const database = new Database(':memory:', { strict: true });
	try {
		for (const migration of migrations.filter(entry => entry.version < 93))
			database.transaction(() => database.run(migration.sql)).immediate();
		const event = database.query<{ id: number }, []>(
			"INSERT INTO audit_events (occurred_at, event_type, actor_kind, actor_client_id, actor_display_name, source_key) " +
			"VALUES (1, 'gift.sent', 'client', 1, 'Sender', 'semantic-event') RETURNING id"
		).get()!;
		database.query(
			"INSERT INTO audit_row_changes (event_id, ordinal, table_name, operation, row_key_json, before_json, after_json) " +
			"VALUES (?, 0, 'gifts', 'insert', '{\"id\":1}', NULL, '{\"id\":1}')"
		).run(event.id);

		database.transaction(() => database.run(migrations.find(entry => entry.version === 93)!.sql)).immediate();

		expect(database.query("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'audit_row_changes'").get()).toBeNull();
		expect(database.query('SELECT event_type FROM audit_events WHERE id = ?').get(event.id)).toEqual({ event_type: 'gift.sent' });
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {
		database.close();
	}
});
