import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function sources() {
	const [main, templates, style, data_text, language_text] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
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
	assert.equal(chat_page.sidebarItem.asideClass, 'mp-chat-nav');
	assert.equal(chat_page.sidebarItem.aside, '0');
	assert.match(templates, /template-mp-chat-page/);
	assert.match(templates, /state\.chat_unread/);
	assert.match(templates, /state\.open_chat_conversation\(conversation\)/);
	assert.match(templates, /state\.start_member_chat\(\$event\)/);
	assert.match(main, /api_post\('\/api\/chat\/conversations\/start'/);
	assert.match(main, /changePage\(game\.pages\.getObjectByID\('multiplayer:Chat'\)\)/);
	assert.match(main, /aside\.hidden = state\.chat_unread <= 0/);
	assert.match(style, /\.mp-chat-nav[\s\S]*background-color: #ff4545/);
	assert.equal(language.MOD_MP_MENU_VIEW_CHAT, 'Open Chat');
	assert.equal(language.MOD_MP_CHAT_INBOX, 'Conversations');
	assert.equal(language.MOD_MP_CHAT_INBOX_INFO, 'These stay with you across Guilds.');
});

test('implements jittered foreground conversation polling and cursor-based history', async () => {
	const { main, templates } = await sources();

	assert.match(main, /ctx\.loadModule\('polling\.mjs'\)/);
	assert.match(main, /on_page_toggle\('mp-chat-page', is_visible =>/);
	assert.match(main, /'&after=' \+ state\.chat_latest_message_id/);
	assert.match(main, /'&before=' \+ this\.chat_before_cursor/);
	assert.match(main, /poll_id !== chat_poll_id \|\| !chat_page_visible \|\| !polling\.is_foreground\(document\)/);
	assert.match(main, /polling\.chat_poll_delay\(\)/);
	assert.match(main, /if \(view_generation === chat_view_generation && state\.selected_chat_conversation\)/);
	assert.match(templates, /MOD_MP_CHAT_LOAD_OLDER/);
	assert.match(templates, /role="log" aria-live="polite"/);
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

test('does not poll an empty or background Chat inbox or refetch budget on each message poll', async () => {
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
	assert.match(events, /const previous_chat_unread = state\.chat_unread/);
	assert.match(events, /chat_page_visible && state\.chat_unread !== previous_chat_unread/);
	assert.match(events, /await refresh_chat_conversations\(\)/);
});

test('renders Support Chat identity, alignment, virtual welcomes, and restricted actions', async () => {
	const { main, templates } = await sources();
	const chat = templates.slice(templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-chat-budget-info-modal">'));
	assert.match(main, /conversation_kind: conversation\.conversation_kind \?\? 'private'/);
	assert.match(main, /support_team_id: conversation\.support_team_id/);
	assert.match(main, /conversation_kind=' \+ kind/);
	assert.match(main, /selected_chat_conversation\?\.conversation_kind === 'support'/);
	assert.match(chat, /message\.sent_by_viewer === true/);
	assert.match(chat, /conversation_kind !== 'support'/);
	assert.match(chat, /state\.get_chat_participant_icon/);
	assert.match(main, /selected_chat_conversation\?\.support_team_id !== conversation\.support_team_id/);
	assert.match(chat, /support_team_id \|\| ''/);
});

test('retains an older-history cursor after deleting the visible page', async () => {
	const { main } = await sources();

	assert.match(main, /chat_before_cursor: null/);
	assert.match(main, /if \(this\.chat_before_cursor === null\)/);
	assert.match(main, /'&before=' \+ this\.chat_before_cursor/);
	assert.match(main, /state\.chat_before_cursor = res\.messages\[0\]\.message_id/);
});
