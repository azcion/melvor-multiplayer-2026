import { beforeAll, expect, test } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';

beforeAll(async () => {
	const now = Date.now();
	await db_run('INSERT OR IGNORE INTO crucible_migration ' +
		'(id, started_at, completed_at, source_json, destination_json) VALUES (1, ?, ?, ?, ?)',
		[now, now, '{}', '{}']);
	await db_run('INSERT OR IGNORE INTO crucible_guilds (guild_id, processed_minute, created_at) ' +
		'SELECT id, ?, ? FROM guilds', [Math.floor(now / 60_000), now]);
});

test('1.5.16 Guildmates retain Charitree contents, donation, and taking during Crucible testing', async () => {
	const pair = await make_guildmates('Legacy Donor', 'Legacy Taker', 'Legacy Crucible',
		{ first: '1.5.16', second: '1.5.16' });
	await db_run('UPDATE guild_memberships SET charitree_take_available_at = 0 WHERE client_id = ?',
		[pair.second_id]);
	const item_id = `test:Legacy_Offering_${crypto.randomUUID().replaceAll('-', '')}`;
	const donated = await post_json<{ success: boolean }>('/api/charity/donate', {
		command_id: crypto.randomUUID(), items: [{ id: item_id, qty: 2 }]
	}, pair.first.session_token);
	expect(donated.json.success).toBe(true);
	const contents = await get_json_with_session<{ items: Array<{ id: string; qty: number }> }>(
		'/api/charity/contents', pair.second.session_token);
	expect(contents.json.items).toContainEqual(expect.objectContaining({ id: item_id, qty: 2 }));
	const taken = await post_json<{ success: boolean }>('/api/charity/take', {
		command_id: crypto.randomUUID(), item_id, qty: 1
	}, pair.second.session_token);
	expect(taken.json.success).toBe(true);
	expect(await db_all<{ qty: number }>('SELECT qty FROM charity_items WHERE guild_id = ? AND item_id = ?',
		[pair.guild_id, item_id])).toEqual([{ qty: 1 }]);
});

test('1.6.0 Cast and Reclaim use receipts while 1.5.16 Charitree remains usable', async () => {
	const newer = await register_guild_client('Crucible New', 'Crucible New Guild', '1.6.0');
	const older = await register_guild_client('Crucible Old', 'Crucible Old Guild', '1.5.16');
	const item_id = `test:Crucible_Ore_${crypto.randomUUID().replaceAll('-', '')}`;
	const command_id = crypto.randomUUID();
	const body = { command_id, source: 'bank', items: [{ id: item_id, qty: 3,
		value_currency_id: 'melvorD:GP', value_per_item: 100 }] };
	const cast = await post_json<{ success: boolean; receipt: { id: string; effects: Array<{ qty: number }> } }>(
		'/api/crucible/cast', body, newer.session_token);
	expect(cast.response.status).toBe(200);
	expect(cast.json).toMatchObject({ success: true, receipt: { id: command_id,
		effects: [{ qty: -3 }] } });
	const replay = await post_json<typeof cast.json>('/api/crucible/cast', body, newer.session_token);
	expect(replay.json).toEqual(cast.json);
	const acknowledged = await post_json<{ success: boolean }>('/api/economy/receipts/acknowledge',
		{ receipt_id: command_id }, newer.session_token);
	expect(acknowledged.json.success).toBe(true);
	const acknowledged_replay = await post_json<{ success: boolean; receipt: null }>(
		'/api/crucible/cast', body, newer.session_token);
	expect(acknowledged_replay.json).toMatchObject({ success: true, receipt: null });
	expect(await db_all<{ qty: number }>('SELECT qty FROM crucible_offerings WHERE guild_id = ? AND item_id = ?',
		[newer.guild_id, item_id])).toEqual([{ qty: 3 }]);

	const contents = await get_json_with_session<{ heat: { value: number; tier: number };
		offerings: Array<{ item_id: string; qty: number }> }>('/api/crucible/contents', newer.session_token);
	expect(contents.json.heat).toMatchObject({ value: 400, tier: 1 });
	expect(contents.json.offerings).toMatchObject([{ item_id, qty: 3 }]);
	const reclaim = await post_json<{ success: boolean; receipt: { effects: unknown[] } }>(
		'/api/crucible/reclaim', { item_id, qty: 1 }, newer.session_token);
	expect(reclaim.json).toMatchObject({ success: true, receipt: { effects: [] } });
	expect(await db_all<{ qty: number; meld_points: number }>(
		'SELECT qty, meld_points FROM crucible_offerings WHERE guild_id = ? AND item_id = ?',
		[newer.guild_id, item_id])).toEqual([{ qty: 2, meld_points: 0 }]);
	expect(await db_all<{ qty: number }>(
		'SELECT qty FROM inbox_items WHERE client_id = ? AND source_type = ? AND item_id = ?',
		[newer.client_id, 'crucible', item_id])).toEqual([{ qty: 1 }]);
	expect(await db_all<{ event_type: string }>(
		'SELECT event_type FROM audit_events WHERE guild_id = ? AND event_type LIKE ? ORDER BY id',
		[newer.guild_id, 'crucible.%'])).toEqual([
		{ event_type: 'crucible.cast' }, { event_type: 'crucible.reclaimed' }
	]);
	expect(await db_all<{ position_kind: string; position_key: string; qty: number }>(
		'SELECT position.position_kind, position.position_key, SUM(position.quantity) AS qty ' +
		'FROM audit_value_lot_positions AS position JOIN audit_value_lots AS lot ON lot.id = position.lot_id ' +
		'WHERE lot.object_id = ? AND position.position_kind IN (?, ?) ' +
		'GROUP BY position.position_kind, position.position_key ORDER BY position.position_kind',
		[item_id, 'crucible', 'inbox'])).toEqual([
		{ position_kind: 'crucible', position_key: String(newer.guild_id), qty: 2 },
		{ position_kind: 'inbox', position_key: `${newer.client_id}:crucible:`, qty: 1 }
	]);

	const legacy = await post_json<{ success: boolean }>('/api/charity/donate', {
		items: [{ id: 'test:Legacy_Charitree_Item', qty: 1 }]
	}, older.session_token);
	expect(legacy.json.success).toBe(true);
	expect(await db_all<{ qty: number }>(
		'SELECT qty FROM charity_items WHERE guild_id = ? AND item_id = ?',
		[older.guild_id, 'test:Legacy_Charitree_Item'])).toEqual([{ qty: 1 }]);
	const wrong_version = await post('/api/charity/donate', {
		items: [{ id: 'test:Not_Legacy', qty: 1 }]
	}, newer.session_token);
	expect(wrong_version.status).toBe(426);
});

