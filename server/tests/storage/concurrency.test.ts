import { describe, expect, test } from 'bun:test';
import { make_guild_group, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, register_client } from '../support/http';
import { db_all, db_count } from '../support/persistence';
import { wait_for } from '../support/wait';

type OperationResult = {
	success?: boolean;
	item_qty?: number;
	item_loss?: number;
};

describe('concurrent persistence invariants', () => {
	test('reserves one Assault and credits one settlement under concurrent retries', async () => {
		const member = await register_guild_client('Concurrent Raider', 'Concurrent Raid');
		await post_json('/api/raids/activate', {}, member.session_token);
		const reservation_requests = await Promise.all(Array.from({ length: 10 }, () => post_json<{
			assault_id?: string;
			settlement_key?: string;
			combat_deadline?: number;
		}>('/api/raids/assaults/reserve', {
			tier: 2,
			loaded_session_id: crypto.randomUUID()
		}, member.session_token)));
		const reservations = reservation_requests.map(result => result.json).filter(result => result.assault_id !== undefined);
		expect(reservations).toHaveLength(1);
		const assault = reservations[0];
		const occurred_at = Math.min(Date.now(), assault.combat_deadline as number);
		const settlements = await Promise.all(Array.from({ length: 10 }, () => post_json<{
			success?: boolean;
			credited_progress?: number;
		}>('/api/raids/assaults/settle', {
			assault_id: assault.assault_id,
			settlement_key: assault.settlement_key,
			outcome: 'success',
			occurred_at
		}, member.session_token)));
		expect(settlements.every(result => result.json.success)).toBe(true);
		const state = await get_json_with_session<{
			raid: {
				member: {
					eligible: boolean;
					contribution: number;
					highest_tier: number;
					successful_assaults: number;
					assaults: number;
				};
			};
		}>('/api/raids/state', member.session_token);
		expect(state.json.raid.member).toEqual({
			eligible: true,
			contribution: 1_800,
			highest_tier: 2,
			successful_assaults: 1,
			assaults: 2
		});
	});

	test('creates one Message for concurrent idempotent sends without charging disabled capacity', async () => {
		const pair = await make_guildmates('Concurrent Chat Sender', 'Concurrent Chat Recipient');
		const started = await post_json<{
			conversation: { conversation_id: number | null };
		}>('/api/chat/conversations/start', { client_id: pair.second_id }, pair.first.session_token);
		const idempotency_key = crypto.randomUUID();
		const results = await Promise.all(Array.from({ length: 20 }, () => post_json<{
			success?: boolean;
			message?: { message_id: number };
			budget_enabled?: boolean;
			budget?: { credits: number };
		}>('/api/chat/messages/send', {
			conversation_id: started.json.conversation.conversation_id,
			client_id: pair.second_id,
			idempotency_key,
			content: 'Only once'
		}, pair.first.session_token)));

		expect(results.every(result => result.json.success)).toBe(true);
		expect(new Set(results.map(result => result.json.message?.message_id)).size).toBe(1);
		expect(results.at(-1)?.json.budget_enabled).toBe(false);
		expect(results.at(-1)?.json.budget?.credits).toBe(5);
		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `chat_messages` WHERE `sender_id` = ? AND `idempotency_key` = ?',
			[pair.first_id, idempotency_key]
		)).toBe(1);
	});

	test('creates only one pending request for concurrent duplicate friend requests', async () => {
		const [sender, recipient] = await Promise.all([
			register_client('Concurrent Friend Sender'),
			register_client('Concurrent Friend Recipient')
		]);

		await Promise.all(Array.from({ length: 30 }, () => post_json(
			'/api/friends/add',
			{ friend_code: recipient.friend_code },
			sender.session_token
		)));

		const recipient_rows = await db_all<{ id: number }>(
			'SELECT `id` FROM `clients` WHERE `client_identifier` = ?',
			[recipient.client_identifier]
		);
		const sender_rows = await db_all<{ id: number }>(
			'SELECT `id` FROM `clients` WHERE `client_identifier` = ?',
			[sender.client_identifier]
		);
		const count = await db_count(
			'SELECT COUNT(*) AS count FROM `friend_requests` WHERE `client_id` = ? AND `friend_id` = ?',
			[recipient_rows[0].id, sender_rows[0].id]
		);

		expect(count).toBe(1);
	});

	test('merges concurrent matching market listings without losing quantities', async () => {
		const seller = await register_guild_client('Concurrent Listing Seller');
		const item_id = `melvorD:Concurrent_Listing_${crypto.randomUUID()}`;

		await Promise.all(Array.from({ length: 30 }, () => post_json(
			'/api/market/sell',
			{ item_id, item_qty: 1, item_sell_price: 17 },
			seller.session_token
		)));
		const lots = await wait_for(
			() => db_all<{ qty: number; available: number }>(
				'SELECT `qty`, `available` FROM `market_items` WHERE `item_id` = ?',
				[item_id]
			),
			rows => rows.reduce((total, row) => total + row.qty, 0) === 30
		);

		expect(lots).toHaveLength(1);
		expect(lots[0]).toEqual({ qty: 30, available: 30 });
	});

	test('allows only one buyer to claim the final market quantity', async () => {
		const group = await make_guild_group([
			'Concurrent Market Seller',
			...Array.from({ length: 20 }, (_, index) => `Market Buyer ${index}`)
		]);
		const [seller, ...buyers] = group;
		const item_id = `melvorD:Concurrent_Buy_${crypto.randomUUID()}`;
		await post_json('/api/market/sell', {
			item_id,
			item_qty: 1,
			item_sell_price: 23
		}, seller.session_token);
		const rows = await wait_for(
			() => db_all<{ id: number }>('SELECT `id` FROM `market_items` WHERE `item_id` = ?', [item_id]),
			value => value.length === 1
		);

		const results = await Promise.all(buyers.map(buyer => post_json<OperationResult>(
			'/api/market/buy',
			{ id: rows[0].id, qty: 1 },
			buyer.session_token
		)));
		const successful = results.filter(result => result.json.success);
		const item_total = successful.reduce((total, result) => total + (result.json.item_qty ?? 0), 0);

		expect(successful).toHaveLength(1);
		expect(item_total).toBe(1);
	});

	test('allows only one player to take a charity item', async () => {
		const group = await make_guild_group([
			'Concurrent Charity Donor',
			...Array.from({ length: 20 }, (_, index) => `Charity Taker ${index}`)
		]);
		const [donor, ...takers] = group;
		const item_id = `melvorD:Concurrent_Charity_${crypto.randomUUID()}`;
		await post_json('/api/charity/donate', {
			items: [{ id: item_id, qty: 41 }]
		}, donor.session_token);

		const results = await Promise.all(takers.map(taker => post_json<OperationResult>(
			'/api/charity/take',
			{ item_id },
			taker.session_token
		)));
		const successful = results.filter(result => result.json.success);
		const item_total = successful.reduce((total, result) => total + (result.json.item_qty ?? 0), 0);

		expect(successful).toHaveLength(1);
		expect(item_total).toBe(41);
		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `charity_items` WHERE `item_id` = ?',
			[item_id]
		)).toBe(0);
	});

	test('adds concurrent charity donations without losing quantities', async () => {
		const donor = await register_guild_client('Concurrent Charity Donations');
		const item_id = `melvorD:Concurrent_Donation_${crypto.randomUUID()}`;

		await Promise.all(Array.from({ length: 30 }, () => post_json(
			'/api/charity/donate',
			{ items: [{ id: item_id, qty: 2 }] },
			donor.session_token
		)));
		const rows = await db_all<{ qty: number }>(
			'SELECT `qty` FROM `charity_items` WHERE `item_id` = ?',
			[item_id]
		);

		expect(rows).toEqual([{ qty: 60 }]);
	});

	test('adds concurrent campaign contributions without losing quantities', async () => {
		const contributor = await register_guild_client('Concurrent Campaign Contributor');
		const before = await get_json_with_session<{ contribution: number }>(
			'/api/campaign/info',
			contributor.session_token
		);

		const results = await Promise.all(Array.from({ length: 20 }, () => post_json<OperationResult>(
			'/api/campaign/contribute',
			{ item_amount: 1 },
			contributor.session_token
		)));
		const after = await get_json_with_session<{ contribution: number }>(
			'/api/campaign/info',
			contributor.session_token
		);

		expect(results.every(result => result.json.success)).toBe(true);
		expect(results.reduce((total, result) => total + (result.json.item_loss ?? 0), 0)).toBe(20);
		expect(after.json.contribution - before.json.contribution).toBe(20);
	});
});
