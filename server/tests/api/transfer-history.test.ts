import { test, expect } from 'bun:test';
import { make_guildmates, get_events } from '../support/fixtures';
import { get_json_with_session, get_with_session, post_json, request } from '../support/http';
import { db_all } from '../support/persistence';

type Feed = { entries: Array<{ id: number; event_type: string; source_name: string; reconstructed: boolean;
	items: Array<{ item_id: string; qty: number; direction: string }> }>; next_cursor: unknown };

test('Transfers history is authenticated, owner-scoped and retains replay-safe Gift lifecycle snapshots', async () => {
	const pair = await make_guildmates('History Sender', 'History Recipient', 'History Guild', { first: '1.6.14', second: '1.6.14' });
	expect((await request('/api/transfers/history?pane=inbox')).status).toBe(401);
	for (const query of ['pane=invalid', 'pane=inbox&before_at=1', 'pane=inbox&before_at=-1&before_id=2', 'pane=inbox&before_at=1&before_id=0'])
		expect((await get_with_session('/api/transfers/history?' + query, pair.first.session_token)).status).toBe(400);
	const payload = { recipient_id: pair.second_id, items: [{ id: 'melvorD:Coal_Ore', qty: 4 }], command_id: crypto.randomUUID() };
	await post_json('/api/gift/send', payload, pair.first.session_token);
	await post_json('/api/gift/send', payload, pair.first.session_token);
	const gift_id = (await get_events(pair.second)).gifts[0];
	await post_json('/api/gift/accept', { gift_id }, pair.second.session_token);
	const outbox = (await get_json_with_session<Feed>('/api/transfers/history?pane=outbox', pair.first.session_token)).json;
	expect(outbox.entries).toHaveLength(1);
	expect(outbox.entries[0]?.items).toEqual([{ item_id: 'melvorD:Coal_Ore', qty: 4, direction: 'out' }]);
	const pending = (await get_json_with_session<Feed>('/api/transfers/history?pane=pending', pair.second.session_token)).json;
	expect(pending.entries.map(row => row.event_type)).toEqual(['gift.accepted', 'gift.sent']);
	expect(pending.entries.every(row => row.source_name === pair.first.display_name && !row.reconstructed)).toBe(true);
	const incoming = (await get_json_with_session<Feed>('/api/transfers/history?pane=inbox', pair.second.session_token)).json;
	expect(incoming.entries[0]?.event_type).toBe('inbox.received');
	expect(incoming.entries[0]?.items[0]?.qty).toBe(4);
	expect((await get_json_with_session<Feed>('/api/transfers/history?pane=outbox&client_id=' + pair.first_id, pair.second.session_token)).json.entries).toEqual([]);
});

test('both Trade participants retain completion and item bundles after the active rows disappear', async () => {
	const pair = await make_guildmates('History Trade Sender', 'History Trade Recipient', 'History Guild', { first: '1.6.14', second: '1.6.14' });
	const offered = (await post_json<{ trade_id: number }>('/api/trade/offer', { recipient_id: pair.second_id,
		items: [{ id: 'melvorD:Coal_Ore', qty: 6 }] }, pair.first.session_token)).json;
	await post_json('/api/trade/counter', { trade_id: offered.trade_id, items: [{ id: 'melvorD:Raw_Shrimp', qty: 2 }] }, pair.second.session_token);
	await post_json('/api/trade/accept', { trade_id: offered.trade_id }, pair.first.session_token);
	expect(await db_all('SELECT 1 FROM trade_offers WHERE trade_id=?', [offered.trade_id])).toEqual([]);
	for (const player of [pair.first, pair.second]) {
		const history = (await get_json_with_session<Feed>('/api/transfers/history?pane=pending', player.session_token)).json;
		expect(history.entries.map(row => row.event_type)).toEqual(['trade-accept', 'trade-counter', 'trade-offer']);
		expect(history.entries[0]?.items.map(item => item.qty)).toEqual([6, 2]);
	}
});

