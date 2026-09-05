import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('builds avatar choices from official monsters and pickpocketing targets', async () => {
	const main = await read_client_source(root);

	for (const namespace of ['melvorD', 'melvorF', 'melvorAoD', 'melvorTotH', 'melvorItA'])
		assert.match(main, new RegExp(`'${namespace}'`));
	const setup_icons = main.slice(main.indexOf('function setup_icons()'), main.indexOf('function setup_guild_icons()'));
	assert.match(setup_icons, /get_icon_objects\(game\.monsters\)/);
	assert.match(setup_icons, /get_icon_objects\(game\.thieving\?\.actions\)/);
	assert.match(main, /get_icon_object_by_id\(game\.thieving\?\.actions, id\)/);
	assert.doesNotMatch(setup_icons, /game\.pets/);
	assert.doesNotMatch(main, /get_icon_object_by_id\(game\.pets, id\)/);
	assert.match(main, /get_pet_icon\(id\) \{[\s\S]*multiplayer_pet_flare\.get/);
	assert.match(main, /search_name: icon_object\.name\.toLowerCase\(\)/);
	assert.doesNotMatch(setup_icons, /id\.startsWith\('melvorF:'\) \|\| icon\.id\.startsWith\('melvorD:'\)/);
	assert.match(main, /MULTIPLAYER_GAME_NAMESPACE = 'multiplayer'/);
	assert.doesNotMatch(setup_icons, /allow_multiplayer: true/);
});

test('shows every matching avatar in a bounded scrolling selector', async () => {
	const [main, templates, styles] = await Promise.all([
		read_client_source(root),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);
	const filtered_icons = main.slice(main.indexOf('get filtered_icons()'), main.indexOf('get filtered_guild_icons()'));
	const icon_selector = styles.slice(styles.indexOf('.mp-icon-selector {'), styles.indexOf('.mp-icon-picked {'));

	assert.doesNotMatch(filtered_icons, /slice\(0,\s*32\)/);
	assert.match(icon_selector, /max-height:\s*320px/);
	assert.match(icon_selector, /max-height:\s*min\(40dvh, 320px\)/);
	assert.match(icon_selector, /overflow-y:\s*scroll/);
	assert.match(icon_selector, /-webkit-overflow-scrolling:\s*touch/);
	assert.match(icon_selector, /touch-action:\s*pan-y/);
	assert.match(icon_selector, /overscroll-behavior-y:\s*contain/);
	assert.match(main, /queue_modal\(game\.characterName, 'change-icon-modal'[^]*customClass: \{ popup: 'mp-icon-picker-modal-popup' \}/);
	assert.match(main, /stop_icon_scroll_propagation\(event\) \{\s*event\.stopPropagation\(\);/);
	assert.doesNotMatch(main, /stop_icon_scroll_propagation\(event\) \{[^}]*preventDefault/);
	assert.match(styles, /\.mp-icon-picker-modal-popup \.swal2-html-container \{[^}]*overflow:\s*hidden/);
	assert.match(templates, /class="mp-icon-selector"[\s\S]*?@touchmove="state\.stop_icon_scroll_propagation\(\$event\)"/);
	assert.match(templates, /v-for="icon in state\.filtered_icons"[\s\S]*?<img[^>]+loading="lazy">/);
	assert.match(templates, /<\/div>\s*<div class="mp-button-tray">/);
});
