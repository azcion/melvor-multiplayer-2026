import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('adds nullable timestamps to previously undated pending value rows', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 57)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		"INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
		"VALUES (1, 'timestamp-client', 'key', '111-111-111', 'Timestamp Client', 'melvorD:Plant')"
	);
	database.run('INSERT INTO gifts (client_id, sender_id) VALUES (1, 1)');
	database.run('INSERT INTO trade_offers (sender_id, recipient_id, attending_id) VALUES (1, 1, 1)');
	database.run('INSERT INTO resolved_trade_offers (trade_id, client_id, sender_id) VALUES (1, 1, 1)');
	database.run(
		"INSERT INTO campaign_completions " +
		"(source_campaign_state_id, source_guild_id, client_id, campaign_id, item_id, item_amount, taken) " +
		"VALUES (1, 1, 1, 'campaign_desert', 'melvorD:Topaz', 10, 0)"
	);
	database.run("INSERT INTO inbox_items (client_id, item_id, qty) VALUES (1, 'melvorD:Topaz', 10)");

	const migration = migrations.find(entry => entry.version === 57);
	expect(migration).toBeDefined();
	database.transaction(() => database.run(migration?.sql ?? '')).immediate();

	expect(database.query(
		'SELECT created_at FROM gifts UNION ALL ' +
		'SELECT created_at FROM trade_offers UNION ALL ' +
		'SELECT created_at FROM resolved_trade_offers UNION ALL ' +
		'SELECT created_at FROM campaign_completions UNION ALL ' +
		'SELECT created_at FROM inbox_items'
	).all()).toEqual([
		{ created_at: null },
		{ created_at: null },
		{ created_at: null },
		{ created_at: null },
		{ created_at: null }
	]);

	const update_migration = migrations.find(entry => entry.version === 59);
	expect(update_migration).toBeDefined();
	database.transaction(() => database.run(update_migration?.sql ?? '')).immediate();

	expect(database.query(
		'SELECT created_at, updated_at FROM gifts UNION ALL ' +
		'SELECT created_at, updated_at FROM trade_offers UNION ALL ' +
		'SELECT created_at, NULL AS updated_at FROM resolved_trade_offers UNION ALL ' +
		'SELECT created_at, updated_at FROM campaign_completions UNION ALL ' +
		'SELECT created_at, updated_at FROM inbox_items'
	).all()).toEqual([
		{ created_at: null, updated_at: null },
		{ created_at: null, updated_at: null },
		{ created_at: null, updated_at: null },
		{ created_at: null, updated_at: null },
		{ created_at: null, updated_at: null }
	]);

	database.run('UPDATE gifts SET updated_at = 10');
	database.run('UPDATE trade_offers SET updated_at = 10');
	database.run('UPDATE campaign_completions SET updated_at = 10');
	database.run('UPDATE inbox_items SET updated_at = 10');
	expect(database.query(
		'SELECT created_at, updated_at FROM gifts UNION ALL ' +
		'SELECT created_at, updated_at FROM trade_offers UNION ALL ' +
		'SELECT created_at, updated_at FROM campaign_completions UNION ALL ' +
		'SELECT created_at, updated_at FROM inbox_items'
	).all()).toEqual([
		{ created_at: null, updated_at: 10 },
		{ created_at: null, updated_at: 10 },
		{ created_at: null, updated_at: 10 },
		{ created_at: null, updated_at: 10 }
	]);

	expect(() => database.run(
		"INSERT INTO gifts (client_id, sender_id, created_at) VALUES (1, 1, -1)"
	)).toThrow();
	expect(() => database.run(
		"INSERT INTO gifts (client_id, sender_id, created_at, updated_at) VALUES (1, 1, 10, -1)"
	)).toThrow();
	database.close();
});
