import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('registers Guild as a Multiplayer page instead of a modal', async () => {
	const [data, templates, main] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8')
	]);

	const guild_page = data.data.pages.find(page => page.id === 'Guild');
	assert.equal(guild_page.containerID, 'mp-guild-page');
	assert.equal(guild_page.sidebarItem.categoryID, 'Multiplayer');
	assert.match(templates, /template-mp-guild-page/);
	assert.doesNotMatch(templates, /template-mp-guild-modal/);
	assert.doesNotMatch(templates, /template-mp-guild-browser-modal/);
	assert.match(main, /changePage\(game\.pages\.getObjectByID\('multiplayer:Guild'\)\)/);
});

test('keeps Guild styling on Melvor typography', async () => {
	const style = await readFile(new URL('mod/ui/style.css', root), 'utf8');

	assert.match(style, /\.mp-guild-page-layout/);
	assert.match(style, /\.mp-guild-summary h3,[\s\S]*color: inherit !important/);
	assert.doesNotMatch(style, /font-family|@font-face|fonts?\.google/i);
});

test('wires Free Fellowship direct joining and its no-Council presentation', async () => {
	const [lang, templates, main] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8')
	]);

	assert.equal(lang.MOD_MP_FREE_FELLOWSHIP_CONFIRM_PUBLIC.includes('application'), true);
	assert.equal(lang.MOD_MP_FREE_FELLOWSHIP_CONFIRM_IDENTITY, undefined);
	assert.match(main, /\/api\/guilds\/join-free/);
	assert.match(main, /is_free_fellowship/);
	assert.match(templates, /free-fellowship-confirm-modal/);
	assert.match(templates, /v-if="guild\.is_free_fellowship"/);
	assert.match(templates, /!state\.is_free_fellowship && state\.guild_state\.guild\.capabilities\.council/);
});

test('keeps Free Fellowship confirmation titles localized and guild results responsive', async () => {
	const [lang, templates, main, style] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);

	assert.equal(lang.MOD_MP_BUTTON_JOIN, 'Join');
	assert.match(main, /queue_modal\('MOD_MP_FREE_FELLOWSHIP_CONFIRM_TITLE',[\s\S]*\}, true, false\)/);
	assert.match(templates, /class="mp-guild-result-details"/);
	assert.match(templates, /class="mp-guild-result-actions"/);
	assert.doesNotMatch(templates, /MOD_MP_FREE_FELLOWSHIP_CONFIRM_IDENTITY/);
	assert.match(style, /\.mp-guild-result \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto;/);
	assert.match(style, /\.mp-guild-result-actions \{[\s\S]*align-items: flex-end;/);
	assert.doesNotMatch(style, /\.mp-guild-result \.badge \{[\s\S]*display: none/);
});