test('Haggle counter, cancellation and claim history preserves each price snapshot', async () => {
	const pair = await make_guildmates('History Haggle Buyer', 'History Haggle Seller', 'History Haggle Guild', { first: '1.6.14', second: '1.6.14' });
	await post_json('/api/market/sell', { item_id: 'melvorD:Coal_Ore', item_qty: 4, item_sell_price: 9 }, pair.second.session_token);
	const listings = (await get_json_with_session<{ items: Array<{ id: number }> }>('/api/market/listings', pair.second.session_token)).json;
	const created = (await post_json<{ haggle_id: string }>('/api/market/haggle', { id: listings.items[0]!.id, qty: 2, price: 7 }, pair.first.session_token)).json;
	expect(created.haggle_id).toBeString();
	await post_json('/api/market/haggle/counter', { id: created.haggle_id, revision: 1, price: 8 }, pair.second.session_token);
	await post_json('/api/market/haggle/terminate', { id: created.haggle_id, revision: 2 }, pair.first.session_token);
	await post_json('/api/market/haggle/claim', { id: created.haggle_id }, pair.first.session_token);
	const feed = (await get_json_with_session<Feed>('/api/transfers/history?pane=pending', pair.first.session_token)).json;
	expect(feed.entries.map(row => row.event_type)).toEqual(['haggle.claimed', 'haggle.cancelled', 'haggle.countered', 'haggle.created']);
	expect(feed.entries.find(row => row.event_type === 'haggle.created')?.items[1]?.qty).toBe(14);
	expect(feed.entries.find(row => row.event_type === 'haggle.countered')?.items[1]?.qty).toBe(16);
});

test('claimed stacks retain each source after aggregation, acknowledgement and replay', async () => {
	const { db_run } = await import('../support/persistence');
	const pair = await make_guildmates('Source A', 'Claim Owner', 'Sources', { first: '1.6.14', second: '1.6.14' });
	const at = Date.now();
	for (const [type, name, qty] of [['gift_received', 'Source A', 10], ['market_bought', 'Source:B', 20]] as const)
		await db_run('INSERT INTO inbox_items(client_id,item_id,qty,source_type,source_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
			[pair.second_id, 'melvorD:Coal_Ore', qty, type, name, at, at]);
	const payload = { existing_item_ids: [], available_slots: 1 };
	const first = (await post_json<{ claim: { claim_id: string; items: unknown[] } }>('/api/inbox/claim', payload, pair.second.session_token)).json.claim;
	const replay = (await post_json<{ claim: unknown }>('/api/inbox/claim', payload, pair.second.session_token)).json.claim;
	expect(replay).toEqual(first);
	expect(first.items).toEqual([{ id: 'melvorD:Coal_Ore', qty: 30 }]);
	for (let i = 0; i < 2; i++) await post_json('/api/inbox/acknowledge', { claim_id: first.claim_id }, pair.second.session_token);
	const feed = (await get_json_with_session<any>('/api/transfers/history?pane=inbox', pair.second.session_token)).json;
	const claims = feed.entries.filter((row: any) => row.event_type === 'inbox.claimed');
	expect(claims).toHaveLength(1);
	expect(claims[0].items[0].sources).toEqual([
		{ source_type: 'gift_received', source_name: 'Source A', qty: 10 },
		{ source_type: 'market_bought', source_name: 'Source:B', qty: 20 }
	]);
	expect(await db_all('SELECT 1 FROM inbox_items WHERE client_id=?', [pair.second_id])).toEqual([]);
	expect((await get_json_with_session<Feed>('/api/transfers/history?pane=inbox', pair.first.session_token)).json.entries).toEqual([]);
});

