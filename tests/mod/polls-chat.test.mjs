import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('wires mandatory Polls below Global Chat with creator, voting, reactions, and discussion', async () => {
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
	const global = templates.indexOf('state.global_chat_conversations');
	const polls = templates.indexOf('state.polls_chat_conversations');
	const guild = templates.indexOf('state.guild_chat_conversations');
	assert.ok(global >= 0 && polls > global && guild > polls);
	assert.match(templates, /class="mp-chat-conversations" v-if="state\.polls\.length > 0"[\s\S]*state\.polls_chat_conversations/);
	assert.doesNotMatch(templates, /poll.*opt.?out/i);
	assert.match(templates, /template-mp-poll-creator-modal/);
	assert.match(templates, /state\.toggle_poll_option\(poll, option\)/);
	assert.match(templates, /state\.toggle_chat_reaction\(poll, summary\.reaction\)/);
	assert.match(templates, /state\.open_poll_discussion\(poll\)/);
	assert.equal((templates.match(/class="mp-chat-conversation-icon"/g) ?? []).length, 5);
	assert.doesNotMatch(templates.slice(global, templates.indexOf('template-mp-chat-budget-info-modal')), /class="skill-icon-sm"/);
	assert.match(actions, /conversation_kind: 'poll-discussion'/);
	assert.match(actions, /api\/polls\/options/);
	assert.match(style, /\.mp-poll-option-selected/);
	assert.match(style, /\.mp-chat-conversation-icon\s*\{[\s\S]*height:\s*32px;[\s\S]*width:\s*32px;[\s\S]*margin:\s*6px;/);
	assert.equal(language.MOD_MP_POLLS_GO_DISCUSSION, 'Go to Discussion');
});
