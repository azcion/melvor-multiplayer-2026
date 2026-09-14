import { db } from './db';
import { can_access_support_conversation } from './support_chat';

export type ChatMessageKind = 'private' | 'guild' | 'global' | 'support' | 'poll-discussion';

type ReactionRow = {
	message_id: number;
	reaction: string;
	count: number;
	first_created_at: number;
	reacted: number;
};

export type ChatReactionSummary = {
	reaction: string;
	count: number;
	reacted: boolean;
};

type MessageWithReactions = {
	message_id: number;
	reactions?: ChatReactionSummary[];
};

const reaction_tables: Record<ChatMessageKind, string> = {
	private: 'chat_message_reactions',
	guild: 'guild_chat_message_reactions',
	global: 'global_chat_message_reactions',
	support: 'support_message_reactions',
	'poll-discussion': 'poll_discussion_message_reactions'
};

const message_tables: Record<ChatMessageKind, string> = {
	private: 'chat_messages',
	guild: 'guild_chat_messages',
	global: 'global_chat_messages',
	support: 'support_messages',
	'poll-discussion': 'poll_discussion_messages'
};

const conversation_columns: Record<Exclude<ChatMessageKind, 'global'>, string> = {
	private: 'conversation_id',
	guild: 'guild_id',
	support: 'conversation_id',
	'poll-discussion': 'poll_id'
};

function message_is_visible(client_id: number, kind: ChatMessageKind, conversation_id: number, message_id: number): boolean {
	if (kind === 'private') {
		return db.query<{ visible: number }, [number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `chat_messages` AS message ' +
			'JOIN `chat_participants` AS participant ON participant.`conversation_id` = message.`conversation_id` ' +
			'WHERE message.`id` = ? AND message.`conversation_id` = ? AND participant.`client_id` = ? ' +
			'AND message.`id` > participant.`hidden_through_message_id` ' +
			'AND NOT EXISTS (SELECT 1 FROM `chat_message_deletions` AS deletion ' +
			'WHERE deletion.`message_id` = message.`id` AND deletion.`client_id` = ?)) AS `visible`'
		).get(message_id, conversation_id, client_id, client_id)?.visible === 1;
	}
	if (kind === 'guild') {
		return db.query<{ visible: number }, [number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `guild_chat_messages` AS message ' +
			'JOIN `guild_memberships` AS membership ON membership.`guild_id` = message.`guild_id` ' +
			'JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
			'WHERE message.`id` = ? AND message.`guild_id` = ? AND client.`id` = ? AND client.`guild_chat_enabled` = 1 ' +
			'AND NOT EXISTS (SELECT 1 FROM `guild_chat_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`)) AS `visible`'
		).get(message_id, conversation_id, client_id)?.visible === 1;
	}
	if (kind === 'global') {
		return conversation_id === 1 && db.query<{ visible: number }, [number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `global_chat_messages` AS message JOIN `clients` AS client ON client.`id` = ? ' +
			'WHERE message.`id` = ? AND client.`global_chat_enabled` = 1 AND client.`deleted_at` IS NULL ' +
			'AND NOT EXISTS (SELECT 1 FROM `global_chat_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`)) AS `visible`'
		).get(client_id, message_id)?.visible === 1;
	}
	if (kind === 'poll-discussion') {
		return db.query<{ visible: number }, [number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `poll_discussion_messages` WHERE `id` = ? AND `poll_id` = ?) AS `visible`'
		).get(message_id, conversation_id)?.visible === 1;
	}
	if (!can_access_support_conversation(client_id, conversation_id))
		return false;
	return db.query<{ visible: number }, [number, number]>(
		'SELECT EXISTS(SELECT 1 FROM `support_messages` AS message WHERE message.`id` = ? AND message.`conversation_id` = ? ' +
		'AND NOT EXISTS (SELECT 1 FROM `support_message_moderation` AS moderation ' +
		'WHERE moderation.`message_id` = message.`id`)) AS `visible`'
	).get(message_id, conversation_id)?.visible === 1;
}

export function reaction_summaries(kind: ChatMessageKind, client_id: number, message_ids: number[]): Map<number, ChatReactionSummary[]> {
	const result = new Map<number, ChatReactionSummary[]>();
	for (const message_id of message_ids)
		result.set(message_id, []);
	if (message_ids.length === 0)
		return result;
	const placeholders = message_ids.map(() => '?').join(', ');
	const rows = db.query<ReactionRow, number[]>(
		`SELECT \`message_id\`, \`reaction\`, COUNT(*) AS \`count\`, MIN(\`created_at\`) AS \`first_created_at\`, ` +
		`MAX(\`client_id\` = ?) AS \`reacted\` FROM \`${reaction_tables[kind]}\` ` +
		`WHERE \`message_id\` IN (${placeholders}) GROUP BY \`message_id\`, \`reaction\` ` +
		'ORDER BY `message_id`, `first_created_at`, `reaction`'
	).all(client_id, ...message_ids);
	for (const row of rows)
		result.get(row.message_id)?.push({ reaction: row.reaction, count: row.count, reacted: row.reacted === 1 });
	return result;
}

