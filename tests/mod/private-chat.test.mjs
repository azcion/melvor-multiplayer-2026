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
	assert.equal(language.MOD_MP_MENU_VIEW_CHAT, 'Open Chat');
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
	assert.match(main, /clipboard\.writeText\(message\.content\)/);
	assert.match(main, /api_post\('\/api\/chat\/messages\/delete'/);
	assert.doesNotMatch(style, /\.mp-chat-message-content\s*\{[^}]*margin-top/);
	assert.match(style, /\.mp-chat-message-timestamp[\s\S]*cursor: pointer/);
	assert.equal(language.MOD_MP_CHAT_COPY, 'Copy');
	assert.equal(language.MOD_MP_CHAT_DELETE_MESSAGE_CONFIRM_TITLE, 'Delete this Message?');
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
	assert.match(chat_template, /\{\{ message\.content \}\}/);
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

	assert.match(chat_template, /@keydown="state\.handle_chat_keydown\(\$event\)"/);
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
	assert.match(polling, /state\.selected_chat_conversation && polling\.is_foreground\(document\)/);
	assert.match(events, /if \(res\.unchanged === true\) \{\s*void economy_command_journal\?\.recover\(\);\s*return res;[\s\S]*if \(chat_page_visible\)\s*await refresh_chat_conversations\(\)/);
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
