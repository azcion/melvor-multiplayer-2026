import { expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

test('viewer filters affect Sell Listings and catalog counts, leaving Buy Orders and other viewers intact', async () => {
	const pair = await make_guildmates('Filter Seller', 'Filter Viewer', 'Listing Filter Guild', { first: '1.6.14', second: '1.6.14' });
	const item_id = 'melvorD:Filter_Logs';
	await post_json('/api/market/sell', { item_id, item_qty: 5, item_sell_price: 5 }, pair.first.session_token);
	await post_json('/api/market/buy-order', { item_id, item_qty: 5, item_buy_price: 5 }, pair.first.session_token);
	await db_run('UPDATE clients SET cheats_detected_at=? WHERE id=?', [Date.now(), pair.first_id]);
	const search = (direction: string, listing_filters?: string[]) => post_json<any>('/api/market/search',
		{ item_id, direction, page: 50, listing_filters }, pair.second.session_token);
	expect((await search('sell')).json.total_items).toBe(1);
	expect((await search('sell', ['items'])).json).toMatchObject({ items: [], total_items: 0, page: 1 });
	expect((await search('buy', ['items'])).json.total_items).toBe(1);
	expect((await search('sell', ['multitasking'])).json.total_items).toBe(1);
	const catalog = (direction: string, listing_filters: string[]) => post_json<any>('/api/market/catalog',
		{ direction, listing_filters, item_namespaces: ['melvorD'] }, pair.second.session_token);
	expect((await catalog('sell', ['items'])).json.item_ids).not.toContain(item_id);
	expect((await catalog('buy', ['items'])).json.item_ids).toContain(item_id);
	expect((await catalog('sell', [])).json.item_ids).toContain(item_id);
	expect((await post('/api/market/search', { listing_filters: ['unknown'] }, pair.second.session_token)).status).toBe(400);
	await db_run('UPDATE clients SET cheats_detected_at=? WHERE id=?', [Date.now() - 8 * 86400000, pair.first_id]);
	expect((await search('sell', ['items'])).json.total_items).toBe(1);
});

test('mixed Crucible stacks display and reclaim only unfiltered lots with safe replay', async () => {
	const pair = await make_guildmates('Filtered Caster', 'Clean Caster', 'Crucible Filters', { first: '1.6.14', second: '1.6.14' });
	const item_id = 'test:Filtered_Crucible_Ore';
	for (const [client, qty] of [[pair.first, 5], [pair.second, 3]] as const) {
		const result = await post_json<any>('/api/crucible/cast', { command_id: crypto.randomUUID(), source: 'bank',
			items: [{ id: item_id, qty, value_currency_id: 'melvorD:GP', value_per_item: 1 }] }, client.session_token);
		expect(result.json.success).toBe(true);
	}
	await db_run('UPDATE clients SET cheats_detected_at=? WHERE id=?', [Date.now(), pair.first_id]);
	const contents = async (filter: string) => (await get_json_with_session<any>(
		'/api/crucible/contents?listing_filters=' + filter, pair.second.session_token)).json;
	const original = await contents('');
	const filtered = await contents('items');
	expect(original.offerings.find((row: any) => row.item_id === item_id).qty).toBe(8);
	expect(filtered.offerings.find((row: any) => row.item_id === item_id)).toMatchObject({ qty: 3,
		contributors: [{ client_id: pair.second_id }] });
	expect(filtered.heat).toEqual(original.heat);
	const summary = await get_json_with_session<any>('/api/events?summaries=1&listing_filters=items', pair.second.session_token);
	expect(summary.json.crucible_summary.offerings).toContainEqual({ id: item_id, qty: 3 });
	const reclaim = (qty: number, command_id: string) => post_json<any>('/api/crucible/reclaim',
		{ item_id, qty, command_id, listing_filters: ['items'] }, pair.second.session_token);
	expect((await reclaim(4, crypto.randomUUID())).json.success).toBe(false);
	const command_id = crypto.randomUUID();
	const result = await reclaim(2, command_id);
	expect(result.json.success).toBe(true);
	// Changing the filter after success must still replay the exact committed command.
	await db_run('UPDATE clients SET cheats_detected_at=NULL WHERE id=?', [pair.first_id]);
	expect((await reclaim(2, command_id)).json).toEqual(result.json);
	expect(await db_all('SELECT lot.client_id, lot.qty FROM crucible_contribution_lots lot ' +
		'JOIN crucible_offerings o ON o.id=lot.offering_id WHERE o.guild_id=? AND o.item_id=? ORDER BY lot.client_id',
		[pair.guild_id, item_id])).toEqual([{ client_id: pair.first_id, qty: 5 }, { client_id: pair.second_id, qty: 1 }]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?', [pair.second_id, item_id])).toEqual([{ qty: 2 }]);
	await post_json('/api/economy/receipts/acknowledge', { receipt_id: command_id }, pair.second.session_token);
	expect((await reclaim(2, command_id)).json).toMatchObject({ success: true, receipt: null });
});


test('filter prompt eligibility and acknowledgement persist across authentication without affecting other identities', async () => {
	const first = await register_client('Prompt First', undefined, '1.6.14');
	const unrelated = await register_client('Prompt Unlinked', undefined, '1.6.14');
	const pending = async (client: typeof first) => (await get_json_with_session<{ pending: boolean }>(
		'/api/listing-filters/prompt', client.session_token)).json.pending;
	expect(await pending(first)).toBe(true);
	for (let i = 0; i < 2; i++)
		expect((await post_json<{ success: boolean }>('/api/listing-filters/prompt/acknowledge', {}, first.session_token)).json.success).toBe(true);
	expect(await pending(first)).toBe(false);
	expect(await pending(unrelated)).toBe(true);
	const auth = await post_json<{ listing_filter_prompt_pending: boolean }>('/api/authenticate', {
		client_identifier: first.client_identifier, client_key: first.client_key,
		client_runtime: { mod_version: '1.6.14', active_mods: [] }
	});
	expect(auth.json.listing_filter_prompt_pending).toBe(false);
});
