import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { install_chat_actions } from '../../mod/client-actions-chat.mjs';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

async function sources() {
	const [main, templates, style, data_text, language_text] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data.json', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	return { main, templates, style, data: JSON.parse(data_text), language: JSON.parse(language_text) };
}

test('adds a first-class Chat page, inbox, unread indicators, and Guild-roster initiation', async () => {
	const { main, templates, style, data, language } = await sources();
	const chat_page = data.data.pages.find(page => page.id === 'Chat');

	assert.equal(chat_page.containerID, 'mp-chat-page');
	assert.equal(chat_page.sidebarItem.categoryID, 'Multiplayer');
	assert.equal(chat_page.media, 'https://cdn2-main.melvor.net/assets/media/bank/message_in_a_bottle.png');
	assert.equal(chat_page.sidebarItem.icon, 'https://cdn2-main.melvor.net/assets/media/bank/message_in_a_bottle.png');
	assert.equal(chat_page.sidebarItem.asideClass, 'badge mp-chat-nav');
	for (const page_id of ['Chat', 'Transfer_Items', 'Charity_Tree', 'Campaign_Effort', 'Guild_Raid']) {
		const page = data.data.pages.find(entry => entry.id === page_id);
		assert.match(page.sidebarItem.asideClass, /^badge mp-[a-z-]+-nav$/);
	}
	assert.equal(chat_page.sidebarItem.aside, '0');
	assert.match(templates, /template-mp-chat-page/);
	assert.match(templates, /state\.open_chat_conversation\(conversation\)/);
	assert.match(templates, /state\.start_member_chat\(\$event\)/);
	assert.match(main, /api_post\('\/api\/chat\/conversations\/start'/);
	assert.match(main, /changePage\(game\.pages\.getObjectByID\('multiplayer:Chat'\)\)/);
	assert.match(main, /aside\.hidden = state\.chat_unread <= 0/);
	assert.match(main, /header_badge\.hidden = state\.chat_unread <= 0/);
	assert.match(main, /badge\.className = 'text-size-sm font-w600 text-white badge badge-danger mp-chat-header-unread'/);
	const interface_ready = main.slice(main.indexOf('ctx.onInterfaceReady(() => {'), main.indexOf('\n\t});', main.indexOf('ctx.onInterfaceReady(() => {')));
	assert.match(interface_ready, /update_chat_nav\(\);/);
	assert.match(interface_ready, /setup_mobile_sidebar_unread\(\);/);
	assert.match(style, /\.mp-chat-nav,[\s\S]*\.mp-transfer-nav[\s\S]*padding: 3px 5px[\s\S]*font-weight: 700 !important[\s\S]*text-align: center/);
	assert.match(style, /\.mp-chat-nav[\s\S]*background-color: #ff4545/);
	assert.match(style, /#mp-chat-header-unread[\s\S]*top: unset[\s\S]*padding: 3px 5px[\s\S]*background-color: #ff4545[\s\S]*font-weight: 700 !important/);
	assert.match(style, /#mp-chat-header-unread[\s\S]*position: absolute[\s\S]*bottom: -5px[\s\S]*right: -5px/);
	assert.equal(language.MOD_MP_PAGE_CHAT, 'Chat');
	assert.doesNotMatch(templates, /MOD_MP_CHAT_INBOX/);
	assert.equal(language.MOD_MP_CHAT_CATEGORY_PERSONAL_INFO, 'These stay with you across Guilds.');
});

test('returns to the Chat home list when the sidebar entry is clicked', async () => {
	const main = await read_client_source(root);
	const watch_start = main.indexOf('function watch_chat_nav');
	const watch_end = main.indexOf('\nfunction update_charitree_nav', watch_start);
	const navigation = main.slice(watch_start, watch_end);
	const state = { close_count: 0, close_chat_conversation() { this.close_count++; } };
	let click_handler = null;
	let capture = false;
	const sidebar = { category: () => ({ item: () => ({ rootEl: {
		addEventListener(type, handler, use_capture) {
			assert.equal(type, 'click');
			click_handler = handler;
			capture = use_capture;
		}
	} }) }) };
	new Function('sidebar', 'state', `${navigation}; return watch_chat_nav;`)(sidebar, state)();
	assert.equal(capture, true);
	click_handler();
	assert.equal(state.close_count, 1);
	const interface_ready = main.slice(main.indexOf('ctx.onInterfaceReady(() => {'), main.indexOf('\n\t});', main.indexOf('ctx.onInterfaceReady(() => {')));
	assert.match(interface_ready, /watch_chat_nav\(\);/);
});

test('mirrors the shared unread count on the mobile sidebar button without duplicating the badge', async () => {
	const main = await read_client_source(root);
	const update_start = main.indexOf('function update_chat_nav');
	const functions = main.slice(update_start, main.indexOf('\nasync function refresh_chat_messages', update_start));
	const state = { chat_unread: 4 };
	const nodes = new Map();
	let append_count = 0;
	const aside = { textContent: '', hidden: true, classList: {
		toggle(class_name, enabled) {
			this[class_name] = enabled;
		}
	} };
	const sidebar_button = {
		querySelector: selector => selector === '#mp-chat-header-unread' ? nodes.get('mp-chat-header-unread') ?? null : null,
		append: badge => {
			append_count++;
			nodes.set(badge.id, badge);
		}
	};
	const document = {
		getElementById: id => id === 'sidebar-btn' ? sidebar_button : nodes.get(id) ?? null,
		querySelector: selector => selector === '.mp-chat-nav' ? aside : null,
		createElement: tag => ({ tag, id: '', className: '', hidden: false, textContent: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } })
	};
	const { setup_mobile_sidebar_unread, update_chat_nav } = new Function('document', 'state', `
		function set_nav_ready(aside, ready) {
			aside.classList.toggle('mp-nav-ready', ready);
		}
		${functions}
		return { setup_mobile_sidebar_unread, update_chat_nav };
	`)(document, state);

	setup_mobile_sidebar_unread();
	setup_mobile_sidebar_unread();
	update_chat_nav();

	const badge = nodes.get('mp-chat-header-unread');
	assert.equal(append_count, 1);
	assert.equal(badge.textContent, '4');
	assert.equal(badge.hidden, false);
	assert.equal(aside.textContent, '4');
	assert.equal(aside.hidden, false);

	state.chat_unread = 0;
	update_chat_nav();
	assert.equal(badge.textContent, '');
	assert.equal(badge.hidden, true);
	assert.equal(aside.hidden, true);
});

test('implements jittered foreground conversation polling and cursor-based history', async () => {
	const { main, templates } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);
	const chat_messages = chat_view.slice(chat_view.indexOf('<div class="mp-chat-messages"'), chat_view.indexOf('<div class="block-content mp-chat-compose"'));

	assert.match(main, /ctx\.loadModule\('polling\.mjs'\)/);
	assert.match(main, /on_page_toggle\('mp-chat-page', is_visible =>/);
	assert.match(main, /if \(is_visible && state\.is_connected\) \{[\s\S]*void get_client_events\(\);[\s\S]*void refresh_chat_page\(\);/);
	assert.match(main, /async function refresh_chat_page\(\) \{\s*if \(!state\.is_connected\)\s*return;/);
	assert.match(main, /start_client_event_polling\(true\);\s*if \(chat_page_visible\)\s*void refresh_chat_page\(\);/);
	assert.match(main, /'&after=' \+ state\.chat_latest_message_id/);
	assert.match(main, /'&reaction_after=' \+ state\.chat_reaction_revision/);
	assert.match(main, /Array\.isArray\(res\.reaction_updates\)[\s\S]*message\.reactions = update\.reactions/);
	assert.match(main, /should_scroll_for_additions = quiet && additions\.length > 0 && state\.chat_messages_are_at_bottom\(\)[\s\S]*await state\.scroll_chat_messages_to_bottom\(\)/);
	assert.match(main, /if \(additions\.length > 0\) \{\s*if \(!quiet && !prepend && cursor === ''\)\s*await state\.scroll_chat_messages_to_bottom\(\);\s*await refresh_chat_conversations\(\);\s*\}/);
	assert.match(main, /'&before=' \+ this\.chat_before_cursor/);
	assert.match(main, /poll_id !== chat_poll_id \|\| !chat_page_visible \|\| !polling\.is_foreground\(document\)/);
	assert.match(main, /polling\.chat_poll_delay\(\)/);
	assert.match(main, /finally \{[\s\S]*polling\.retry_poll_delay\(chat_poll_failures\)/);
	assert.match(main, /state\.selected_chat_conversation\?\.conversation_id !== conversation_id/);
	assert.match(chat_messages, /<div class="block-content text-center" v-if="state\.chat_has_more">[\s\S]*MOD_MP_CHAT_LOAD_OLDER/);
	assert.doesNotMatch(chat_view.slice(chat_view.indexOf('mp-chat-header'), chat_view.indexOf('mp-chat-messages')), /MOD_MP_CHAT_LOAD_OLDER/);
	assert.match(templates, /role="log" aria-live="polite"/);
});

test('keeps Chat at the bottom when opening or sending and anchors the viewport when loading older messages', async () => {
	const { main } = await sources();
	const chat_actions = main.slice(main.indexOf('export function install_chat_actions'));

	assert.match(chat_actions, /await this\.scroll_chat_messages_to_bottom\(\);[\s\S]*start_chat_polling\(\);/);
	assert.match(chat_actions, /this\.chat_messages\.push\(res\.message\);[\s\S]*await this\.scroll_chat_messages_to_bottom\(\);/);
	assert.match(chat_actions, /const previous_scroll_top = \$messages\?\.scrollTop \?\? 0;/);
	assert.match(chat_actions, /const previous_scroll_height = \$messages\?\.scrollHeight \?\? 0;/);
	assert.match(chat_actions, /\$messages\.scrollTop = previous_scroll_top \+ \$messages\.scrollHeight - previous_scroll_height;/);
	assert.match(main, /await refresh_chat_messages\('', false, false, view_generation\);[\s\S]*await state\.scroll_chat_messages_to_bottom\(\);/);

	const container = { scrollHeight: 1600, scrollTop: 140 };
	const actions = install_chat_actions({
		document: { querySelector: () => container },
		next_tick: async () => {},
		refresh_chat_messages: async () => {
			container.scrollHeight = 3200;
		}
	});
	await actions.scroll_chat_messages_to_bottom.call({});
	assert.equal(container.scrollTop, 1600);
	container.scrollHeight = 2400;
	container.scrollTop = 140;
	await actions.load_older_chat_messages.call({ chat_before_cursor: 20 });
	assert.equal(container.scrollTop, 940);
	container.scrollHeight = 1000;
	container.clientHeight = 300;
	container.scrollTop = 676;
	assert.equal(actions.chat_messages_are_at_bottom.call({}), true);
	container.scrollTop = 675;
	assert.equal(actions.chat_messages_are_at_bottom.call({}), false);
});

test('moves conversation actions behind the participant header and confirms them', async () => {
	const { main, templates, language } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);
	const chat_header = chat_view.slice(chat_view.indexOf('mp-chat-header'), chat_view.indexOf('mp-chat-messages'));

	assert.match(chat_header, /class="mp-chat-participant"[^>]*@click="state\.show_chat_actions_modal\(\)"/);
	assert.doesNotMatch(chat_header, /mp-chat-header-actions|state\.toggle_chat_block|state\.delete_chat_conversation/);
	assert.match(templates, /template-mp-chat-actions-modal/);
	assert.match(templates, /state\.show_chat_block_confirmation\(\)/);
	assert.match(templates, /state\.show_chat_delete_confirmation\(\)/);
	assert.match(templates, /template-mp-chat-block-confirm-modal/);
	assert.match(templates, /template-mp-chat-delete-confirm-modal/);
	assert.match(main, /queue_modal\(conversation\.participant\.display_name, 'chat-actions-modal'/);
	assert.match(main, /queue_modal\(this\.get_chat_block_label\(\), 'chat-block-confirm-modal'/);
	assert.match(main, /queue_modal\('MOD_MP_CHAT_DELETE_CONVERSATION', 'chat-delete-confirm-modal'/);
	assert.match(main, /api_post\('\/api\/chat\/block'/);
	assert.match(main, /api_post\('\/api\/chat\/conversations\/delete'/);
	assert.equal(language.MOD_MP_CHAT_DELETE_CONFIRM_TITLE, 'Delete this conversation?');
});

test('shows the active translation language and applies changed languages separately', async () => {
	const { templates, style } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);
	const chat_header = chat_view.slice(chat_view.indexOf('<div class="block-header block-header-default mp-chat-header">'), chat_view.indexOf('mp-chat-messages'));
	const translation_modal = templates.slice(
		templates.indexOf('<template id="template-mp-chat-translation-modal">'),
		templates.indexOf('<template id="template-mp-chat-message-delete-confirm-modal">')
	);

	assert.match(chat_header, /<div class="mp-chat-buttons">[\s\S]*class="btn btn-sm btn-secondary"[\s\S]*aria-haspopup="dialog" :aria-label="getLangString\('MOD_MP_CHAT_TRANSLATION_TITLE'\)" class="btn btn-sm btn-primary mp-translation-button"/);
	assert.doesNotMatch(chat_header, /aria-label="Automatic Translation"/);
	assert.match(chat_header, /:aria-pressed="state\.is_chat_translation_enabled\(\)"/);
	assert.match(style, /\.mp-chat-buttons\s*\{[\s\S]*display: flex;[\s\S]*gap: 12px;/);
	assert.match(style, /\.mp-translation-button\s*\{[\s\S]*padding: 0px 6px;[\s\S]*font-size: 26px;[\s\S]*line-height: 16px;/);
	assert.match(translation_modal, /<div class="mp-modal-text" v-show="state\.is_chat_translation_enabled\(\)"><mp-lang-string-f lang-id="MOD_MP_CHAT_TRANSLATION_STATUS" :lang-arg-1="state\.get_language_name\(state\.get_chat_translation_language\(\)\)"><\/mp-lang-string-f><\/div>/);
	assert.match(translation_modal, /autofocus[^>]*state\.is_chat_translation_language_changed\(\)/);
	assert.match(translation_modal, /@click="state\.save_chat_translation\(\)"/);
	assert.match(translation_modal, /:lang-id="state\.get_chat_translation_action_lang_id\(\)"/);
	assert.match(translation_modal, /v-show="state\.is_chat_translation_enabled\(\) && state\.is_chat_translation_language_changed\(\)"[\s\S]*MOD_MP_CHAT_TRANSLATION_DISABLE/);
	assert.doesNotMatch(translation_modal, /v-if=/);
	assert.equal((translation_modal.match(/@click="state\.set_chat_translation_enabled/g) ?? []).length, 1);
});

test('opens message actions from timestamps with copy and confirmed deletion', async () => {
	const { main, templates, style, language } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);

	assert.match(chat_view, /class="mp-chat-message-timestamp"[^>]*@click="state\.show_chat_message_actions\(message\)"/);
	assert.doesNotMatch(chat_view, /class="[^\"]*mp-chat-message-delete/);
	assert.match(templates, /template-mp-chat-message-actions-modal/);
	assert.match(templates, /state\.copy_chat_message\(\)/);
	assert.match(templates, /state\.show_chat_message_delete_confirmation\(\)/);
	assert.match(templates, /template-mp-chat-message-delete-confirm-modal/);
	assert.match(main, /selected_chat_message: null/);
	assert.match(main, /queue_modal\('MOD_MP_CHAT_MESSAGE_ACTIONS', 'chat-message-actions-modal'/);
	assert.match(main, /queue_modal\('MOD_MP_CHAT_DELETE_MESSAGE_CONFIRM_TITLE', 'chat-message-delete-confirm-modal'/);
	assert.match(main, /clipboard\.writeText\(this\.get_chat_plain_content\(message\)\)/);
	assert.match(main, /api_post\('\/api\/chat\/messages\/delete'/);
	assert.doesNotMatch(style, /\.mp-chat-message-content\s*\{[^}]*margin-top/);
	assert.match(style, /\.mp-chat-message-timestamp[\s\S]*cursor: pointer/);
	assert.equal(language.MOD_MP_CHAT_COPY, 'Copy');
	assert.equal(language.MOD_MP_CHAT_DELETE_MESSAGE_CONFIRM_TITLE, 'Delete this Message?');
});

test('only offers manual translation when a message has an alternate translation', async () => {
	const { templates } = await sources();
	const actions_modal = templates.slice(
		templates.indexOf('<template id="template-mp-chat-message-actions-modal">'),
		templates.indexOf('<template id="template-mp-chat-translation-modal">')
	);
	const actions = install_chat_actions({ state: {}, document: null });
	const context = Object.assign({}, actions);

	assert.equal(context.has_chat_message_translations({ translations: { 'zh-CN': '你好' } }), true);
	assert.equal(context.has_chat_message_translations({ translations: { en: '' } }), false);
	assert.equal(context.has_chat_message_translations({ translations: {} }), false);
	assert.equal(context.has_chat_message_translations({}), false);
	assert.match(actions_modal, /state\.has_chat_message_translations\(state\.selected_chat_message\)[\s\S]*state\.selected_chat_message\?\.sender_id !== state\.chat_client_id/);
});

test('keeps translation client-only, per conversation, and never translates the viewer own Messages', () => {
	const writes = [];
	const reads = [];
	let clock = 1000;
	const state = {
		chat_client_id: 7,
		selected_chat_conversation: { conversation_kind: 'global', conversation_id: 1 },
		chat_translation_preferences: {},
		chat_translation_language_input: 'zh-CN'
	};
	const actions = install_chat_actions({
		state,
		document: null,
		get_chat_conversation_key: conversation => `${conversation.conversation_kind}:${conversation.conversation_id}`,
		getLangString: key => key === 'MOD_MP_CHAT_TRANSLATING' ? 'Translating…' : key,
		get_instance_storage_item: key => {
			reads.push(key);
			return {
				'global:1': 'zh-CN',
				'global:2': 'unsupported',
			};
		},
		set_instance_storage_item: (key, value) => writes.push([key, structuredClone(value)]),
		refresh_chat_messages: async () => {},
		now: () => clock
	});
	const context = Object.assign(state, actions, { close_modal() {} });
	assert.deepEqual(reads, []);
	context.load_chat_translation_preferences();
	assert.deepEqual(reads, ['chat_translation_preferences']);
	assert.deepEqual(context.chat_translation_preferences, { 'global:1': 'zh-CN' });
	context.set_chat_translation_enabled(true);
	assert.deepEqual(writes, [['chat_translation_preferences', { 'global:1': 'zh-CN' }]]);
	assert.equal(context.get_chat_translation_language(), 'zh-CN');
	assert.equal(context.is_chat_translation_language_changed(), false);
	assert.equal(context.get_chat_translation_action_lang_id(), 'MOD_MP_CHAT_TRANSLATION_DISABLE');
	assert.equal(context.get_chat_message_content({ sender_id: 8, content: 'Hello',
		translations: { 'zh-CN': '你好' }, translation_status: 'complete', created_at: 0 }), '你好');
	assert.equal(context.get_chat_message_content({ sender_id: 7, content: 'My words',
		translations: { 'zh-CN': '我的话' }, translation_status: 'complete', created_at: 0 }), 'My words');
	assert.equal(context.get_chat_message_content({ sender_id: 8, content: 'Waiting', translations: {},
		translation_status: 'queued' }), 'Translating…');
	const fallback = { sender_id: 8, content: 'Fallback', translations: {}, translation_status: 'queued' };
	assert.equal(context.get_chat_message_content(fallback), 'Translating…');
	assert.equal(context.is_chat_message_translation_pending(fallback), true);
	assert.equal(context.is_chat_message_translation_waiting(fallback), true);
	clock += 10_001;
	assert.equal(context.get_chat_message_content(fallback), 'Fallback');
	assert.equal(context.is_chat_message_translation_pending(fallback), true);
	assert.equal(context.is_chat_message_translation_waiting(fallback), false);
	assert.equal(context.is_chat_message_translation_waiting({ sender_id: 7, content: 'Mine',
		translations: {}, translation_status: 'queued', translation_observed_at: 1000 }), false);
	context.chat_translation_language_input = 'en';
	assert.equal(context.is_chat_translation_language_changed(), true);
	assert.equal(context.get_chat_translation_action_lang_id(), 'MOD_MP_CHAT_TRANSLATION_APPLY');
	context.save_chat_translation();
	assert.equal(context.get_chat_translation_language(), 'en');
	assert.equal(context.is_chat_translation_language_changed(), false);
	assert.deepEqual(writes.at(-1), ['chat_translation_preferences', { 'global:1': 'en' }]);
	context.selected_chat_conversation = { conversation_kind: 'polls', conversation_id: 1 };
	context.chat_translation_language_input = 'zh-CN';
	context.set_chat_translation_enabled(true);
	assert.equal(context.get_chat_message_content({ sender_id: 8, content: 'Question',
		translations: { 'zh-CN': '问题' }, translation_status: 'complete' }), '问题');
	assert.equal(context.get_chat_message_content({ sender_id: 8, content: 'Option',
		translations: { 'zh-CN': '选项' }, translation_status: 'complete' }), '选项');
});

test('defaults zh-CN Global and Guild Chat translation on while preserving explicit opt-out and English', () => {
	const previous_language = globalThis.setLang;
	globalThis.setLang = 'zh-CN';
	try {
		const writes = [];
		const state = {
			chat_client_id: 7,
			selected_chat_conversation: { conversation_kind: 'global', conversation_id: 1 },
			chat_translation_preferences: {},
			chat_translation_language_input: 'zh-CN'
		};
		const actions = install_chat_actions({
			state,
			document: null,
			get_chat_conversation_key: conversation => `${conversation.conversation_kind}:${conversation.conversation_id}`,
			get_instance_storage_item: () => ({ 'global:2': false, 'guild:2': 'en', 'global:3': 'unsupported' }),
			set_instance_storage_item: (key, value) => writes.push([key, structuredClone(value)]),
			refresh_chat_messages: async () => {}
		});
		const context = Object.assign(state, actions, { close_modal() {} });
		const translated_message = { sender_id: 8, content: 'こんにちは', translations: { en: 'Hello', 'zh-CN': '你好' } };

		context.load_chat_translation_preferences();
		assert.deepEqual(context.chat_translation_preferences, { 'global:2': false, 'guild:2': 'en' });
		assert.equal(context.is_chat_translation_enabled(), true);
		assert.equal(context.get_chat_message_content(translated_message), '你好');

		context.selected_chat_conversation = { conversation_kind: 'guild', conversation_id: 1 };
		assert.equal(context.is_chat_translation_enabled(), true);
		assert.equal(context.get_chat_message_content(translated_message), '你好');

		context.selected_chat_conversation = { conversation_kind: 'private', conversation_id: 1 };
		assert.equal(context.is_chat_translation_enabled(), false);

		context.selected_chat_conversation = { conversation_kind: 'global', conversation_id: 2 };
		assert.equal(context.is_chat_translation_enabled(), false);

		context.selected_chat_conversation = { conversation_kind: 'guild', conversation_id: 2 };
		assert.equal(context.is_chat_translation_enabled(), true);
		assert.equal(context.get_chat_message_content(translated_message), 'Hello');

		context.selected_chat_conversation = { conversation_kind: 'global', conversation_id: 1 };
		context.set_chat_translation_enabled(false);
		assert.equal(context.is_chat_translation_enabled(), false);
		assert.deepEqual(writes.at(-1), ['chat_translation_preferences', {
			'global:1': false, 'global:2': false, 'guild:2': 'en'
		}]);

		context.chat_translation_language_input = 'en';
		context.set_chat_translation_enabled(true);
		assert.equal(context.is_chat_translation_enabled(), true);
		assert.equal(context.get_chat_message_content(translated_message), 'Hello');
		assert.deepEqual(writes.at(-1), ['chat_translation_preferences', {
			'global:1': 'en', 'global:2': false, 'guild:2': 'en'
		}]);

		globalThis.setLang = 'en';
		context.selected_chat_conversation = { conversation_kind: 'global', conversation_id: 3 };
		assert.equal(context.is_chat_translation_enabled(), false);
	} finally {
		if (previous_language === undefined)
			delete globalThis.setLang;
		else
			globalThis.setLang = previous_language;
	}
});

test('renders the sender avatar for every Chat message, including Global and Support messages', async () => {
	const { main, templates, style } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);

	assert.match(chat_view, /class="mp-chat-message-author"[\s\S]*class="mp-chat-message-avatar"[\s\S]*state\.get_chat_message_icon\(message\)[\s\S]*message\.sender\.display_name/);
	assert.match(main, /get_chat_message_icon\(message\)[\s\S]*SUPPORT_TEAM_ICON_ASSETS/);
	assert.match(style, /\.mp-chat-message-author\s*\{[\s\S]*display: flex[\s\S]*align-items: center[\s\S]*gap: 2px/);
	assert.match(style, /\.mp-chat-message-avatar\s*\{[\s\S]*margin: 0 2px 0 0;[\s\S]*width: 20px;[\s\S]*height: 20px;/);
});

test('styles Chat messages by viewer-relative alignment and isolates the conversation panel', async () => {
	const { templates, style } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);

	assert.match(chat_view, /<div class="mp-chat-conversation-view" v-else>/);
	assert.doesNotMatch(chat_view, /class="[^"]*block[^"]*mp-chat-conversation-view/);
	assert.match(style, /\.mp-chat-message-meta\s*\{[\s\S]*gap: 1rem;[\s\S]*justify-content: start;/);
	assert.match(style, /\.mp-chat-message-own \.mp-chat-message-meta\s*\{[\s\S]*justify-content: end;/);
	assert.match(style, /\.mp-chat-message-own \.mp-chat-message-content\s*\{[\s\S]*margin-left: auto;/);
	assert.match(style, /\.mp-chat-message-author\s*\{[\s\S]*color: #fffe;/);
	assert.match(style, /\.mp-chat-conversation-view\s*\{[\s\S]*color: white;[\s\S]*border: 5px solid #232a35;[\s\S]*border-radius: \.5rem;[\s\S]*backdrop-filter: blur\(8px\);[\s\S]*background-color: #0004;/);
});

test('renders the curated reaction picker and applies aggregate reaction toggles', async () => {
	const { main, templates, style } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);
	const requests = [];
	let current_time = 1000;
	const actions = install_chat_actions({
		api_post: async (endpoint, body) => {
			requests.push({ endpoint, body });
			return { success: true, reaction_revision: requests.length,
				reactions: [{ reaction: body.reaction, count: 2, reacted: body.reacted }] };
		},
		getLangString: id => id,
		log() {},
		now: () => current_time
	});
	const message = { message_id: 42, reactions: [{ reaction: '🔥', count: 1, reacted: false }] };
	const state = {
		selected_chat_conversation: { conversation_kind: 'guild', conversation_id: 9 },
		chat_reaction_picker_message_id: null,
		chat_reaction_picker_style: {},
		chat_reaction_pending: {},
		chat_reaction_throttle_until: {},
		chat_messages: [message],
		chat_error: ''
	};

	await actions.toggle_chat_reaction_picker.call(state, message);
	assert.equal(state.chat_reaction_picker_message_id, 42);
	await actions.toggle_chat_reaction.call(state, message, '🔥');
	await actions.toggle_chat_reaction.call(state, message, '🔥');
	current_time += 1000;
	await actions.toggle_chat_reaction.call(state, message, '🔥');
	assert.deepEqual(requests, [{ endpoint: '/api/chat/messages/reaction', body: {
		conversation_kind: 'guild', conversation_id: 9, message_id: 42, reaction: '🔥', reacted: true
	} }, { endpoint: '/api/chat/messages/reaction', body: {
		conversation_kind: 'guild', conversation_id: 9, message_id: 42, reaction: '🔥', reacted: false
	} }]);
	assert.deepEqual(message.reactions, [{ reaction: '🔥', count: 2, reacted: false }]);
	assert.equal(message.reaction_revision, 2);
	assert.equal(state.chat_reaction_picker_message_id, null);

	assert.match(chat_view, /state\.chat_reaction_choices/);
	assert.match(chat_view, />☻<span aria-hidden="true">\+<\/span>/);
	assert.ok(chat_view.indexOf('class="mp-chat-reaction-picker"') > chat_view.indexOf('class="block-content mp-chat-compose"'));
	assert.match(chat_view, /v-for="summary in message\.reactions"/);
	assert.match(chat_view, /'mp-chat-reaction-reacted': summary\.reacted/);
	assert.match(chat_view, /state\.toggle_chat_reaction\(message, summary\.reaction\)/);
	assert.doesNotMatch(chat_view, /dropdown/);
	assert.match(style, /\.mp-chat-reaction-picker\s*\{[\s\S]*position: fixed;[\s\S]*z-index: 10000;[\s\S]*grid-template-columns: repeat\(6, 32px\);[\s\S]*padding: 4px;/);
	assert.match(style, /\.mp-chat-reaction-picker button\s*\{[\s\S]*width: 32px;[\s\S]*height: 32px;[\s\S]*border-radius: 10px;[\s\S]*font-size: 18px;/);
	assert.match(style, /\.mp-chat-reactions-empty\s*\{[\s\S]*position: absolute;[\s\S]*right: -5px;[\s\S]*bottom: -8px/);
	assert.match(style, /\.mp-chat-reactions\s*\{[\s\S]*margin: 2px 0 0 8px;/);
	assert.match(style, /\.mp-chat-reactions-empty \.mp-chat-reaction-add\s*\{[\s\S]*position: relative;[\s\S]*font-size: 10px;[\s\S]*padding: 0 2px;/);
	assert.match(style, /\.mp-chat-reactions-empty \.mp-chat-reaction-add::before\s*\{[\s\S]*content: "";[\s\S]*position: absolute;[\s\S]*inset: -8px;/);
	assert.doesNotMatch(style.slice(style.indexOf('.mp-chat-reaction-summary,'), style.indexOf('.mp-chat-reaction-summary:hover')), /min-height/);
	assert.match(style, /\.mp-chat-reaction-reacted\s*\{[\s\S]*background: rgba\(30, 112, 164, \.55\)/);
	assert.match(main, /document\.addEventListener\('click',[\s\S]*\.mp-chat-reaction-add, \.mp-chat-reaction-picker[\s\S]*close_chat_reaction_picker\(\)/);
	assert.match(main, /reaction_throttle_ms = 1000;[\s\S]*chat_reaction_throttle_until\[pending_key\]/);
});

test('opens the sender member-info modal from Chat message authors', async () => {
	const { main, templates, style } = await sources();
	const chat_view = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);

	assert.match(chat_view, /class="mp-chat-message-author"[^>]*@click="state\.show_chat_message_member\(message\)"/);
	assert.match(chat_view, /class="mp-chat-message-timestamp"[^>]*@click="state\.show_chat_message_actions\(message\)"/);
	assert.match(templates, /class="btn btn-primary" v-show="state\.selected_guild_member\.can_start_chat !== false"/);
	assert.match(main, /show_chat_message_member\(message\)[\s\S]*this\.guild_members[\s\S]*this\.shadowed_members[\s\S]*find\(entry => entry\.client_id === sender_id\)[\s\S]*this\.show_member_actions\(/);
	assert.match(style, /\.mp-chat-message-author:hover,[\s\S]*\.mp-chat-message-author:focus-visible/);
});

test('loads normal profile restrictions for message authors outside the current Guild', async () => {
	const actions = install_chat_actions({
		api_get: async () => ({ can_start_chat: true, skills_visible: false, guild_name: 'Other Guild' }),
		log() {}
	});
	let selected_member = null;
	const state = {
		guild_members: [{ client_id: 12 }],
		shadowed_members: [],
		selected_chat_conversation: { conversation_kind: 'global', conversation_id: 1 },
		show_member_actions(member) {
			selected_member = member;
		}
	};

	await actions.show_chat_message_member.call(state, {
		sender_id: 179,
		sender: { display_name: 'Global Sender', icon_id: 'melvorD:Chicken' }
	});
	assert.equal(selected_member.can_start_chat, true);
	assert.equal(selected_member.skills_visible, false);
	assert.equal(selected_member.guild_name, 'Other Guild');
	assert.equal(selected_member.profile_source, 'chat');

	await actions.show_chat_message_member.call(state, {
		sender_id: 12,
		sender: { display_name: 'Guild Member', icon_id: 'melvorD:Chicken' }
	});
	assert.equal(selected_member.profile_source, undefined);
});

test('keeps reopening an established Private conversation available after a Guild change', async () => {
	const actions = install_chat_actions({ api_get: async () => ({ can_start_chat: true }), log() {} });
	let selected_member = null;
	const state = {
		guild_members: [],
		selected_chat_conversation: {
			conversation_kind: 'private',
			conversation_id: 42,
			participant: { client_id: 179 }
		},
		show_member_actions(member) {
			selected_member = member;
		}
	};

	await actions.show_chat_message_member.call(state, {
		sender_id: 179,
		sender: { display_name: 'Former Guildmate', icon_id: 'melvorD:Chicken' }
	});
	assert.equal(selected_member.can_start_chat, true);
});

test('disables Message capacity while preserving its dormant UI and rollback compatibility', async () => {
	const { main, templates, style, language } = await sources();
	const chat_template = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);

	assert.match(main, /chat_pending_send/);
	assert.match(main, /client_id: conversation\.participant\.client_id/);
	assert.match(main, /conversation\.conversation_id = res\.message\.conversation_id/);
	assert.match(main, /crypto\.randomUUID\(\)/);
	assert.match(main, /idempotency_key/);
	assert.match(main, /api_post\('\/api\/chat\/privacy'/);
	assert.match(main, /api_post\('\/api\/chat\/block'/);
	assert.match(main, /api_post\('\/api\/chat\/messages\/delete'/);
	assert.match(main, /api_post\('\/api\/chat\/conversations\/delete'/);
	assert.match(chat_template, /maxlength="1000"/);
	assert.match(chat_template, /<mp-chat-message-body :parts="state\.get_chat_message_document\(message\)"/);
	assert.doesNotMatch(chat_template, /v-html|innerHTML/);
	assert.doesNotMatch(chat_template, /chat_draft\.length/);
	assert.match(main, /chat_budget_enabled: true/);
	assert.match(main, /!this\.chat_budget_enabled \|\| this\.chat_budget\.credits > 0/);
	assert.match(main, /state\.chat_budget_enabled = res\.budget_enabled !== false/);
	assert.match(main, /state\.chat_budget_enabled = response\.chat\?\.budget_enabled !== false/);
	assert.match(chat_template, /class="mp-chat-budget"[^>]*v-if="[^"]*state\.chat_budget_enabled"[^>]*@click="state\.show_chat_budget_modal\(\)"[^>]*aria-haspopup="dialog"/);
	assert.match(style, /\.mp-chat-compose\s*\{[^}]*padding-bottom: 16px/);
	assert.match(style, /\.mp-chat-compose-actions\s*\{[^}]*justify-content: flex-end/);
	assert.match(style, /\.mp-chat-budget\s*\{[^}]*margin-right: auto/);
	assert.match(chat_template, /class="mp-chat-budget"[\s\S]*MOD_MP_CHAT_BUDGET[\s\S]*get_item_icon\('melvorD:Message_In_A_Bottle'\)[\s\S]*state\.chat_budget\.credits < state\.chat_budget\.maximum/);
	assert.match(templates, /template-mp-chat-budget-info-modal/);
	assert.match(templates, /MOD_MP_CHAT_BUDGET_LEVEL_99/);
	assert.match(templates, /MOD_MP_CHAT_BUDGET_LEVEL_120/);
	assert.match(main, /queue_modal\('MOD_MP_CHAT_BUDGET_INFO_TITLE', 'chat-budget-info-modal', this\.get_item_icon\('melvorD:Message_In_A_Bottle'\)/);
	assert.match(templates, /state\.set_messaging_enabled\(\$event\)/);
	assert.match(style, /\.mp-chat-message-content[\s\S]*white-space: pre-wrap/);
	assert.match(style, /\.mp-chat-budget:hover,[\s\S]*\.mp-chat-budget:focus-visible/);
	assert.equal(language.MOD_MP_CHAT_BUDGET, '%s / %s');
	assert.equal(language.MOD_MP_CHAT_BUDGET_INFO_TITLE, 'Message capacity');
	assert.match(language.MOD_MP_CHAT_BUDGET_LEVEL_99, /Raise your maximum by 1/);
	assert.match(language.MOD_MP_CHAT_BUDGET_LEVEL_120, /Recover 2 seconds faster/);
	assert.doesNotMatch(chat_template, /Message credits/i);
	assert.doesNotMatch(language.MOD_MP_CHAT_BUDGET_EMPTY, /credit/i);
	assert.equal(language.MOD_MP_CHAT_RECIPIENT_UNAVAILABLE, 'This player is unavailable for Chat.');
});

test('sends Chat on desktop Enter while preserving mobile and multiline input', async () => {
	const { main, templates } = await sources();
	const chat_template = templates.slice(
		templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-profile-modal">')
	);
	const keydown_handler = main.slice(main.indexOf('handle_chat_keydown(event)'), main.indexOf('async send_chat_message(event)'));

	assert.match(main, /state\.handle_chat_keydown\(event\)/);
	assert.match(keydown_handler, /event\.key !== 'Enter'/);
	assert.match(keydown_handler, /event\.isComposing/);
	assert.match(keydown_handler, /event\.shiftKey/);
	assert.match(keydown_handler, /nativeManager\.isMobile/);
	assert.match(keydown_handler, /event\.preventDefault\(\)/);
	assert.match(keydown_handler, /void this\.send_chat_message\(event\)/);
});

test('keeps drafts and send completion scoped to the originating conversation', async () => {
	const { main } = await sources();
	const send = main.slice(main.indexOf('async send_chat_message(event)'),
		main.indexOf('async delete_chat_message(event)'));

	assert.match(main, /function get_chat_conversation_key\(conversation\)/);
	assert.match(main, /chat_drafts: \{\}/);
	assert.match(main, /chat_pending_sends: \{\}/);
	assert.match(main, /chat_sending_conversations: \{\}/);
	assert.match(send, /const conversation_key = get_chat_conversation_key\(conversation\)/);
	assert.match(send, /const view_generation = runtime\.chat_view_generation/);
	assert.match(send, /this\.chat_pending_sends\[conversation_key\]/);
	assert.match(send, /view_generation === runtime\.chat_view_generation/);
	assert.match(send, /get_chat_conversation_key\(this\.selected_chat_conversation\) === conversation_key/);
	assert.match(send, /if \(is_current_view\(\) && !this\.chat_messages\.some/);
	assert.match(send, /this\.chat_drafts\[conversation_key\] = ''/);
	assert.doesNotMatch(send, /this\.chat_draft = ''/);
});

test('keeps Chat identity state independent from current Guild membership', async () => {
	const { main, templates } = await sources();

	assert.match(main, /state\.chat_client_id = res\.client_id/);
	assert.match(main, /state\.chat_client_id = response\.chat\?\.client_id/);
	assert.match(templates, /message\.sender_id === state\.chat_client_id/);
	assert.doesNotMatch(
		main.slice(main.indexOf('async function refresh_chat_page'), main.indexOf('function stop_chat_polling')),
		/is_guild_member|guild_state/
	);
});

test('ignores stale conversation responses after a thread switch or close', async () => {
	const { main } = await sources();

	assert.match(main, /let chat_view_generation = 0/);
	assert.match(main, /const view_generation = \+\+chat_view_generation/);
	assert.match(main, /if \(view_generation !== chat_view_generation \|\|[\s\S]*selected_chat_conversation\?\.conversation_id !== conversation\.conversation_id \|\|[\s\S]*selected_chat_conversation\?\.support_team_id !== conversation\.support_team_id\)/);
	assert.match(main, /state\.selected_chat_conversation\?\.conversation_id !== conversation_id/);
	assert.match(main, /chat_view_generation\+\+;\n\s*this\.selected_chat_conversation = null/);
});

test('does not poll an empty or background Chat inbox and refreshes visible metadata only for changed events', async () => {
	const { main } = await sources();
	const message_refresh = main.slice(main.indexOf('async function refresh_chat_messages'),
		main.indexOf('async function refresh_chat_page'));
	const polling = main.slice(main.indexOf('async function poll_chat_messages'), main.indexOf('async function get_friends'));
	const scheduler = main.slice(main.indexOf('function start_chat_polling'), main.indexOf('async function poll_chat_messages'));
	const events = main.slice(main.indexOf('async function get_client_events_request'), main.indexOf('function start_client_event_polling'));

	assert.match(scheduler, /!state\.selected_chat_conversation\?\.conversation_id/);
	assert.match(message_refresh, /kind === 'private' && conversation\.conversation_id === null[\s\S]*return/);
	assert.match(message_refresh, /conversation_kind=' \+ kind[\s\S]*support_team_id/);
	assert.match(scheduler, /!polling\.is_foreground\(document\)/);
	assert.doesNotMatch(polling, /refresh_chat_state\(\)/);
	assert.match(polling, /state\.is_chat_message_translation_pending\(message\)/);
	assert.match(polling, /state\.selected_chat_conversation && polling\.is_foreground\(document\)/);
	assert.match(events, /if \(res\.unchanged === true\) \{\s*void economy_command_journal\?\.recover\(\);\s*return res;[\s\S]*if \(chat_page_visible \|\| has_muted_chats\)\s*await refresh_chat_conversations\(\)/);
});

test('renders Support Chat identity, alignment, virtual welcomes, and restricted actions', async () => {
	const { main, templates } = await sources();
	const chat = templates.slice(templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-chat-budget-info-modal">'));
	assert.match(main, /const conversation_kind = conversation\.conversation_kind \?\? 'private'/);
	assert.match(main, /conversation_kind,/);
	assert.match(main, /support_team_id: conversation\.support_team_id/);
	assert.match(main, /conversation_kind=' \+ kind/);
	assert.match(main, /selected_chat_conversation\?\.conversation_kind \?\? 'private'\) !== 'private'/);
	assert.match(chat, /message\.sent_by_viewer === true/);
	assert.match(chat, /conversation_kind \|\| 'private'\) === 'private'/);
	assert.match(chat, /state\.get_chat_participant_icon/);
	assert.match(main, /selected_chat_conversation\?\.support_team_id !== conversation\.support_team_id/);
	assert.match(chat, /support_team_id \|\| ''/);
	assert.match(main, /multiplayer: 'multiplayer\.svg'/);
	assert.match(main, /sae_support: 'sae_support\.png'/);
	assert.match(main, /conversation\?\.conversation_kind === 'support' && conversation\.viewer_side === 'player'/);
	assert.match(main, /message\.sender_id === null[\s\S]*message\.translations\?\.\[localized_welcome_language\(\)\]/);
	assert.match(main, /asset === undefined \? 'assets\/media\/main\/question\.png'/);
});

test('gates first Support replies behind localized prompt choices without losing drafts', async () => {
	const { main, templates, style, language } = await sources();
	const chat_view = templates.slice(templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-chat-budget-info-modal">'));
	const support_prompts = main.slice(main.indexOf('get show_chat_support_prompts()'), main.indexOf('get personal_chat_conversations()'));

	assert.match(support_prompts, /conversation\?\.conversation_kind === 'support'/);
	assert.match(support_prompts, /conversation\.viewer_side === 'player'/);
	assert.match(support_prompts, /conversation\.conversation_id === null/);
	assert.match(support_prompts, /this\.chat_draft\.trim\(\)\.length === 0/);
	assert.match(main, /select_chat_support_prompt\(lang_id\)/);
	assert.match(main, /if \(!this\.show_chat_support_prompts\)/);
	assert.match(main, /this\.chat_draft = getLangString\(lang_id\)/);
	assert.match(chat_view, /state\.show_chat_support_prompts/);
	assert.match(chat_view, /state\.select_chat_support_prompt\('MOD_MP_CHAT_SUPPORT_PROBLEM'\)/);
	assert.match(chat_view, /state\.select_chat_support_prompt\('MOD_MP_CHAT_SUPPORT_SUGGESTION'\)/);
	assert.match(chat_view, /MOD_MP_CHAT_SUPPORT_PROMPTS/);
	assert.match(chat_view, /MOD_MP_CHAT_SUPPORT_PROBLEM/);
	assert.match(chat_view, /MOD_MP_CHAT_SUPPORT_SUGGESTION/);
	assert.match(style, /\.mp-chat-support-prompt-actions[\s\S]*display: flex/);
	assert.match(style, /@media \(max-width: 767\.98px\)[\s\S]*\.mp-chat-support-prompt-actions[\s\S]*flex-direction: column/);
	assert.equal(language.MOD_MP_CHAT_SUPPORT_PROMPTS, 'What would you like to send?');
	assert.equal(language.MOD_MP_CHAT_SUPPORT_PROBLEM, 'I have a Problem');
	assert.equal(language.MOD_MP_CHAT_SUPPORT_SUGGESTION, 'I have a Suggestion');
});

test('retains an older-history cursor after deleting the visible page', async () => {
	const { main } = await sources();

	assert.match(main, /chat_before_cursor: null/);
	assert.match(main, /if \(this\.chat_before_cursor === null\)/);
	assert.match(main, /'&before=' \+ this\.chat_before_cursor/);
	assert.match(main, /state\.chat_before_cursor = res\.messages\[0\]\.message_id/);
});


test('per-chat notifications default on, persist isolated preferences, and throttle without API calls or modals', () => {
	let clock = 1000;
	const storage = new Map();
	const timers = [];
	const notices = [];
	let nav_updates = 0;
	const conversations = [
		{ conversation_kind: 'private', conversation_id: 1, unread_count: 3 },
		{ conversation_kind: 'guild', conversation_id: 1, unread_count: 4 },
		{ conversation_kind: 'support', conversation_id: 1, unread_count: 2 },
		{ conversation_kind: 'global', conversation_id: 1, unread_count: 5 },
		{ conversation_kind: 'poll', conversation_id: 1, unread_count: 1 },
	];
	const state = { chat_conversations: conversations, selected_chat_conversation: conversations[0] };
	Object.assign(state, install_chat_actions({
		state, document: {}, now: () => clock,
		get_chat_conversation_key: conversation => conversation
			? conversation.conversation_kind + ':' + conversation.conversation_id : null,
		get_instance_storage_item: key => storage.get(key),
		set_instance_storage_item: (key, value) => storage.set(key, value),
		schedule_timeout: (callback, delay) => timers.push({ callback, delay }),
		update_chat_nav: () => nav_updates++,
		notify: (...args) => notices.push(args),
		api_get: () => assert.fail('notification toggle must be local'),
		api_post: () => assert.fail('notification toggle must be local'),
		queue_modal: () => assert.fail('notification toggle must not open a modal'),
	}));
	state.load_chat_notification_preferences();
	assert.equal(state.is_chat_notifications_enabled(), true);
	assert.equal(state.get_chat_notification_unread(), 15);
	state.toggle_chat_notifications();
	assert.equal(state.is_chat_notifications_enabled(), false);
	assert.equal(state.chat_unread, 12);
	assert.equal(conversations[0].unread_count, 3);
	assert.equal(state.chat_notifications_busy, true);
	assert.equal(timers[0].delay, 2000);
	assert.equal(notices[0][0], 'MOD_MP_CHAT_NOTIFICATIONS_DISABLED');
	state.toggle_chat_notifications();
	assert.equal(notices.length, 1);
	state.selected_chat_conversation = conversations[1];
	assert.equal(state.is_chat_notifications_enabled(), true);
	state.toggle_chat_notifications();
	assert.equal(notices.length, 1);
	clock += 2000;
	timers.shift().callback();
	state.selected_chat_conversation = conversations[0];
	state.chat_notification_preferences = {};
	state.load_chat_notification_preferences();
	assert.equal(state.is_chat_notifications_enabled(), false);
	state.toggle_chat_notifications();
	assert.equal(state.is_chat_notifications_enabled(), true);
	assert.equal(state.chat_unread, 15);
	assert.deepEqual(storage.get('chat_notification_preferences'), {});
	assert.equal(notices[1][0], 'MOD_MP_CHAT_NOTIFICATIONS_ENABLED');
	assert.equal(nav_updates, 2);
});

test('notification bell renders the current enabled state and locks while throttled', async () => {
	const { main, templates } = await sources();
	const bell = templates.split('\n').find(line => line.includes('mp-notifications-button'));
	assert.match(bell, /:aria-pressed="state.is_chat_notifications_enabled\(\)"/);
	assert.match(bell, /state.is_chat_notifications_enabled\(\) \? 'fa-bell' : 'fa-bell-slash'/);
	assert.match(bell, /:disabled="state.chat_notifications_busy"/);
	assert.doesNotMatch(bell, /aria-haspopup|modal/);
	assert.match(main, /apply_server_configuration\(\);\s*state.load_chat_notification_preferences\(\)/);
	assert.match(main, /if \(!has_muted_chats\)\s*state.chat_unread = res.chat_unread/);
	assert.match(main, /if \(chat_page_visible \|\| has_muted_chats\)\s*await refresh_chat_conversations/);
});
