import { can_access_petition_discussion, petition_discussion_id } from './petition-discussions';
import { petition_discussion_visibility } from './petition-discussion-visibility';
import { is_admin } from './admin_identity';
import { discussion_access } from './polls';
import { can_delete_announcement } from './announcements';
import { announcement_audience_sql } from './announcement-audience';
import { db } from './db';
import { chat_shadow_visibility } from './chat_shadowban';
import { can_access_support_conversation } from './support_chat';
import type { JsonObject } from './http';

export type ChatMessageKind = 'private' | 'alliance' | 'guild' | 'global' | 'testers' | 'support' | 'poll-discussion' | 'petition-discussion' | 'announcements' | 'announcement-discussion';

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
	'poll-discussion': 'poll_discussion_message_reactions',
	'announcement-discussion': 'poll_discussion_message_reactions',
	announcements: 'announcement_reactions',
	'petition-discussion': 'petition_discussion_message_reactions'
};

const message_tables: Record<ChatMessageKind, string> = {
	private: 'chat_messages',
	alliance: 'alliance_chat_messages',
	guild: 'guild_chat_messages',
	global: 'global_chat_messages',
	testers: 'global_chat_messages',
	support: 'support_messages',
	'poll-discussion': 'poll_discussion_messages',
	'announcement-discussion': 'poll_discussion_messages',
	announcements: 'polls',
	'petition-discussion': 'petition_discussion_messages'
};

const conversation_columns: Record<Exclude<ChatMessageKind, 'global' | 'testers' | 'announcements'>, string> = {
	private: 'conversation_id',
	alliance: 'alliance_id',
	guild: 'guild_id',
	support: 'conversation_id',
	'poll-discussion': 'poll_id',
	'announcement-discussion': 'poll_id',
	'petition-discussion': 'petition_id'
};

