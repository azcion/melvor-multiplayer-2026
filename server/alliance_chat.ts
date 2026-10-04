import { save_chat_parts, same_chat_parts, type ChatPart } from './chat_parts';
import { db } from './db';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE } from './chat';
import { is_admin } from './admin_identity';
import { chat_shadow_visibility, is_chat_shadowbanned } from './chat_shadowban';

export const GUILD_CHAT_CAPABILITY = 'alliance-chat-v1';

const MAX_INCREMENTAL_MESSAGES = 100;

type AllianceChatAccess = {
	alliance_id: number;
	name: string;
	icon_id: string;
	alliance_chat_enabled: number;
};

type AllianceChatMessage = {
	id: number;
	alliance_id: number;
	sender_id: number;
	content: string;
	created_at: number;
	display_name: string;
	icon_id: string;
};

type AllianceChatResult<T> = {
	status: 'ok';
	value: T;
} | {
	status: 'bad_request' | 'missing';
};

function current_access(client_id: number): AllianceChatAccess | null {
	return db.query<AllianceChatAccess, [number]>(
		"SELECT a.id alliance_id, a.name, 'multiplayer:Guild' icon_id, c.alliance_chat_enabled " +
		'FROM clients c JOIN guild_memberships gm ON gm.client_id=c.id ' +
		'JOIN alliance_memberships am ON am.guild_id=gm.guild_id JOIN alliances a ON a.id=am.alliance_id WHERE c.id=?'
	).get(client_id);
}

function latest_message_id(alliance_id: number): number {
	return db.query<{ id: number }, [number]>(
		'SELECT COALESCE(MAX(`id`), 0) AS `id` FROM `alliance_chat_messages` WHERE `alliance_id` = ?'
	).get(alliance_id)?.id ?? 0;
}

function ensure_read_state(client_id: number, alliance_id: number): number {
	db.query(
		'INSERT INTO `alliance_chat_read_state` (`alliance_id`, `client_id`, `last_read_message_id`) VALUES(?, ?, ?) ' +
		'ON CONFLICT (`alliance_id`, `client_id`) DO NOTHING'
	).run(alliance_id, client_id, latest_message_id(alliance_id));
	return db.query<{ last_read_message_id: number }, [number, number]>(
		'SELECT `last_read_message_id` FROM `alliance_chat_read_state` WHERE `alliance_id` = ? AND `client_id` = ?'
	).get(alliance_id, client_id)?.last_read_message_id ?? 0;
}

function message_view(message: AllianceChatMessage) {
	return {
		message_id: message.id,
		conversation_id: message.alliance_id,
		sender_id: message.sender_id,
		sender: { display_name: message.display_name, icon_id: message.icon_id },
		content: message.content,
		created_at: message.created_at,
		reactions: []
	};
}

