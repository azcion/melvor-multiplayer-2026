import { is_admin } from './admin_identity';
import { db } from './db';
import { chat_shadow_visibility } from './chat_shadowban';
import { can_access_support_conversation } from './support_chat';
import { has_expedition_access } from './account_tags';

export type ChatMessageKind = 'private' | 'alliance' | 'guild' | 'global' | 'testers' | 'support' | 'poll-discussion';

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
	alliance: 'alliance_chat_message_reactions',
	guild: 'guild_chat_message_reactions',
	global: 'global_chat_message_reactions',
	testers: 'global_chat_message_reactions',
	support: 'support_message_reactions',
	'poll-discussion': 'poll_discussion_message_reactions'
};

const message_tables: Record<ChatMessageKind, string> = {
	private: 'chat_messages',
	alliance: 'alliance_chat_messages',
	guild: 'guild_chat_messages',
	global: 'global_chat_messages',
	testers: 'global_chat_messages',
	support: 'support_messages',
	'poll-discussion': 'poll_discussion_messages'
};

const conversation_columns: Record<Exclude<ChatMessageKind, 'global' | 'testers'>, string> = {
	private: 'conversation_id',
	alliance: 'alliance_id',
	guild: 'guild_id',
	support: 'conversation_id',
	'poll-discussion': 'poll_id'
};

