import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { read_client_source } from './source.mjs';
import { create_offline_work_gate } from '../../mod/offline-work-gate.mjs';

const drain = () => new Promise(resolve => setImmediate(resolve));
function native_game(now) {
	const listeners = new Map();
	return {
		_isInOnlineLoop: true, _forceOfflineLoop: false, tickTimestamp: now, MIN_OFFLINE_TIME: 60000,
		on(event, handler) { const set = listeners.get(event) ?? new Set(); set.add(handler); listeners.set(event, set); },
		off(event, handler) { listeners.get(event)?.delete(handler); },
		emit(event) { for (const handler of listeners.get(event) ?? []) handler(); },
		count(event) { return listeners.get(event)?.size ?? 0; }
	};
}

test('waits for all six offline hours, then reconciles once before status resumes', async () => {
	let now = 6 * 3600000;
	const game = native_game(0);
	let counter = 0;
	const reports = [];
	const order = [];
	const gate = create_offline_work_gate({ now: () => now,
		reconcile: async () => { reports.push(counter); order.push('report'); return true; },
		on_resumed: () => { assert.equal(gate.pending(), false); order.push('status'); } });
	gate.start(game);
	gate.request(); // Character/session hooks can fire before the first offline loop.
	await drain();
	assert.equal(gate.pending(), true);
	assert.deepEqual(reports, []);
	game._isInOnlineLoop = false;
	game.emit('offlineLoopEntered');
	for (let part = 1; part <= 12; part++) {
		counter = part * 1800000;
		now += 1000;
		await gate.pump();
		assert.deepEqual(reports, []);
	}
	game.tickTimestamp = now;
	game._isInOnlineLoop = true;
	game.emit('offlineLoopExited');
	await drain();
	await gate.pump();
	assert.deepEqual(reports, [21600000]);
	assert.deepEqual(order, ['report', 'status']);
	// A foreground return can also race the next native offline entry.
	now += 120000;
	assert.equal(gate.pending(), true);
	await gate.pump();
	assert.equal(reports.length, 1);
	game._isInOnlineLoop = false;
	game.emit('offlineLoopEntered');
	game.tickTimestamp = now;
	game._isInOnlineLoop = true;
	game.emit('offlineLoopExited');
	await drain();
	assert.equal(reports.length, 2);
});

test('handles forced loops, native loading, and native Golbin Raid exemption', async () => {
	let loading = false;
	const game = native_game(100000);
	const gate = create_offline_work_gate({ now: () => 100000, is_loading: () => loading,
		reconcile: async () => true, on_resumed() {} });
	gate.start(game);
	game._forceOfflineLoop = true;
	assert.equal(gate.blocked(), true);
	game.isGolbinRaid = true;
	assert.equal(gate.blocked(), false);
	loading = true;
	assert.equal(gate.blocked(), true);
	loading = false;
	game._isInOnlineLoop = false;
	assert.equal(gate.blocked(), true);
});

test('serializes reconciliation and discards completion after a new loop or character', async () => {
	const game = native_game(0);
	const completions = [];
	let resumed = 0;
	const gate = create_offline_work_gate({ now: () => 0,
		reconcile: () => new Promise(resolve => completions.push(resolve)), on_resumed: () => resumed++ });
	gate.start(game);
	gate.request();
	gate.request();
	await gate.pump();
	assert.equal(completions.length, 1);
	game._isInOnlineLoop = false;
	game.emit('offlineLoopEntered');
	completions.shift()(true);
	await drain();
	assert.equal(resumed, 0);
	game._isInOnlineLoop = true;
	game.emit('offlineLoopExited');
	await drain();
	assert.equal(completions.length, 1);
	gate.stop();
	completions.shift()(true);
	await drain();
	assert.equal(resumed, 0);
	assert.equal(game.count('offlineLoopEntered'), 0);
	assert.equal(game.count('offlineLoopExited'), 0);
	game.emit('offlineLoopExited');
	assert.equal(completions.length, 0);
	gate.start(game);
	gate.start(game);
	assert.equal(game.count('offlineLoopEntered'), 1);
	assert.equal(game.count('offlineLoopExited'), 1);
	gate.request();
	completions.shift()(true);
	await drain();
	assert.equal(resumed, 1);
});

test('retries unavailable reconciliation without releasing partial snapshots', async () => {
	let now = 0;
	let calls = 0;
	let resumed = 0;
	const game = native_game(now);
	const gate = create_offline_work_gate({ now: () => now,
		reconcile: async () => { calls++; if (calls === 1) throw Error('network'); return calls > 2; },
		on_resumed: () => resumed++, on_error() {} });
	gate.start(game);
	await gate.pump();
	assert.equal(gate.pending(), true);
	await gate.pump();
	assert.equal(calls, 1);
	now += 5000;
	await gate.pump();
	assert.equal(gate.pending(), true);
	now += 5000;
	await gate.pump();
	assert.equal(resumed, 1);
});