function get_message(message_id: number): AllianceChatMessage | null {
	return db.query<AllianceChatMessage, [number]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `alliance_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE message.`id` = ? LIMIT 1'
	).get(message_id);
}

export function has_alliance_chat_capability(url: URL): boolean {
	return url.searchParams.getAll('capabilities').some(value =>
		value.split(',').map(entry => entry.trim()).includes(GUILD_CHAT_CAPABILITY)
	);
}

export function get_alliance_chat_inbox(client_id: number) {
	const access = current_access(client_id);
	const enabled = access?.alliance_chat_enabled === 1 || (access === null && db.query<{ enabled: number }, [number]>(
		'SELECT `alliance_chat_enabled` AS `enabled` FROM `clients` WHERE `id` = ?'
	).get(client_id)?.enabled === 1);
	if (access === null)
		return { state: { affiliated: false, enabled }, conversation: null };
	if (!enabled)
		return { state: { affiliated: true, enabled: false }, conversation: null };

	const last_read_message_id = ensure_read_state(client_id, access.alliance_id);
	const latest = db.query<AllianceChatMessage, [number, number, number]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `alliance_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
		'WHERE message.`alliance_id` = ? ' +
		'AND NOT EXISTS (SELECT 1 FROM `alliance_chat_message_moderation` AS moderation ' +
		'WHERE moderation.`message_id` = message.`id`) AND ' + chat_shadow_visibility() +
		' ORDER BY message.`id` DESC LIMIT 1'
	).get(access.alliance_id, client_id, client_id);
	const unread_count = db.query<{ count: number }, [number, number, number, number, number]>(
		'SELECT COUNT(*) AS `count` FROM `alliance_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
		'WHERE message.`alliance_id` = ? ' +
		'AND message.`id` > ? AND message.`sender_id` != ? AND NOT EXISTS ' +
		'(SELECT 1 FROM `alliance_chat_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`) ' +
		'AND ' + chat_shadow_visibility()
	).get(access.alliance_id, last_read_message_id, client_id, client_id, client_id)?.count ?? 0;
	const moderation_count = db.query<{ count: number }, [number]>(
		'SELECT COUNT(*) AS `count` FROM `alliance_chat_message_moderation` AS moderation ' +
		'JOIN `alliance_chat_messages` AS message ON message.`id` = moderation.`message_id` ' +
		'WHERE message.`alliance_id` = ?'
	).get(access.alliance_id)?.count ?? 0;

	return {
		state: { affiliated: true, enabled: true },
		conversation: {
			conversation_kind: 'alliance' as const,
			conversation_id: access.alliance_id,
			alliance_id: access.alliance_id,
			participant: { client_id: null, display_name: access.name, icon_id: access.icon_id },
			created_at: latest?.created_at ?? 0,
			latest_message: latest === null ? null : message_view(latest),
			unread_count,
			moderation_count,
			can_moderate: is_admin(client_id),
			blocked: false
		}
	};
}

export function get_alliance_chat_unread_count(client_id: number): number {
	const inbox = get_alliance_chat_inbox(client_id);
	return inbox.conversation?.unread_count ?? 0;
}

export function list_alliance_chat_messages(
	client_id: number,
	alliance_id: number,
	before: number | null,
	after: number | null
): AllianceChatResult<{ messages: ReturnType<typeof message_view>[]; has_more: boolean }> {
	if (!Number.isSafeInteger(alliance_id) || alliance_id < 1 ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) ||
		(before !== null && after !== null))
		return { status: 'bad_request' };
	const access = current_access(client_id);
	if (access === null || access.alliance_id !== alliance_id || access.alliance_chat_enabled !== 1)
		return { status: 'missing' };
	ensure_read_state(client_id, alliance_id);

	const values: number[] = [alliance_id, client_id, client_id];
	let cursor = '';
	let order = 'DESC';
	let limit = CHAT_MESSAGE_PAGE_SIZE + 1;
	if (before !== null) {
		cursor = ' AND message.`id` < ?';
		values.push(before);
	} else if (after !== null) {
		cursor = ' AND message.`id` > ?';
		values.push(after);
		order = 'ASC';
		limit = MAX_INCREMENTAL_MESSAGES + 1;
	}
	const rows = db.query<AllianceChatMessage, number[]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `alliance_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
		'WHERE message.`alliance_id` = ? ' +
		'AND NOT EXISTS (SELECT 1 FROM `alliance_chat_message_moderation` AS moderation ' +
		'WHERE moderation.`message_id` = message.`id`) AND ' + chat_shadow_visibility() + cursor +
		` ORDER BY message.\`id\` ${order} LIMIT ${limit}`
	).all(...values);
	const page_limit = after === null ? CHAT_MESSAGE_PAGE_SIZE : MAX_INCREMENTAL_MESSAGES;
	const has_more = rows.length > page_limit;
	const page = rows.slice(0, page_limit);
	if (order === 'DESC')
		page.reverse();
	if (before === null && page.length > 0) {
		const newest_message_id = page[page.length - 1].id;
		db.query(
			'UPDATE `alliance_chat_read_state` SET `last_read_message_id` = MAX(`last_read_message_id`, ?) ' +
			'WHERE `alliance_id` = ? AND `client_id` = ?'
		).run(newest_message_id, alliance_id, client_id);
	}
	return { status: 'ok', value: { messages: page.map(message_view), has_more } };
}

