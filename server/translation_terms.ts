import { CHEAT_MOD_NAMES } from './mod_names';

// Descriptive titles require a quoted title or explicit local mod context.
const contextual_names = new Set(['add items', 'god mode', 'multitasking', 'speedup']);
const titles = [...CHEAT_MOD_NAMES, 'Multitasking', 'Speedup'].sort((a, b) => b.length - a.length);
const escape_regex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const title_pattern = titles.map(escape_regex).join('|');
const terms = new RegExp(
	`https?:\\/\\/[^\\s<>"']{1,2048}|` +
	'`[A-Za-z_$][A-Za-z0-9_$]*(?:[.:][A-Za-z_$][A-Za-z0-9_$]*)*`|' +
	'\\bv[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}(?:-[A-Za-z0-9.-]{1,32})?|' +
	title_pattern + '|' +
	'(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]+)?[kmb]?\\s*(?:GP|SC|AP|EP|XP|HP)|' +
	'GP|SC|AP|EP|XP|HP', 'gi');
const word = /[A-Za-z0-9_]/;
const game_context = /\b(?:melvor|in[- ]game|game|gold|coins|bank|slayer|prayer|combat|hitpoints|experience|level|currency)\b/i;
const other_units = /\b(?:doctor|medical|physician|appointments?|patients?|grand prix|associated press|horsepower|printer)\b/i;

const list_header = /^[ \t]*(?:(?:my|our|the|these|installed|enabled|active|cheat)\s+){0,3}(?:mods|mod (?:list|titles?|manager))\s*[:=][ \t]*/i;
const list_title = new RegExp(`(?:${title_pattern})`, 'iy');

function mod_list_ranges(text: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	let active = false, lines = 0, characters = 0, offset = 0;
	let body_start_offset = 0;
	let current_range: { start: number; end: number } | undefined;
	for (const line of text.split('\n')) {
		const header = line.match(list_header);
		if (header) {
			active = true; lines = 0; characters = 0;
			body_start_offset = offset + header[0].length;
			current_range = undefined;
		}
		if (active) {
			const body_start = header?.[0].length ?? 0;
			const body = line.slice(body_start).replace(/\r$/, '');
			characters += line.length + 1;
			// Never carry list context across blanks, prose, unknown entries, or these bounds.
			if (++lines > 16 || characters > 1024 || (!header && !body.trim())) active = false;
			else if (body.trim()) {
				let cursor = body.match(/^[ \t]*(?:(?:[-*•]|\d{1,2}[.)])[ \t]+)?/)![0].length;
				let entries = 0;
				while (cursor < body.length) {
					list_title.lastIndex = cursor;
					const title = list_title.exec(body);
					if (!title) { active = false; break; }
					entries++;
					cursor += title[0].length;
					if (/^[ \t]*[.!?]?[ \t]*$/.test(body.slice(cursor))) break;
					const separator = body.slice(cursor).match(/^(?:[ \t]*,[ \t]*(?:and[ \t]+)?|[ \t]+and[ \t]+)/i);
					if (!separator) { active = false; break; }
					cursor += separator[0].length;
					if (cursor === body.length) active = false;
				}
				if (!entries) active = false;
				if (active) {
					// One occurrence owns the entire recognized body, including its leading newline,
					// indentation, separators and CRLF. Keep the header and following prose outside it.
					if (!current_range) {
						current_range = { start: body_start_offset, end: offset + line.length };
						ranges.push(current_range);
					} else current_range.end = offset + line.length;
				}
			}
		}
		offset += line.length + 1;
	}
	return ranges;
}

function local_context(text: string, start: number, end: number): string {
	// Limit inference to the current clause and a small window, never another line or sentence.
	const before = text.slice(Math.max(0, start - 100), start).split(/[.!?;\n]/).at(-1)!;
	const after = text.slice(end, end + 100).split(/[.!?;\n]/)[0]!;
	return before + text.slice(start, end) + after;
}

