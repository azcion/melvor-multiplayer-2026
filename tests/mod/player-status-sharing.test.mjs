import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('adds independent skills and activity visibility controls to member actions', async () => {
	const [templates, main, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);

	assert.match(templates, /MOD_MP_SKILLS_VISIBILITY/);
	assert.match(templates, /MOD_MP_ACTIVITY_VISIBILITY/);
	assert.match(templates, /state\.set_skills_visibility\(\$event\)/);
	assert.match(templates, /state\.set_activity_visibility\(\$event\)/);
	assert.match(templates, /state\.view_member_profile\(\$event\)/);
	assert.match(templates, /template-mp-profile-modal/);
	assert.match(main, /api_get\('\/api\/guilds\/equipment\?client_id=' \+ member\.client_id\)/);
	assert.match(main, /api_get\('\/api\/guilds\/status\?client_id=' \+ member\.client_id\)/);
	assert.match(main, /'\/api\/client\/skills\/visibility'/);
	assert.match(main, /api_post\('\/api\/client\/activity\/visibility'/);
	assert.equal(language.MOD_MP_PROFILE_VIEW, 'View Skills & Equipment');
	assert.equal(language.MOD_MP_SKILLS_VISIBILITY, 'Let others see your skills');
	assert.equal(language.MOD_MP_ACTIVITY_VISIBILITY, 'Let others see your activity');
	assert.doesNotMatch(templates, /MOD_MP_(?:LANGUAGE|ACCOUNT_AGE)_VISIBILITY/);
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
	assert.match(member_modal, /STATISTICS_ACCOUNT_AGE/);
	assert.match(member_modal, /STATISTICS_TOTAL_SKILL_LEVEL/);
	assert.match(member_modal, /state\.format_member_account_age\(state\.selected_guild_member\.account_age\)/);
	assert.match(member_modal, /state\.format_member_total_skill_level\(state\.selected_guild_member\.total_skill_level\)/);
	assert.match(member_modal, /<div class="mp-member-shared-stats">[\s\S]*<\/div>/);
	assert.equal((member_modal.match(/class="mp-member-shared-stat-label"/g) ?? []).length, 3);
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
	assert.match(templates, /class="mp-member-activity-icon" :src="state\.get_status_activity_icon\(activity\)"/);
	assert.match(style, /\.mp-member-activity-icon \{[^}]*width: 24px;[^}]*height: 24px;[^}]*object-fit: contain;[^}]*margin: 0;/s);
	assert.match(style, /\.mp-member-shared-stat-label \{[^}]*opacity: \.75;/s);
	assert.doesNotMatch(style, /\.mp-member-language \{/);
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
		'adventuring:Adventuring': ['skill_adventuring.svg', 1808],
		'enchanting:Enchanting': ['skill_enchanting.png', 2595],
		'invention:Invention': ['skill_invention.png', 903],
		'kru_archaeology:Archaeology': ['skill_archaeology.svg', 1072],
		'mythMusic:Music': ['skill_music.png', 2871],
		'namespace_profile:Profile': ['skill_profile.svg', 4310],
		'namespace_thuum:Thuum': ['skill_thuum.png', 14099],
		'necromancy:Necromancy': ['skill_necromancy.png', 2485],
		'occultism:Occultism': ['skill_occultism.png', 2437],
		'rielkConstruction:Construction': ['skill_construction.png', 3915],
		'sailing:Sailing': ['skill_sailing.png', 2736],
		'shamanism:Shamanism': ['skill_shamanism.png', 11112]
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
	assert.match(capture, /game\.stats\?\.General\?\.get\?\.\(GeneralStats\.AccountCreationDate\)/);
	assert.match(capture, /game\.completion\?\.skillLevelProgress\?\.currentCount\?\.getSum\?\.\(\)/);
	assert.match(main, /payload\.account_creation_date = snapshot\.account_creation_date/);
	assert.match(main, /payload\.total_skill_level = snapshot\.total_skill_level/);
	assert.match(main, /const serialized_skills = state\.skills_visible/);
	assert.match(main, /const serialized_activity = state\.activity_visible/);
	assert.match(main, /serialize_status_statistics\(snapshot, state\.skills_visible\)/);
	assert.match(main, /function status_statistics_sync_allowed\(\)[\s\S]*state\.split_visibility_supported/);
	assert.match(main, /function status_sync_allowed\(\)[\s\S]*state\.gp_visible/);
	assert.match(main, /statistics_sync_allowed && serialized_statistics !== last_synced_status_statistics/);
	assert.match(main, /serialized_statistics !== last_synced_status_statistics/);
	assert.match(main, /serialized_skills !== last_synced_status_skills/);
	assert.match(main, /serialized_activity !== last_synced_status_activity/);
	assert.match(main, /serialized_activities !== last_synced_status_activities/);
	assert.match(main, /STATUS_MIN_SYNC_INTERVAL/);
	assert.match(main, /status_activity_sync_signature\(activity\)/);
	assert.match(main, /status_activities_sync_signature\(activities\)/);
	assert.match(main, /status_sync_in_flight/);
	assert.match(main, /request_generation !== session_generation/);
	assert.match(main, /status_sync_failures = Math\.min\(status_sync_failures \+ 1, 5\)/);
	assert.match(main, /polling\.retry_poll_delay\(status_sync_failures\)/);
	assert.match(main, /if \(status_sync_pending\)[\s\S]*schedule_status_sync\(0\)/);
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
	assert.doesNotMatch(main, /last_observed_gp/);
	assert.match(main, /function start_gp_sampling\(count_initial_check = false\)/);
	assert.match(main, /gp_scheduled_checks\+\+/);
	assert.match(main, /polling\.event_poll_delay\(false, gp_scheduled_checks\)/);
	assert.match(main, /stop_gp_sampling\(\)/);
	assert.match(main, /api_post\('\/api\/client\/gp\/visibility'/);
	assert.match(main, /format_shared_gp\(amount\)[^]*Number\.isSafeInteger\(amount\)[^]*formatNumber\(amount\)/);
	assert.match(member_list, /state\.format_shared_gp\(member\.gp\)/);
	assert.doesNotMatch(member_list, /formatNumber\(member\.gp\)/);
	assert.doesNotMatch(member_list, /formatted_gp|gp_formatted/);
	assert.equal(language.MOD_MP_GP_VISIBILITY, 'Let others see your GP');
});

