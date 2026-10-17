import { DEV_BADGES, get_dev_badge_labels } from './account_tags';
import { petition_discussion_id } from './petition-discussions';
import { petition_discussion_visibility } from './petition-discussion-visibility';
import { db } from './db';
import { shadowed_cutoff } from './shadowed';
import { chat_shadow_visibility } from './chat_shadowban';
import { protected_text_ranges, chinese_term_ranges } from './translation_terms';

export type ChatPart = { type: 'text'; text: string } | { type: 'item'; item_id: string } |
	{ type: 'feature'; feature_id: string } |
	{ type: 'person'; client_id: number; display_name: string; icon_id: string };
export const OFFICIAL_CHAT_ITEM = /^(melvorD|melvorF|melvorTotH|melvorAoD|melvorItA):[A-Za-z0-9_]+$/;
export const OFFICIAL_CHAT_FEATURE = /^(melvorD|melvorF|melvorTotH|melvorAoD|melvorItA):[A-Za-z0-9_]+$/;
export const MULTIPLAYER_CHAT_FEATURES = new Map([
	['multiplayer:Chat', 'Chat'], ['multiplayer:Guild', 'Guild'],
	['multiplayer:Transfer_Items', 'Transfers'], ['multiplayer:Multiplayer_Market', 'Marketplace'],
	['multiplayer:Crucible', 'Crucible'], ['multiplayer:Expedition', 'Expedition'],
	['multiplayer:Guild_Raid', 'Raid'], ['multiplayer:Updates', 'Updates'],
	['multiplayer:Alliance', 'alliance'], ['multiplayer:Alliance_Member_Guild', 'alliance member guild'],
	['multiplayer:Guild_Member', 'guild member'], ['multiplayer:Petition', 'petition'],
	['multiplayer:Policy', 'policy'], ['multiplayer:Buy_Order', 'buy order'], ['multiplayer:Sell_Listing', 'sell listing'],
	['multiplayer:Trade', 'trade'], ['multiplayer:Gift', 'gift'], ['multiplayer:Wish', 'wish'],
	['multiplayer:Haggle', 'haggle'], ['multiplayer:Chamber', 'chamber']
]);
export const CHAT_BADGE_FEATURES = new Map([
	...Object.values(DEV_BADGES).map(badge => [badge.feature_id, badge.label] as [string, string]),
	['multiplayer:Badge_New_Member', 'New Member'],
	['multiplayer:Badge_Time_Cheats', 'Time Cheats'],
	['multiplayer:Badge_Item_Cheats', 'Item Cheats'],
	['multiplayer:Badge_Resource_Cheats', 'Resource Cheats'],
	['multiplayer:Badge_Multitasking', 'Multitasking'],
	['multiplayer:Badge_Shop_Cheats', 'Shop Cheats'],
	['multiplayer:Badge_Loot_Cheats', 'Loot Cheats'],
	['multiplayer:Badge_Social_Only', 'Social Only'],
	['multiplayer:Badge_Aye', 'Aye'],
	['multiplayer:Badge_Nay', 'Nay'],
]);
for (const [id, name] of CHAT_BADGE_FEATURES) MULTIPLAYER_CHAT_FEATURES.set(id, name);
export const MAX_CHAT_ITEMS = 20;

export function feature_name(id: string): string {
	if (Object.values(DEV_BADGES).some(badge => badge.feature_id === id)) return get_dev_badge_labels()[id]!;
	if (id === 'melvorD:AltMagic') return 'Alt. Magic';
	return MULTIPLAYER_CHAT_FEATURES.get(id) ?? id.split(':')[1]!.replaceAll('_', ' ');
}

export function parts_text(parts: ChatPart[]): string {
	return parts.map(part => part.type === 'text' ? part.text : part.type === 'item' ?
		`[${part.item_id.split(':')[1]!.replaceAll('_', ' ')}]` : part.type === 'person' ? `@${part.display_name}` : (CHAT_BADGE_FEATURES.has(part.feature_id) ? `[${feature_name(part.feature_id)}]` : `$${feature_name(part.feature_id)}`)).join('');
}

