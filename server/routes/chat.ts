import { has_alliance_access } from '../alliances';
import { get_alliance_chat_inbox, list_alliance_chat_messages, send_alliance_chat_message, moderate_alliance_chat_message, set_alliance_chat_enabled } from '../alliance_chat';
import { normalize_chat_parts, parts_text, attach_chat_parts, compatible_chat_parts } from '../chat_parts';
import { is_client_version_at_least } from '../client-version-policy';
import { get_account_tags } from '../account_tags';
import { get_tester_chat_inbox, list_tester_chat_messages, moderate_tester_chat_message, send_tester_chat_message } from '../tester_chat';
import { is_admin } from '../admin_identity';
import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { CHAT_BUDGET_ENABLED, CHAT_BUDGET_ERROR, CHAT_PRIVACY_ERROR, attach_reactions, attach_translations, can_view_polls, chat_translation_worker, db_get_single, delete_conversation, delete_message, get_chat_state, get_global_chat_inbox, get_guild_chat_inbox, get_request_mod_version, has_global_chat_capability, has_guild_chat_capability, has_polls_capability, list_conversations, list_global_chat_messages, list_guild_chat_messages, list_messages, list_poll_discussion_messages, list_support_conversations, list_support_messages, moderate_global_chat_message, moderate_guild_chat_message, privacy_allows, reaction_updates, send_global_chat_message, send_guild_chat_message, send_message, send_poll_discussion_message, send_support_message, session_get_route, session_post_route, set_block, set_global_chat_enabled, set_guild_chat_enabled, set_message_reaction, set_messaging_enabled, start_conversation } = runtime;

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

	session_get_route('/api/chat/state', async (req, url, client_id) => ({
		...get_chat_state(client_id),
		...(is_client_version_at_least(get_request_mod_version(req), '1.6.0')
			? { account_tags: get_account_tags(client_id) } : {})
	}));

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
			'runtime.`language`, guild.`name` AS `guild_name`, account.`cloud_username` AS `account_name` ' +
			'FROM `clients` AS c ' +
			'LEFT JOIN `melvor_accounts` AS account ON account.`id` = c.`melvor_account_id` ' +
			'LEFT JOIN `status_snapshots` AS status ON status.`client_id` = c.`id` ' +
			'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
			'LEFT JOIN `guild_memberships` AS membership ON membership.`client_id` = c.`id` ' +
			'LEFT JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` ' +
			'WHERE c.`id` = ? AND c.`deleted_at` IS NULL LIMIT 1', [subject_id]
		);
		if (profile === null)
			return 404;
		const account_creation_date = profile.account_creation_date;
		const admin_view = is_admin(client_id);
		return {
			client_id: subject_id,
			...(admin_view ? { account_name: profile.account_name } : {}),
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
			active_mods_visible: profile.active_mods_visible === 1 || admin_view,
			active_mods_available: (profile.active_mods_visible === 1 || admin_view) && profile.active_mods_available === 1,
			language: profile.language,
			guild_name: profile.guild_name
		};
	});

	session_get_route('/api/chat/conversations', async (req, url, client_id) => {
		const supports_features = is_client_version_at_least(get_request_mod_version(req), '1.6.0');
		const global_chat = has_global_chat_capability(url) ? get_global_chat_inbox(client_id) : null;
		const tester_chat = is_client_version_at_least(get_request_mod_version(req), '1.6.0')
			? get_tester_chat_inbox(client_id, get_request_mod_version(req)) : null;
		const alliance_chat = has_alliance_access(client_id, get_request_mod_version(req)) ? get_alliance_chat_inbox(client_id) : null;
		const guild_chat = has_guild_chat_capability(url) ? get_guild_chat_inbox(client_id) : null;
		const conversations = [
			...list_conversations(client_id),
			...(alliance_chat?.conversation ? [alliance_chat.conversation] : []),
			...(global_chat?.conversation === null || global_chat === null ? [] : [global_chat.conversation]),
			...(tester_chat === null ? [] : [tester_chat]),
			...(guild_chat?.conversation === null || guild_chat === null ? [] : [guild_chat.conversation]),
			...list_support_conversations(client_id)
		].sort((a, b) => (b.latest_message?.created_at ?? b.created_at) -
			(a.latest_message?.created_at ?? a.created_at));
		for (const kind of ['private', 'alliance', 'guild', 'global', 'testers', 'support']) {
			const matching = conversations.filter(conversation => (conversation.conversation_kind ?? 'private') === kind);
			const latest = attach_chat_parts(kind === 'testers' ? 'global' : kind,
				matching.flatMap(conversation => conversation.latest_message ? [conversation.latest_message] : []));
			const by_id = new Map(latest.map(message => [message.message_id, message]));
			for (const conversation of matching)
				if (conversation.latest_message && conversation.latest_message.message_id > 0) {
					const parts = by_id.get(conversation.latest_message.message_id)?.parts;
					if (parts) Object.assign(conversation.latest_message, { parts });
					compatible_chat_parts(conversation.latest_message, supports_features);
				}
		}
		return {
			conversations,
			...(global_chat === null ? {} : { global_chat: global_chat.state }),
			...(guild_chat === null ? {} : { guild_chat: guild_chat.state }),
			...(alliance_chat === null ? {} : { alliance_chat: alliance_chat.state })
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
		if (kind !== 'alliance' && kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'testers' && kind !== 'poll-discussion')
			return 400;
		if (reaction_after !== null && (!Number.isSafeInteger(reaction_after) || reaction_after < 0))
			return 400;
		if (kind === 'alliance' && !has_alliance_access(client_id, get_request_mod_version(req))) return 404;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;
		if (kind === 'testers' && !is_client_version_at_least(get_request_mod_version(req), '1.6.0'))
			return 404;
		if (kind === 'poll-discussion' && (!has_polls_capability(url) || !can_view_polls(get_request_mod_version(req))))
			return 404;
		const result = kind === 'alliance'
			? conversation_id === null ? { status: 'bad_request' as const } : list_alliance_chat_messages(client_id, conversation_id, before, after)
			: kind === 'support'
			? list_support_messages(client_id, conversation_id, team_id, before, after)
			: kind === 'poll-discussion'
				? conversation_id === null ? { status: 'bad_request' as const }
					: list_poll_discussion_messages(client_id, get_request_mod_version(req), conversation_id, before, after)
			: kind === 'guild'
				? conversation_id === null ? { status: 'bad_request' as const }
					: list_guild_chat_messages(client_id, conversation_id, before, after)
				: kind === 'testers'
					? conversation_id === null ? { status: 'bad_request' as const }
						: list_tester_chat_messages(client_id, conversation_id, before, after)
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
			messages: attach_translations(kind === 'testers' ? 'global' : kind, client_id,
				attach_reactions(kind, client_id, result.value.messages))
				.map(message => compatible_chat_parts(message,
					is_client_version_at_least(get_request_mod_version(req), '1.6.0')))
		};
	});

	session_post_route('/api/chat/messages/reaction', async (req, url, client_id, json) => {
		const kind = json.conversation_kind ?? 'private';
		if (kind !== 'alliance' && kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'testers' && kind !== 'poll-discussion')
			return 400;
		if (kind === 'alliance' && !has_alliance_access(client_id, get_request_mod_version(req))) return 404;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;
		if (kind === 'testers' && !is_client_version_at_least(get_request_mod_version(req), '1.6.0'))
			return 404;
		// 1.5.14 omitted the Polls capability from this one request even though the
		// explicit conversation kind proves intent. Retain the version gate while
		// accepting that released client until its corrected successor is adopted.
		if (kind === 'poll-discussion' && !can_view_polls(get_request_mod_version(req)))
			return 404;
		if (typeof json.conversation_id !== 'number' || typeof json.message_id !== 'number' ||
			typeof json.reaction !== 'string' || typeof json.reacted !== 'boolean')
			return 400;
		const result = set_message_reaction(client_id, kind, json.conversation_id, json.message_id,
			json.reaction, json.reacted, Date.now(), get_request_mod_version(req));
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/messages/send', async (req, url, client_id, json) => {
		const kind = json.conversation_kind ?? 'private';
		if (kind !== 'alliance' && kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'testers' && kind !== 'poll-discussion')
			return 400;
		if (kind === 'alliance' && !has_alliance_access(client_id, get_request_mod_version(req))) return 404;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;
		if (kind === 'testers' && !is_client_version_at_least(get_request_mod_version(req), '1.6.0'))
			return 404;
		if (kind === 'poll-discussion' && (!has_polls_capability(url) || !can_view_polls(get_request_mod_version(req))))
			return 404;
		if ((json.conversation_id !== null && typeof json.conversation_id !== 'number') ||
			(json.conversation_id === null && kind === 'private' && typeof json.client_id !== 'number') ||
			(kind === 'guild' && typeof json.conversation_id !== 'number') ||
			(kind === 'global' && typeof json.conversation_id !== 'number') ||
			(kind === 'testers' && typeof json.conversation_id !== 'number') ||
			(kind === 'poll-discussion' && typeof json.conversation_id !== 'number') ||
			(kind === 'support' && typeof json.support_team_id !== 'number') ||
			typeof json.idempotency_key !== 'string' ||
			typeof json.content !== 'string')
			return 400;
		const parts = json.parts === undefined ? undefined : normalize_chat_parts(json.parts);
		if (parts === null) return 400;
		if (parts?.some(part => part.type === 'feature') &&
			!is_client_version_at_least(get_request_mod_version(req), '1.6.0')) return 400;
		const content = parts ? parts_text(parts) : json.content;
		const result = kind === 'alliance' ? send_alliance_chat_message(client_id, json.conversation_id as number, json.idempotency_key, content, Date.now(), parts)
		: kind === 'poll-discussion' ? send_poll_discussion_message(
			client_id, get_request_mod_version(req), json.conversation_id as number, json.idempotency_key, content, Date.now(), parts
		) : kind === 'support' ? send_support_message(
			client_id,
			json.conversation_id,
			typeof json.support_team_id === 'number' ? json.support_team_id : null,
			json.idempotency_key,
			content, Date.now(), parts
		) : kind === 'guild' ? send_guild_chat_message(
			client_id,
			json.conversation_id as number,
			json.idempotency_key,
			content, Date.now(), parts
		) : kind === 'global' ? send_global_chat_message(
			client_id,
			json.conversation_id as number,
			json.idempotency_key,
			content, Date.now(), parts
		) : kind === 'testers' ? send_tester_chat_message(
			client_id,
			json.conversation_id as number,
			json.idempotency_key,
			content, Date.now(), parts, get_request_mod_version(req)
		) : send_message(
			client_id,
			json.conversation_id,
			typeof json.client_id === 'number' ? json.client_id : null,
			json.idempotency_key,
			content, Date.now(), parts
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
		response.message = compatible_chat_parts(
			attach_chat_parts(kind === 'testers' ? 'global' : kind, [result.value.message])[0]!,
			is_client_version_at_least(get_request_mod_version(req), '1.6.0')) as JsonObject;
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

	session_post_route('/api/chat/alliance-participation', async(req,url,client_id,json)=> {
		if (!has_alliance_access(client_id, get_request_mod_version(req))) return 404;
		if (typeof json.enabled !== 'boolean') return 400;
		return { success:true, ...set_alliance_chat_enabled(client_id,json.enabled) };
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
			(json.conversation_kind !== 'alliance' && json.conversation_kind !== 'global' && json.conversation_kind !== 'guild' && json.conversation_kind !== 'testers'))
			return 400;
		if (json.conversation_kind === 'testers' && !is_client_version_at_least(get_request_mod_version(req), '1.6.0'))
			return 404;
		if (json.conversation_kind === 'alliance' && !has_alliance_access(client_id, get_request_mod_version(req))) return 404;
		const result = json.conversation_kind === 'alliance' ? moderate_alliance_chat_message(client_id,json.message_id) : json.conversation_kind === 'global'
			? moderate_global_chat_message(client_id, json.message_id)
			: json.conversation_kind === 'testers' ? moderate_tester_chat_message(client_id, json.message_id)
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
