export const CHAT_ITEM_LIMIT = 20;
export const CHAT_LENGTH_LIMIT = 1000;
export const official_chat_item = id => typeof id === 'string' &&
	/^(melvorD|melvorF|melvorTotH|melvorAoD|melvorItA):[A-Za-z0-9_]+$/.test(id);
export const MULTIPLAYER_FEATURE_NAMES = Object.freeze({
	Chat: 'Chat', Guild: 'Guild', Transfer_Items: 'Transfers', Multiplayer_Market: 'Marketplace',
	Crucible: 'Crucible', Expedition: 'Expedition', Guild_Raid: 'Raid', Updates: 'Updates'
});
const MULTIPLAYER_FEATURE_LANG_IDS = Object.freeze({
	Chat: 'MOD_MP_PAGE_CHAT', Guild: 'MOD_MP_PAGE_GUILD', Transfer_Items: 'MOD_MP_PAGE_TRANSFER_ITEMS',
	Multiplayer_Market: 'MOD_MP_PAGE_MARKET', Crucible: 'MOD_MP_PAGE_CRUCIBLE',
	Expedition: 'MOD_MP_PAGE_EXPEDITION', Guild_Raid: 'MOD_MP_PAGE_RAID', Updates: 'MOD_MP_PAGE_UPDATES'
});
const FEATURE_SIDEBAR_ORDER = [
	'melvorD:Shop', 'melvorD:Bank',
	...Object.keys(MULTIPLAYER_FEATURE_NAMES).map(id => `multiplayer:${id}`),
	'melvorD:Combat',
	...['Attack', 'Strength', 'Defence', 'Hitpoints', 'Ranged', 'Magic', 'Prayer', 'Slayer']
		.map(id => `melvorD:${id}`),
	'melvorItA:Corruption',
	'melvorD:Farming', 'melvorD:Township',
	...['Woodcutting', 'Fishing', 'Firemaking', 'Cooking', 'Mining', 'Smithing', 'Thieving',
		'Fletching', 'Crafting', 'Runecrafting', 'Herblore', 'Agility', 'Summoning', 'Astrology', 'AltMagic']
		.map(id => `melvorD:${id}`),
	'melvorAoD:Cartography', 'melvorAoD:Archaeology', 'melvorItA:Harvesting'
];
const FEATURE_SIDEBAR_RANK = new Map(FEATURE_SIDEBAR_ORDER.map((id, index) => [id, index]));
export const official_chat_feature = id => typeof id === 'string' &&
	(/^(melvorD|melvorF|melvorTotH|melvorAoD|melvorItA):[A-Za-z0-9_]+$/.test(id) ||
		(id.startsWith('multiplayer:') && Object.hasOwn(MULTIPLAYER_FEATURE_NAMES, id.slice('multiplayer:'.length))));
export const fallback_feature_name = id => MULTIPLAYER_FEATURE_NAMES[id?.slice('multiplayer:'.length)] ??
	id?.split(':')[1]?.replaceAll('_', ' ') ?? id;
