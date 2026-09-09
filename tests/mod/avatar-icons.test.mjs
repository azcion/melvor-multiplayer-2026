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
	assert.match(main, /show_icon_modal\(show_default_avatar_prompt = false\)/);
	assert.match(main, /state\.show_icon_prompt_info = show_default_avatar_prompt/);
	assert.match(main, /default_avatar_prompt_shown/);
	assert.match(main, /if \(show_default_avatar_prompt\)[\s\S]*set_instance_storage_item\('default_avatar_prompt_shown', true\)/);
	assert.match(main, /stop_icon_scroll_propagation\(event\) \{\s*event\.stopPropagation\(\);/);
	assert.doesNotMatch(main, /stop_icon_scroll_propagation\(event\) \{[^}]*preventDefault/);
	assert.match(styles, /\.mp-icon-picker-modal-popup \.swal2-html-container,[\s\S]*\.mp-name-input-modal-popup \.swal2-html-container \{[^}]*overflow:\s*visible/);
	assert.match(templates, /class="mp-icon-selector"[\s\S]*?@touchmove="state\.stop_icon_scroll_propagation\(\$event\)"/);
	assert.match(templates, /state\.show_icon_prompt_info[\s\S]*MOD_MP_DEFAULT_AVATAR_PROMPT/);
	assert.match(templates, /v-for="icon in state\.filtered_icons"[\s\S]*?<img[^>]+loading="lazy">/);
	assert.match(templates, /<\/div>\s*<div class="mp-button-tray">/);
});

test('queues the one-time default-avatar prompt only after experience mode selection', async () => {
	const main = await read_client_source(root);
	const activation = main.slice(main.indexOf('function activate_multiplayer_identity'));
	const mode_modal = main.slice(main.indexOf('function queue_social_mode_modal'), main.indexOf('function open_social_mode_picker'));

	assert.match(activation, /if \(get_instance_storage_item\('social_mode_selected'\) !== true\)[\s\S]*queue_identity_notice\('social_mode_choice'\);[\s\S]*else[\s\S]*queue_default_avatar_notice\(\);/);
	assert.match(mode_modal, /set_instance_storage_item\('social_mode_selected', true\);[\s\S]*queue_default_avatar_notice\(\);/);
	assert.match(main, /state\.profile_icon === DEFAULT_AVATAR_ICON_ID[\s\S]*get_instance_storage_item\(DEFAULT_AVATAR_PROMPT_STORAGE_KEY\) !== true/);
});
