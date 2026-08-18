import { db } from './db';
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_MESSAGE_PAGE_SIZE } from './chat';

export const GUILD_CHAT_CAPABILITY = 'guild-chat-v1';

const MAX_INCREMENTAL_MESSAGES = 100;

type GuildChatAccess = {
	guild_id: number;
	name: string;
	icon_id: string;
	guild_chat_enabled: number;
};

type GuildChatMessage = {
	id: number;
	guild_id: number;
	sender_id: number;
	content: string;
	created_at: number;
	display_name: string;
	icon_id: string;
};

type GuildChatResult<T> = {
	status: 'ok';
	value: T;
} | {
	status: 'bad_request' | 'missing';
};

function current_access(client_id: number): GuildChatAccess | null {
	return db.query<GuildChatAccess, [number]>(
		'SELECT guild.`id` AS `guild_id`, guild.`name`, guild.`icon_id`, client.`guild_chat_enabled` ' +
		'FROM `clients` AS client JOIN `guild_memberships` AS membership ON membership.`client_id` = client.`id` ' +
		'JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` WHERE client.`id` = ? LIMIT 1'
	).get(client_id);
}

function latest_message_id(guild_id: number): number {
	return db.query<{ id: number }, [number]>(
		'SELECT COALESCE(MAX(`id`), 0) AS `id` FROM `guild_chat_messages` WHERE `guild_id` = ?'
	).get(guild_id)?.id ?? 0;
}

function ensure_read_state(client_id: number, guild_id: number): number {
	db.query(
		'INSERT INTO `guild_chat_read_state` (`guild_id`, `client_id`, `last_read_message_id`) VALUES(?, ?, ?) ' +
		'ON CONFLICT (`guild_id`, `client_id`) DO NOTHING'
	).run(guild_id, client_id, latest_message_id(guild_id));
	return db.query<{ last_read_message_id: number }, [number, number]>(
		'SELECT `last_read_message_id` FROM `guild_chat_read_state` WHERE `guild_id` = ? AND `client_id` = ?'
	).get(guild_id, client_id)?.last_read_message_id ?? 0;
}

function message_view(message: GuildChatMessage) {
	return {
		message_id: message.id,
		conversation_id: message.guild_id,
		sender_id: message.sender_id,
		sender: { display_name: message.display_name, icon_id: message.icon_id },
		content: message.content,
		created_at: message.created_at
	};
}

function get_message(message_id: number): GuildChatMessage | null {
	return db.query<GuildChatMessage, [number]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `guild_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE message.`id` = ? LIMIT 1'
	).get(message_id);
}

export function has_guild_chat_capability(url: URL): boolean {
	return url.searchParams.getAll('capabilities').some(value =>
		value.split(',').map(entry => entry.trim()).includes(GUILD_CHAT_CAPABILITY)
	);
}

export function get_guild_chat_inbox(client_id: number) {
	const access = current_access(client_id);
	const enabled = access?.guild_chat_enabled === 1 || (access === null && db.query<{ enabled: number }, [number]>(
		'SELECT `guild_chat_enabled` AS `enabled` FROM `clients` WHERE `id` = ?'
	).get(client_id)?.enabled === 1);
	if (access === null)
		return { state: { affiliated: false, enabled }, conversation: null };
	if (!enabled)
		return { state: { affiliated: true, enabled: false }, conversation: null };

	const last_read_message_id = ensure_read_state(client_id, access.guild_id);
	const latest = db.query<GuildChatMessage, [number]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `guild_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE message.`guild_id` = ? ' +
		'AND NOT EXISTS (SELECT 1 FROM `guild_chat_message_moderation` AS moderation ' +
		'WHERE moderation.`message_id` = message.`id`) ORDER BY message.`id` DESC LIMIT 1'
	).get(access.guild_id);
	const unread_count = db.query<{ count: number }, [number, number, number]>(
		'SELECT COUNT(*) AS `count` FROM `guild_chat_messages` AS message WHERE message.`guild_id` = ? ' +
		'AND message.`id` > ? AND message.`sender_id` != ? AND NOT EXISTS ' +
		'(SELECT 1 FROM `guild_chat_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`)'
	).get(access.guild_id, last_read_message_id, client_id)?.count ?? 0;
	const moderation_count = db.query<{ count: number }, [number]>(
		'SELECT COUNT(*) AS `count` FROM `guild_chat_message_moderation` AS moderation ' +
		'JOIN `guild_chat_messages` AS message ON message.`id` = moderation.`message_id` ' +
		'WHERE message.`guild_id` = ?'
	).get(access.guild_id)?.count ?? 0;

	return {
		state: { affiliated: true, enabled: true },
		conversation: {
			conversation_kind: 'guild' as const,
			conversation_id: access.guild_id,
			guild_id: access.guild_id,
			participant: { client_id: null, display_name: access.name, icon_id: access.icon_id },
			created_at: latest?.created_at ?? 0,
			latest_message: latest === null ? null : message_view(latest),
			unread_count,
			moderation_count,
			blocked: false
		}
	};
}

