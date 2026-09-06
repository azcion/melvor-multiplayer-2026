import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

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
	assert.match(main, /Number\.isFinite\(res\?\.retry_after_ms\)[\s\S]*global_chat_cooling_down = true/);
	assert.match(main, /setTimeout\([\s\S]*state\.global_chat_cooling_down = false/);
	assert.match(main, /kind !== 'global' \|\| !this\.global_chat_cooling_down/);
	assert.match(main, /if \(res\?\.success\)[\s\S]*this\.chat_drafts\[conversation_key\] = ''/);
	assert.match(main, /else if \(is_current_view\(\) && !\(conversation_kind === 'global'/);
});
