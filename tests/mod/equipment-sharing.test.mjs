import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('member modals retain Guild affiliation across roster and Chat entry points', async () => {
	const { install_transfer_actions } = await import('../../mod/client-actions-transfer.mjs');
	const actions = install_transfer_actions({ queue_modal() {} });
	const state = {
		guild_state: { guild: { name: 'Current Guild' } },
		guild_members: [{ client_id: 12 }],
		shadowed_members: [{ client_id: 13 }],
		get_avatar_icon() { return ''; }
	};
	for (const client_id of [12, 13]) {
		const member = { client_id, display_name: 'Roster Member' };
		actions.show_member_actions.call(state, member);
		assert.equal(state.selected_guild_member.guild_name, 'Current Guild');
		assert.equal(member.guild_name, undefined);
	}
	actions.show_member_actions.call(state, { client_id: 14, guild_name: 'Other Guild', profile_source: 'chat' });
	assert.equal(state.selected_guild_member.guild_name, 'Other Guild');
	actions.show_member_actions.call(state, { client_id: 15, guild_name: null, profile_source: 'chat' });
	assert.equal(state.selected_guild_member.guild_name, null);
	// Applicants are outside the roster and must not inherit the viewer's Guild.
	actions.show_member_actions.call(state, { client_id: 16, profile_source: 'chat' });
	assert.equal(state.selected_guild_member.guild_name, null);
	state.guild_state = { affiliation: 'none' };
	state.guild_members = [];
	state.shadowed_members = [];
	actions.show_member_actions.call(state, { client_id: 14, guild_name: 'Other Guild', profile_source: 'chat' });
	assert.equal(state.selected_guild_member.guild_name, 'Other Guild');
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	assert.match(templates, /v-if="state\.selected_guild_member\.guild_name"/);
	assert.doesNotMatch(templates, /profile_source === 'chat' && state\.selected_guild_member\.guild_name/);
});

test('routes profile controls through one Options member-actions modal', async () => {
	const [templates, main, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);
	const account_options = templates.slice(
		templates.indexOf('<template id="template-mp-account-options">'),
		templates.indexOf('<template id="template-mp-member-actions-modal">')
	);
	const member_actions = templates.slice(
		templates.indexOf('<template id="template-mp-member-actions-modal">'),
		templates.indexOf('<template id="template-mp-identities-modal">')
	);

	assert.match(account_options, /MOD_MP_MENU_HEADER/);
	assert.match(account_options, /state\.show_options_modal\(\)/);
	assert.doesNotMatch(account_options, /state\.show_display_name_modal\(\)/);
	assert.doesNotMatch(account_options, /state\.show_icon_modal\(\)/);
	assert.doesNotMatch(templates, /template-mp-online-button|template-mp-dropdown|mp-online-dropdown/);
	assert.match(templates, /template-mp-member-actions-modal/);
	assert.match(templates, /MOD_MP_EQUIPMENT_VISIBILITY/);
	assert.match(member_actions, /MOD_MP_GUILD_DANGER_ZONE[\s\S]*class="mp-member-danger-actions"[\s\S]*v-show="state\.is_guild_member"[\s\S]*MOD_MP_BUTTON_LEAVE_GUILD[\s\S]*MOD_MP_IDENTITY_DELETE_ACTION/);
	assert.doesNotMatch(member_actions, /MOD_MP_IDENTITY_DANGER_ZONE/);
	assert.match(member_actions, /state\.preview_self_from_options\(\)/);
	assert.match(member_actions, /:disabled="state\.member_actions_preview"[\s\S]*MOD_MP_CHAT_START/);
	assert.match(main, /async preview_self_from_options\(\)[\s\S]*await this\.close_modal_and_wait\('member-actions-modal'\);[\s\S]*this\.show_member_actions\(member, true\)/);
	assert.match(main, /member_actions_preview[\s\S]*capture_equipment_snapshot\(\)[\s\S]*capture_status_snapshot\(\)/);
	assert.equal(language.MOD_MP_PROFILE_PREVIEW, 'See How Others See You');
});

