import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('registers Guild as a Multiplayer page instead of a modal', async () => {
	const [data, templates, main] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);

	const guild_page = data.data.pages.find(page => page.id === 'Guild');
	assert.equal(guild_page.containerID, 'mp-guild-page');
	assert.equal(guild_page.sidebarItem.categoryID, 'Multiplayer');
	assert.match(templates, /template-mp-guild-page/);
	assert.doesNotMatch(templates, /template-mp-guild-modal/);
	assert.doesNotMatch(templates, /template-mp-guild-browser-modal/);
	assert.match(main, /changePage\(game\.pages\.getObjectByID\('multiplayer:Guild'\)\)/);
});

test('keeps Guild styling on Melvor typography', async () => {
	const style = await readFile(new URL('mod/ui/style.css', root), 'utf8');

	assert.match(style, /\.mp-guild-page-layout/);
	assert.match(style, /\.mp-guild-summary h3,[\s\S]*color: inherit !important/);
	assert.doesNotMatch(style, /font-family|@font-face|fonts?\.google/i);
});

test('renders localized paginated Guild Activity responsively and refreshes it on page open', async () => {
	const [english, chinese, templates, style, main] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/lang/zh-CN.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		read_client_source(root)
	]);

	assert.equal(english.MOD_MP_GUILD_ACTIVITY, 'Activity');
	assert.equal(typeof chinese.MOD_MP_GUILD_ACTIVITY, 'string');
	assert.equal(english.MOD_MP_GUILD_ACTIVITY_MARKET_BOUGHT, 'You bought %s %s from %s.');
	assert.equal(english.MOD_MP_GUILD_ACTIVITY_MARKET_BOUGHT_BY, '%s bought %s %s from you.');
	assert.equal(english.MOD_MP_GUILD_ACTIVITY_MARKET_SOLD, 'You sold %s %s to %s.');
	assert.equal(english.MOD_MP_GUILD_ACTIVITY_MARKET_SOLD_TO, '%s sold you %s %s.');
	assert.equal(english.MOD_MP_GUILD_ACTIVITY_PRIVATE, '🔒 only you');
	assert.match(templates, /mp-guild-activity-scroll/);
	assert.match(templates, /state\.get_guild_activity_lang_id\(event\)/);
	assert.match(templates, /state\.get_guild_activity_arg_3\(event\)/);
	assert.match(templates, /event\.private/);
	assert.match(templates, /state\.load_more_guild_activity\(\)/);
	assert.match(templates, /<div class="block-content p-0 mp-guild-activity-scroll">[\s\S]*\n\t\t\t\t\t\t\t<div class="block-content text-center" v-show="state\.guild_activity_cursor !== null">[\s\S]*state\.load_more_guild_activity\(\)/);
	assert.match(templates, /block-content mp-member-search-wrapper/);
	assert.match(templates, /block-content p-0 mp-guild-members-scroll/);
	assert.match(style, /#mp-guild-page\s*\{[\s\S]*padding-bottom: 3rem !important/);
	assert.match(style, /\.mp-guild-members-scroll,[\s\S]*\.mp-guild-activity-scroll\s*\{[\s\S]*max-height: 50rem;[\s\S]*overflow-y: auto/);
	assert.match(style, /\.mp-guild-activity-event\s*\{[\s\S]*padding: 4px 16px/);
	assert.match(style, /\.mp-guild-activity-meta\s*\{[\s\S]*justify-content: space-between[\s\S]*gap: 1rem/);
	assert.match(style, /\.mp-guild-activity-private\s*\{[\s\S]*margin-left: auto[\s\S]*white-space: nowrap/);
	assert.match(style, /\.mp-guild-activity-event \.font-size-sm\.text-muted\s*\{[\s\S]*opacity: 0\.75/);
	assert.match(style, /\.mp-member-search-wrapper\s*\{[\s\S]*padding: 0 1\.25rem 1px/);
	assert.match(style, /@media \(max-width: 767\.98px\)[\s\S]*\.mp-guild-activity[\s\S]*order: -1/);
	assert.match(style, /@media \(max-width: 767\.98px\)[\s\S]*\.mp-guild-activity-scroll\s*\{[\s\S]*max-height: 8rem/);
	assert.match(main, /api_get\(endpoint\)/);
	assert.match(main, /refresh_shadowed_members\(\), refresh_guild_activity\(\)/);
	const activity_state_actions = main.slice(main.indexOf('Object.assign('), main.indexOf('modal_queue_guard =', main.indexOf('Object.assign(')));
	assert.match(activity_state_actions, /load_more_guild_activity,\s*get_guild_activity_lang_id,\s*get_guild_activity_arg_1,\s*get_guild_activity_arg_2,\s*get_guild_activity_arg_3,\s*format_guild_activity_time/);
	assert.match(main, /event\.event_type === 'market_bought'[\s\S]*formatNumber\(event\.metadata\.quantity\)/);
	assert.match(main, /state\.get_item_name\(event\.metadata\.item_id\)/);
});

test('wires Free Fellowship direct joining and its no-Council presentation', async () => {
	const [lang, templates, main] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);

	assert.equal(lang.MOD_MP_FREE_FELLOWSHIP_CONFIRM_PUBLIC.includes('application'), true);
	assert.equal(lang.MOD_MP_FREE_FELLOWSHIP_CONFIRM_IDENTITY, undefined);
	assert.match(main, /\/api\/guilds\/join-free/);
	assert.match(main, /is_free_fellowship/);
	assert.match(templates, /free-fellowship-confirm-modal/);
	assert.match(templates, /v-if="guild\.is_free_fellowship"/);
	assert.match(templates, /!state\.is_free_fellowship && state\.guild_state\.guild\?\.capabilities\?\.council/);
});

test('renders open ordinary Guilds with a direct Join action', async () => {
	const [lang, templates, main] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);

	assert.equal(lang.MOD_MP_BUTTON_JOIN, 'Join');
	assert.match(lang.MOD_MP_PUBLIC_GUILD_LABEL, /join without an application/);
	assert.match(templates, /v-else-if="guild\.is_public" @click="state\.join_guild\(\$event, guild\)"/);
	assert.match(main, /api_post\('\/api\/guilds\/join', \{ guild_id: guild\.guild_id \}\)/);
});

test('does not render member-only Guild bindings during an incomplete state refresh', async () => {
	const [templates, main] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);
	const guild_page = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'));
	const member_view = guild_page.slice(0, guild_page.indexOf('<div v-show="state.guild_page_view === \'applicant\'">'));
	const is_member_getter = main.slice(main.indexOf('get is_guild_member()'), main.indexOf('get is_free_fellowship()'));

	assert.match(is_member_getter, /this\.guild_state\.guild != null/);
	assert.match(member_view, /<div v-show="state\.guild_page_view === 'member'">/);
	assert.match(member_view, /state\.guild_state\.guild\?\.icon_id/);
	assert.match(member_view, /state\.guild_state\.guild\?\.name/);
	assert.match(member_view, /state\.guild_state\.guild\?\.capabilities\?\.council/);
});

test('keeps top-level Guild views mounted when affiliation changes', async () => {
	const [templates, main] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);
	const guild_page = templates.slice(
		templates.indexOf('<template id="template-mp-guild-page">'),
		templates.indexOf('<template id="template-mp-free-fellowship-confirm-modal">')
	);
	const page_view_getter = main.slice(main.indexOf('get guild_page_view()'), main.indexOf('get is_charitree_enabled()'));

	assert.match(page_view_getter, /return 'member'/);
	assert.match(page_view_getter, /return 'applicant'/);
	assert.match(page_view_getter, /return 'error'/);
	assert.match(page_view_getter, /return 'loading'/);
	assert.match(page_view_getter, /return this\.guild_state\.affiliation === 'none' \? 'onboarding' : 'loading'/);
	for (const view of ['member', 'applicant', 'error', 'loading', 'onboarding'])
		assert.match(guild_page, new RegExp(`v-show="state\\.guild_page_view === '${view}'"`));
	assert.doesNotMatch(guild_page, /v-(?:if|else-if)="state\.guild_page_view/);
	assert.match(guild_page, /state\.guild_state\.application\?\.icon_id/);
	assert.match(guild_page, /state\.guild_state\.application\?\.member_count \?\? 0/);
	assert.match(guild_page, /mp-council" v-show="!state\.is_free_fellowship/);
	assert.match(guild_page, /block-content mp-member-search-wrapper" v-show="state\.is_free_fellowship/);
});

test('cache-busts authenticated GETs without using the Android-sensitive Fetch cache mode', async () => {
	const [lang, templates, main] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);
	const cache_buster_start = main.indexOf('function cache_bust_api_endpoint');
	const cache_buster_source = main.slice(cache_buster_start, main.indexOf('\nasync function api_get', cache_buster_start));
	const cache_bust_api_endpoint = new Function(`
		let API_GET_CACHE_NONCE = 'runtime-nonce';
		let api_get_request_sequence = 0;
		${cache_buster_source}
		return cache_bust_api_endpoint;
	`)();
	const api_get = main.slice(main.indexOf('async function api_get'), main.indexOf('async function api_post_response'));
	const guild_page = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'));
	const loading = guild_page.indexOf("v-show=\"state.guild_page_view === 'loading'\"");
	const failure = guild_page.indexOf("v-show=\"state.guild_page_view === 'error'\"");
	const onboarding = guild_page.indexOf("v-show=\"state.guild_page_view === 'onboarding'\"");

	assert.match(main, /const API_GET_CACHE_NONCE = crypto\.randomUUID\(\);/);
	assert.equal(cache_bust_api_endpoint('/api/guilds/state'), '/api/guilds/state?_mp_cache=runtime-nonce-1');
	assert.equal(
		cache_bust_api_endpoint('/api/events?after=42'),
		'/api/events?after=42&_mp_cache=runtime-nonce-2'
	);
	assert.match(api_get, /polling\.fetch_with_timeout\(fetch, server_host \+ cache_bust_api_endpoint\(endpoint\)/);
	assert.match(api_get, /return res\.status === 200 \? await res\.json\(\) : null/);
	assert.doesNotMatch(api_get, /cache\s*:/);
	assert.equal(lang.MOD_MP_GUILD_LOADING, 'Loading Guild...');
	assert.equal(typeof lang.MOD_MP_GUILD_LOAD_FAILED, 'string');
	assert.notEqual(loading, -1);
	assert.notEqual(failure, -1);
	assert.notEqual(onboarding, -1);
});

test('tears down the leave confirmation modal before refreshing Guild state', async () => {
	const main = await read_client_source(root);
	const leave_action_start = main.indexOf('\tasync leave_guild(event)');
	const leave_action = main.slice(leave_action_start, main.indexOf("notify('MOD_MP_GUILD_LEFT')", leave_action_start));

	assert.match(leave_action, /await this\.close_modal_and_wait\('leave-guild-modal'\);[\s\S]*await refresh_guild_page\(\);/);
	assert.doesNotMatch(leave_action, /await refresh_guild_page\(\);[\s\S]*close_modal/);
});

test('refreshes the open Guild roster after changing the current profile', async () => {
	const main = await read_client_source(root);
	const social_actions = main.slice(main.indexOf('async confirm_display_name(event)'), main.indexOf('pick_guild_icon(icon)'));
	const display_name_action = social_actions.slice(
		social_actions.indexOf('async confirm_display_name(event)'),
		social_actions.indexOf('show_display_name_modal()')
	);
	const icon_action = social_actions.slice(
		social_actions.indexOf('async confirm_icon_pick(event)'),
		social_actions.indexOf('show_icon_modal()')
	);

	assert.match(display_name_action, /await this\.close_modal_and_wait\('change-display-name-modal'\);[\s\S]*await refresh_guild_state\(true\);/);
	assert.match(icon_action, /await this\.close_modal_and_wait\('change-icon-modal'\);[\s\S]*await refresh_guild_state\(true\);/);
});

test('does not structurally detach UI branches when Guild membership changes', async () => {
	const [templates, main] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root)
	]);

	assert.doesNotMatch(templates, /v-if="[^"]*state\.(?:is_guild_member|is_free_fellowship|is_charitree_enabled)/);
	assert.match(main, /get is_charitree_enabled\(\) \{[\s\S]*return this\.is_guild_member/);
});

