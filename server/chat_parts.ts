import { db } from './db';

export type ChatPart = { type: 'text'; text: string } | { type: 'item'; item_id: string };
export const OFFICIAL_CHAT_ITEM = /^(melvorD|melvorF|melvorTotH|melvorAoD|melvorItA):[A-Za-z0-9_]+$/;
export const MAX_CHAT_ITEMS = 20;

export function parts_text(parts: ChatPart[]): string {
	return parts.map(part => part.type === 'text' ? part.text :
		`[${part.item_id.split(':')[1]!.replaceAll('_', ' ')}]`).join('');
}

// Normalize at the request boundary. Plain clients retain their existing string contract.
export function normalize_chat_parts(value: unknown): ChatPart[] | null {
	if (!Array.isArray(value) || value.length > 100 || value.length === 0) return null;
	const parts: ChatPart[] = [];
	let items = 0;
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
			if (++items > MAX_CHAT_ITEMS) return null;
			parts.push({ type: 'item', item_id: part.item_id });
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
	if (!parts?.some(part => part.type === 'item')) return;
	db.query('INSERT INTO chat_message_bodies (job_id, parts) SELECT id, ? FROM chat_translation_jobs ' +
		'WHERE source_kind = ? AND message_id = ?').run(JSON.stringify(parts), kind, message_id);
}

export function same_chat_parts(kind: string, message_id: number, parts?: ChatPart[]): boolean {
	const existing = db.query<{ parts: string }, [string, number]>('SELECT body.parts FROM chat_message_bodies body ' +
		'JOIN chat_translation_jobs job ON job.id = body.job_id WHERE job.source_kind = ? AND job.message_id = ?')
		.get(kind, message_id);
	return (existing?.parts ?? null) === (parts?.some(part => part.type === 'item') ? JSON.stringify(parts) : null);
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

export function translation_html(parts: ChatPart[]): string {
	let index = 0;
	return parts.map(part => part.type === 'text' ? escape_html(part.text) :
		`<span translate="no">${index++}</span>`).join('');
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
export function translated_parts(html: string, source: ChatPart[]): ChatPart[] {
	if (html.length > 20000) throw { code: 'invalid_translation_markup' };
	const items = source.filter(part => part.type === 'item');
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
		if (String(index) !== match[1] || !items[index] || seen.has(index)) throw { code: 'invalid_translation_markers' };
		seen.add(index);
		parts.push(items[index]!);
		cursor = match.index! + match[0].length;
	}
	add_text(html.slice(cursor));
	if (seen.size !== items.length || parts_text(parts).length > 5000) throw { code: 'invalid_translation_markers' };
	return parts;
}