test('moves the multiplayer entry point into the vanilla account menu', async () => {
	const main = await read_client_source(root);
	const style = await readFile(new URL('mod/ui/style.css', root), 'utf8');

	assert.match(main, /setup_account_menu\(\);/);
	assert.match(main, /getElementById\('page-header-user-dropdown'\)/);
	assert.match(main, /querySelectorAll\('#header-account-icon'\)/);
	assert.match(main, /ctx\.getResourceUrl\('assets\/multiplayer\.svg'\)/);
	assert.match(main, /getElementById\('header-user-options-dropdown'\)/);
	assert.match(main, /insertBefore\(\$account_options, \$save_management_header\)/);
	assert.doesNotMatch(main, /make_template\('online-button'/);
	assert.doesNotMatch(main, /make_template\('dropdown'/);
	assert.doesNotMatch(style, /mp-online-dropdown|mp-online-button-container|mp-notification-circle/);
});

test('makes the Multiplayer sidebar category collapsible', async () => {
	const main = await read_client_source(root);

	assert.match(main, /sidebar\.category\('Multiplayer', \{[\s\S]*before: 'Into the Abyss',[\s\S]*toggleable: true,[\s\S]*MOD_MP_MENU_HEADER/);
});

test('makes Guild members selectable and keeps departure out of the Guild page', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const guild_page = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'));
	const member_view = guild_page.slice(0, guild_page.indexOf('<div v-show="state.guild_page_view === \'applicant\'">'));

	assert.match(guild_page, /mp-guild-member-button[\s\S]*state\.show_member_actions\(member\)/);
	assert.doesNotMatch(member_view, /mp-guild-danger-zone/);
	assert.doesNotMatch(member_view, /state\.confirm_leave_guild\(\)/);
});

test('keeps the detached member-actions Guild control mounted during departure', async () => {
	const [templates, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const member_actions = templates.slice(
		templates.indexOf('<template id="template-mp-member-actions-modal">'),
		templates.indexOf('<template id="template-mp-identities-modal">')
	);

	assert.match(member_actions, /<div v-show="state\.is_guild_member">[\s\S]*state\.leave_guild_from_options\(\)/);
	assert.doesNotMatch(member_actions, /<template v-if="state\.is_guild_member">/);
	assert.match(style, /\.mp-member-danger-actions \{[^}]*display: grid;[^}]*repeat\(auto-fit, minmax\(140px, 1fr\)\);/s);
	assert.match(style, /\.mp-member-danger-actions \.btn \{[^}]*width: 100%;/s);
});

test('keeps remote equipment read-only, quantity-free, and memory-only', async () => {
	const [templates, main] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);
	const equipment_modal = templates.slice(
		templates.indexOf('<template id="template-mp-profile-modal">'),
		templates.indexOf('<template id="template-mp-leave-guild-modal">')
	);

	assert.match(equipment_modal, /state\.viewed_equipment_grid/);
	assert.match(equipment_modal, /mp-equipment-item/);
	assert.match(equipment_modal, /mp-equipment-item[^>]*>[\s\S]*draggable="false"/);
	assert.match(equipment_modal, /MOD_MP_EQUIPMENT_UNKNOWN_ITEM/);
	assert.doesNotMatch(equipment_modal, /qty|quantity|equipItem|unequipItem/);
	assert.match(equipment_modal, /MOD_MP_PROFILE_SKILLS/);
	assert.match(equipment_modal, /MOD_MP_PROFILE_EQUIPMENT/);
	assert.match(main, /didClose: \(\) => \{[\s\S]*this\.viewed_equipment = null;/);
	assert.match(main, /touch: 'hold'/);
});

test('keeps the member equipment spinner cleanup target across the request', async () => {
	const main = await read_client_source(root);
	const view_member_profile = main.slice(
		main.indexOf('async view_member_profile'),
		main.indexOf('async add_gp_to_transfer')
	);

	assert.match(view_member_profile, /const \$button = event\.currentTarget;/);
	assert.match(view_member_profile, /is_button_spinning\(\$button\)/);
	assert.match(view_member_profile, /show_button_spinner\(\$button\)/);
	assert.match(view_member_profile, /hide_button_spinner\(\$button\)/);
	assert.match(view_member_profile, /Promise\.all\(/);
	assert.doesNotMatch(view_member_profile, /(?:show|hide|is_button_spinning)\(event\.currentTarget\)/);
});

test('coalesces best-effort active-set snapshots and ignores quantities', async () => {
	const main = await read_client_source(root);

	assert.match(main, /entry\.providesStats/);
	assert.match(main, /slot_id: entry\.slot\.id, item_id: entry\.item\.id/);
	assert.match(main, /serialized === last_synced_equipment/);
	assert.match(main, /equipment_sync_in_flight/);
	assert.match(main, /schedule_equipment_sync\(0\)/);
	assert.doesNotMatch(
		main.slice(main.indexOf('function capture_equipment_snapshot'), main.indexOf('function schedule_equipment_sync')),
		/quantity|qty/
	);
});


test('distinguishes remote chat profiles from self settings without Guild membership', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const modal = templates.slice(templates.indexOf('<template id="template-mp-member-actions-modal">'));
	const expression = modal.match(/<template v-if="([^"]+)"/)[1];
	const self_settings = new Function('state', `return ${expression};`);
	for (const guild_client_id of [null, 12]) {
		const state = { guild_client_id, chat_client_id: 12, member_actions_preview: false,
			selected_guild_member: { client_id: 179 } };
		assert.equal(self_settings(state), false, 'Briar must open as a remote profile');
		state.selected_guild_member.client_id = 12;
		assert.equal(self_settings(state), true, 'Sin must retain self settings');
		state.member_actions_preview = true;
		assert.equal(self_settings(state), false, 'self preview must use the read-only profile');
	}
	assert.equal(self_settings({ chat_client_id: null, member_actions_preview: false,
		selected_guild_member: { client_id: null } }), false);
});

test('Options retains the authenticated identity while guildless', async () => {
	const { install_transfer_actions } = await import('../../mod/client-actions-transfer.mjs');
	const actions = install_transfer_actions({ refresh_identities: async () => {} });
	let selected = null;
	const state = { guild_client_id: null, chat_client_id: 12, guild_members: [],
		profile_display_name: 'Sin', profile_icon: 'melvorD:Chicken',
		close_account_dropdown() {}, show_member_actions(member) { selected = member; } };
	await actions.show_options_modal.call(state);
	assert.equal(selected.client_id, 12);
	assert.equal(selected.display_name, 'Sin');
});
