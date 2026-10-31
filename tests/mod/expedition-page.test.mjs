import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext as run_vm } from 'node:vm';

import * as expedition_tasks from '../../mod/expedition-tasks.mjs';
import { read_client_source } from './source.mjs';
import { create_pending_economy_actions } from '../../mod/pending-economy-actions.mjs';
import { apply_economy_receipt } from '../../mod/economy-receipts.mjs';

function runInNewContext(source, context) {
	context.offline_work_gate ??= null;
	return run_vm(source, context);
}

const root = new URL('../../', import.meta.url);

test('alerts once when tracking ends or switches, while continuing check-ins stay quiet', async () => {
	const main = await read_client_source(root);
	const notices = [];
	const notify = runInNewContext(main.slice(main.indexOf('let last_expedition_tracking_notice_session'),
		main.indexOf('function start_expedition_action_cooldown')) + '\nnotify_expedition_tracking_ended;', {
		addModalToQueue: notice => notices.push(notice), getLangString: key => key, session_generation: 0
	});
	const previous = { session_id: 1, expedition_id: 2, visit_id: 3, task_id: 'study' };
	notify(null, previous, 'Started');
	notify(previous, { ...previous, session_id: 4 }, 'Checked in');
	assert.equal(notices.length, 0);
	notify(previous, null, 'Stopped');
	notify(previous, null, 'Replayed');
	assert.equal(notices.length, 1);
	assert.equal(notices[0].text, 'Stopped');
	assert.equal(notices[0].timer, 4000);
	assert.equal(notices[0].showConfirmButton, false);
	const switched = { ...previous, session_id: 5 };
	notify(switched, { ...switched, task_id: 'scout' }, 'Switched');
	assert.equal(notices.length, 2);
	const boundary = { ...previous, session_id: 6, pending_boundary_at: 100 };
	notify({ ...boundary, pending_boundary_at: null }, boundary, 'Verification pending');
	notify(boundary, null, 'Settled later');
	assert.equal(notices.length, 3);
	assert.equal(notices[2].text, 'Verification pending');
	const completed = { ...previous, session_id: 7 };
	notify(completed, { ...completed, visit_id: 8 }, 'Chamber changed');
	assert.equal(notices.length, 4);
});

test('recovers one Expedition supply command and applies its receipt once after reload', async () => {
	const saved = new Map();
	const sent = [];
	let bank_qty = 12;
	let processed = [];
	let response_lost = true;
	const receipt = { id: 'supply-command', kind: 'expedition-supply-donate',
		effects: [{ storage: 'bank', item_id: 'melvorD:Shrimp', qty: -5 }] };
	const adapter = {
		has_bank_item: id => id === 'melvorD:Shrimp', get_bank_qty: () => bank_qty,
		remove_bank_item: (id, qty) => { bank_qty -= qty; },
		get_transfer_inventory: () => [], maximum_transfer_entries: 6,
		persist_processed_ids: ids => { processed = ids; }
	};
	const options = {
		read: key => saved.get(key), write: (key, value) => saved.set(key, structuredClone(value)),
		remove: key => saved.delete(key), uuid: () => 'supply-command',
		post: async (endpoint, payload) => {
			sent.push({ endpoint, payload: structuredClone(payload) });
			return response_lost ? null : { success: true, receipt };
		},
		reconcile: async receipts => receipts.every(value =>
			['applied', 'already-applied'].includes(apply_economy_receipt(value, processed, adapter)))
	};
	const payload = { expedition_id: 7, item_id: 'melvorD:Shrimp', qty: 5, source: 'bank' };
	await create_pending_economy_actions(options).run('expedition_supply_donate', '/api/expedition/supply/donate', payload);
	assert.equal(bank_qty, 12);
	assert.equal(saved.size, 1);
	response_lost = false;
	await create_pending_economy_actions(options).run('expedition_supply_donate', '/api/expedition/supply/donate', payload);
	assert.deepEqual(sent[1], sent[0]);
	assert.equal(bank_qty, 7);
	assert.equal(saved.size, 0);
	assert.equal(apply_economy_receipt(receipt, processed, adapter), 'already-applied');
	assert.equal(bank_qty, 7);
});