test('Reclaim bonus creates audited Gloop in the Guild Crucible', async () => {
	const pair = await make_guildmates('Crucible Bonus Donor', 'Crucible Bonus Taker',
		'Crucible Bonus', { first: '1.6.0', second: '1.6.0' });
	const account = await db_run('INSERT INTO melvor_accounts (cloud_username, playfab_id, created_at) ' +
		'VALUES (?, ?, ?)', [`crucible-bonus-${crypto.randomUUID()}`, crypto.randomUUID(), Date.now()]);
	expect(account).toBe(1);
	const account_id = (await db_all<{ id: number }>(
		'SELECT id FROM melvor_accounts ORDER BY id DESC LIMIT 1'))[0]!.id;
	await db_run('UPDATE clients SET melvor_account_id = ? WHERE id = ?', [account_id, pair.first_id]);
	await db_run('UPDATE guild_memberships SET charitree_take_available_at = 0 WHERE client_id = ?',
		[pair.second_id]);
	const item_id = `test:Bonus_Ore_${crypto.randomUUID().replaceAll('-', '')}`;
	const cast = await post_json<{ success: boolean }>('/api/crucible/cast', {
		command_id: crypto.randomUUID(), source: 'bank',
		items: [{ id: item_id, qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 100 }]
	}, pair.first.session_token);
	expect(cast.json.success).toBe(true);
	await db_run('INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
		'required_gp, created_at) VALUES (?, ?, ?, ?, 1, 100, ?)',
		[pair.guild_id, pair.first_id, account_id, 'test:Bonus_Reward', Date.now()]);
	const reclaimed = await post_json<{ success: boolean }>('/api/crucible/reclaim',
		{ item_id, qty: 1 }, pair.second.session_token);
	expect(reclaimed.json.success).toBe(true);
	expect(await db_all<{ qty: number }>(
		'SELECT qty FROM crucible_offerings WHERE guild_id = ? AND item_id = ?',
		[pair.guild_id, 'melvorD:Weird_Gloop'])).toEqual([{ qty: 1 }]);
	expect(await db_all<{ quantity: number; direction: string }>(
		'SELECT value.quantity, value.direction FROM audit_event_values AS value ' +
		'JOIN audit_events AS event ON event.id = value.event_id ' +
		'WHERE event.event_type = ? AND event.guild_id = ? AND value.object_id = ?',
		['crucible.reclaimed', pair.guild_id, 'melvorD:Weird_Gloop']))
		.toEqual([{ quantity: 1, direction: 'create' }]);
	expect(await db_all<{ quantity: number }>(
		'SELECT position.quantity FROM audit_value_lot_positions AS position ' +
		'JOIN audit_value_lots AS lot ON lot.id = position.lot_id ' +
		'WHERE position.position_kind = ? AND position.position_key = ? AND lot.object_id = ?',
		['crucible', String(pair.guild_id), 'melvorD:Weird_Gloop']))
		.toEqual([{ quantity: 1 }]);
});

