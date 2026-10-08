import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { install_crucible_actions } from '../../mod/client-crucible.mjs';

test('mounted Crucible bindings tolerate cleared state after leaving a Guild', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const page = templates.slice(templates.indexOf('<template id="template-mp-crucible-page">'),
		templates.indexOf('<template id="template-mp-transfer-page">'));
	const expressions = [...page.matchAll(/(?:\bv-(?:if|else-if|show|for)|:[\w-]+)="([^"]+)"|\{\{\s*([^}]+?)\s*\}\}/g)]
		.map(match => match[1] ?? match[2])
		.filter(expression => /state\.crucible\b/.test(expression))
		.map(expression => expression.replace(/^\w+ of /, ''));
	assert.ok(expressions.length >= 20, 'covers heat, wishes, clearing, offerings, and reclaim bindings');
	const state = { crucible: null, crucible_busy: false, crucible_clock_time: 1_000,
		crucible_loading: false, crucible_time: value => value,
		crucible_selected_wish_id: 1, crucible_selected_offering_id: 'item' };
	const evaluate = expression => new Function('state', 'formatNumber', 'getLangString',
		`return (${expression});`)(state, String, key => key);
	// Reactive effects may run before the surrounding v-if branch is unmounted.
	for (const crucible of [null, {
		heat: { tier: 3, value: 500, points_per_minute: 4 }, is_open: true, level: 2,
		active_wish: null, wishes: [{ id: 1 }], offerings: [{ id: 'item' }], next_reclaim_at: 2_000
	}, null]) {
		state.crucible = crucible;
		for (const expression of expressions)
			assert.doesNotThrow(() => evaluate(expression), expression);
	}
});

test('Crucible keeps migration unavailability distinct from a failed load', async () => {
	const responses = [{ enabled: false }, new Error('connection failed'),
		{ enabled: true, offerings: [], wishes: [], wish_catalog: [] }];
	const state = { is_guild_member: true, is_social_only: false, is_connected: true,
		crucible: null, crucible_error: '', crucible_loading: false };
	let nav_updates = 0;
	const actions = install_crucible_actions({ state, update_charitree_nav: () => { nav_updates++; },
		api_get: async () => {
			const response = responses.shift();
			if (response instanceof Error) throw response;
			return response;
		},
		filter_local_available_items: rows => rows
	}, { compare_crucible_offerings: () => 0 });
	await actions.refresh_crucible(true);
	assert.equal(state.crucible, null);
	assert.equal(state.crucible_error, '');
	assert.equal(nav_updates, 1);
	await actions.refresh_crucible(true);
	assert.match(state.crucible_error, /connection failed/);
	assert.equal(state.crucible, null);
	await actions.refresh_crucible(true);
	assert.deepEqual(state.crucible.offerings, []);
	assert.deepEqual(state.crucible.wishes, []);
	assert.equal(state.crucible_error, '');
	const template = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.match(template, /v-show="state\.crucible_error && !state\.crucible"><lang-string lang-id="MOD_MP_MULTIPLAYER_CONNECTION_ERR"/);
});

test('Crucible countdown uses localized text for each time scale', () => {
	const previous = globalThis.getLangString;
	globalThis.getLangString = key => ({
		MOD_MP_CRUCIBLE_TIME_UNKNOWN: 'unknown-localized',
		MOD_MP_CRUCIBLE_TIME_LESS_THAN_MINUTE: 'soon-localized',
		MOD_MP_CRUCIBLE_TIME_MINUTES: '%s minutes-localized',
		MOD_MP_CRUCIBLE_TIME_HOURS: '%s hours-localized'
	})[key];
	try {
		const state = { crucible_clock_time: 1_000 };
		const actions = install_crucible_actions({ state }, {});
		assert.equal(actions.crucible_time(null), 'unknown-localized');
		assert.equal(actions.crucible_time(1_000), 'soon-localized');
		assert.equal(actions.crucible_time(121_000), '2 minutes-localized');
		assert.equal(actions.crucible_time(3_601_000), '1 hours-localized');
	} finally {
		globalThis.getLangString = previous;
	}
});

