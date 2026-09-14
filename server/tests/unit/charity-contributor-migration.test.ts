import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('backfills surviving Charitree contributor lots from durable audit positions', () => {
	const database = new Database(':memory:', { strict: true });
	try {
		for (const migration of migrations.filter(entry => entry.version < 83)) {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = ON');
		}
		database.run('PRAGMA foreign_keys = ON');
		database.run(
			"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
			"VALUES (1, 'contributor', 'key', '123-456-789', 'Contributor', 'melvorD:Plant')"
		);
		database.run("INSERT INTO guilds (id, name, icon_id) VALUES (2, 'Contributor Guild', 'multiplayer')");
		database.run(
			"INSERT INTO charity_items (guild_id, item_id, qty, expires_at, donated_at) " +
			"VALUES (2, 'melvorD:Logs', 8, 10000, 1000)"
		);
		const event = database.query<{ id: number }, []>(
			"INSERT INTO audit_events (occurred_at, event_type, actor_kind, actor_client_id, actor_display_name, " +
			"guild_id, guild_name, source_key) VALUES (1000, 'charitree.donated', 'client', 1, 'Contributor', " +
			"2, 'Contributor Guild', 'migration-contribution') RETURNING id"
		).get()!;
		const lot = database.query<{ id: number }, [number]>(
			"INSERT INTO audit_value_lots (created_by_event_id, object_id, original_quantity) " +
			"VALUES (?, 'melvorD:Logs', 10) RETURNING id"
		).get(event.id)!;
		database.query(
			"INSERT INTO audit_value_lot_positions (lot_id, position_kind, position_key, quantity) " +
			"VALUES (?, 'charitree', '2', 6)"
		).run(lot.id);

		database.transaction(() => database.run(migrations.find(entry => entry.version === 83)!.sql)).immediate();

		expect(database.query(
			'SELECT guild_id, item_id, client_id, qty, contributed_at, source_audit_lot_id ' +
			'FROM charity_contribution_lots'
		).all()).toEqual([{
			guild_id: 2,
			item_id: 'melvorD:Logs',
			client_id: 1,
			qty: 6,
			contributed_at: 1000,
			source_audit_lot_id: lot.id
		}]);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {
		database.close();
	}
});
