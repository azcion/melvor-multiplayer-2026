import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import type { RegisteredClient } from '../support/http';
import { wait_for } from '../support/wait';
import { db_all, db_run } from '../support/persistence';

type MarketListing = {
	id: number;
	direction?: 'sell' | 'buy';
	item_id: string;
	available: number;
	reserved?: number;
	qty: number;
	price: number;
	payout?: number;
	escrow_gp?: number;
};

type MarketListings = {
	success: boolean;
	items: MarketListing[];
};

type MarketSearch = {
	success: boolean;
	total_items: number;
	page: number;
	items: Array<{
		id: number;
		direction?: 'sell' | 'buy';
		item_id: string;
		available: number;
		price: number;
		seller?: {
			display_name: string;
			icon_id: string;
		};
		buyer?: {
			display_name: string;
			icon_id: string;
		};
	}>;
};

async function get_listings(client: RegisteredClient): Promise<MarketListings> {
	const { response, json } = await get_json_with_session<MarketListings>(
		'/api/market/listings',
		client.session_token
	);
	if (!response.ok)
		throw new Error(`Market listings failed with ${response.status}`);

	return json;
}

async function wait_for_listing(
	client: RegisteredClient,
	item_id: string,
	accept: (listing: MarketListing) => boolean = () => true
): Promise<MarketListing> {
	const listings = await wait_for(
		() => get_listings(client),
		result => {
			const listing = result.items.find(item => item.item_id === item_id);
			return listing !== undefined && accept(listing);
		}
	);

	return listings.items.find(item => item.item_id === item_id) as MarketListing;
}

