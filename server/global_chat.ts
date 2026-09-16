import { save_chat_parts, same_chat_parts, type ChatPart } from './chat_parts';
import { db } from './db';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE } from './chat';
import { is_chat_moderator } from './chat_moderation';

export const GLOBAL_CHAT_CAPABILITY = 'global-chat-v1';
export const GLOBAL_CHAT_CONVERSATION_ID = 1;

const MAX_INCREMENTAL_MESSAGES = 100;

type GlobalChatMessage = {
	id: number;
	sender_id: number;
	content: string;
	created_at: number;
	display_name: string;
	icon_id: string;
};

type ThrottleRule = {
	max_messages: number;
	window_seconds: number;
};

type GlobalChatResult<T> = {
	status: 'ok';
	value: T;
} | {
	status: 'throttled';
	retry_after_ms: number;
} | {
	status: 'bad_request' | 'missing';
};

function latest_message_id(): number {
	return db.query<{ id: number }, []>(
		'SELECT COALESCE(MAX(`id`), 0) AS `id` FROM `global_chat_messages`'
	).get()?.id ?? 0;
}

function ensure_read_state(client_id: number): number {
	db.query(
		'INSERT INTO `global_chat_read_state` (`client_id`, `last_read_message_id`) VALUES(?, ?) ' +
		'ON CONFLICT (`client_id`) DO NOTHING'
	).run(client_id, latest_message_id());
	return db.query<{ last_read_message_id: number }, [number]>(
		'SELECT `last_read_message_id` FROM `global_chat_read_state` WHERE `client_id` = ?'
	).get(client_id)?.last_read_message_id ?? 0;
}

function participation_enabled(client_id: number): boolean {
	return db.query<{ enabled: number }, [number]>(
		'SELECT `global_chat_enabled` AS `enabled` FROM `clients` ' +
		'WHERE `id` = ? AND `deleted_at` IS NULL LIMIT 1'
	).get(client_id)?.enabled === 1;
}

function message_view(message: GlobalChatMessage) {
	return {
		message_id: message.id,
		conversation_id: GLOBAL_CHAT_CONVERSATION_ID,
		sender_id: message.sender_id,
		sender: { display_name: message.display_name, icon_id: message.icon_id },
		content: message.content,
		created_at: message.created_at,
		reactions: []
	};
}

function get_message(message_id: number): GlobalChatMessage | null {
	return db.query<GlobalChatMessage, [number]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `global_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE message.`id` = ? LIMIT 1'
	).get(message_id);
}

function throttle_wait(rule: ThrottleRule | null, client_id: number | null, now: number): number {
	if (rule === null)
		return 0;
	const cutoff = Math.max(0, now - rule.window_seconds * 1000);
	const sender_clause = client_id === null ? '' : ' AND `sender_id` = ?';
	const values = client_id === null
		? [cutoff, rule.max_messages]
		: [cutoff, client_id, rule.max_messages];
	const recent = db.query<{ created_at: number }, number[]>(
		'SELECT `created_at` FROM `global_chat_messages` WHERE `created_at` > ?' + sender_clause +
		' ORDER BY `created_at` DESC, `id` DESC LIMIT ?'
	).all(...values);
	if (recent.length < rule.max_messages)
		return 0;
	const oldest = recent[recent.length - 1] as { created_at: number };
	return Math.max(1, oldest.created_at + rule.window_seconds * 1000 - now + 1);
}

function current_throttle_wait(client_id: number, now: number): number {
	const server_rule = db.query<ThrottleRule, []>(
		'SELECT `max_messages`, `window_seconds` FROM `global_chat_server_throttle` WHERE `id` = 1'
	).get();
	const client_rule = db.query<ThrottleRule, [number]>(
		'SELECT `max_messages`, `window_seconds` FROM `global_chat_client_throttles` WHERE `client_id` = ?'
	).get(client_id);
	return Math.max(throttle_wait(server_rule, null, now), throttle_wait(client_rule, client_id, now));
}

export function has_global_chat_capability(url: URL): boolean {
	return url.searchParams.getAll('capabilities').some(value =>
		value.split(',').map(entry => entry.trim()).includes(GLOBAL_CHAT_CAPABILITY)
	);
}

export function get_global_chat_inbox(client_id: number) {
	const enabled = participation_enabled(client_id);
	if (!enabled)
		return { state: { enabled: false }, conversation: null };
	const last_read_message_id = ensure_read_state(client_id);
	const latest = db.query<GlobalChatMessage, []>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `global_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
		'WHERE NOT EXISTS (SELECT 1 FROM `global_chat_message_moderation` AS moderation ' +
		'WHERE moderation.`message_id` = message.`id`) ORDER BY message.`id` DESC LIMIT 1'
	).get();
	const unread_count = db.query<{ count: number }, [number, number]>(
		'SELECT COUNT(*) AS `count` FROM `global_chat_messages` AS message WHERE message.`id` > ? ' +
		'AND message.`sender_id` != ? AND NOT EXISTS ' +
		'(SELECT 1 FROM `global_chat_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`)'
	).get(last_read_message_id, client_id)?.count ?? 0;
	const moderation_count = db.query<{ count: number }, []>(
		'SELECT COUNT(*) AS `count` FROM `global_chat_message_moderation`'
	).get()?.count ?? 0;
	return {
		state: { enabled: true },
		conversation: {
			conversation_kind: 'global' as const,
			conversation_id: GLOBAL_CHAT_CONVERSATION_ID,
			participant: { client_id: null, display_name: 'Global', icon_id: 'multiplayer' },
			created_at: latest?.created_at ?? 0,
			latest_message: latest === null ? null : message_view(latest),
			unread_count,
			moderation_count,
			can_moderate: is_chat_moderator(client_id),
			blocked: false
		}
	};
}

