import { save_chat_parts, same_chat_parts, type ChatPart } from './chat_parts';
import { chat_shadow_visibility, is_chat_shadowbanned } from './chat_shadowban';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE } from './chat';
import { db } from './db';
import { current_throttle_wait } from './global_chat';
import { is_expedition_tester } from './account_tags';
import { is_admin } from './admin_identity';

export const TESTER_CHAT_CONVERSATION_ID = 1;
const MAX_INCREMENTAL_MESSAGES = 100;

type TesterMessage = {
	id: number;
	sender_id: number;
	content: string;
	created_at: number;
	display_name: string;
	icon_id: string;
};

type TesterResult<T> = { status: 'ok'; value: T } |
	{ status: 'bad_request' | 'missing' | 'forbidden' } |
	{ status: 'throttled'; retry_after_ms: number };

function latest_message_id(): number {
	return db.query<{ id: number }, []>(
		"SELECT COALESCE(MAX(id), 0) AS id FROM global_chat_messages WHERE channel = 'testers'"
	).get()?.id ?? 0;
}

function ensure_read_state(client_id: number): number {
	db.query('INSERT INTO tester_chat_read_state (client_id, last_read_message_id) VALUES (?, ?) ' +
		'ON CONFLICT (client_id) DO NOTHING').run(client_id, latest_message_id());
	return db.query<{ last_read_message_id: number }, [number]>(
		'SELECT last_read_message_id FROM tester_chat_read_state WHERE client_id = ?'
	).get(client_id)?.last_read_message_id ?? 0;
}

function message_view(message: TesterMessage) {
	return {
		message_id: message.id,
		conversation_id: TESTER_CHAT_CONVERSATION_ID,
		sender_id: message.sender_id,
		sender: { display_name: message.display_name, icon_id: message.icon_id },
		content: message.content,
		created_at: message.created_at,
		reactions: []
	};
}

function get_message(message_id: number): TesterMessage | null {
	return db.query<TesterMessage, [number]>(
		'SELECT message.*, sender.display_name, sender.icon_id FROM global_chat_messages AS message ' +
		"JOIN clients AS sender ON sender.id = message.sender_id WHERE message.id = ? AND message.channel = 'testers'"
	).get(message_id);
}

export function get_tester_chat_inbox(client_id: number) {
	const can_send = is_expedition_tester(client_id);
	const last_read_message_id = ensure_read_state(client_id);
	const latest = db.query<TesterMessage, [number, number]>(
		'SELECT message.*, sender.display_name, sender.icon_id FROM global_chat_messages AS message ' +
		'JOIN clients AS sender ON sender.id = message.sender_id ' +
		"WHERE message.channel = 'testers' AND NOT EXISTS " +
		'(SELECT 1 FROM global_chat_message_moderation AS moderation WHERE moderation.message_id = message.id) ' +
		'AND ' + chat_shadow_visibility() + ' ORDER BY message.id DESC LIMIT 1'
	).get(client_id, client_id);
	const unread_count = db.query<{ count: number }, [number, number, number, number]>(
		'SELECT COUNT(*) AS count FROM global_chat_messages AS message ' +
		'JOIN clients AS sender ON sender.id = message.sender_id ' +
		"WHERE message.channel = 'testers' AND message.id > ? AND message.sender_id != ? " +
		'AND NOT EXISTS (SELECT 1 FROM global_chat_message_moderation AS moderation ' +
		'WHERE moderation.message_id = message.id) AND ' + chat_shadow_visibility()
	).get(last_read_message_id, client_id, client_id, client_id)?.count ?? 0;
	const moderation_count = db.query<{ count: number }, []>(
		"SELECT COUNT(*) AS count FROM global_chat_message_moderation AS moderation " +
		"JOIN global_chat_messages AS message ON message.id = moderation.message_id WHERE message.channel = 'testers'"
	).get()?.count ?? 0;
	return {
		conversation_kind: 'testers' as const,
		conversation_id: TESTER_CHAT_CONVERSATION_ID,
		participant: { client_id: null, display_name: 'Expedition', icon_id: 'multiplayer' },
		created_at: latest?.created_at ?? 0,
		latest_message: latest === null ? null : message_view(latest),
		unread_count,
		contributes_unread: can_send,
		can_send,
		moderation_count,
		can_moderate: is_admin(client_id),
		blocked: false
	};
}

export function get_tester_chat_unread_count(client_id: number): number {
	return is_expedition_tester(client_id) ? get_tester_chat_inbox(client_id).unread_count : 0;
}

