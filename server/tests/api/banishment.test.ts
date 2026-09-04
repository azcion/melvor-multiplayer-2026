import { describe, expect, test } from 'bun:test';
import { get_events, make_guild_group, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import { db_count, db_run } from '../support/persistence';

type Claim = {
	claim_id: string;
	items: Array<{ id: string; qty: number }>;
	gp: number;
	banished: null | { guild_name: string };
};

async function claim_return(session_token: string, existing_item_ids: string[], available_slots: number) {
	return post_json<{ claim: Claim | null }>('/api/banishment/returns/claim', {
		existing_item_ids,
		available_slots
	}, session_token);
}

async function acknowledge_return(session_token: string, claim_id: string) {
	return post_json<{ success: boolean }>('/api/banishment/returns/acknowledge', {
		claim_id
	}, session_token);
}

async function raise_banishment(session_token: string, target_client_id: number) {
	return post_json<{ success: boolean; petition_id: number }>('/api/guilds/petitions/raise', {
		type: 'banishment',
		target_client_id
	}, session_token);
}

async function vote_aye(session_token: string, petition_id: number) {
	return post_json<{ success: boolean; lifecycle: string }>('/api/guilds/petitions/vote', {
		petition_id,
		choice: 'aye'
	}, session_token);
}

describe('Banishment execution and returns', () => {
	test('removes the exact member and durably returns market and both trade escrows', async () => {
		const [petitioner, target, buyer, counterpart] = await make_guild_group(
			['Banish Petitioner', 'Banish Target', 'Banish Buyer', 'Banish Counterpart'],
			'Banish Guild'
		);
		await post_json('/api/market/sell', {
			item_id: 'melvorD:Banish_Market',
			item_qty: 10,
			item_sell_price: 5
		}, target.session_token);
		const listings = await get_json_with_session<{ items: Array<{ id: number }> }>(
			'/api/market/listings', target.session_token
		);
		await post_json('/api/market/buy', {
			id: listings.json.items[0].id,
			qty: 4
		}, buyer.session_token);

		const active_trade = await post_json<{ trade_id: number }>('/api/trade/offer', {
			recipient_id: counterpart.client_id,
			items: [{ id: 'melvorD:Banish_Offer', qty: 2 }]
		}, target.session_token);
		await post_json('/api/trade/counter', {
			trade_id: active_trade.json.trade_id,
			items: [{ id: 'melvorF:Banish_Counter', qty: 3 }]
		}, counterpart.session_token);

		const resolved_trade = await post_json<{ trade_id: number }>('/api/trade/offer', {
			recipient_id: buyer.client_id,
			items: [{ id: 'melvorD:Banish_Resolved', qty: 4 }]
		}, target.session_token);
		await post_json('/api/trade/decline', {
			trade_id: resolved_trade.json.trade_id
		}, buyer.session_token);
		await post_json('/api/gift/send', {
			recipient_id: target.client_id,
			items: [{ id: 'melvorD:Banish_Gift', qty: 5 }]
		}, petitioner.session_token);

		const petition = await raise_banishment(petitioner.session_token, target.client_id);
		await vote_aye(petitioner.session_token, petition.json.petition_id);
		const granted = await vote_aye(buyer.session_token, petition.json.petition_id);
		expect(granted.json.lifecycle).toBe('granted');
		expect((await get_json_with_session<{ affiliation: string }>(
			'/api/guilds/state', target.session_token
		)).json.affiliation).toBe('none');
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `market_items` WHERE `client_id` = ?', [target.client_id]))
			.toBe(0);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `trade_offers` WHERE `trade_id` = ?', [active_trade.json.trade_id]))
			.toBe(0);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `banishment_returns` WHERE `petition_id` = ?',
			[petition.json.petition_id]
		)).toBe(2);
		await db_run(
			"UPDATE `guild_petitions` SET `execution_state` = 'running', `execution_last_attempt_at` = 0, " +
			'`subject_locked` = 1 WHERE `id` = ?',
			[petition.json.petition_id]
		);
		await get_json_with_session('/api/guilds/council', petitioner.session_token);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `banishment_returns` WHERE `petition_id` = ?',
			[petition.json.petition_id]
		)).toBe(2);

		const target_events = await get_events(target);
		expect(target_events.trades).toEqual([]);
		expect(target_events.gifts).toHaveLength(1);
		expect(target_events.resolved_trades).toEqual([]);
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
		'/api/inbox', target.session_token
	)).json.items).toContainEqual({ item_id: 'melvorD:Banish_Resolved', qty: 4 });

		const first_claim = await claim_return(target.session_token, ['melvorD:Banish_Offer'], 0);
		expect(first_claim.json.claim).toMatchObject({
			items: [{ id: 'melvorD:Banish_Offer', qty: 2 }],
			gp: 0,
			banished: { guild_name: 'Banish Guild' }
		});
		const replay = await claim_return(target.session_token, [], 32);
		expect(replay.json.claim).toEqual(first_claim.json.claim);
		await acknowledge_return(target.session_token, first_claim.json.claim?.claim_id as string);
		expect((await acknowledge_return(
			target.session_token,
			first_claim.json.claim?.claim_id as string
		)).json.success).toBe(true);

		const gp_claim = await claim_return(target.session_token, [], 1);
		expect(gp_claim.json.claim).toMatchObject({ items: [], gp: 20, banished: null });
		await acknowledge_return(target.session_token, gp_claim.json.claim?.claim_id as string);
		const market_claim = await claim_return(target.session_token, [], 1);
		expect(market_claim.json.claim).toMatchObject({
			items: [{ id: 'melvorD:Banish_Market', qty: 6 }],
			gp: 0
		});

		const counter_claim = await claim_return(counterpart.session_token, [], 1);
		expect(counter_claim.json.claim).toMatchObject({
			items: [{ id: 'melvorF:Banish_Counter', qty: 3 }],
			gp: 0,
			banished: null
		});

		const accepted_gift = await post_json<{ success: boolean }>('/api/gift/accept', {
			gift_id: target_events.gifts[0]
		}, target.session_token);
		expect(accepted_gift.json.success).toBe(true);
	});

	test('does not remove a later membership when the targeted tenure already ended', async () => {
		const [petitioner, target, voter] = await make_guild_group(
			['Tenure Petitioner', 'Tenure Target', 'Tenure Voter'],
			'Tenure Origin'
		);
		const petition = await raise_banishment(petitioner.session_token, target.client_id);
		await post_json('/api/guilds/leave', {}, target.session_token);
		const new_guild = await post_json<{ guild: { guild_id: number } }>('/api/guilds/create', {
			name: 'Later Guild',
			icon_id: 'melvorD:Farmlands'
		}, target.session_token);

		await vote_aye(petitioner.session_token, petition.json.petition_id);
		await vote_aye(voter.session_token, petition.json.petition_id);
		const target_state = await get_json_with_session<{
			affiliation: string;
			guild: { guild_id: number };
		}>('/api/guilds/state', target.session_token);
		expect(target_state.json).toMatchObject({
			affiliation: 'member',
			guild: { guild_id: new_guild.json.guild.guild_id }
		});
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `banishment_returns` WHERE `petition_id` = ?',
			[petition.json.petition_id]
		)).toBe(0);
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guild_petitions` WHERE `id` = ? AND `execution_effect` = 'already_absent'",
			[petition.json.petition_id]
		)).toBe(1);
	});

	test('dissolves a one-member Guild after self-banishment and retains its return', async () => {
		const member = await register_guild_client('Self Banish', 'Self Banish Guild');
		const petition = await raise_banishment(member.session_token, member.client_id);
		const granted = await vote_aye(member.session_token, petition.json.petition_id);
		expect(granted.json.lifecycle).toBe('granted');
		expect((await get_json_with_session<{ affiliation: string }>(
			'/api/guilds/state', member.session_token
		)).json.affiliation).toBe('none');
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guilds` WHERE `id` = ?', [member.guild_id])).toBe(0);
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guild_petitions` WHERE `id` = ? AND `execution_state` = 'succeeded'",
			[petition.json.petition_id]
		)).toBe(1);

		const claim = await claim_return(member.session_token, [], 0);
		expect(claim.json.claim).toMatchObject({
			items: [],
			gp: 0,
			banished: { guild_name: 'Self Banish Guild' }
		});
	});
});