export function attach_reactions<T extends MessageWithReactions>(kind: ChatMessageKind, client_id: number, messages: T[]): T[] {
	const summaries = reaction_summaries(kind, client_id, messages.map(message => message.message_id).filter(id => id > 0));
	return messages.map(message => ({ ...message, reactions: summaries.get(message.message_id) ?? [] }));
}

type ReactionUpdateRow = {
	message_id: number;
	reaction_revision: number;
};

export function reaction_updates(kind: ChatMessageKind, client_id: number, conversation_id: number,
	after_revision: number | null) {
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1 ||
		(after_revision !== null && (!Number.isSafeInteger(after_revision) || after_revision < 0)))
		return { status: 'bad_request' as const };
	const conversation_clause = kind === 'global' ? '' : ` WHERE \`${conversation_columns[kind]}\` = ?`;
	const conversation_values = kind === 'global' ? [] : [conversation_id];
	if (kind === 'global' && conversation_id !== 1)
		return { status: 'bad_request' as const };
	if (after_revision === null) {
		const row = db.query<{ reaction_revision: number }, number[]>(
			`SELECT COALESCE(MAX(\`reaction_revision\`), 0) AS \`reaction_revision\` FROM \`${message_tables[kind]}\`` +
			conversation_clause
		).get(...conversation_values);
		return { status: 'ok' as const, value: { reaction_revision: row?.reaction_revision ?? 0, reaction_updates: [] } };
	}
	const revision_clause = conversation_clause === '' ? ' WHERE ' : ' AND ';
	const rows = db.query<ReactionUpdateRow, number[]>(
		`SELECT \`id\` AS \`message_id\`, \`reaction_revision\` FROM \`${message_tables[kind]}\`` +
		conversation_clause + revision_clause + '`reaction_revision` > ? ORDER BY `reaction_revision`'
	).all(...conversation_values, after_revision);
	const reaction_revision = rows.at(-1)?.reaction_revision ?? after_revision;
	const visible_rows = rows.filter(row => message_is_visible(client_id, kind, conversation_id, row.message_id));
	const summaries = reaction_summaries(kind, client_id, visible_rows.map(row => row.message_id));
	return {
		status: 'ok' as const,
		value: {
			reaction_revision,
			reaction_updates: visible_rows.map(row => ({
				message_id: row.message_id,
				reaction_revision: row.reaction_revision,
				reactions: summaries.get(row.message_id) ?? []
			}))
		}
	};
}

export function set_message_reaction(client_id: number, kind: ChatMessageKind, conversation_id: number,
	message_id: number, reaction: string, reacted: boolean, now = Date.now()) {
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1 ||
		!Number.isSafeInteger(message_id) || message_id < 1 || typeof reaction !== 'string' || typeof reacted !== 'boolean')
		return { status: 'bad_request' as const };
	if (!message_is_visible(client_id, kind, conversation_id, message_id))
		return { status: 'missing' as const };
	return db.transaction(() => {
		let changed = 0;
		if (reacted) {
			changed = db.query(
				`INSERT INTO \`${reaction_tables[kind]}\` (\`message_id\`, \`client_id\`, \`reaction\`, \`created_at\`) ` +
					'VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING'
			).run(message_id, client_id, reaction, now).changes;
		} else {
			changed = db.query(
				`DELETE FROM \`${reaction_tables[kind]}\` WHERE \`message_id\` = ? AND \`client_id\` = ? AND \`reaction\` = ?`
			).run(message_id, client_id, reaction).changes;
		}
		if (changed > 0) {
			const revision = db.query<{ revision: number }, []>(
				"UPDATE `service_settings` SET `value` = CAST(`value` AS INTEGER) + 1 " +
				"WHERE `key` = 'chat_reaction_revision' RETURNING CAST(`value` AS INTEGER) AS `revision`"
			).get()?.revision;
			if (revision === undefined)
				throw new Error('Chat reaction revision setting is missing');
			db.query(`UPDATE \`${message_tables[kind]}\` SET \`reaction_revision\` = ? WHERE \`id\` = ?`)
				.run(revision, message_id);
		}
		const reaction_revision = db.query<{ reaction_revision: number }, [number]>(
			`SELECT \`reaction_revision\` FROM \`${message_tables[kind]}\` WHERE \`id\` = ?`
		).get(message_id)?.reaction_revision ?? 0;
		return { status: 'ok' as const, value: {
			reactions: reaction_summaries(kind, client_id, [message_id]).get(message_id) ?? [],
			reaction_revision
		} };
	}).immediate();
}
