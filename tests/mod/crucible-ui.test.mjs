import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { install_crucible_actions } from '../../mod/client-crucible.mjs';
import * as crucible_rules from '../../mod/crucible-rules.mjs';
import * as transfer_currency_support from '../../mod/transfer-currencies.mjs';

test('Heat guide uses hosted-compatible images and bounds its navigation', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const template = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const css = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	const config = JSON.parse(await readFile(new URL('../../asset-hosting.json', import.meta.url), 'utf8'));
	const declaration = main.match(/const CRUCIBLE_GUIDE_STEPS = (\[[\s\S]*?\]);/);
	const steps = runInNewContext(declaration[1]);
	assert.equal(steps.length, 9);
	for (const [name] of steps) {
		const path = `assets/crucible-guide/${name}.png`;
		assert.ok(config.assets.includes(path), `${path} is managed by asset hosting`);
		const bytes = await readFile(new URL(`../../mod/${path}`, import.meta.url));
		assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
	}
	assert.deepEqual(Array.from(steps, step => step[0]), [
		'06-meld-flow', '01-cast-menu', '02-cast-quantity', '03-offering', '04-choose-wish',
		'05-wish-quantity', '07-forming', '08-claim-wish', '09-collect'
	]);
	assert.match(template, /:disabled="state\.crucible_guide_index === 0"/);
	assert.match(template, /:disabled="state\.crucible_guide_index >= state\.crucible_guide_length - 1"/);
	const image_effect = template.match(/<img v-effect="([^"]+)" alt="">/)[1];
	const attributes = new Map();
	const state = { crucible_panels_open: { heat: false }, crucible_guide_image: 'guide.png' };
	const $el = { setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name) };
	const update_image = () => runInNewContext(image_effect, { state, $el });
	update_image();
	assert.equal(attributes.has('src'), false);
	state.crucible_panels_open.heat = true;
	update_image();
	assert.equal(attributes.get('src'), 'guide.png');
	state.crucible_panels_open.heat = false;
	update_image();
	assert.equal(attributes.has('src'), false);
	assert.match(css, /\.mp-crucible-heat-body \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
	assert.match(css, /\.mp-crucible-heat-body \{ grid-template-columns: minmax\(0, 1fr\);/);
});

test('Heat starts expanded and restores each character and server preference across reloads', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const template = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const methods = main.slice(main.indexOf('\tload_crucible_heat_preference()'), main.indexOf('\tget crucible_guide_length()'));
	const saved = new Map();
	let scope = 'character-a:server-a:';
	const state = runInNewContext(`({ crucible_panels_open: { heat: true }, ${methods} })`, {
		get_instance_storage_item: key => saved.get(scope + key),
		set_instance_storage_item: (key, value) => saved.set(scope + key, value)
	});
	state.load_crucible_heat_preference();
	assert.equal(state.crucible_panels_open.heat, true);
	state.toggle_crucible_heat();
	state.crucible_panels_open.heat = true;
	state.load_crucible_heat_preference();
	assert.equal(state.crucible_panels_open.heat, false, 'collapsed choice survives reload');
	for (scope of ['character-b:server-a:', 'character-a:server-b:']) {
		state.load_crucible_heat_preference();
		assert.equal(state.crucible_panels_open.heat, true, 'other characters and servers default open');
	}
	scope = 'character-a:server-a:';
	state.load_crucible_heat_preference();
	state.toggle_crucible_heat();
	state.crucible_panels_open.heat = false;
	state.load_crucible_heat_preference();
	assert.equal(state.crucible_panels_open.heat, true, 'expanded choice survives reload');
	assert.match(main, /apply_server_configuration\(\);\s*state\.load_crucible_heat_preference\(\);/);
	assert.match(template, /@click="state\.toggle_crucible_heat\(\)"/);
});

