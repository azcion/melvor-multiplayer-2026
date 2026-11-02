import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';
import { install_common_actions } from '../../mod/client-actions-common.mjs';
import { MULTIPLAYER_SUPPORTED_LANGUAGES } from '../../mod/localization.mjs';

const root = new URL('../../', import.meta.url);

test('opts identities into Global Chat independently and keeps its category visible when disabled', async () => {
	const [main, templates, language_text] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);

	assert.match(main, /global_chat_enabled: true/);
	assert.match(main, /global_chat_participation_pending: false/);
	assert.match(main, /api\/chat\/global-participation\?capabilities=global-chat-v1/);
	assert.match(main, /state\.global_chat_enabled = res\.global_chat_enabled !== false/);
	assert.match(main, /state\.global_chat_enabled = response\.chat\?\.global_chat_enabled !== false/);
	assert.match(templates, /<section class="mp-chat-category">\s*<div[^>]*>.*MOD_MP_CHAT_CATEGORY_GLOBAL/s);
	assert.match(templates, /state\.set_global_chat_enabled\(\$event\)/);
	assert.match(templates, /v-if="!state\.global_chat_enabled"/);
	assert.equal(language.MOD_MP_GLOBAL_CHAT_ENABLE, 'Add me to Global Chat');
	assert.match(language.MOD_MP_GLOBAL_CHAT_OPTED_OUT, /Multiplayer Options/);
});

test('silently honors server throttle delays while preserving the Global Chat draft', async () => {
	const main = await read_client_source(root);

	assert.match(main, /conversation_kind === 'global'[\s\S]*messages\/send\?capabilities=global-chat-v1/);
	assert.match(main, /conversation_kind === 'global' \? 'global_chat_cooling_down' : 'tester_chat_cooling_down'/);
	assert.match(main, /this\[state_key\] = true;[\s\S]*setTimeout\(\(\) => \{ state\[state_key\] = false; \}, res\.retry_after_ms\)/);
	assert.match(main, /kind !== 'global' \|\| !this\.global_chat_cooling_down/);
	assert.match(main, /if \(res\?\.success\)[\s\S]*this\.chat_drafts\[conversation_key\] = ''/);
	assert.match(main, /else if \(is_current_view\(\) &&\s*!\(\(conversation_kind === 'global' \|\| conversation_kind === 'testers'\)/);
});

test('shows Announcements with an eligible-author composer and mandatory notifications', async () => {
 const [templates,english,main]=await Promise.all([
  readFile(new URL('mod/ui/templates.html',root),'utf8'),
  readFile(new URL('mod/data/lang/en.json',root),'utf8').then(JSON.parse),
  readFile(new URL('mod/client-actions-chat.mjs',root),'utf8')]);
 assert.match(templates,/state\.announcement_chat_conversations/);
 assert.doesNotMatch(templates,/state\.tester_chat_conversations/);
 assert.match(templates,/\['announcements', 'announcement-discussion'\]\.includes/);
 assert.match(templates,/state\.open_announcement_discussion\(message\)/);
 assert.match(templates,/message.discussion_unread_count/);
 assert.match(main,/conversation_kind === 'announcements'\) return true/);
 assert.equal(english.MOD_MP_ANNOUNCEMENTS_TITLE,'Announcements');
});

test('Announcement screens use localized labels in every supported language', async () => {
	const keys = [
		'MOD_MP_ANNOUNCEMENTS_TITLE', 'MOD_MP_ANNOUNCEMENTS_COMPOSE', 'MOD_MP_ANNOUNCEMENTS_POST',
		'MOD_MP_POLLS_GO_DISCUSSION', 'MOD_MP_CHAT_NO_MESSAGES', 'MOD_MP_CHAT_LOADING', 'MOD_MP_CHAT_BACK',
		'MOD_MP_CHAT_LOAD_OLDER', 'MOD_MP_CHAT_DELETED', 'MOD_MP_CHAT_TRANSLATION_TITLE',
		'MOD_MP_CHAT_DELETE_MESSAGE_FOR_ALL', 'MOD_MP_CHAT_DELETE_MESSAGE_FOR_ALL_CONFIRM_TITLE',
		'MOD_MP_CHAT_DELETE_MESSAGE_FOR_ALL_CONFIRM_INFO'
	];
	const english = JSON.parse(await readFile(new URL('mod/data/lang/en.json', root), 'utf8'));
	for (const language of MULTIPLAYER_SUPPORTED_LANGUAGES) {
		const strings = JSON.parse(await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8'));
		for (const key of keys) {
			assert.ok(typeof strings[key] === 'string' && strings[key].trim(), `${language}: missing ${key}`);
			if (language !== 'en') assert.notEqual(strings[key], english[key], `${language}: untranslated ${key}`);
		}
		const actions = install_common_actions({ getLangString: key => strings[key] });
		for (const kind of ['announcements', 'announcement-discussion']) {
			assert.equal(actions.get_chat_participant_name({ conversation_kind: kind,
				participant: { display_name: 'Announcements' } }), strings.MOD_MP_ANNOUNCEMENTS_TITLE);
		}
	}
});
