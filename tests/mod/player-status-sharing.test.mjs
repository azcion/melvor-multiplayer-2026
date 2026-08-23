import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('adds player status visibility and combined profile viewing to member actions', async () => {
	const [templates, main, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);

	assert.match(templates, /MOD_MP_STATUS_VISIBILITY/);
	assert.match(templates, /state\.view_member_profile\(\$event\)/);
	assert.match(templates, /template-mp-profile-modal/);
	assert.match(main, /api_get\('\/api\/guilds\/equipment\?client_id=' \+ member\.client_id\)/);
	assert.match(main, /api_get\('\/api\/guilds\/status\?client_id=' \+ member\.client_id\)/);
	assert.match(main, /api_post\('\/api\/client\/status\/visibility'/);
	assert.equal(language.MOD_MP_PROFILE_VIEW, 'View Status & Equipment');
});

test('renders local skill icons and levels while keeping activity in the member modal', async () => {
	const [templates, main, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const profile_modal = templates.slice(
		templates.indexOf('<template id="template-mp-profile-modal">'),
		templates.indexOf('<template id="template-mp-leave-guild-modal">')
	);
	const member_modal = templates.slice(
		templates.indexOf('<template id="template-mp-member-actions-modal">'),
		templates.indexOf('<template id="template-mp-identities-modal">')
	);

	assert.match(profile_modal, /state\.viewed_status_skills/);
	assert.match(profile_modal, /state\.get_skill_icon\(skill\.skill_id\)/);
	assert.match(profile_modal, /skill\.level/);
	assert.match(profile_modal, /state\.get_skill_level_cap\(skill\.skill_id\)/);
	assert.match(profile_modal, /state\.profile_active_tab = 'skills'/);
	assert.match(profile_modal, /state\.profile_active_tab = 'equipment'/);
	assert.doesNotMatch(profile_modal, /mp-status-activity|viewed_status_activity/);
	assert.doesNotMatch(profile_modal, /state\.viewed_status\.activity/);
	assert.match(member_modal, /class="mp-member-activities" v-if="state\.get_status_activities\(state\.selected_guild_member\)\.length"/);
	assert.match(member_modal, /state\.get_status_activities\(state\.selected_guild_member\)/);
	assert.match(member_modal, /state\.get_status_activity_icon\(activity\)/);
	assert.match(member_modal, /state\.get_status_activity_name\(activity\)/);
	assert.match(member_modal, /state\.get_language_lang_id\(state\.selected_guild_member\.language\) !== null/);
	assert.match(member_modal, /state\.get_language_name\(state\.selected_guild_member\.language\)/);
	assert.match(member_modal, /MOD_MP_LANGUAGE/);
	assert.match(main, /activity\.area_id === null \? null : game\.combatAreas\?\.getObjectByID\(activity\.area_id\)/);
	assert.match(main, /is_official_game_id\(area\?\.id\) && area\.media/);
	assert.doesNotMatch(profile_modal, /qty|quantity|rate|duration|inventory|history/i);
	assert.match(main, /didClose: \(\) => \{[\s\S]*this\.viewed_status = null;/);
	assert.doesNotMatch(main, /viewed_status_activity_(?:icon|name)/);
	assert.match(main, /customClass: \{ popup: 'mp-profile-modal-popup' \}/);
	assert.match(main, /get_registered_game_objects\(game\.skills\)[\s\S]*skill_order/);
	const skill_grid_rule = style.match(/\.mp-status-skills \{[^}]*\}/s)?.[0] ?? '';
	assert.match(skill_grid_rule, /grid-template-columns: repeat\(3/);
	assert.doesNotMatch(skill_grid_rule, /(?:max-)?height|overflow|touch-action|overscroll-behavior/);
	assert.doesNotMatch(style, /\.mp-profile-modal-popup \.mp-status-skills/);
	assert.match(style, /\.mp-member-activity img \{[^}]*width: 24px;[^}]*height: 24px;[^}]*object-fit: contain;[^}]*\}/s);
	assert.match(style, /\.mp-profile-modal-popup \.mp-status-skill img[\s\S]*width: 24px;[\s\S]*height: 24px;[\s\S]*margin: 0;/);
	assert.match(style, /\.mp-profile-modal-popup \.badge\.badge-secondary\.mp-status-skill-level[\s\S]*font-size: 60%;/);
	assert.match(style, /\.mp-profile-modal-popup \.swal2-image[\s\S]*margin: \.5rem auto;/);
	assert.match(style, /\.mp-profile-modal-popup #swal2-title[\s\S]*font-size: 1\.5rem;/);
	assert.match(style, /\.mp-profile-modal-popup \.mp-profile-panel-title[\s\S]*display: none;/);
});

