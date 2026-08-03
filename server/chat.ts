import { db } from './db';

export const CHAT_MESSAGE_PAGE_SIZE = 5;
export const CHAT_MESSAGE_MAX_LENGTH = 1000;
export const CHAT_PRIVACY_ERROR = 'MOD_MP_CHAT_RECIPIENT_UNAVAILABLE';
export const CHAT_BUDGET_ERROR = 'MOD_MP_CHAT_BUDGET_EMPTY';

const BASE_CREDITS = 5;
const BASE_REFILL_INTERVAL = 60_000;
const REFILL_REDUCTION = 2_000;
const MINIMUM_REFILL_INTERVAL = 10_000;
const MAX_INCREMENTAL_MESSAGES = 100;

const NON_COMBAT_SKILL_IDS = new Set([
	'melvorD:Woodcutting',
	'melvorD:Fishing',
	'melvorD:Firemaking',
	'melvorD:Cooking',
	'melvorD:Mining',
	'melvorD:Smithing',
	'melvorD:Thieving',
	'melvorD:Farming',
	'melvorD:Fletching',
	'melvorD:Crafting',
	'melvorD:Runecrafting',
	'melvorD:Herblore',
	'melvorD:Agility',
	'melvorD:Summoning',
	'melvorD:Astrology',
	'melvorD:Township',
	'melvorAoD:Cartography',
	'melvorAoD:Archaeology',
	'melvorItA:Harvesting',
	'melvorItA:Corruption'
]);

type ChatBudget = {
	credits: number;
	maximum: number;
	refill_interval: number;
	next_refill_at: number;
};

type ChatClientRow = {
	id: number;
	messaging_enabled: number;
	messaging_credits: number;
	messaging_refill_at: number;
};

type ConversationRow = {
	id: number;
	participant_low_id: number;
	participant_high_id: number;
	created_at: number;
};

type MessageRow = {
	id: number;
	conversation_id: number;
	sender_id: number;
	content: string;
	created_at: number;
	display_name: string;
	icon_id: string;
};

type ChatResult<T> = { status: 'ok'; value: T } | { status: 'bad_request' | 'missing' | 'privacy' | 'budget' };

function budget_configuration(client_id: number): { maximum: number; refill_interval: number } {
	const levels = db.query<{ skill_id: string; level: number }, [number]>(
		'SELECT `skill_id`, `level` FROM `status_snapshot_skills` WHERE `client_id` = ?'
	).all(client_id);
	let maximum_bonus = 0;
	let interval_bonus = 0;
	for (const skill of levels) {
		if (!NON_COMBAT_SKILL_IDS.has(skill.skill_id))
			continue;
		if (skill.level >= 99)
			maximum_bonus++;
		if (skill.level >= 120)
			interval_bonus++;
	}
	return {
		maximum: BASE_CREDITS + maximum_bonus,
		refill_interval: Math.max(
			MINIMUM_REFILL_INTERVAL,
			BASE_REFILL_INTERVAL - interval_bonus * REFILL_REDUCTION
		)
	};
}