// Normalize at the request boundary. Plain clients retain their existing string contract.
export function normalize_chat_parts(value: unknown, sender_id?: number): ChatPart[] | null {
	if (!Array.isArray(value) || value.length > 100 || value.length === 0) return null;
	const parts: ChatPart[] = [];
	let tags = 0;
	for (const part of value) {
		if (!part || typeof part !== 'object') return null;
		if (part.type === 'text' && typeof part.text === 'string' && part.text.length <= 1000) {
			const text = part.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
			if (text.includes('\0')) return null;
			const last = parts.at(-1);
			if (last?.type === 'text') last.text += text;
			else if (text) parts.push({ type: 'text', text });
		} else if (part.type === 'item' && typeof part.item_id === 'string' &&
			part.item_id.length <= 256 && OFFICIAL_CHAT_ITEM.test(part.item_id)) {
			if (++tags > MAX_CHAT_ITEMS) return null;
			parts.push({ type: 'item', item_id: part.item_id });
		} else if (part.type === 'feature' && typeof part.feature_id === 'string' &&
			part.feature_id.length <= 256 && (OFFICIAL_CHAT_FEATURE.test(part.feature_id) ||
				MULTIPLAYER_CHAT_FEATURES.has(part.feature_id))) {
			if (++tags > MAX_CHAT_ITEMS) return null;
			parts.push({ type: 'feature', feature_id: part.feature_id });
		} else if (part.type === 'person' && Number.isSafeInteger(part.client_id) && part.client_id > 0 && part.client_id !== sender_id) {
			if (++tags > MAX_CHAT_ITEMS) return null;
			const person = db.query<{ display_name: string; icon_id: string }, [number]>(
				'SELECT display_name, icon_id FROM clients WHERE id = ? AND deleted_at IS NULL'
			).get(part.client_id);
			if (!person) return null;
			parts.push({ type: 'person', client_id: part.client_id, ...person });
		} else return null;
	}
	const first = parts[0], last = parts.at(-1);
	if (first?.type === 'text') first.text = first.text.trimStart();
	if (last?.type === 'text') last.text = last.text.trimEnd();
	const result = parts.filter(part => part.type !== 'text' || part.text.length > 0);
	const length = parts_text(result).length;
	return length > 0 && length <= 1000 ? result : null;
}

export function save_chat_parts(kind: string, message_id: number, parts?: ChatPart[]): void {
	if (!parts?.some(part => part.type !== 'text')) return;
	db.query('INSERT INTO chat_message_bodies (job_id, parts) SELECT id, ? FROM chat_translation_jobs ' +
		'WHERE source_kind = ? AND message_id = ?').run(JSON.stringify(parts), kind, message_id);
}

export function same_chat_parts(kind: string, message_id: number, parts?: ChatPart[]): boolean {
	const existing = db.query<{ parts: string }, [string, number]>('SELECT body.parts FROM chat_message_bodies body ' +
		'JOIN chat_translation_jobs job ON job.id = body.job_id WHERE job.source_kind = ? AND job.message_id = ?')
		.get(kind, message_id);
	return (existing?.parts ?? null) === (parts?.some(part => part.type !== 'text') ? JSON.stringify(parts) : null);
}

export function attach_chat_parts<T extends { message_id: number }>(kind: string, messages: T[]):
	Array<T & { parts?: ChatPart[] }> {
	if (messages.length === 0) return [];
	const rows = db.query<{ message_id: number; parts: string }, Array<string | number>>(
		'SELECT job.message_id, body.parts FROM chat_message_bodies body JOIN chat_translation_jobs job ON job.id = body.job_id ' +
		`WHERE job.source_kind = ? AND job.message_id IN (${messages.map(() => '?').join(',')})`
	).all(kind, ...messages.map(message => message.message_id));
	const by_id = new Map(rows.map(row => [row.message_id, JSON.parse(row.parts) as ChatPart[]]));
	return messages.map(message => by_id.has(message.message_id) ? { ...message, parts: by_id.get(message.message_id)! } : message);
}

const escape_html = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function translation_document(parts: ChatPart[], glossary = true):
	{ html: string; markers: ChatPart[]; chinese_markers: ChatPart[] } {
	const markers: ChatPart[] = [], chinese_markers: ChatPart[] = [];
	const marker = (part: ChatPart, chinese = part) => {
		chinese_markers.push(chinese);
		return `<span translate="no">${markers.push(part) - 1}</span>`;
	};
	const html = parts.map(part => {
		if (part.type !== 'text') return marker(part);
		let cursor = 0, result = '';
		const protected_ranges = protected_text_ranges(part.text);
		const ranges: Array<{ start: number; end: number; chinese?: string }> = [...protected_ranges,
			...(glossary ? chinese_term_ranges(part.text, protected_ranges) : [])].sort((a, b) => a.start - b.start);
		for (const range of ranges) {
			result += escape_html(part.text.slice(cursor, range.start));
			const original: ChatPart = { type: 'text', text: part.text.slice(range.start, range.end) };
			result += marker(original, range.chinese ? { type: 'text', text: range.chinese } : original);
			cursor = range.end;
		}
		return result + escape_html(part.text.slice(cursor));
	}).join('');
	return { html, markers, chinese_markers };
}

