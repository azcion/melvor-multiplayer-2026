import { petition_discussion_visibility } from './petition-discussion-visibility';
import { has_alliance_access } from './alliances';
import { db } from './db';
import { chat_shadow_visibility, is_chat_shadowbanned } from './chat_shadowban';
import { save_chat_parts, same_chat_parts, type ChatPart } from './chat_parts';
import { is_client_version_at_least } from './client-version-policy';

export const can_view_petition_discussions = (version: unknown) => version === 'development' || is_client_version_at_least(version, '1.6.10');

export function can_access_petition_discussion(client_id: number, petition_id: number): boolean {
	if (!Number.isSafeInteger(petition_id) || petition_id < 1) return false;
	const petition = db.query<{ type: string }, [number, number]>(`SELECT p.type FROM guild_petitions p
		JOIN guild_memberships m ON m.guild_id=p.guild_id JOIN clients c ON c.id=m.client_id
		WHERE p.id=? AND m.client_id=? AND c.deleted_at IS NULL`).get(petition_id, client_id);
	return petition !== null && (!petition.type.startsWith('alliance_') || has_alliance_access(client_id, '1.6.10'));
}

function petition_votes_visible(client_id: number, petition_id: number): boolean {
	return db.query(`SELECT 1 FROM guild_petitions p WHERE p.id=? AND (p.lifecycle!='active'
		OR EXISTS(SELECT 1 FROM guild_petition_votes v WHERE v.petition_id=p.id AND v.client_id=?))`)
		.get(petition_id, client_id) !== null;
}

type Message = { id: number; petition_id: number; sender_id: number; content: string;
	event_type: 'proposal' | 'aye' | 'nay' | null; created_at: number; reaction_revision: number;
	display_name: string; icon_id: string };
const message_view = (row: Message) => ({ message_id: row.id, conversation_id: row.petition_id,
	sender_id: row.sender_id, content: row.content, created_at: row.created_at,
	reaction_revision: row.reaction_revision,
	...(row.event_type ? { petition_event: row.event_type } : {}),
	sender: { client_id: row.sender_id, display_name: row.display_name, icon_id: row.icon_id } });

export function petition_discussion_unread_count(client_id: number, petition_id: number): number {
	return db.query<{ count: number }, number[]>(`SELECT COUNT(*) AS count FROM petition_discussion_messages message
		JOIN clients sender ON sender.id=message.sender_id
		LEFT JOIN petition_discussion_read_state r ON r.petition_id=message.petition_id AND r.client_id=?
		WHERE message.petition_id=? AND message.id>COALESCE(r.last_read_message_id,0) AND message.sender_id!=?
		AND ${petition_discussion_visibility(client_id)} AND ${chat_shadow_visibility()}
		AND NOT EXISTS(SELECT 1 FROM petition_discussion_message_moderation WHERE message_id=message.id)`)
		.get(client_id, petition_id, client_id, client_id, client_id)!.count;
}

export function list_petition_discussion_messages(client_id: number, petition_id: number,
	before: number | null, after: number | null) {
	if (!can_access_petition_discussion(client_id, petition_id)) return { status: 'missing' as const };
	if ((before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) || (before !== null && after !== null))
		return { status: 'bad_request' as const };
	const cursor = before ?? after;
	const rows = db.query<Message, number[]>(`SELECT message.*,sender.display_name,sender.icon_id
		FROM petition_discussion_messages message JOIN clients sender ON sender.id=message.sender_id
		WHERE message.petition_id=? AND ${petition_discussion_visibility(client_id)} AND ${chat_shadow_visibility()}
		AND NOT EXISTS(SELECT 1 FROM petition_discussion_message_moderation WHERE message_id=message.id)
		${cursor === null ? '' : `AND message.id ${before !== null ? '<' : '>'} ?`}
		ORDER BY message.id ${after === null ? 'DESC' : 'ASC'} LIMIT 21`).all(petition_id, client_id, client_id, ...(cursor === null ? [] : [cursor]));
	const delivered = rows.slice(0, 20);
	// Older-history reads cannot clear newer unseen Messages.
	if (before === null && rows.length > 0)
		db.query(`INSERT INTO petition_discussion_read_state(petition_id,client_id,last_read_message_id) VALUES(?,?,?)
			ON CONFLICT(petition_id,client_id) DO UPDATE SET last_read_message_id=
			MAX(petition_discussion_read_state.last_read_message_id,excluded.last_read_message_id)`)
			.run(petition_id, client_id, Math.max(...delivered.map(row => row.id)));
	return { status: 'ok' as const, value: { messages: (after === null ? delivered.reverse() : delivered).map(message_view),
		petition_votes_visible: petition_votes_visible(client_id, petition_id),
		discussion_unread_count: petition_discussion_unread_count(client_id, petition_id), has_more: rows.length > 20 } };
}

export function send_petition_discussion_message(client_id: number, petition_id: number, key: string,
	content: string, now = Date.now(), parts?: ChatPart[]) {
	if (!can_access_petition_discussion(client_id, petition_id)) return { status: 'missing' as const };
	const trimmed = content.trim();
	// Reserve system keys: ordinary sends cannot impersonate a proposal or ballot.
	if (key.length < 1 || key.length > 128 || /^(proposal|vote):/.test(key) || trimmed.length < 1 || trimmed.length > 1000)
		return { status: 'bad_request' as const };
	const message_id = db.transaction(() => {
		const existing = db.query<{ id: number; petition_id: number; content: string }, [number, string]>(
			'SELECT id,petition_id,content FROM petition_discussion_messages WHERE sender_id=? AND idempotency_key=?').get(client_id, key);
		if (existing) return existing.petition_id === petition_id && existing.content === trimmed &&
			same_chat_parts('petition-discussion', existing.id, parts) ? existing.id : null;
		const id = Number(db.query(`INSERT INTO petition_discussion_messages
			(petition_id,sender_id,idempotency_key,content,created_at,shadow_hidden) VALUES(?,?,?,?,?,?)`)
			.run(petition_id, client_id, key, trimmed, now, is_chat_shadowbanned(client_id) ? 1 : 0).lastInsertRowid);
		save_chat_parts('petition-discussion', id, parts);
		return id;
	}).immediate();
	if (message_id === null) return { status: 'bad_request' as const };
	const message = db.query<Message, [number]>(`SELECT message.*,sender.display_name,sender.icon_id
		FROM petition_discussion_messages message JOIN clients sender ON sender.id=message.sender_id WHERE message.id=?`).get(message_id)!;
	return { status: 'ok' as const, value: { message: message_view(message) } };
}