test('Marketplace destinations snapshot the counterparty and survive receipt replay and rename', async () => {
	const { db_run } = await import('../support/persistence');
	const pair = await make_guildmates('Context Buyer', 'Context Seller', 'Context Market', { first: '1.6.14', second: '1.6.14' });
	await post_json('/api/market/sell', { item_id: 'melvorD:Coal_Ore', item_qty: 4, item_sell_price: 9 }, pair.second.session_token);
	const listings = (await get_json_with_session<{ items: Array<{ id: number }> }>('/api/market/listings', pair.second.session_token)).json;
	const body = { id: listings.items[0]!.id, qty: 2, command_id: crypto.randomUUID() };
	await post_json('/api/market/buy', body, pair.first.session_token);
	await db_run('UPDATE clients SET display_name=? WHERE id=?', ['Changed Seller', pair.second_id]);
	await post_json('/api/market/buy', body, pair.first.session_token);
	const feed = (await get_json_with_session<any>('/api/transfers/history?pane=outbox', pair.first.session_token)).json;
	expect(feed.entries).toHaveLength(1);
	expect(feed.entries[0].source_type).toBe('market');
	expect(feed.entries[0].source_name).toBe('Context Seller');
	expect(feed.entries[0].items).toEqual([{ item_id: 'melvorD:GP', qty: 18, direction: 'out' }]);
});

test('sell-listing exchanges preserve both halves, actual currencies, partial quantities and replay', async () => {
	const { db_run } = await import('../support/persistence');
	const pair = await make_guildmates('Exchange Buyer', 'Exchange Seller', 'Exchange Market', { first: '1.6.14', second: '1.6.14' });
	const read = async (player: typeof pair.first, pane: string) =>
		(await get_json_with_session<any>('/api/transfers/history?pane=' + pane, player.session_token)).json.entries;
	for (const currency_id of ['melvorD:GP', 'melvorD:SlayerCoins', 'melvorItA:AbyssalPieces', 'melvorItA:AbyssalSlayerCoins']) {
		await post_json('/api/market/sell', { item_id: 'melvorD:Coal_Ore', item_qty: 4, item_sell_price: 9, currency_id }, pair.second.session_token);
		const lots = (await get_json_with_session<any>('/api/market/listings', pair.second.session_token)).json.items;
		const lot = lots.find((row: any) => row.currency_id === currency_id);
		const body = { id: lot.id, qty: 2, expected_currency_id: currency_id, expected_price: 9, command_id: crypto.randomUUID() };
		const first = (await post_json<any>('/api/market/buy', body, pair.first.session_token)).json;
		expect(first.success).toBe(true);
		expect(first.history_exchange).toBeUndefined();
		expect(first.history_name).toBeUndefined();
		expect(first.receipt.effects).toEqual([currency_id === 'melvorD:GP'
			? { storage: 'gp', qty: -18 } : { storage: 'bank', item_id: currency_id, qty: -18 }]);
		expect((await post_json<any>('/api/market/buy', body, pair.first.session_token)).json).toEqual(first);
		const out = (await read(pair.first, 'outbox')).find((row: any) => row.items[0]?.item_id === currency_id);
		expect(out.exchange).toEqual({ label: 'purchased', item_id: 'melvorD:Coal_Ore', qty: 2 });
		expect(out.items).toEqual([{ item_id: currency_id, qty: 18, direction: 'out' }]);
		const incoming = (await read(pair.first, 'inbox')).filter((row: any) => row.exchange?.item_id === currency_id);
		expect(incoming).toHaveLength(1);
		expect(incoming[0].exchange).toEqual({ label: 'paid', item_id: currency_id, qty: 18 });
		expect(incoming[0].items).toEqual([{ item_id: 'melvorD:Coal_Ore', qty: 2, direction: 'in' }]);
		const proceeds = (await read(pair.second, 'inbox')).find((row: any) => row.items[0]?.item_id === currency_id);
		expect(proceeds.exchange).toEqual({ label: 'sold', item_id: 'melvorD:Coal_Ore', qty: 2 });
		expect(proceeds.items).toEqual([{ item_id: currency_id, qty: 18, direction: 'in' }]);
		expect(proceeds.source_name).toBe('Exchange Buyer');
		await post_json('/api/economy/receipts/acknowledge', { receipt_id: body.command_id }, pair.first.session_token);
		await post_json('/api/market/buy', body, pair.first.session_token);
		expect((await read(pair.first, 'inbox')).filter((row: any) => row.exchange?.item_id === currency_id)).toHaveLength(1);
	}
	await db_run('UPDATE clients SET display_name=? WHERE id=?', ['Renamed seller', pair.second_id]);
	expect((await read(pair.first, 'outbox')).every((row: any) => row.source_name === 'Exchange Seller')).toBe(true);
	expect((await read(pair.first, 'inbox')).every((row: any) => row.source_name === 'Exchange Seller')).toBe(true);
	const claim = (await post_json<any>('/api/inbox/claim', { existing_item_ids: [], available_slots: 1 }, pair.first.session_token)).json.claim;
	await post_json('/api/inbox/acknowledge', { claim_id: claim.claim_id }, pair.first.session_token);
	const claimed = (await read(pair.first, 'inbox')).find((row: any) => row.event_type === 'inbox.claimed');
	expect(claimed.exchange).toBeUndefined();
	expect(claimed.items[0].qty).toBe(8);
	expect(claimed.items[0].sources).toEqual([{ source_type: 'market_bought', source_name: 'Exchange Seller', qty: 8 }]);
	expect((await read(pair.first, 'inbox')).filter((row: any) => row.event_type === 'inbox.received')).toHaveLength(4);
});

