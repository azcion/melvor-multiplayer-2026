import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';
import {
	queue_mod_conflict_notice,
	get_language_code,
	get_language_lang_id,
	get_game_mode_id,
	get_owned_dlc,
	is_mod_version_outdated,
	is_mod_version_unsupported,
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

test('applies the support floor only to feature-aware 1.5.10 and later clients', () => {
	assert.equal(is_mod_version_unsupported('1.5.10', '1.5.11'), true);
	assert.equal(is_mod_version_unsupported('1.5.11', '1.5.11'), false);
	assert.equal(is_mod_version_unsupported('1.6.0', '1.5.11'), false);
	assert.equal(is_mod_version_unsupported('1.5.10', null), false);
});

test('copies runtime reports so the once-per-load snapshot is stable', () => {
	const active_mods = ['Multiplayer'];
	const owned_dlc = ['melvorTotH'];
	const report = make_client_runtime_report('1.3.0', active_mods, 'melvorF:Adventure', null, null, owned_dlc);
	active_mods.push('Later Mod');
	owned_dlc.push('melvorAoD');

	assert.deepEqual(report, {
		mod_version: '1.3.0',
		active_mods: ['Multiplayer'],
		owned_dlc: ['melvorTotH'],
		capabilities: ['save-rollback-v1'],
		game_mode_id: 'melvorF:Adventure'
	});
	assert.deepEqual(make_client_runtime_report('1.3.0', [], null), {
		mod_version: '1.3.0',
		active_mods: [],
		owned_dlc: [],
		capabilities: ['save-rollback-v1']
	});
});

test('captures only owned-and-enabled official DLC as owned namespaces', () => {
	assert.deepEqual(get_owned_dlc({
		hasTotHEntitlementAndIsEnabled: true,
		hasAoDEntitlementAndIsEnabled: false,
		hasItAEntitlementAndIsEnabled: true
	}), ['melvorTotH', 'melvorItA']);
	assert.deepEqual(get_owned_dlc(null), []);
});

test('captures canonical base-game and custom game-mode IDs', () => {
	assert.equal(get_game_mode_id({ id: 'melvorD:Standard', name: 'Standard Mode' }), 'melvorD:Standard');
	assert.equal(get_game_mode_id({ id: 'custom_Mode:Iron_Idler' }), 'custom_Mode:Iron_Idler');
	assert.equal(get_game_mode_id({ id: 'not namespaced' }), null);
	assert.equal(get_game_mode_id(null), null);
});

test('captures raw language values while exposing only known display labels', () => {
	assert.equal(get_language_code('x-debug-locale'), 'x-debug-locale');
	assert.equal(get_language_code('x'.repeat(65)), null);
	assert.equal(get_language_lang_id('pt-br'), 'MOD_MP_LANGUAGE_PT_BR');
	assert.equal(get_language_lang_id('pt-BR'), null);
	assert.equal(get_language_lang_id('x-debug-locale'), null);
	assert.equal(get_language_lang_id('toString'), null);

	assert.deepEqual(make_client_runtime_report('1.4.0', [], null, 'x-debug-locale'), {
		mod_version: '1.4.0',
		active_mods: [],
		owned_dlc: [],
		capabilities: ['save-rollback-v1'],
		language: 'x-debug-locale'
	});
});

test('captures loaded mods after the Melvor lifecycle and reports them during both identity flows', async () => {
	const main = await read_client_source(root);
	const packaging = await readFile(new URL('scripts/package-release.sh', root), 'utf8');
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const language = JSON.parse(await readFile(new URL('mod/data/lang/en.json', root), 'utf8'));

	assert.match(main, /const MOD_VERSION = 'development';/);
	assert.match(main, /ctx\.onModsLoaded\(capture_active_mod_names\)/);
	assert.match(main, /mod\.manager\.getLoadedModList\(\)/);
	assert.match(main, /ctx\.loadModule\('icon-catalog-discovery\.mjs'\)/);
	assert.match(main, /loaded_game_mode_id = client_runtime\.get_game_mode_id\(game\.currentGamemode\);/);
	assert.match(main, /client_runtime\.get_language_code\(typeof setLang === 'string' \? setLang : null\)/);
	assert.match(main, /client_runtime\.get_owned_dlc\(melvor_cloud_manager\)/);
	assert.equal((main.match(/client_runtime: get_client_runtime_report\(\)/g) ?? []).length, 2);
	assert.match(packaging, /const MOD_VERSION = '\$\{version\}';/);
	assert.match(main, /function check_released_mod_version\(released_mod_version\)[\s\S]*is_mod_version_outdated\(MOD_VERSION, released_mod_version\)/);
	assert.match(main, /check_released_mod_version\(response\.released_mod_version\)/);
	assert.match(main, /check_released_mod_version\(res\.released_mod_version\);[\s\S]*if \(res\.unchanged === true\)/);
	assert.match(main, /release_notice_shown = true/);
	assert.match(templates, /template-mp-outdated-version-modal/);
	assert.match(language.MOD_MP_OUTDATED_VERSION_INFO, /refresh or restart Melvor/);
	assert.equal(language.MOD_MP_UNSUPPORTED_VERSION_MESSAGE,
		"You're using an unsupported version of the Multiplayer mod.\n\nPlease refresh your page, or restart your game to update it.");
});

test('stops multiplayer traffic and presents a permanent local Support notice below the support floor', async () => {
	const main = await read_client_source(root);
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	assert.match(main, /function enter_unsupported_multiplayer[\s\S]*state\.is_connected = false;[\s\S]*stop_chat_polling\(\);[\s\S]*stop_gp_sampling\(\);[\s\S]*stop_status_observer\(\);/);
	assert.match(main, /async function api_get\(endpoint, is_current = null\) \{\s*if \(state\.multiplayer_unsupported\)\s*return null;/);
	assert.match(main, /async function api_post_response_raw[\s\S]*?if \(state\.multiplayer_unsupported\)\s*return \{ response: null, json: null \};/);
	assert.match(main, /synthetic_unsupported: true,[\s\S]*unread_count: 1/);
	assert.match(main, /if \(conversation\.synthetic_unsupported === true \|\| conversation\.synthetic_service === true\)[\s\S]*this\.chat_messages = \[conversation\.latest_message\];/);
	assert.match(templates, /v-else-if="state\.selected_chat_conversation\?\.synthetic_unsupported !== true && state\.selected_chat_conversation\?\.synthetic_service !== true"/);
});

test('initializes action dependencies before installing split actions', async () => {
	const main = await read_client_source(root);
	const setup_start = main.indexOf('export async function setup(ctx)');
	const action_install_start = main.indexOf('const action_runtime = create_action_runtime()', setup_start);

	assert.ok(main.indexOf('open_transfer_page = transfer_page.open_transfer_page', setup_start) < action_install_start);
	assert.ok(main.indexOf('remove_sold_out_market_result = market_results.remove_sold_out_market_result', setup_start) < action_install_start);

	const runtime_start = main.indexOf('function create_action_runtime()');
	const runtime_end = main.indexOf('\n// #region COMMON FUNCTIONS', runtime_start);
	assert.match(main.slice(runtime_start, runtime_end), /\brefresh_identities,\s/);
});

test('defers character-scoped Chat preference loading until a character is loaded', async () => {
	const main = await read_client_source(root);
	const setup_start = main.indexOf('export async function setup(ctx)');
	const character_loaded_start = main.indexOf('ctx.onCharacterLoaded(() =>', setup_start);
	const character_loaded_end = main.indexOf('\n\tctx.onCharacterSelectionLoaded', character_loaded_start);
	const setup_before_character_load = main.slice(setup_start, character_loaded_start);
	const character_loaded = main.slice(character_loaded_start, character_loaded_end);

	assert.doesNotMatch(setup_before_character_load, /get_instance_storage_item\('chat_translation_preferences'\)/);
	assert.match(character_loaded, /state\.load_chat_translation_preferences\(\);/);
});

const conflict_document = { createElement(tag) {
	return { tag, style: {}, children: [], append(...children) { this.children.push(...children); } };
} };

test('conflict warning lists only exact loaded conflicts, with singular/plural text and spacing', () => {
	const original = 'Melvor Multiplayer', fixes = '[Galy] Melvor Multiplayer Fixes';
	for (const loaded of [[original], [fixes], [fixes, original, original]]) {
		const queued = [];
		assert.equal(queue_mod_conflict_notice(loaded, key => key, options => queued.push(options), conflict_document), true);
		const [options] = queued;
		assert.equal(queued.length, 1);
		assert.equal(options.icon, 'warning');
		assert.equal(options.titleText, 'MOD_MP_MOD_CONFLICT_TITLE');
		assert.equal(options.confirmButtonText, 'MOD_MP_MOD_CONFLICT_OKAY');
		assert.equal(options.showConfirmButton, true);
		assert.equal(options.timer, undefined);
		assert.equal(options.preConfirm, undefined);
		assert.equal(options.html.style.marginBottom, '1rem');
		const expected = [original, fixes].filter(name => loaded.includes(name));
		assert.equal(options.html.children[0].textContent, expected.length === 1 ? 'MOD_MP_MOD_CONFLICT_SINGLE' : 'MOD_MP_MOD_CONFLICT_MULTIPLE');
		assert.deepEqual(options.html.children[1].children.map(item => item.textContent), expected);
	}
});

test('conflict checks repeat each load, ignore unrelated mods, and scan beyond the reporting cap', () => {
	const queued = [];
	const check = loaded => queue_mod_conflict_notice(loaded, key => key, options => queued.push(options), conflict_document);
	assert.equal(check(['Melvor Multiplayer Remastered', 'Melvor Multiplayer Extra', null]), false);
	assert.equal(check(undefined), false);
	const loaded = [...Array(150).fill('Unrelated'), ' Melvor Multiplayer '];
	assert.equal(check(loaded), true);
	assert.equal(check(loaded), true);
	assert.equal(check([]), false);
	assert.equal(queued.length, 2);
});

test('character-load conflict warning precedes Multiplayer session and interface notices', async () => {
	const source = await read_client_source();
	const start = source.indexOf('ctx.onCharacterLoaded(() => {');
	const warning = source.indexOf('client_runtime.queue_mod_conflict_notice(', start);
	assert.ok(warning > start);
	assert.ok(warning < source.indexOf('start_multiplayer_session();', start));
	assert.ok(warning < source.indexOf('ctx.onInterfaceReady(() => {', start));
});

test('excludes exactly this client even when the original mod shares its published name', () => {
	const own = 'Melvor Multiplayer';
	const queued = [];
	const check = (loaded, own_name = own) => queue_mod_conflict_notice(loaded, key => key, options => queued.push(options), conflict_document, own_name);
	assert.equal(check([own]), false);
	assert.equal(check([own, own]), true);
	assert.deepEqual(queued[0].html.children[1].children.map(item => item.textContent), [own]);
	assert.equal(check(['Toolkit Candidate']), false);
	assert.equal(check(['Toolkit Candidate', own], 'Toolkit Candidate'), true);
	assert.equal(check([own, '[Galy] Melvor Multiplayer Fixes']), true);
	assert.deepEqual(queued.at(-1).html.children[1].children.map(item => item.textContent), ['[Galy] Melvor Multiplayer Fixes']);
});
