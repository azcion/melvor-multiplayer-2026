import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';

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
	test('owner-only review preserves unpaid effects, excludes recovery, and permits another transaction', async () => {
		const owner = await register_guild_client('Receipt Review Owner');
		const other = await register_guild_client('Receipt Review Other');
		const command_id = crypto.randomUUID();
		const body = { command_id, source: 'bank', items: [{ id: 'melvorD:Dragon_Crossbow_Head', qty: 353 }], donation_value: 353 };
		const committed = await post_json<{ success: boolean; receipt: Receipt }>('/api/crucible/cast', body, owner.session_token);
		expect(committed.json.success).toBe(true);
		const before = await get_events(owner);
		const report = { receipt_id: command_id, reason: 'blocked' };
		expect((await post('/api/economy/receipts/review', report, other.session_token)).status).toBe(404);
		expect((await post('/api/economy/receipts/review', { ...report, reason: 'anything' }, owner.session_token)).status).toBe(400);
		expect((await post('/api/economy/receipts/review', { ...report, receipt_id: 'invalid' }, owner.session_token)).status).toBe(400);
		expect((await post_json('/api/economy/receipts/review', report, owner.session_token)).response.status).toBe(200);
		const records = await db_all<{ acknowledged_at: number | null; response_json: string; reason: string; reported_at: number }>(
			'SELECT r.acknowledged_at,r.response_json,v.reason,v.reported_at FROM economy_receipts r JOIN economy_receipt_reviews v ON v.receipt_id=r.id WHERE r.id=?', [command_id]);
		expect(records).toHaveLength(1);
		expect(records[0].acknowledged_at).toBeNull();
		expect(JSON.parse(records[0].response_json)).toEqual(committed.json);
		expect(records[0].reason).toBe('blocked');
		const after = await get_events(owner);
		expect(after.economy_receipts).toEqual([]);
		expect(after.revision).toBeGreaterThan(before.revision);
		await post_json('/api/economy/receipts/review', { ...report, reason: 'invalid' }, owner.session_token);
		expect(await db_all('SELECT reason,reported_at FROM economy_receipt_reviews WHERE receipt_id=?', [command_id]))
			.toEqual([{ reason: records[0].reason, reported_at: records[0].reported_at }]);
		expect((await post_json('/api/crucible/cast', body, owner.session_token)).json)
			.toEqual({ success: true, receipt: null, receipt_review_pending: true });
		const next = await post_json<{ success: boolean; receipt: Receipt }>('/api/market/sell', {
			command_id: crypto.randomUUID(), item_id: 'melvorD:Review_Ore', item_qty: 2, item_sell_price: 7
		}, owner.session_token);
		expect(next.json.success).toBe(true);
		expect((await get_events(owner)).economy_receipts).toEqual([next.json.receipt]);
	});

	test('reviewed receipts do not consume the pending delivery page', async () => {
		const owner = await register_guild_client('Receipt Review Page');
		const ids = Array.from({ length: 65 }, () => crypto.randomUUID());
		await db_run(`INSERT INTO economy_receipts(id,client_id,kind,response_json,created_at)
			SELECT value,?,'market-buy',json_object('success',json('true'),'receipt',json_object('id',value,'kind','market-buy','effects',json('[]'))),CAST(key AS INTEGER)
			FROM json_each(?)`, [owner.client_id, JSON.stringify(ids)]);
		await db_run(`INSERT INTO economy_receipt_reviews(receipt_id,reason,reported_at)
			SELECT value,'blocked',1 FROM json_each(?)`, [JSON.stringify(ids.slice(0, 64))]);
		expect((await get_events(owner)).economy_receipts).toEqual([{ id: ids[64], kind: 'market-buy', effects: [] }]);
	});

	test('replays a committed command and keeps its receipt pending until acknowledgement', async () => {
		const seller = await register_guild_client('Receipt Seller');
		const before = await get_json_with_session<{ revision: number }>('/api/events', seller.session_token);
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
				reserved: number;
				haggled: number;
				price: number;
				payout: number;
			}>;
		}>('/api/market/listings', seller.session_token);
		expect(listings.json.items.filter(item => item.item_id === 'melvorD:Receipt_Ore')).toMatchObject([
			{ id: expect.any(Number), item_id: 'melvorD:Receipt_Ore', qty: 3, available: 3, reserved: 0,
				haggled: 0, price: 7, payout: 0 }
		]);

		const pending_response = await get_json_with_session<{
			revision: number;
			unchanged?: boolean;
			economy_receipts: Receipt[];
		}>(`/api/events?revision=${before.json.revision}`, seller.session_token);
		const pending = pending_response.json;
		expect(pending.revision).toBeGreaterThan(before.json.revision);
		expect(pending.unchanged).not.toBe(true);
		expect(pending.economy_receipts).toEqual([first.json.receipt]);
		const acknowledged = await post_json<{ success: boolean }>(
			'/api/economy/receipts/acknowledge',
			{ receipt_id: command_id },
			seller.session_token
		);
		expect(acknowledged.json.success).toBe(true);
		const after_acknowledgement = await get_json_with_session<{
			revision: number;
			unchanged?: boolean;
			economy_receipts: Receipt[];
		}>(`/api/events?revision=${pending.revision}`, seller.session_token);
		expect(after_acknowledgement.json.revision).toBeGreaterThan(pending.revision);
		expect(after_acknowledgement.json.unchanged).not.toBe(true);
		expect(after_acknowledgement.json.economy_receipts).toEqual([]);
		const completed_replay = await post_json<{ success: boolean; receipt: null }>(
			'/api/market/sell',
			body,
			seller.session_token
		);
		expect(completed_replay.json.receipt).toBeNull();
	});

	test('durably delivers accepted gift contents to the Inbox after the gift rows are deleted', async () => {
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
		const accepted = await post_json<{ success: boolean }>('/api/gift/accept', {
			command_id: accept_id,
			gift_id
		}, pair.second.session_token);
		expect(accepted.json.success).toBe(true);
		const after_accept = await get_events(pair.second);
		expect(after_accept.gifts).toEqual([]);
		expect(after_accept.economy_receipts).toEqual([{
			id: accept_id,
			kind: 'gift-accept',
			effects: []
		}]);
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>('/api/inbox', pair.second.session_token)).json.items)
			.toEqual([
				{ item_id: 'melvorD:GP', qty: 11 },
				{ item_id: 'melvorD:Logs', qty: 4 }
			]);
	});
});