test('renders phased Chamber work, accepted activities, and obscured passages', async () => {
	const [main, templates, style] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const page = templates.slice(templates.indexOf('<template id="template-mp-expedition-page">'),
		templates.indexOf('</template>', templates.indexOf('<template id="template-mp-expedition-page">'))) +
		templates.slice(templates.indexOf('<template id="template-mp-expedition-passages">'),
			templates.indexOf('</template>', templates.indexOf('<template id="template-mp-expedition-passages">')));
	const chamber = page.slice(page.indexOf('id="mp-expedition-chamber-view"'),
		page.indexOf('id="mp-expedition-journey-view"'));
	assert.match(main, /ctx\.loadModule\('expedition-view\.mjs'\)/);
	assert.match(main, /expedition_view\.sync_phase_state\(state, result\.expedition\?\.chamber\)/);
	assert.match(page, /state\.toggle_expedition_phase\(phase\)/);
	assert.match(page, /state\.expedition_phase_tasks\(state\.expedition_state\?\.expedition\?\.chamber, phase, group\)/);
	assert.match(page, /\['done', 'active', 'pending'\]/);
	assert.match(page, /state\.expedition_text\('MOD_MP_EXPEDITION_TRACKING_TITLE'/);
	assert.match(page, /v-for="skill_id in task\.evidence\?\.skill_ids \|\| \[\]"/);
	assert.match(page, /mp-expedition-work-icons-only/);
	assert.match(page, /<span v-if="group !== 'done'">\{\{ state\.expedition_work_name\(skill_id\) \}\}<\/span>/);
	assert.match(page, /:aria-label="state\.expedition_work_name\(skill_id\)"/);
	assert.match(page, /fa fa-check-circle/);
	assert.match(page, /fa-chevron-up/);
	assert.match(page, /state\.expedition_remaining\(task\)/);
	assert.match(page, /:disabled="[^\"]*!state\.expedition_can_track\(task\)/);
	assert.match(page, /state\.submit_expedition_work\('start', task\.task_id\)/);
	assert.match(page, /state\.submit_expedition_work\('check-in'\)/);
	assert.match(page, /state\.vote_expedition_exit\(edge\.id\)/);
	assert.match(page, /vote\?\.opened_at != null \|\| state\.expedition_state\?\.expedition\?\.chamber\?\.vote\?\.locked_at != null/);
	assert.doesNotMatch(page, /exits\?\.length > 1 \|\| state\.expedition_state\?\.expedition\?\.chamber\?\.preview_exit_id/);
	assert.match(page, /expedition_check_in_cooldown_until > 0/);
	assert.match(page, /expedition_vote_cooldown_until > 0/);
	assert.match(page, /MOD_MP_EXPEDITION_UI_WHILE_IN_PREVIEW/);
	assert.match(page, /mp-expedition-progress-wrap" :class="\{ 'mp-expedition-progress-done': group === 'done' \}"[\s\S]*?<div v-if="group !== 'done'">/);
	assert.match(style, /\.mp-expedition-progress-done \{[^}]*flex: 0 0 100%/);
	assert.match(main, /else if \(expedition_view\.tracked_task_ended\(result\)\)\s+await submit_expedition_work\('stop', null, true\)/);
	assert.match(main, /EXPEDITION_VOTE_COOLDOWN = 1000/);
	assert.match(main, /EXPEDITION_CHECK_IN_COOLDOWN = 10 \* 1000/);
	assert.match(page, /state\.expedition_passage_name\(edge\.slot/);
	assert.match(page, /state\.expedition_exit_art_url\(edge\.label\)/);
	assert.match(page, /state\.expedition_exit_gateway_url\(state\.expedition_state\?\.expedition\?\.chamber\?\.id, edge\.slot\)/);
	assert.match(page, /mp-expedition-exit-unknown" v-if="edge\.label === '\?\?\?'/);
	assert.match(style, /\.mp-expedition-exit-unknown \{[^}]*radial-gradient/);
	assert.match(style, /\.mp-expedition-exit-art \{[^}]*aspect-ratio: 16 \/ 9/);
	assert.match(style, /\.mp-expedition-exit-art \.mp-expedition-exit-background \{[^}]*blur\(15px\)/);
	assert.match(page, /MOD_MP_EXPEDITION_UI_THE_RIFT/);
	assert.match(chamber, /MOD_MP_EXPEDITION_UI_GATHERING_FOR_THE_EXPEDITION/);
	assert.match(chamber, /<strong>\{\{ state\.expedition_state\?\.expedition\?\.registered_count \}\}<\/strong> <lang-string lang-id="MOD_MP_EXPEDITION_UI_REGISTERED"/);
	assert.match(chamber, /MOD_MP_EXPEDITION_UI_YOU_ARE_REGISTERED/);
	assert.match(chamber, /MOD_MP_EXPEDITION_PREPARATIONS_HINT/);
	assert.match(page, /chamber\?\.preparation \? getLangString\('MOD_MP_EXPEDITION_PERSONAL'\)/);
	assert.doesNotMatch(page, /expedition_supply|MOD_MP_EXPEDITION_UI_EXPEDITION_STASH|expedition-supply-modal/);
	assert.match(page, /chamber\?\.preparation \? getLangString\('MOD_MP_EXPEDITION_PREPARATIONS'\)/);
	assert.match(page, /mp-expedition-chamber-card" v-if="!state\.expedition_state\?\.expedition\?\.chamber\?\.preparation"/);
	assert.doesNotMatch(chamber, /Registration open|Current chamber|The Rift opens after registration closes|The Rift Stash|Visited Chambers/);
	assert.equal(page.match(/<h3><lang-string lang-id="MOD_MP_EXPEDITION_UI_VISITED_CHAMBERS"/g)?.length, 1);
	assert.doesNotMatch(chamber, /Test controls|Complete task for test|Depth |Tracking side/);
	assert.match(page, /role="tablist" :aria-label="getLangString\('MOD_MP_EXPEDITION_VIEWS'\)"/);
	assert.match(page, /mp-expedition-mobile-hidden/);
	assert.match(page, /<details class="mp-expedition-panel mp-expedition-debug-controls"/);
	assert.match(page, /v-if="state\.expedition_pending_report && state\.expedition_report_notice_visible"/);
	assert.match(main, /EXPEDITION_PENDING_KEY = 'expedition_pending_report'/);
	assert.match(main, /set_instance_storage_item\(EXPEDITION_PENDING_KEY, pending\)/);
	assert.match(main, /remove_instance_storage_item\(EXPEDITION_PENDING_KEY\)/);
	assert.match(main, /offline_work_gate\?\.request\(\)/);
});

test('continues capturing activities independently of profile sharing', async () => {
	const main = await read_client_source(root);
	const snapshot = main.slice(main.indexOf('function capture_status_snapshot'), main.indexOf('function update_local_status_member'));
	const sync = main.slice(main.indexOf('async function flush_status_sync'), main.indexOf('function observe_status_changes'));

	assert.match(snapshot, /const activities = capture_status_activities\(\);[\s\S]*\bactivities,/);
	assert.match(sync, /payload\.activities = snapshot\.activities/);
	assert.match(sync, /payload\.work_statistics = capture_expedition_work_statistics\(\)/);
	assert.doesNotMatch(sync, /state\.activity_visible/);
});

test('checks in after ten foreground minutes and reuses pending reports without overlapping actions', async () => {
	const main = await read_client_source(root);
	let now = 0;
	let foreground = true;
	const submitted = [];
	const retried = [];
	const state = { is_connected: true, expedition_loading: false, expedition_action_pending: false,
		expedition_pending_report: null, expedition_state: { tracking: { task_id: 'chart' } } };
	const auto = runInNewContext('let last_expedition_check_in_at = 0;\n' +
		main.slice(main.indexOf('async function maybe_auto_check_in_expedition()'),
			main.indexOf('async function submit_expedition_work(')) + '\nmaybe_auto_check_in_expedition;', {
		state, Date: { now: () => now }, EXPEDITION_AUTO_CHECK_IN_INTERVAL: 600_000,
		polling: { is_foreground: () => foreground }, document: {},
		submit_expedition_work: async (...args) => submitted.push(args),
		retry_expedition_report: async (...args) => retried.push(args)
	});
	assert.match(main, /const EXPEDITION_AUTO_CHECK_IN_INTERVAL = 10 \* 60_000/);
	const event_loop = main.slice(main.indexOf('async function get_client_events_request('), main.indexOf('function start_client_event_polling('));
	assert.match(event_loop, /void maybe_auto_check_in_expedition\(\)/);
	await auto();
	now = 599_999;
	await auto();
	assert.equal(submitted.length, 0);
	now = 600_000;
	foreground = false;
	await auto();
	assert.equal(submitted.length, 0);
	foreground = true;
	state.expedition_action_pending = true;
	await auto();
	state.expedition_action_pending = false;
	await auto();
	await auto();
	assert.deepEqual(submitted, [['check-in', 'chart', true, true]]);
	now += 600_000;
	state.expedition_pending_report = { payload: { operation_id: 'saved', captured_at: 1 } };
	await auto();
	assert.deepEqual(retried, [[true, true]]);
	assert.equal(submitted.length, 1);
	now += 600_000;
	state.expedition_pending_report = null;
	state.expedition_state.tracking.pending_boundary_at = 1;
	await auto();
	assert.equal(submitted.length, 1);
	state.expedition_state = null;
	state.expedition_personal = { tracking: { task_id: 'old-task' } };
	await auto();
	assert.deepEqual(submitted[1], ['check-in', 'old-task', true, true]);
	now += 600_000;
	state.is_connected = false;
	await auto();
	assert.equal(submitted.length, 2);
	state.is_connected = true;
	state.expedition_loading = true;
	await auto();
	assert.equal(submitted.length, 2);
});


test('an automatic report does not retry or clear state after switching character or server', async () => {
	const main = await read_client_source(root);
	let sent = 0;
	const state = { expedition_pending_report: { endpoint: '/saved', payload: { operation_id: 'old' } } };
	const context = { state, session_generation: 1, setTimeout: () => 1, clearTimeout() {}, api_post: async () => {
		sent++;
		context.session_generation++;
		state.expedition_pending_report = { payload: { operation_id: 'new' } };
		state.expedition_action_pending = true;
		return null;
	} };
	await runInNewContext(main.slice(main.indexOf('async function retry_expedition_report('),
		main.indexOf('async function maybe_auto_check_in_expedition()')) + '\nretry_expedition_report(true, true);', context);
	assert.equal(sent, 1);
	assert.equal(state.expedition_pending_report.payload.operation_id, 'new');
	assert.equal(state.expedition_action_pending, true);
});

test('eligible work prompt waits for startup modals and starts tracking without navigation', async () => {
	const main = await read_client_source(root);
	let now = 0;
	let modal_visible = true;
	const queued = [];
	const writes = [];
	const activities = [{ type: 'skill', skill_id: 'melvorD:Astrology' }];
	const state = { is_connected: true, is_guild_member: true, expedition_work_tracking_mode: 'prompt',
		expedition_active_activities: activities, expedition_state: { expedition: { status: 'active', registered: true,
			chamber: { tasks: [{ task_id: 'chart', unlocked_at: 1, completed_at: null,
				evidence: { skill_ids: ['melvorD:Astrology'] } }] } } } };
	const context = { state, expedition_tasks, session_generation: 1, Date: { now: () => now },
		Swal: { isVisible: () => modal_visible, close() {} }, modal_queue_guard: { pending_templates: new Set() },
		polling: { is_foreground: () => true }, document: { querySelector: () => queued.length ? {} : null },
		capture_status_activities: () => activities, refresh_expedition_state: async () => true,
		queue_modal: (...args) => { queued.push(args); return true; }, getLangString: key => key,
		set_instance_storage_item: (key, value) => writes.push([key, value]),
		submit_expedition_work: async (kind, task_id) => { state.expedition_state.tracking = { task_id }; },
		close_modal_and_wait: async id => { assert.equal(id, 'expedition-work-prompt-modal'); }
	};
	const actions = runInNewContext(main.slice(main.indexOf('let expedition_work_prompt_gate'),
		main.indexOf('function expedition_notify')) +
		'\n({ maybe_prompt_expedition_work, start_prompted_expedition_task, set_expedition_work_tracking_mode });', context);
	await actions.maybe_prompt_expedition_work(activities);
	now = 8000;
	await actions.maybe_prompt_expedition_work(activities);
	assert.equal(queued.length, 0);
	modal_visible = false;
	now = 9500;
	await actions.maybe_prompt_expedition_work(activities);
	assert.equal(queued.length, 1);
	assert.equal(queued[0][3].confirmButtonText, 'MOD_MP_EXPEDITION_NOT_NOW');
	assert.equal(queued[0][3].buttonsStyling, false);
	assert.equal(queued[0][3].customClass.confirmButton, 'mp-expedition-button mp-expedition-button-secondary');
	await actions.maybe_prompt_expedition_work(activities);
	assert.equal(queued.length, 1);
	await actions.start_prompted_expedition_task('chart');
	assert.equal(state.expedition_state.tracking.task_id, 'chart');
	actions.set_expedition_work_tracking_mode({ target: { value: 'manual' } });
	assert.deepEqual(writes, [['expedition_work_tracking_mode', 'manual']]);
});

test('a delayed prompt refresh cannot open after the character or server changes', async () => {
	const main = await read_client_source(root);
	let now = 0;
	let finish_refresh;
	const activities = [{ type: 'combat' }];
	const context = { state: { expedition_work_tracking_mode: 'prompt', is_guild_member: true }, expedition_tasks,
		session_generation: 1, Date: { now: () => now }, Swal: { isVisible: () => false },
		modal_queue_guard: { pending_templates: new Set() },
		refresh_expedition_state: () => new Promise(resolve => { finish_refresh = resolve; }),
		queue_modal: () => { assert.fail('stale session queued a prompt'); } };
	const maybe_prompt = runInNewContext(main.slice(main.indexOf('let expedition_work_prompt_gate'),
		main.indexOf('function expedition_notify')) + '\nmaybe_prompt_expedition_work;', context);
	await maybe_prompt(activities);
	now = 8000;
	const pending = maybe_prompt(activities);
	context.session_generation = 2;
	finish_refresh();
	await pending;
});

test('work prompt keeps task cards and Not now outside its mobile scroll surface', async () => {
	const html = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const css = await readFile(new URL('mod/ui/style.css', root), 'utf8');
	const prompt = html.slice(html.indexOf('<template id="template-mp-expedition-work-prompt-modal">'));
	assert.match(prompt, /v-for="task in state.expedition_prompt_tasks\(\)"/);
	assert.match(prompt, /state.start_prompted_expedition_task\(task.task_id\)/);
	assert.match(prompt, /mp-expedition-progress/);
	assert.match(prompt, /MOD_MP_EXPEDITION_AVAILABLE_TO_EARN/);
	assert.doesNotMatch(prompt, /phase, group|v-if="true"|preventDefault/);
	assert.match(css, /\.mp-expedition-prompt-tasks \{[^}]*overflow-y: scroll[^}]*touch-action: pan-y[^}]*overscroll-behavior-y: contain/);
});

test('active Chamber exposes the work prompt preference below Your EP', async () => {
	const html = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const active_start = html.indexOf('<div v-if="state.expedition_state?.expedition?.chamber">');
	assert.ok(active_start >= 0);
	const start = html.indexOf('<div class="mp-expedition-chamber-copy">', active_start);
	assert.ok(start > active_start);
	assert.equal([...html.matchAll(/<fieldset class="mp-expedition-work-modes"/g)].length, 2);
	const chamber_copy = html.slice(start, html.indexOf('</div>', start));
	assert.match(chamber_copy, /MOD_MP_EXPEDITION_UI_YOUR_EP[\s\S]*mp-expedition-work-modes/);
	assert.match(chamber_copy, /type="radio"/);
	assert.match(chamber_copy, /@change="state.set_expedition_work_tracking_mode\(\$event\)"/);
});

test('Required labels use a class for bold inherited color on page and prompt cards', async () => {
	const html = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const css = await readFile(new URL('mod/ui/style.css', root), 'utf8');
	const labels = [...html.matchAll(/<span class="mp-expedition-task-requirement"[^>]*>/g)].map(match => match[0]);
	assert.equal(labels.length, 2);
	for (const label of labels) {
		assert.match(label, /:class="\{ 'mp-expedition-task-required': task.promoted_at \|\| task.requirement === 'required'/);
		assert.match(label, /task.requirement === 'conditional' && task.exit_id === state.expedition_state/);
		assert.doesNotMatch(label, /style=/);
	}
	assert.match(css, /\.mp-expedition-task-required \{ font-weight: bold; color: inherit; \}/);
});

test('tracking allowance binding survives tracking stopping before its conditional subtree unmounts', async () => {
	const html = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const binding = [...html.matchAll(/{{\s*([^{}]*reward_remaining_ms[^{}]*)\s*}}/g)][0]?.[1];
	assert.ok(binding, 'saved allowance display exists');
	const state = { expedition_state: { tracking: { reward_remaining_ms: 3_600_000 } },
		expedition_points: points => points };
	assert.equal(runInNewContext(binding, { state }), 1_000_000);
	state.expedition_state.tracking = null;
	assert.equal(runInNewContext(binding, { state }), 0);
	state.expedition_state = null;
	assert.equal(runInNewContext(binding, { state }), 0);
});

test('mobile Journey starts with shared passages and its vote badge', async () => {
	const html = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const css = await readFile(new URL('mod/ui/style.css', root), 'utf8');
	const main = await read_client_source(root);
	assert.match(html, /id="mp-expedition-journey-view"[^>]*>\s*<div class="mp-expedition-mobile-passages" v-scope="\{ \$template: '#template-mp-expedition-passages' \}"/);
	assert.match(html, /mp-expedition-desktop-passages" v-scope="\{ \$template: '#template-mp-expedition-passages' \}"/);
	assert.match(html, /mp-expedition-vote-badge" v-if="state.expedition_needs_vote\(\)"/);
	assert.equal(html.match(/class="mp-expedition-panel mp-expedition-passage-overview"/g)?.length, 1);
	assert.match(css, /\.mp-expedition-mobile-passages \{ display: none; \}/);
	assert.match(css, /@media \(max-width: 767\.98px\) \{\s*\.mp-expedition-shell[^}]*\}\s*\.mp-expedition-desktop-passages \{ display: none; \}\s*\.mp-expedition-mobile-passages \{ display: block; \}/);
	assert.match(main, /expedition_needs_vote: \(\) => expedition_view.needs_passage_vote\(state.expedition_state\)/);
});


test('captures Magic time under the active skill ID and enables its Expedition requirement', async () => {
	const main = await read_client_source(root);
	const capture = runInNewContext(main.slice(main.indexOf('function capture_expedition_work_statistics()'),
		main.indexOf('function format_expedition_activities')) + '\ncapture_expedition_work_statistics;', {
		game: { stats: { Magic: { get: id => id === 1 ? 42_000 : 0 } } }
	});
	const statistics = capture();
	assert.equal(statistics.time_ms['melvorD:Magic'], 42_000);
	assert.equal(statistics.time_ms['melvorD:AltMagic'], undefined);
	assert.equal(expedition_tasks.can_track_task({ evidence: { skill_ids: ['melvorD:Magic'] } },
		[{ type: 'skill', skill_id: 'melvorD:Magic', action_id: 'melvorD:Superheat' }]), true);
});

test('retains fractional Expedition time counters as whole milliseconds across snapshots', async () => {
	const main = await read_client_source(root);
	let smithing_ms = 100_000.75;
	const capture = runInNewContext(main.slice(main.indexOf('function capture_expedition_work_statistics()'),
		main.indexOf('function format_expedition_activities')) + '\ncapture_expedition_work_statistics;', {
		game: { stats: {
			Smithing: { get: () => smithing_ms },
			Cartography: { get: () => 0.6 }
		} }
	});
	const start = capture();
	smithing_ms = 102_500.4;
	const end = capture();
	assert.equal(start.time_ms['melvorD:Smithing'], 100_000);
	assert.equal(end.time_ms['melvorD:Smithing'], 102_500);
	assert.equal(end.time_ms['melvorD:Smithing'] - start.time_ms['melvorD:Smithing'], 2_500);
	assert.equal(start.time_ms['melvorAoD:Cartography'], 1);
});

test('keeps Expedition counter bounds when rounding fractional milliseconds', async () => {
	const main = await read_client_source(root);
	let smithing_ms = 0;
	const capture = runInNewContext(main.slice(main.indexOf('function capture_expedition_work_statistics()'),
		main.indexOf('function format_expedition_activities')) + '\ncapture_expedition_work_statistics;', {
		game: { stats: { Smithing: { get: () => smithing_ms } } }
	});
	for (const [raw, expected] of [[0, 0], [0.9, 0], [42_000, 42_000],
		[Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], [-0.1, undefined], [-1, undefined],
		[NaN, undefined], [Infinity, undefined], [-Infinity, undefined], [Number.MAX_SAFE_INTEGER + 1, undefined]]) {
		smithing_ms = raw;
		assert.equal(capture().time_ms['melvorD:Smithing'], expected, `counter ${raw}`);
	}
	assert.equal(capture().time_ms['melvorD:Woodcutting'], undefined);
});

test('automatic tracking starts eligible work through the saved-report path without a prompt', async () => {
	const main = await read_client_source(root);
	let now = 0;
	let refreshed = 0;
	const starts = [];
	const activities = [{ type: 'skill', skill_id: 'melvorD:Astrology' }];
	const state = { is_connected: true, is_guild_member: true, expedition_work_tracking_mode: 'automatic',
		expedition_active_activities: activities, expedition_state: { expedition: { status: 'active', registered: true,
			chamber: { tasks: [{ task_id: 'chart', requirement: 'required', target_ms: 3_600_000,
				unlocked_at: 1, completed_at: null, evidence: { skill_ids: ['melvorD:Astrology'] } }] } } } };
	const context = { state, expedition_tasks, session_generation: 1, Date: { now: () => now },
		Swal: { isVisible: () => true }, modal_queue_guard: { pending_templates: new Set(['other-modal']) },
		polling: { is_foreground: () => true }, document: {}, capture_status_activities: () => activities,
		refresh_expedition_state: async () => { refreshed++; return true; },
		queue_modal: () => assert.fail('automatic mode opened a work prompt'),
		submit_expedition_work: async (...args) => { starts.push(args); state.expedition_state.tracking = { task_id: args[1] }; }
	};
	const observe = runInNewContext(main.slice(main.indexOf('let expedition_work_prompt_gate'),
		main.indexOf('function expedition_notify')) + '\nmaybe_prompt_expedition_work;', context);
	await observe(activities);
	now = 8000;
	await observe(activities);
	assert.deepEqual(starts, [['start', 'chart', true]]);
	assert.equal(refreshed, 1);
	now = 9000;
	await observe(activities);
	assert.equal(starts.length, 1);
	state.expedition_state.tracking = null;
	now = 10000;
	await observe(activities);
	now = 12500;
	await observe(activities);
	assert.equal(starts.length, 2);
	state.expedition_state.tracking = null;
	state.expedition_pending_report = { payload: { operation_id: 'saved' } };
	now = 50000;
	await observe(activities);
	assert.equal(starts.length, 2);
	state.expedition_pending_report = null;
	state.expedition_work_tracking_mode = 'manual';
	now = 100000;
	await observe(activities);
	assert.equal(refreshed, 2);
});

test('automatic selection cancels after delayed refresh if its mode, activity or session changes', async () => {
	const main = await read_client_source(root);
	for (const change of ['mode', 'activity', 'session', 'pending', 'hidden']) {
		let now = 0;
		let finish_refresh;
		let activities = [{ type: 'combat' }];
		const state = { is_connected: true, is_guild_member: true, expedition_work_tracking_mode: 'automatic',
			expedition_active_activities: activities, expedition_state: { expedition: { status: 'active', registered: true,
				chamber: { tasks: [{ task_id: 'fight', target_ms: 3_600_000, unlocked_at: 1, completed_at: null,
					evidence: { skill_ids: ['melvorD:Combat'] } }] } } } };
		const context = { state, expedition_tasks, session_generation: 1, Date: { now: () => now },
			Swal: { isVisible: () => false }, modal_queue_guard: { pending_templates: new Set() },
			polling: { is_foreground: () => change !== 'hidden' }, document: {},
			capture_status_activities: () => activities,
			refresh_expedition_state: () => new Promise(resolve => { finish_refresh = resolve; }),
			queue_modal: () => assert.fail('automatic mode opened a prompt'),
			submit_expedition_work: () => assert.fail(`automatic start survived ${change} change`)
		};
		const observe = runInNewContext(main.slice(main.indexOf('let expedition_work_prompt_gate'),
			main.indexOf('function expedition_notify')) + '\nmaybe_prompt_expedition_work;', context);
		await observe(activities);
		now = 8000;
		const pending = observe(activities);
		if (change === 'mode') state.expedition_work_tracking_mode = 'manual';
		if (change === 'activity') activities = [];
		if (change === 'session') context.session_generation++;
		if (change === 'pending') state.expedition_pending_report = { payload: {} };
		finish_refresh(true);
		await pending;
	}
});

test('saved work banner stays quiet for fast success and appears for slow or failed reports', async () => {
	const main = await read_client_source(root);
	const source = main.slice(main.indexOf('async function retry_expedition_report('),
		main.indexOf('async function maybe_auto_check_in_expedition()')) + '\nretry_expedition_report;';
	for (const scenario of ['fast', 'slow', 'failed', 'automatic-retry', 'restored', 'stale', 'throws']) {
		const pending = { endpoint: '/saved', payload: { operation_id: 'saved', captured_at: 0 } };
		const state = { expedition_pending_report: pending, expedition_report_notice_visible: false };
		const notices = [];
		let callback, delay, resolve_post, reject_post, cleared = false;
		const context = { state, session_generation: 1, Date: { now: () => scenario === 'restored' ? 6000 : 0 },
			setTimeout: (fn, ms) => { callback = fn; delay = ms; return 1; },
			clearTimeout: id => { assert.equal(id, 1); cleared = true; },
			api_post: () => new Promise((resolve, reject) => { resolve_post = resolve; reject_post = reject; }),
			api_get: async () => ({ contract_version: 1 }),
			read_expedition_state: async () => ({ contract_version: 1 }),
			remove_instance_storage_item: () => {}, EXPEDITION_PENDING_KEY: 'saved-report',
			getLangString: key => key, expedition_notify: text => notices.push(text),
			notify_expedition_tracking_ended() {}, update_expedition_nav() {}
		};
		const retry = runInNewContext(source, context);
		const request = retry(scenario === 'automatic-retry');
		assert.equal(state.expedition_report_notice_visible, scenario === 'restored');
		assert.equal(delay, scenario === 'restored' ? 0 : 5000);
		if (scenario === 'slow') {
			callback();
			assert.equal(state.expedition_report_notice_visible, true);
		}
		if (scenario === 'stale') {
			context.session_generation++;
			state.expedition_pending_report = { payload: { operation_id: 'new' } };
			callback();
			assert.equal(state.expedition_report_notice_visible, false);
		}
		if (scenario === 'throws') {
			reject_post(new Error('transport failure'));
			await assert.rejects(request, /transport failure/);
		} else {
			resolve_post(scenario === 'failed' || scenario === 'automatic-retry' ? null
				: { success: true, tracking: { task_id: 'chart' } });
			if (scenario === 'automatic-retry') {
				await new Promise(setImmediate);
				assert.equal(state.expedition_report_notice_visible, true);
				assert.equal(state.expedition_pending_report, pending);
				resolve_post({ success: true, tracking: { task_id: 'chart' } });
			}
			await request;
		}
		assert.equal(cleared, true);
		assert.equal(state.expedition_report_notice_visible, scenario === 'failed' || scenario === 'throws');
		if (scenario === 'failed' || scenario === 'throws') assert.equal(state.expedition_pending_report, pending);
		else if (scenario === 'stale') assert.equal(state.expedition_pending_report.payload.operation_id, 'new');
		else {
			assert.equal(state.expedition_pending_report, null);
			assert.deepEqual(notices, ['MOD_MP_EXPEDITION_TRACKING_ACCEPTED']);
		}
	}
});

test('Expedition report recovery uses compact hidden state and expands if opened during the read', async () => {
	const main = await read_client_source(root);
	const source = main.slice(main.indexOf('async function read_expedition_state'), main.indexOf('async function refresh_expedition_state'));
	for (const mode of ['hidden', 'visible', 'open-during-read', 'session-change']) {
		const calls = [], phases = [];
		const context = { session_generation: 1, expedition_page_visible: mode === 'visible', state: {},
			last_expedition_state_refresh_at: 0,
			expedition_view: { sync_phase_state: (_state, chamber) => phases.push(chamber) },
			api_get: async route => {
				calls.push(route);
				if (mode === 'open-during-read') context.expedition_page_visible = true;
				if (mode === 'session-change') context.session_generation++;
				return { contract_version: 1, expedition: { chamber: { visit_id: 7 } }, tracking: { pending_boundary_at: 123 } };
			} };
		runInNewContext(source, context);
		await context.read_expedition_state();
		assert.equal(calls[0], '/api/expedition/state' + (mode === 'visible' ? '' : '?view=tracking'));
		assert.equal(calls.length, mode === 'open-during-read' ? 2 : 1);
		if (mode === 'session-change') assert.equal(context.state.expedition_state, undefined);
		else {
			assert.equal(context.state.expedition_state.tracking.pending_boundary_at, 123);
			assert.equal(phases.length, 1);
			assert.ok(context.last_expedition_state_refresh_at > 0);
		}
	}
});

test('saved Expedition reports replay exact payloads, preserve pending boundaries and use compact success refresh', async () => {
	const main = await read_client_source(root);
	const source = main.slice(main.indexOf('async function retry_expedition_report'), main.indexOf('async function maybe_auto_check_in_expedition'));
	for (const outcome of ['success', 'pending', 'lost', 'fallback-session-change']) {
		const payload = { operation_id: 'saved-operation', captured_at: Date.now(), statistics: { ticks: 17 } };
		const pending = { endpoint: '/api/expedition/task/check-in', payload };
		const tracking = { session_id: 9, pending_boundary_at: outcome === 'pending' ? 123 : null };
		const sent = [], reads = [];
		let removed = 0;
		const context = { session_generation: 1, EXPEDITION_PENDING_KEY: 'pending', last_expedition_check_in_at: 0,
			state: { expedition_pending_report: pending, expedition_state: { tracking } },
			setTimeout: () => 1, clearTimeout() {}, getLangString: key => key,
			expedition_text: key => key, expedition_hours: value => value, expedition_status: value => value,
			expedition_notify() {}, notify_expedition_tracking_ended() {}, update_expedition_nav() {},
			remove_instance_storage_item: () => { removed++; },
			api_post: async (endpoint, body) => { sent.push({ endpoint, body }); return outcome === 'lost' ? null :
				outcome === 'pending' ? { pending: true, tracking } : { success: true, tracking, settlement: { credited_ms: 100 } }; },
			read_expedition_state: async () => { reads.push('state'); return outcome === 'fallback-session-change' ? null : { contract_version: 1 }; },
			api_get: async route => { reads.push(route); if (outcome === 'fallback-session-change') context.session_generation++; return { contract_version: 1, tracking }; } };
		runInNewContext(source, context);
		await context.retry_expedition_report(true, true);
		assert.ok(sent.every(call => call.body === payload && call.endpoint === pending.endpoint));
		assert.equal(sent.length, outcome === 'lost' ? 2 : 1);
		assert.equal(removed, outcome === 'lost' ? 0 : 1);
		if (outcome === 'pending') assert.deepEqual(reads, ['/api/expedition/personal']);
		if (outcome === 'success') assert.deepEqual(reads, ['state']);
		if (outcome === 'lost') assert.equal(context.state.expedition_pending_report, pending);
		if (outcome === 'fallback-session-change') assert.equal(context.state.expedition_personal, undefined);
	}
});
