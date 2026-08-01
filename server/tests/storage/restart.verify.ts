import { expect, test } from 'bun:test';
import { get_events } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import { read_restart_state } from '../support/restart-state';

test('rebuilds caches and preserves API state after a server restart', async () => {
	const state = await read_restart_state();
	const first_events = await get_events(state.first);
	const second_events = await get_events(state.second);
	const guild = await get_json_with_session<{
		members: Array<{
			client_id: number;
			display_name: string;
		}>;
	}>('/api/guilds/state', state.first.session_token);
	const transfers = await post_json<{
		gifts: Record<string, unknown>;
		trades: Record<string, unknown>;
		resolved_trades: Record<string, unknown>;
	}>('/api/transfers/get_contents', {
		gift_ids: [state.gift_id],
		trade_ids: [state.trade_id],
		resolved_trade_ids: []
	}, state.second.session_token);
	const market = await get_json_with_session<{
		items: Array<{
			id: number;
			item_id: string;
		}>;
	}>('/api/market/listings', state.first.session_token);
	const charity = await get_json_with_session<{
		items: Array<{
			id: string;
			qty: number;
		}>;
	}>('/api/charity/contents', state.first.session_token);
	const campaign = await get_json_with_session<{
		active: boolean;
		contribution: number;
	}>('/api/campaign/info', state.first.session_token);
	const equipment = await get_json_with_session<{
		client_id: number;
		slots: Array<{ slot_id: string; item_id: string }>;
	}>(`/api/guilds/equipment?client_id=${state.first_id}`, state.second.session_token);
	const council = await get_json_with_session<{
		petitions: Array<{
			petition_id: number;
			lifecycle: string;
			execution_state: string;
		}>;
	}>('/api/guilds/council', state.first.session_token);
	const guild_after_retry = await get_json_with_session<{
		guild: { icon_id: string };
	}>('/api/guilds/state', state.first.session_token);
	const banished_events = await get_events(state.banished);
	const banishment_return = await post_json<{
		claim: {
			claim_id: string;
			items: Array<{ id: string; qty: number }>;
			gp: number;
			banished: { guild_name: string } | null;
		} | null;
	}>('/api/banishment/returns/claim', {
		existing_item_ids: [],
		available_slots: 32
	}, state.banished.session_token);

	expect(first_events.trades).toEqual([{
		trade_id: state.trade_id,
		attending: false,
		state: 0
	}]);
	expect(second_events.gifts).toEqual([state.gift_id]);
	expect(second_events.trades).toEqual([{
		trade_id: state.trade_id,
		attending: true,
		state: 0
	}]);
	expect(guild.json.members).toEqual(expect.arrayContaining([
		expect.objectContaining({
			client_id: state.second_id,
			display_name: 'Restart Second'
		})
	]));
	expect(transfers.json.gifts).toHaveProperty(String(state.gift_id));
	expect(transfers.json.trades).toHaveProperty(String(state.trade_id));
	expect(market.json.items).toContainEqual(expect.objectContaining({
		id: state.market_lot_id,
		item_id: state.market_item_id
	}));
	expect(charity.json.items).toContainEqual({
		id: state.charity_item_id,
		qty: 11
	});
	expect(campaign.json.active).toBe(true);
	expect(campaign.json.contribution).toBe(state.campaign_contribution);
	expect(equipment.json).toEqual({ client_id: state.first_id, slots: state.equipment_slots });
	expect(council.json.petitions).toContainEqual(expect.objectContaining({
		petition_id: state.active_petition_id,
		lifecycle: 'active'
	}));
	expect(council.json.petitions).toContainEqual(expect.objectContaining({
		petition_id: state.retry_petition_id,
		lifecycle: 'granted',
		execution_state: 'succeeded'
	}));
	expect(guild_after_retry.json.guild.icon_id).toBe('melvorF:Penumbra');
	expect(banished_events.banishment_return_pending).toBe(true);
	expect(banishment_return.json.claim).toMatchObject({
		items: [{ id: state.banishment_item_id, qty: 13 }],
		gp: 0,
		banished: { guild_name: 'Restart Banish Guild' }
	});
});
