import { expect, test } from 'bun:test';
import { make_guildmates, register_guild_client, allow_alliance_preview } from '../support/fixtures';
import { get_json_with_session, post_json, register_client } from '../support/http';
import type { RegisteredClient } from '../support/http';
import { db_run, db_all } from '../support/persistence';

type Reply = { success: boolean; error_lang?: string; receipt?: { effects: unknown[] }; haggle_id?: string; items: Array<{ id: number; currency_id: string; buyable: number; price: number }>; haggles: Array<{ id: string; revision: number; currency_id: string }> };
const read = (client: RegisteredClient) => get_json_with_session<Reply>('/api/market/listings', client.session_token);
const send = (client: RegisteredClient, route: string, data: Record<string, unknown>) => post_json<Reply>(route, data, client.session_token);

test('new terms merge only matching lots, hide from 1.6.5, enforce limits and replay once', async () => {
	const pair = await make_guildmates('Terms Buyer', 'Terms Seller', 'Terms Guild', { first: '1.6.6', second: '1.6.6' });
	const data = { item_id: 'melvorD:Terms_Apple', item_qty: 10, item_sell_price: 7, currency_id: 'melvorD:SlayerCoins', purchase_limit: 3, allow_haggles: false };
	await send(pair.second, '/api/market/sell', data);
	await send(pair.second, '/api/market/sell', { ...data, item_qty: 2 });
	await send(pair.second, '/api/market/sell', { ...data, currency_id: 'melvorD:GP' });
	const lots = (await read(pair.second)).json.items;
	expect(lots.length).toBe(2);
	const lot = lots.find(row => row.currency_id === data.currency_id)!;
	const command_id = crypto.randomUUID();
	const buy = { id: lot.id, qty: 2, expected_currency_id: data.currency_id, expected_price: 7, command_id };
	const first = (await send(pair.first, '/api/market/buy', buy)).json;
	expect(first.receipt?.effects).toEqual([{ storage: 'bank', item_id: data.currency_id, qty: -14 }]);
	expect((await send(pair.first, '/api/market/buy', buy)).json).toEqual(first);
	const search = await send(pair.first, '/api/market/search', { item_id: data.item_id });
	expect(search.json.items.find(row => row.id === lot.id)?.buyable).toBe(1);
	expect((await send(pair.first, '/api/market/haggle', { id: lot.id, qty: 1, price: 4 })).json.success).toBe(false);
	await send(pair.first, '/api/market/buy', { ...buy, qty: 2, command_id: crypto.randomUUID() });
	expect((await send(pair.first, '/api/market/buy', { ...buy, command_id: crypto.randomUUID() })).json.error_lang).toBe('MOD_MP_MARKET_PURCHASE_LIMIT_REACHED');
	const legacy = await register_client('Terms Legacy', undefined, '1.6.5');
	await db_run('INSERT INTO guild_memberships(guild_id,client_id) VALUES(?,?)', [pair.guild_id, legacy.client_id]);
	expect((await send(legacy, '/api/market/search', { item_id: data.item_id })).json.items).toEqual([]);
	expect((await send(legacy, '/api/market/buy', { ...buy, command_id: crypto.randomUUID() })).json.success).not.toBe(true);
	expect((await send(legacy, '/api/market/catalog', { item_namespaces: ['melvorD'] })).json).toMatchObject({ item_ids: [] });
});

test('currency Haggles reserve purchase limits, refund on cancellation and settle exact currency', async () => {
	const pair = await make_guildmates('Currency Buyer', 'Currency Seller', 'Currency Guild', { first: '1.6.6', second: '1.6.6' });
	for (const currency_id of ['melvorD:SlayerCoins', 'melvorItA:AbyssalPieces', 'melvorItA:AbyssalSlayerCoins']) {
		await send(pair.second, '/api/market/sell', { item_id: 'melvorD:Terms_Haggle', item_qty: 10, item_sell_price: 7, currency_id, purchase_limit: 2 });
		const lot = (await read(pair.second)).json.items.find(row => row.currency_id === currency_id)!;
		const open = (await send(pair.first, '/api/market/haggle', { id: lot.id, qty: 2, price: 4, expected_currency_id: currency_id })).json;
		expect(open.receipt?.effects).toEqual([{ storage: 'bank', item_id: currency_id, qty: -8 }]);
		expect((await send(pair.first, '/api/market/buy', { id: lot.id, qty: 1, expected_price: 7, expected_currency_id: currency_id })).json.error_lang).toBe('MOD_MP_MARKET_PURCHASE_LIMIT_REACHED');
		await send(pair.first, '/api/market/haggle/terminate', { id: open.haggle_id, revision: 1 });
		await send(pair.first, '/api/market/haggle/claim', { id: open.haggle_id });
		const accepted = (await send(pair.first, '/api/market/haggle', { id: lot.id, qty: 2, price: 3, expected_currency_id: currency_id })).json;
		await send(pair.second, '/api/market/haggle/accept', { id: accepted.haggle_id, revision: 1 });
		await send(pair.second, '/api/market/haggle/claim', { id: accepted.haggle_id });
		expect((await send(pair.first, '/api/market/buy', { id: lot.id, qty: 1, expected_price: 7, expected_currency_id: currency_id })).json.error_lang).toBe('MOD_MP_MARKET_PURCHASE_LIMIT_REACHED');
		const seller = await db_all('SELECT SUM(qty) qty FROM inbox_items WHERE client_id=? AND item_id=?', [pair.second.client_id, currency_id]);
		expect(seller[0].qty).toBe(6);
	}
});