test('Crucible sidebar transitions from empty to claimable Wish or reclaim and hides all other states', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const data = JSON.parse(await readFile(new URL('../../mod/data.json', import.meta.url), 'utf8'));
	const css = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	assert.equal(data.data.pages.find(page => page.id === 'Crucible').sidebarItem.aside, '0');
	assert.match(css, /\.mp-crucible-nav:not\(\.mp-nav-ready\)/);
	assert.match(css, /\.mp-crucible-nav \{\s*background-color: #581500/);
	const aside = { textContent: '', hidden: true, classList: { toggle() {} } };
	const state = { guild_state_loaded: true, is_connected: true, is_guild_member: true, is_social_only: false,
		crucible: { is_open: true, offerings: [], wishes: [], active_wish: false },
		crucible_reclaim_block(offering) {
			return offering.block || (offering.blocked_until > this.crucible_clock_time ? 'locked' :
				this.crucible.next_reclaim_at > this.crucible_clock_time ? 'cooldown' : null);
		} };
	let now = 1000;
	const update = runInNewContext(main.slice(main.indexOf('function update_charitree_nav()'),
		main.indexOf('function update_guild_nav()')) + '\nupdate_charitree_nav;', {
		state, sidebar: { category: () => ({ item: () => ({}) }) }, document: { querySelector: () => aside },
		Date: { now: () => now }, set_nav_ready() {},
		getLangString: key => key === 'MOD_MP_SIDEBAR_CHARITY_WISH' ? 'wish' : 'reclaim'
	});
	update();
	assert.equal(aside.textContent, '');
	assert.equal(aside.hidden, true);
	state.crucible.offerings = [{ blocked_until: 2000 }];
	update();
	assert.equal(aside.hidden, true);
	now = 2000;
	update();
	assert.equal(aside.textContent, 'reclaim');
	assert.equal(aside.hidden, false);
	state.crucible.next_reclaim_at = 3000;
	update();
	assert.equal(aside.hidden, true);
	now = 3000;
	update();
	assert.equal(aside.textContent, 'reclaim');
	state.crucible.offerings = [{ block: 'value' }];
	update();
	assert.equal(aside.hidden, true);
	for (const wish of [{ phase: 'forming', owned: true }, { phase: 'melding', owned: true },
		{ phase: 'melded', owned: false }]) {
		state.crucible.wishes = [wish];
		update();
		assert.equal(aside.hidden, true);
	}
	state.crucible.wishes = [{ phase: 'melded', owned: true }];
	state.crucible.offerings = [{}];
	update();
	assert.equal(aside.textContent, 'wish');
	assert.equal(aside.hidden, false);
	for (const changes of [{ crucible: null }, { crucible: { is_open: false } },
		{ is_social_only: true }, { is_guild_member: false }, { is_connected: false }, { guild_state_loaded: false }]) {
		const previous = { ...state };
		Object.assign(state, changes);
		update();
		assert.equal(aside.textContent, '');
		assert.equal(aside.hidden, true);
		Object.assign(state, previous);
	}
	assert.ok(main.indexOf('void state.refresh_crucible();', main.indexOf('async function get_client_events_request')) <
		main.indexOf('if (res.unchanged === true)', main.indexOf('async function get_client_events_request')));
});


test('Crucible preserves a usable snapshot through failed refreshes and recovers without reload', async () => {
	const snapshot = { enabled: true, is_open: true, offerings: [], wishes: [], wish_catalog: [] };
	const responses = [snapshot, null, { ...snapshot, level: 2 }];
	const state = { is_guild_member: true, is_social_only: false, is_connected: true };
	const actions = install_crucible_actions({ state, update_charitree_nav() {}, api_get: async () => responses.shift(),
		filter_local_available_items: rows => rows }, { compare_crucible_offerings: () => 0 });
	await actions.refresh_crucible(true);
	const previous = state.crucible;
	await actions.refresh_crucible(true);
	assert.equal(state.crucible, previous);
	assert.ok(state.crucible_error);
	assert.equal(state.crucible_loading, false);
	await actions.refresh_crucible(true);
	assert.equal(state.crucible.level, 2);
	assert.equal(state.crucible_error, '');
});

test('Crucible state transitions keep conditional anchors mounted for the shared UI queue', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const page = templates.slice(templates.indexOf('<template id="template-mp-crucible-page">'),
		templates.indexOf('<template id="template-mp-transfer-page">'));
	assert.doesNotMatch(page, /v-(?:if|else|else-if)\b/);
	assert.doesNotMatch(page, /<template[^>]+v-show/);
	assert.match(page, /class="mp-crucible-content" v-show="state.crucible"/);
});