test('every guide step has dedicated translated titles and visible descriptions, including live language changes', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const template = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const steps = runInNewContext(main.match(/const CRUCIBLE_GUIDE_STEPS = (\[[\s\S]*?\]);/)[1]);
	const getters = main.slice(main.indexOf('\tget crucible_guide_title_id()'), main.indexOf('\tget crucible_wish_item_name()'));
	const state = runInNewContext(`({ crucible_guide_index: 0, ${getters} })`, { CRUCIBLE_GUIDE_STEPS: steps });
	for (const locale of ['en', 'zh-CN', 'zh-TW', 'fr', 'de', 'pt', 'pt-br', 'it', 'ko', 'ja', 'es', 'ru', 'tr']) {
		const strings = JSON.parse(await readFile(new URL(`../../mod/data/lang/${locale}.json`, import.meta.url), 'utf8'));
		for (let index = 0; index < steps.length; index++) {
			state.crucible_guide_index = index;
			for (const key of [state.crucible_guide_title_id, state.crucible_guide_description_id]) {
				assert.match(key, /^MOD_MP_CRUCIBLE_GUIDE_/);
				assert.ok(strings[key]?.trim(), `${locale}:${key} must have tutorial copy`);
			}
		}
		for (const [, key] of template.matchAll(/lang-id="(MOD_MP_CRUCIBLE_GUIDE_NODE_[A-Z]+)"/g))
			assert.ok(strings[key]?.trim(), `${locale}:${key} must translate the infographic`);
	}
	// Native lang-string elements update both when the step changes and when Melvor changes language.
	assert.match(template, /<lang-string :lang-id="state\.crucible_guide_title_id"><\/lang-string>/);
	assert.match(template, /<figcaption[^>]*><lang-string :lang-id="state\.crucible_guide_description_id"><\/lang-string><\/figcaption>/);
	assert.doesNotMatch(template, /MOD_MP_CRUCIBLE_GUIDE_RECLAIM_NOTE|state\.crucible_guide_alt/);
});

test('Crucible entry owns hydration through Events and recovery, then restores polling', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const setter = main.slice(main.indexOf('function set_crucible_page_visible('), main.indexOf('// #endregion', main.indexOf('function set_crucible_page_visible(')));
	const start = main.indexOf("on_page_toggle('mp-crucible-page'");
	const callback = main.slice(start, main.indexOf('\n\t\t\t}, false);', start)) + '\n});';
	const eventsStart = main.indexOf("if (listing_filters === state.listing_filters.join(',') && Object.hasOwn(res, 'crucible_summary'))");
	const events = main.slice(eventsStart, main.indexOf('\n\t\tvoid maybe_auto_check_in_expedition', eventsStart));
	for (const summary of [true, false]) {
		let enter, tick, release, reads = 0, forced = 0, recoveries = 0;
		const context = { crucible_page_visible: false, crucible_page_entry: 0, expedition_leaderboard: null, crucible_page_hydrating: false,
			crucible_clock_timer: null, CRUCIBLE_CLOCK_INTERVAL: 30_000, document: {},
			listing_filters: '', state: { listing_filters: [], is_connected: true, refresh_crucible: async force => { reads++; if (force) forced++; } },
			polling: { is_foreground: () => true }, clearInterval() {}, setInterval: fn => { tick = fn; return 1; },
			update_crucible_nav() {}, recover_paid_wish_actions: async () => {},
			on_page_toggle: (_page, fn) => { enter = fn; },
			get_client_events: async () => {
				await new Promise(resolve => { release = resolve; });
				runInNewContext(events, { ...context, res: summary ? { crucible_summary: {} } : {} });
			}, refresh_guild_state: async () => {},
			recover_pending_crucible_wish_actions: async () => { recoveries++; } };
		runInNewContext(setter + callback, context);
		const first = enter(true);
		tick();
		assert.equal(reads, 0, 'visibility and clock must not race entry');
		release(); await first;
		assert.equal(reads, 1, 'Events must leave the full read to entry');
		assert.equal(recoveries, 1);
		assert.equal(context.crucible_page_hydrating, false);
		tick(); assert.equal(reads, 2, 'periodic refresh resumes');
		const stale = enter(true);
		const releaseStale = release;
		await enter(false);
		const current = enter(true);
		const releaseCurrent = release;
		releaseStale(); await stale;
		assert.equal(context.crucible_page_hydrating, true, 'stale entry cannot clear the new owner');
		await enter(false);
		releaseCurrent(); await current;
		assert.equal(forced, 2, 'leaving during Events cancels entry; only entry and clock forced reads ran');
		assert.equal(reads, summary ? 2 : 3, 'legacy Events fallback remains supported after leaving');
	}
});

