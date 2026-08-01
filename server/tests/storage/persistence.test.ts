import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates } from '../support/fixtures';
import { post_json } from '../support/http';
import { db_all, db_count } from '../support/persistence';

describe('SQLite persistence probe', () => {
	test('initializes every application table', async () => {
		const rows = await db_all<{ name: string }>(
			"SELECT `name` FROM `sqlite_schema` WHERE `type` = 'table' AND `name` NOT LIKE 'sqlite_%'"
		);
		const tables = rows.map(row => row.name).sort();

		expect(tables).toEqual([
			'banishment_return_claim_items',
			'banishment_return_claims',
			'banishment_return_items',
			'banishment_returns',
			'campaign_contributions',
			'campaign_state',
			'charity_items',
			'client_sessions',
			'clients',
			'equipment_snapshot_items',
			'equipment_snapshots',
			'friend_requests',
			'friends',
			'gift_items',
			'gifts',
			'guild_applications',
			'guild_memberships',
			'guild_petition_voters',
			'guild_petition_votes',
			'guild_petitions',
			'guilds',
			'market_items',
			'resolved_trade_offers',
			'service_settings',
			'trade_items',
			'trade_offers'
		]);
	});

	test('removes accepted gifts and all item rows', async () => {
		const pair = await make_guildmates('Gift Cleanup Sender', 'Gift Cleanup Recipient');
		await post_json('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [
				{ id: 'melvorD:Cleanup_A', qty: 1 },
				{ id: 'melvorD:Cleanup_B', qty: 2 }
			]
		}, pair.first.session_token);
		const gift_id = (await get_events(pair.second)).gifts[0];

		expect(await db_count('SELECT COUNT(*) AS count FROM `gifts` WHERE `gift_id` = ?', [gift_id])).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS count FROM `gift_items` WHERE `gift_id` = ?', [gift_id])).toBe(2);

		await post_json('/api/gift/accept', { gift_id }, pair.second.session_token);

		expect(await db_count('SELECT COUNT(*) AS count FROM `gifts` WHERE `gift_id` = ?', [gift_id])).toBe(0);
		expect(await db_count('SELECT COUNT(*) AS count FROM `gift_items` WHERE `gift_id` = ?', [gift_id])).toBe(0);
	});

	test('removes resolved trades, offers, and all item rows', async () => {
		const pair = await make_guildmates('Trade Cleanup Sender', 'Trade Cleanup Recipient');
		const offered = await post_json<{
			trade_id: number;
		}>('/api/trade/offer', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Cleanup_Offer', qty: 3 }]
		}, pair.first.session_token);
		const trade_id = offered.json.trade_id;
		await post_json('/api/trade/counter', {
			trade_id,
			items: [{ id: 'melvorD:Cleanup_Counter', qty: 4 }]
		}, pair.second.session_token);
		await post_json('/api/trade/accept', {
			trade_id
		}, pair.first.session_token);

		expect(await db_count('SELECT COUNT(*) AS count FROM `trade_offers` WHERE `trade_id` = ?', [trade_id])).toBe(0);
		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `resolved_trade_offers` WHERE `trade_id` = ?',
			[trade_id]
		)).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS count FROM `trade_items` WHERE `trade_id` = ?', [trade_id])).toBe(1);

		await post_json('/api/trade/resolve', {
			trade_id
		}, pair.second.session_token);

		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `resolved_trade_offers` WHERE `trade_id` = ?',
			[trade_id]
		)).toBe(0);
		expect(await db_count('SELECT COUNT(*) AS count FROM `trade_items` WHERE `trade_id` = ?', [trade_id])).toBe(0);
	});
});
