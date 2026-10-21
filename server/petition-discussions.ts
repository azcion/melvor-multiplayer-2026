import { petition_discussion_visibility } from './petition-discussion-visibility';
import { has_alliance_access } from './alliances';
import { db } from './db';
import { chat_shadow_visibility, is_chat_shadowbanned } from './chat_shadowban';
import { save_chat_parts, same_chat_parts, type ChatPart } from './chat_parts';

// Petition IDs remain aliases for older clients; new clients use the independent discussion ID.
export function petition_discussion_id(petition_id: number): number | null {
	if (!Number.isSafeInteger(petition_id) || petition_id < 1) return null;
	return db.query<{ id: number }, [number]>(`SELECT discussion_id id FROM petition_discussion_links WHERE petition_id=?1
	UNION ALL SELECT id FROM petition_discussions WHERE id=?1 LIMIT 1`).get(petition_id)?.id ?? null;
}

export function can_access_petition_discussion(client_id: number, petition_id: number): boolean {
	const id = petition_discussion_id(petition_id);
	if (id === null) return false;
	const discussion = db.query<{ alliance: number }, [number, number]>(`SELECT
	(d.process_id IS NOT NULL OR EXISTS(SELECT 1 FROM petition_discussion_links l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.discussion_id=d.id AND p.type LIKE 'alliance_%')) alliance
	FROM petition_discussions d JOIN petition_discussion_guilds g ON g.discussion_id=d.id
	JOIN guild_memberships m ON m.guild_id=g.guild_id JOIN clients c ON c.id=m.client_id
	WHERE d.id=? AND m.client_id=? AND c.deleted_at IS NULL`).get(id, client_id);
	return discussion !== null && (!discussion.alliance || has_alliance_access(client_id));
}

function petition_votes_visible(client_id: number, petition_id: number): boolean {
	return db.query(`SELECT 1 FROM petition_discussions d WHERE d.id=? AND (d.closed_at IS NOT NULL
	OR EXISTS(SELECT 1 FROM petition_discussion_voters v WHERE v.discussion_id=d.id AND v.client_id=?))`)
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
	if (!can_access_petition_discussion(client_id, petition_id)) return 0;
	petition_id = petition_discussion_id(petition_id)!;
	return db.query<{ count: number }, number[]>(`SELECT COUNT(*) AS count FROM petition_discussion_messages message
		JOIN petition_discussions discussion ON discussion.id=message.petition_id AND discussion.closed_at IS NULL
		JOIN clients sender ON sender.id=message.sender_id
		LEFT JOIN petition_discussion_read_state r ON r.petition_id=message.petition_id AND r.client_id=?
		WHERE message.petition_id=? AND message.id>COALESCE(r.last_read_message_id,0) AND message.sender_id!=?
		AND (message.event_type IS NULL OR message.event_type='proposal')
		AND ${petition_discussion_visibility(client_id)} AND ${chat_shadow_visibility()}
		AND NOT EXISTS(SELECT 1 FROM petition_discussion_message_moderation WHERE message_id=message.id)`)
		.get(client_id, petition_id, client_id, client_id, client_id)!.count;
}

export function list_petition_discussion_messages(client_id: number, petition_id: number,
	before: number | null, after: number | null) {
	if (!can_access_petition_discussion(client_id, petition_id)) return { status: 'missing' as const };
	const requested_id = petition_id;
	petition_id = petition_discussion_id(petition_id)!;
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
	let read_changed = false;
	if (before === null && rows.length > 0)
		read_changed = db.query(`INSERT INTO petition_discussion_read_state(petition_id,client_id,last_read_message_id) VALUES(?,?,?)
			ON CONFLICT(petition_id,client_id) DO UPDATE SET last_read_message_id=
			MAX(petition_discussion_read_state.last_read_message_id,excluded.last_read_message_id)
			WHERE petition_discussion_read_state.last_read_message_id<excluded.last_read_message_id`)
			.run(petition_id, client_id, Math.max(...delivered.map(row => row.id))).changes > 0;
	if (read_changed) db.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client_id);
	return { status: 'ok' as const, value: { messages: (after === null ? delivered.reverse() : delivered).map(row => ({ ...message_view(row), conversation_id: requested_id })),
		petition_votes_visible: petition_votes_visible(client_id, petition_id),
		...petition_discussion_summary(client_id, petition_id), has_more: rows.length > 20 } };
}

