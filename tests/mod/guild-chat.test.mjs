import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function sources() {
	const [main, templates, style, language_text] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	return { main, templates, style, language: JSON.parse(language_text) };
}

test('renders non-empty Chat categories in Guild, Personal, Support order', async () => {
	const { main, templates, style, language } = await sources();
	const chat = templates.slice(templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-chat-budget-info-modal">'));
	const personal = chat.indexOf('MOD_MP_CHAT_CATEGORY_PERSONAL');
	const guild = chat.indexOf('MOD_MP_CHAT_CATEGORY_GUILD');
	const support = chat.indexOf('MOD_MP_CHAT_CATEGORY_SUPPORT');

	assert.ok(guild > 0 && guild < personal && personal < support);
	assert.match(main, /get personal_chat_conversations\(\)/);
	assert.match(main, /get guild_chat_conversations\(\)/);
	assert.match(main, /get support_chat_conversations\(\)/);
	assert.match(chat, /v-if="state\.personal_chat_conversations\.length > 0"/);
	assert.match(chat, /v-if="state\.show_guild_chat_category"/);
	assert.match(chat, /v-if="state\.support_chat_conversations\.length > 0"/);
	assert.match(style, /\.mp-chat-category \+ \.mp-chat-category/);
	assert.equal(language.MOD_MP_CHAT_CATEGORY_PERSONAL, 'Personal');
	assert.equal(language.MOD_MP_CHAT_CATEGORY_GUILD, 'Guild');
	assert.equal(language.MOD_MP_CHAT_CATEGORY_SUPPORT, 'Support');
	assert.doesNotMatch(chat, /MOD_MP_CHAT_CATEGORY_(GUILD|SUPPORT)_INFO/);
});

test('opts an identity into Guild Chat by default and exposes a reversible toggle', async () => {
	const { main, templates, language } = await sources();

	assert.match(main, /guild_chat_enabled: true/);
	assert.match(main, /api_post\('\/api\/chat\/guild-participation', \{ enabled: desired \}\)/);
	assert.match(main, /state\.guild_chat_enabled = res\.guild_chat_enabled !== false/);
	assert.match(main, /state\.guild_chat_enabled = response\.chat\?\.guild_chat_enabled !== false/);
	assert.match(templates, /state\.set_guild_chat_enabled\(\$event\)/);
	assert.match(templates, /MOD_MP_GUILD_CHAT_OPTED_OUT/);
	assert.match(templates, /v-if="!state\.guild_chat_enabled"/);
	assert.equal(language.MOD_MP_GUILD_CHAT_ENABLE, 'Add me to Guild Chat');
	assert.match(language.MOD_MP_GUILD_CHAT_OPTED_OUT, /Multiplayer Options/);
});

test('advertises Guild Chat capability and includes its unread count in shared Chat state', async () => {
	const { main } = await sources();

	assert.match(main, /const GUILD_CHAT_CAPABILITY = 'guild-chat-v1'/);
	assert.match(main, /\/api\/chat\/conversations\?capabilities=' \+ GUILD_CHAT_CAPABILITY/);
	assert.match(main, /\/api\/events\?revision=' \+ client_event_revision \+ '&capabilities=' \+ GUILD_CHAT_CAPABILITY/);
	assert.match(main, /state\.chat_unread = res\.conversations\.reduce/);
	assert.match(main, /state\.guild_chat_state = res\.guild_chat/);
});

test('uses Guild identity and keeps private-only controls out of Guild Chat', async () => {
	const { main, templates } = await sources();
	const chat = templates.slice(templates.indexOf('<template id="template-mp-chat-page">'),
		templates.indexOf('<template id="template-mp-chat-budget-info-modal">'));

	assert.match(main, /conversation\?\.conversation_kind === 'guild'[\s\S]*get_guild_icon/);
	assert.match(main, /kind !== 'private' \|\| \(this\.messaging_enabled/);
	assert.match(chat, /conversation_kind \|\| 'private'\) === 'private'/);
	assert.match(chat, /conversation_kind \|\| 'private'\) === 'private' && state\.chat_budget_enabled/);
	assert.match(templates, /conversation_kind \|\| 'private'\) === 'private'[^>]*show_chat_message_delete_confirmation/);
	assert.match(main, /const conversation_kind = conversation\.conversation_kind \?\? 'private'/);
	assert.match(main, /conversation_kind,/);
	assert.match(main, /chat-message-actions-modal', this\.get_chat_participant_icon\(\)/);
});

test('closes inaccessible Guild conversations and reloads cached Messages after moderation', async () => {
	const { main } = await sources();

	assert.match(main, /else if \(selected\.conversation_kind === 'guild'\) \{\s*state\.close_chat_conversation\(\)/);
	assert.match(main, /current\.moderation_count !== selected\.moderation_count/);
	assert.match(main, /if \(moderation_changed\) \{\s*state\.close_chat_conversation\(\);\s*await state\.open_chat_conversation\(current\)/);
	assert.match(main, /if \(chat_page_visible\)\s*await refresh_chat_conversations\(\)/);
});