export function list_tester_chat_messages(client_id: number, conversation_id: number,
	before: number | null, after: number | null): TesterResult<{
		messages: ReturnType<typeof message_view>[]; has_more: boolean
	}> {
	if (conversation_id !== TESTER_CHAT_CONVERSATION_ID ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) ||
		(before !== null && after !== null))
		return { status: 'bad_request' };
	ensure_read_state(client_id);
	const values: number[] = [client_id, client_id];
	let cursor = '';
	let order = 'DESC';
	let limit = CHAT_MESSAGE_PAGE_SIZE + 1;
	if (before !== null) {
		cursor = ' AND message.id < ?';
		values.push(before);
	} else if (after !== null) {
		cursor = ' AND message.id > ?';
		values.push(after);
		order = 'ASC';
		limit = MAX_INCREMENTAL_MESSAGES + 1;
	}
	const rows = db.query<TesterMessage, number[]>(
		'SELECT message.*, sender.display_name, sender.icon_id FROM global_chat_messages AS message ' +
		'JOIN clients AS sender ON sender.id = message.sender_id ' +
		"WHERE message.channel = 'testers' AND NOT EXISTS " +
		'(SELECT 1 FROM global_chat_message_moderation AS moderation WHERE moderation.message_id = message.id) ' +
		'AND ' + chat_shadow_visibility() + cursor + ` ORDER BY message.id ${order} LIMIT ${limit}`
	).all(...values);
	const page_limit = after === null ? CHAT_MESSAGE_PAGE_SIZE : MAX_INCREMENTAL_MESSAGES;
	const has_more = rows.length > page_limit;
	const page = rows.slice(0, page_limit);
	if (order === 'DESC') page.reverse();
	if (before === null && page.length > 0) {
		db.query('UPDATE tester_chat_read_state SET last_read_message_id = MAX(last_read_message_id, ?) ' +
			'WHERE client_id = ?').run(page[page.length - 1]!.id, client_id);
	}
	return { status: 'ok', value: { messages: page.map(message_view), has_more } };
}

export function send_tester_chat_message(client_id: number, conversation_id: number, idempotency_key: string,
	content: string, now = Date.now(), parts?: ChatPart[]): TesterResult<{
		message: ReturnType<typeof message_view>; retry_after_ms: number
	}> {
	const trimmed = typeof content === 'string' ? content.trim() : '';
	if (conversation_id !== TESTER_CHAT_CONVERSATION_ID || typeof idempotency_key !== 'string' ||
		idempotency_key.length < 1 || idempotency_key.length > 128 ||
		trimmed.length < 1 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH)
		return { status: 'bad_request' };
	const send = db.transaction((): TesterResult<{ message_id: number; retry_after_ms: number }> => {
		if (!is_expedition_tester(client_id)) return { status: 'forbidden' };
		const duplicate = db.query<{ id: number; content: string; channel: string }, [number, string]>(
			'SELECT id, content, channel FROM global_chat_messages WHERE sender_id = ? AND idempotency_key = ?'
		).get(client_id, idempotency_key);
		if (duplicate !== null) {
			if (duplicate.channel !== 'testers' || duplicate.content !== trimmed || !same_chat_parts('global', duplicate.id, parts))
				return { status: 'bad_request' };
			return { status: 'ok', value: { message_id: duplicate.id,
				retry_after_ms: current_throttle_wait(client_id, now, 'testers') } };
		}
		const retry_after_ms = current_throttle_wait(client_id, now, 'testers');
		if (retry_after_ms > 0) return { status: 'throttled', retry_after_ms };
		const created = db.query('INSERT INTO global_chat_messages ' +
			'(sender_id, idempotency_key, content, created_at, shadow_hidden, channel) VALUES (?, ?, ?, ?, ?, ?)'
		).run(client_id, idempotency_key, trimmed, now, is_chat_shadowbanned(client_id) ? 1 : 0, 'testers');
		save_chat_parts('global', Number(created.lastInsertRowid), parts);
		return { status: 'ok', value: { message_id: Number(created.lastInsertRowid),
			retry_after_ms: current_throttle_wait(client_id, now, 'testers') } };
	});
	const result = send.immediate();
	if (result.status !== 'ok') return result;
	return { status: 'ok', value: { message: message_view(get_message(result.value.message_id) as TesterMessage),
		retry_after_ms: result.value.retry_after_ms } };
}

export function moderate_tester_chat_message(client_id: number, message_id: number, now = Date.now()) {
	if (!Number.isSafeInteger(message_id) || message_id < 1 || !is_admin(client_id))
		return { status: 'missing' as const };
	if (get_message(message_id) === null) return { status: 'missing' as const };
	db.query('INSERT INTO global_chat_message_moderation (message_id, deleted_at) VALUES (?, ?) ' +
		'ON CONFLICT DO NOTHING').run(message_id, now);
	return { status: 'ok' as const, value: { deleted: true as const } };
}