export function message_is_visible(client_id: number, kind: ChatMessageKind, conversation_id: number, message_id: number, include_moderated = false): boolean {
	if (kind === 'private') {
		return db.query<{ visible: number }, [number, number, number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `chat_messages` AS message ' +
			'JOIN `chat_participants` AS participant ON participant.`conversation_id` = message.`conversation_id` ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`conversation_id` = ? AND participant.`client_id` = ? ' +
			`AND ${chat_shadow_visibility()} ` +
			'AND message.`id` > participant.`hidden_through_message_id` ' +
			(include_moderated ? 'AND (1 OR ' : 'AND (') + 'NOT EXISTS (SELECT 1 FROM `chat_message_deletions` AS deletion ' +
			'WHERE deletion.`message_id` = message.`id` AND deletion.`client_id` = ?))) AS `visible`'
		).get(message_id, conversation_id, client_id, client_id, client_id, client_id)?.visible === 1;
	}
	if (kind === 'alliance') {
		return db.query<{ visible: number }, [number, number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `alliance_chat_messages` AS message ' +
			'JOIN alliance_memberships am ON am.alliance_id = message.alliance_id ' +
			'JOIN guild_memberships membership ON membership.guild_id = am.guild_id ' +
			'JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`alliance_id` = ? AND client.`id` = ? AND client.`alliance_chat_enabled` = 1 ' +
			`AND ${chat_shadow_visibility()} ` +
			'AND NOT EXISTS (SELECT 1 FROM `alliance_chat_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`)) AS `visible`'
		).get(message_id, conversation_id, client_id, client_id, client_id)?.visible === 1;
	}
	if (kind === 'guild') {
		return db.query<{ visible: number }, [number, number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `guild_chat_messages` AS message ' +
			'JOIN `guild_memberships` AS membership ON membership.`guild_id` = message.`guild_id` ' +
			'JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`guild_id` = ? AND client.`id` = ? AND client.`guild_chat_enabled` = 1 ' +
			`AND ${chat_shadow_visibility()} ` +
			'AND NOT EXISTS (SELECT 1 FROM `guild_chat_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`)) AS `visible`'
		).get(message_id, conversation_id, client_id, client_id, client_id)?.visible === 1;
	}
	if (kind === 'global' || kind === 'testers') {
		return conversation_id === 1 && db.query<{ visible: number }, [number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `global_chat_messages` AS message JOIN `clients` AS client ON client.`id` = ? ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`channel` = ' + (kind === 'global' ? "'global'" : "'testers'") +
			' AND client.`deleted_at` IS NULL ' + (kind === 'global' ? 'AND client.`global_chat_enabled` = 1 ' : '') +
			`AND ${chat_shadow_visibility()} ` +
			'AND NOT EXISTS (SELECT 1 FROM `global_chat_message_moderation` AS moderation ' +
			'WHERE moderation.`message_id` = message.`id`)) AS `visible`'
		).get(client_id, message_id, client_id, client_id)?.visible === 1;
	}
	if (kind === 'poll-discussion') {
		return db.query<{ visible: number }, [number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `poll_discussion_messages` AS message ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`poll_id` = ? AND ' +
			`${include_moderated ? '1' : 'NOT EXISTS(SELECT 1 FROM poll_discussion_message_moderation WHERE message_id = message.id)'} AND ${chat_shadow_visibility()}) AS \`visible\``
		).get(message_id, conversation_id, client_id, client_id)?.visible === 1;
	}
	if (!can_access_support_conversation(client_id, conversation_id))
		return false;
	return db.query<{ visible: number }, [number, number]>(
		'SELECT EXISTS(SELECT 1 FROM `support_messages` AS message ' +
		'WHERE message.`id` = ? AND message.`conversation_id` = ? ' +
		(include_moderated ? 'AND (1 OR ' : 'AND (') + 'NOT EXISTS (SELECT 1 FROM `support_message_moderation` AS moderation ' +
		'WHERE moderation.`message_id` = message.`id`))) AS `visible`'
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
	const conversation_clause = kind === 'global' || kind === 'testers'
		? ` WHERE channel = '${kind}'` : ` WHERE \`${conversation_columns[kind]}\` = ?`;
	const conversation_values = kind === 'global' || kind === 'testers' ? [] : [conversation_id];
	if ((kind === 'global' || kind === 'testers') && conversation_id !== 1)
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
	message_id: number, reaction: string, reacted: boolean, now = Date.now(), mod_version?: unknown) {
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1 ||
		!Number.isSafeInteger(message_id) || message_id < 1 || typeof reaction !== 'string' || typeof reacted !== 'boolean')
		return { status: 'bad_request' as const };
	if (kind === 'testers' && !has_expedition_access(client_id, mod_version))
		return { status: 'missing' as const };
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

// Admin reads share the reaction visibility boundary: no cross-conversation discovery.
export function admin_message_details(viewer_id: number, kind: ChatMessageKind, conversation_id: number, message_id: number) {
	if (!is_admin(viewer_id)) return null;
	if (!message_is_visible(viewer_id, kind, conversation_id, message_id)) return null;
	const reactions = db.query<{ reaction: string; client_id: number; display_name: string; icon_id: string }, [number]>(
		`SELECT reaction.reaction, client.id AS client_id, client.display_name, client.icon_id
		FROM ${reaction_tables[kind]} reaction JOIN clients client ON client.id = reaction.client_id
		WHERE reaction.message_id = ? ORDER BY reaction.created_at, client.id`
	).all(message_id);
	let reads: string;
	let values: number[];
	if (kind === 'private') {
		reads = 'SELECT client_id FROM chat_message_reads WHERE message_id = ?';
		values = [message_id];
	} else if (kind === 'support') {
		reads = `SELECT client_id FROM support_player_message_reads WHERE message_id = ?
			UNION SELECT membership.client_id FROM support_member_message_reads read
			JOIN support_team_memberships membership ON membership.id = read.membership_id WHERE read.message_id = ?`;
		values = [message_id, message_id];
	} else {
		const table = kind === 'poll-discussion' ? 'poll_discussion_read_state' :
			kind === 'testers' ? 'tester_chat_read_state' : kind + '_chat_read_state';
		const scope = kind === 'global' || kind === 'testers' ? '' : ` AND ${conversation_columns[kind]} = ?`;
		reads = `SELECT client_id FROM ${table} WHERE last_read_message_id >= ?${scope}`;
		values = scope ? [message_id, conversation_id] : [message_id];
	}
	const seen = db.query<{ client_id: number; display_name: string; icon_id: string }, number[]>(
		`SELECT id AS client_id, display_name, icon_id FROM clients WHERE id IN (${reads}) ORDER BY display_name COLLATE NOCASE, id`
	).all(...values);
	return { reactions, seen };
}

export function moderate_additional_chat_message(viewer_id: number, kind: 'private' | 'support' | 'poll-discussion',
	conversation_id: number, message_id: number, now = Date.now()): boolean {
	if (!is_admin(viewer_id) || !message_is_visible(viewer_id, kind, conversation_id, message_id, true)) return false;
	return db.transaction(() => {
		if (kind === 'private') {
			// Retain the immutable Message and its idempotency key; hide it for both participants.
			db.query(`INSERT INTO chat_message_deletions(message_id, client_id, deleted_at)
				SELECT ?, client_id, ? FROM chat_participants WHERE conversation_id = ? ON CONFLICT DO NOTHING`)
				.run(message_id, now, conversation_id);
		} else {
			const table = kind === 'support' ? 'support_message_moderation' : 'poll_discussion_message_moderation';
			db.query(`INSERT INTO ${table}(message_id, deleted_at) VALUES(?, ?) ON CONFLICT DO NOTHING`).run(message_id, now);
		}
		return true;
	}).immediate();
}

export function message_moderation_count(kind: ChatMessageKind, viewer_id: number, conversation_id: number): number | undefined {
	if (kind === 'private') return db.query<{ count: number }, [number, number]>(
		`SELECT COUNT(*) AS count FROM chat_message_deletions deletion JOIN chat_messages message ON message.id = deletion.message_id
		WHERE message.conversation_id = ? AND deletion.client_id = ?`).get(conversation_id, viewer_id)?.count ?? 0;
	if (kind !== 'support' && kind !== 'poll-discussion') return undefined;
	const table = kind === 'support' ? 'support' : 'poll_discussion';
	const column = kind === 'support' ? 'conversation_id' : 'poll_id';
	return db.query<{ count: number }, [number]>(
		`SELECT COUNT(*) AS count FROM ${table}_message_moderation moderation JOIN ${table}_messages message
		ON message.id = moderation.message_id WHERE message.${column} = ?`).get(conversation_id)?.count ?? 0;
}