test('ships captured custom skill icons for every shared-status surface', async () => {
	const [templates, main] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);
	const bundled_icons = {
		'kru_archaeology:Archaeology': ['skill_archaeology.svg', 1072],
		'mythMusic:Music': ['skill_music.png', 4531],
		'occultism:Occultism': ['skill_occultism.png', 29176],
		'rielkConstruction:Construction': ['skill_construction.png', 6004],
		'sailing:Sailing': ['skill_sailing.png', 11616]
	};

	for (const [skill_id, [asset, byte_length]] of Object.entries(bundled_icons)) {
		assert.equal(main.includes(`'${skill_id}': '${asset}'`), true);
		assert.equal((await readFile(new URL(`mod/assets/${asset}`, root))).byteLength, byte_length);
	}
	assert.match(main, /bundled_asset !== undefined[\s\S]*ctx\.getResourceUrl\('assets\/' \+ bundled_asset\)/);
	assert.equal((templates.match(/state\.get_status_activity_icon\(activity\)/g) ?? []).length, 2);
	assert.match(templates, /state\.get_skill_icon\(skill\.skill_id\)/);
});

test('observes status changes without heartbeats and sends bounded partial snapshots', async () => {
	const main = await read_client_source(root);
	const capture = main.slice(main.indexOf('function capture_status_skills'), main.indexOf('function schedule_status_sync'));
	const watcher = main.slice(main.indexOf('function observe_status_changes'), main.indexOf('function watch_equipment_view_actions'));

	assert.match(capture, /status_activities\.capture_status_activities\(game\)/);
	assert.match(capture, /status_activities\.capture_primary_status_activity\(game, activities\)/);
	assert.match(capture, /activities,/);
	assert.match(main, /function update_local_status_member\(snapshot\)/);
	assert.match(main, /if \(res\?\.success\) \{[\s\S]*update_local_status_member\(snapshot\);/);
	assert.match(capture, /skill_id/);
	assert.match(capture, /level/);
	assert.match(main, /serialized_skills !== last_synced_status_skills/);
	assert.match(main, /serialized_activity !== last_synced_status_activity/);
	assert.match(main, /serialized_activities !== last_synced_status_activities/);
	assert.match(main, /STATUS_MIN_SYNC_INTERVAL/);
	assert.match(main, /activity.type === 'skill'[^]*skill_id: activity.skill_id/);
	assert.match(main, /status_sync_in_flight/);
	assert.match(main, /watch_status_changes/);
	assert.match(main, /skill\.on\('levelChanged'/);
	assert.match(watcher, /serialized_activities === last_observed_status_activities/);
	assert.match(watcher, /schedule_status_sync\(\)/);
	assert.match(watcher, /setInterval\(observe_status_changes, STATUS_OBSERVER_INTERVAL\)/);
	assert.match(watcher, /clearInterval\(status_observer_timer\)/);
	assert.match(main, /const STATUS_OBSERVER_INTERVAL = 1000/);
	assert.match(main, /start_status_observer\(\)/);
	assert.doesNotMatch(main, /ctx\.patch\(prototype\.constructor, method_name\)/);
	assert.doesNotMatch(main, /patch_status_method/);
	assert.match(main, /schedule_status_sync\(0\)/);
	assert.doesNotMatch(capture, /quantity|qty|rate|duration|inventory|history/i);
});

test('collects changed raw GP in the status batch and keeps formatting viewer-local', async () => {
	const [templates, main, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);
	const member_list = templates.slice(
		templates.indexOf('<template v-for="(member, member_index) in state.guild_members">'),
		templates.indexOf('<div class="block-content text-center" v-if="state.is_free_fellowship')
	);

	assert.match(main, /const amount = Number\(game\.gp\?\.amount\)/);
	assert.match(main, /snapshot\.gp !== last_synced_gp/);
	assert.match(main, /payload\.gp = snapshot\.gp/);
	assert.match(main, /gp === last_observed_gp/);
	assert.match(main, /api_post\('\/api\/client\/gp\/visibility'/);
	assert.match(main, /format_shared_gp\(amount\)[^]*Number\.isSafeInteger\(amount\)[^]*formatNumber\(amount\)/);
	assert.match(member_list, /state\.format_shared_gp\(member\.gp\)/);
	assert.doesNotMatch(member_list, /formatNumber\(member\.gp\)/);
	assert.doesNotMatch(member_list, /formatted_gp|gp_formatted/);
	assert.equal(language.MOD_MP_GP_VISIBILITY, 'Let others see your GP');
});

test('renders compact roster separation and snapped last-seen labels', async () => {
	const [templates, main, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);

	assert.match(templates, /<hr class="mp-member-actions-rule mp-guild-member-rule" v-show="member_index < state\.guild_members\.length - 1">/);
	assert.doesNotMatch(templates, /<hr class="mp-member-actions-rule mp-guild-member-rule" v-if=/);
	assert.match(templates, /get_last_seen_lang_id\(member\.last_seen_at\)/);
	assert.match(main, /elapsed < 60 \* 60 \* 1000/);
	assert.match(main, /Math\.floor\(elapsed \/ \(60 \* 60 \* 1000\)\)/);
	assert.match(style, /\.mp-guild-member-rule \{[^}]*margin: 0 auto;/s);
});
