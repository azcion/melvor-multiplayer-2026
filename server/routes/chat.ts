import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { CHAT_BUDGET_ENABLED, CHAT_BUDGET_ERROR, CHAT_PRIVACY_ERROR, attach_reactions, attach_translations, chat_translation_worker, db_get_single, delete_conversation, delete_message, get_chat_state, get_global_chat_inbox, get_guild_chat_inbox, has_global_chat_capability, has_guild_chat_capability, has_polls_capability, list_conversations, list_global_chat_messages, list_guild_chat_messages, list_messages, list_poll_discussion_messages, list_support_conversations, list_support_messages, moderate_global_chat_message, moderate_guild_chat_message, privacy_allows, reaction_updates, send_global_chat_message, send_guild_chat_message, send_message, send_poll_discussion_message, send_support_message, session_get_route, session_post_route, set_block, set_global_chat_enabled, set_guild_chat_enabled, set_message_reaction, set_messaging_enabled, start_conversation } = runtime;

export function register_chat_routes(): void {
	function chat_error(status: 'bad_request' | 'missing' | 'privacy' | 'budget' | 'forbidden') {
		if (status === 'forbidden')
			return 403;
		if (status === 'privacy')
			return { error_lang: CHAT_PRIVACY_ERROR };
		if (status === 'budget')
			return { error_lang: CHAT_BUDGET_ERROR };
		if (status === 'missing')
			return { error_lang: 'MOD_MP_CHAT_CONVERSATION_MISSING' };
		return 400;
	}

	session_get_route('/api/chat/state', async (req, url, client_id) => get_chat_state(client_id));

	session_get_route('/api/chat/profile', async (req, url, client_id): Promise<HandlerResult> => {
		const subject_id = Number(url.searchParams.get('client_id'));
		if (!Number.isSafeInteger(subject_id) || subject_id < 1)
			return 400;
		const profile = await db_get_single(
			'SELECT c.`id` AS `client_id`, c.`display_name`, c.`icon_id`, c.`equipment_visible`, ' +
			'EXISTS(SELECT 1 FROM `equipment_snapshots` AS equipment WHERE equipment.`client_id` = c.`id`) AS `equipment_available`, ' +
			'c.`skills_visible`, c.`skills_available`, status.`account_creation_date`, status.`total_skill_level`, ' +
			'c.`game_mode_visible`, runtime.`game_mode_id`, c.`active_mods_visible`, ' +
			'(runtime.`active_mods` IS NOT NULL AND runtime.`active_mods` <> \'[]\') AS `active_mods_available`, ' +
			'runtime.`language`, guild.`name` AS `guild_name` ' +
			'FROM `clients` AS c ' +
			'LEFT JOIN `status_snapshots` AS status ON status.`client_id` = c.`id` ' +
			'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
			'LEFT JOIN `guild_memberships` AS membership ON membership.`client_id` = c.`id` ' +
			'LEFT JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` ' +
			'WHERE c.`id` = ? AND c.`deleted_at` IS NULL LIMIT 1', [subject_id]
		);
		if (profile === null)
			return 404;
		const account_creation_date = profile.account_creation_date;
		return {
			client_id: subject_id,
			display_name: profile.display_name,
			icon_id: profile.icon_id,
			can_start_chat: subject_id !== client_id && privacy_allows(client_id, subject_id),
			equipment_visible: profile.equipment_visible === 1,
			equipment_available: profile.equipment_available === 1,
			skills_visible: profile.skills_visible === 1,
			skills_available: profile.skills_available === 1,
			account_age: typeof account_creation_date === 'number' && Number.isSafeInteger(account_creation_date) &&
				account_creation_date > 0 ? Math.max(0, Date.now() - account_creation_date) : null,
			total_skill_level: profile.skills_visible === 1 ? profile.total_skill_level : null,
			game_mode_visible: profile.game_mode_visible === 1,
			game_mode_id: profile.game_mode_visible === 1 ? profile.game_mode_id : null,
			active_mods_visible: profile.active_mods_visible === 1,
			active_mods_available: profile.active_mods_visible === 1 && profile.active_mods_available === 1,
			language: profile.language,
			guild_name: profile.guild_name
		};
	});

	session_get_route('/api/chat/conversations', async (req, url, client_id) => {
		const global_chat = has_global_chat_capability(url) ? get_global_chat_inbox(client_id) : null;
		const guild_chat = has_guild_chat_capability(url) ? get_guild_chat_inbox(client_id) : null;
		const conversations = [
			...list_conversations(client_id),
			...(global_chat?.conversation === null || global_chat === null ? [] : [global_chat.conversation]),
			...(guild_chat?.conversation === null || guild_chat === null ? [] : [guild_chat.conversation]),
			...list_support_conversations(client_id)
		].sort((a, b) => (b.latest_message?.created_at ?? b.created_at) -
			(a.latest_message?.created_at ?? a.created_at));
		return {
			conversations,
			...(global_chat === null ? {} : { global_chat: global_chat.state }),
			...(guild_chat === null ? {} : { guild_chat: guild_chat.state })
		};
	});

	session_post_route('/api/chat/conversations/start', async (req, url, client_id, json) => {
		const target_id = json.client_id;
		if (typeof target_id !== 'number')
			return 400;
		const result = start_conversation(client_id, target_id);
		return result.status === 'ok' ? { success: true, conversation: result.value } : chat_error(result.status);
	});

	session_get_route('/api/chat/messages', async (req, url, client_id) => {
		const kind = url.searchParams.get('conversation_kind') ?? 'private';
		const conversation_parameter = url.searchParams.get('conversation_id');
		const conversation_id = conversation_parameter === null || conversation_parameter === ''
			? null : Number(conversation_parameter);
		const team_parameter = url.searchParams.get('support_team_id');
		const team_id = team_parameter === null ? null : Number(team_parameter);
		const before_parameter = url.searchParams.get('before');
		const after_parameter = url.searchParams.get('after');
		const reaction_after_parameter = url.searchParams.get('reaction_after');
		const before = before_parameter === null ? null : Number(before_parameter);
		const after = after_parameter === null ? null : Number(after_parameter);
		const reaction_after = reaction_after_parameter === null ? null : Number(reaction_after_parameter);
		if (kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'poll-discussion')
			return 400;
		if (reaction_after !== null && (!Number.isSafeInteger(reaction_after) || reaction_after < 0))
			return 400;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;
		if (kind === 'poll-discussion' && !has_polls_capability(url))
			return 404;
		const result = kind === 'support'
			? list_support_messages(client_id, conversation_id, team_id, before, after)
			: kind === 'poll-discussion'
				? conversation_id === null ? { status: 'bad_request' as const }
					: list_poll_discussion_messages(client_id, conversation_id, before, after)
			: kind === 'guild'
				? conversation_id === null ? { status: 'bad_request' as const }
					: list_guild_chat_messages(client_id, conversation_id, before, after)
				: kind === 'global'
					? conversation_id === null ? { status: 'bad_request' as const }
						: list_global_chat_messages(client_id, conversation_id, before, after)
				: conversation_id === null ? { status: 'bad_request' as const }
				: list_messages(client_id, conversation_id, before, after);
		if (result.status === 'throttled')
			return 500;
		if (result.status !== 'ok')
			return chat_error(result.status);
		const reaction_result = conversation_id === null
			? { status: 'ok' as const, value: { reaction_revision: 0, reaction_updates: [] } }
			: reaction_updates(kind, client_id, conversation_id, reaction_after);
		if (reaction_result.status !== 'ok')
			return 400;
		return {
			...result.value,
			...reaction_result.value,
			messages: attach_translations(kind, client_id,
				attach_reactions(kind, client_id, result.value.messages))
		};
	});

	session_post_route('/api/chat/messages/reaction', async (req, url, client_id, json) => {
		const kind = json.conversation_kind ?? 'private';
		if (kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'poll-discussion')
			return 400;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;
		if (kind === 'poll-discussion' && !has_polls_capability(url))
			return 404;
		if (typeof json.conversation_id !== 'number' || typeof json.message_id !== 'number' ||
			typeof json.reaction !== 'string' || typeof json.reacted !== 'boolean')
			return 400;
		const result = set_message_reaction(client_id, kind, json.conversation_id, json.message_id,
			json.reaction, json.reacted);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/messages/send', async (req, url, client_id, json) => {
		const kind = json.conversation_kind ?? 'private';
		if (kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'poll-discussion')
			return 400;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;
		if (kind === 'poll-discussion' && !has_polls_capability(url))
			return 404;
		if ((json.conversation_id !== null && typeof json.conversation_id !== 'number') ||
			(json.conversation_id === null && kind === 'private' && typeof json.client_id !== 'number') ||
			(kind === 'guild' && typeof json.conversation_id !== 'number') ||
			(kind === 'global' && typeof json.conversation_id !== 'number') ||
			(kind === 'poll-discussion' && typeof json.conversation_id !== 'number') ||
			(kind === 'support' && typeof json.support_team_id !== 'number') ||
			typeof json.idempotency_key !== 'string' ||
			typeof json.content !== 'string')
			return 400;
		const result = kind === 'poll-discussion' ? send_poll_discussion_message(
			client_id, json.conversation_id as number, json.idempotency_key, json.content
		) : kind === 'support' ? send_support_message(
			client_id,
			json.conversation_id,
			typeof json.support_team_id === 'number' ? json.support_team_id : null,
			json.idempotency_key,
			json.content
		) : kind === 'guild' ? send_guild_chat_message(
			client_id,
			json.conversation_id as number,
			json.idempotency_key,
			json.content
		) : kind === 'global' ? send_global_chat_message(
			client_id,
			json.conversation_id as number,
			json.idempotency_key,
			json.content
		) : send_message(
			client_id,
			json.conversation_id,
			typeof json.client_id === 'number' ? json.client_id : null,
			json.idempotency_key,
			json.content
		);
		if (result.status === 'throttled')
			return { success: false, retry_after_ms: result.retry_after_ms };
		if (result.status !== 'ok')
			return chat_error(result.status);
		chat_translation_worker.wake();
		const response: JsonObject = {
			success: true,
			budget_enabled: CHAT_BUDGET_ENABLED
		};
		Object.assign(response, result.value as JsonObject);
		if (kind === 'support')
			response.budget = get_chat_state(client_id).budget;
		return response;
	});

	session_post_route('/api/chat/global-participation', async (req, url, client_id, json) => {
		if (!has_global_chat_capability(url))
			return 404;
		if (typeof json.enabled !== 'boolean')
			return 400;
		return { success: true, ...set_global_chat_enabled(client_id, json.enabled) };
	});

	session_post_route('/api/chat/guild-participation', async (req, url, client_id, json) => {
		if (typeof json.enabled !== 'boolean')
			return 400;
		return { success: true, ...set_guild_chat_enabled(client_id, json.enabled) };
	});

	session_post_route('/api/chat/messages/delete', async (req, url, client_id, json) => {
		if (typeof json.message_id !== 'number')
			return 400;
		const result = delete_message(client_id, json.message_id);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/messages/delete-for-all', async (req, url, client_id, json) => {
		if (typeof json.message_id !== 'number' ||
			(json.conversation_kind !== 'global' && json.conversation_kind !== 'guild'))
			return 400;
		const result = json.conversation_kind === 'global'
			? moderate_global_chat_message(client_id, json.message_id)
			: moderate_guild_chat_message(client_id, json.message_id);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/conversations/delete', async (req, url, client_id, json) => {
		if (typeof json.conversation_id !== 'number')
			return 400;
		const result = delete_conversation(client_id, json.conversation_id);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/block', async (req, url, client_id, json) => {
		if (typeof json.client_id !== 'number' || typeof json.blocked !== 'boolean')
			return 400;
		const result = set_block(client_id, json.client_id, json.blocked);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/privacy', async (req, url, client_id, json) => {
		if (typeof json.messaging_enabled !== 'boolean')
			return 400;
		const result = set_messaging_enabled(client_id, json.messaging_enabled);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});
}
