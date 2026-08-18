import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates } from '../support/fixtures';
import { post, post_json, register_client } from '../support/http';

type TradeContents = {
	gifts: Record<string, unknown>;
	trades: Record<string, {
		items: Array<{
			id: number;
			item_id: string;
			qty: number;
			counter: number;
		}>;
		other_player: {
			display_name: string;
			icon_id: string;
		};
	}>;
	resolved_trades: Record<string, {
		items: Array<{
			id: number;
			item_id: string;
			qty: number;
			counter: number;
		}>;
		declined: boolean;
		other_player: {
			display_name: string;
			icon_id: string;
		};
	}>;
};

async function get_trade_contents(
	session_token: string,
	trade_ids: number[] = [],
	resolved_trade_ids: number[] = []
) {
	return post_json<TradeContents>('/api/transfers/get_contents', {
		gift_ids: [],
		trade_ids,
		resolved_trade_ids
	}, session_token);
}

async function offer_trade(
	session_token: string,
	recipient_id: number,
	items = [{ id: 'melvorD:Iron_Ore', qty: 10 }]
) {
	return post_json<{
		success: boolean;
		trade_id: number;
		error_lang?: string;
	}>('/api/trade/offer', {
		recipient_id,
		items
	}, session_token);
}

describe('trade API', () => {
	test('validates trade items, guild membership, and duplicate active offers', async () => {
		const pair = await make_guildmates('Trade Validation Sender', 'Trade Validation Recipient');
		const invalid = await post('/api/trade/offer', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Iron_Ore', qty: 0 }]
		}, pair.first.session_token);
		const fractional = await post('/api/trade/offer', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Iron_Ore', qty: 0.5 }]
		}, pair.first.session_token);
		const too_many = await post('/api/trade/offer', {
			recipient_id: pair.second_id,
			items: Array.from({ length: 33 }, (_, index) => ({ id: `melvorD:Trade_Item_${index}`, qty: 1 }))
		}, pair.first.session_token);
		const offered = await offer_trade(pair.first.session_token, pair.second_id,
			Array.from({ length: 32 }, (_, index) => ({ id: `melvorD:Allowed_Trade_Item_${index}`, qty: 1 })));
		const duplicate = await offer_trade(pair.first.session_token, pair.second_id);

		expect(invalid.status).toBe(400);
		expect(fractional.status).toBe(400);
		expect(too_many.status).toBe(400);
		expect(offered.json.success).toBe(true);
		expect(duplicate.json.error_lang).toBe('MOD_MP_TRADE_EXISTS');

		await post_json('/api/trade/decline', {
			trade_id: offered.json.trade_id
		}, pair.second.session_token);
		await post_json('/api/trade/resolve', {
			trade_id: offered.json.trade_id
		}, pair.first.session_token);
		await post_json('/api/guilds/leave', {}, pair.second.session_token);

		const non_friend = await offer_trade(pair.first.session_token, pair.second_id);

		expect(non_friend.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
	});

	test('offers, counters, accepts, and resolves a trade', async () => {
		const pair = await make_guildmates('Trade Sender', 'Trade Recipient');
		const outsider = await register_client('Trade Outsider');
		const offered = await offer_trade(pair.first.session_token, pair.second_id, [
			{ id: 'melvorD:Iron_Ore', qty: 10 },
			{ id: 'exampleMod:Trade_Item', qty: 2 }
		]);
		const trade_id = offered.json.trade_id;
		const sender_events = await get_events(pair.first);
		const recipient_events = await get_events(pair.second);
		const sender_contents = await get_trade_contents(pair.first.session_token, [trade_id]);
		const recipient_contents = await get_trade_contents(pair.second.session_token, [trade_id]);
		const outsider_contents = await get_trade_contents(outsider.session_token, [trade_id]);
		const premature_accept = await post('/api/trade/accept', {
			trade_id
		}, pair.first.session_token);

		expect(offered.json.success).toBe(true);
		expect(sender_events.trades).toEqual([{ trade_id, attending: false, state: 0 }]);
		expect(recipient_events.trades).toEqual([{ trade_id, attending: true, state: 0 }]);
		expect(sender_contents.json.trades[String(trade_id)]).toMatchObject({
			items: [
				{ item_id: 'melvorD:Iron_Ore', qty: 10, counter: 0 },
				{ item_id: 'exampleMod:Trade_Item', qty: 2, counter: 0 }
			],
			other_player: {
				display_name: 'Trade Recipient',
				icon_id: pair.second.icon_id
			}
		});
		expect(recipient_contents.json.trades[String(trade_id)].other_player).toEqual({
			display_name: 'Trade Sender',
			icon_id: pair.first.icon_id
		});
		expect(outsider_contents.json.trades).toEqual({});
		expect(premature_accept.status).toBe(400);

		const countered = await post_json<{ success: boolean }>('/api/trade/counter', {
			trade_id,
			items: [{ id: 'melvorF:Air_Rune', qty: 50 }]
		}, pair.second.session_token);
		const sender_counter_events = await get_events(pair.first);
		const recipient_counter_events = await get_events(pair.second);
		const counter_contents = await get_trade_contents(pair.first.session_token, [trade_id]);

		expect(countered.json.success).toBe(true);
		expect(sender_counter_events.trades).toEqual([{ trade_id, attending: true, state: 1 }]);
		expect(recipient_counter_events.trades).toEqual([{ trade_id, attending: false, state: 1 }]);
		expect(counter_contents.json.trades[String(trade_id)].items).toEqual([
			expect.objectContaining({ item_id: 'melvorD:Iron_Ore', qty: 10, counter: 0 }),
			expect.objectContaining({ item_id: 'exampleMod:Trade_Item', qty: 2, counter: 0 }),
			expect.objectContaining({ item_id: 'melvorF:Air_Rune', qty: 50, counter: 1 })
		]);

		const accepted = await post_json<{ success: boolean }>('/api/trade/accept', {
			trade_id
		}, pair.first.session_token);
		const resolved_events = await get_events(pair.second);
		const resolved_contents = await get_trade_contents(pair.second.session_token, [], [trade_id]);

		expect(accepted.json.success).toBe(true);
		expect((await get_events(pair.first)).trades).toEqual([]);
		expect(resolved_events.trades).toEqual([]);
		expect(resolved_events.resolved_trades).toEqual([trade_id]);
		expect(resolved_contents.json.resolved_trades[String(trade_id)]).toMatchObject({
			items: [
				{ item_id: 'melvorD:Iron_Ore', qty: 10, counter: 0 },
				{ item_id: 'exampleMod:Trade_Item', qty: 2, counter: 0 }
			],
			declined: false,
			other_player: {
				display_name: 'Trade Sender',
				icon_id: pair.first.icon_id
			}
		});

		const resolved = await post_json<{ success: boolean }>('/api/trade/resolve', {
			trade_id
		}, pair.second.session_token);

		expect(resolved.json.success).toBe(true);
		expect((await get_events(pair.second)).resolved_trades).toEqual([]);
		expect((await get_trade_contents(pair.second.session_token, [], [trade_id])).json.resolved_trades).toEqual({});
	});

	test('declines an offer and returns its items to the sender', async () => {
		const pair = await make_guildmates('Declined Trade Sender', 'Declined Trade Recipient');
		const offered = await offer_trade(pair.first.session_token, pair.second_id);
		const trade_id = offered.json.trade_id;
		const unauthorized = await post('/api/trade/decline', {
			trade_id
		}, pair.first.session_token);
		const declined = await post_json<{ success: boolean }>('/api/trade/decline', {
			trade_id
		}, pair.second.session_token);
		const contents = await get_trade_contents(pair.first.session_token, [], [trade_id]);

		expect(unauthorized.status).toBe(400);
		expect(declined.json.success).toBe(true);
		expect((await get_events(pair.second)).trades).toEqual([]);
		expect((await get_events(pair.first)).resolved_trades).toEqual([trade_id]);
		expect(contents.json.resolved_trades[String(trade_id)]).toMatchObject({
			items: [{ item_id: 'melvorD:Iron_Ore', qty: 10, counter: 0 }],
			declined: true
		});
	});

	test('identifies the recipient on a declined trade returned to its sender', async () => {
		const pair = await make_guildmates('Trade Sender', 'Trade Recipient');
		const offered = await offer_trade(pair.first.session_token, pair.second_id);
		await post_json('/api/trade/decline', {
			trade_id: offered.json.trade_id
		}, pair.second.session_token);
		const contents = await get_trade_contents(pair.first.session_token, [], [offered.json.trade_id]);

		expect(contents.json.resolved_trades[String(offered.json.trade_id)].other_player.display_name)
			.toBe('Trade Recipient');
	});

	test('enforces cancellation ownership and removes an initial offer', async () => {
		const initial_pair = await make_guildmates('Initial Cancel Sender', 'Initial Cancel Recipient');
		const initial = await offer_trade(initial_pair.first.session_token, initial_pair.second_id);
		const recipient_cancel = await post('/api/trade/cancel', {
			trade_id: initial.json.trade_id
		}, initial_pair.second.session_token);
		const initial_cancel = await post_json<{ success: boolean }>('/api/trade/cancel', {
			trade_id: initial.json.trade_id
		}, initial_pair.first.session_token);

		expect(recipient_cancel.status).toBe(400);
		expect(initial_cancel.json.success).toBe(true);
		expect((await get_events(initial_pair.first)).trades).toEqual([]);
		expect((await get_events(initial_pair.second)).trades).toEqual([]);
	});

	test('cancels a countered offer and returns the original items', async () => {
		const counter_pair = await make_guildmates('Counter Cancel Sender', 'Counter Cancel Recipient');
		const counter = await offer_trade(counter_pair.first.session_token, counter_pair.second_id);
		await post_json('/api/trade/counter', {
			trade_id: counter.json.trade_id,
			items: [{ id: 'melvorF:Water_Rune', qty: 40 }]
		}, counter_pair.second.session_token);
		const counter_cancel = await post_json<{ success: boolean }>('/api/trade/cancel', {
			trade_id: counter.json.trade_id
		}, counter_pair.second.session_token);
		const counter_contents = await get_trade_contents(
			counter_pair.first.session_token,
			[],
			[counter.json.trade_id]
		);

		expect(counter_cancel.json.success).toBe(true);
		expect(counter_contents.json.resolved_trades[String(counter.json.trade_id)]).toMatchObject({
			items: [{ item_id: 'melvorD:Iron_Ore', qty: 10, counter: 0 }],
			declined: true
		});
	});

	test('returns original items when the sender cancels an initial offer', async () => {
		const pair = await make_guildmates('Initial Return Sender', 'Initial Return Recipient');
		const offered = await offer_trade(pair.first.session_token, pair.second_id);
		await post_json('/api/trade/cancel', {
			trade_id: offered.json.trade_id
		}, pair.first.session_token);
		const contents = await get_trade_contents(pair.first.session_token, [], [offered.json.trade_id]);

		expect(contents.json.resolved_trades[String(offered.json.trade_id)]).toMatchObject({
			items: [{ item_id: 'melvorD:Iron_Ore', qty: 10, counter: 0 }],
			declined: true
		});

		const resolved = await post_json<{ success: boolean }>('/api/trade/resolve', {
			trade_id: offered.json.trade_id
		}, pair.first.session_token);

		expect(resolved.json.success).toBe(true);
		expect((await get_events(pair.first)).resolved_trades).toEqual([]);
		expect((await get_trade_contents(pair.first.session_token, [], [offered.json.trade_id])).json.resolved_trades)
			.toEqual({});
	});
});