export function get_global_chat_unread_count(client_id: number): number {
	return get_global_chat_inbox(client_id).conversation?.unread_count ?? 0;
}

export function list_global_chat_messages(
	client_id: number,
	conversation_id: number,
	before: number | null,
	after: number | null
): GlobalChatResult<{ messages: ReturnType<typeof message_view>[]; has_more: boolean }> {
	if (conversation_id !== GLOBAL_CHAT_CONVERSATION_ID ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) ||
		(before !== null && after !== null))
		return { status: 'bad_request' };
	if (!participation_enabled(client_id))
		return { status: 'missing' };
	ensure_read_state(client_id);
	const values: number[] = [];
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
	const rows = db.query<GlobalChatMessage, number[]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `global_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE NOT EXISTS ' +
		'(SELECT 1 FROM `global_chat_message_moderation` AS moderation ' +
		'WHERE moderation.`message_id` = message.`id`)' + cursor +
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
			'UPDATE `global_chat_read_state` SET `last_read_message_id` = MAX(`last_read_message_id`, ?) ' +
			'WHERE `client_id` = ?'
		).run(newest_message_id, client_id);
	}
	return { status: 'ok', value: { messages: page.map(message_view), has_more } };
}

export function send_global_chat_message(
	client_id: number,
	conversation_id: number,
	idempotency_key: string,
	content: string,
	now = Date.now(),
	parts?: ChatPart[]
): GlobalChatResult<{ message: ReturnType<typeof message_view>; retry_after_ms: number }> {
	const trimmed = typeof content === 'string' ? content.trim() : '';
	if (conversation_id !== GLOBAL_CHAT_CONVERSATION_ID || typeof idempotency_key !== 'string' ||
		idempotency_key.length < 1 || idempotency_key.length > 128 ||
		trimmed.length < 1 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH)
		return { status: 'bad_request' };
	const send = db.transaction((): GlobalChatResult<{ message_id: number; retry_after_ms: number }> => {
		if (!participation_enabled(client_id))
			return { status: 'missing' };
		const duplicate = db.query<{ id: number; content: string }, [number, string]>(
			'SELECT `id`, `content` FROM `global_chat_messages` WHERE `sender_id` = ? AND `idempotency_key` = ?'
		).get(client_id, idempotency_key);
		if (duplicate !== null) {
			if (duplicate.content !== trimmed || !same_chat_parts('global', duplicate.id, parts))
				return { status: 'bad_request' };
			return { status: 'ok', value: { message_id: duplicate.id, retry_after_ms: current_throttle_wait(client_id, now) } };
		}
		const retry_after_ms = current_throttle_wait(client_id, now);
		if (retry_after_ms > 0)
			return { status: 'throttled', retry_after_ms };
		const created = db.query(
			'INSERT INTO `global_chat_messages` (`sender_id`, `idempotency_key`, `content`, `created_at`) ' +
			'VALUES(?, ?, ?, ?)'
		).run(client_id, idempotency_key, trimmed, now);
		save_chat_parts('global', Number(created.lastInsertRowid), parts);
		return { status: 'ok', value: {
			message_id: Number(created.lastInsertRowid),
			retry_after_ms: current_throttle_wait(client_id, now)
		} };
	});
	const result = send.immediate();
	if (result.status !== 'ok')
		return result;
	return { status: 'ok', value: {
		message: message_view(get_message(result.value.message_id) as GlobalChatMessage),
		retry_after_ms: result.value.retry_after_ms
	} };
}

export function moderate_global_chat_message(client_id: number, message_id: number, now = Date.now()) {
	if (!Number.isSafeInteger(message_id) || message_id < 1 ||
		!is_chat_moderator(client_id) || !participation_enabled(client_id))
		return { status: 'missing' as const };
	const message = db.query<{ id: number }, [number]>(
		' SELECT `id` FROM `global_chat_messages` WHERE `id` = ? LIMIT 1'
	).get(message_id);
	if (message === null)
		return { status: 'missing' as const };
	db.query(
		'INSERT INTO `global_chat_message_moderation` (`message_id`, `deleted_at`) VALUES(?, ?) ' +
		'ON CONFLICT DO NOTHING'
	).run(message_id, now);
	return { status: 'ok' as const, value: { deleted: true as const } };
}

export function set_global_chat_enabled(client_id: number, enabled: boolean): { enabled: boolean } {
	return db.transaction(() => {
		const client = db.query<{ global_chat_enabled: number }, [number]>(
			'SELECT `global_chat_enabled` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id) as { global_chat_enabled: number };
		if ((client.global_chat_enabled === 1) === enabled)
			return { enabled };
		db.query('UPDATE `clients` SET `global_chat_enabled` = ? WHERE `id` = ?').run(enabled ? 1 : 0, client_id);
		if (enabled)
			db.query(
				'INSERT INTO `global_chat_read_state` (`client_id`, `last_read_message_id`) VALUES(?, ?) ' +
				'ON CONFLICT (`client_id`) DO UPDATE SET `last_read_message_id` = excluded.`last_read_message_id`'
			).run(client_id, latest_message_id());
		return { enabled };
	}).immediate();
}
