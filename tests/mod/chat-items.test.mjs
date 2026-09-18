import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as items from '../../mod/chat-items.mjs';
import { install_chat_actions } from '../../mod/client-actions-chat.mjs';

const sword = { type: 'item', item_id: 'melvorD:Bronze_Sword' };
const stardust = { type: 'item', item_id: 'melvorTotH:Golden_Stardust' };
const text = text => ({ type: 'text', text });

test('edits text around atomic item tags and preserves independent repeated occurrences', () => {
	const parts = [text('before '), sword, text(' after')];
	assert.equal(items.parts_length(parts), 14);
	assert.deepEqual(items.replace_parts(parts, 7, 8, []), [text('before  after')]);
	assert.deepEqual(items.replace_parts(parts, 8, 8, [stardust]), [text('before '), sword, stardust, text(' after')]);
	assert.deepEqual(items.replace_parts(parts, 3, 10, [sword, sword]), [text('bef'), sword, sword, text('fter')]);
	assert.deepEqual(items.compact_parts([text(' '), sword, text('  ')], true), [sword]);
	assert.equal(items.fallback_text([sword, stardust]), '[Bronze Sword][Golden Stardust]');
	assert.equal(items.valid_parts(Array(21).fill(sword)), false);
	assert.equal(items.valid_parts([text('a'.repeat(1001))]), false);
});

test('picker includes only discovered registered official items without Bank, category or DLC ownership filters', () => {
	const registeredObjects = new Map(['melvorD', 'melvorF', 'melvorTotH', 'melvorAoD', 'melvorItA', 'mod', 'multiplayer']
		.map((namespace, index) => [`${namespace}:Item`, { id: `${namespace}:Item`, name: `Item ${index}`, category: '', media: 'local.png' }]));
	const catalog = items.item_catalog({ items: { registeredObjects }, stats: { itemFindCount: item => item.id !== 'melvorF:Item' ? 1 : 0 } });
	assert.equal(catalog.length, 4);
	assert.equal(catalog.some(item => item.id === 'melvorF:Item'), false);
	assert.equal(catalog.some(item => item.id === 'mod:Item'), false);
	assert.equal(items.search_items(catalog, '', ['melvorItA:Item'])[0].id, 'melvorItA:Item');
	assert.equal(items.search_items(catalog, 'ITEM 3')[0].id, 'melvorAoD:Item');
	assert.equal(items.search_items([{ id: sword.item_id, name: '青铜剑' }], 'bronze sword')[0].name, '青铜剑');
	assert.equal(items.search_items(Array.from({ length: 100 }, (_, i) => ({ id: `melvorD:Item_${i}`, name: 'Item' })), '').length, 30);
});

test('orders discovered chat items by own Buy Orders, Sell Orders, then name', () => {
	const registeredObjects = new Map(['Zinc', 'Apple', 'Bronze', 'Amber'].map(name =>
		[`melvorD:${name}`, { id: `melvorD:${name}`, name, media: 'local.png' }]));
	const game = { items: { registeredObjects }, stats: { itemFindCount: () => 1 } };
	const listings = [
		{ item_id: 'melvorD:Bronze', direction: 'sell' },
		{ item_id: 'melvorD:Bronze', direction: 'buy' },
		{ item_id: 'melvorD:Zinc', direction: 'buy' },
		{ item_id: 'melvorD:Amber', direction: 'buy' }
	];
	assert.deepEqual(items.item_catalog(game, listings).map(item => item.id), [
		'melvorD:Amber', 'melvorD:Bronze', 'melvorD:Zinc', 'melvorD:Apple'
	]);
	assert.deepEqual(items.ordered_item_ids(listings), ['melvorD:Bronze', 'melvorD:Zinc', 'melvorD:Amber']);
});

test('deduplicates items when marketplace and recent picker categories overlap', () => {
	const catalog = [
		{ id: 'melvorD:Buy_And_Sell', name: 'Buy and Sell' },
		{ id: 'melvorD:Sell_Only', name: 'Sell Only' },
		{ id: 'melvorD:Discovered', name: 'Discovered' }
	];
	assert.deepEqual(items.search_items(catalog, '', [
		'melvorD:Buy_And_Sell', 'melvorD:Sell_Only', 'melvorD:Buy_And_Sell', 'melvorD:Discovered'
	]).map(item => item.id), [
		'melvorD:Buy_And_Sell', 'melvorD:Sell_Only', 'melvorD:Discovered'
	]);
	assert.deepEqual(items.search_items([...catalog, catalog[0]], 'discovered').map(item => item.id), ['melvorD:Discovered']);
});

