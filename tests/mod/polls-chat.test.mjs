import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('wires quiet Polls below Global Chat with creator, voting, and discussion', async () => {
	const [main, actions, common, templates, style, language] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-chat.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-common.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse)
	]);
	assert.match(main, /POLLS_CAPABILITY = 'polls-v1'/);
	assert.match(main, /api\/polls\?capabilities=/);
	assert.match(common, /conversation_kind === 'polls'[\s\S]*assets\/polls-icon\.svg/);
	assert.match(common, /conversation\?\.conversation_kind === 'polls' \|\| conversation\?\.conversation_kind === 'poll-discussion'[\s\S]*assets\/polls-icon\.svg/);
	const global = templates.indexOf('state.global_chat_conversations');
	const polls = templates.indexOf('state.polls_chat_conversations');
	const guild = templates.indexOf('state.guild_chat_conversations');
	assert.ok(global >= 0 && polls > global && guild > polls);
	assert.match(templates, /class="mp-chat-conversations"[\s\S]*state\.polls_chat_conversations/);
	assert.doesNotMatch(templates, /class="mp-chat-conversations" v-if="state\.polls\.length > 0"/);
	const refresh_conversations = main.slice(main.indexOf('async function refresh_chat_conversations'), main.indexOf('function update_chat_nav'));
	assert.match(refresh_conversations, /const conversations = \[\.\.\.res\.conversations\];[\s\S]*conversations\.push\([\s\S]*state\.chat_conversations = conversations;/);
	assert.doesNotMatch(refresh_conversations, /state\.chat_conversations = res\.conversations/);
	assert.match(main, /get num_uninteracted_open_polls\(\) \{[\s\S]*return this\.polls\.filter\(poll => poll\.open === true && poll\.interacted !== true\)\.length;/);
	assert.match(templates, /<span class="badge badge-info" v-if="state\.num_uninteracted_open_polls > 0">\{\{ state\.num_uninteracted_open_polls \}\}<\/span>/);
	assert.doesNotMatch(main.slice(main.indexOf('get num_notifications()'), main.indexOf('get num_uninteracted_open_polls()')), /poll/);
	assert.doesNotMatch(templates, /poll.*opt.?out/i);
	assert.match(templates, /template-mp-poll-creator-modal/);
	assert.match(templates, /state\.toggle_poll_option\(poll, option\)/);
	assert.doesNotMatch(templates, /poll\.reactions|state\.toggle_chat_reaction\(poll/);
	assert.match(templates, /conversation_kind !== 'polls'.*conversation_kind !== 'poll-discussion'/);
	assert.doesNotMatch(actions, /api\/polls\/reaction/);
	assert.match(templates, /state\.open_poll_discussion\(poll\)/);
	assert.match(templates, /get_chat_message_content\(poll\)/);
	assert.match(templates, /get_chat_message_content\(option\)/);
	const discussion_question = templates.indexOf('mp-poll-discussion-question');
	const chat_messages = templates.indexOf('class="mp-chat-messages"');
	assert.ok(discussion_question > templates.indexOf('class="block-header block-header-default mp-chat-header"') && discussion_question < chat_messages);
	assert.match(templates, /mp-poll-discussion-question[\s\S]*v-text="state\.get_chat_message_content\(state\.selected_chat_conversation\?\.poll\)"/);
	assert.equal((templates.match(/class="mp-chat-conversation-icon"/g) ?? []).length, 5);
	assert.doesNotMatch(templates.slice(global, templates.indexOf('template-mp-chat-budget-info-modal')), /class="skill-icon-sm"/);
	assert.match(actions, /conversation_kind: 'poll-discussion'/);
	assert.match(actions, /api\/polls\/options/);
	assert.match(actions, /api\/polls\/delete/);
	assert.match(actions, /show_poll_delete_confirmation/);
	assert.match(actions, /choice_mode: this\.poll_creator_choice_mode/);
	assert.match(actions, /api\/polls\/status/);
	assert.match(templates, /poll\.can_delete/);
	assert.match(templates, /template-mp-poll-delete-confirm-modal/);
	assert.match(templates, /poll\.open \? 'MOD_MP_POLLS_OPEN' : 'MOD_MP_POLLS_CLOSED'/);
	assert.match(templates, /poll\.choice_mode === 'single'/);
	assert.match(templates, /:disabled="!poll\.open"/);
	assert.match(templates, /state\.poll_creator_choice_mode/);
	assert.match(style, /\.mp-poll-option-selected/);
	assert.match(style, /\.mp-poll-discussion-question[\s\S]*border-bottom/);
	assert.match(style, /\.mp-chat-conversation-icon\s*\{[\s\S]*height:\s*32px;[\s\S]*width:\s*32px;[\s\S]*margin:\s*6px;/);
	assert.equal(language.MOD_MP_POLLS_GO_DISCUSSION, 'Go to Discussion');
	assert.equal(language.MOD_MP_POLLS_SUBTITLE, 'Shape the future of the Multiplayer mod');
	assert.equal(language.MOD_MP_POLLS_SINGLE_CHOICE, 'Single Choice');
	assert.equal(language.MOD_MP_POLLS_MULTI_CHOICE, 'Multi-Choice');
	assert.equal(language.MOD_MP_POLLS_DELETE, 'Delete Poll');
	assert.equal(language.MOD_MP_POLLS_DELETE_CONFIRM_TITLE, 'Delete this poll?');
});
