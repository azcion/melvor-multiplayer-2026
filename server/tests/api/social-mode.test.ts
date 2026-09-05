import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_run } from '../support/persistence';

async function get_inbox(session_token: string) {
	return get_json_with_session<{
		items: Array<{ item_id: string; qty: number }>;
		pending_claim: boolean;
	}>('/api/inbox', session_token);
}

describe('Social Only mode cancellation', () => {
	test('persists the selected mode, hides Social recipients, and rejects server mutations', async () => {
		const pair = await make_guildmates('Authoritative Social Client', 'Authoritative Full Client');
		const peer_before = await get_events(pair.second);
		const changed = await post_json<{
			success: boolean;
			social_mode: string;
			receipt: { id: string; kind: string };
		}>('/api/social-mode/set', { mode: 'social', command_id: crypto.randomUUID() }, pair.first.session_token);

		expect(changed.json).toMatchObject({ success: true, social_mode: 'social' });
		const authenticated = await post_json<{ social_mode: string; session_token: string }>('/api/authenticate', {
			client_identifier: pair.first.client_identifier,
			client_key: pair.first.client_key
		});
		const guild = await get_json_with_session<{
			members: Array<{ client_id: number; social_mode: string }>;
		}>('/api/guilds/state', pair.second.session_token);
		const sell = await post_json<{ error_lang: string }>('/api/market/sell', {
			item_id: 'melvorD:Blocked_Social_Market', item_qty: 1, item_sell_price: 1
		}, authenticated.json.session_token);
		const listings = await get_json_with_session<{ error_lang: string }>('/api/market/listings', authenticated.json.session_token);
		const market_payout = await post_json<{ error_lang: string }>('/api/market/payout', {
			id: 1, command_id: crypto.randomUUID()
		}, authenticated.json.session_token);
		const market_cancel = await post_json<{ error_lang: string }>('/api/market/cancel', {
			id: 1, command_id: crypto.randomUUID()
		}, authenticated.json.session_token);
		const market_destroy = await post_json<{ error_lang: string }>('/api/market/destroy', {
			id: 1, command_id: crypto.randomUUID()
		}, authenticated.json.session_token);
		const gift = await post_json<{ error_lang: string }>('/api/gift/send', {
			recipient_id: pair.first_id,
			items: [{ id: 'melvorD:Blocked_Social_Gift', qty: 1 }]
		}, pair.second.session_token);
		const trade = await post_json<{ error_lang: string }>('/api/trade/offer', {
			recipient_id: pair.first_id,
			items: [{ id: 'melvorD:Blocked_Social_Trade', qty: 1 }]
		}, pair.second.session_token);
		const campaign = await post_json<{ error_lang: string }>('/api/campaign/contribute', {
			item_amount: 1, command_id: crypto.randomUUID()
		}, authenticated.json.session_token);
		const campaign_claim = await post_json<{ error_lang: string }>('/api/campaign/claim', {
			campaign_id: 1, value: 1, command_id: crypto.randomUUID()
		}, authenticated.json.session_token);
		const charity = await post_json<{ error_lang: string }>('/api/charity/donate', {
			items: [{ id: 'melvorD:Blocked_Social_Charity', qty: 1 }], command_id: crypto.randomUUID()
		}, authenticated.json.session_token);
		const transfer_contents = await post_json<{ error_lang: string }>('/api/transfers/get_contents', {
			gift_ids: [], trade_ids: [], resolved_trade_ids: []
		}, authenticated.json.session_token);

		expect(authenticated.json.social_mode).toBe('social');
		expect(guild.json.members.find(member => member.client_id === pair.first_id)?.social_mode).toBe('social');
		const peer_after = await get_json_with_session<{
			revision: number;
			unchanged?: boolean;
			guild_member_social_modes: Array<{ client_id: number; social_mode: string }>;
		}>(`/api/events?revision=${peer_before.revision}`, pair.second.session_token);
		expect(peer_after.json.unchanged).not.toBe(true);
		expect(peer_after.json.guild_member_social_modes).toContainEqual({
			client_id: pair.first_id,
			social_mode: 'social'
		});
		expect(sell.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(listings.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(market_payout.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(market_cancel.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(market_destroy.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(gift.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(trade.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(campaign.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(campaign_claim.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(charity.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');
		expect(transfer_contents.json.error_lang).toBe('MOD_MP_SOCIAL_ONLY_DISABLED');

		const restored = await post_json<{ success: boolean; social_mode: string }>('/api/social-mode/set', {
			mode: 'full', command_id: crypto.randomUUID()
		}, authenticated.json.session_token);
		expect(restored.json).toMatchObject({ success: true, social_mode: 'full' });
	});

	test('keeps Campaign contribution and existing Inbox value dormant across Social mode', async () => {
		const pair = await make_guildmates('Dormant Campaign Client', 'Dormant Campaign Peer');
		const campaign = await get_json_with_session<{ active: boolean; campaign_id: string; contribution: number }>(
			'/api/campaign/info', pair.first.session_token
		);
		expect(campaign.json.active).toBe(true);
		await post_json('/api/campaign/contribute', {
			item_amount: 1,
			command_id: crypto.randomUUID()
		}, pair.first.session_token);
		await db_run(
			'INSERT INTO `inbox_items` (`client_id`, `item_id`, `qty`) VALUES(?, ?, ?)',
			[pair.first_id, 'melvorD:Social_Preexisting_Inbox', 2]
		);

		await post_json('/api/social-mode/set', {
			mode: 'social', command_id: crypto.randomUUID()
		}, pair.first.session_token);
		const dormant = await get_json_with_session<{ contribution: number }>('/api/campaign/info', pair.first.session_token);
		expect(dormant.json.contribution).toBe(1);
		expect((await get_inbox(pair.first.session_token)).json.items).toContainEqual({
			item_id: 'melvorD:Social_Preexisting_Inbox', qty: 2
		});

		await post_json('/api/social-mode/set', {
			mode: 'full', command_id: crypto.randomUUID()
		}, pair.first.session_token);
		const restored = await get_json_with_session<{ contribution: number }>('/api/campaign/info', pair.first.session_token);
		expect(restored.json.contribution).toBe(1);
	});

	test('serializes concurrent mode entry with new Gift and Trade offers', async () => {
		const pair = await make_guildmates('Concurrent Social Target', 'Concurrent Full Sender');
		await Promise.all([
			post_json('/api/social-mode/set', {
				mode: 'social', command_id: crypto.randomUUID()
			}, pair.first.session_token),
			post_json('/api/gift/send', {
				recipient_id: pair.first_id,
				items: [{ id: 'melvorD:Concurrent_Social_Gift', qty: 1 }],
				command_id: crypto.randomUUID()
			}, pair.second.session_token),
			post_json('/api/trade/offer', {
				recipient_id: pair.first_id,
				items: [{ id: 'melvorD:Concurrent_Social_Trade', qty: 1 }],
				command_id: crypto.randomUUID()
			}, pair.second.session_token)
		]);

		expect((await get_events(pair.first)).gifts).toEqual([]);
		expect((await get_events(pair.first)).trades).toEqual([]);
		expect((await get_events(pair.second)).gifts).toEqual([]);
		expect((await get_events(pair.second)).trades).toEqual([]);
	});

	test('cancels owned listings, gifts, and trades into the Inbox and replays safely', async () => {
		const pair = await make_guildmates('Social Mode Sender', 'Social Mode Recipient');
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Social_Market_Item',
			item_qty: 4,
			item_sell_price: 3
		}, pair.first.session_token);
		await post_json('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorF:Social_Gift_Item', qty: 3 }]
		}, pair.first.session_token);
		const offered = await post_json<{ trade_id: number }>('/api/trade/offer', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorF:Social_Trade_Item', qty: 5 }]
		}, pair.first.session_token);

		const command_id = crypto.randomUUID();
		const cancelled = await post_json<{
			success: boolean;
			cancelled: { marketplace: number; gifts: number; trades: number };
			receipt: { id: string; kind: string; effects: unknown[] };
		}>('/api/social-mode/cancel', { command_id }, pair.first.session_token);
		const replay = await post_json<typeof cancelled.json>('/api/social-mode/cancel', { command_id }, pair.first.session_token);

		expect(cancelled.json).toMatchObject({
			success: true,
			cancelled: { marketplace: 1, gifts: 1, trades: 1 },
			receipt: { id: command_id, kind: 'social-mode-cancel', effects: [] }
		});
		expect(replay.json).toEqual(cancelled.json);
		expect(offered.json.trade_id).toBeNumber();
		expect((await get_events(pair.first)).gifts).toEqual([]);
		expect((await get_events(pair.first)).trades).toEqual([]);
		expect((await get_events(pair.second)).gifts).toEqual([]);
		expect((await get_events(pair.second)).trades).toEqual([]);
		expect((await get_inbox(pair.first.session_token)).json.items).toEqual([
			{ item_id: 'melvorD:Social_Market_Item', qty: 4 },
			{ item_id: 'melvorF:Social_Gift_Item', qty: 3 },
			{ item_id: 'melvorF:Social_Trade_Item', qty: 5 }
		]);
	});

	test('returns an incoming pending gift to its sender', async () => {
		const pair = await make_guildmates('Social Mode Incoming Sender', 'Social Mode Incoming Recipient');
		await post_json('/api/gift/send', {
			recipient_id: pair.first_id,
			items: [{ id: 'melvorD:Returned_Social_Gift', qty: 7 }]
		}, pair.second.session_token);

		const cancelled = await post_json<{ success: boolean; cancelled: { gifts: number } }>('/api/social-mode/cancel', {
			command_id: crypto.randomUUID()
		}, pair.first.session_token);

		expect(cancelled.json.success).toBe(true);
		expect(cancelled.json.cancelled.gifts).toBe(1);
		expect((await get_inbox(pair.second.session_token)).json.items).toEqual([
			{ item_id: 'melvorD:Returned_Social_Gift', qty: 7 }
		]);
	});

});
