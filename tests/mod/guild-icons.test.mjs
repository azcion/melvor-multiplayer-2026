import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('builds Guild icon choices from official base-game and DLC combat locations', async () => {
	const main = await read_client_source(root);

	for (const namespace of ['melvorD', 'melvorF', 'melvorAoD', 'melvorTotH', 'melvorItA'])
		assert.match(main, new RegExp(`'${namespace}'`));
	const setup_guild_icons = main.slice(main.indexOf('function setup_guild_icons()'), main.indexOf('function patch_bank_actions()'));
	assert.match(setup_guild_icons, /get_icon_objects\(game\.combatAreas\)/);
	assert.match(setup_guild_icons, /is_official_game_id\(icon\.id\)/);
	assert.match(setup_guild_icons, /!is_question_mark_media\(icon\.media\)/);
	assert.doesNotMatch(setup_guild_icons, /game\.combatAreas\.registeredObjects/);
	assert.doesNotMatch(setup_guild_icons, /id\.startsWith\('melvorF:'\) \|\| icon\.id\.startsWith\('melvorD:'\)/);
});

test('renders every matching Guild location in the scrolling selectors', async () => {
	const [main, templates, styles] = await Promise.all([
		read_client_source(root),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);
	const filtered_guild_icons = main.slice(main.indexOf('get filtered_guild_icons()'), main.indexOf('get filtered_council_icons()'));
	const filtered_council_icons = main.slice(main.indexOf('get filtered_council_icons()'), main.indexOf('get visible_council_petitions()'));

	assert.doesNotMatch(filtered_guild_icons, /slice\(0,\s*32\)/);
	assert.doesNotMatch(filtered_council_icons, /slice\(0,\s*32\)/);
	assert.match(styles, /\.mp-guild-icon-selector \{[\s\S]*grid-template-columns: repeat\(auto-fill, 64px\);[\s\S]*justify-content: center;[\s\S]*padding: 1px;[\s\S]*max-height: 230px;[\s\S]*overflow-y: auto/);
	assert.match(styles, /\.mp-guild-icon-selector-item \{[\s\S]*width: 64px;[\s\S]*height: 64px;[\s\S]*outline: 1px solid #5e5e5e/);
	assert.match(styles, /\.mp-icon-selector-image,[\s\S]*\.mp-guild-icon-selector-image \{[\s\S]*max-width: 100%;[\s\S]*max-height: 100%;[\s\S]*object-fit: contain;[\s\S]*aspect-ratio: 1/);
	assert.match(styles, /\.mp-guild-icon-selector-image \{[\s\S]*max-width: 64px;[\s\S]*max-height: 64px/);
	assert.match(templates, /class="mp-input-text mp-guild-icon-selector-search"/);
	assert.doesNotMatch(templates, /class="mp-input-text w-100(?: mt-3)?" type="search"[^>]+(?:council_icon_search|guild_icon_search)/);
	assert.match(templates, /class="mp-guild-icon-selector"[\s\S]*?@touchmove="state\.stop_icon_scroll_propagation\(\$event\)"[\s\S]*v-for="icon in state\.filtered_guild_icons"/);
	assert.match(templates, /class="mp-guild-icon-selector"[\s\S]*?@touchmove="state\.stop_icon_scroll_propagation\(\$event\)"[\s\S]*v-for="icon in state\.filtered_council_icons"/);
	assert.match(templates, /class="mp-guild-icon-selector-item"[\s\S]*class="mp-guild-icon-selector-image"/);
	const heraldry_template = templates.slice(templates.indexOf('<template id="template-mp-council-heraldry-modal">'), templates.indexOf('<template id="template-mp-council-banishment-modal">'));
	const guild_page_template = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'), templates.indexOf('<template id="template-mp-free-fellowship-confirm-modal">'));
	assert.doesNotMatch(heraldry_template, /bank-item|no-bg|btn-light|pointer-enabled|resize-48|p-2/);
	assert.doesNotMatch(guild_page_template, /bank-item|no-bg|btn-light|pointer-enabled|resize-48|p-2/);
});