export function send_petition_discussion_message(client_id: number, petition_id: number, key: string,
	content: string, now = Date.now(), parts?: ChatPart[], highlight_color: string | null = null) {
	if (!can_access_petition_discussion(client_id, petition_id)) return { status: 'missing' as const };
	const requested_id = petition_id;
	petition_id = petition_discussion_id(petition_id)!;
	const trimmed = content.trim();
	// Reserve system keys: ordinary sends cannot impersonate a proposal or ballot.
	if (key.length < 1 || key.length > 128 || /^(proposal|vote|alliance-reason):/.test(key) || trimmed.length < 1 || trimmed.length > 1000)
		return { status: 'bad_request' as const };
	const message_id = db.transaction(() => {
		const existing = db.query<{ id: number; petition_id: number; content: string }, [number, string]>(
			'SELECT id,petition_id,content FROM petition_discussion_messages WHERE sender_id=? AND idempotency_key=?').get(client_id, key);
		if (existing) return existing.petition_id === petition_id && existing.content === trimmed &&
			same_chat_parts('petition-discussion', existing.id, parts, highlight_color) ? existing.id : null;
		const id = Number(db.query(`INSERT INTO petition_discussion_messages
			(petition_id,sender_id,idempotency_key,content,created_at,shadow_hidden) VALUES(?,?,?,?,?,?)`)
			.run(petition_id, client_id, key, trimmed, now, is_chat_shadowbanned(client_id) ? 1 : 0).lastInsertRowid);
		save_chat_parts('petition-discussion', id, parts, highlight_color);
		return id;
	}).immediate();
	if (message_id === null) return { status: 'bad_request' as const };
	const message = db.query<Message, [number]>(`SELECT message.*,sender.display_name,sender.icon_id
		FROM petition_discussion_messages message JOIN clients sender ON sender.id=message.sender_id WHERE message.id=?`).get(message_id)!;
	return { status: 'ok' as const, value: { message: { ...message_view(message), conversation_id: requested_id } } };
}

export function petition_discussion_summary(client_id: number, petition_id: number) {
	const id = petition_discussion_id(petition_id);
	const unread_count = id === null ? 0 : petition_discussion_unread_count(client_id, id);
	const has_unread_tag = unread_count > 0 && db.query(`SELECT 1 FROM petition_discussion_messages message
	JOIN clients sender ON sender.id=message.sender_id JOIN chat_translation_jobs job ON job.source_kind='petition-discussion' AND job.message_id=message.id
	JOIN chat_message_bodies body ON body.job_id=job.id JOIN json_each(body.parts) part
	LEFT JOIN petition_discussion_read_state r ON r.petition_id=message.petition_id AND r.client_id=?1
	WHERE message.petition_id=?2 AND message.id>COALESCE(r.last_read_message_id,0) AND message.sender_id!=?1
	AND message.event_type IS NULL AND json_extract(part.value,'$.type')='person' AND json_extract(part.value,'$.client_id')=?1
	AND ${petition_discussion_visibility(client_id)} AND ${chat_shadow_visibility()}
	AND NOT EXISTS(SELECT 1 FROM petition_discussion_message_moderation WHERE message_id=message.id) LIMIT 1`).get(client_id,id,client_id,client_id) !== null;
	return { discussion_id: id, discussion_unread_count: unread_count, discussion_has_unread_tag: has_unread_tag };
}

export function petition_discussion_notifications(client_id: number) {
	const rows = db.query<{ id: number; alliance: number; council: number }, [number]>(`SELECT DISTINCT d.id,
	EXISTS(SELECT 1 FROM petition_discussion_links l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.discussion_id=d.id AND p.guild_id=m.guild_id) council,
	(d.process_id IS NOT NULL OR EXISTS(SELECT 1 FROM petition_discussion_links l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.discussion_id=d.id AND p.type LIKE 'alliance_%')) alliance
	FROM petition_discussions d JOIN petition_discussion_guilds g ON g.discussion_id=d.id
	JOIN guild_memberships m ON m.guild_id=g.guild_id WHERE m.client_id=?`).all(client_id);
	return rows.filter(row => !row.alliance || has_alliance_access(client_id)).map(row => ({ ...petition_discussion_summary(client_id,row.id), alliance: !!row.alliance, council: !!row.council }));
}