function section(main, from, to) { return main.slice(main.indexOf(from), main.indexOf(to, main.indexOf(from))); }

// Execute the production coordinator and report functions together, with only the native game/network replaced.
async function client({ saved = null } = {}) {
	const main = await read_client_source();
	let now = 21600000;
	const game = native_game(0);
	let time_ms = 0;
	let activities = [{ type: 'skill', skill_id: 'melvorD:Smithing' }];
	const sent = [];
	const notifications = [];
	const tracking = { expedition_id: 1, visit_id: 2, task_id: 'smith', session_id: 3 };
	const state = { is_connected: true, expedition_state: { contract_version: 1, tracking }, expedition_personal: null,
		expedition_pending_report: null };
	let stored = saved;
	const context = { game, state, offline_work_gate: null, status_sync_in_flight: false,
		session_generation: 1, expedition_page_visible: false, expedition_work_prompt_gate: null,
		EXPEDITION_PENDING_KEY: 'pending', EXPEDITION_AUTO_CHECK_IN_INTERVAL: 600000,
		Date: { now: () => now }, crypto: { randomUUID: () => 'fresh-report' },
		ctx: { loadModule: async () => ({ create_offline_work_gate: options => create_offline_work_gate({ ...options, now: () => now }) }) },
		polling: { is_foreground: () => true }, document: {}, performance: { now: () => 0 },
		get_instance_storage_item: () => stored, set_instance_storage_item: (key, value) => { stored = value; },
		remove_instance_storage_item: () => { stored = null; },
		capture_status_activities: () => structuredClone(activities),
		capture_expedition_work_statistics: () => ({ version: 1, time_ms: { 'melvorD:Smithing': time_ms } }),
		api_post: async (endpoint, payload) => { sent.push({ endpoint, payload });
			return { success: true, tracking, settlement: { credited_ms: 1, reason: 'verified' } }; },
		read_expedition_state: async () => { state.expedition_state = { contract_version: 1, tracking }; return state.expedition_state; },
		expedition_view: { tracked_task_ended: () => false },
		expedition_notify: value => notifications.push(value), notify_expedition_tracking_ended() {},
		expedition_text: key => key, expedition_hours: value => value, expedition_status: value => value,
		getLangString: key => key, transport_diagnostics: null, update_expedition_nav() {},
		schedule_status_sync: () => sent.push({ endpoint: 'status' }), log() {},
		setTimeout: () => 1, clearTimeout() {},
	};
	const source = section(main, 'async function refresh_expedition_state(', 'function update_expedition_supply_qty') +
		section(main, 'async function retry_expedition_report(', 'async function vote_expedition_exit(') +
		section(main, 'function status_sync_allowed()', 'function schedule_status_sync(') +
		section(main, "\tconst { create_offline_work_gate }", "\tconst { create_asset_url_resolver }");
	runInNewContext(`(async () => { ${source}\nglobalThis.functions = { refresh_expedition_state, retry_expedition_report, submit_expedition_work, maybe_auto_check_in_expedition, status_sync_allowed }; })()`, context);
	await drain();
	context.offline_work_gate.start(game);
	return { context, game, sent, notifications, set_time: value => { time_ms = value; },
		set_activities: value => { activities = value; },
		finish: () => { game.tickTimestamp = now; game._isInOnlineLoop = true; game.emit('offlineLoopExited'); } };
}

test('production reporting defers reconnect, timer, manual and saved-report paths until counters finish', async () => {
	const c = await client();
	const { context: x, game } = c;
	x.offline_work_gate.request();
	await x.functions.refresh_expedition_state(true);
	await x.functions.submit_expedition_work('stop');
	await x.functions.maybe_auto_check_in_expedition();
	assert.equal(x.functions.status_sync_allowed(), false);
	assert.deepEqual(c.sent, []);
	game._isInOnlineLoop = false;
	game.emit('offlineLoopEntered');
	c.set_time(10800000);
	await x.functions.refresh_expedition_state(true);
	await x.functions.submit_expedition_work('check-in', 'smith');
	assert.deepEqual(c.sent, []);
	assert.deepEqual(c.notifications, []);
	// The skill can run out of resources during offline processing. Send its final state, not the initial activity.
	c.set_activities([]);
	c.set_time(21600000);
	c.finish();
	await drain();
	assert.equal(c.sent.length, 2);
	assert.equal(c.sent[0].endpoint, '/api/expedition/task/check-in');
	assert.equal(c.sent[0].payload.statistics.time_ms['melvorD:Smithing'], 21600000);
	assert.equal(c.sent[0].payload.activities.length, 0);
	assert.equal(c.sent[1].endpoint, 'status');
	assert.equal(x.functions.status_sync_allowed(), true);
	await x.offline_work_gate.pump();
	assert.equal(c.sent.length, 2);
});

