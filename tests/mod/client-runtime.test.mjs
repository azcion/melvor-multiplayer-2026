import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	get_game_mode_id,
	is_mod_version_outdated,
	make_client_runtime_report,
	normalize_active_mod_names
} from '../../mod/client-runtime.mjs';

const root = new URL('../../', import.meta.url);

test('normalizes one bounded successfully loaded mod-name snapshot', () => {
	const loaded = [' Multiplayer ', '', null, 'Other Mod', 'Other Mod', 'x'.repeat(140)];
	const normalized = normalize_active_mod_names(loaded);

	assert.deepEqual(normalized, ['Multiplayer', 'Other Mod', 'x'.repeat(128)]);
	assert.equal(normalize_active_mod_names(Array.from({ length: 140 }, (_, index) => `Mod ${index}`)).length, 128);
});

test('compares stable release versions without notifying development or malformed builds', () => {
	assert.equal(is_mod_version_outdated('1.2.9', '1.3.0'), true);
	assert.equal(is_mod_version_outdated('1.3.0', '1.3.0'), false);
	assert.equal(is_mod_version_outdated('1.4.0', '1.3.0'), false);
	assert.equal(is_mod_version_outdated('development', '1.3.0'), false);
	assert.equal(is_mod_version_outdated('1.2.0', null), false);
});

test('copies runtime reports so the once-per-load snapshot is stable', () => {
	const active_mods = ['Multiplayer'];
	const report = make_client_runtime_report('1.3.0', active_mods, 'melvorF:Adventure');
	active_mods.push('Later Mod');

	assert.deepEqual(report, {
		mod_version: '1.3.0',
		active_mods: ['Multiplayer'],
		game_mode_id: 'melvorF:Adventure'
	});
	assert.deepEqual(make_client_runtime_report('1.3.0', [], null), {
		mod_version: '1.3.0',
		active_mods: []
	});
});

test('captures canonical base-game and custom game-mode IDs', () => {
	assert.equal(get_game_mode_id({ id: 'melvorD:Standard', name: 'Standard Mode' }), 'melvorD:Standard');
	assert.equal(get_game_mode_id({ id: 'custom_Mode:Iron_Idler' }), 'custom_Mode:Iron_Idler');
	assert.equal(get_game_mode_id({ id: 'not namespaced' }), null);
	assert.equal(get_game_mode_id(null), null);
});

test('captures loaded mods after the Melvor lifecycle and reports them during both identity flows', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const packaging = await readFile(new URL('scripts/package-release.sh', root), 'utf8');
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const language = JSON.parse(await readFile(new URL('mod/data/lang/en.json', root), 'utf8'));

	assert.match(main, /const MOD_VERSION = 'development';/);
	assert.match(main, /ctx\.onModsLoaded\(capture_active_mod_names\)/);
	assert.match(main, /mod\.manager\.getLoadedModList\(\)/);
	assert.match(main, /loaded_game_mode_id = client_runtime\.get_game_mode_id\(game\.currentGamemode\);/);
	assert.equal((main.match(/client_runtime: get_client_runtime_report\(\)/g) ?? []).length, 2);
	assert.match(packaging, /const MOD_VERSION = '\$\{version\}';/);
	assert.match(main, /is_mod_version_outdated\(MOD_VERSION, response\.released_mod_version\)/);
	assert.match(main, /release_notice_shown = true/);
	assert.match(templates, /template-mp-outdated-version-modal/);
	assert.match(language.MOD_MP_OUTDATED_VERSION_INFO, /issues until you update/);
});
