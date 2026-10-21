import { poll_inbox_summary } from '../polls';
import { list_petition_discussion_messages, send_petition_discussion_message } from '../petition-discussions';
import {
	message_details,
	message_moderation_count,
	moderate_additional_chat_message,
	type ChatMessageKind
} from '../chat_reactions';
import { has_alliance_access } from '../alliances';
import {
	get_alliance_chat_inbox,
	list_alliance_chat_messages,
	send_alliance_chat_message,
	moderate_alliance_chat_message,
	set_alliance_chat_enabled
} from '../alliance_chat';
import {
	normalize_chat_parts,
	parts_text,
	attach_chat_parts,
	chat_people,
	has_unread_person_tag
} from '../chat_parts';
import { get_dev_badge_labels, get_account_tags, get_dev_tag_visibility } from '../account_tags';
import {
	get_tester_chat_inbox,
	list_tester_chat_messages,
	moderate_tester_chat_message,
	send_tester_chat_message
} from '../tester_chat';
import { is_admin } from '../admin_identity';
import * as runtime from '../app-runtime';
import { authenticated_chat_browser } from './browser-chat-auth';
import type { DatabaseRow } from '../db';
import type { HandlerResult, JsonObject } from '../http';

const {
	CHAT_BUDGET_ENABLED,
	CHAT_BUDGET_ERROR,
	CHAT_PRIVACY_ERROR,
	attach_reactions,
	attach_translations,
	chat_translation_worker,
	delete_conversation,
	delete_message,
	get_chat_state,
	get_global_chat_inbox,
	get_guild_chat_inbox,
	has_global_chat_capability,
	has_guild_chat_capability,
	has_polls_capability,
	list_conversations,
	list_global_chat_messages,
	list_guild_chat_messages,
	list_messages,
	list_poll_discussion_messages,
	list_support_conversations,
	list_support_messages,
	moderate_global_chat_message,
	moderate_guild_chat_message,
	privacy_allows,
	reaction_updates,
	send_global_chat_message,
	send_guild_chat_message,
	send_message,
	send_poll_discussion_message,
	send_support_message,
	set_block,
	set_global_chat_enabled,
	set_guild_chat_enabled,
	set_message_reaction,
	set_messaging_enabled,
	start_conversation
} = runtime;

type ChatScope = 'game' | 'browser';
type ChatHandler = (req: Request, url: URL, client_id: number, json: JsonObject) => HandlerResult;
const browser_kinds = new Set(['private', 'global', 'guild', 'alliance', 'support', 'testers']);
// Exact browser surface: adding a game route never implicitly grants browser authority.
const browser_routes = new Set([
	'GET state',
	'GET profile',
	'GET conversations',
	'GET messages',
	'GET messages/details',
	'POST conversations/start',
	'POST messages/send',
	'POST messages/reaction',
	'POST global-participation',
	'POST guild-participation',
	'POST alliance-participation',
	'POST block',
	'POST privacy',
	'POST messages/delete',
	'POST conversations/delete'
]);

