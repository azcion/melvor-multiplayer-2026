import { test, expect } from 'bun:test';
import { make_guildmates, get_events } from '../support/fixtures';
import { get_json_with_session, get_with_session, post_json, request } from '../support/http';
import { db_all } from '../support/persistence';

type Feed = { entries: Array<{ id: number; event_type: string; source_name: string; reconstructed: boolean;
	items: Array<{ item_id: string; qty: number; direction: string }> }>; next_cursor: unknown };

test('Transfers history is authenticated, owner-scoped and retains replay-safe Gift lifecycle snapshots', async () => {
	const pair = await make_guildmates('History Sender', 'History Recipient', 'History Guild', { first: '1.6.3', second: '1.6.3' });
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
	const pair = await make_guildmates('History Trade Sender', 'History Trade Recipient', 'History Guild', { first: '1.6.3', second: '1.6.3' });
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
	const pair = await make_guildmates('History Haggle Buyer', 'History Haggle Seller', 'History Haggle Guild', { first: '1.6.3', second: '1.6.3' });
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
	const pair = await make_guildmates('Source A', 'Claim Owner', 'Sources', { first: '1.6.3', second: '1.6.3' });
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
	const pair = await make_guildmates('Context Buyer', 'Context Seller', 'Context Market', { first: '1.6.3', second: '1.6.3' });
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
