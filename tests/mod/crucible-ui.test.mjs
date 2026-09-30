import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { install_crucible_actions } from '../../mod/client-crucible.mjs';

test('mounted Crucible bindings tolerate cleared state after leaving a Guild', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const page = templates.slice(templates.indexOf('<template id="template-mp-crucible-page">'),
		templates.indexOf('<template id="template-mp-transfer-page">'));
	const expressions = [...page.matchAll(/(?:\bv-(?:if|else-if|for)|:[\w-]+)="([^"]+)"|\{\{\s*([^}]+?)\s*\}\}/g)]
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
	const actions = install_crucible_actions({ state,
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
	await actions.refresh_crucible(true);
	assert.match(state.crucible_error, /connection failed/);
	assert.equal(state.crucible, null);
	await actions.refresh_crucible(true);
	assert.deepEqual(state.crucible.offerings, []);
	assert.deepEqual(state.crucible.wishes, []);
	assert.equal(state.crucible_error, '');
	const template = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.match(template, /v-else-if="state\.crucible_error"><lang-string lang-id="MOD_MP_MULTIPLAYER_CONNECTION_ERR"/);
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