test('production recovery replays an immutable saved report then captures the final offline statistics', async () => {
	const saved = { endpoint: '/api/expedition/task/check-in', payload: { operation_id: 'saved-report', captured_at: 100,
		statistics: { version: 1, time_ms: { 'melvorD:Smithing': 50 } } } };
	const original = structuredClone(saved);
	const c = await client({ saved });
	c.context.offline_work_gate.request();
	c.context.state.expedition_pending_report = saved;
	await c.context.functions.retry_expedition_report(true);
	assert.equal(c.sent.length, 0);
	c.set_time(21600000);
	c.finish();
	await drain();
	assert.equal(c.sent.length, 3);
	assert.equal(c.sent[0].payload, saved.payload);
	assert.deepEqual(saved, original);
	assert.equal(c.sent[1].payload.operation_id, 'fresh-report');
	assert.equal(c.sent[1].payload.statistics.time_ms['melvorD:Smithing'], 21600000);
	assert.equal(c.sent[2].endpoint, 'status');
});

test('keeps production status sync paused after a failed state read and retries reconciliation', async () => {
	const c = await client();
	const x = c.context;
	const read = x.read_expedition_state;
	x.read_expedition_state = async () => null;
	c.finish();
	await drain();
	assert.equal(x.functions.status_sync_allowed(), false);
	assert.equal(c.sent.length, 0);
	x.read_expedition_state = read;
	// A new authenticated session requests immediate recovery, clearing network retry backoff.
	x.offline_work_gate.request();
	await drain();
	assert.equal(c.sent[0].endpoint, '/api/expedition/task/check-in');
	assert.equal(c.sent[1].endpoint, 'status');
});

test('an offline loop starting during a lost response suppresses its automatic retry', async () => {
	const c = await client();
	const x = c.context;
	let respond;
	x.api_post = async (endpoint, payload) => {
		c.sent.push({ endpoint, payload });
		return new Promise(resolve => { respond = resolve; });
	};
	c.finish();
	await drain();
	assert.equal(c.sent.length, 1);
	const report = x.state.expedition_pending_report;
	c.game._isInOnlineLoop = false;
	c.game.emit('offlineLoopEntered');
	respond(null);
	await drain();
	assert.equal(c.sent.length, 1);
	assert.equal(x.state.expedition_pending_report, report);
	assert.equal(x.functions.status_sync_allowed(), false);
});

test('defers notifications from pre-existing requests until offline completion and discards them on character change', async () => {
	const game = native_game(0);
	const gate = create_offline_work_gate({ now: () => 0, reconcile: async () => true, on_resumed() {} });
	gate.start(game);
	const main = await read_client_source();
	const shown = [];
	const context = { offline_work_gate: gate, session_generation: 1,
		ctx: { getResourceUrl: value => value }, notifyPlayer: (icon, message) => shown.push(message) };
	runInNewContext(section(main, 'function expedition_notify(', 'let last_expedition_tracking_notice_session'), context);
	game._isInOnlineLoop = false;
	game.emit('offlineLoopEntered');
	context.expedition_notify('credited');
	assert.deepEqual(shown, []);
	game._isInOnlineLoop = true;
	game.emit('offlineLoopExited');
	await drain();
	assert.deepEqual(shown, ['credited']);
	game._isInOnlineLoop = false;
	game.emit('offlineLoopEntered');
	context.expedition_notify('old-character');
	gate.start(native_game(0));
	gate.request();
	await drain();
	assert.deepEqual(shown, ['credited']);
});

test('the production status sender cannot capture an intermediate activity or statistic snapshot', async () => {
	const c = await client();
	const x = c.context;
	const main = await read_client_source();
	x.capture_status_snapshot = () => { throw Error('intermediate snapshot captured'); };
	x.status_sync_allowed = x.functions.status_sync_allowed;
	runInNewContext(section(main, 'async function flush_status_sync()', 'function observe_status_changes()'), x);
	await x.flush_status_sync(); // Before the native loop has noticed the overdue ticks.
	c.game._isInOnlineLoop = false;
	c.game.emit('offlineLoopEntered');
	c.set_activities([]);
	c.set_time(10800000);
	await x.flush_status_sync();
	assert.equal(c.sent.length, 0);
});

test('production reconciliation drops an old session response before submitting a report', async () => {
	const c = await client();
	const x = c.context;
	let respond;
	x.read_expedition_state = () => new Promise(resolve => { respond = resolve; });
	c.finish();
	await drain();
	x.session_generation++;
	x.offline_work_gate.request();
	respond({ contract_version: 1, tracking: x.state.expedition_state.tracking });
	await drain();
	assert.equal(c.sent.length, 0);
	assert.equal(x.functions.status_sync_allowed(), false);
});
