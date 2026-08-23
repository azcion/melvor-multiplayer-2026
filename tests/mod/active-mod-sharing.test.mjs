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

	assert.match(member_modal, /state\.set_active_mods_visibility\(\$event\)/);
	assert.match(member_modal, /v-if="state\.selected_guild_member\.active_mods_visible && state\.selected_guild_member\.active_mods_available"/);
	assert.match(member_modal, /state\.view_member_active_mods\(\$event\)/);
	assert.match(active_mods_modal, /v-for="mod_name in state\.viewed_active_mods"/);
	assert.match(active_mods_modal, /<ol class="mp-active-mods-list">/);
	assert.match(main, /api_post\('\/api\/client\/active-mods\/visibility'/);
	assert.match(main, /api_get\('\/api\/guilds\/active-mods\?client_id='/);
	assert.match(main, /get active_mod_names\(\) \{ return active_mod_names; \}/);
	assert.match(main, /member_actions_preview[\s\S]*runtime\.active_mod_names/);
	assert.match(main, /this\.viewed_active_mods = \[\.\.\.res\.active_mods\]/);
	assert.match(style, /\.mp-active-mods-list \{[^}]*padding-left: 2\.5em;[^}]*text-align: left;/s);
	assert.equal(language.MOD_MP_ACTIVE_MODS_VISIBILITY, 'Let others see your active mods');
	assert.equal(language.MOD_MP_ACTIVE_MODS_SHOW, 'Show Active Mods');
});