test('keeps Account Age in self-preview and suppresses unavailable Skills profiles', async () => {
	const [main, transfer, templates] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/client-actions-transfer.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8')
	]);

	assert.match(transfer, /const status = capture_status_snapshot\(\);/);
	assert.match(transfer, /const account_age = status\.account_creation_date === null/);
	assert.match(transfer, /this\.selected_guild_member\?\.account_age \?\? null/);
	assert.match(transfer, /member\.skills_visible === true && member\.skills_available === true/);
	assert.match(templates, /state\.viewed_status/);
	assert.match(main, /account_age: snapshot\.account_creation_date === null/);
});

test('renders compact roster separation and snapped last-seen labels', async () => {
	const [templates, main, style, language] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);

	assert.match(templates, /<hr class="mp-member-actions-rule mp-guild-member-rule" v-show="member_index < state\.guild_members\.length - 1">/);
	assert.doesNotMatch(templates, /<hr class="mp-member-actions-rule mp-guild-member-rule" v-if=/);
	assert.match(templates, /get_last_seen_lang_id\(member\.last_seen_at, member\.client_id === state\.guild_client_id\)/);
	assert.match(main, /get_last_seen_lang_id\(timestamp, is_current_member = false\)/);
	assert.match(main, /is_current_member\)[\s\S]*MOD_MP_LAST_SEEN_JUST_NOW/);
	assert.match(main, /elapsed < 5 \* 60 \* 1000/);
	assert.match(language, /MOD_MP_LAST_SEEN_JUST_NOW/);
	assert.match(main, /Math\.floor\(elapsed \/ \(60 \* 60 \* 1000\)\)/);
	assert.match(style, /\.mp-guild-member-rule \{[^}]*margin: 0 auto;/s);
});
