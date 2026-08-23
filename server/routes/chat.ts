import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { CHAT_BUDGET_ENABLED, CHAT_BUDGET_ERROR, CHAT_PRIVACY_ERROR, delete_conversation, delete_message, get_chat_state, get_guild_chat_inbox, has_guild_chat_capability, list_conversations, list_guild_chat_messages, list_messages, list_support_conversations, list_support_messages, send_guild_chat_message, send_message, send_support_message, session_get_route, session_post_route, set_block, set_guild_chat_enabled, set_messaging_enabled, start_conversation } = runtime;

export function register_chat_routes(): void {
	function chat_error(status: 'bad_request' | 'missing' | 'privacy' | 'budget') {
		if (status === 'privacy')
			return { error_lang: CHAT_PRIVACY_ERROR };
		if (status === 'budget')
			return { error_lang: CHAT_BUDGET_ERROR };
		if (status === 'missing')
			return { error_lang: 'MOD_MP_CHAT_CONVERSATION_MISSING' };
		return 400;
	}

	session_get_route('/api/chat/state', async (req, url, client_id) => get_chat_state(client_id));

	session_get_route('/api/chat/conversations', async (req, url, client_id) => {
		const guild_chat = has_guild_chat_capability(url) ? get_guild_chat_inbox(client_id) : null;
		const conversations = [
			...list_conversations(client_id),
			...(guild_chat?.conversation === null || guild_chat === null ? [] : [guild_chat.conversation]),
			...list_support_conversations(client_id)
		].sort((a, b) => (b.latest_message?.created_at ?? b.created_at) -
			(a.latest_message?.created_at ?? a.created_at));
		return {
			conversations,
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
		const before = before_parameter === null ? null : Number(before_parameter);
		const after = after_parameter === null ? null : Number(after_parameter);
		if (kind !== 'private' && kind !== 'support' && kind !== 'guild')
			return 400;
		const result = kind === 'support'
			? list_support_messages(client_id, conversation_id, team_id, before, after)
			: kind === 'guild'
				? conversation_id === null ? { status: 'bad_request' as const }
					: list_guild_chat_messages(client_id, conversation_id, before, after)
				: conversation_id === null ? { status: 'bad_request' as const }
				: list_messages(client_id, conversation_id, before, after);
		return result.status === 'ok' ? result.value : chat_error(result.status);
	});

	session_post_route('/api/chat/messages/send', async (req, url, client_id, json) => {
		const kind = json.conversation_kind ?? 'private';
		if (kind !== 'private' && kind !== 'support' && kind !== 'guild')
			return 400;
		if ((json.conversation_id !== null && typeof json.conversation_id !== 'number') ||
			(json.conversation_id === null && kind === 'private' && typeof json.client_id !== 'number') ||
			(kind === 'guild' && typeof json.conversation_id !== 'number') ||
			(kind === 'support' && typeof json.support_team_id !== 'number') ||
			typeof json.idempotency_key !== 'string' ||
			typeof json.content !== 'string')
			return 400;
		const result = kind === 'support' ? send_support_message(
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
		) : send_message(
			client_id,
			json.conversation_id,
			typeof json.client_id === 'number' ? json.client_id : null,
			json.idempotency_key,
			json.content
		);
		return result.status === 'ok' ? { success: true, ...result.value, budget_enabled: CHAT_BUDGET_ENABLED,
			...(kind === 'support' ? { budget: get_chat_state(client_id).budget } : {}) } : chat_error(result.status);
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
