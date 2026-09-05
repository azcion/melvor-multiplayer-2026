import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';

type Inbox = {
	items: Array<{ item_id: string; qty: number }>;
	pending_claim: boolean;
};

type InboxClaim = {
	claim_id: string;
	items: Array<{ id: string; qty: number }>;
};

async function get_inbox(session_token: string) {
	return get_json_with_session<Inbox>('/api/inbox', session_token);
}

async function send_gift(session_token: string, recipient_id: number, items: Array<{ id: string; qty: number }>) {
	const sent = await post_json<{ gift_id?: number; success: boolean }>('/api/gift/send', {
		recipient_id,
		items
	}, session_token);
	if (!sent.json.success)
		throw new Error(`Gift send failed: ${JSON.stringify(sent.json)}`);
}

async function accept_next_gift(session_token: string) {
	const gift_id = (await get_json_with_session<{ gifts: number[] }>('/api/events', session_token)).json.gifts[0];
	if (!gift_id)
		throw new Error('Gift was not visible');
	return post_json<{ success: boolean }>('/api/gift/accept', {
		gift_id,
		command_id: crypto.randomUUID()
	}, session_token);
}

describe('inbox API', () => {
	test('aggregates accepted gift stacks, including GP', async () => {
		const pair = await make_guildmates('Inbox Gift Sender', 'Inbox Gift Recipient');
		await send_gift(pair.first.session_token, pair.second_id, [
			{ id: 'melvorD:Logs', qty: 2 },
			{ id: 'melvorD:GP', qty: 5 }
		]);
		await accept_next_gift(pair.second.session_token);
		await db_run(
			'UPDATE `inbox_items` SET `created_at` = 1, `updated_at` = 1 WHERE `client_id` = ? AND `item_id` = ?',
			[pair.second_id, 'melvorD:Logs']
		);
		await send_gift(pair.first.session_token, pair.second_id, [
			{ id: 'melvorD:Logs', qty: 3 },
			{ id: 'melvorD:GP', qty: 7 }
		]);
		await accept_next_gift(pair.second.session_token);
		const stored = await db_all<{ created_at: number | null; updated_at: number | null }>(
			'SELECT `created_at`, `updated_at` FROM `inbox_items` WHERE `client_id` = ? AND `item_id` = ?',
			[pair.second_id, 'melvorD:Logs']
		);

		expect((await get_inbox(pair.second.session_token)).json).toEqual({
			items: [
				{ item_id: 'melvorD:GP', qty: 12 },
				{ item_id: 'melvorD:Logs', qty: 5 }
			],
			pending_claim: false
		});
		expect(stored[0]?.created_at).toBe(1);
		expect(stored[0]?.updated_at).toBeGreaterThan(1);
	});

	test('does not duplicate an Inbox delivery when its source command is replayed', async () => {
		const pair = await make_guildmates('Inbox Replay Sender', 'Inbox Replay Recipient');
		await send_gift(pair.first.session_token, pair.second_id, [{ id: 'melvorD:Replay_Logs', qty: 6 }]);
		const gift_id = (await get_json_with_session<{ gifts: number[] }>(
			'/api/events', pair.second.session_token
		)).json.gifts[0];
		const command_id = crypto.randomUUID();
		const body = { gift_id, command_id };
		const first = await post_json('/api/gift/accept', body, pair.second.session_token);
		const replay = await post_json('/api/gift/accept', body, pair.second.session_token);

		expect(replay.json).toEqual(first.json);
		expect((await get_inbox(pair.second.session_token)).json.items).toEqual([
			{ item_id: 'melvorD:Replay_Logs', qty: 6 }
		]);
	});

	test('claims complete stacks by bank slot and replays an outstanding claim safely', async () => {
		const pair = await make_guildmates('Inbox Claim Sender', 'Inbox Claim Recipient');
		await send_gift(pair.first.session_token, pair.second_id, [
			{ id: 'melvorD:Iron_Ore', qty: 4 },
			{ id: 'melvorD:Logs', qty: 9 },
			{ id: 'melvorD:GP', qty: 11 }
		]);
		await accept_next_gift(pair.second.session_token);

		const first = await post_json<{ claim: InboxClaim }>('/api/inbox/claim', {
			existing_item_ids: ['melvorD:Iron_Ore'],
			available_slots: 0
		}, pair.second.session_token);
		const replay = await post_json<{ claim: InboxClaim }>('/api/inbox/claim', {
			existing_item_ids: [],
			available_slots: 32
		}, pair.second.session_token);

		expect(first.json.claim.items).toEqual([
			{ id: 'melvorD:GP', qty: 11 },
			{ id: 'melvorD:Iron_Ore', qty: 4 }
		]);
		expect(replay.json.claim).toEqual(first.json.claim);
		expect((await get_inbox(pair.second.session_token)).json).toEqual({
			items: [{ item_id: 'melvorD:Logs', qty: 9 }],
			pending_claim: true
		});

		expect((await post_json<{ success: boolean }>('/api/inbox/acknowledge', {
			claim_id: first.json.claim.claim_id
		}, pair.second.session_token)).json.success).toBe(true);
		const second = await post_json<{ claim: InboxClaim }>('/api/inbox/claim', {
			existing_item_ids: [],
			available_slots: 1
		}, pair.second.session_token);
		expect(second.json.claim.items).toEqual([{ id: 'melvorD:Logs', qty: 9 }]);
		await post_json('/api/inbox/acknowledge', {
			claim_id: second.json.claim.claim_id
		}, pair.second.session_token);
		expect((await get_inbox(pair.second.session_token)).json).toEqual({ items: [], pending_claim: false });
	});

	test('accepts a currency-only claim when the client has more than 512 free bank slots', async () => {
		const pair = await make_guildmates('Inbox GP Sender', 'Inbox GP Recipient');
		await send_gift(pair.first.session_token, pair.second_id, [{ id: 'melvorD:GP', qty: 1_000_000 }]);
		await accept_next_gift(pair.second.session_token);

		const claimed = await post_json<{ claim: InboxClaim }>('/api/inbox/claim', {
			existing_item_ids: [],
			available_slots: 513
		}, pair.second.session_token);

		expect(claimed.response.status).toBe(200);
		expect(claimed.json.claim.items).toEqual([{ id: 'melvorD:GP', qty: 1_000_000 }]);
	});
});
