export const CHAT_ITEM_LIMIT = 20;
export const CHAT_LENGTH_LIMIT = 1000;
export const official_chat_item = id => typeof id === 'string' &&
	/^(melvorD|melvorF|melvorTotH|melvorAoD|melvorItA):[A-Za-z0-9_]+$/.test(id);

export function compact_parts(parts, trim = false) {
	const result = [];
	for (const part of parts) {
		if (part.type === 'item' && official_chat_item(part.item_id)) result.push({ type: 'item', item_id: part.item_id });
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
export const fallback_text = parts => parts.map(part => part.type === 'text' ? part.text : `[${fallback_item_name(part.item_id)}]`).join('');
export const parts_length = parts => parts.reduce((length, part) => length + (part.type === 'text' ? part.text.length : 1), 0);
export const valid_parts = parts => fallback_text(compact_parts(parts, true)).length <= CHAT_LENGTH_LIMIT &&
	parts.filter(part => part.type === 'item').length <= CHAT_ITEM_LIMIT;

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

export function search_items(catalog, query, recent = [], limit = 30) {
	const search = query.trim().toLocaleLowerCase();
	if (!search) {
		const by_id = new Map(catalog.map(item => [item.id, item]));
		return [...recent.map(id => by_id.get(id)).filter(Boolean), ...catalog.filter(item => !recent.includes(item.id))].slice(0, limit);
	}
	return catalog.filter(item => item.name.toLocaleLowerCase().includes(search) ||
		fallback_item_name(item.id).toLocaleLowerCase().includes(search)).slice(0, limit);
}

export function register_chat_elements({ game, state, getLangString, document, HTMLElement, customElements }) {
	function item_node(part, editing = false) {
		const item = game.items.getObjectByID(part.item_id);
		const chip = document.createElement('span');
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
		return chip;
	}
	function append_parts(host, parts, editing = false) {
		const fragment = document.createDocumentFragment();
		for (const part of parts) fragment.append(part.type === 'text' ? document.createTextNode(part.text) : item_node(part, editing));
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
			this.editor.addEventListener('input', () => { if (!this.composing) this.read_input(); });
			this.editor.addEventListener('compositionstart', () => { this.composing = true; });
			this.editor.addEventListener('compositionend', () => { this.composing = false; this.read_input(); });
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
				if (event.data === '#' && selection[0] === selection[1]) {
					const preceding = replace_parts(this.parts, selection[0], parts_length(this.parts), []);
					const text = fallback_text(preceding);
					if (!text || /\s$/.test(text)) {
						event.preventDefault(); this.replace_selection([{ type: 'text', text: '#' }], selection);
						this.open_picker([selection[0], selection[0] + 1], true); return;
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
			const text = selected.map(part => part.type === 'text' ? part.text : game.items.getObjectByID(part.item_id)?.name ?? fallback_item_name(part.item_id)).join('');
			event.preventDefault(); event.clipboardData?.setData('text/plain', text);
			if (cut) this.replace_selection([], [start, end]);
		}
		open_picker(selection = this.selection(), trigger = false) {
			if (this.hasAttribute('disabled') || this.composing) return;
			this.picker_selection = selection;
			this.picker_restore_selection = trigger ? [selection[1], selection[1]] : selection;
			this.picker_item_id = null;
			state.show_chat_item_picker(this);
		}
		insert_item(id) {
			if (!official_chat_item(id) || !game.items.getObjectByID(id)) return;
			this.editor.focus();
			this.replace_selection([{ type: 'item', item_id: id }, { type: 'text', text: ' ' }], this.picker_selection);
		}
	}
	customElements.define('mp-chat-message-body', ChatMessage);
	customElements.define('mp-chat-composer', ChatComposer);
}