test('keeps Free Fellowship confirmation titles localized and guild results responsive', async () => {
	const [lang, templates, main, style] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);

	assert.equal(lang.MOD_MP_BUTTON_JOIN, 'Join');
	assert.match(main, /queue_modal\('MOD_MP_FREE_FELLOWSHIP_CONFIRM_TITLE',[\s\S]*\}, true, false\)/);
	assert.match(templates, /class="mp-guild-result-details"/);
	assert.match(templates, /class="mp-guild-result-actions"/);
	assert.doesNotMatch(templates, /MOD_MP_FREE_FELLOWSHIP_CONFIRM_IDENTITY/);
	assert.match(style, /\.mp-guild-result \{[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) auto;/);
	assert.match(style, /\.mp-guild-result-actions \{[\s\S]*align-items: flex-end;/);
	assert.doesNotMatch(style, /\.mp-guild-result \.badge \{[\s\S]*display: none/);
});

test('renders each loaded member activity as a right-aligned icon', async () => {
	const [templates, main, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const roster_refresh = main.slice(
		main.indexOf('async function refresh_guild_state'),
		main.indexOf('async function refresh_guild_list')
	);
	const guild_page = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'));
	const members_header = guild_page.slice(
		guild_page.indexOf('<h3 class="block-title"><lang-string lang-id="MOD_MP_GUILD_MEMBERS">'),
		guild_page.indexOf('<div class="block-content mp-member-search-wrapper" v-show="state.is_free_fellowship">')
	);
	const member_list = guild_page.slice(
		guild_page.indexOf('<div class="block-content p-0 mp-guild-members-scroll">'),
		guild_page.indexOf('<div class="block-content text-center" v-show="state.is_free_fellowship')
	);

	assert.doesNotMatch(members_header, /badge badge-secondary/);
	assert.match(main, /status_activity: member\.status_activity \?\? null/);
	assert.match(main, /status_activities: Array\.isArray\(member\.status_activities\) \? member\.status_activities : \[\]/);
	assert.doesNotMatch(main, /refresh_guild_member_statuses/);
	assert.doesNotMatch(roster_refresh, /api_get\('\/api\/guilds\/status\?client_id=' \+ member\.client_id\)/);
	assert.match(member_list, /state\.get_status_activities\(member\)\.slice\(0, 3\)/);
	assert.match(member_list, /state\.get_status_activities\(member\)\.length - 3/);
	assert.match(member_list, /MOD_MP_GUILD_YOU[\s\S]*get_status_activity_icon\(activity\)/);
	assert.match(member_list, /state\.format_shared_gp\(member\.gp\)/);
	assert.match(member_list, /member\.last_seen_at/);
	assert.match(member_list, /v-else-if="state\.is_new_guild_member\(member\.joined_at\)"/);
	assert.match(member_list, /MOD_MP_GUILD_NEW_MEMBER/);
	assert.match(main, /Math\.max\(0, Date\.now\(\) - timestamp\) <= 48 \* 60 \* 60 \* 1000/);
	assert.match(style, /\.mp-guild-new-member-badge \{[\s\S]*background-color: #269e70;/);
	assert.match(style, /\.mp-guild-member-meta \{[\s\S]*margin-left: auto;/);
	assert.match(style, /\.mp-member-actions > label \{[\s\S]*justify-content: flex-start;/);
});

test('tucks Shadowed members behind a normal-action modal at the bottom of the Guild page', async () => {
	const [templates, main, language_text] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		read_client_source(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_text);
	const guild_page = templates.slice(templates.indexOf('<template id="template-mp-guild-page">'));
	const member_view = guild_page.slice(0, guild_page.indexOf('<div v-show="state.guild_page_view === \'applicant\'">'));

	assert.match(templates, /template-mp-shadowed-members-modal/);
	assert.match(templates, /v-for="member in state\.shadowed_members"/);
	assert.match(templates, /state\.open_shadowed_member_actions\(member\)/);
	assert.match(main, /api_get\('\/api\/guilds\/members\/shadowed\?page='/);
	assert.match(main, /state\.shadowed_member_count = Number\.isSafeInteger\(res\.total\)/);
	assert.match(main, /open_shadowed_member_actions\(member\)[\s\S]*this\.show_member_actions\(member\)/);
	assert.match(member_view, /mp-shadowed-members-entry" v-show="state\.shadowed_member_count > 0"[\s\S]*MOD_MP_GUILD_VIEW_SHADOWED_MEMBERS/);
	assert.ok(member_view.lastIndexOf('mp-shadowed-members-entry') > member_view.lastIndexOf('mp-council'));
	assert.equal(language.MOD_MP_GUILD_SHADOWED, 'Shadowed');
	assert.equal(language.MOD_MP_GUILD_VIEW_SHADOWED_MEMBERS, 'View Shadowed Members');
});
