import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('routes profile controls through one Options member-actions modal', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const account_options = templates.slice(
		templates.indexOf('<template id="template-mp-account-options">'),
		templates.indexOf('<template id="template-mp-member-actions-modal">')
	);

	assert.match(account_options, /MOD_MP_MENU_HEADER/);
	assert.match(account_options, /state\.show_options_modal\(\)/);
	assert.doesNotMatch(account_options, /state\.show_display_name_modal\(\)/);
	assert.doesNotMatch(account_options, /state\.show_icon_modal\(\)/);
	assert.doesNotMatch(templates, /template-mp-online-button|template-mp-dropdown|mp-online-dropdown/);
	assert.match(templates, /template-mp-member-actions-modal/);
	assert.match(templates, /MOD_MP_EQUIPMENT_VISIBILITY/);
	assert.match(templates, /v-show="state\.is_guild_member"[\s\S]*MOD_MP_GUILD_DANGER_ZONE/);
});

test('moves the multiplayer entry point into the vanilla account menu', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
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
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');

	assert.match(main, /sidebar\.category\('Multiplayer', \{ before: 'Combat', toggleable: true \}\);/);
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
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const member_actions = templates.slice(
		templates.indexOf('<template id="template-mp-member-actions-modal">'),
		templates.indexOf('<template id="template-mp-identities-modal">')
	);

	assert.match(member_actions, /<div v-show="state\.is_guild_member">[\s\S]*state\.leave_guild_from_options\(\)/);
	assert.doesNotMatch(member_actions, /<template v-if="state\.is_guild_member">/);
});

test('keeps remote equipment read-only, quantity-free, and memory-only', async () => {
	const [templates, main] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8')
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
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
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
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');

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
