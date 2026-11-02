import { attach_chat_parts, save_chat_parts, same_chat_parts, type ChatPart } from './chat_parts';
import { db } from './db';
import { get_dev_tag_visibility } from './account_tags';
import { is_admin } from './admin_identity';
import { is_client_version_at_least } from './client-version-policy';
import { get_request_mod_version } from './http';
import { next_revision } from './polls';
import { chat_shadow_visibility } from './chat_shadowban';

// Announcement headers reuse Poll content/translation storage, without options or ballots.
// The discriminant is checked on every Poll and discussion entry point.
export function supports_announcements(req: Request): boolean {
	return is_client_version_at_least(get_request_mod_version(req), '1.7.0');
}

export function can_delete_announcement(client_id: number, id: number): boolean {
	if (is_admin(client_id)) return true;
	return get_dev_tag_visibility(client_id).eligible && db.query(`SELECT 1 FROM polls p
		JOIN clients author ON author.id=p.creator_id JOIN clients viewer ON viewer.id=?
		WHERE p.id=? AND p.announcement=1 AND author.melvor_account_id=viewer.melvor_account_id`)
		.get(client_id, id) !== null;
}

function discussion_counts(client_id: number): Record<number, number> {
	const rows = db.query<{ poll_id: number; count: number }, number[]>(`SELECT message.poll_id,COUNT(*) AS count
		FROM poll_discussion_messages message JOIN polls parent ON parent.id=message.poll_id
		JOIN clients sender ON sender.id=message.sender_id
		LEFT JOIN poll_discussion_read_state r ON r.poll_id=message.poll_id AND r.client_id=?
		WHERE parent.announcement=1 AND parent.deleted_at IS NULL AND message.id>COALESCE(r.last_read_message_id,0)
		AND message.sender_id!=? AND NOT EXISTS(SELECT 1 FROM poll_discussion_message_moderation WHERE message_id=message.id)
		AND ${chat_shadow_visibility()} GROUP BY message.poll_id`).all(client_id, client_id, client_id, client_id);
	return Object.fromEntries(rows.map(row => [row.poll_id, row.count]));
}

function view(row: { id: number; creator_id: number; content: string; created_at: number;
	display_name: string; icon_id: string; reaction_revision: number; deleted_at: number | null }, client_id: number,
	counts = discussion_counts(client_id)) {
	return { ...attach_chat_parts('poll', [{ message_id: row.id }])[0], message_id: row.id, conversation_id: 1, sender_id: row.creator_id,
		sender: { client_id: row.creator_id, display_name: row.display_name, icon_id: row.icon_id },
		content: row.content, created_at: row.created_at, reaction_revision: row.reaction_revision, deleted: row.deleted_at !== null,
		can_delete: row.deleted_at === null && can_delete_announcement(client_id, row.id),
		discussion_unread_count: row.deleted_at === null ? counts[row.id] ?? 0 : 0 };
}

type AnnouncementRow = Parameters<typeof view>[0];

export function announcement_unread_count(client_id: number): number {
	return db.query<{ count: number }, [number, number]>(`SELECT COUNT(*) AS count FROM polls p
		WHERE p.announcement=1 AND p.deleted_at IS NULL AND p.creator_id!=?
		AND p.id>COALESCE((SELECT last_read_message_id FROM announcement_read_state WHERE client_id=?),0)`)
		.get(client_id, client_id)!.count;
}

export function announcement_inbox(client_id: number) {
	const latest = db.query<AnnouncementRow, []>(`SELECT p.*,author.display_name,author.icon_id FROM polls p
		JOIN clients author ON author.id=p.creator_id WHERE p.announcement=1 AND p.deleted_at IS NULL ORDER BY p.id DESC LIMIT 1`).get();
	return { conversation_kind: 'announcements' as const, conversation_id: 1,
		participant: { client_id: null, display_name: 'Announcements', icon_id: 'multiplayer' },
		created_at: 0, latest_message: latest ? view(latest, client_id, {}) : null, unread_count: announcement_unread_count(client_id),
		contributes_unread: true, can_send: get_dev_tag_visibility(client_id).eligible, blocked: false,
		moderation_count: db.query<{ count: number }, []>(
			'SELECT COUNT(*) AS count FROM polls WHERE announcement=1 AND deleted_at IS NOT NULL').get()!.count };
}

export function list_announcements(client_id: number, conversation_id: number, before: number | null, after: number | null) {
	if (conversation_id !== 1 || (before !== null && (!Number.isSafeInteger(before) || before < 1)) ||
		(after !== null && (!Number.isSafeInteger(after) || after < 0)) || (before !== null && after !== null))
		return { status: 'bad_request' as const };
	const cursor = before ?? after;
	const rows = db.query<AnnouncementRow, number[]>(`SELECT p.*,author.display_name,author.icon_id FROM polls p
		JOIN clients author ON author.id=p.creator_id WHERE p.announcement=1 AND (p.deleted_at IS NULL OR ${is_admin(client_id) ? 1 : 0})
		${cursor === null ? '' : `AND p.id ${before === null ? '>' : '<'} ?`}
		ORDER BY p.id ${after === null ? 'DESC' : 'ASC'} LIMIT 21`).all(...(cursor === null ? [] : [cursor]));
	const page = rows.slice(0, 20);
	if (before === null && page.length) {
		db.query(`INSERT INTO announcement_read_state(client_id,last_read_message_id) VALUES(?,?)
			ON CONFLICT(client_id) DO UPDATE SET last_read_message_id=MAX(last_read_message_id,excluded.last_read_message_id)`)
			.run(client_id, Math.max(...page.map(row => row.id)));
	}
	const counts = discussion_counts(client_id);
	return { status: 'ok' as const, value: {
		messages: (after === null ? page.reverse() : page).map(row => view(row, client_id, counts)), has_more: rows.length > 20,
		discussion_unread_counts: counts
	} };
}

export function create_announcement(client_id: number, key: string, content: string, now = Date.now(), parts?: ChatPart[], highlight_color: string | null = null) {
	if (!get_dev_tag_visibility(client_id).eligible) return { status: 'forbidden' as const };
	const trimmed = content.trim();
	if (!key.length || key.length > 128 || !trimmed.length || trimmed.length > 1000)
		return { status: 'bad_request' as const };
	return db.transaction(() => {
		const duplicate = db.query<{ id: number; content: string; announcement: number }, [number, string]>(
			'SELECT id,content,announcement FROM polls WHERE creator_id=? AND idempotency_key=?').get(client_id, key);
		if (duplicate && (duplicate.announcement !== 1 || duplicate.content !== trimmed || !same_chat_parts('poll', duplicate.id, parts, highlight_color))) return { status: 'bad_request' as const };
		const id = duplicate?.id ?? Number(db.query(`INSERT INTO polls(creator_id,idempotency_key,content,created_at,revision,announcement)
			VALUES(?,?,?,?,?,1)`).run(client_id, key, trimmed, now, next_revision()).lastInsertRowid);
		if (!duplicate) save_chat_parts('poll', id, parts, highlight_color);
		const row = db.query<AnnouncementRow, [number]>(`SELECT p.*,author.display_name,author.icon_id FROM polls p
			JOIN clients author ON author.id=p.creator_id WHERE p.id=?`).get(id)!;
		return { status: 'ok' as const, value: { message: view(row, client_id) } };
	}).immediate();
}
