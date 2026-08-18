import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';

type Receipt = {
	id: string;
	kind: string;
	effects: Array<{
		storage: 'bank' | 'gp' | 'transfer';
		item_id?: string;
		qty: number;
	}>;
};

describe('Economy Receipts', () => {
	test('replays a committed command and keeps its receipt pending until acknowledgement', async () => {
		const seller = await register_guild_client('Receipt Seller');
		const command_id = crypto.randomUUID();
		const body = {
			command_id,
			item_id: 'melvorD:Receipt_Ore',
			item_qty: 3,
			item_sell_price: 7
		};
		const first = await post_json<{ success: boolean; receipt: Receipt }>(
			'/api/market/sell',
			body,
			seller.session_token
		);
		const replay = await post_json<{ success: boolean; receipt: Receipt }>(
			'/api/market/sell',
			body,
			seller.session_token
		);

		expect(first.json).toEqual(replay.json);
		expect(first.json.receipt).toEqual({
			id: command_id,
			kind: 'market-sell',
			effects: [{ storage: 'bank', item_id: 'melvorD:Receipt_Ore', qty: -3 }]
		});
		const listings = await get_json_with_session<{
			items: Array<{
				id: number;
				item_id: string;
				qty: number;
				available: number;
				price: number;
				payout: number;
			}>;
		}>('/api/market/listings', seller.session_token);
		expect(listings.json.items.filter(item => item.item_id === 'melvorD:Receipt_Ore')).toEqual([
			{ id: expect.any(Number), item_id: 'melvorD:Receipt_Ore', qty: 3, available: 3, price: 7, payout: 0 }
		]);

		const pending = await get_events(seller);
		expect(pending.economy_receipts).toEqual([first.json.receipt]);
		const acknowledged = await post_json<{ success: boolean }>(
			'/api/economy/receipts/acknowledge',
			{ receipt_id: command_id },
			seller.session_token
		);
		expect(acknowledged.json.success).toBe(true);
		expect((await get_events(seller)).economy_receipts).toEqual([]);
		const completed_replay = await post_json<{ success: boolean; receipt: null }>(
			'/api/market/sell',
			body,
			seller.session_token
		);
		expect(completed_replay.json.receipt).toBeNull();
	});

	test('durably delivers accepted gift contents after the gift rows are deleted', async () => {
		const pair = await make_guildmates('Receipt Gift Sender', 'Receipt Gift Recipient');
		const send_id = crypto.randomUUID();
		const sent = await post_json<{ success: boolean; receipt: Receipt }>('/api/gift/send', {
			command_id: send_id,
			recipient_id: pair.second.client_id,
			items: [{ id: 'melvorD:GP', qty: 11 }, { id: 'melvorD:Logs', qty: 4 }]
		}, pair.first.session_token);
		expect(sent.json.receipt.effects).toEqual([
			{ storage: 'transfer', item_id: 'melvorD:GP', qty: -11 },
			{ storage: 'transfer', item_id: 'melvorD:Logs', qty: -4 }
		]);

		const recipient_events = await get_events(pair.second);
		const gift_id = recipient_events.gifts[0];
		const accept_id = crypto.randomUUID();
		const accepted = await post_json<{ success: boolean; receipt: Receipt }>('/api/gift/accept', {
			command_id: accept_id,
			gift_id
		}, pair.second.session_token);
		const replay = await post_json<{ success: boolean; receipt: Receipt }>('/api/gift/accept', {
			command_id: accept_id,
			gift_id
		}, pair.second.session_token);

		expect(replay.json).toEqual(accepted.json);
		expect(accepted.json.receipt.effects).toEqual([
			{ storage: 'gp', qty: 11 },
			{ storage: 'bank', item_id: 'melvorD:Logs', qty: 4 }
		]);
		const after_accept = await get_events(pair.second);
		expect(after_accept.gifts).toEqual([]);
		expect(after_accept.economy_receipts).toEqual([accepted.json.receipt]);

		const wrong_owner = await post('/api/economy/receipts/acknowledge', {
			receipt_id: accept_id
		}, pair.first.session_token);
		expect(wrong_owner.status).toBe(404);
	});
});