describe('market API', () => {
	test('reserves, counters, settles, and independently claims a Sell-listing Haggle', async () => {
		const pair = await make_guildmates('Haggle Buyer', 'Haggle Seller', 'Haggle Sell Guild');
		const [buyer, seller] = [pair.first, pair.second];
		const item_id = 'melvorD:Haggle_Apples';
		await post_json('/api/market/sell', { item_id, item_qty: 10, item_sell_price: 10,
			command_id: crypto.randomUUID() }, seller.session_token);
		const listing = await wait_for_listing(seller, item_id);
		const created = await post_json<{ success: boolean; receipt: { effects: unknown[] } }>('/api/market/haggle', {
			id: listing.id, qty: 5, price: 8, command_id: crypto.randomUUID()
		}, buyer.session_token);
		expect(created.json).toMatchObject({ success: true, receipt: { effects: [{ storage: 'gp', qty: -40 }] } });
		expect(await wait_for_listing(seller, item_id, row => row.available === 5)).toMatchObject({
			qty: 10, available: 5, reserved: 5
		});

		const owner_view = await get_json_with_session<{ haggles: Array<{ id: string; revision: number; is_turn: boolean }> }>(
			'/api/market/haggles', seller.session_token);
		const haggle = owner_view.json.haggles[0];
		expect(haggle.is_turn).toBe(true);
		const countered = await post_json<{ revision: number; receipt: { effects: unknown[] } }>(
			'/api/market/haggle/counter', { id: haggle.id, revision: haggle.revision, price: 9,
				command_id: crypto.randomUUID() }, seller.session_token);
		expect(countered.json).toMatchObject({ revision: 2, receipt: { effects: [] } });
		const buyer_view = await get_json_with_session<{ haggles: Array<{ id: string; revision: number; is_turn: boolean }> }>(
			'/api/market/haggles', buyer.session_token);
		const accepted = await post_json<{ success: boolean; receipt: { effects: unknown[] } }>(
			'/api/market/haggle/accept', { id: haggle.id, revision: buyer_view.json.haggles[0].revision,
				command_id: crypto.randomUUID() }, buyer.session_token);
		expect(accepted.json).toMatchObject({ success: true, receipt: { effects: [{ storage: 'gp', qty: -5 }] } });

		const settled_buyer = await get_json_with_session<{ haggles: Array<{ claim: { item_qty: number; gp: number } }> }>(
			'/api/market/haggles', buyer.session_token);
		const settled_seller = await get_json_with_session<{ haggles: Array<{ claim: { item_qty: number; gp: number } }> }>(
			'/api/market/haggles', seller.session_token);
		expect(settled_buyer.json.haggles[0].claim).toMatchObject({ item_qty: 5, gp: 0 });
		expect(settled_seller.json.haggles[0].claim).toMatchObject({ item_qty: 0, gp: 45 });
		await post_json('/api/market/haggle/claim', { id: haggle.id, command_id: crypto.randomUUID() }, buyer.session_token);
		await post_json('/api/market/haggle/claim', { id: haggle.id, command_id: crypto.randomUUID() }, seller.session_token);
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', buyer.session_token)).json.items).toEqual([{ item_id, qty: 5 }]);
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', seller.session_token)).json.items).toEqual([{ item_id: 'melvorD:GP', qty: 45 }]);
		const ordinary_payout = await post_json<{ payout: number }>('/api/market/payout', {
			id: listing.id, command_id: crypto.randomUUID()
		}, seller.session_token);
		expect(ordinary_payout.json.payout).toBe(0);
	});

	test('reserves Buy-order escrow and collects its accepted Haggle top-up', async () => {
		const pair = await make_guildmates('Haggle Order Owner', 'Haggle Order Seller', 'Haggle Buy Guild');
		const [owner, seller] = [pair.first, pair.second];
		const item_id = 'melvorD:Haggle_Ingots';
		await post_json('/api/market/buy-order', { item_id, item_qty: 10, item_buy_price: 10,
			command_id: crypto.randomUUID() }, owner.session_token);
		const listing = await wait_for_listing(owner, item_id);
		const created = await post_json<{ receipt: { effects: unknown[] } }>('/api/market/haggle', {
			id: listing.id, qty: 10, price: 15, command_id: crypto.randomUUID()
		}, seller.session_token);
		expect(created.json.receipt.effects).toEqual([{ storage: 'bank', item_id, qty: -10 }]);
		expect(await wait_for_listing(owner, item_id, row => row.available === 0)).toMatchObject({
			qty: 10, available: 0, reserved: 10, escrow_gp: 0
		});
		const view = await get_json_with_session<{ haggles: Array<{ id: string; revision: number }> }>(
			'/api/market/haggles', owner.session_token);
		const accepted = await post_json<{ receipt: { effects: unknown[] } }>('/api/market/haggle/accept', {
			id: view.json.haggles[0].id, revision: view.json.haggles[0].revision, command_id: crypto.randomUUID()
		}, owner.session_token);
		expect(accepted.json.receipt.effects).toEqual([{ storage: 'gp', qty: -50 }]);
	});

	test('limits initiations and restores reservations on cancellation and expiry', async () => {
		const pair = await make_guildmates('Haggle Limit Buyer', 'Haggle Limit Seller', 'Haggle Limit Guild');
		for (let index = 0; index < 5; index++)
			await post_json('/api/market/sell', { item_id: `melvorD:Haggle_Limit_${index}`, item_qty: 2,
				item_sell_price: 10 + index, command_id: crypto.randomUUID() }, pair.second.session_token);
		const listings = (await get_listings(pair.second)).items.filter(item => item.item_id.startsWith('melvorD:Haggle_Limit_'));
		for (const listing of listings.slice(0, 4)) {
			const result = await post_json<{ success: boolean }>('/api/market/haggle', {
				id: listing.id, qty: 1, price: 5, command_id: crypto.randomUUID()
			}, pair.first.session_token);
			expect(result.json.success).toBe(true);
		}
		const limited = await post_json<{ error_lang: string }>('/api/market/haggle', {
			id: listings[4].id, qty: 1, price: 5, command_id: crypto.randomUUID()
		}, pair.first.session_token);
		expect(limited.json.error_lang).toBe('MOD_MP_MARKET_HAGGLE_LIMIT');
		const view = await get_json_with_session<{ haggles: Array<{ id: string; revision: number }> }>(
			'/api/market/haggles', pair.first.session_token);
		await post_json('/api/market/haggle/terminate', { id: view.json.haggles[0].id,
			revision: view.json.haggles[0].revision, command_id: crypto.randomUUID() }, pair.first.session_token);
		const replacement = await post_json<{ success: boolean }>('/api/market/haggle', {
			id: listings[4].id, qty: 1, price: 5, command_id: crypto.randomUUID()
		}, pair.first.session_token);
		expect(replacement.json.success).toBe(true);
		const refreshed = await get_json_with_session<{ haggles: Array<{ id: string; status: string }> }>(
			'/api/market/haggles', pair.first.session_token);
		const expiring = refreshed.json.haggles.find(haggle => haggle.status === 'active') as { id: string };
		await db_run('UPDATE `market_haggles` SET `expires_at` = `updated_at` WHERE `id` = ?', [expiring.id]);
		const expired = await get_json_with_session<{ haggles: Array<{ id: string; status: string; claim: unknown }> }>(
			'/api/market/haggles', pair.first.session_token);
		expect(expired.json.haggles.find(haggle => haggle.id === expiring.id)).toMatchObject({ status: 'expired' });
	});

	test('cancels child Haggles when their Marketplace listing is cancelled', async () => {
		const pair = await make_guildmates('Haggle Cancel Buyer', 'Haggle Cancel Seller', 'Haggle Cancel Guild');
		const item_id = 'melvorD:Haggle_Cancel_Item';
		await post_json('/api/market/sell', { item_id, item_qty: 4, item_sell_price: 9,
			command_id: crypto.randomUUID() }, pair.second.session_token);
		const listing = await wait_for_listing(pair.second, item_id);
		await post_json('/api/market/haggle', { id: listing.id, qty: 3, price: 7,
			command_id: crypto.randomUUID() }, pair.first.session_token);
		const cancelled = await post_json<{ item_qty: number }>('/api/market/cancel', {
			id: listing.id, command_id: crypto.randomUUID()
		}, pair.second.session_token);
		expect(cancelled.json.item_qty).toBe(4);
		const haggles = await get_json_with_session<{ haggles: Array<{ status: string; claim: { gp: number } }> }>(
			'/api/market/haggles', pair.first.session_token);
		expect(haggles.json.haggles[0]).toMatchObject({ status: 'cancelled', claim: { gp: 21 } });
	});
	test('validates listings, allows modded items, and merges matching lots', async () => {
		const seller = await register_guild_client('Market Validation Seller');
		const nothing = await post_json<{ error_lang: string }>('/api/market/sell', {
			item_id: 'melvorD:Coal_Ore',
			item_qty: 0,
			item_sell_price: 5
		}, seller.session_token);
		const free = await post_json<{ error_lang: string }>('/api/market/sell', {
			item_id: 'melvorD:Coal_Ore',
			item_qty: 1,
			item_sell_price: 0
		}, seller.session_token);
		const fractional_quantity = await post('/api/market/sell', {
			item_id: 'melvorD:Coal_Ore', item_qty: 0.5, item_sell_price: 5
		}, seller.session_token);
		const fractional_price = await post('/api/market/sell', {
			item_id: 'melvorD:Coal_Ore', item_qty: 1, item_sell_price: 0.5
		}, seller.session_token);
		const fractional_buy = await post('/api/market/buy', { id: 1, qty: 0.5 }, seller.session_token);
		const modded = await post_json<{ success: boolean }>('/api/market/sell', {
			item_id: 'exampleMod:Coal_Ore',
			item_qty: 1,
			item_sell_price: 5
		}, seller.session_token);
		const empty_id = await post('/api/market/sell', {
			item_id: '',
			item_qty: 1,
			item_sell_price: 5
		}, seller.session_token);
		const malformed_id = await post('/api/market/sell', {
			item_id: 'not-namespaced',
			item_qty: 1,
			item_sell_price: 5
		}, seller.session_token);
		const too_long_id = await post('/api/market/sell', {
			item_id: 'exampleMod:' + 'x'.repeat(246),
			item_qty: 1,
			item_sell_price: 5
		}, seller.session_token);

		expect(nothing.json.error_lang).toBe('MOD_MP_MARKET_CANNOT_SELL_NOTHING');
		expect(free.json.error_lang).toBe('MOD_MP_MARKET_CANNOT_SELL_FREE');
		expect(fractional_quantity.status).toBe(400);
		expect(fractional_price.status).toBe(400);
		expect(fractional_buy.status).toBe(400);
		expect(modded.json.success).toBe(true);
		expect(empty_id.status).toBe(400);
		expect(malformed_id.status).toBe(400);
		expect(too_long_id.status).toBe(400);
		const modded_listing = await wait_for_listing(seller, 'exampleMod:Coal_Ore');
		await post_json('/api/market/cancel', { id: modded_listing.id }, seller.session_token);

		await post_json('/api/market/sell', {
			item_id: 'melvorD:Validation_Ore',
			item_qty: 1,
			item_sell_price: 5
		}, seller.session_token);
		await wait_for_listing(seller, 'melvorD:Validation_Ore', listing => listing.qty === 1);
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Validation_Ore',
			item_qty: 2,
			item_sell_price: 5
		}, seller.session_token);
		const merged = await wait_for_listing(
			seller,
			'melvorD:Validation_Ore',
			listing => listing.qty === 3
		);

		expect(merged).toMatchObject({
			item_id: 'melvorD:Validation_Ore',
			qty: 3,
			available: 3,
			price: 5,
			payout: 0
		});
		expect((await get_listings(seller)).items).toHaveLength(1);

		await post_json('/api/market/cancel', { id: merged.id }, seller.session_token);
	});

	test('searches, buys, pays out, completes, and cancels market lots', async () => {
		const pair = await make_guildmates('Market Seller', 'Market Buyer');
		const [seller, buyer] = [pair.first, pair.second];
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Lifecycle_Ore',
			item_qty: 10,
			item_sell_price: 5
		}, seller.session_token);
		const lot = await wait_for_listing(seller, 'melvorD:Lifecycle_Ore');
		const search = await post_json<MarketSearch>('/api/market/search', {
			item_id: 'melvorD:Lifecycle_Ore',
			sort: 1,
			page: 1
		}, buyer.session_token);
		const self_purchase = await post_json<{ error_lang: string }>('/api/market/buy', {
			id: lot.id,
			qty: 1
		}, seller.session_token);

		expect(search.json.total_items).toBe(1);
		expect(search.json.items).toEqual([{
			id: lot.id,
			item_id: 'melvorD:Lifecycle_Ore',
			available: 10,
			price: 5,
			direction: 'sell',
			seller: {
				display_name: 'Market Seller',
				icon_id: seller.icon_id
			}
		}]);
		expect(self_purchase.json.error_lang).toBe('MOD_MP_MARKET_BUY_ERROR_SELF');

		const partial = await post_json<{
			success: boolean;
			item_id: string;
			item_qty: number;
			gp_loss: number;
			new_item_qty: number;
		}>('/api/market/buy', {
			id: lot.id,
			qty: 4
		}, buyer.session_token);
		const unauthorized_payout = await post('/api/market/payout', {
			id: lot.id
		}, buyer.session_token);
		const first_payout = await post_json<{
			success: boolean;
			payout: number;
			ended: boolean;
		}>('/api/market/payout', {
			id: lot.id
		}, seller.session_token);

		expect(partial.json).toEqual({
			success: true,
			item_id: 'melvorD:Lifecycle_Ore',
			item_qty: 4,
			gp_loss: 20,
			new_item_qty: 6
		});
		expect(unauthorized_payout.status).toBe(400);
		expect(first_payout.json).toEqual({ success: true, payout: 20, ended: false });

		const final = await post_json<{
			success: boolean;
			item_qty: number;
			new_item_qty: number;
		}>('/api/market/buy', {
			id: lot.id,
			qty: 100
		}, buyer.session_token);

		expect(final.json.item_qty).toBe(6);
		expect(final.json.new_item_qty).toBe(0);
		expect((await get_events(seller)).market_completed).toEqual([lot.id]);

		const sold_out_search = await post_json<MarketSearch>('/api/market/search', {
			item_id: 'melvorD:Lifecycle_Ore',
			sort: 1,
			page: 1
		}, buyer.session_token);
		const completed_listing = await wait_for_listing(
			seller,
			'melvorD:Lifecycle_Ore',
			listing => listing.available === 0
		);

		expect(sold_out_search.json.total_items).toBe(0);
		expect(sold_out_search.json.items).toEqual([]);
		expect(completed_listing).toMatchObject({
			id: lot.id,
			available: 0,
			payout: 20
		});

		const final_payout = await post_json<{
			success: boolean;
			payout: number;
			ended: boolean;
		}>('/api/market/payout', {
			id: lot.id
		}, seller.session_token);

		expect(final_payout.json).toEqual({ success: true, payout: 30, ended: true });
		expect((await get_events(seller)).market_completed).toEqual([]);
		expect((await get_listings(seller)).items).toEqual([]);

		await post_json('/api/market/sell', {
			item_id: 'melvorD:Cancelled_Ore',
			item_qty: 5,
			item_sell_price: 4
		}, seller.session_token);
		const cancelled_lot = await wait_for_listing(seller, 'melvorD:Cancelled_Ore');
		await post_json('/api/market/buy', {
			id: cancelled_lot.id,
			qty: 2
		}, buyer.session_token);
		const cancelled = await post_json<{
			success: boolean;
			item_id: string;
			item_qty: number;
			payout: number;
		}>('/api/market/cancel', {
			id: cancelled_lot.id
		}, seller.session_token);

		expect(cancelled.json).toEqual({
			success: true,
			item_id: 'melvorD:Cancelled_Ore',
			item_qty: 3,
			payout: 8
		});
		expect((await get_listings(seller)).items).toEqual([]);
	});

	test('creates, merges, fulfills, and refunds prepaid buy orders', async () => {
		const pair = await make_guildmates('Market Buy Order Buyer', 'Market Buy Order Seller');
		const [buyer, seller] = [pair.first, pair.second];
		const item_id = 'melvorD:Prepaid_Buy_Order_Item';
		const create = await post_json<{
			success: boolean;
			receipt: { id: string; kind: string; effects: Array<Record<string, unknown>> };
		}>('/api/market/buy-order', {
			command_id: crypto.randomUUID(), item_id, item_qty: 10, item_buy_price: 5
		}, buyer.session_token);
		await post_json('/api/economy/receipts/acknowledge', {
			receipt_id: create.json.receipt.id
		}, buyer.session_token);
		const merged = await post_json<{ receipt: { id: string } }>('/api/market/buy-order', {
			command_id: crypto.randomUUID(), item_id, item_qty: 2, item_buy_price: 5
		}, buyer.session_token);
		await post_json('/api/economy/receipts/acknowledge', {
			receipt_id: merged.json.receipt.id
		}, buyer.session_token);

		const order = await wait_for_listing(buyer, item_id, listing =>
			listing.direction === 'buy' && listing.qty === 12 && listing.available === 12
		);
		expect(order).toMatchObject({
			direction: 'buy',
			item_id,
			qty: 12,
			available: 12,
			price: 5,
			escrow_gp: 60
		});

		const search = await post_json<MarketSearch>('/api/market/search', {
			direction: 'buy', item_id, sort: 0, page: 1
		}, seller.session_token);
		expect(search.json.items).toEqual([{
			id: order.id,
			item_id,
			available: 12,
			price: 5,
			direction: 'buy',
			buyer: { display_name: buyer.display_name, icon_id: buyer.icon_id }
		}]);

		const self = await post_json<{ error_lang: string }>('/api/market/fulfill', {
			command_id: crypto.randomUUID(), id: order.id, qty: 1
		}, buyer.session_token);
		expect(self.json.error_lang).toBe('MOD_MP_MARKET_FULFILL_ERROR_INVALID');

		const fulfilled = await post_json<{
			success: boolean;
			item_qty: number;
			new_item_qty: number;
			gp_gain: number;
			receipt: { effects: Array<Record<string, unknown>> };
		}>('/api/market/fulfill', {
			command_id: crypto.randomUUID(), id: order.id, qty: 5
		}, seller.session_token);
		expect(fulfilled.json).toMatchObject({
			success: true, item_qty: 5, new_item_qty: 7, gp_gain: 25,
			receipt: { effects: [
				{ storage: 'bank', item_id, qty: -5 }
			] }
		});

		const buyer_inbox = await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', buyer.session_token
		);
		expect(buyer_inbox.json.items).toEqual([{ item_id, qty: 5 }]);
		const seller_inbox = await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', seller.session_token
		);
		expect(seller_inbox.json.items).toEqual([{ item_id: 'melvorD:GP', qty: 25 }]);

		const remaining = await wait_for_listing(buyer, item_id, listing =>
			listing.direction === 'buy' && listing.available === 7 && listing.escrow_gp === 35
		);
		expect(remaining.escrow_gp).toBe(35);

		const cancelled = await post_json<{
			success: boolean;
			gp_refund: number;
			receipt: { id: string; effects: Array<Record<string, unknown>> };
		}>('/api/market/cancel', { id: remaining.id, command_id: crypto.randomUUID() }, buyer.session_token);
		expect(cancelled.json).toMatchObject({
			success: true,
			gp_refund: 35,
			receipt: { effects: [] }
		});
		await post_json('/api/economy/receipts/acknowledge', {
			receipt_id: cancelled.json.receipt.id
		}, buyer.session_token);
		expect((await get_listings(buyer)).items).toEqual([]);
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', buyer.session_token
		)).json.items).toEqual([
			{ item_id: 'melvorD:GP', qty: 35 },
			{ item_id, qty: 5 }
		]);
	});

	test('removes a fully fulfilled buy order and keeps the buyer delivery durable', async () => {
		const pair = await make_guildmates('Complete Buy Order Buyer', 'Complete Buy Order Seller');
		const [buyer, seller] = [pair.first, pair.second];
		const item_id = 'melvorD:Complete_Buy_Order_Item';
		const created = await post_json<{ receipt: { id: string } }>('/api/market/buy-order', {
			command_id: crypto.randomUUID(), item_id, item_qty: 3, item_buy_price: 9
		}, buyer.session_token);
		await post_json('/api/economy/receipts/acknowledge', {
			receipt_id: created.json.receipt.id
		}, buyer.session_token);
		const order = await wait_for_listing(buyer, item_id, listing => listing.direction === 'buy');
		const fulfilled = await post_json<{ new_item_qty: number; receipt: { id: string } }>('/api/market/fulfill', {
			command_id: crypto.randomUUID(), id: order.id, qty: 3
		}, seller.session_token);
		expect(fulfilled.json.new_item_qty).toBe(0);
		expect((await get_listings(buyer)).items).toEqual([]);
		expect((await get_events(buyer)).economy_receipts.some(receipt => receipt.kind === 'market-fulfill')).toBe(false);
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', buyer.session_token
		)).json.items).toEqual([{ item_id, qty: 3 }]);
	});

	test('sorts, filters, and paginates market searches', async () => {
		const pair = await make_guildmates('Market Pagination Seller', 'Market Pagination Buyer');
		const [seller, buyer] = [pair.first, pair.second];
		await Promise.all(Array.from({ length: 31 }, (_, index) => post_json('/api/market/sell', {
			item_id: `melvorD:Pagination_Item_${index + 1}`,
			item_qty: 1,
			item_sell_price: index + 1
		}, seller.session_token)));
		await wait_for(
			() => get_listings(seller),
			listings => listings.items.length === 31
		);

		const descending = await post_json<MarketSearch>('/api/market/search', {
			sort: 0,
			page: 1
		}, buyer.session_token);
		const second_page = await post_json<MarketSearch>('/api/market/search', {
			sort: 0,
			page: 2
		}, buyer.session_token);
		const filtered = await post_json<MarketSearch>('/api/market/search', {
			item_id: 'melvorD:Pagination_Item_16',
			sort: 1,
			page: 1
		}, buyer.session_token);
		const catalog = await post_json<{ success: boolean; item_ids: string[] }>('/api/market/catalog', {
			item_namespaces: ['melvorD']
		}, buyer.session_token);
		const exact_second_page = await post_json<MarketSearch>('/api/market/search', {
			item_namespaces: ['melvorD'],
			unresolved_item_ids: [],
			sort: 0,
			page: 2
		}, buyer.session_token);

		expect(descending.json.total_items).toBe(31);
		expect(descending.json.items).toHaveLength(30);
		expect(descending.json.items[0].price).toBe(31);
		expect(descending.json.items[29].price).toBe(2);
		expect(second_page.json.total_items).toBe(31);
		expect(second_page.json.items).toHaveLength(1);
		expect(second_page.json.items[0].price).toBe(1);
		expect(filtered.json.total_items).toBe(1);
		expect(filtered.json.items).toHaveLength(1);
		expect(filtered.json.items[0].item_id).toBe('melvorD:Pagination_Item_16');
		expect(catalog.json.item_ids).toHaveLength(31);
		expect(exact_second_page.json.total_items).toBe(31);
		expect(exact_second_page.json.page).toBe(2);
		expect(exact_second_page.json.items).toHaveLength(1);
		expect(exact_second_page.json.items[0].price).toBe(1);
	});

	test('sorts recent listings by their last update date', async () => {
		const pair = await make_guildmates('Recent Market Seller', 'Recent Market Buyer');
		const [seller, buyer] = [pair.first, pair.second];
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Recent_Market_First', item_qty: 1, item_sell_price: 5
		}, seller.session_token);
		const first = await wait_for_listing(seller, 'melvorD:Recent_Market_First');
		await db_run('UPDATE `market_items` SET `updated_at` = 1 WHERE `id` = ?', [first.id]);
		await new Promise(resolve => setTimeout(resolve, 5));
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Recent_Market_Second', item_qty: 1, item_sell_price: 6
		}, seller.session_token);
		const second = await wait_for_listing(seller, 'melvorD:Recent_Market_Second');
		await new Promise(resolve => setTimeout(resolve, 5));
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Recent_Market_First', item_qty: 1, item_sell_price: 5
		}, seller.session_token);

		const recent = await post_json<MarketSearch>('/api/market/search', {
			sort: 'recent', page: 1
		}, buyer.session_token);

		const first_timestamps = await db_all<{ published_at: number; updated_at: number | null }>(
			'SELECT `published_at`, `updated_at` FROM `market_items` WHERE `id` = ?', [first.id]
		);
		expect(recent.json.items.slice(0, 2).map(item => item.id)).toEqual([first.id, second.id]);
		expect(first_timestamps[0]?.updated_at).toBeGreaterThan(1);
	});

	test('destroys an owner listing into a non-bank return and pays accrued profit', async () => {
		const pair = await make_guildmates('Destroy Listing Seller', 'Destroy Listing Buyer');
		await post_json('/api/market/sell', {
			item_id: 'missingMod:Destroy_Item',
			item_qty: 5,
			item_sell_price: 7
		}, pair.first.session_token);
		const listing = await wait_for_listing(pair.first, 'missingMod:Destroy_Item');
		await post_json('/api/market/buy', { id: listing.id, qty: 2 }, pair.second.session_token);

		const unauthorized = await post('/api/market/destroy', { id: listing.id }, pair.second.session_token);
		const destroyed = await post_json<{
			success: boolean;
			item_id: string;
			item_qty: number;
			payout: number;
		}>('/api/market/destroy', { id: listing.id }, pair.first.session_token);

		expect(unauthorized.status).toBe(400);
		expect(destroyed.json).toEqual({
			success: true,
			item_id: 'missingMod:Destroy_Item',
			item_qty: 3,
			payout: 14
		});
		expect((await get_listings(pair.first)).items).toEqual([]);
	});

	test('filters market searches by the viewer item namespaces', async () => {
		const pair = await make_guildmates('Compatible Market Seller', 'Compatible Market Buyer');
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Compatible_Base_Item',
			item_qty: 1,
			item_sell_price: 5
		}, pair.first.session_token);
		await post_json('/api/market/sell', {
			item_id: 'exampleMod:Compatible_Modded_Item',
			item_qty: 1,
			item_sell_price: 6
		}, pair.first.session_token);
		await post_json('/api/market/sell', {
			item_id: 'some_mod:Compatible_Underscore_Item',
			item_qty: 1,
			item_sell_price: 7
		}, pair.first.session_token);
		await post_json('/api/market/sell', {
			item_id: 'someXmod:Wildcard_Match_Item',
			item_qty: 1,
			item_sell_price: 8
		}, pair.first.session_token);
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Unavailable_Version_Item',
			item_qty: 1,
			item_sell_price: 9
		}, pair.first.session_token);

		const base_only = await post_json<MarketSearch>('/api/market/search', {
			item_namespaces: ['melvorD'],
			sort: 1,
			page: 1
		}, pair.second.session_token);
		const compatible = await post_json<MarketSearch>('/api/market/search', {
			item_namespaces: ['melvorD', 'exampleMod'],
			sort: 1,
			page: 1
		}, pair.second.session_token);
		const escaped_namespace = await post_json<MarketSearch>('/api/market/search', {
			item_namespaces: ['some_mod'],
			sort: 1,
			page: 1
		}, pair.second.session_token);
		const catalog = await post_json<{ success: boolean; item_ids: string[] }>('/api/market/catalog', {
			item_namespaces: ['melvorD', 'exampleMod']
		}, pair.second.session_token);
		const exact = await post_json<MarketSearch>('/api/market/search', {
			item_namespaces: ['melvorD', 'exampleMod'],
			unresolved_item_ids: ['melvorD:Unavailable_Version_Item'],
			sort: 1,
			page: 1
		}, pair.second.session_token);
		const duplicate_ids = await post('/api/market/search', {
			item_namespaces: ['melvorD'],
			unresolved_item_ids: ['melvorD:Unavailable_Version_Item', 'melvorD:Unavailable_Version_Item'],
			page: 1
		}, pair.second.session_token);

		expect(base_only.json.items.map(item => item.item_id)).toEqual([
			'melvorD:Compatible_Base_Item',
			'melvorD:Unavailable_Version_Item'
		]);
		expect(compatible.json.items.map(item => item.item_id)).toEqual([
			'melvorD:Compatible_Base_Item',
			'exampleMod:Compatible_Modded_Item',
			'melvorD:Unavailable_Version_Item'
		]);
		expect(escaped_namespace.json.items.map(item => item.item_id)).toEqual([
			'some_mod:Compatible_Underscore_Item'
		]);
		expect(catalog.json.item_ids).toEqual([
			'exampleMod:Compatible_Modded_Item',
			'melvorD:Compatible_Base_Item',
			'melvorD:Unavailable_Version_Item'
		]);
		expect(exact.json.total_items).toBe(2);
		expect(exact.json.items.map(item => item.item_id)).toEqual([
			'melvorD:Compatible_Base_Item',
			'exampleMod:Compatible_Modded_Item'
		]);
		expect(duplicate_ids.status).toBe(400);
	});

	test('hides and rejects lots outside the buyer guild', async () => {
		const seller = await register_guild_client('Isolated Market Seller', 'Seller Guild');
		const outsider = await register_guild_client('Isolated Market Buyer', 'Buyer Guild');
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Isolated_Market_Item',
			item_qty: 1,
			item_sell_price: 5
		}, seller.session_token);
		const lot = await wait_for_listing(seller, 'melvorD:Isolated_Market_Item');

		const search = await post_json<MarketSearch>('/api/market/search', {
			sort: 1,
			page: 1
		}, outsider.session_token);
		const buy = await post_json<{ error_lang: string }>('/api/market/buy', {
			id: lot.id,
			qty: 1
		}, outsider.session_token);

		expect(search.json.total_items).toBe(0);
		expect(search.json.items).toEqual([]);
		expect(buy.json.error_lang).toBe('MOD_MP_MARKET_BUY_ERROR_INVALID');
	});
});