export function translation_html(parts: ChatPart[]): string {
	return translation_document(parts).html;
}

function decode_html(text: string): string {
	const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
	return text.replace(/&([^;\s]+);/g, (whole, entity: string) => {
		if (entity in entities) return entities[entity]!;
		if (/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) {
			const number = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
			if (number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff)) return String.fromCodePoint(number);
		}
		throw { code: 'invalid_translation_markup' };
	});
}

// Accept only the tiny HTML grammar we generated. Never pass returned markup to a browser HTML sink.
export function translated_parts(html: string, source: ChatPart[], markers = translation_document(source).markers): ChatPart[] {
	if (html.length > 20000) throw { code: 'invalid_translation_markup' };
	const tags = markers;
	const seen = new Set<number>();
	const parts: ChatPart[] = [];
	let cursor = 0;
	const marker = /<span\s+translate\s*=\s*(?:"no"|'no')\s*>([0-9]+)<\/span\s*>/gi;
	const add_text = (text: string) => {
		if (/[<>]/.test(text)) throw { code: 'invalid_translation_markup' };
		if (text) parts.push({ type: 'text', text: decode_html(text) });
	};
	for (const match of html.matchAll(marker)) {
		add_text(html.slice(cursor, match.index));
		const index = Number(match[1]);
		if (String(index) !== match[1] || !tags[index] || seen.has(index)) throw { code: 'invalid_translation_markers' };
		seen.add(index);
		parts.push(tags[index]!);
		cursor = match.index! + match[0].length;
	}
	add_text(html.slice(cursor));
	if (seen.size !== tags.length || parts_text(parts).length > 5000) throw { code: 'invalid_translation_markers' };
	return parts;
}

// Called only after the ordinary conversation read has authorized the viewer.
export function chat_people(viewer_id: number, kind?: string, conversation_id?: number | null) {
	if (kind === 'petition-discussion' && conversation_id != null) conversation_id = petition_discussion_id(conversation_id) ?? conversation_id;
	let recent: Array<{ client_id: number; latest: number }> = [];
	if (kind && conversation_id != null) {
		const domains: Record<string, [string, string, string]> = {
			private: ['chat_messages', 'conversation_id', 'chat_message_moderation'],
			guild: ['guild_chat_messages', 'guild_id', 'guild_chat_message_moderation'],
			alliance: ['alliance_chat_messages', 'alliance_id', 'alliance_chat_message_moderation'],
			global: ['global_chat_messages', 'channel', 'global_chat_message_moderation'],
			testers: ['global_chat_messages', 'channel', 'global_chat_message_moderation'],
			'poll-discussion': ['poll_discussion_messages', 'poll_id', 'poll_discussion_message_moderation'],
			'petition-discussion': ['petition_discussion_messages', 'petition_id', 'petition_discussion_message_moderation'],
			support: ['support_messages', 'conversation_id', 'support_message_moderation']
		};
		const domain = domains[kind];
		if (domain) {
			const [table, scope, moderation] = domain;
			const sender = kind === 'support' ? 'sending_client_id' : 'sender_id';
			const values: Array<string | number> = [scope === 'channel' ? kind : conversation_id];
			let visibility = '';
			if (kind === 'private') {
				visibility += ' AND message.id > COALESCE((SELECT hidden_through_message_id FROM chat_participants WHERE conversation_id = ? AND client_id = ?), 0)' +
					' AND NOT EXISTS(SELECT 1 FROM chat_message_deletions WHERE message_id = message.id AND client_id = ?)';
				values.push(conversation_id, viewer_id, viewer_id);
			} else visibility += ` AND NOT EXISTS(SELECT 1 FROM ${moderation} WHERE message_id = message.id)`;
			if (kind === 'petition-discussion') visibility += ' AND ' + petition_discussion_visibility(viewer_id);
			if (kind !== 'support') {
				visibility += ' AND ' + chat_shadow_visibility();
				values.push(viewer_id, viewer_id);
			}
			recent = db.query<{ client_id: number; latest: number }, Array<string | number>>(
				`SELECT sender.id AS client_id, MAX(message.id) AS latest FROM ${table} message JOIN clients sender ON sender.id = message.${sender} ` +
				`WHERE message.${scope} = ?` + visibility + ' GROUP BY sender.id ORDER BY latest DESC'
			).all(...values);
		}
	}
	const rank = new Map(recent.map((person, index) => [person.client_id, index]));
	const people = db.query<{ client_id: number; display_name: string; icon_id: string; guild_member: number; last_active: number }, [number, number]>(`
		SELECT client.id AS client_id, client.display_name, client.icon_id,
			client.last_multiplayer_active_at AS last_active,
			EXISTS(SELECT 1 FROM guild_memberships member JOIN guild_memberships viewer
				ON viewer.guild_id = member.guild_id WHERE member.client_id = client.id AND viewer.client_id = ?1) AS guild_member
		FROM clients client WHERE client.deleted_at IS NULL AND client.id <> ?1
			AND client.last_multiplayer_active_at >= ?2 AND client.last_multiplayer_active_at > 0
	`).all(viewer_id, shadowed_cutoff());
	return people.sort((a, b) => {
		const category = (person: typeof a) => rank.has(person.client_id) ? 0 : person.guild_member ? 1 : 2;
		return category(a) - category(b) ||
			(category(a) === 0 ? rank.get(a.client_id)! - rank.get(b.client_id)! :
				category(a) === 1 ? b.last_active - a.last_active : 0) ||
			a.display_name.localeCompare(b.display_name) || a.client_id - b.client_id;
	}).map(({ client_id, display_name, icon_id }) => ({ client_id, display_name, icon_id }));
}

