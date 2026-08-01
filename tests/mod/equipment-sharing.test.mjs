import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('routes profile controls through one Options member-actions modal', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const dropdown = templates.slice(
		templates.indexOf('<template id="template-mp-dropdown">'),
		templates.indexOf('<template id="template-mp-member-actions-modal">')
	);

	assert.match(dropdown, /state\.show_options_modal\(\)/);
	assert.doesNotMatch(dropdown, /state\.show_display_name_modal\(\)/);
	assert.doesNotMatch(dropdown, /state\.show_icon_modal\(\)/);
	assert.match(templates, /template-mp-member-actions-modal/);
	assert.match(templates, /MOD_MP_EQUIPMENT_VISIBILITY/);
	assert.match(templates, /v-if="state\.is_guild_member"[\s\S]*MOD_MP_GUILD_DANGER_ZONE/);
});

test('makes Guild members selectable and keeps departure out of the Guild page', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const guild_page = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'));
	const member_view = guild_page.slice(0, guild_page.indexOf('<template v-else-if="state.guild_state.affiliation'));

	assert.match(guild_page, /mp-guild-member-button[\s\S]*state\.show_member_actions\(member\)/);
	assert.doesNotMatch(member_view, /mp-guild-danger-zone/);
	assert.doesNotMatch(member_view, /state\.confirm_leave_guild\(\)/);
});

test('keeps remote equipment read-only, quantity-free, and memory-only', async () => {
	const [templates, main] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8')
	]);
	const equipment_modal = templates.slice(
		templates.indexOf('<template id="template-mp-equipment-modal">'),
		templates.indexOf('<template id="template-mp-leave-guild-modal">')
	);

	assert.match(equipment_modal, /state\.viewed_equipment_grid/);
	assert.match(equipment_modal, /mp-equipment-item/);
	assert.match(equipment_modal, /MOD_MP_EQUIPMENT_UNKNOWN_ITEM/);
	assert.doesNotMatch(equipment_modal, /qty|quantity|equipItem|unequipItem/);
	assert.match(main, /didClose: \(\) => \{ this\.viewed_equipment = \[\]; \}/);
	assert.match(main, /touch: 'hold'/);
});

test('keeps the member equipment spinner cleanup target across the request', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const view_member_equipment = main.slice(
		main.indexOf('async view_member_equipment'),
		main.indexOf('async add_gp_to_transfer')
	);

	assert.match(view_member_equipment, /const \$button = event\.currentTarget;/);
	assert.match(view_member_equipment, /is_button_spinning\(\$button\)/);
	assert.match(view_member_equipment, /show_button_spinner\(\$button\)/);
	assert.match(view_member_equipment, /hide_button_spinner\(\$button\)/);
	assert.doesNotMatch(view_member_equipment, /(?:show|hide|is_button_spinning)\(event\.currentTarget\)/);
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
