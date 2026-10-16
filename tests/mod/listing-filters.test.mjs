import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { install_transfer_actions } from '../../mod/client-actions-transfer.mjs';
import { create_listing_filter_prompt } from '../../mod/listing-filter-prompt.mjs';
import { install_crucible_actions } from '../../mod/client-crucible.mjs';

const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
const categories = ['items', 'time', 'resources', 'multitasking', 'shops', 'loot_rng'];

test('restores instance preferences and defaults only Item Cheats, preserving explicit opt-out', () => {
	const source = main.slice(main.indexOf('\tconst saved_listing_filters ='), main.indexOf('\tstate.expedition_state', main.indexOf('\tconst saved_listing_filters =')));
	const restore = new Function('state', 'get_instance_storage_item', source);
	for (const [stored, expected] of [[undefined, ['items']], [[], []], [['multitasking', 'unknown'], ['multitasking']]]) {
		const state = { listing_filter_categories: categories };
		restore(state, key => { assert.equal(key, 'listing_filters'); return stored; });
		assert.deepEqual(state.listing_filters, expected);
	}
});

test('toggles save preferences, reset pagination and refresh both views in either direction', async () => {
	const saved = []; const refreshed = [];
	const state = { listing_filter_categories: categories, listing_filters: ['items'], market_current_page: 4,
		is_connected: true, is_guild_member: true,
		refresh_crucible: async force => refreshed.push(['crucible', force]) };
	const actions = install_transfer_actions({ state,
		set_instance_storage_item: (...args) => saved.push(args),
		update_market_search: async () => refreshed.push(['market']) });
	await actions.toggle_listing_filter.call(state, 'multitasking');
	assert.deepEqual(saved[0], ['listing_filters', ['items', 'multitasking']]);
	assert.equal(state.market_current_page, 1);
	await actions.toggle_listing_filter.call(state, 'items');
	assert.deepEqual(state.listing_filters, ['multitasking']);
	await actions.toggle_listing_filter.call(state, 'unknown');
	assert.equal(saved.length, 2);
	assert.deepEqual(refreshed, [['market'], ['crucible', true], ['market'], ['crucible', true]]);
});

test('standalone section uses the same modal for startup and manual access', () => {
	const state = {}; const queued = [];
	const actions = install_transfer_actions({ state, queue_modal: (...args) => queued.push(args) });
	actions.open_listing_filters_settings.call(state);
	assert.equal(state.multiplayer_settings_section, 'listing_filters');
	assert.equal(queued[0][1], 'multiplayer-settings-modal');
	const settings = templates.slice(templates.indexOf('<template id="template-mp-multiplayer-settings-modal">'));
	assert.ok(settings.indexOf('MOD_MP_MULTIPLAYER_SETTINGS_CHAT') < settings.indexOf('MOD_MP_LISTING_FILTERS'));
	assert.equal((settings.match(/v-show="state.multiplayer_settings_section !== 'listing_filters'"/g) ?? []).length, 3);
	assert.match(settings, /class="badge mp-guild-cheats-badge"/);
	assert.match(main, /show: didOpen => state.open_listing_filters_settings\(\{ didOpen \}\)/);
	assert.match(main, /response.listing_filter_prompt_pending === true/);
});

test('Crucible refresh discards an outdated filter response and fetches the latest preferences', async () => {
	let resolveFirst; const urls = [];
	const state = { is_guild_member: true, is_connected: true, listing_filters: ['items'] };
	const actions = install_crucible_actions({ state, game: {},
		api_get: async url => { urls.push(url); if (urls.length === 1) return new Promise(resolve => { resolveFirst = resolve; });
			return { enabled: true, offerings: [], wishes: [] }; },
		filter_local_available_items: rows => rows, update_crucible_nav() {} }, { compare_crucible_offerings: () => 0 });
	const request = actions.refresh_crucible(true);
	await new Promise(resolve => setImmediate(resolve));
	state.listing_filters = ['multitasking'];
	const second = actions.refresh_crucible(true);
	resolveFirst({ enabled: true, offerings: [{ item_id: 'stale' }], wishes: [] });
	await Promise.all([request, second]);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepEqual(urls, ['/api/crucible/contents?listing_filters=items', '/api/crucible/contents?listing_filters=multitasking']);
	assert.deepEqual(state.crucible.offerings, []);
});

function prompt_harness() {
	const timers = [];
	let active = true, idle = false, pending = true, ack = true;
	const shown = []; const calls = [];
	const gate = create_listing_filter_prompt({
		current: () => active, idle: () => idle,
		pending: async () => { calls.push('status'); return pending; },
		show: onOpen => { shown.push(onOpen); return true; },
		acknowledge: async () => { calls.push('ack'); return ack; },
		schedule: fn => { timers.push(fn); return fn; },
		cancel: fn => { const i = timers.indexOf(fn); if (i >= 0) timers.splice(i, 1); }
	});
	return { gate, timers, shown, calls, set: values => {
		if ('active' in values) active = values.active;
		if ('idle' in values) idle = values.idle;
		if ('pending' in values) pending = values.pending;
		if ('ack' in values) ack = values.ack;
	}, tick: async () => { assert.ok(timers.length); await timers.shift()(); } };
}

test('startup prompt waits behind existing modals and acknowledges only on actual opening', async () => {
	const h = prompt_harness();
	await h.tick();
	h.set({ idle: true }); await h.tick();
	h.set({ idle: false }); await h.tick(); // A chained startup modal resets the quiet period.
	h.set({ idle: true }); await h.tick();
	assert.deepEqual(h.calls, []);
	await h.tick();
	assert.equal(h.shown.length, 1);
	assert.deepEqual(h.calls, ['status']);
	h.shown[0](); await Promise.resolve();
	assert.deepEqual(h.calls, ['status', 'ack']);
	assert.equal(h.timers.length, 0);
});

test('account already shown elsewhere skips the popup; stale and stopped sessions do nothing', async () => {
	for (const condition of ['seen', 'stale', 'stopped']) {
		const h = prompt_harness(); h.set({ idle: true });
		await h.tick();
		if (condition === 'seen') h.set({ pending: false });
		if (condition === 'stale') h.set({ active: false });
		if (condition === 'stopped') h.gate.stop();
		if (h.timers.length) await h.tick();
		assert.equal(h.shown.length, 0);
		assert.equal(h.timers.length, 0);
	}
});

test('failed status reads and acknowledgements retry without reopening or resetting filters', async () => {
	const h = prompt_harness(); h.set({ idle: true, pending: undefined });
	await h.tick(); await h.tick();
	assert.equal(h.shown.length, 0);
	h.set({ pending: true, ack: false });
	await h.tick(); await h.tick();
	h.shown[0](); await Promise.resolve(); await Promise.resolve();
	assert.equal(h.timers.length, 1);
	h.set({ ack: true }); await h.tick();
	assert.equal(h.shown.length, 1);
	assert.deepEqual(h.calls, ['status', 'status', 'ack', 'ack']);
});