function context() {
	const item = { id: sword.item_id, name: '青铜剑', media: 'sword.png', wikiName: 'Bronze_Sword' };
	const market_page = { id: 'multiplayer:Multiplayer_Market' };
	const game = { items: { getObjectByID: id => id === sword.item_id ? item : undefined }, pages: { getObjectByID: id => id === market_page.id ? market_page : undefined } };
	const state = { chat_item_drafts: {}, chat_drafts: {}, chat_draft: '', chat_translation_preferences: { 'private:2': 'en' },
		chat_client_id: 1, selected_chat_conversation: { conversation_kind: 'private', conversation_id: 1, participant: { client_id: 2 } },
		chat_sending_conversations: {}, chat_pending_sends: {}, chat_messages: [],
		is_guild_member: true, is_social_only: false, selected_chat_item_id: '', chat_item_market_checked: false,
		get chat_sending() { return false; }, scroll_chat_messages_to_bottom: async () => {} };
	let response = null;
	const requests = [];
	const opened = [], pages = [];
	const runtime = { document: { querySelector: () => null }, state, game, chat_items: items, get_chat_conversation_key: conversation => conversation ? 'private:' + conversation.participant.client_id : null,
		getLangString: id => id, crypto: { randomUUID: () => String(Math.random()) }, chat_view_generation: 1,
		api_post: async (url, payload) => { requests.push(payload); return typeof response === 'function' ? response(url, payload) : response; }, log() {},
		queue_modal: (...args) => { state.queued_modal = args; }, openLink: url => opened.push(url), changePage: page => pages.push(page),
		get_local_item_namespaces: () => ['melvorD'], update_market_search: async () => { state.market_searches = (state.market_searches ?? 0) + 1; },
		refresh_chat_conversations: async () => {}, start_chat_polling() {}, now: () => 0 };
	Object.assign(state, install_chat_actions(runtime));
	state.close_modal_and_wait = async template => { state.closed_modal = template; };
	return { state, requests, opened, pages, market_page, set_response: value => { response = value; } };
}

test('rendering resolves item names independently of chat translation and keeps missing items readable', () => {
	const { state } = context();
	const message = { sender_id: 2, content: 'Use [Bronze Sword]', parts: [text('Use '), sword],
		translations: { en: '[Bronze Sword] please' }, translation_parts: { en: [sword, text(' please')] } };
	assert.deepEqual(state.get_chat_message_parts(message), [sword, text(' please')]);
	assert.equal(state.get_chat_plain_content(message), 'Use 青铜剑');
	assert.equal(state.get_chat_plain_content({ parts: [stardust] }), 'Golden Stardust');
	assert.deepEqual(state.get_chat_message_parts({ ...message, sender_id: 1 }), message.parts);
	assert.deepEqual(state.get_chat_message_parts({ content: '<img onerror=x>', sender_id: 1 }), [text('<img onerror=x>')]);
});

test('item actions use the native wiki name and open a matching marketplace direction', async () => {
	const { state, requests, opened, pages, market_page, set_response } = context();
	state.show_chat_item_actions(sword.item_id);
	assert.equal(state.selected_chat_item_id, sword.item_id);
	assert.equal(state.queued_modal[1], 'chat-item-actions-modal');
	assert.equal(state.queued_modal[0], '青铜剑');
	assert.equal(state.queued_modal[4], false);
	state.open_chat_item_wiki();
	assert.deepEqual(opened, ['https://wiki.melvoridle.com/w/Bronze_Sword']);

	set_response((_url, payload) => ({ success: true, total_items: payload.direction === 'buy' ? 1 : 0 }));
	await state.check_chat_item_marketplace();
	assert.deepEqual(requests.map(request => request.direction), ['sell', 'buy']);
	assert.ok(requests.every(request => request.item_id === sword.item_id && request.item_namespaces[0] === 'melvorD'));
	assert.equal(state.market_direction, 'buy');
	assert.equal(state.market_filter_item, sword.item_id);
	assert.equal(state.closed_modal, 'chat-item-actions-modal');
	assert.deepEqual(pages, [market_page]);
	assert.equal(state.market_searches, 1);
});

test('item marketplace check prefers Sell Listings and locks an empty result until reopen', async () => {
	const { state, set_response } = context();
	state.show_chat_item_actions(sword.item_id);
	set_response((_url, payload) => ({ success: true, total_items: payload.direction === 'sell' ? 2 : 1 }));
	await state.check_chat_item_marketplace();
	assert.equal(state.market_direction, 'sell');

	state.show_chat_item_actions(sword.item_id);
	set_response(() => ({ success: true, total_items: 0 }));
	await state.check_chat_item_marketplace();
	assert.equal(state.chat_item_market_checked, true);
});

