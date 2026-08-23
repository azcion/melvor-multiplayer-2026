import { expect, test } from 'bun:test';
import { get_events, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, register_client } from '../support/http';
import { db_run } from '../support/persistence';
import { restart_state_path } from '../support/restart-state';
import type { RestartState } from '../support/restart-state';
import { wait_for } from '../support/wait';

test('creates representative state before a server restart', async () => {
	const pair = await make_guildmates('Restart First', 'Restart Second');
	await post_json('/api/gift/send', {
		recipient_id: pair.second_id,
		items: [{ id: 'melvorD:Restart_Gift', qty: 7 }]
	}, pair.first.session_token);
	const gift_id = (await get_events(pair.second)).gifts[0];

	const offered = await post_json<{
		trade_id: number;
	}>('/api/trade/offer', {
		recipient_id: pair.second_id,
		items: [{ id: 'melvorD:Restart_Trade', qty: 8 }]
	}, pair.first.session_token);

	const market_item_id = 'melvorD:Restart_Market';
	await post_json('/api/market/sell', {
		item_id: market_item_id,
		item_qty: 9,
		item_sell_price: 10
	}, pair.first.session_token);
	const market = await wait_for(
		async () => (await get_json_with_session<{
			items: Array<{
				id: number;
				item_id: string;
			}>;
		}>('/api/market/listings', pair.first.session_token)).json,
		listings => listings.items.some(item => item.item_id === market_item_id)
	);
	const market_lot_id = market.items.find(item => item.item_id === market_item_id)?.id as number;

	const charity_item_id = 'melvorD:Restart_Charity';
	await post_json('/api/charity/donate', {
		items: [{ id: charity_item_id, qty: 11 }]
	}, pair.first.session_token);

	const campaign_contribution = 7;
	await post_json('/api/campaign/contribute', {
		item_amount: campaign_contribution
	}, pair.first.session_token);
	const campaign_history_client = await register_guild_client('Restart Campaign', 'Restart History');
	const campaign_to_complete = await get_json_with_session<{
		campaign_id: string;
		item_total: number;
	}>('/api/campaign/info', campaign_history_client.session_token);
	await post_json('/api/campaign/contribute', {
		item_amount: campaign_to_complete.json.item_total
	}, campaign_history_client.session_token);
	const completed_campaign = await get_json_with_session<{
		history: Array<{ id: number; campaign_id: string }>;
	}>('/api/campaign/info', campaign_history_client.session_token);
	const campaign_completion_id = completed_campaign.json.history[0].id;
	const equipment_slots = [
		{ slot_id: 'melvorD:Helmet', item_id: 'melvorD:Restart_Helmet' },
		{ slot_id: 'melvorD:Weapon', item_id: 'melvorD:Restart_Weapon' }
	];
	await post_json('/api/client/equipment/sync', { slots: equipment_slots }, pair.first.session_token);
	const status_skills = [
		{ skill_id: 'melvorD:Attack', level: 77 },
		{ skill_id: 'melvorD:Woodcutting', level: 33 }
	];
	const status_activity = { type: 'skill' as const, skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Restart_Oak' };
	const status_activities = [
		status_activity,
		{ type: 'combat' as const, area_id: 'melvorD:Volcanic_Cave' }
	];
	const gp_amount = 142_609;
	await post_json('/api/client/status/sync', {
		skills: status_skills,
		activity: status_activity,
		activities: status_activities,
		gp: gp_amount
	}, pair.first.session_token);
	const chat = await post_json<{
		conversation: { conversation_id: number | null };
	}>('/api/chat/conversations/start', { client_id: pair.second_id }, pair.first.session_token);
	const chat_message = await post_json<{
		message: { message_id: number; conversation_id: number };
	}>('/api/chat/messages/send', {
		conversation_id: chat.json.conversation.conversation_id,
		client_id: pair.second_id,
		idempotency_key: crypto.randomUUID(),
		content: 'Restart-safe private Message'
	}, pair.first.session_token);
	await post_json('/api/chat/block', {
		client_id: pair.first_id,
		blocked: true
	}, pair.second.session_token);
	await post_json('/api/chat/privacy', { messaging_enabled: false }, pair.first.session_token);
	const guild_chat_message = await post_json<{ message: { message_id: number } }>('/api/chat/messages/send', {
		conversation_kind: 'guild',
		conversation_id: pair.guild_id,
		client_id: null,
		idempotency_key: crypto.randomUUID(),
		content: 'Restart-safe Guild Message'
	}, pair.first.session_token);
	await post_json('/api/chat/guild-participation', { enabled: false }, pair.first.session_token);
	const support_player = await register_client('Restart Support Player');
	const support_profile = await post_json('/api/client/set_display_name', {
		display_name: 'Restart Player'
	}, support_player.session_token);
	expect(support_profile.response.status).toBe(200);
	const support_member = await register_client('Restart Support Member', {
		cloud_username: 'RestartSupportCloud', playfab_id: 'RESTART-SUPPORT-ID'
	});
	await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?', [
		'RESTART-SUPPORT-CLIENT',
		support_member.client_id
	]);
	support_member.client_identifier = 'RESTART-SUPPORT-CLIENT';
	const support_inbox = await get_json_with_session<{
		conversations: Array<{ conversation_kind: string; support_team_id: number }>;
	}>('/api/chat/conversations', support_player.session_token);
	const support_team_id = support_inbox.json.conversations.find(entry =>
		entry.conversation_kind === 'support')?.support_team_id as number;
	const support_message = await post_json<{ message: { conversation_id: number } }>('/api/chat/messages/send', {
		conversation_kind: 'support', conversation_id: null, support_team_id,
		idempotency_key: crypto.randomUUID(), content: 'Restart-safe Support Message'
	}, support_player.session_token);
	const raid_activation = await post_json<{ raid: { raid_id: number } }>(
		'/api/raids/activate', {}, pair.first.session_token
	);
	const raid_assault = await post_json<{
		assault_id: string;
		settlement_key: string;
		combat_deadline: number;
	}>('/api/raids/assaults/reserve', {
		tier: 1,
		loaded_session_id: crypto.randomUUID()
	}, pair.first.session_token);
	await post_json('/api/raids/assaults/settle', {
		assault_id: raid_assault.json.assault_id,
		settlement_key: raid_assault.json.settlement_key,
		outcome: 'success',
		occurred_at: Math.min(Date.now(), raid_assault.json.combat_deadline)
	}, pair.first.session_token);

	const active_petition = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', {
		type: 'appellation',
		name: 'Restart Council Name'
	}, pair.first.session_token);
	const retry_petition = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', {
		type: 'heraldry',
		icon_id: 'melvorF:Penumbra'
	}, pair.first.session_token);
	await post_json('/api/guilds/petitions/vote', {
		petition_id: retry_petition.json.petition_id,
		choice: 'aye'
	}, pair.first.session_token);
	await db_run("UPDATE `guilds` SET `icon_id` = 'melvorD:Farmlands' WHERE `id` = ?", [pair.guild_id]);
	await db_run(
		"UPDATE `guild_petitions` SET `execution_state` = 'running', `execution_last_attempt_at` = 0, " +
		'`subject_locked` = 1 WHERE `id` = ?',
		[retry_petition.json.petition_id]
	);

	const banished = await register_guild_client('Restart Banished', 'Restart Banish Guild');
	const banishment_item_id = 'melvorD:Restart_Banishment';
	await post_json('/api/market/sell', {
		item_id: banishment_item_id,
		item_qty: 13,
		item_sell_price: 2
	}, banished.session_token);
	const banishment = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', {
		type: 'banishment',
		target_client_id: banished.client_id
	}, banished.session_token);
	await post_json('/api/guilds/petitions/vote', {
		petition_id: banishment.json.petition_id,
		choice: 'aye'
	}, banished.session_token);

	const state: RestartState = {
		...pair,
		gift_id,
		trade_id: offered.json.trade_id,
		market_item_id,
		market_lot_id,
		charity_item_id,
		campaign_contribution,
		campaign_history_client,
		campaign_completion_id,
		campaign_completion_type: campaign_to_complete.json.campaign_id,
		equipment_slots,
		status_skills,
		status_activity,
		status_activities,
		gp_amount,
		chat_conversation_id: chat_message.json.message.conversation_id,
		chat_message_id: chat_message.json.message.message_id,
		guild_id: pair.guild_id,
		guild_chat_message_id: guild_chat_message.json.message.message_id,
		active_petition_id: active_petition.json.petition_id,
		retry_petition_id: retry_petition.json.petition_id,
		banished,
		banishment_petition_id: banishment.json.petition_id,
		banishment_item_id,
		raid_id: raid_activation.json.raid.raid_id,
		raid_assault_id: raid_assault.json.assault_id,
		support_player,
		support_member,
		support_conversation_id: support_message.json.message.conversation_id
	};
	await Bun.write(restart_state_path, JSON.stringify(state));

	expect(gift_id).toBeNumber();
	expect(offered.json.trade_id).toBeNumber();
	expect(market_lot_id).toBeNumber();
	expect(campaign_completion_id).toBeNumber();
	expect(active_petition.json.petition_id).toBeNumber();
	expect(retry_petition.json.petition_id).toBeNumber();
	expect(chat_message.json.message.message_id).toBeNumber();
	expect(guild_chat_message.json.message.message_id).toBeNumber();
	expect(banishment.json.petition_id).toBeNumber();
	expect(raid_assault.json.assault_id).toBeString();
});
