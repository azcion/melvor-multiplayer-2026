import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('wires privacy-gated active-mod viewing into member actions and self preview', async () => {
	const [templates, main, language, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const member_modal = templates.slice(
		templates.indexOf('<template id="template-mp-member-actions-modal">'),
		templates.indexOf('<template id="template-mp-active-mods-modal">')
	);
	const active_mods_modal = templates.slice(
		templates.indexOf('<template id="template-mp-active-mods-modal">'),
		templates.indexOf('<template id="template-mp-identities-modal">')
	);

	assert.match(templates.slice(templates.indexOf('<template id="template-mp-multiplayer-settings-modal">')), /state\.set_active_mods_visibility\(\$event\)/);
	assert.match(member_modal, /v-if="state\.selected_guild_member\.active_mods_visible && state\.selected_guild_member\.active_mods_available"/);
	assert.match(member_modal, /state\.view_member_active_mods\(\$event\)/);
	assert.match(active_mods_modal, /v-for="mod_name in state\.viewed_active_mods"/);
	assert.match(active_mods_modal, /<ol class="mp-active-mods-list">/);
	assert.match(main, /api_post\('\/api\/client\/active-mods\/visibility'/);
	assert.match(main, /member\.profile_source === 'chat' \? 'chat' : 'guilds'/);
	assert.match(main, /'\/active-mods\?client_id=' \+ member\.client_id/);
	assert.match(main, /get active_mod_names\(\) \{ return active_mod_names; \}/);
	assert.match(main, /member_actions_preview[\s\S]*runtime\.active_mod_names/);
	assert.match(main, /this\.viewed_active_mods = \[\.\.\.res\.active_mods\]/);
	assert.match(style, /\.mp-active-mods-list \{[^}]*padding-left: 2\.5em;[^}]*text-align: left;/s);
	assert.equal(language.MOD_MP_ACTIVE_MODS_VISIBILITY, 'Let others see your active mods');
	assert.equal(language.MOD_MP_ACTIVE_MODS_SHOW, 'Show Active Mods');
});

test('opens the retained cheat shortlist without revealing private active mods or triggering the roster row', async () => {
	const { install_transfer_actions } = await import('../../mod/client-actions-transfer.mjs');
	const calls = [];
	const state = { format_member_account_age: (age, precision) => {
		assert.equal(precision, 'hour');
		return '4 days, 23 hours';
	} };
	const actions = install_transfer_actions({ state, queue_modal: (...args) => calls.push(args) });
	Object.assign(state, actions);
	let stopped = false;
	state.view_member_cheat_mods({ using_cheats: true, active_mods_visible: false,
		cheat_mods: ['dev.Console', 'Add Items'], cheats_detected_at: Date.now() - 1000 },
		{ stopPropagation: () => { stopped = true; } });
	assert.equal(stopped, true);
	assert.deepEqual(state.viewed_cheat_mods, ['dev.Console', 'Add Items']);
	assert.equal(calls[0][1], 'cheat-mods-modal');
	assert.equal(calls[0][3].icon, 'info');
	assert.equal(calls[0][5], false);
	calls[0][3].didClose();
	assert.deepEqual(state.viewed_cheat_mods, []);
});