export function register_chat_routes(): void {
	register_scoped_chat_routes('game');
	register_scoped_chat_routes('browser');
}
function register_scoped_chat_routes(scope: ChatScope): void {
	const browser = scope === 'browser';
	function register(method: 'GET' | 'POST', path: string, handler: ChatHandler): void {
		if (!browser) {
			(method === 'GET' ? runtime.session_get_route : runtime.session_post_route)(path, handler);
			return;
		}
		const suffix = path.slice('/api/chat/'.length);
		if (!browser_routes.has(`${method} ${suffix}`)) return;
		runtime.server.route(
			`/chat/api/${suffix}`,
			authenticated_chat_browser((req, source_url, session, json) => {
				const kinds = [
					...source_url.searchParams.getAll('conversation_kind'),
					...(json.conversation_kind === undefined ? [] : [json.conversation_kind])
				];
				if (kinds.some((kind) => typeof kind !== 'string' || !browser_kinds.has(kind))) return 400;
				if (
					['messages/delete', 'conversations/delete'].includes(suffix) &&
					kinds.some((kind) => kind !== 'private')
				)
					return 400;
				const url = new URL(source_url);
				url.searchParams.delete('capabilities');
				url.searchParams.set('capabilities', 'global-chat-v1,guild-chat-v1');
				return handler(req, url, session.client_id, json);
			}),
			method
		);
	}
	const session_get_route = (path: string, handler: ChatHandler) => register('GET', path, handler);
	const session_post_route = (path: string, handler: ChatHandler) => register('POST', path, handler);
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

	session_get_route('/api/chat/state', (req, url, client_id) => ({
		dev_badge_labels: get_dev_badge_labels(),
		can_highlight: get_dev_tag_visibility(client_id).eligible,
		...(browser ? {} : { is_admin: is_admin(client_id) }),
		...get_chat_state(client_id),
		account_tags: get_account_tags(client_id)
	}));

	session_get_route('/api/chat/profile', (req, url, client_id): HandlerResult => {
		if (url.searchParams.get('people') === '1') return { people: chat_people(client_id) };
		const subject_id = Number(url.searchParams.get('client_id'));
		if (!Number.isSafeInteger(subject_id) || subject_id < 1)
			return 400;
		const profile = runtime.db.query<DatabaseRow, [number]>(
			'SELECT c.`id` AS `client_id`, c.`display_name`, c.`icon_id`, c.`equipment_visible`, ' +
			'EXISTS(SELECT 1 FROM `equipment_snapshots` AS equipment WHERE equipment.`client_id` = c.`id`) AS `equipment_available`, ' +
			'c.`skills_visible`, c.`skills_available`, status.`account_creation_date`, status.`total_skill_level`, ' +
			'c.`game_mode_visible`, runtime.`game_mode_id`, c.`active_mods_visible`, ' +
			'(runtime.`active_mods` IS NOT NULL AND runtime.`active_mods` <> \'[]\') AS `active_mods_available`, ' +
			'c.`last_multiplayer_active_at`, runtime.`language`, guild.`name` AS `guild_name`, account.`cloud_username` AS `account_name` ' +
			'FROM `clients` AS c ' +
			'LEFT JOIN `melvor_accounts` AS account ON account.`id` = c.`melvor_account_id` ' +
			'LEFT JOIN `status_snapshots` AS status ON status.`client_id` = c.`id` ' +
			'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
			'LEFT JOIN `guild_memberships` AS membership ON membership.`client_id` = c.`id` ' +
			'LEFT JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` ' +
			'WHERE c.`id` = ? AND c.`deleted_at` IS NULL LIMIT 1'
		).get(subject_id);
		if (profile === null)
			return 404;
		const account_creation_date = profile.account_creation_date;
		const admin_view = !browser && is_admin(client_id);
		return {
			client_id: subject_id,
			...(admin_view ? { account_name: profile.account_name, last_active_at: profile.last_multiplayer_active_at } : {}),
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

	session_get_route('/api/chat/conversations', (req, url, client_id) => {
		const global_chat = has_global_chat_capability(url) ? get_global_chat_inbox(client_id) : null;
		const tester_chat = get_tester_chat_inbox(client_id);
		const alliance_chat = has_alliance_access(client_id) ? get_alliance_chat_inbox(client_id) : null;
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
		if (browser) {
			for (const conversation of conversations)
				delete (conversation as { can_moderate?: boolean }).can_moderate;
		}
		for (const conversation of conversations)
			Object.assign(conversation, { unread_tagged: has_unread_person_tag(client_id, conversation) });
		for (const kind of ['private', 'alliance', 'guild', 'global', 'testers', 'support']) {
			const matching = conversations.filter(conversation => (conversation.conversation_kind ?? 'private') === kind);
			const latest = attach_chat_parts(kind === 'testers' ? 'global' : kind,
				matching.flatMap(conversation => conversation.latest_message ? [conversation.latest_message] : []));
			const by_id = new Map(latest.map(message => [message.message_id, message]));
			for (const conversation of matching)
				if (conversation.latest_message && conversation.latest_message.message_id > 0) {
					const parts = by_id.get(conversation.latest_message.message_id)?.parts;
					if (parts) Object.assign(conversation.latest_message, { parts });

				}
		}
		return {
			conversations,
			...(browser ? {} : { polls_summary: poll_inbox_summary(client_id) }),
			...(global_chat === null ? {} : { global_chat: global_chat.state }),
			...(guild_chat === null ? {} : { guild_chat: guild_chat.state }),
			...(alliance_chat === null ? {} : { alliance_chat: alliance_chat.state })
		};
	});

	session_post_route('/api/chat/conversations/start', (req, url, client_id, json) => {
		const target_id = json.client_id;
		if (typeof target_id !== 'number')
			return 400;
		const result = start_conversation(client_id, target_id);
		return result.status === 'ok' ? { success: true, conversation: result.value } : chat_error(result.status);
	});

	session_get_route('/api/chat/messages', (req, url, client_id): HandlerResult => {
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
		if (kind !== 'alliance' && kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'testers' && kind !== 'poll-discussion' && kind !== 'petition-discussion')
			return 400;
		if (reaction_after !== null && (!Number.isSafeInteger(reaction_after) || reaction_after < 0))
			return 400;
		if (kind === 'alliance' && !has_alliance_access(client_id)) return 404;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;

		if (kind === 'poll-discussion' && (!has_polls_capability(url)))
			return 404;
		const result = kind === 'alliance'
			? conversation_id === null ? { status: 'bad_request' as const } : list_alliance_chat_messages(client_id, conversation_id, before, after)
			: kind === 'support'
			? list_support_messages(client_id, conversation_id, team_id, before, after)
			: kind === 'petition-discussion'
				? conversation_id === null ? { status: 'bad_request' as const } : list_petition_discussion_messages(client_id, conversation_id, before, after)
			: kind === 'poll-discussion'
				? conversation_id === null ? { status: 'bad_request' as const }
					: list_poll_discussion_messages(client_id, conversation_id, before, after)
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
		if (url.searchParams.get('people') === '1') return { people: chat_people(client_id, kind, conversation_id) };
		const reaction_result = conversation_id === null
			? { status: 'ok' as const, value: { reaction_revision: 0, reaction_updates: [] } }
			: reaction_updates(kind, client_id, conversation_id, reaction_after);
		if (reaction_result.status !== 'ok')
			return 400;
		return {
			...result.value,
			...reaction_result.value,
			...(conversation_id === null ? {} : { moderation_count: message_moderation_count(kind, client_id, conversation_id) }),
			messages: attach_translations(kind === 'testers' ? 'global' : kind, client_id,
				attach_reactions(kind, client_id, result.value.messages))
		};
	});

	session_get_route('/api/chat/messages/details', (req, url, client_id) => {
		const kind = url.searchParams.get('conversation_kind') ?? 'private';

		const conversation_id = Number(url.searchParams.get('conversation_id'));
		const message_id = Number(url.searchParams.get('message_id'));
		if (!['private', 'alliance', 'guild', 'global', 'testers', 'support', 'poll-discussion', 'petition-discussion'].includes(kind) ||
			![conversation_id, message_id].every(id => Number.isSafeInteger(id) && id > 0)) return 400;
		if ((kind === 'alliance' && !has_alliance_access(client_id))) return 404;
		return message_details(client_id, kind as ChatMessageKind, conversation_id, message_id) ?? 404;
	});

	session_post_route('/api/chat/messages/reaction', (req, url, client_id, json) => {
		const kind = json.conversation_kind ?? 'private';

		if (kind !== 'alliance' && kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'testers' && kind !== 'poll-discussion' && kind !== 'petition-discussion')
			return 400;
		if (kind === 'alliance' && !has_alliance_access(client_id)) return 404;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;

		if (kind === 'poll-discussion' && !has_polls_capability(url)) return 404;

		if (typeof json.conversation_id !== 'number' || typeof json.message_id !== 'number' ||
			typeof json.reaction !== 'string' || typeof json.reacted !== 'boolean')
			return 400;
		const result = set_message_reaction(client_id, kind, json.conversation_id, json.message_id, json.reaction, json.reacted, Date.now());
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/messages/send', (req, url, client_id, json) => {
		const kind = json.conversation_kind ?? 'private';

		if (kind !== 'alliance' && kind !== 'private' && kind !== 'support' && kind !== 'guild' && kind !== 'global' && kind !== 'testers' && kind !== 'poll-discussion' && kind !== 'petition-discussion')
			return 400;
		if (kind === 'alliance' && !has_alliance_access(client_id)) return 404;
		if (kind === 'global' && !has_global_chat_capability(url))
			return 404;

		if (kind === 'poll-discussion' && (!has_polls_capability(url)))
			return 404;
		if ((json.conversation_id !== null && typeof json.conversation_id !== 'number') ||
			(json.conversation_id === null && kind === 'private' && typeof json.client_id !== 'number') ||
			(kind === 'guild' && typeof json.conversation_id !== 'number') ||
			(kind === 'global' && typeof json.conversation_id !== 'number') ||
			(kind === 'testers' && typeof json.conversation_id !== 'number') ||
			(['poll-discussion', 'petition-discussion'].includes(kind) && typeof json.conversation_id !== 'number') ||
			(kind === 'support' && typeof json.support_team_id !== 'number') ||
			typeof json.idempotency_key !== 'string' ||
			typeof json.content !== 'string')
			return 400;
		const parts = json.parts === undefined ? undefined : normalize_chat_parts(json.parts, client_id);
		if (parts === null) return 400;

		const highlight_color = json.highlight_color ?? null;
		if (highlight_color !== null && (typeof highlight_color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(highlight_color))) return 400;
		if (highlight_color !== null && !get_dev_tag_visibility(client_id).eligible) return 403;
		const color = typeof highlight_color === 'string' ? highlight_color.toUpperCase() : null;
		const content = parts ? parts_text(parts) : json.content;
		const result = kind === 'alliance' ? send_alliance_chat_message(client_id, json.conversation_id as number, json.idempotency_key, content, Date.now(), parts, color)
		: kind === 'petition-discussion' ? send_petition_discussion_message(client_id, json.conversation_id as number, json.idempotency_key, content, Date.now(), parts, color)
		: kind === 'poll-discussion' ? send_poll_discussion_message(client_id, json.conversation_id as number, json.idempotency_key, content, Date.now(), parts, color
		) : kind === 'support' ? send_support_message(
			client_id,
			json.conversation_id,
			typeof json.support_team_id === 'number' ? json.support_team_id : null,
			json.idempotency_key,
			content, Date.now(), parts, color
		) : kind === 'guild' ? send_guild_chat_message(
			client_id,
			json.conversation_id as number,
			json.idempotency_key,
			content, Date.now(), parts, color
		) : kind === 'global' ? send_global_chat_message(
			client_id,
			json.conversation_id as number,
			json.idempotency_key,
			content, Date.now(), parts, color
		) : kind === 'testers' ? send_tester_chat_message(client_id, json.conversation_id as number, json.idempotency_key, content, Date.now(), parts, color
		) : send_message(
			client_id,
			json.conversation_id,
			typeof json.client_id === 'number' ? json.client_id : null,
			json.idempotency_key,
			content, Date.now(), parts, color
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
		response.message = attach_chat_parts(kind === 'testers' ? 'global' : kind, [result.value.message])[0]! as JsonObject;
		if (kind === 'support')
			response.budget = get_chat_state(client_id).budget;
		return response;
	});

	session_post_route('/api/chat/global-participation', (req, url, client_id, json) => {
		if (!has_global_chat_capability(url))
			return 404;
		if (typeof json.enabled !== 'boolean')
			return 400;
		return { success: true, ...set_global_chat_enabled(client_id, json.enabled) };
	});

	session_post_route('/api/chat/alliance-participation', (req,url,client_id,json)=> {
		if (!has_alliance_access(client_id)) return 404;
		if (typeof json.enabled !== 'boolean') return 400;
		return { success:true, ...set_alliance_chat_enabled(client_id,json.enabled) };
	});

	session_post_route('/api/chat/guild-participation', (req, url, client_id, json) => {
		if (typeof json.enabled !== 'boolean')
			return 400;
		return { success: true, ...set_guild_chat_enabled(client_id, json.enabled) };
	});

	session_post_route('/api/chat/messages/delete', (req, url, client_id, json) => {
		if (typeof json.message_id !== 'number')
			return 400;
		const result = delete_message(client_id, json.message_id);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/messages/delete-for-all', (req, url, client_id, json) => {
		if (json.conversation_kind === 'private' || json.conversation_kind === 'support' || json.conversation_kind === 'poll-discussion' || json.conversation_kind === 'petition-discussion') {
			if (!is_admin(client_id)) return 403;
			if (typeof json.message_id !== 'number' || typeof json.conversation_id !== 'number' ||
				![json.message_id, json.conversation_id].every(id => Number.isSafeInteger(id) && id > 0)) return 400;

			return moderate_additional_chat_message(client_id, json.conversation_kind, json.conversation_id, json.message_id)
				? { success: true, deleted: true } : 404;
		}
		if (typeof json.message_id !== 'number' ||
			(json.conversation_kind !== 'alliance' && json.conversation_kind !== 'global' && json.conversation_kind !== 'guild' && json.conversation_kind !== 'testers'))
			return 400;

		if (json.conversation_kind === 'alliance' && !has_alliance_access(client_id)) return 404;
		const result = json.conversation_kind === 'alliance' ? moderate_alliance_chat_message(client_id,json.message_id) : json.conversation_kind === 'global'
			? moderate_global_chat_message(client_id, json.message_id)
			: json.conversation_kind === 'testers' ? moderate_tester_chat_message(client_id, json.message_id)
			: moderate_guild_chat_message(client_id, json.message_id);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/conversations/delete', (req, url, client_id, json) => {
		if (typeof json.conversation_id !== 'number')
			return 400;
		const result = delete_conversation(client_id, json.conversation_id);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/block', (req, url, client_id, json) => {
		if (typeof json.client_id !== 'number' || typeof json.blocked !== 'boolean')
			return 400;
		const result = set_block(client_id, json.client_id, json.blocked);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});

	session_post_route('/api/chat/privacy', (req, url, client_id, json) => {
		if (typeof json.messaging_enabled !== 'boolean')
			return 400;
		const result = set_messaging_enabled(client_id, json.messaging_enabled);
		return result.status === 'ok' ? { success: true, ...result.value } : chat_error(result.status);
	});
}