export function send_alliance_chat_message(
	client_id: number,
	alliance_id: number,
	idempotency_key: string,
	content: string,
	now = Date.now(),
	parts?: ChatPart[]
): AllianceChatResult<{ message: ReturnType<typeof message_view> }> {
	const trimmed = typeof content === 'string' ? content.trim() : '';
	if (!Number.isSafeInteger(alliance_id) || alliance_id < 1 || typeof idempotency_key !== 'string' ||
		idempotency_key.length < 1 || idempotency_key.length > 128 ||
		trimmed.length < 1 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH)
		return { status: 'bad_request' };
	const send = db.transaction((): AllianceChatResult<{ message_id: number }> => {
		const access = current_access(client_id);
		if (access === null || access.alliance_id !== alliance_id || access.alliance_chat_enabled !== 1)
			return { status: 'missing' };
		const duplicate = db.query<{ id: number; alliance_id: number; content: string }, [number, string]>(
			'SELECT `id`, `alliance_id`, `content` FROM `alliance_chat_messages` ' +
			'WHERE `sender_id` = ? AND `idempotency_key` = ?'
		).get(client_id, idempotency_key);
		if (duplicate !== null) {
			if (duplicate.alliance_id !== alliance_id || duplicate.content !== trimmed || !same_chat_parts('alliance', duplicate.id, parts))
				return { status: 'bad_request' };
			return { status: 'ok', value: { message_id: duplicate.id } };
		}
		const created = db.query(
			'INSERT INTO `alliance_chat_messages` (`alliance_id`, `sender_id`, `idempotency_key`, `content`, `created_at`, `shadow_hidden`) ' +
			'VALUES(?, ?, ?, ?, ?, ?)'
		).run(alliance_id, client_id, idempotency_key, trimmed, now, is_chat_shadowbanned(client_id) ? 1 : 0);
		save_chat_parts('alliance', Number(created.lastInsertRowid), parts);
		return { status: 'ok', value: { message_id: Number(created.lastInsertRowid) } };
	});
	const result = send.immediate();
	if (result.status !== 'ok')
		return result;
	return { status: 'ok', value: { message: message_view(get_message(result.value.message_id) as AllianceChatMessage) } };
}

export function moderate_alliance_chat_message(client_id: number, message_id: number, now = Date.now()) {
	if (!Number.isSafeInteger(message_id) || message_id < 1 || !is_admin(client_id))
		return { status: 'missing' as const };
	const access = current_access(client_id);
	if (access === null || access.alliance_chat_enabled !== 1)
		return { status: 'missing' as const };
	const message = db.query<{ id: number }, [number, number]>(
		' SELECT `id` FROM `alliance_chat_messages` WHERE `id` = ? AND `alliance_id` = ? LIMIT 1'
	).get(message_id, access.alliance_id);
	if (message === null)
		return { status: 'missing' as const };
	db.query(
		'INSERT INTO `alliance_chat_message_moderation` (`message_id`, `deleted_at`) VALUES(?, ?) ' +
		'ON CONFLICT DO NOTHING'
	).run(message_id, now);
	return { status: 'ok' as const, value: { deleted: true as const } };
}

export function set_alliance_chat_enabled(client_id: number, enabled: boolean): { enabled: boolean } {
	return db.transaction(() => {
		const client = db.query<{ alliance_chat_enabled: number }, [number]>(
			'SELECT `alliance_chat_enabled` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id) as { alliance_chat_enabled: number };
		if ((client.alliance_chat_enabled === 1) === enabled)
			return { enabled };
		db.query('UPDATE `clients` SET `alliance_chat_enabled` = ? WHERE `id` = ?').run(enabled ? 1 : 0, client_id);
		if (enabled) {
			const access = current_access(client_id);
			if (access !== null)
				db.query(
					'INSERT INTO `alliance_chat_read_state` (`alliance_id`, `client_id`, `last_read_message_id`) VALUES(?, ?, ?) ' +
					'ON CONFLICT (`alliance_id`, `client_id`) DO UPDATE SET `last_read_message_id` = excluded.`last_read_message_id`'
				).run(access.alliance_id, client_id, latest_message_id(access.alliance_id));
		}
		return { enabled };
	}).immediate();
}