function refresh_budget(client_id: number, now: number): ChatBudget {
	const client = db.query<ChatClientRow, [number]>(
		'SELECT `id`, `messaging_enabled`, `messaging_credits`, `messaging_refill_at` ' +
		'FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(client_id) as ChatClientRow;
	const configuration = budget_configuration(client_id);
	let credits = Math.min(client.messaging_credits, configuration.maximum);
	let next_refill_at = client.messaging_refill_at;
	if (next_refill_at === 0)
		next_refill_at = now + configuration.refill_interval;

	if (credits < configuration.maximum && now >= next_refill_at) {
		const regenerated = Math.floor((now - next_refill_at) / configuration.refill_interval) + 1;
		credits = Math.min(configuration.maximum, credits + regenerated);
		next_refill_at = credits === configuration.maximum
			? now + configuration.refill_interval
			: next_refill_at + regenerated * configuration.refill_interval;
	} else if (credits === configuration.maximum && now >= next_refill_at) {
		next_refill_at = now + configuration.refill_interval;
	}

	db.query(
		'UPDATE `clients` SET `messaging_credits` = ?, `messaging_refill_at` = ? WHERE `id` = ?'
	).run(credits, next_refill_at, client_id);
	return { credits, ...configuration, next_refill_at };
}

function participant_conversation(conversation_id: number, client_id: number): ConversationRow | null {
	return db.query<ConversationRow, [number, number]>(
		'SELECT c.* FROM `chat_conversations` AS c JOIN `chat_participants` AS p ON p.`conversation_id` = c.`id` ' +
		'WHERE c.`id` = ? AND p.`client_id` = ? LIMIT 1'
	).get(conversation_id, client_id);
}

function other_participant(conversation: ConversationRow, client_id: number): number {
	return conversation.participant_low_id === client_id
		? conversation.participant_high_id
		: conversation.participant_low_id;
}

function privacy_allows(client_id: number, other_id: number): boolean {
	const row = db.query<{ allowed: number }, number[]>(
		'SELECT NOT EXISTS(' +
			'SELECT 1 FROM `clients` WHERE `id` IN (?, ?) ' +
			'AND (`messaging_enabled` = 0 OR `deleted_at` IS NOT NULL)' +
		') AND NOT EXISTS(' +
			'SELECT 1 FROM `chat_blocks` WHERE (`blocker_id` = ? AND `blocked_id` = ?) ' +
			'OR (`blocker_id` = ? AND `blocked_id` = ?)' +
		') AS `allowed`'
	).get(client_id, other_id, client_id, other_id, other_id, client_id) as { allowed: number };
	return row.allowed === 1;
}

function message_view(message: MessageRow) {
	return {
		message_id: message.id,
		conversation_id: message.conversation_id,
		sender_id: message.sender_id,
		sender: { display_name: message.display_name, icon_id: message.icon_id },
		content: message.content,
		created_at: message.created_at
	};
}

function get_message(message_id: number): MessageRow | null {
	return db.query<MessageRow, [number]>(
		'SELECT m.*, c.`display_name`, c.`icon_id` FROM `chat_messages` AS m ' +
		'JOIN `clients` AS c ON c.`id` = m.`sender_id` WHERE m.`id` = ? LIMIT 1'
	).get(message_id);
}

export function get_chat_state(client_id: number, now = Date.now()) {
	const client = db.query<Pick<ChatClientRow, 'messaging_enabled'>, [number]>(
		'SELECT `messaging_enabled` FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(client_id) as Pick<ChatClientRow, 'messaging_enabled'>;
	return {
		client_id,
		messaging_enabled: client.messaging_enabled === 1,
		budget: db.transaction(() => refresh_budget(client_id, now)).immediate()
	};
}

export function get_unread_chat_count(client_id: number): number {
	const row = db.query<{ count: number }, [number]>(
		'SELECT COUNT(*) AS `count` FROM `chat_messages` AS m ' +
		'JOIN `chat_participants` AS p ON p.`conversation_id` = m.`conversation_id` AND p.`client_id` = ? ' +
		'WHERE m.`sender_id` != p.`client_id` ' +
		'AND m.`id` > p.`hidden_through_message_id` ' +
		'AND NOT EXISTS(SELECT 1 FROM `chat_message_reads` AS r ' +
			'WHERE r.`message_id` = m.`id` AND r.`client_id` = p.`client_id`) ' +
		'AND NOT EXISTS(SELECT 1 FROM `chat_message_deletions` AS d ' +
			'WHERE d.`message_id` = m.`id` AND d.`client_id` = p.`client_id`)'
	).get(client_id);
	return row?.count ?? 0;
}

export function list_conversations(client_id: number) {
	const conversations = db.query<ConversationRow & {
		conversation_hidden: number;
		hidden_through_message_id: number;
	}, [number]>(
		'SELECT c.*, p.`conversation_hidden`, p.`hidden_through_message_id` ' +
		'FROM `chat_conversations` AS c JOIN `chat_participants` AS p ON p.`conversation_id` = c.`id` ' +
		'WHERE p.`client_id` = ? ORDER BY c.`id` DESC'
	).all(client_id);
	const result = [];
	for (const conversation of conversations) {
		const other_id = other_participant(conversation, client_id);
		const latest = db.query<MessageRow, [number, number, number]>(
			'SELECT m.*, sender.`display_name`, sender.`icon_id` FROM `chat_messages` AS m ' +
			'JOIN `clients` AS sender ON sender.`id` = m.`sender_id` ' +
			'WHERE m.`conversation_id` = ? AND m.`id` > ? ' +
			'AND NOT EXISTS(SELECT 1 FROM `chat_message_deletions` AS d WHERE d.`message_id` = m.`id` AND d.`client_id` = ?) ' +
			'ORDER BY m.`id` DESC LIMIT 1'
		).get(conversation.id, conversation.hidden_through_message_id, client_id);
		if (conversation.conversation_hidden === 1 && latest === null)
			continue;
		const other = db.query<{ display_name: string; icon_id: string }, [number]>(
			'SELECT `display_name`, `icon_id` FROM `clients` WHERE `id` = ? AND `deleted_at` IS NULL LIMIT 1'
		).get(other_id);
		if (other === null)
			continue;
		const unread = db.query<{ count: number }, number[]>(
			'SELECT COUNT(*) AS `count` FROM `chat_messages` AS m WHERE m.`conversation_id` = ? ' +
			'AND m.`sender_id` != ? AND m.`id` > ? ' +
			'AND NOT EXISTS(SELECT 1 FROM `chat_message_reads` AS r WHERE r.`message_id` = m.`id` AND r.`client_id` = ?) ' +
			'AND NOT EXISTS(SELECT 1 FROM `chat_message_deletions` AS d WHERE d.`message_id` = m.`id` AND d.`client_id` = ?)'
		).get(
			conversation.id,
			client_id,
			conversation.hidden_through_message_id,
			client_id,
			client_id
		) as { count: number };
		const blocked = db.query<{ blocked: number }, [number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `chat_blocks` WHERE `blocker_id` = ? AND `blocked_id` = ?) AS `blocked`'
		).get(client_id, other_id) as { blocked: number };
		result.push({
			conversation_id: conversation.id,
			participant: { client_id: other_id, ...other },
			created_at: conversation.created_at,
			latest_message: latest === null ? null : message_view(latest),
			unread_count: unread.count,
			blocked: blocked.blocked === 1
		});
	}
	result.sort((a, b) =>
		(b.latest_message?.message_id ?? 0) - (a.latest_message?.message_id ?? 0) ||
		b.conversation_id - a.conversation_id
	);
	return result;
}

export function start_conversation(client_id: number, target_id: number): ChatResult<ReturnType<typeof conversation_view>> {
	if (!Number.isSafeInteger(target_id) || target_id < 1 || target_id === client_id)
		return { status: 'bad_request' };
	const create = db.transaction((): ChatResult<ConversationRow> => {
		const low_id = Math.min(client_id, target_id);
		const high_id = Math.max(client_id, target_id);
		const existing = db.query<ConversationRow, [number, number]>(
			'SELECT * FROM `chat_conversations` WHERE `participant_low_id` = ? AND `participant_high_id` = ? LIMIT 1'
		).get(low_id, high_id);
		if (existing !== null)
			return { status: 'ok', value: existing };
		const target = db.query<{ id: number }, [number]>(
			'SELECT `id` FROM `clients` WHERE `id` = ? AND `deleted_at` IS NULL LIMIT 1'
		).get(target_id);
		if (target === null)
			return { status: 'missing' };
		const guildmates = db.query<{ shared: number }, [number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `guild_memberships` AS a JOIN `guild_memberships` AS b ' +
			'ON b.`guild_id` = a.`guild_id` WHERE a.`client_id` = ? AND b.`client_id` = ?) AS `shared`'
		).get(client_id, target_id) as { shared: number };
		if (guildmates.shared !== 1)
			return { status: 'missing' };
		if (!privacy_allows(client_id, target_id))
			return { status: 'privacy' };
		const created_at = Date.now();
		const result = db.query(
			'INSERT INTO `chat_conversations` (`participant_low_id`, `participant_high_id`, `created_at`) VALUES(?, ?, ?)'
		).run(low_id, high_id, created_at);
		const conversation_id = Number(result.lastInsertRowid);
		const insert_participant = db.query(
			'INSERT INTO `chat_participants` (`conversation_id`, `client_id`) VALUES(?, ?)'
		);
		insert_participant.run(conversation_id, low_id);
		insert_participant.run(conversation_id, high_id);
		return { status: 'ok', value: { id: conversation_id, participant_low_id: low_id,
			participant_high_id: high_id, created_at } };
	});
	const result = create.immediate();
	return result.status === 'ok'
		? { status: 'ok', value: conversation_view(result.value, client_id) }
		: result;
}

function conversation_view(conversation: ConversationRow, client_id: number) {
	const other_id = other_participant(conversation, client_id);
	const other = db.query<{ display_name: string; icon_id: string }, [number]>(
		'SELECT `display_name`, `icon_id` FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(other_id) as { display_name: string; icon_id: string };
	return {
		conversation_id: conversation.id,
		participant: { client_id: other_id, ...other },
		created_at: conversation.created_at
	};
}

export function list_messages(
	client_id: number,
	conversation_id: number,
	before: number | null,
	after: number | null
): ChatResult<{ messages: ReturnType<typeof message_view>[]; has_more: boolean }> {
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1 ||
		(before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) ||
		(before !== null && after !== null))
		return { status: 'bad_request' };
	const conversation = participant_conversation(conversation_id, client_id);
	if (conversation === null)
		return { status: 'missing' };
	const participant = db.query<{ hidden_through_message_id: number }, [number, number]>(
		'SELECT `hidden_through_message_id` FROM `chat_participants` WHERE `conversation_id` = ? AND `client_id` = ?'
	).get(conversation_id, client_id) as { hidden_through_message_id: number };
	const values: Array<number> = [conversation_id, participant.hidden_through_message_id, client_id];
	let cursor = '';
	let order = 'DESC';
	let limit = CHAT_MESSAGE_PAGE_SIZE + 1;
	if (before !== null) {
		cursor = ' AND m.`id` < ?';
		values.push(before);
	} else if (after !== null) {
		cursor = ' AND m.`id` > ?';
		values.push(after);
		order = 'ASC';
		limit = MAX_INCREMENTAL_MESSAGES + 1;
	}
	const rows = db.query<MessageRow, number[]>(
		'SELECT m.*, sender.`display_name`, sender.`icon_id` FROM `chat_messages` AS m ' +
		'JOIN `clients` AS sender ON sender.`id` = m.`sender_id` ' +
		'WHERE m.`conversation_id` = ? AND m.`id` > ? ' +
		'AND NOT EXISTS(SELECT 1 FROM `chat_message_deletions` AS d WHERE d.`message_id` = m.`id` AND d.`client_id` = ?) ' +
		cursor + ` ORDER BY m.\`id\` ${order} LIMIT ${limit}`
	).all(...values);
	const page_limit = after === null ? CHAT_MESSAGE_PAGE_SIZE : MAX_INCREMENTAL_MESSAGES;
	const has_more = rows.length > page_limit;
	const page = rows.slice(0, page_limit);
	if (order === 'DESC')
		page.reverse();
	const mark_read = db.query(
		'INSERT INTO `chat_message_reads` (`message_id`, `client_id`, `read_at`) VALUES(?, ?, ?) ON CONFLICT DO NOTHING'
	);
	const read_at = Date.now();
	for (const message of page)
		if (message.sender_id !== client_id)
			mark_read.run(message.id, client_id, read_at);
	return { status: 'ok', value: { messages: page.map(message_view), has_more } };
}

export function send_message(
	client_id: number,
	conversation_id: number,
	idempotency_key: string,
	content: string,
	now = Date.now()
): ChatResult<{ message: ReturnType<typeof message_view>; budget: ChatBudget }> {
	const trimmed = typeof content === 'string' ? content.trim() : '';
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1 ||
		typeof idempotency_key !== 'string' || idempotency_key.length < 1 || idempotency_key.length > 128 ||
		trimmed.length < 1 || trimmed.length > CHAT_MESSAGE_MAX_LENGTH)
		return { status: 'bad_request' };
	const send = db.transaction((): ChatResult<{ message_id: number; budget: ChatBudget }> => {
		const duplicate = db.query<{ id: number; conversation_id: number; content: string }, [number, string]>(
			'SELECT `id`, `conversation_id`, `content` FROM `chat_messages` WHERE `sender_id` = ? AND `idempotency_key` = ?'
		).get(client_id, idempotency_key);
		if (duplicate !== null) {
			if (duplicate.conversation_id !== conversation_id || duplicate.content !== trimmed)
				return { status: 'bad_request' };
			return { status: 'ok', value: { message_id: duplicate.id, budget: refresh_budget(client_id, now) } };
		}
		const conversation = participant_conversation(conversation_id, client_id);
		if (conversation === null)
			return { status: 'missing' };
		const target_id = other_participant(conversation, client_id);
		if (!privacy_allows(client_id, target_id))
			return { status: 'privacy' };
		const budget = refresh_budget(client_id, now);
		if (budget.credits < 1)
			return { status: 'budget' };
		const result = db.query(
			'INSERT INTO `chat_messages` (`conversation_id`, `sender_id`, `idempotency_key`, `content`, `created_at`) ' +
			'VALUES(?, ?, ?, ?, ?)'
		).run(conversation_id, client_id, idempotency_key, trimmed, now);
		budget.credits--;
		db.query('UPDATE `clients` SET `messaging_credits` = ? WHERE `id` = ?').run(budget.credits, client_id);
		db.query(
			'UPDATE `chat_participants` SET `conversation_hidden` = 0 WHERE `conversation_id` = ?'
		).run(conversation_id);
		return { status: 'ok', value: { message_id: Number(result.lastInsertRowid), budget } };
	});
	const result = send.immediate();
	if (result.status !== 'ok')
		return result;
	return { status: 'ok', value: { message: message_view(get_message(result.value.message_id) as MessageRow),
		budget: result.value.budget } };
}