export function feature_name(game, getLangString, id) {
	if (id?.startsWith('multiplayer:')) {
		const lang_id = MULTIPLAYER_FEATURE_LANG_IDS[id.slice('multiplayer:'.length)];
		if (lang_id) return getLangString(lang_id).replace(/\s*[（(][^）)]*[）)]\s*$/u, '');
	}
	return game.skills?.getObjectByID?.(id)?.name ?? game.pages?.getObjectByID?.(id)?.name ?? fallback_feature_name(id);
}
export function feature_media(game, id) {
	return game.skills?.getObjectByID?.(id)?.media ?? game.pages?.getObjectByID?.(id)?.media ?? null;
}
export function feature_catalog(game, getLangString) {
	const ids = [
		...Object.keys(MULTIPLAYER_FEATURE_NAMES).map(id => `multiplayer:${id}`),
		...[...game.skills?.registeredObjects?.values?.() ?? []].map(skill => skill.id),
		'melvorD:Combat', 'melvorD:Bank', 'melvorD:Shop'
	];
	return [...new Set(ids)].filter(id => official_chat_feature(id) && feature_media(game, id))
		.map(id => ({ id, name: feature_name(game, getLangString, id), media: feature_media(game, id) }))
		.sort((a, b) => (FEATURE_SIDEBAR_RANK.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
			(FEATURE_SIDEBAR_RANK.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
			a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function compact_parts(parts, trim = false) {
	const result = [];
	for (const part of parts) {
		if (part.type === 'item' && official_chat_item(part.item_id)) result.push({ type: 'item', item_id: part.item_id });
		else if (part.type === 'feature' && official_chat_feature(part.feature_id)) result.push({ type: 'feature', feature_id: part.feature_id });
		else if (part.type === 'text' && part.text) {
			const last = result.at(-1);
			if (last?.type === 'text') last.text += part.text;
			else result.push({ type: 'text', text: part.text });
		}
	}
	if (trim) {
		if (result[0]?.type === 'text') result[0].text = result[0].text.trimStart();
		if (result.at(-1)?.type === 'text') result.at(-1).text = result.at(-1).text.trimEnd();
	}
	return result.filter(part => part.type !== 'text' || part.text);
}

export const fallback_item_name = id => id.split(':')[1]?.replaceAll('_', ' ') ?? id;
export const fallback_text = parts => parts.map(part => part.type === 'text' ? part.text : part.type === 'item' ?
	`[${fallback_item_name(part.item_id)}]` : `$${fallback_feature_name(part.feature_id)}`).join('');
export const parts_length = parts => parts.reduce((length, part) => length + (part.type === 'text' ? part.text.length : 1), 0);
export const valid_parts = parts => fallback_text(compact_parts(parts, true)).length <= CHAT_LENGTH_LIMIT &&
	parts.filter(part => part.type !== 'text').length <= CHAT_ITEM_LIMIT;

export function replace_parts(parts, start, end, inserted) {
	const before = [], after = [];
	let offset = 0;
	for (const part of parts) {
		const length = part.type === 'text' ? part.text.length : 1;
		if (offset + length <= start) before.push(part);
		else if (offset < start && part.type === 'text') before.push({ type: 'text', text: part.text.slice(0, start - offset) });
		if (offset >= end) after.push(part);
		else if (offset + length > end && part.type === 'text') after.push({ type: 'text', text: part.text.slice(end - offset) });
		offset += length;
	}
	return compact_parts([...before, ...inserted, ...after]);
}

export function chat_item_shortcut_range(parts, caret, character, committed = false) {
	if (character !== '#' && character !== '＃' && character !== '$' && character !== '＄') return null;
	const start = caret - (committed ? character.length : 0);
	if (start < 0) return null;
	if (committed) {
		const through_caret = replace_parts(parts, caret, parts_length(parts), []);
		if (through_caret.at(-1)?.type !== 'text' || !through_caret.at(-1).text.endsWith(character)) return null;
	}
	const preceding = replace_parts(parts, start, parts_length(parts), []);
	const text = fallback_text(preceding);
	return !text || /\s$/.test(text) ? [start, start + character.length] : null;
}

export function item_catalog(game, listings = []) {
	const priorities = new Map();
	for (const listing of listings) {
		const priority = listing.direction === 'buy' ? 0 : listing.direction === 'sell' ? 1 : 2;
		if (typeof listing.item_id === 'string' && priority < (priorities.get(listing.item_id) ?? 2))
			priorities.set(listing.item_id, priority);
	}
	return [...game.items.registeredObjects.values()].filter(item => official_chat_item(item.id) && game.stats.itemFindCount(item) > 0)
		.map(item => ({ id: item.id, name: item.name, media: item.media }))
		.sort((a, b) => (priorities.get(a.id) ?? 2) - (priorities.get(b.id) ?? 2) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export const ordered_item_ids = listings => [...new Map((listings ?? [])
	.filter(listing => (listing.direction === 'buy' || listing.direction === 'sell') && typeof listing.item_id === 'string')
	.sort((a, b) => (a.direction === 'buy' ? 0 : 1) - (b.direction === 'buy' ? 0 : 1))
	.map(listing => [listing.item_id, listing.item_id])).values()];

function unique_items(items) {
	const seen = new Set();
	return items.filter(item => {
		if (!item || seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
}

export function search_items(catalog, query, recent = [], limit = 100) {
	const search = query.trim().toLocaleLowerCase();
	const unique_catalog = unique_items(catalog);
	if (!search) {
		const by_id = new Map(unique_catalog.map(item => [item.id, item]));
		const prioritized = [];
		const seen = new Set();
		for (const id of recent) {
			const item = by_id.get(id);
			if (!item || seen.has(item.id)) continue;
			seen.add(item.id);
			prioritized.push(item);
		}
		return [...prioritized, ...unique_catalog.filter(item => !seen.has(item.id))].slice(0, limit);
	}
	return unique_catalog.filter(item => item.name.toLocaleLowerCase().includes(search) ||
		fallback_item_name(item.id).toLocaleLowerCase().includes(search)).slice(0, limit);
}

export function register_chat_elements({ game, state, getLangString, document, HTMLElement, customElements }) {
	function item_node(part, editing = false) {
		const item = game.items.getObjectByID(part.item_id);
		const chip = document.createElement(editing ? 'span' : 'button');
		chip.className = 'mp-chat-item' + (item ? '' : ' mp-chat-item-unavailable');
		chip.dataset.itemId = part.item_id;
		chip.contentEditable = 'false';
		chip.title = item ? item.name : `${getLangString('MOD_MP_UNKNOWN_ITEM_ARIA')} (${part.item_id})`;
		chip.setAttribute('aria-label', chip.title);
		if (item) {
			const image = document.createElement('img');
			image.src = item.media; image.alt = ''; image.draggable = false;
			chip.append(image);
		}
		chip.append(document.createTextNode(item?.name ?? `${getLangString('MOD_MP_MARKET_UNKNOWN_ITEM')} (${fallback_item_name(part.item_id)})`));
		if (editing) chip.setAttribute('role', 'img');
		else {
			chip.type = 'button';
			chip.disabled = !item;
			chip.addEventListener('click', () => state.show_chat_item_actions(part.item_id));
		}
		return chip;
	}
	function feature_node(part, editing = false) {
		const name = feature_name(game, getLangString, part.feature_id);
		const media = feature_media(game, part.feature_id);
		const chip = document.createElement(editing ? 'span' : 'button');
		chip.className = 'mp-chat-item mp-chat-feature' + (media ? '' : ' mp-chat-item-unavailable');
		chip.dataset.featureId = part.feature_id;
		chip.contentEditable = 'false';
		chip.title = name;
		chip.setAttribute('aria-label', name);
		if (media) {
			const image = document.createElement('img');
			image.src = media; image.alt = ''; image.draggable = false;
			chip.append(image);
		}
		chip.append(document.createTextNode(name));
		if (editing) chip.setAttribute('role', 'img');
		else {
			chip.type = 'button';
			chip.disabled = !state.can_open_chat_feature(part.feature_id);
			chip.addEventListener('click', () => state.open_chat_feature(part.feature_id));
		}
		return chip;
	}
	function append_parts(host, parts, editing = false) {
		const fragment = document.createDocumentFragment();
		for (const part of parts) fragment.append(part.type === 'text' ? document.createTextNode(part.text) :
			part.type === 'feature' ? feature_node(part, editing) : item_node(part, editing));
		host.replaceChildren(fragment);
	}
	class ChatMessage extends HTMLElement {
		static get observedAttributes() { return ['parts']; }
		connectedCallback() { this.render(); }
		attributeChangedCallback() { if (this.isConnected) this.render(); }
		render() {
			const parts = JSON.parse(this.getAttribute('parts') || '[]');
			append_parts(this, parts);
		}
	}
	class ChatComposer extends HTMLElement {
		static get observedAttributes() { return ['value', 'disabled', 'placeholder']; }
		connectedCallback() {
			if (this.editor) {
				document.addEventListener('selectionchange', this.on_selection_change);
				this.sync(); return;
			}
			// Petite Vue can clone the already-rendered element from its v-if template.
			// A cloned custom element keeps those children, but not this instance's fields.
			this.replaceChildren();
			this.editor = document.createElement('div');
			this.editor.className = 'mp-input-text mp-chat-editor';
			this.editor.setAttribute('role', 'textbox');
			this.editor.setAttribute('aria-multiline', 'true');
			this.editor.spellcheck = true;
			this.append(this.editor);
			this.parts = []; this.history = []; this.history_index = -1;
			this.on_selection_change = () => {
				const selection = document.getSelection();
				if (selection?.rangeCount && this.editor.contains(selection.getRangeAt(0).commonAncestorContainer))
					this.saved_selection = this.selection();
			};
			document.addEventListener('selectionchange', this.on_selection_change);
			this.editor.addEventListener('beforeinput', event => this.before_input(event));
			this.editor.addEventListener('input', () => {
				if (this.composing) return;
				this.read_input();
				this.open_composed_shortcut();
				this.composition_trigger = null;
			});
			this.editor.addEventListener('compositionstart', () => { this.composing = true; this.composition_trigger = null; });
			this.editor.addEventListener('compositionend', event => {
				this.composing = false;
				this.composition_trigger = event.data;
				this.read_input();
				this.open_composed_shortcut();
			});
			this.editor.addEventListener('keydown', event => {
				if (event.isComposing || this.composing) return;
				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
					event.preventDefault(); this.undo(event.shiftKey ? 1 : -1); return;
				}
				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
					event.preventDefault(); this.undo(1); return;
				}
				state.handle_chat_keydown(event);
			});
			this.editor.addEventListener('paste', event => {
				event.preventDefault();
				this.replace_selection([{ type: 'text', text: (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n') }]);
			});
			this.editor.addEventListener('copy', event => this.copy(event, false));
			this.editor.addEventListener('cut', event => this.copy(event, true));
			this.editor.addEventListener('drop', event => event.preventDefault());
			this.editor.addEventListener('dragstart', event => event.preventDefault());
			this.sync();
		}
		disconnectedCallback() { document.removeEventListener('selectionchange', this.on_selection_change); }
		attributeChangedCallback() { if (this.editor) this.sync(); }
		sync() {
			this.editor.contentEditable = this.hasAttribute('disabled') ? 'false' : 'true';
			this.editor.setAttribute('aria-label', this.getAttribute('placeholder') || '');
			this.editor.dataset.placeholder = this.getAttribute('placeholder') || '';
			const value = JSON.parse(this.getAttribute('value') || '{"key":null,"parts":[]}');
			if (this.composing && value.key === this.key) return;
			if (value.key !== this.key || JSON.stringify(value.parts) !== JSON.stringify(this.parts)) {
				this.key = value.key; this.parts = value.parts;
				this.saved_selection = [parts_length(this.parts), parts_length(this.parts)];
				append_parts(this.editor, this.parts, true);
				this.history = [{ parts: this.parts, selection: [parts_length(this.parts), parts_length(this.parts)] }];
				this.history_index = 0;
			}
		}
		read_dom(host) {
			const parts = [];
			for (const node of host.childNodes) {
				if (node.nodeType === 3) parts.push({ type: 'text', text: node.textContent });
				else if (node.dataset?.itemId && official_chat_item(node.dataset.itemId)) parts.push({ type: 'item', item_id: node.dataset.itemId });
				else if (node.dataset?.featureId && official_chat_feature(node.dataset.featureId)) parts.push({ type: 'feature', feature_id: node.dataset.featureId });
				else if (node.nodeName === 'BR') parts.push({ type: 'text', text: '\n' });
				else {
					if (['DIV', 'P'].includes(node.nodeName) && parts.length) parts.push({ type: 'text', text: '\n' });
					parts.push(...this.read_dom(node));
				}
			}
			return compact_parts(parts);
		}
		selection() {
			const selection = document.getSelection();
			if (!selection?.rangeCount) return [parts_length(this.parts), parts_length(this.parts)];
			const range = selection.getRangeAt(0);
			if (!this.editor.contains(range.commonAncestorContainer)) return this.saved_selection ?? [parts_length(this.parts), parts_length(this.parts)];
			const offset = (node, index) => {
				const prefix = document.createRange(); prefix.selectNodeContents(this.editor); prefix.setEnd(node, index);
				return parts_length(this.read_dom(prefix.cloneContents()));
			};
			return [offset(range.startContainer, range.startOffset), offset(range.endContainer, range.endOffset)];
		}
		set_selection(start, end = start) {
			const locate = position => {
				let offset = 0;
				for (let index = 0; index < this.editor.childNodes.length; index++) {
					const node = this.editor.childNodes[index];
					const length = node.nodeType === 3 ? node.textContent.length : 1;
					if (position <= offset + length) return node.nodeType === 3 ? [node, Math.max(0, position - offset)] : [this.editor, index + (position > offset ? 1 : 0)];
					offset += length;
				}
				return [this.editor, this.editor.childNodes.length];
			};
			const range = document.createRange(); range.setStart(...locate(start)); range.setEnd(...locate(end));
			const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
			this.saved_selection = [start, end];
		}
		publish() { state.update_chat_item_draft(this.key, this.parts); }
		record(selection) {
			this.history = this.history.slice(0, this.history_index + 1);
			this.history.push({ parts: this.parts, selection });
			if (this.history.length > 100) this.history.shift();
			this.history_index = this.history.length - 1;
		}
		replace_selection(inserted, selection = this.selection()) {
			if (this.hasAttribute('disabled')) return;
			const [start, end] = selection;
			if (this.history[this.history_index]) this.history[this.history_index].selection = selection;
			this.parts = replace_parts(this.parts, start, end, inserted);
			append_parts(this.editor, this.parts, true);
			const caret = start + parts_length(inserted);
			this.set_selection(caret); this.record([caret, caret]); this.publish();
		}
		read_input() {
			const selection = this.selection();
			this.parts = this.read_dom(this.editor);
			// Normalize browser-created paragraph wrappers only after composition has finished.
			append_parts(this.editor, this.parts, true); this.set_selection(...selection);
			this.record(selection); this.publish();
		}
		open_composed_shortcut() {
			const [start, end] = this.selection();
			if (start !== end) return;
			const trigger = this.composition_trigger;
			const shortcut = chat_item_shortcut_range(this.parts, end, trigger, true);
			if (shortcut) {
				this.composition_trigger = null;
				this.open_picker(shortcut, true, trigger === '$' || trigger === '＄' ? 'feature' : 'item');
			}
		}
		undo(direction) {
			const index = this.history_index + direction;
			if (!this.history[index]) return;
			this.history_index = index; const entry = this.history[index]; this.parts = entry.parts;
			append_parts(this.editor, this.parts, true); this.set_selection(...entry.selection); this.publish();
		}
		before_input(event) {
			if (this.composing || event.isComposing || event.inputType === 'insertCompositionText') return;
			const type = event.inputType;
			if (type === 'historyUndo' || type === 'historyRedo') { event.preventDefault(); this.undo(type === 'historyUndo' ? -1 : 1); return; }
			if (type === 'insertText' && event.data !== null) {
				const selection = this.selection();
				if (selection[0] === selection[1]) {
					const shortcut = chat_item_shortcut_range(this.parts, selection[0], event.data);
					if (shortcut) {
						event.preventDefault(); this.replace_selection([{ type: 'text', text: event.data }], selection);
						this.open_picker(shortcut, true, event.data === '$' || event.data === '＄' ? 'feature' : 'item'); return;
					}
				}
				event.preventDefault(); this.replace_selection([{ type: 'text', text: event.data }]); return;
			}
			if (type === 'insertParagraph' || type === 'insertLineBreak') {
				event.preventDefault(); this.replace_selection([{ type: 'text', text: '\n' }]); return;
			}
			if (type === 'deleteContentBackward' || type === 'deleteContentForward') {
				event.preventDefault(); let [start, end] = this.selection();
				if (start === end) {
					// Preserve Unicode graphemes (emoji and combined characters) during ordinary deletion.
					const text = this.parts.map(part => part.type === 'text' ? part.text : '\ufffc').join('');
					const boundaries = typeof Intl.Segmenter === 'function' ?
						[...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(entry => entry.index).concat(text.length) :
						[...text].reduce((result, character) => [...result, result.at(-1) + character.length], [0]);
					if (type === 'deleteContentBackward') start = boundaries.filter(value => value < start).at(-1) ?? 0;
					else end = boundaries.find(value => value > end) ?? text.length;
				}
				this.replace_selection([], [start, end]);
			}
		}
		copy(event, cut) {
			const [start, end] = this.selection();
			if (start === end) return;
			const prefix = replace_parts(this.parts, end, parts_length(this.parts), []);
			const selected = replace_parts(prefix, 0, start, []);
			const text = selected.map(part => part.type === 'text' ? part.text : part.type === 'feature' ?
				feature_name(game, getLangString, part.feature_id) : game.items.getObjectByID(part.item_id)?.name ?? fallback_item_name(part.item_id)).join('');
			event.preventDefault(); event.clipboardData?.setData('text/plain', text);
			if (cut) this.replace_selection([], [start, end]);
		}
		open_picker(selection = this.selection(), trigger = false, kind = 'item') {
			if (this.hasAttribute('disabled') || this.composing) return;
			this.picker_selection = selection;
			this.picker_restore_selection = trigger ? [selection[1], selection[1]] : selection;
			this.picker_item_id = null;
			this.picker_feature_id = null;
			if (kind === 'feature') state.show_chat_feature_picker(this);
			else state.show_chat_item_picker(this);
		}
		insert_item(id) {
			if (!official_chat_item(id) || !game.items.getObjectByID(id)) return;
			this.editor.focus();
			this.replace_selection([{ type: 'item', item_id: id }, { type: 'text', text: ' ' }], this.picker_selection);
		}
		insert_feature(id) {
			if (!official_chat_feature(id) || !feature_media(game, id)) return;
			this.editor.focus();
			this.replace_selection([{ type: 'feature', feature_id: id }, { type: 'text', text: ' ' }], this.picker_selection);
		}
	}
	customElements.define('mp-chat-message-body', ChatMessage);
	customElements.define('mp-chat-composer', ChatComposer);
}
