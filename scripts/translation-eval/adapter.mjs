import { translation_document, translated_parts, parts_text } from './source.mjs';

const amount = /^(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?[kmb]?\s*(?:GP|SC|AP|EP|XP|HP)$/i;
const opaque = index => `<span translate="no">${index}</span>`;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function validate_text(text) {
	if (/[<>]/.test(text)) throw Error('Unexpected markup');
	// Reject malformed, unknown and incomplete entities (also inside discarded amount text).
	const rest = text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#(?:[0-9]+|x[0-9a-fA-F]+));/g, entity => {
		if (entity.startsWith('&#')) {
			const value = entity[2] === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
			if (!value || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw Error('Invalid entity');
		}
		return '';
	});
	if (rest.includes('&')) throw Error('Malformed entity');
}

export function build(parts, arm = 'N', structured = parts.some(part => part.type !== 'text')) {
	if (!['N', 'H'].includes(arm)) throw Error('Unknown arm');
	const document = translation_document(parts);
	// Selection is a subset of actual recognized occurrences, never a broader source recognizer.
	const amounts = new Set(document.markers.flatMap((part, index) => part.type === 'text' && amount.test(part.text) &&
		document.chinese_markers[index].text === part.text ? [index] : []));
	const html = arm === 'N' ? document.html : document.html.replace(/<span translate="no">([0-9]+)<\/span>/g,
		(marker, index) => amounts.has(Number(index)) ?
			`<span id="amount-${index}">${escape(document.markers[Number(index)].text)}</span>` : marker);
	return { ...document, html, amounts, arm, parts, use_html: structured || document.markers.length > 0,
		plain: parts.map(part => part.text ?? '').join('') };
}

export function restore(document, text, target, detected) {
	const markers = target === 'zh-Hans' && detected === 'en' ? document.chinese_markers : document.markers;
	if (!document.use_html) return [{ type: 'text', text }];
	if (document.arm === 'N') return translated_parts(text, document.parts, markers);
	if (text.length > 20000) throw Error('Oversized output');
	const seen = new Set();
	let cursor = 0, converted = '';
	// Keep the current transport's fragment/root shape. Only amount spans gain contextual text.
	const span = /<span translate="no">([0-9]+)<\/span>|<span id="amount-([0-9]+)">([^<>]*)<\/span>/g;
	for (const match of text.matchAll(span)) {
		const prefix = text.slice(cursor, match.index);
		validate_text(prefix);
		converted += prefix;
		const id = match[1] ?? match[2], index = Number(id);
		if (String(index) !== id || !markers[index] || seen.has(index) ||
			document.amounts.has(index) !== (match[2] !== undefined)) throw Error('Invalid occurrence');
		if (match[2] !== undefined) validate_text(match[3]);
		seen.add(index);
		converted += opaque(index);
		cursor = match.index + match[0].length;
	}
	validate_text(text.slice(cursor));
	converted += text.slice(cursor);
	if (seen.size !== markers.length) throw Error('Missing occurrence');
	return translated_parts(converted, document.parts, markers);
}

export function structural_record(document, restored, target, detected) {
	const table = target === 'zh-Hans' && detected === 'en' ? document.chinese_markers : document.markers;
	const links = parts => parts.filter(part => part.type !== 'text').map(part => JSON.stringify(part)).sort();
	// The strict parser inserts the exact table objects. Count references, not text substring matches.
	return { accepted: true, exact_occurrences: table.every(part => restored.filter(value => value === part).length === 1),
		typed_links: JSON.stringify(links(restored)) === JSON.stringify(links(document.parts)),
		source_roundtrip: parts_text(restored) === parts_text(document.parts) };
}