test('Alliance prices drive search, purchase receipts and payout accounting without duplicate proceeds', async () => {
	const pair = await make_guildmates('Price Guild Buyer', 'Price Seller', 'Price Guild', { first: '1.6.6', second: '1.6.6' });
	const outside = await register_guild_client('Price Ally', 'Price Ally Guild', '1.6.6');
	for (const client of [pair.first, pair.second, outside]) await allow_alliance_preview(client.client_id);
	const name = crypto.randomUUID().slice(0, 15);
	await db_run('INSERT INTO alliances(name,shared_marketplace,created_at) VALUES(?,1,?)', [name, Date.now()]);
	const alliance = (await db_all<{ id: number }>('SELECT id FROM alliances WHERE name=?', [name]))[0];
	for (const guild_id of [pair.guild_id, outside.guild_id])
		await db_run('INSERT INTO alliance_memberships(guild_id,alliance_id,joined_at) VALUES(?,?,?)', [guild_id, alliance.id, Date.now()]);
	await send(pair.second, '/api/market/sell', { item_id: 'melvorD:Terms_Alliance', item_qty: 10, item_sell_price: 10, alliance_price: 6 });
	const lot = (await read(pair.second)).json.items[0];
	expect((await send(pair.first, '/api/market/search', { item_id: 'melvorD:Terms_Alliance' })).json.items[0].price).toBe(10);
	expect((await send(outside, '/api/market/search', { item_id: 'melvorD:Terms_Alliance' })).json.items[0].price).toBe(6);
	expect((await send(outside, '/api/market/buy', { id: lot.id, qty: 2, expected_price: 10 })).json.error_lang).toBe('MOD_MP_MARKET_LISTING_CHANGED');
	const buy = (await send(outside, '/api/market/buy', { id: lot.id, qty: 2, expected_price: 6 })).json;
	expect(buy.receipt?.effects).toEqual([{ storage: 'gp', qty: -12 }]);
	await send(pair.second, '/api/market/payout', { id: lot.id });
	await send(pair.second, '/api/market/cancel', { id: lot.id });
	expect((await db_all('SELECT SUM(qty) qty FROM inbox_items WHERE client_id=? AND item_id=?', [pair.second.client_id, 'melvorD:GP']))[0].qty).toBe(12);
});

test('linked characters share a purchase limit under simultaneous requests, while legacy ordinary lots remain usable', async () => {
	const pair = await make_guildmates('Limit Buyer', 'Limit Seller', 'Limit Guild', { first: '1.6.6', second: '1.6.5' });
	const sibling = await register_client('Limit Sibling', undefined, '1.6.6');
	await db_run('INSERT INTO guild_memberships(guild_id,client_id) VALUES(?,?)', [pair.guild_id, sibling.client_id]);
	await allow_alliance_preview(pair.first.client_id); await allow_alliance_preview(sibling.client_id);
	await send(pair.second, '/api/market/sell', { item_id: 'melvorD:Terms_Legacy', item_qty: 3, item_sell_price: 1 });
	const ordinary = (await read(pair.second)).json.items[0];
	expect((await send(pair.first, '/api/market/buy', { id: ordinary.id, qty: 1 })).json.success).toBe(true);
	await send(pair.first, '/api/market/sell', { item_id: 'melvorD:Terms_Linked', item_qty: 5, item_sell_price: 1, purchase_limit: 2 });
	const limited = (await read(pair.first)).json.items.find(row => row.id !== ordinary.id)!;
	// Move ownership to the legacy seller solely to exercise two linked buyers against the same lot.
	await db_run('UPDATE market_items SET client_id=? WHERE id=?', [pair.second.client_id, limited.id]);
	const results = await Promise.all([pair.first, sibling].map(client => send(client, '/api/market/buy', { id: limited.id, qty: 2 })));
	expect(results.filter(row => row.json.success).length).toBe(1);
	expect(results.filter(row => row.json.error_lang === 'MOD_MP_MARKET_PURCHASE_LIMIT_REACHED').length).toBe(1);
});
