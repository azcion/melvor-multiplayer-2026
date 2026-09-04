import { expect, test } from 'bun:test';
import { get_events } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import { read_restart_state } from '../support/restart-state';

test('rebuilds caches and preserves API state after a server restart', async () => {
	const state = await read_restart_state();
	const existing_installation = await get_json_with_session('/api/events', state.installation.session_token);
	expect(existing_installation.response.status).toBe(200);
	const reauthenticated = await post_json<{ session_token: string }>('/api/authenticate', {
		client_identifier: state.installation.client_identifier, installation_id: state.installation.installation_id,
		installation_key: state.installation.installation_key
	});
	expect(reauthenticated.response.status).toBe(200);
	expect((await get_json_with_session('/api/events', reauthenticated.json.session_token)).response.status).toBe(200);
	const first_events = await get_events(state.first);
	const second_events = await get_events(state.second);
	const inbox = await get_json_with_session<{
		items: Array<{ item_id: string; qty: number }>;
	}>('/api/inbox', state.campaign_history_client.session_token);
	const guild = await get_json_with_session<{
		members: Array<{
			client_id: number;
			display_name: string;
			account_age: number | null;
			total_skill_level: number | null;
			gp: number | null;
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
	const campaign_history = await get_json_with_session<{
		history: Array<{ id: number; campaign_id: string; taken: number }>;
		rankings: Record<string, number>;
	}>('/api/campaign/info', state.campaign_history_client.session_token);
	const equipment = await get_json_with_session<{
		client_id: number;
		slots: Array<{ slot_id: string; item_id: string }>;
	}>(`/api/guilds/equipment?client_id=${state.first_id}`, state.second.session_token);
	const status = await get_json_with_session<{
		client_id: number;
		skills: Array<{ skill_id: string; level: number }>;
		activity: { type: 'skill'; skill_id: string; action_id: string };
		activities: Array<
			| { type: 'skill'; skill_id: string; action_id: string }
			| { type: 'combat'; area_id: string | null }
		>;
	}>(`/api/guilds/status?client_id=${state.first_id}`, state.second.session_token);
	const chat = await get_json_with_session<{
		conversations: Array<{
			conversation_id: number;
			blocked: boolean;
		}>;
	}>('/api/chat/conversations', state.second.session_token);
	const chat_messages = await get_json_with_session<{
		messages: Array<{ message_id: number; content: string }>;
	}>(`/api/chat/messages?conversation_id=${state.chat_conversation_id}`, state.second.session_token);
	const chat_state = await get_json_with_session<{
		messaging_enabled: boolean;
		guild_chat_enabled: boolean;
		budget_enabled: boolean;
		budget: { credits: number };
	}>('/api/chat/state', state.first.session_token);
	const guild_inbox = await get_json_with_session<{
		guild_chat: { affiliated: boolean; enabled: boolean };
		conversations: Array<{ conversation_kind: string }>;
	}>('/api/chat/conversations?capabilities=guild-chat-v1', state.first.session_token);
	const guild_messages = await get_json_with_session<{
		messages: Array<{ message_id: number; content: string }>;
	}>(`/api/chat/messages?conversation_kind=guild&conversation_id=${state.guild_id}`,
		state.second.session_token);
	const support_inbox = await get_json_with_session<{
		conversations: Array<{ conversation_kind: string; conversation_id: number; participant: { display_name: string } }>;
	}>('/api/chat/conversations', state.support_member.session_token);
	const support_messages = await get_json_with_session<{
		messages: Array<{ content: string }>;
	}>(`/api/chat/messages?conversation_kind=support&conversation_id=${state.support_conversation_id}`,
		state.support_member.session_token);
	const raid = await get_json_with_session<{
		raid: {
			raid_id: number;
			remaining_health: number;
			member: { contribution: number; successful_assaults: number; assaults: number };
		};
	}>('/api/raids/state', state.first.session_token);
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
			client_id: state.first_id,
			total_skill_level: state.status_total_skill_level,
			gp: state.gp_amount
		}),
		expect.objectContaining({
			client_id: state.second_id,
			display_name: 'Restart Second'
		})
	]));
	expect(transfers.json.gifts).toHaveProperty(String(state.gift_id));
	expect(transfers.json.trades).toHaveProperty(String(state.trade_id));
	expect(inbox.json.items).toEqual([{ item_id: 'melvorD:GP', qty: 321 }]);
	expect(market.json.items).toContainEqual(expect.objectContaining({
		id: state.market_lot_id,
		item_id: state.market_item_id
	}));
	expect(charity.json.items).toContainEqual(expect.objectContaining({
		id: state.charity_item_id,
		qty: 11
	}));
	expect(campaign.json.active).toBe(true);
	expect(campaign.json.contribution).toBe(state.campaign_contribution);
	expect(campaign_history.json.history).toContainEqual(expect.objectContaining({
		id: state.campaign_completion_id,
		campaign_id: state.campaign_completion_type,
		taken: 321
	}));
	expect(campaign_history.json.rankings[state.campaign_completion_type]).toBe(1);
	expect(equipment.json).toEqual({ client_id: state.first_id, slots: state.equipment_slots });
	expect(status.json).toEqual({
		client_id: state.first_id,
		skills: state.status_skills,
		activity: state.status_activity,
		activities: state.status_activities
	});
	expect(chat.json.conversations).toContainEqual(expect.objectContaining({
		conversation_id: state.chat_conversation_id,
		blocked: true
	}));
	expect(chat_messages.json.messages).toContainEqual(expect.objectContaining({
		message_id: state.chat_message_id,
		content: 'Restart-safe private Message'
	}));
	expect(chat_state.json.messaging_enabled).toBe(false);
	expect(chat_state.json.guild_chat_enabled).toBe(false);
	expect(chat_state.json.budget_enabled).toBe(false);
	expect(chat_state.json.budget.credits).toBe(5);
	expect(guild_inbox.json.guild_chat).toEqual({ affiliated: true, enabled: false });
	expect(guild_inbox.json.conversations.some(conversation => conversation.conversation_kind === 'guild')).toBe(false);
	expect(guild_messages.json.messages).toContainEqual(expect.objectContaining({
		message_id: state.guild_chat_message_id,
		content: 'Restart-safe Guild Message'
	}));
	expect(support_inbox.json.conversations).toContainEqual(expect.objectContaining({
		conversation_kind: 'support', conversation_id: state.support_conversation_id,
		participant: expect.objectContaining({ display_name: 'Restart Player @mp' })
	}));
	expect(support_messages.json.messages).toContainEqual(expect.objectContaining({
		content: 'Restart-safe Support Message'
	}));
	expect(raid.json.raid).toMatchObject({
		raid_id: state.raid_id,
		remaining_health: 8_000,
		member: { contribution: 1_000, successful_assaults: 1, assaults: 2 }
	});
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
