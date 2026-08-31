import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('repairs fractional Campaign rewards and wakes Clients with pending receipts', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(entry => entry.version < 48)) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}
	database.run('PRAGMA foreign_keys = ON');
	database.run(
		'INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, event_revision) ' +
		"VALUES (1, 'campaign-migration', 'key', '111-111-111', 'Campaign Migration', 'melvorD:Plant', 7)"
	);
	const guild_id = database.query<{ id: number }, []>(
		"SELECT id FROM guilds WHERE type = 'free_fellowship'"
	).get()?.id as number;
	database.run(
		'INSERT INTO campaign_state ' +
		'(id, guild_id, campaign_id, item_id, item_amount, item_current, complete, campaign_next) ' +
		"VALUES (100, ?, 'campaign_desert', 'melvorD:Topaz', 10, 10, 1, 0)",
		[guild_id]
	);
	database.run(
		'INSERT INTO campaign_contributions (campaign_id, client_id, item_amount, taken) VALUES (100, 1, 10, 125.6)'
	);
	database.run(
		'INSERT INTO campaign_completions ' +
		'(source_campaign_state_id, source_guild_id, client_id, campaign_id, item_id, item_amount, taken) ' +
		"VALUES (100, ?, 1, 'campaign_desert', 'melvorD:Topaz', 10, 125.6)",
		[guild_id]
	);
	const receipt = {
		success: true,
		receipt: {
			id: '00000000-0000-4000-8000-000000000001',
			kind: 'campaign-claim',
			effects: [{ storage: 'gp', qty: 125.6 }]
		}
	};
	database.run(
		'INSERT INTO economy_receipts (id, client_id, kind, response_json, created_at) VALUES (?, 1, ?, ?, 1)',
		[receipt.receipt.id, receipt.receipt.kind, JSON.stringify(receipt)]
	);

	const migration = migrations.find(entry => entry.version === 48);
	database.transaction(() => database.run(migration?.sql ?? '')).immediate();

	expect(database.query<{ event_revision: number }, []>(
		'SELECT event_revision FROM clients WHERE id = 1'
	).get()?.event_revision).toBe(8);
	expect(database.query<{ taken: number; storage_type: string }, []>(
		'SELECT taken, typeof(taken) AS storage_type FROM campaign_completions WHERE client_id = 1'
	).get()).toEqual({ taken: 126, storage_type: 'integer' });
	expect(database.query<{ taken: number; storage_type: string }, []>(
		'SELECT taken, typeof(taken) AS storage_type FROM campaign_contributions WHERE client_id = 1'
	).get()).toEqual({ taken: 126, storage_type: 'integer' });
	const stored = database.query<{ response_json: string }, []>(
		'SELECT response_json FROM economy_receipts WHERE client_id = 1'
	).get();
	expect(JSON.parse(stored?.response_json ?? '{}')).toEqual({
		success: true,
		receipt: {
			id: receipt.receipt.id,
			kind: 'campaign-claim',
			effects: [{ storage: 'gp', qty: 126 }]
		}
	});
	database.close();
});