test('completion events exclude reservations and Haggle-only payouts, including cached transitions', async () => {
	const { first: seller, second: buyer } = await make_guildmates('Completion Seller', 'Completion Buyer');
	for (const direct_qty of [0, 2]) {
		const item_id = `melvorD:Haggle_Completion_${direct_qty}`;
		await post_json('/api/market/sell', { item_id, item_qty: 5, item_sell_price: 10 }, seller.session_token);
		const listing = await wait_for_listing(seller, item_id);
		expect((await get_events(seller)).market_completed).not.toContain(listing.id);
		const created = await post_json<{ haggle_id: string }>('/api/market/haggle', {
			id: listing.id, qty: 5 - direct_qty, price: 8, command_id: crypto.randomUUID()
		}, buyer.session_token);
		if (direct_qty > 0)
			await post_json('/api/market/buy', { id: listing.id, qty: direct_qty }, buyer.session_token);
		expect((await get_events(seller)).market_completed).not.toContain(listing.id);
		await post_json('/api/market/haggle/accept', {
			id: created.json.haggle_id, revision: 1, command_id: crypto.randomUUID()
		}, seller.session_token);
		const completed = (await get_events(seller)).market_completed;
		expect(completed.includes(listing.id)).toBe(direct_qty > 0);
		const payout = await post_json<{ payout: number }>('/api/market/payout', { id: listing.id }, seller.session_token);
		expect(payout.json.payout).toBe(direct_qty * 10);
		expect((await get_events(seller)).market_completed).not.toContain(listing.id);
	}
});