test('Offering locks follow reclaim eligibility and clear when a partial reclaim becomes affordable', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const lock_expression = templates.match(/class="fa fa-lock mp-crucible-slot-lock" v-show="([^"]+)"/)[1];
	const quantity_expression = templates.match(/'mp-crucible-slot-quantity-locked': ([^}]+) }/)[1];
	const currency = { id: 'melvorItA:AbyssalSlayerCoins', amount: 0 };
	const sale_item = { id: 'test:ore', sellsFor: { currency } };
	const state = { crucible: { is_open: true, next_reclaim_at: 0 }, crucible_clock_time: 1_000,
		is_crucible_item_discovered: () => true };
	Object.assign(state, install_crucible_actions({ state, transfer_currency_support,
		game: { abyssalSlayerCoins: currency, items: { getObjectByID: () => sale_item },
			bank: { getItemSalePrice: (_item, qty) => qty * 100 } }
	}, crucible_rules));
	const currency_offering = { id: currency.id, qty: 3_000_000, blocked_until: 0 };
	const item_offering = { id: sale_item.id, qty: 10, blocked_until: 0 };
	const assert_locked = (item, expected) => {
		for (const expression of [lock_expression, quantity_expression])
			assert.equal(new Function('state', 'item', `return (${expression});`)(state, item), expected);
	};
	assert.equal(state.crucible_reclaim_quantity(currency_offering), 0);
	assert_locked(currency_offering, true);
	assert_locked(item_offering, true);
	currency.amount = 2;
	assert.equal(state.crucible_reclaim_quantity(currency_offering), 1);
	assert_locked(currency_offering, false);
	assert_locked(item_offering, true);
	currency.amount = 200;
	assert.equal(state.crucible_reclaim_quantity(item_offering), 1);
	assert_locked(item_offering, false);
	item_offering.blocked_until = 2_000;
	assert_locked(item_offering, true);
	state.crucible_clock_time = 2_000;
	assert_locked(item_offering, false);
	state.crucible.next_reclaim_at = 3_000;
	assert_locked(item_offering, true);
	state.crucible_clock_time = 3_000;
	assert_locked(item_offering, false);
	state.crucible.is_open = false;
	assert_locked(item_offering, true);
	state.crucible = null;
	assert_locked(item_offering, true);
});

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
	const actions = install_crucible_actions({ state, update_crucible_nav: () => { nav_updates++; },
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
	assert.match(template, /v-show="state\.crucible_error && !state\.crucible && !state\.service_status"><lang-string lang-id="MOD_MP_MULTIPLAYER_CONNECTION_ERR"/);
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
	const update = runInNewContext(main.slice(main.indexOf('function update_crucible_nav()'),
		main.indexOf('function update_guild_nav()')) + '\nupdate_crucible_nav;', {
		state, sidebar: { category: () => ({ item: () => ({}) }) }, document: { querySelector: () => aside },
		Date: { now: () => now }, set_nav_ready() {},
		getLangString: key => key === 'MOD_MP_SIDEBAR_CRUCIBLE_WISH' ? 'wish' : 'reclaim'
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
	const actions = install_crucible_actions({ state, update_crucible_nav() {}, api_get: async () => responses.shift(),
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
