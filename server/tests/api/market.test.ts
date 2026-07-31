import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import type { RegisteredClient } from '../support/http';
import { wait_for } from '../support/wait';

type MarketListing = {
	id: number;
	item_id: string;
	available: number;
	qty: number;
	price: number;
	payout: number;
};

type MarketListings = {
	success: boolean;
	items: MarketListing[];
};

type MarketSearch = {
	success: boolean;
	total_items: number;
	items: Array<{
		id: number;
		item_id: string;
		available: number;
		price: number;
		seller: {
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
	test('validates listings, truncates quantities, and merges matching lots', async () => {
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
		const modded = await post_json<{ error_lang: string }>('/api/market/sell', {
			item_id: 'exampleMod:Coal_Ore',
			item_qty: 1,
			item_sell_price: 5
		}, seller.session_token);

		expect(nothing.json.error_lang).toBe('MOD_MP_MARKET_CANNOT_SELL_NOTHING');
		expect(free.json.error_lang).toBe('MOD_MP_MARKET_CANNOT_SELL_FREE');
		expect(modded.json.error_lang).toBe('MOD_MP_MARKET_CANNOT_SELL_MODDED');

		await post_json('/api/market/sell', {
			item_id: 'melvorD:Validation_Ore',
			item_qty: 1.9,
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
