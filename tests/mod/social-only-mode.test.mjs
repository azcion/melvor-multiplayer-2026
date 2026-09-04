import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { is_social_only_mode, normalize_social_mode, SOCIAL_MODE_FULL, SOCIAL_MODE_SOCIAL } from '../../mod/social-mode.mjs';
import { read_release_changelog } from './source.mjs';

const root = new URL('../../', import.meta.url);

function load_social_mode_reconciler(main, state) {
	const start = main.indexOf('function reconcile_guild_member_social_modes');
	const end = main.indexOf('\nfunction get_bank_item_ids', start);
	return new Function('state', 'social_mode', `${main.slice(start, end)}; return reconcile_guild_member_social_modes;`)(
		state,
		{ SOCIAL_MODE_FULL, SOCIAL_MODE_SOCIAL }
	);
}

test('normalizes the server-scoped mode to Full Experience unless Social Only is selected', () => {
	assert.equal(normalize_social_mode(undefined), SOCIAL_MODE_FULL);
	assert.equal(normalize_social_mode('unexpected'), SOCIAL_MODE_FULL);
	assert.equal(normalize_social_mode(SOCIAL_MODE_SOCIAL), SOCIAL_MODE_SOCIAL);
	assert.equal(is_social_only_mode(SOCIAL_MODE_SOCIAL), true);
	assert.equal(is_social_only_mode(SOCIAL_MODE_FULL), false);
});

