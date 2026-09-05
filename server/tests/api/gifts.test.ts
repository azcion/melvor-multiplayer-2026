import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';

type TransferContents = {
	gifts: Record<string, {
		items: Array<{
			id: number;
			item_id: string;
			qty: number;
		}>;
		sender: {
			display_name: string;
			icon_id: string;
		};
		flags: number;
	}>;
	trades: Record<string, unknown>;
	resolved_trades: Record<string, unknown>;
};

type Inbox = {
	items: Array<{ item_id: string; qty: number }>;
	pending_claim: boolean;
};

async function get_transfer_contents(
	session_token: string,
	gift_ids: number[]
) {
	return post_json<TransferContents>('/api/transfers/get_contents', {
		gift_ids,
		trade_ids: [],
		resolved_trade_ids: []
	}, session_token);
}

async function get_inbox(session_token: string) {
	return get_json_with_session<Inbox>('/api/inbox', session_token);
}

describe('gift API', () => {
	test('validates recipients, item arrays, item limits, and pending gifts', async () => {
		const pair = await make_guildmates('Gift Validation Sender', 'Gift Validation Recipient');
		const invalid_items = await post('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Coal_Ore', qty: 0 }]
		}, pair.first.session_token);
		const fractional_items = await post('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Coal_Ore', qty: 0.5 }]
		}, pair.first.session_token);
		const maximum = await post_json<{ success: boolean }>('/api/gift/send', {
			recipient_id: pair.second_id,
			items: Array.from({ length: 32 }, (_, index) => ({
				id: `melvorD:Test_Item_${index}`,
				qty: 1
			}))
		}, pair.first.session_token);
		const maximum_gift_id = (await get_events(pair.second)).gifts[0];
		await post_json('/api/gift/accept', { gift_id: maximum_gift_id }, pair.second.session_token);
		const too_many = await post('/api/gift/send', {
			recipient_id: pair.second_id,
			items: Array.from({ length: 33 }, (_, index) => ({ id: `melvorD:Extra_Item_${index}`, qty: 1 }))
		}, pair.first.session_token);
		const first = await post_json<{ success: boolean }>('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Coal_Ore', qty: 2 }]
		}, pair.first.session_token);
		const pending = await post_json<{ error_lang: string }>('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Coal_Ore', qty: 1 }]
		}, pair.first.session_token);

		expect(invalid_items.status).toBe(400);
		expect(fractional_items.status).toBe(400);
		expect(maximum.json.success).toBe(true);
		expect(too_many.status).toBe(400);
		expect(first.json.success).toBe(true);
		expect(pending.json.error_lang).toBe('MOD_MP_PENDING_GIFT');

		const gift_id = (await get_events(pair.second)).gifts[0];
		await post_json('/api/gift/accept', { gift_id }, pair.second.session_token);
		await post_json('/api/guilds/leave', {}, pair.second.session_token);

		const non_friend = await post_json<{ error_lang: string }>('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Coal_Ore', qty: 1 }]
		}, pair.first.session_token);

		expect(non_friend.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
	});

	test('exposes gift contents only to the recipient and cleans up accepted gifts', async () => {
		const pair = await make_guildmates('Gift Sender', 'Gift Recipient');
		const sent = await post_json<{ success: boolean }>('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [
				{ id: 'melvorD:Coal_Ore', qty: 12 },
				{ id: 'exampleMod:Allowed_Gift', qty: 3 }
			]
		}, pair.first.session_token);
		const gift_id = (await get_events(pair.second)).gifts[0];
		const recipient_contents = await get_transfer_contents(pair.second.session_token, [gift_id]);
		const sender_contents = await get_transfer_contents(pair.first.session_token, [gift_id]);

		expect(sent.json.success).toBe(true);
		expect(gift_id).toBeNumber();
		expect(recipient_contents.json.gifts[String(gift_id)]).toMatchObject({
			items: [
				{ item_id: 'melvorD:Coal_Ore', qty: 12 },
				{ item_id: 'exampleMod:Allowed_Gift', qty: 3 }
			],
			sender: {
				display_name: 'Gift Sender',
				icon_id: pair.first.icon_id
			},
			flags: 0
		});
		expect(sender_contents.json.gifts).toEqual({});

		const accepted = await post_json<{ success: boolean }>('/api/gift/accept', {
			gift_id
		}, pair.second.session_token);

		expect(accepted.json.success).toBe(true);
		expect((await get_events(pair.second)).gifts).toEqual([]);
		expect((await get_transfer_contents(pair.second.session_token, [gift_id])).json.gifts).toEqual({});
		expect((await get_inbox(pair.second.session_token)).json.items).toEqual([
			{ item_id: 'exampleMod:Allowed_Gift', qty: 3 },
			{ item_id: 'melvorD:Coal_Ore', qty: 12 }
		]);
	});

	test('returns declined gifts to the sender for collection', async () => {
		const pair = await make_guildmates('Returned Gift Sender', 'Returned Gift Recipient');
		await post_json('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorF:Air_Rune', qty: 25 }]
		}, pair.first.session_token);
		const gift_id = (await get_events(pair.second)).gifts[0];
		const declined = await post_json<{ success: boolean }>('/api/gift/decline', {
			gift_id
		}, pair.second.session_token);
		const returned_events = await get_events(pair.first);
		const returned_contents = await get_transfer_contents(pair.first.session_token, [gift_id]);
		const decline_returned = await post('/api/gift/decline', {
			gift_id
		}, pair.first.session_token);

		expect(declined.json.success).toBe(true);
		expect((await get_events(pair.second)).gifts).toEqual([]);
		expect(returned_events.gifts).toEqual([]);
		expect(returned_contents.json.gifts).toEqual({});
		expect((await get_inbox(pair.first.session_token)).json.items).toEqual([
			{ item_id: 'melvorF:Air_Rune', qty: 25 }
		]);
		expect(decline_returned.status).toBe(400);
	});

});
