import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('adds player status visibility and combined profile viewing to member actions', async () => {
	const [templates, main, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8'),
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

test('renders only local skill icons, levels, and a minimal activity indicator', async () => {
	const [templates, main, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const profile_modal = templates.slice(
		templates.indexOf('<template id="template-mp-profile-modal">'),
		templates.indexOf('<template id="template-mp-leave-guild-modal">')
	);

	assert.match(profile_modal, /state\.viewed_status_skills/);
	assert.match(profile_modal, /state\.get_skill_icon\(skill\.skill_id\)/);
	assert.match(profile_modal, /skill\.level/);
	assert.match(profile_modal, /state\.get_skill_level_cap\(skill\.skill_id\)/);
	assert.match(profile_modal, /state\.profile_active_tab = 'skills'/);
	assert.match(profile_modal, /state\.profile_active_tab = 'equipment'/);
	assert.match(profile_modal, /state\.viewed_status_activity_icon/);
	assert.match(profile_modal, /state\.viewed_status_activity_name/);
	assert.doesNotMatch(profile_modal, /state\.viewed_status\.activity/);
	assert.doesNotMatch(profile_modal, /qty|quantity|rate|duration|inventory|history/i);
	assert.match(main, /didClose: \(\) => \{[\s\S]*this\.viewed_status = null;/);
	assert.match(main, /viewed_status_activity_icon[\s\S]*this\.viewed_status\?\.activity/);
	assert.match(main, /viewed_status_activity_name[\s\S]*this\.viewed_status\?\.activity/);
	assert.match(main, /customClass: \{ popup: 'mp-profile-modal-popup' \}/);
	assert.match(main, /get_registered_game_objects\(game\.skills\)[\s\S]*skill_order/);
	assert.match(style, /\.mp-status-skills[\s\S]*grid-template-columns: repeat\(3/);
	assert.match(style, /\.mp-profile-modal-popup \.mp-status-skill img[\s\S]*width: 24px;[\s\S]*height: 24px;[\s\S]*margin: 0;/);
	assert.match(style, /\.mp-profile-modal-popup \.badge\.badge-secondary\.mp-status-skill-level[\s\S]*font-size: 60%;/);
	assert.match(style, /\.mp-profile-modal-popup \.swal2-image[\s\S]*margin: \.5rem auto;/);
	assert.match(style, /\.mp-profile-modal-popup #swal2-title[\s\S]*font-size: 1\.5rem;/);
	assert.match(style, /\.mp-profile-modal-popup \.mp-profile-panel-title[\s\S]*display: none;/);
});

test('observes status snapshots without patching shared game methods or sending a heartbeat', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const capture = main.slice(main.indexOf('function capture_status_skills'), main.indexOf('function schedule_status_sync'));
	const watcher = main.slice(main.indexOf('function observe_status_changes'), main.indexOf('function watch_equipment_view_actions'));

	assert.match(capture, /game\.skills/);
	assert.match(capture, /game\.activeAction/);
	assert.match(capture, /active_action\.masteryAction/);
	assert.match(capture, /skill_id/);
	assert.match(capture, /level/);
	assert.match(capture, /type: 'skill'/);
	assert.match(capture, /type: 'combat'/);
	assert.match(main, /serialized === last_synced_status/);
	assert.match(main, /status_sync_in_flight/);
	assert.match(main, /watch_status_changes/);
	assert.match(main, /skill\.on\('levelChanged'/);
	assert.match(watcher, /serialized === last_observed_status/);
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