export function get_guild_chat_unread_count(client_id: number): number {
	const inbox = get_guild_chat_inbox(client_id);
	return inbox.conversation?.unread_count ?? 0;
}

export function list_guild_chat_messages(
	client_id: number,
	guild_id: number,
	before: number | null,
	after: number | null
): GuildChatResult<{ messages: ReturnType<typeof message_view>[]; has_more: boolean }> {
	if (!Number.isSafeInteger(guild_id) || guild_id < 1 ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) ||
		(before !== null && after !== null))
		return { status: 'bad_request' };
	const access = current_access(client_id);
	if (access === null || access.guild_id !== guild_id || access.guild_chat_enabled !== 1)
		return { status: 'missing' };
	ensure_read_state(client_id, guild_id);

	const values: number[] = [guild_id];
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
	const rows = db.query<GuildChatMessage, number[]>(
		'SELECT message.*, sender.`display_name`, sender.`icon_id` FROM `guild_chat_messages` AS message ' +
		'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` WHERE message.`guild_id` = ? ' +
		'AND NOT EXISTS (SELECT 1 FROM `guild_chat_message_moderation` AS moderation ' +
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
			'UPDATE `guild_chat_read_state` SET `last_read_message_id` = MAX(`last_read_message_id`, ?) ' +
			'WHERE `guild_id` = ? AND `client_id` = ?'
		).run(newest_message_id, guild_id, client_id);
	}
	return { status: 'ok', value: { messages: page.map(message_view), has_more } };
}

export function send_guild_chat_message(
	client_id: number,
	guild_id: number,
	idempotency_key: string,
	content: string,
	now = Date.now()
): GuildChatResult<{ message: ReturnType<typeof message_view> }> {
	const trimmed = typeof content === 'string' ? content.trim() : '';
	if (!Number.isSafeInteger(guild_id) || guild_id < 1 || typeof idempotency_key !== 'string' ||
		idempotency_key.length < 1 || idempotency_key.length > 128 ||
		trimmed.length < 1 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH)
		return { status: 'bad_request' };
	const send = db.transaction((): GuildChatResult<{ message_id: number }> => {
		const access = current_access(client_id);
		if (access === null || access.guild_id !== guild_id || access.guild_chat_enabled !== 1)
			return { status: 'missing' };
		const duplicate = db.query<{ id: number; guild_id: number; content: string }, [number, string]>(
			'SELECT `id`, `guild_id`, `content` FROM `guild_chat_messages` ' +
			'WHERE `sender_id` = ? AND `idempotency_key` = ?'
		).get(client_id, idempotency_key);
		if (duplicate !== null) {
			if (duplicate.guild_id !== guild_id || duplicate.content !== trimmed)
				return { status: 'bad_request' };
			return { status: 'ok', value: { message_id: duplicate.id } };
		}
		const created = db.query(
			'INSERT INTO `guild_chat_messages` (`guild_id`, `sender_id`, `idempotency_key`, `content`, `created_at`) ' +
			'VALUES(?, ?, ?, ?, ?)'
		).run(guild_id, client_id, idempotency_key, trimmed, now);
		return { status: 'ok', value: { message_id: Number(created.lastInsertRowid) } };
	});
	const result = send.immediate();
	if (result.status !== 'ok')
		return result;
	return { status: 'ok', value: { message: message_view(get_message(result.value.message_id) as GuildChatMessage) } };
}

export function set_guild_chat_enabled(client_id: number, enabled: boolean): { enabled: boolean } {
	return db.transaction(() => {
		const client = db.query<{ guild_chat_enabled: number }, [number]>(
			'SELECT `guild_chat_enabled` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id) as { guild_chat_enabled: number };
		if ((client.guild_chat_enabled === 1) === enabled)
			return { enabled };
		db.query('UPDATE `clients` SET `guild_chat_enabled` = ? WHERE `id` = ?').run(enabled ? 1 : 0, client_id);
		if (enabled) {
			const access = current_access(client_id);
			if (access !== null)
				db.query(
					'INSERT INTO `guild_chat_read_state` (`guild_id`, `client_id`, `last_read_message_id`) VALUES(?, ?, ?) ' +
					'ON CONFLICT (`guild_id`, `client_id`) DO UPDATE SET `last_read_message_id` = excluded.`last_read_message_id`'
				).run(access.guild_id, client_id, latest_message_id(access.guild_id));
		}
		return { enabled };
	}).immediate();
}
