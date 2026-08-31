import { describe, expect, test } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, request } from '../support/http';
import { db_count, db_run } from '../support/persistence';

type ActivityEvent = {
	id: number;
	event_type: string;
	actor_client_id: number | null;
	actor_display_name: string | null;
	metadata: Record<string, string | number>;
	created_at: number;
	private: boolean;
};

async function activity(session_token: string, cursor?: string) {
	return get_json_with_session<{ events: ActivityEvent[]; next_cursor: string | null }>(
		`/api/guilds/activity${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
		session_token
	);
}

async function market_listings(session_token: string) {
	return get_json_with_session<{ items: Array<{
		id: number;
		direction: 'sell' | 'buy';
		item_id: string;
	}> }>('/api/market/listings', session_token);
}

describe('Guild Activity', () => {
	test('records membership transitions with historical name snapshots and Guild isolation', async () => {
		const pair = await make_guildmates('Activity Founder', 'Activity Member', 'Activity Guild');
		const outsider = await register_guild_client('Activity Outsider', 'Other Activity Guild');
		await db_run('UPDATE `clients` SET `display_name` = ? WHERE `id` = ?', ['Renamed Member', pair.second_id]);

		const feed = await activity(pair.second.session_token);
		const outsider_feed = await activity(outsider.session_token);

		expect(feed.response.status).toBe(200);
		expect(feed.json.events.map(event => [event.event_type, event.actor_display_name])).toEqual([
			['joined', 'Activity Member'],
			['campaign_started', null],
			['joined', 'Activity Founder']
		]);
		expect(outsider_feed.json.events).toHaveLength(2);
		expect(outsider_feed.json.events.find(event => event.event_type === 'joined')?.actor_display_name)
			.toBe('Activity Outsider');
	});

	test('returns stable newest-first twenty-row cursor pages and rejects malformed cursors', async () => {
		const client = await register_guild_client('Paged Activity', 'Paged Activity Guild');
		for (let index = 0; index < 25; index++)
			await db_run(
				'INSERT INTO `guild_activity_events` (`guild_id`, `event_type`, `source_key`, `created_at`) VALUES(?, ?, ?, ?)',
				[client.guild_id, 'campaign_started', `page:${index}`, 100 + Math.floor(index / 2)]
			);

		const first = await activity(client.session_token);
		expect(first.json.events).toHaveLength(20);
		expect(first.json.next_cursor).not.toBeNull();
		const second = await activity(client.session_token, first.json.next_cursor as string);
		expect(second.json.events).toHaveLength(7);
		expect(second.json.next_cursor).toBeNull();
		const ids = [...first.json.events, ...second.json.events].map(event => event.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect((await request('/api/guilds/activity?cursor=invalid', {
			headers: { 'X-Session-Token': client.session_token }
		})).status).toBe(400);
	});

	test('throttles noisy successful actions without suppressing their underlying mutations', async () => {
		const client = await register_guild_client('Activity Donor', 'Donation Guild');
		const first = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'melvorD:Logs', qty: 1 }], command_id: crypto.randomUUID()
		}, client.session_token);
		const second = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'melvorD:Logs', qty: 2 }], command_id: crypto.randomUUID()
		}, client.session_token);

		expect(first.json.success).toBe(true);
		expect(second.json.success).toBe(true);
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guild_activity_events` WHERE `guild_id` = ? AND `event_type` = 'charitree_donated'",
			[client.guild_id]
		)).toBe(1);
	});

	test('records Marketplace purchases and fulfillments privately for both participants', async () => {
		const pair = await make_guildmates('Market Seller', 'Market Buyer', 'Activity Market');
		const outsider = await register_guild_client('Market Outsider', 'Other Market Guild');
		const watermelon = 'melvorD:Activity_Watermelon';
		const apple = 'melvorD:Activity_Apple';

		await post_json('/api/market/sell', {
			item_id: watermelon, item_qty: 10, item_sell_price: 3, command_id: crypto.randomUUID()
		}, pair.first.session_token);
		const sell_listing = (await market_listings(pair.first.session_token)).json.items.find(item => item.item_id === watermelon);
		expect(sell_listing).toBeDefined();
		const purchase_command_id = crypto.randomUUID();
		const purchase = await post_json('/api/market/buy', {
			id: sell_listing?.id, qty: 5, command_id: purchase_command_id
		}, pair.second.session_token);
		const purchase_replay = await post_json('/api/market/buy', {
			id: sell_listing?.id, qty: 5, command_id: purchase_command_id
		}, pair.second.session_token);
		expect(purchase.response.status).toBe(200);
		expect(purchase_replay.response.status).toBe(200);

		await post_json('/api/market/buy-order', {
			item_id: apple, item_qty: 4, item_buy_price: 7, command_id: crypto.randomUUID()
		}, pair.second.session_token);
		const buy_order = (await market_listings(pair.second.session_token)).json.items.find(item => item.item_id === apple);
		expect(buy_order).toBeDefined();
		await post_json('/api/market/fulfill', {
			id: buy_order?.id, qty: 1, command_id: crypto.randomUUID()
		}, pair.first.session_token);

		const buyer_private = (await activity(pair.second.session_token)).json.events.filter(event => event.private);
		const seller_private = (await activity(pair.first.session_token)).json.events.filter(event => event.private);
		const outsider_private = (await activity(outsider.session_token)).json.events.filter(event => event.private);
		expect(buyer_private).toHaveLength(2);
		expect(buyer_private.map(event => [event.event_type, event.metadata])).toEqual([
			['market_sold_to', {
				item_id: apple, quantity: 1,
				buyer_display_name: 'Market Buyer', seller_display_name: 'Market Seller'
			}],
			['market_bought', {
				item_id: watermelon, quantity: 5,
				buyer_display_name: 'Market Buyer', seller_display_name: 'Market Seller'
			}]
		]);
		expect(seller_private).toHaveLength(2);
		expect(seller_private.map(event => [event.event_type, event.metadata])).toEqual([
			['market_sold', {
				item_id: apple, quantity: 1,
				buyer_display_name: 'Market Buyer', seller_display_name: 'Market Seller'
			}],
			['market_bought_by', {
				item_id: watermelon, quantity: 5,
				buyer_display_name: 'Market Buyer', seller_display_name: 'Market Seller'
			}]
		]);
		expect(outsider_private).toEqual([]);
	});
});
