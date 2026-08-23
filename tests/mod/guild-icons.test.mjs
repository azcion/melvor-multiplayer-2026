import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('builds Guild icon choices from official base-game and DLC combat locations', async () => {
	const main = await read_client_source(root);

	for (const namespace of ['melvorD', 'melvorF', 'melvorAoD', 'melvorTotH', 'melvorItA'])
		assert.match(main, new RegExp(`'${namespace}'`));
	const setup_guild_icons = main.slice(main.indexOf('function setup_guild_icons()'), main.indexOf('function patch_bank_market()'));
	assert.match(setup_guild_icons, /get_icon_objects\(game\.combatAreas\)/);
	assert.match(setup_guild_icons, /is_official_game_id\(icon\.id\)/);
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
	assert.match(styles, /\.mp-guild-icon-selector \{[\s\S]*max-height: 230px;[\s\S]*overflow-y: auto/);
	assert.match(templates, /class="mp-guild-icon-selector mt-2"[\s\S]*v-for="icon in state\.filtered_guild_icons"/);
	assert.match(templates, /class="mp-guild-icon-selector mt-2"[\s\S]*v-for="icon in state\.filtered_council_icons"/);
});