test('sends structured tags, reuses identical retries, and changes the key when same-named item identity changes', async () => {
	const { state, requests, set_response } = context();
	state.update_chat_item_draft('private:2', [text('Use '), sword]);
	await state.send_chat_message(); await state.send_chat_message();
	assert.deepEqual(requests[0].parts, [text('Use '), sword]);
	assert.equal(requests[0].idempotency_key, requests[1].idempotency_key);
	state.update_chat_item_draft('private:2', [text('Use '), { ...sword, item_id: 'melvorF:Bronze_Sword' }]);
	await state.send_chat_message();
	assert.notEqual(requests[1].idempotency_key, requests[2].idempotency_key);
	set_response({ success: true, message: { message_id: 1, conversation_id: 1 } });
	await state.send_chat_message();
	assert.equal(state.chat_drafts['private:2'], undefined); // This fixture's plain field is independent of the real store setter.
	state.chat_drafts['private:2'] = state.chat_draft;
	await state.send_chat_message();
	assert.equal(state.chat_drafts['private:2'], '');
	assert.equal(state.chat_item_drafts['private:2'], undefined);
});

test('a tag-only draft is sendable and oversized drafts remain editable without sending', async () => {
	const { state, requests } = context();
	state.update_chat_item_draft('private:2', [sword]);
	await state.send_chat_message();
	assert.deepEqual(requests[0].parts, [sword]);
	state.update_chat_item_draft('private:2', Array(21).fill(sword));
	await state.send_chat_message();
	assert.equal(requests.length, 1);
	assert.equal(state.is_chat_item_draft_valid(), false);
});

test('keyboard item selection prevents the native Enter click from reopening the picker', () => {
	const { state } = context();
	const chosen = [];
	state.choose_chat_item = id => chosen.push(id);
	for (const key of ['Enter', ' ']) {
		let prevented = false;
		state.handle_chat_item_result_key({ key, preventDefault() { prevented = true; } }, sword.item_id);
		assert.equal(prevented, true);
	}
	assert.deepEqual(chosen, [sword.item_id, sword.item_id]);
});

test('composer discards cloned editor markup and preserves the picker insertion selection', async () => {
	const chat_items = await readFile(new URL('../../mod/chat-items.mjs', import.meta.url), 'utf8');
	assert.match(chat_items, /this\.replaceChildren\(\);\s*this\.editor = document\.createElement\('div'\)/);
	assert.match(chat_items, /this\.picker_selection = selection;/);
	assert.match(chat_items, /this\.replace_selection\([^;]+this\.picker_selection\);/);
	assert.doesNotMatch(chat_items, /this\.saved_selection = selection;\s*this\.picker_restore_selection/);
});

test('picker renders changing results without Petite Vue structural directives', async () => {
	const [main, templates, style] = await Promise.all([
		readFile(new URL('../../mod/client-actions-chat.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);
	const picker = templates.slice(templates.indexOf('template-mp-chat-item-picker-modal'));
	assert.match(main, /queue_modal\('MOD_MP_CHAT_INSERT_ITEM', 'chat-item-picker-modal'[\s\S]*customClass: \{ popup: 'mp-chat-item-picker-modal-popup' \}/);
	assert.match(picker, /@input="state\.update_chat_item_search\(\$event\)"/);
	assert.match(picker, /class="mp-chat-item-results" @touchmove="state\.stop_icon_scroll_propagation\(\$event\)"><\/div>/);
	assert.match(picker, /mp-chat-item-empty d-none/);
	assert.doesNotMatch(picker, /v-for=/);
	assert.doesNotMatch(picker, /get_chat_item_results\(\).*v-(?:if|show)/);
	assert.match(style, /\.mp-chat-item-results \{[\s\S]*overflow-y: scroll;[\s\S]*-webkit-overflow-scrolling: touch;[\s\S]*touch-action: pan-y;[\s\S]*overscroll-behavior-y: contain;/);
	assert.match(style, /\.mp-chat-item-picker-modal-popup \.swal2-html-container \{[\s\S]*overflow: visible;/);
});

test('rendered message item tags expose the item actions modal', async () => {
	const [chat_items, templates, style] = await Promise.all([
		readFile(new URL('../../mod/chat-items.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);
	assert.match(chat_items, /document\.createElement\(editing \? 'span' : 'button'\)/);
	assert.match(chat_items, /state\.show_chat_item_actions\(part\.item_id\)/);
	assert.match(templates, /template-mp-chat-item-actions-modal/);
	assert.match(templates, /MOD_MP_CHAT_ITEM_WIKI/);
	assert.match(templates, /state\.check_chat_item_marketplace\(\$event\)/);
	assert.match(templates, /class="btn mp-actions-marketplace" v-show=/);
	assert.match(style, /\.mp-chat-item-actions \{[\s\S]*flex-direction: column/);
	assert.match(style, /\.mp-chat-item-actions \.btn-outline-secondary \{[\s\S]*color: #fff;/);
});