test('Wish reset and paid Clear the Slag use independent Crucible state', async () => {
	const client = await register_guild_client('Crucible Wish', 'Crucible Wish Guild', '1.6.0');
	const account_id = await db_run('INSERT INTO melvor_accounts (cloud_username, playfab_id, created_at) VALUES (?, ?, ?)',
		[`crucible-${crypto.randomUUID()}`, crypto.randomUUID(), Date.now()]);
	expect(account_id).toBe(1);
	const account = (await db_all<{ id: number }>('SELECT id FROM melvor_accounts ORDER BY id DESC LIMIT 1'))[0]!;
	await db_run('UPDATE clients SET melvor_account_id = ? WHERE id = ?', [account.id, client.client_id]);
	const first_clear = await post_json<{ success: boolean; level: number; receipt: { effects: unknown[] } }>(
		'/api/crucible/clear', { currency_id: 'melvorD:GP', balance: 1_001_000 }, client.session_token);
	expect(first_clear.json).toMatchObject({ success: true, level: 1 });
	const wish = await post_json<{ success: boolean; wish_id: number }>(
		'/api/crucible/wish/make', { item_id: 'melvorAoD:Torn_Parchment', qty: 1 }, client.session_token);
	expect(wish.json.success).toBe(true);
	const state = await get_json_with_session<{ level: number; wishes: Array<{ phase: string }> }>(
		'/api/crucible/contents', client.session_token);
	expect(state.json.level).toBe(-10);
	expect(state.json.wishes[0]?.phase).toBe('forming');
	const second_clear = await post_json<{ success: boolean; level: number }>(
		'/api/crucible/clear', { currency_id: 'melvorD:SlayerCoins', balance: 2_000 }, client.session_token);
	expect(second_clear.json).toMatchObject({ success: true, level: -9 });
	await db_run('UPDATE crucible_wishes SET required_gp = 2000, progress_gp = 1500 WHERE guild_id = ?',
		[client.guild_id]);
	const canceled = await post_json<{ success: boolean }>(
		'/api/crucible/wish/cancel', {}, client.session_token);
	expect(canceled.json.success).toBe(true);
	expect(await db_all<{ qty: number }>(
		'SELECT qty FROM crucible_offerings WHERE guild_id = ? AND item_id = ?',
		[client.guild_id, 'melvorD:Weird_Gloop'])).toEqual([{ qty: 2 }]);
	expect(await db_all<{ quantity: number; direction: string }>(
		'SELECT value.quantity, value.direction FROM audit_event_values AS value ' +
		'JOIN audit_events AS event ON event.id = value.event_id ' +
		'WHERE event.event_type = ? AND event.guild_id = ? AND value.object_id = ?',
		['crucible.wish_cancelled', client.guild_id, 'melvorD:Weird_Gloop']))
		.toEqual([{ quantity: 2, direction: 'create' }]);
	const after = await get_json_with_session<{ level: number; active_wish: boolean }>(
		'/api/crucible/contents', client.session_token);
	expect(after.json).toMatchObject({ level: -9, active_wish: false });
});

test('Council Purging targets only the captured Offering generation', async () => {
	const newer = await register_guild_client('Crucible Council', 'Crucible Council', '1.6.0');
	const cast = async (qty: number) => post_json<{ success: boolean }>('/api/crucible/cast', {
		command_id: crypto.randomUUID(), source: 'bank',
		items: [{ id: 'test:Council_Ore', qty, value_currency_id: 'melvorD:GP', value_per_item: 100 }]
	}, newer.session_token);
	expect((await cast(1)).json.success).toBe(true);
	const raised = await post_json<{ success: boolean; petition_id: number }>(
		'/api/guilds/petitions/raise', { type: 'crucible_purging' }, newer.session_token);
	expect(raised.json.success).toBe(true);
	expect((await cast(1)).json.success).toBe(true);
	const voted = await post_json<{ success: boolean; lifecycle: string }>(
		'/api/guilds/petitions/vote', { petition_id: raised.json.petition_id, choice: 'aye' },
		newer.session_token);
	expect(voted.json.lifecycle).toBe('granted');
	expect(await db_all<{ qty: number }>(
		'SELECT qty FROM crucible_offerings WHERE guild_id = ? AND item_id = ?',
		[newer.guild_id, 'test:Council_Ore'])).toEqual([{ qty: 2 }]);
	const council = await get_json_with_session<{ petitions: Array<{ type: string }> }>(
		'/api/guilds/council', newer.session_token);
	expect(council.json.petitions.some(petition => petition.type === 'crucible_purging')).toBe(true);
});