export function protected_text_ranges(text: string): Array<{ start: number; end: number }> {
	const ranges = mod_list_ranges(text);
	for (const match of text.matchAll(terms)) {
		const start = match.index!;
		// Sentence punctuation after a URL belongs to the surrounding prose.
		const value = /^https?:/i.test(match[0]) ? match[0].replace(/[.,;!?]+$/, '') : match[0];
		const end = start + value.length;
		if (ranges.some(range => start < range.end && end > range.start)) continue;
		if (word.test(text[start - 1] ?? '') || word.test(text[end] ?? '')) continue;
		const context = local_context(text, start, end);
		const lower = value.toLowerCase();
		if (contextual_names.has(lower)) {
			const quoted = /["'“‘]/.test(text[start - 1] ?? '') && /["'”’]/.test(text[end] ?? '');
			const mod_context =
				(/\bmod[ \t]+$/i.test(text.slice(Math.max(0, start - 20), start)) &&
					/^(?:[ \t]*[,.;!?]|[ \t]*$)/.test(text.slice(end).split('\n')[0]!)) ||
				/^[ \t]+mods?\b/i.test(text.slice(end, end + 20));
			if (!quoted && !mod_context) continue;
		} else if (/^(?:[0-9]|GP$|SC$|AP$|EP$|XP$|HP$)/i.test(value)) {
			if (other_units.test(context)) continue;
			if (/^[0-9]/.test(value) && /[.,]/.test(text[start - 1] ?? '')) continue;
			if (!/^[0-9]/.test(value) && !game_context.test(context)) continue;
		}
		ranges.push({ start, end });
	}
	return ranges.sort((a, b) => a.start - b.start);
}

// Curated noun phrases only. Page/tab/feature qualifiers stay provider-owned.
// Owning labels: mod/data/lang/zh-CN.json; other label provenance is recorded in the plan.
const chinese_terms: Array<[string, string]> = [
	['Bank Slot Tokens', '仓库栏位代币'], ['Bank Slot Token', '仓库栏位代币'],
	['Free Fellowship', '自由同盟'],
	['Social Only mode', '社交模式'], ['Petition of Interdict', '禁令请愿'],
	['Interdict petition', '禁令请愿'], ['Guild Raid', '公会突袭'],
	['Multiplayer Expedition', '远征'], ['cheat mods', '作弊模组'], ['cheat mod', '作弊模组'],
	['mod manager', '模组管理器'], ['chat reactions', '表情回应'], ['chat reaction', '表情回应']
];
const chinese_labels = new Map(chinese_terms.map(([term, label]) => [term.toLowerCase(), label]));
const page_labels = new Map([
	['crucible', '熔炉'], ['expedition', '远征'], ['expeditions', '远征'],
	['raid', '突袭'], ['marketplace', '市场'], ['transfers', '转移'], ['transfer items', '转移']
]);
const chinese_pattern = new RegExp([...chinese_terms.map(([term]) => term), ...page_labels.keys(), 'members', 'member']
	.sort((a, b) => b.length - a.length).map(escape_regex).join('|'), 'gi');

function group_member_context(text: string, start: number, end: number): boolean {
	// Attached membership phrases only; a Guild mentioned elsewhere cannot qualify VIP/subscription members.
	const before = text.slice(Math.max(0, start - 40), start);
	const after = text.slice(end, end + 100);
	if (/\b(?:VIP|subscription|premium|paid)[ \t]+$/i.test(before)) return false;
	return /\b(?:guild|group|Free Fellowship)[ \t]+$/i.test(before) ||
		/^[ \t]+(?:of|in)[ \t]+(?:(?:the|our|this|their|a)[ \t]+)?(?:guild|group|Free Fellowship)\b/i.test(after) ||
		/^[ \t]+who[ \t]+joined[ \t]+(?:(?:the|our|this|their|a)[ \t]+)?(?:guild|group|Free Fellowship)\b/i.test(after);
}

export function chinese_term_ranges(text: string, protected_ranges = protected_text_ranges(text)):
	Array<{ start: number; end: number; chinese: string }> {
	const ranges: Array<{ start: number; end: number; chinese: string }> = [];
	for (const match of text.matchAll(chinese_pattern)) {
		const start = match.index!, end = start + match[0].length;
		if (word.test(text[start - 1] ?? '') || word.test(text[end] ?? '')) continue;
		if (protected_ranges.some(range => start < range.end && end > range.start)) continue;
		const lower = match[0].toLowerCase();
		if (lower === 'member' || lower === 'members') {
			if (text[start - 1] === '-' || text[end] === '-') continue;
			if (group_member_context(text, start, end)) ranges.push({ start, end, chinese: '成员' });
			continue;
		}
		const label = chinese_labels.get(lower);
		// Bare ambiguous nouns need a directly attached UI qualifier, not a nearby topic.
		if (!label && !/^[ \t]+(?:page|tab|feature)\b/i.test(text.slice(end))) continue;
		ranges.push({ start, end, chinese: label ?? page_labels.get(lower)! });
	}
	return ranges;
}