test('buy-order fulfillments snapshot actual quantities and payments for both participants after deletion', async () => {
	const pair = await make_guildmates('Order Buyer', 'Order Seller', 'Order Exchange', { first: '1.6.14', second: '1.6.14' });
	const read = async (player: typeof pair.first, pane: string) =>
		(await get_json_with_session<any>('/api/transfers/history?pane=' + pane, player.session_token)).json.entries;
	await post_json('/api/market/buy-order', { item_id: 'melvorD:Coal_Ore', item_qty: 5, item_buy_price: 7 }, pair.first.session_token);
	const lot = (await get_json_with_session<any>('/api/market/listings', pair.first.session_token)).json.items[0];
	for (const [requested, actual] of [[2, 2], [20, 3]]) {
		const body = { id: lot.id, qty: requested, command_id: crypto.randomUUID() };
		const reply = (await post_json<any>('/api/market/fulfill', body, pair.second.session_token)).json;
		expect(reply.receipt.effects).toEqual([{ storage: 'bank', item_id: 'melvorD:Coal_Ore', qty: -actual }]);
		await post_json('/api/market/fulfill', body, pair.second.session_token);
		const out = (await read(pair.second, 'outbox'))[0];
		expect(out.exchange).toEqual({ label: 'proceeds', item_id: 'melvorD:GP', qty: actual! * 7 });
		expect(out.source_name).toBe('Order Buyer');
		expect((await read(pair.first, 'inbox'))[0].exchange).toEqual({ label: 'paid', item_id: 'melvorD:GP', qty: actual! * 7 });
		expect((await read(pair.first, 'inbox'))[0].items).toEqual([{ item_id: 'melvorD:Coal_Ore', qty: actual, direction: 'in' }]);
		expect((await read(pair.second, 'inbox'))[0].exchange).toEqual({ label: 'sold', item_id: 'melvorD:Coal_Ore', qty: actual });
	}
	await post_json('/api/market/cancel', { id: lot.id }, pair.first.session_token);
	expect((await read(pair.first, 'inbox')).filter((row: any) => row.exchange)).toHaveLength(2);
	expect((await read(pair.second, 'inbox')).filter((row: any) => row.exchange)).toHaveLength(2);
	expect((await read(pair.first, 'outbox')).find((row: any) => row.event_type === 'market-buy-order').exchange).toBeUndefined();
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?', [pair.first_id, 'melvorD:Coal_Ore'])).toEqual([{ qty: 5 }]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?', [pair.second_id, 'melvorD:GP'])).toEqual([{ qty: 35 }]);
});