export function delete_message(client_id: number, message_id: number): ChatResult<{ deleted: true }> {
	if (!Number.isSafeInteger(message_id) || message_id < 1)
		return { status: 'bad_request' };
	const message = db.query<{ id: number }, [number, number]>(
		'SELECT m.`id` FROM `chat_messages` AS m JOIN `chat_participants` AS p ' +
		'ON p.`conversation_id` = m.`conversation_id` WHERE m.`id` = ? AND p.`client_id` = ? LIMIT 1'
	).get(message_id, client_id);
	if (message === null)
		return { status: 'missing' };
	db.query(
		'INSERT INTO `chat_message_deletions` (`message_id`, `client_id`, `deleted_at`) VALUES(?, ?, ?) ' +
		'ON CONFLICT DO NOTHING'
	).run(message_id, client_id, Date.now());
	return { status: 'ok', value: { deleted: true } };
}

export function delete_conversation(client_id: number, conversation_id: number): ChatResult<{ deleted: true }> {
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1)
		return { status: 'bad_request' };
	if (participant_conversation(conversation_id, client_id) === null)
		return { status: 'missing' };
	const latest = db.query<{ id: number }, [number]>(
		'SELECT `id` FROM `chat_messages` WHERE `conversation_id` = ? ORDER BY `id` DESC LIMIT 1'
	).get(conversation_id);
	db.query(
		'UPDATE `chat_participants` SET `conversation_hidden` = 1, ' +
		'`hidden_through_message_id` = MAX(`hidden_through_message_id`, ?) ' +
		'WHERE `conversation_id` = ? AND `client_id` = ?'
	).run(latest?.id ?? 0, conversation_id, client_id);
	return { status: 'ok', value: { deleted: true } };
}