test('exposes the mode choice, setting, gates, and Raid exception in both supported languages', async () => {
	const [main, components, templates, style, english, chinese, changelog] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/client-components.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/lang/zh-CN.json', root), 'utf8').then(JSON.parse),
		read_release_changelog(root)
	]);

	assert.doesNotMatch(main, /select\.type\s*=\s*['"]select-one['"]/);
	assert.match(templates, /MOD_MP_SOCIAL_MODE_FULL/);
	assert.match(templates, /MOD_MP_SOCIAL_MODE_SOCIAL/);
	assert.match(templates, /mp-social-mode-options/);
	assert.match(templates, /MOD_MP_SOCIAL_MODE_SUBTITLE/);
	assert.match(templates, /MOD_MP_SOCIAL_MODE_CHOOSE/);
	assert.match(templates, /MOD_MP_SOCIAL_ONLY_RAID_INFO/);
	assert.match(style, /\.mp-social-mode-options\s*\{[\s\S]*grid-template-columns: repeat\(2/);
	assert.match(style, /\.mp-social-mode-options\s*\{[\s\S]*grid-template-columns: 1fr/);
	assert.match(style, /\.mp-social-mode-card-full h3\s*\{[\s\S]*color: #17d873/);
	assert.match(style, /\.mp-social-mode-card-social h3\s*\{[\s\S]*color: #179cd8/);
	assert.match(style, /\.mp-social-mode-card-full\s*\{[\s\S]*border-color: #17d873/);
	assert.match(style, /\.mp-social-mode-card-social\s*\{[\s\S]*border-color: #179cd8/);
	assert.match(style, /\.mp-social-mode-card-full \.mp-social-mode-button\s*\{[\s\S]*background: #17d873/);
	assert.match(style, /\.mp-social-mode-card-social \.mp-social-mode-button\s*\{[\s\S]*background: #179cd8/);
	assert.match(templates, /template-mp-transfer-page[\s\S]*MOD_MP_SOCIAL_ONLY_TRANSFER_INFO/);
	assert.match(templates, /class="mp-transfer-exchanges" v-show="!state\.is_social_only"/);
	assert.doesNotMatch(templates, /<template v-if="!state\.is_social_only">/);
	assert.match(components, /customElements\.get\(name\)[\s\S]*customElements\.define\(name, constructor\)/);
	assert.equal((components.match(/customElements\.define\(name, constructor\)/g) ?? []).length, 1);
	assert.match(main, /type: 'social-mode'/);
	assert.match(main, /name: 'social-mode'/);
	assert.match(main, /social-mode-choice-modal/);
	assert.match(main, /function open_social_mode_picker\(\)\s*\{[\s\S]*Swal\.close\(\);[\s\S]*setTimeout\(\(\) => \{ queue_social_mode_modal\(\); \}, 0\);/);
	assert.match(main, /const button = document\.createElement\('button'\);[\s\S]*button\.addEventListener\('click', open_social_mode_picker\)/);
	assert.match(main, /button\.textContent = getLangString\('MOD_MP_SETTINGS_CHANGE_MODE'\)/);
	assert.match(main, /const mode_settings_section = ctx\.settings\.section\(getLangString\('MOD_MP_SETTINGS_MODE_SECTION'\)\)/);
	assert.doesNotMatch(main.slice(main.indexOf('const mode_settings_section'), main.indexOf('server_settings_section = ctx.settings.section')), /label:|hint:/);
	assert.doesNotMatch(main.slice(main.indexOf('function install_social_mode_setting'), main.indexOf('\nfunction on_page_toggle')), /createElement\('select'\)/);
	assert.match(main, /imageWidth: 100[\s\S]*customClass: \{ popup: 'mp-social-mode-choice-modal-popup' \}/);
	assert.match(main, /api\/social-mode\/cancel/);
	assert.match(main, /api\/social-mode\/set/);
	assert.match(main, /showCloseButton: true/);
	assert.match(main, /didClose: \(\) => \{[\s\S]*social_mode_selected/);
	assert.match(main, /member\.client_id !== this\.guild_client_id && member\.social_mode !== 'social'/);
	assert.match(main, /if \(this\.is_social_only\)\s*return this\.inbox_items\.length > 0 \|\| this\.inbox_pending_claim/);
	assert.match(main, /state\.resolved_trades = \[\]/);
	assert.match(main, /state\.inbox_items = \[\];[\s\S]*await get_client_events\(false\);[\s\S]*else\s*await update_inbox\(\)/);
	assert.match(main, /reconcile_guild_member_social_modes\(res\.guild_member_social_modes\)/);
	assert.match(main, /state\.is_social_only && page_id !== 'Guild_Raid'/);
	assert.match(main, /state\.is_social_only\)\s*return/);
	assert.equal(english.MOD_MP_SOCIAL_MODE_FULL, 'Full Experience');
	assert.equal(english.MOD_MP_SOCIAL_MODE_SOCIAL, 'Social Only');
	assert.equal(english.MOD_MP_SOCIAL_MODE_SOCIAL_DETAIL, 'Chat, connect, and show off.');
	assert.equal(english.MOD_MP_SOCIAL_MODE_CHOOSE, 'Choose');
	assert.equal(english.MOD_MP_SOCIAL_MODE_TITLE, 'Pick your Multiplayer experience');
	assert.equal(english.MOD_MP_SETTINGS_CHANGE_MODE, 'Change Mode');
	assert.equal(chinese.MOD_MP_SOCIAL_MODE_FULL, '完整模式');
	assert.equal(chinese.MOD_MP_SOCIAL_MODE_SOCIAL, '社交模式');
	assert.equal(chinese.MOD_MP_SOCIAL_MODE_CHOOSE, '选择');
	assert.equal(chinese.MOD_MP_SETTINGS_CHANGE_MODE, '更改模式');
	assert.match(changelog, /## 1\.5\.0[\s\S]*Social Only/);
});

test('records a mode choice when the selected mode is already active', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const function_source = main.slice(
		main.indexOf('function apply_social_mode'),
		main.indexOf('\nfunction install_social_mode_setting')
	);
	const storage = new Map();
	const apply_social_mode = new Function(
		'social_mode', 'state', 'get_instance_storage_item', 'set_instance_storage_item', `
		let social_mode_change_request = Promise.resolve();
		const request_social_mode = async () => { throw new Error('should not request an unchanged mode'); };
		${function_source}
		return apply_social_mode;
	`
	)(
		{ normalize_social_mode: value => value === SOCIAL_MODE_SOCIAL ? SOCIAL_MODE_SOCIAL : SOCIAL_MODE_FULL },
		{ social_mode: SOCIAL_MODE_FULL },
		key => storage.get(key),
		(key, value) => storage.set(key, value)
	);

	await apply_social_mode(SOCIAL_MODE_FULL);
	assert.equal(storage.get('social_mode_selected'), true);
});

test('settings rendering and restoration cannot overwrite the server-owned mode', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const function_source = main.slice(
		main.indexOf('function install_social_mode_setting'),
		main.indexOf('\nfunction on_page_toggle')
	);
	const state = { social_mode: SOCIAL_MODE_SOCIAL };
	let setting_type;
	const install_social_mode_setting = new Function(
		'state', 'social_mode', 'apply_social_mode', 'getLangString', 'document', `
		${function_source}
		return install_social_mode_setting;
	`
	)(
		state,
		{ normalize_social_mode: value => value === SOCIAL_MODE_SOCIAL ? SOCIAL_MODE_SOCIAL : SOCIAL_MODE_FULL },
		() => assert.fail('settings deserialization must not apply a mode change'),
		value => value,
		{}
	);

	install_social_mode_setting({ settings: { type(_name, config) { setting_type = config; } } });
	const setting_root = { nodeType: 1 };
	setting_type.set(setting_root, SOCIAL_MODE_FULL);
	assert.equal(state.social_mode, SOCIAL_MODE_SOCIAL);
	assert.equal(setting_type.get(setting_root), SOCIAL_MODE_SOCIAL);
	state.social_mode = SOCIAL_MODE_FULL;
	setting_type.set(setting_root, SOCIAL_MODE_SOCIAL);
	assert.equal(state.social_mode, SOCIAL_MODE_FULL);
});

test('refreshes sidebar visibility after loading the saved Social Only mode', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const character_loaded = main.slice(
		main.indexOf('ctx.onCharacterLoaded(() =>'),
		main.indexOf('\n\tctx.onCharacterSelectionLoaded', main.indexOf('ctx.onCharacterLoaded(() =>'))
	);
	assert.match(character_loaded, /load_social_mode\(\);\s*update_multiplayer_nav\(\);\s*start_multiplayer_session\(\);/);
});

test('reconciles authoritative Guild member modes into open recipient state', async () => {
	const state = {
		guild_members: [
			{ client_id: 1, social_mode: SOCIAL_MODE_FULL },
			{ client_id: 2, social_mode: SOCIAL_MODE_FULL }
		],
		selected_guild_member: { client_id: 2, social_mode: SOCIAL_MODE_FULL }
	};
	const reconcile = load_social_mode_reconciler(await readFile(new URL('mod/main.mjs', root), 'utf8'), state);
	reconcile([
		{ client_id: 1, social_mode: SOCIAL_MODE_FULL },
		{ client_id: 2, social_mode: SOCIAL_MODE_SOCIAL }
	]);
	assert.equal(state.guild_members[1].social_mode, SOCIAL_MODE_SOCIAL);
	assert.equal(state.selected_guild_member.social_mode, SOCIAL_MODE_SOCIAL);
});
