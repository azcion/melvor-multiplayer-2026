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

test('renders each loaded member activity as a right-aligned icon', async () => {
	const [templates, main, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const roster_refresh = main.slice(
		main.indexOf('async function refresh_guild_state'),
		main.indexOf('async function refresh_guild_list')
	);
	const guild_page = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'));
	const members_header = guild_page.slice(
		guild_page.indexOf('<h3 class="block-title"><lang-string lang-id="MOD_MP_GUILD_MEMBERS">'),
		guild_page.indexOf('<div class="block-content" v-if="state.is_free_fellowship">')
	);
	const member_list = guild_page.slice(
		guild_page.indexOf('<div class="block-content p-0">'),
		guild_page.indexOf('<div class="block-content text-center" v-if="state.is_free_fellowship')
	);

	assert.doesNotMatch(members_header, /badge badge-secondary/);
	assert.match(main, /status_activity: member\.status_activity \?\? null/);
	assert.doesNotMatch(main, /refresh_guild_member_statuses/);
	assert.doesNotMatch(roster_refresh, /api_get\('\/api\/guilds\/status\?client_id=' \+ member\.client_id\)/);
	assert.match(member_list, /member\.status_activity/);
	assert.match(member_list, /MOD_MP_GUILD_YOU[\s\S]*get_status_activity_icon\(member\.status_activity\)/);
	assert.match(style, /\.mp-guild-member-meta \{[\s\S]*margin-left: auto;/);
	assert.match(style, /\.mp-member-actions > label \{[\s\S]*justify-content: flex-start;/);
});