export function set_block(client_id: number, target_id: number, blocked: boolean): ChatResult<{ blocked: boolean }> {
	if (!Number.isSafeInteger(target_id) || target_id < 1 || target_id === client_id || typeof blocked !== 'boolean')
		return { status: 'bad_request' };
	const low_id = Math.min(client_id, target_id);
	const high_id = Math.max(client_id, target_id);
	const conversation = db.query<{ id: number }, [number, number]>(
		'SELECT `id` FROM `chat_conversations` WHERE `participant_low_id` = ? AND `participant_high_id` = ? LIMIT 1'
	).get(low_id, high_id);
	if (conversation === null)
		return { status: 'missing' };
	if (blocked)
		db.query(
			'INSERT INTO `chat_blocks` (`blocker_id`, `blocked_id`, `created_at`) VALUES(?, ?, ?) ON CONFLICT DO NOTHING'
		).run(client_id, target_id, Date.now());
	else
		db.query('DELETE FROM `chat_blocks` WHERE `blocker_id` = ? AND `blocked_id` = ?').run(client_id, target_id);
	return { status: 'ok', value: { blocked } };
}

export function set_messaging_enabled(client_id: number, enabled: boolean): ChatResult<{ messaging_enabled: boolean }> {
	if (typeof enabled !== 'boolean')
		return { status: 'bad_request' };
	db.query('UPDATE `clients` SET `messaging_enabled` = ? WHERE `id` = ?').run(enabled ? 1 : 0, client_id);
	return { status: 'ok', value: { messaging_enabled: enabled } };
}