// Only call for summaries already authorized by the ordinary inbox access checks.
export function has_unread_person_tag(viewer_id: number, conversation: {
	conversation_kind: string; conversation_id: number; unread_count: number; viewer_side?: string
}): boolean {
	if (conversation.unread_count <= 0 || conversation.conversation_id < 1) return false;
	const kind = conversation.conversation_kind;
	const domains: Record<string, [string, string]> = {
		private: ['chat', 'conversation_id'], guild: ['guild_chat', 'guild_id'],
		alliance: ['alliance_chat', 'alliance_id'], global: ['global_chat', 'channel'],
		testers: ['global_chat', 'channel'], support: ['support', 'conversation_id']
	};
	const domain = domains[kind];
	if (!domain) return false;
	const [prefix, scope] = domain;
	const values: Array<string | number> = [kind === 'testers' ? 'global' : kind, viewer_id,
		scope === 'channel' ? kind : conversation.conversation_id];
	let unread: string;
	if (kind === 'support') {
		unread = conversation.viewer_side === 'team'
			? "message.author_kind = 'player' AND NOT EXISTS(SELECT 1 FROM support_member_message_reads r JOIN support_team_memberships membership ON membership.id = r.membership_id WHERE r.message_id = message.id AND membership.client_id = ? AND membership.active = 1 AND membership.team_id = (SELECT team_id FROM support_conversations WHERE id = message.conversation_id))"
			: "message.author_kind != 'player' AND NOT EXISTS(SELECT 1 FROM support_player_message_reads r WHERE r.message_id = message.id AND r.client_id = ?)";
		values.push(viewer_id);
	} else {
		unread = 'message.sender_id != ? AND ' + chat_shadow_visibility();
		values.push(viewer_id, viewer_id, viewer_id);
		if (kind === 'private') {
			unread += ' AND message.id > (SELECT hidden_through_message_id FROM chat_participants WHERE conversation_id = message.conversation_id AND client_id = ?)' +
				' AND NOT EXISTS(SELECT 1 FROM chat_message_reads WHERE message_id = message.id AND client_id = ?)' +
				' AND NOT EXISTS(SELECT 1 FROM chat_message_deletions WHERE message_id = message.id AND client_id = ?)';
			values.push(viewer_id, viewer_id, viewer_id);
		} else {
			const read_prefix = kind === 'testers' ? 'tester_chat' : prefix;
			unread += ` AND message.id > COALESCE((SELECT last_read_message_id FROM ${read_prefix}_read_state WHERE client_id = ?` +
				(scope === 'channel' ? '' : ` AND ${scope} = message.${scope}`) + '), 0)';
			values.push(viewer_id);
		}
	}
	if (kind !== 'private') unread += ` AND NOT EXISTS(SELECT 1 FROM ${prefix}_message_moderation WHERE message_id = message.id)`;
	return db.query<{ tagged: number }, Array<string | number>>(`
		SELECT EXISTS(SELECT 1 FROM chat_translation_jobs job
		JOIN chat_message_bodies body ON body.job_id = job.id
		JOIN ${prefix}_messages message ON message.id = job.message_id
		JOIN clients sender ON sender.id = message.${kind === 'support' ? 'sending_client_id' : 'sender_id'}
		WHERE job.source_kind = ? AND EXISTS(SELECT 1 FROM json_each(body.parts) part
			WHERE json_extract(part.value, '$.type') = 'person' AND json_extract(part.value, '$.client_id') = ?)
		AND message.${scope} = ? AND ${unread}) AS tagged
	`).get(...values)?.tagged === 1;
}