export function message_is_visible(client_id: number, kind: ChatMessageKind, conversation_id: number, message_id: number, include_moderated = false): boolean {
	if (kind === 'petition-discussion') conversation_id = petition_discussion_id(conversation_id) ?? conversation_id;
	if (kind === 'testers') return false;
	if (kind === 'announcements') return conversation_id === 1 && db.query(`SELECT 1 FROM polls WHERE id=? AND announcement=1 AND (deleted_at IS NULL OR ?=1) AND ${announcement_audience_sql(client_id, 'polls')}`).get(message_id, Number(include_moderated || is_admin(client_id))) !== null;
	if (kind === 'private') {
		return db.query<{ visible: number }, [number, number, number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `chat_messages` AS message ' +
			'JOIN `chat_participants` AS participant ON participant.`conversation_id` = message.`conversation_id` ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`conversation_id` = ? AND participant.`client_id` = ? ' +
			`AND ${chat_shadow_visibility()} ` +
			'AND message.`id` > participant.`hidden_through_message_id` ' +
			`AND (${include_moderated || is_admin(client_id) ? 1 : 0} OR NOT EXISTS(SELECT 1 FROM chat_message_moderation WHERE message_id=message.id)) ` +
			'AND (' + 'NOT EXISTS (SELECT 1 FROM `chat_message_deletions` AS deletion ' +
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
			`AND (${include_moderated || is_admin(client_id) ? 1 : 0} OR NOT EXISTS (SELECT 1 FROM ` +
			'`alliance_chat_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`))) AS `visible`'
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
			`AND (${include_moderated || is_admin(client_id) ? 1 : 0} OR NOT EXISTS (SELECT 1 FROM ` +
			'`guild_chat_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`))) AS `visible`'
		).get(message_id, conversation_id, client_id, client_id, client_id)?.visible === 1;
	}
	if (kind === 'global') {
		return conversation_id === 1 && db.query<{ visible: number }, [number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `global_chat_messages` AS message JOIN `clients` AS client ON client.`id` = ? ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`channel` = ' + (kind === 'global' ? "'global'" : "'testers'") +
			' AND client.`deleted_at` IS NULL ' + (kind === 'global' ? 'AND client.`global_chat_enabled` = 1 ' : '') +
			`AND ${chat_shadow_visibility()} ` +
			`AND (${include_moderated || is_admin(client_id) ? 1 : 0} OR NOT EXISTS (SELECT 1 FROM ` +
			'`global_chat_message_moderation` AS moderation WHERE moderation.`message_id` = message.`id`))) AS `visible`'
		).get(client_id, message_id, client_id, client_id)?.visible === 1;
	}
	if (kind === 'petition-discussion') {
		if (!can_access_petition_discussion(client_id, conversation_id)) return false;
		return db.query(`SELECT 1 FROM petition_discussion_messages message JOIN clients sender ON sender.id=message.sender_id
			WHERE message.id=? AND message.petition_id=? AND ${petition_discussion_visibility(client_id)} AND ${chat_shadow_visibility()}
			AND ${include_moderated || is_admin(client_id) ? '1' : 'NOT EXISTS(SELECT 1 FROM petition_discussion_message_moderation WHERE message_id=message.id)'}`)
			.get(message_id, conversation_id, client_id, client_id) !== null;
	}
	if (kind === 'poll-discussion' || kind === 'announcement-discussion') {
		if (!discussion_access(client_id, conversation_id, kind === 'announcement-discussion')) return false;
		return db.query<{ visible: number }, [number, number, number, number]>(
			'SELECT EXISTS(SELECT 1 FROM `poll_discussion_messages` AS message ' +
			'JOIN `clients` AS sender ON sender.`id` = message.`sender_id` ' +
			'WHERE message.`id` = ? AND message.`poll_id` = ? AND ' +
			`${include_moderated || is_admin(client_id) ? '1' : 'NOT EXISTS(SELECT 1 FROM poll_discussion_message_moderation WHERE message_id = message.id)'} AND ${chat_shadow_visibility()}) AS \`visible\``
		).get(message_id, conversation_id, client_id, client_id)?.visible === 1;
	}
	if (!can_access_support_conversation(client_id, conversation_id))
		return false;
	return db.query<{ visible: number }, [number, number]>(
		'SELECT EXISTS(SELECT 1 FROM `support_messages` AS message ' +
		'WHERE message.`id` = ? AND message.`conversation_id` = ? ' +
		(include_moderated || is_admin(client_id) ? 'AND (1 OR ' : 'AND (') + 'NOT EXISTS (SELECT 1 FROM `support_message_moderation` AS moderation ' +
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
	if (kind === 'petition-discussion') conversation_id = petition_discussion_id(conversation_id) ?? conversation_id;
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1 ||
		(after_revision !== null && (!Number.isSafeInteger(after_revision) || after_revision < 0)))
		return { status: 'bad_request' as const };
	const conversation_clause = kind === 'global' || kind === 'testers' || kind === 'announcements'
		? kind === 'announcements' ? ' WHERE announcement=1' : ` WHERE channel = '${kind}'` : ` WHERE \`${conversation_columns[kind]}\` = ?`;
	const conversation_values = kind === 'global' || kind === 'testers' || kind === 'announcements' ? [] : [conversation_id];
	if ((kind === 'global' || kind === 'testers' || kind === 'announcements') && conversation_id !== 1)
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

export function set_message_reaction(client_id: number, kind: ChatMessageKind, conversation_id: number, message_id: number, reaction: string, reacted: boolean, now = Date.now()) {
	if (kind === 'petition-discussion') conversation_id = petition_discussion_id(conversation_id) ?? conversation_id;
	if (!Number.isSafeInteger(conversation_id) || conversation_id < 1 ||
		!Number.isSafeInteger(message_id) || message_id < 1 || typeof reaction !== 'string' || typeof reacted !== 'boolean')
		return { status: 'bad_request' as const };

	if (message_deleted(kind, message_id) || !message_is_visible(client_id, kind, conversation_id, message_id))
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

// Detail reads share the reaction visibility boundary: no cross-conversation discovery.
export function message_details(viewer_id: number, kind: ChatMessageKind, conversation_id: number, message_id: number): JsonObject | null {
	if (kind === 'petition-discussion') conversation_id = petition_discussion_id(conversation_id) ?? conversation_id;
	if (!message_is_visible(viewer_id, kind, conversation_id, message_id)) return null;
	const reactions = db.query<{ reaction: string; client_id: number; display_name: string; icon_id: string }, [number]>(
		`SELECT reaction.reaction, client.id AS client_id, client.display_name, client.icon_id
		FROM ${reaction_tables[kind]} reaction JOIN clients client ON client.id = reaction.client_id
		WHERE reaction.message_id = ? ORDER BY reaction.created_at, client.id`
	).all(message_id);
	let reads: string;
	let values: (number | string)[];
	if (kind === 'private') {
		reads = 'SELECT client_id FROM chat_message_reads WHERE message_id = ?';
		values = [message_id];
	} else if (kind === 'support') {
		reads = `SELECT client_id FROM support_player_message_reads WHERE message_id = ?
			UNION SELECT membership.client_id FROM support_member_message_reads read
			JOIN support_team_memberships membership ON membership.id = read.membership_id WHERE read.message_id = ?`;
		values = [message_id, message_id];
	} else if (kind === 'announcements') {
		reads = `SELECT client_id FROM announcement_read_state WHERE ?='' AND last_read_message_id >= ?
			UNION SELECT client_id FROM announcement_audience_read_state WHERE audience=? AND last_read_message_id >= ?`;
		const audience = db.query<{ audience: string }, [number]>('SELECT audience FROM polls WHERE id=?').get(message_id)!.audience;
		values = [audience, message_id, audience, message_id];
	} else {
		const table = kind === 'petition-discussion' ? 'petition_discussion_read_state' : kind === 'poll-discussion' || kind === 'announcement-discussion' ? 'poll_discussion_read_state' :
			kind === 'announcements' ? 'announcement_read_state' : kind === 'testers' ? 'tester_chat_read_state' : kind + '_chat_read_state';
		const scope = kind === 'global' || kind === 'testers' || kind === 'announcements' ? '' : ` AND ${conversation_columns[kind]} = ?`;
		reads = `SELECT client_id FROM ${table} WHERE last_read_message_id >= ?${scope}`;
		values = scope ? [message_id, conversation_id] : [message_id];
	}
	const seen = db.query<{ client_id: number; display_name: string; icon_id: string }, (number | string)[]>(
		`SELECT id AS client_id, display_name, icon_id FROM clients WHERE id IN (${reads}) ORDER BY display_name COLLATE NOCASE, id`
	).all(...values);
	return { reactions, seen };
}

// Every mutation preserves the original Message, reaction, translation and retry records.
const moderation_tables: Partial<Record<ChatMessageKind, string>> = {
	private: 'chat_message_moderation', global: 'global_chat_message_moderation',
	guild: 'guild_chat_message_moderation', alliance: 'alliance_chat_message_moderation',
	support: 'support_message_moderation', 'poll-discussion': 'poll_discussion_message_moderation',
	'announcement-discussion': 'poll_discussion_message_moderation',
	'petition-discussion': 'petition_discussion_message_moderation'
};

export function message_deleted(kind: ChatMessageKind, id: number): boolean {
	if (kind === 'announcements') return db.query('SELECT 1 FROM polls WHERE id=? AND deleted_at IS NOT NULL').get(id) !== null;
	const table = moderation_tables[kind];
	return table !== undefined && db.query(`SELECT 1 FROM ${table} WHERE message_id=?`).get(id) !== null;
}

export function attach_deletion_state<T extends { message_id: number; sender_id?: number | null; petition_event?: string }>(
	kind: ChatMessageKind, viewer_id: number, messages: T[]) {
	return messages.map(message => {
		const deleted = message_deleted(kind, message.message_id);
		const author = kind === 'support' ? db.query<{ sending_client_id: number | null }, [number]>(
			'SELECT sending_client_id FROM support_messages WHERE id=?').get(message.message_id)?.sending_client_id : message.sender_id;
		return { ...message, deleted, can_delete: message.message_id > 0 && !deleted &&
			(kind === 'announcements' ? can_delete_announcement(viewer_id, message.message_id) :
				is_admin(viewer_id) || (author === viewer_id && !message.petition_event)) };
	});
}

export function delete_visible_message(viewer_id: number, kind: ChatMessageKind,
	conversation_id: number, message_id: number, now = Date.now()): boolean {
	if (kind === 'petition-discussion') conversation_id = petition_discussion_id(conversation_id) ?? conversation_id;
	if (!message_is_visible(viewer_id, kind, conversation_id, message_id, true)) return false;
	const admin = is_admin(viewer_id);
	if (kind === 'announcements') {
		if (!can_delete_announcement(viewer_id, message_id)) return false;
		db.query('UPDATE polls SET deleted_at=COALESCE(deleted_at,?) WHERE id=? AND announcement=1').run(now, message_id);
		return true;
	}
	const table = moderation_tables[kind];
	if (!table) return false;
	const column = kind === 'support' ? 'sending_client_id' : 'sender_id';
	const author = db.query<{ author: number | null }, [number]>(`SELECT ${column} AS author FROM ${message_tables[kind]} WHERE id=?`).get(message_id)?.author;
	if (!admin && author !== viewer_id) return false;
	// Automated Petition events are domain records; authors may remove ordinary replies only.
	if (!admin && kind === 'petition-discussion' && db.query('SELECT 1 FROM petition_discussion_messages WHERE id=? AND event_type IS NOT NULL').get(message_id)) return false;
	db.query(`INSERT INTO ${table}(message_id,deleted_at) VALUES(?,?) ON CONFLICT DO NOTHING`).run(message_id,now);
	return true;
}

export const moderate_additional_chat_message = delete_visible_message;

export function message_moderation_count(kind: ChatMessageKind, viewer_id: number, conversation_id: number): number | undefined {
	if (kind === 'petition-discussion') conversation_id = petition_discussion_id(conversation_id) ?? conversation_id;
	if (kind === 'announcements') return db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM polls WHERE announcement=1 AND deleted_at IS NOT NULL').get()!.count;
	const table = moderation_tables[kind];
	if (!table) return undefined;
	const channel = kind === 'global';
	const clause = channel ? "message.channel='global'" : `message.${conversation_columns[kind as Exclude<ChatMessageKind, 'global' | 'testers' | 'announcements'>]}=?`;
	return db.query<{ count: number }, number[]>(`SELECT COUNT(*) AS count FROM ${table} moderation
		JOIN ${message_tables[kind]} message ON message.id=moderation.message_id WHERE ${clause}`)
		.get(...(channel ? [] : [conversation_id]))!.count;
}

export { get_chat_reaction_choices } from './chat-reaction-picker';
