import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { native_work_action_id, is_skill_active } from '../../mod/status-activities.mjs';
import { create_equipment_evidence, equipment_project_startable, equipment_project_stage_name, equipment_catalog_action_keys, pilot_action_keys, pack_equipment_evidence, unpack_equipment_evidence } from '../../mod/equipment-projects.mjs';
import { equipment_tasks, best_eligible_task, can_track_task, tracked_skill_ids, task_available_points_micros } from '../../mod/expedition-tasks.mjs';

function fixture() {
	const storage = new Map(); let owner = 'server-a:character-a', time = 0, serial = 0;
	const game = { skills: { registeredObjects: new Map([
		['mining', Object.assign(new EventEmitter(), { id: 'melvorD:Mining' })],
		['smithing', Object.assign(new EventEmitter(), { id: 'melvorD:Smithing' })]
	]) } };
	const evidence = create_equipment_evidence({ is_skill_active, action_id: native_work_action_id, read: () => storage.get(owner), write: value => storage.set(owner, structuredClone(value)),
		scope: () => owner, uuid: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, now: () => time });
	const action = (skill, action, interval = 3000, successful = true) => game.skills.registeredObjects.get(skill).emit('action', {
		skill: { id: `melvorD:${skill === 'mining' ? 'Mining' : 'Smithing'}` }, action: { id: `melvorD:${action}` }, interval, successful });
	return { evidence, game, action, storage, scope: value => { owner = value; }, tick: value => { time = value; } };
}

test('completed native actions count exact recipes and reject selection, wrong skill, failed and malformed events', () => {
	const x = fixture(); x.evidence.start(x.game);
	x.game.skills.registeredObjects.get('mining').selectedRock = { id: 'melvorD:Copper_Ore' };
	assert.equal(x.evidence.snapshot().time_ms[pilot_action_keys[0]], 0);
	x.action('mining', 'Copper_Ore'); x.action('mining', 'Iron_Ore'); x.action('smithing', 'Copper_Ore');
	x.action('mining', 'Copper_Ore', 3000, false); x.action('mining', 'Copper_Ore', Infinity); x.action('mining', 'Copper_Ore', -1);
	x.action('smithing', 'Bronze_Bar', 2000);
	assert.deepEqual(Object.values(x.evidence.snapshot().time_ms), [3000, 0, 2000, 0]);
});

test('offline event bursts survive capture and reload without duplicate listeners or captured-report mutation', () => {
	const x = fixture(); x.evidence.start(x.game);
	for (let i = 0; i < 100; i++) x.action('mining', 'Tin_Ore');
	const saved_report = x.evidence.snapshot();
	assert.equal(saved_report.time_ms[pilot_action_keys[1]], 300000);
	x.action('mining', 'Tin_Ore');
	assert.equal(saved_report.time_ms[pilot_action_keys[1]], 300000);
	x.evidence.snapshot(); x.evidence.stop();
	assert.equal(x.game.skills.registeredObjects.get('mining').listenerCount('action'), 0);
	x.evidence.start(x.game); x.evidence.start(x.game);
	assert.equal(x.game.skills.registeredObjects.get('mining').listenerCount('action'), 1);
	x.action('mining', 'Tin_Ore');
	assert.equal(x.evidence.snapshot().time_ms[pilot_action_keys[1]], 306000);
	x.evidence.stop(); assert.equal(x.game.skills.registeredObjects.get('smithing').listenerCount('action'), 0);
});

test('active project keeps its old counters and retires unrelated catalog evidence', () => {
	const x = fixture(); x.evidence.start(x.game);
	const old = x.evidence.snapshot(); old.time_ms[pilot_action_keys[0]] = 123000;
	old.time_ms['melvorD:Mining|melvorD:Removed_Recipe'] = 45000;
	old.time_ms['melvorD:Mining|melvorD:Ore_65'] = 4000;
	x.evidence.stop();
	x.storage.set('server-a:character-a', old);
	const catalog = Array.from({ length: 66 }, (_, index) => ({ item_id: `melvorD:Equipment_${index}`, stages: [[{
		skill_id: 'melvorD:Mining', action_id: `melvorD:Ore_${index}`
	}]] }));
	assert.equal(equipment_catalog_action_keys(catalog).length, 66);
	x.evidence.start(x.game);
	x.action('mining', 'Ore_65', 9000);
	assert.equal(x.evidence.snapshot().time_ms['melvorD:Mining|melvorD:Ore_65'], 13000, 'restored recipes count offline work before the server refresh');
	x.evidence.configure(catalog);
	const expanded = x.evidence.snapshot();
	assert.equal(expanded.epoch, old.epoch);
	assert.equal(expanded.time_ms[pilot_action_keys[0]], undefined);
	assert.equal(Object.keys(expanded.time_ms).length, 66);
	assert.equal(expanded.time_ms['melvorD:Mining|melvorD:Removed_Recipe'], undefined);
	assert.equal(unpack_equipment_evidence(x.storage.get('server-a:character-a')).time_ms['melvorD:Mining|melvorD:Removed_Recipe'], undefined);
	assert.equal(expanded.time_ms['melvorD:Mining|melvorD:Ore_65'], 13000);
});

test('server and character scopes retain independent epochs and invalid storage resets conservatively', () => {
	const x = fixture(); x.evidence.start(x.game); x.action('mining', 'Copper_Ore');
	const first = x.evidence.snapshot(); x.scope('server-b:character-a');
	assert.notEqual(x.evidence.snapshot().epoch, first.epoch);
	x.action('mining', 'Copper_Ore'); x.action('mining', 'Copper_Ore');
	x.evidence.snapshot(); x.scope('server-a:character-a');
	assert.deepEqual(x.evidence.snapshot(), first);
	x.scope('server-a:character-b'); assert.equal(x.evidence.snapshot().time_ms[pilot_action_keys[0]], 0);
	x.storage.set('broken', { epoch: first.epoch, time_ms: { [pilot_action_keys[0]]: -1 } }); x.scope('broken');
	assert.notEqual(x.evidence.snapshot().epoch, first.epoch);
});

test('personal exact-action work wins selection, has zero EP, and otherwise falls back to chamber work', () => {
	const activity = { type: 'skill', skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore' };
	const personal = { task_id: pilot_action_keys[0], skill_id: activity.skill_id, action_id: activity.action_id, target_ms: 300000, player_ms: 0, available: true };
	const chamber = { task_id: 'chamber', requirement: 'required', unlocked_at: 1, completed_at: null, target_ms: 3600000, evidence: { skill_ids: ['melvorD:Mining'] } };
	const model = { equipment_projects: { project: { stages: [[personal]] } }, expedition: { status: 'active', registered: true, chamber: { tasks: [chamber] } } };
	const selected = best_eligible_task(model, [activity]);
	assert.equal(selected.source, 'equipment'); assert.equal(task_available_points_micros(selected), 0);
	assert.equal(can_track_task(selected, [{ ...activity, action_id: 'melvorD:Tin_Ore' }]), false);
	assert.equal(best_eligible_task({ ...model, tracking: { task_id: 'chamber' } }, [activity]), null);
	assert.equal(best_eligible_task({ equipment_projects: model.equipment_projects }, [activity]).task_id, personal.task_id);
	assert.deepEqual(tracked_skill_ids({ ...model, tracking: { source: 'equipment', task_id: personal.task_id } }, [activity]), ['melvorD:Mining']);
	assert.deepEqual(tracked_skill_ids({ ...model, tracking: { source: 'equipment', task_id: personal.task_id } }, [{ ...activity, action_id: 'melvorD:Tin_Ore' }]), []);
	personal.available = false;
	assert.equal(best_eligible_task(model, [activity]).task_id, 'chamber');
	personal.available = true;
	assert.equal(best_eligible_task(model, [activity]).task_id, personal.task_id);
	assert.equal(equipment_tasks(null).length, 0);
});

test('an unfinished tutorial project permits unrelated chamber work and takes over only for matching recipes', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const expedition_tasks = await import('../../mod/expedition-tasks.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	let activities = [{ type: 'combat', area_id: 'melvorF:Holy_Isles' }];
	const recipe = { task_id: 'copper', skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore', available: true, player_ms: 0, target_ms: 45000 };
	const model = { tracking: null, equipment_projects: { project: { item_id: 'melvorD:Bronze_Helmet', stages: [[recipe]] } },
		expedition: { status: 'active', registered: true, chamber: { tasks: [{ task_id: 'exploration', unlocked_at: 1,
			completed_at: null, target_ms: 3600000, evidence: { skill_ids: ['melvorD:Combat'] } }] } } };
	const state = { is_connected: true, combat: { tutorial: { complete: false, trial: { item: 'melvorD:Bronze_Helmet' } } }, expedition_state: model };
	const calls = [];
	const context = { state, expedition_tasks, offline_work_gate: null, session_generation: 1, expedition_work_prompt_loading: false,
		expedition_work_prompt_gate: { observe: ({ tracking }) => !tracking, defer: () => {} }, Date, document: {}, polling: { is_foreground: () => true },
		capture_status_activities: () => activities, refresh_expedition_state: async () => true,
		submit_expedition_work: async (kind, id) => { calls.push([kind, id]); model.tracking = kind === 'stop' ? null :
			{ task_id: id, source: id === 'copper' ? 'equipment' : 'chamber' }; } };
	runInNewContext(main.slice(main.indexOf('async function maybe_start_expedition_work('), main.indexOf('function expedition_notify(')), context);
	await context.maybe_start_expedition_work(activities);
	assert.deepEqual(calls, [['start', 'exploration']], 'combat tracks the chamber despite the unfinished helmet');
	await context.maybe_start_expedition_work(activities);
	assert.equal(calls.length, 1, 'unrelated project must not stop ongoing chamber work');
	activities = [{ type: 'skill', skill_id: recipe.skill_id, action_id: recipe.action_id }];
	await context.maybe_start_expedition_work(activities);
	assert.deepEqual(calls.at(-1), ['stop', null], 'matching project settles chamber work first');
	await context.maybe_start_expedition_work(activities);
	assert.deepEqual(calls.at(-1), ['start', 'copper'], 'matching recipe takes priority');
	await context.maybe_start_expedition_work(activities);
	assert.equal(calls.length, 3, 'existing project tracking retains ownership');
	for (const boundary of [{ pending_boundary_at: 1 }, { claim: {} }]) {
		model.tracking = { task_id: 'exploration', ...boundary };
		await context.maybe_start_expedition_work(activities);
		assert.equal(calls.length, 3, 'pending verification must retain ownership');
	}
});

test('projects settle chamber tracking before and after tutorial graduation', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const expedition_tasks = await import('../../mod/expedition-tasks.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const activities = [{ type: 'skill', skill_id: 'melvorD:Mining', action_id: 'melvorD:Tin_Ore' }];
	const task = { task_id: 'tin', skill_id: 'melvorD:Mining', action_id: 'melvorD:Tin_Ore', available: true, player_ms: 0, target_ms: 300000 };
	const model = { tracking: { task_id: 'chamber' }, equipment_projects: { project: { item_id: 'sword', stages: [[task]] } } };
	const state = { is_connected: true, combat: { tutorial: { complete: false, trial: { item: 'sword' } } }, expedition_state: model };
	const calls = [];
	const observations = [];
	const context = { state, expedition_tasks, offline_work_gate: null, session_generation: 1, expedition_work_prompt_loading: false,
		expedition_work_prompt_gate: { observe: input => { observations.push(input); return true; }, defer: () => {} }, Date, document: {}, polling: { is_foreground: () => true },
		capture_status_activities: () => activities, refresh_expedition_state: async () => true,
		submit_expedition_work: async (kind, id) => { calls.push([kind, id]); if (kind === 'stop') model.tracking = null; } };
	runInNewContext(main.slice(main.indexOf('async function maybe_start_expedition_work('), main.indexOf('function expedition_notify(')), context);
	await context.maybe_start_expedition_work(activities);
	assert.deepEqual(calls, [['stop', null]], 'settle existing chamber work before starting the project');
	await context.maybe_start_expedition_work(activities);
	assert.deepEqual(calls[1], ['start', 'tin']);
	calls.length = 0;
	for (const tracking of [{ source: 'equipment' }, { pending_boundary_at: 1 }, { claim: {} }]) {
		model.tracking = tracking;
		await context.maybe_start_expedition_work(activities);
		assert.equal(calls.length, 0, 'never replace project tracking or unsettled verification');
	}
	model.tracking = { task_id: 'chamber' }; state.combat.tutorial.complete = true;
	await context.maybe_start_expedition_work(activities);
	assert.equal(observations.at(-1).tracking, false, 'a matching project enables selection during chamber tracking');
	assert.deepEqual(calls, [['stop', null]], 'graduated players also settle chamber work for matching projects');
	await context.maybe_start_expedition_work(activities);
	assert.deepEqual(calls[1], ['start', 'tin']);
});

test('project grid hides locked access and requires the completed previous material in the same family', async () => {
	const { equipment_project_visible } = await import('../../mod/equipment-projects.mjs');
	const bronze = { item_id: 'melvorD:Bronze_Dagger', slot: 'Weapon', tier: 1 };
	const iron = { item_id: 'melvorD:Iron_Dagger', slot: 'Weapon', tier: 2 };
	const sword = { item_id: 'melvorD:Bronze_Sword', slot: 'Weapon', tier: 1 };
	const model = { catalog: [bronze, iron, sword], slots: [], unlocked: [] };
	assert.equal(equipment_project_visible(model, bronze), false);
	model.slots = [{ slot: 'Weapon', tier: 0 }];
	assert.equal(equipment_project_visible(model, bronze), false);
	model.slots[0].tier = 1;
	assert.equal(equipment_project_visible(model, bronze), true);
	assert.equal(equipment_project_visible(model, iron), false);
	model.slots[0].tier = 2;
	model.unlocked = [sword.item_id];
	assert.equal(equipment_project_visible(model, iron), false);
	model.unlocked.push(bronze.item_id);
	assert.equal(equipment_project_visible(model, iron), true);
	model.unlocked = [iron.item_id];
	assert.equal(equipment_project_visible(model, iron), true, 'retains legacy completed items');
	model.unlocked = []; model.project = { item_id: iron.item_id };
	assert.equal(equipment_project_visible(model, iron), true, 'retains legacy in-progress work');
});

test('equipment tile upgrade uses canonical next-tier cost and only marks affordable purchases', async () => {
	const { equipment_slot_purchase } = await import('../../mod/equipment-projects.mjs');
	const model = { access: [{ slot: 'Weapon', unlock_cost_micros: 1e6, tiers: [{ tier: 1, cost_micros: 1e6 }, { tier: 2, cost_micros: 2e6 }] }], slots: [] };
	assert.deepEqual(equipment_slot_purchase(model, 'Weapon', 0), { action: 'unlock-slot', tier: 0, cost_micros: 1e6, affordable: false, eligible: true });
	assert.equal(equipment_slot_purchase(model, 'Weapon', 1e6).affordable, true);
	model.slots = [{ slot: 'Weapon', tier: 1 }];
	assert.deepEqual(equipment_slot_purchase(model, 'Weapon', 1e6), { action: 'unlock-tier', tier: 2, cost_micros: 2e6, affordable: false, eligible: false });
	assert.equal(equipment_slot_purchase(model, 'Weapon', 2e6).affordable, true);
	assert.equal(equipment_slot_purchase(model, 'Weapon', 2e6).eligible, false);
	model.slots[0].upgrade_ready = true;
	assert.equal(equipment_slot_purchase(model, 'Weapon', 2e6).eligible, true);
	model.slots[0].tier = 2;
	assert.equal(equipment_slot_purchase(model, 'Weapon', 100e6), null);
});

test('Combat owns equipment spending while Expedition shows available and active projects', async () => {
	const { readFile } = await import('node:fs/promises');
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const expedition = html.slice(html.indexOf('id="mp-equipment-work"'), html.indexOf('id="mp-chamber-work"'));
	assert.ok(!expedition.includes('MOD_MP_EQUIPMENT_ACCESS'));
	assert.ok(expedition.includes('state.equipment_project_categories()'));
	assert.ok(!expedition.includes('mp-equipment-permanent'));
	assert.ok(html.includes('state.equipment_grid()'));
	assert.ok(html.includes("v-for=\"type in ['melee', 'ranged', 'magic']\""));
});

test('personal tracking shares the responsive banner without EP and highlights only its tracked task', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const banner = html.slice(html.indexOf('<div v-show="state.equipment_tracking()'), html.indexOf('<div id="mp-expedition-chamber-view"'));
	assert.match(banner, /mp-expedition-panel mp-expedition-tracking mp-equipment-tracking/);
	assert.match(banner, /mp-expedition-tracking-copy/);
	assert.match(banner, /fa fa-crosshairs/);
	assert.match(banner, /MOD_MP_EXPEDITION_TRACKING_TITLE/);
	assert.match(banner, /MOD_MP_EXPEDITION_STARTED_AGO/);
	assert.match(banner, /equipment_tracking\(\)\?\.started_at/);
	assert.match(banner, /equipment_action\('check-in'\)/);
	assert.doesNotMatch(banner, /AVAILABLE_TO_EARN|format_ep|reward_remaining_ms/);
	const row = html.match(/<article v-for="task in tasks"[^>]+/)[0];
	const expression = row.match(/'mp-expedition-task-self': (.*?), 'mp-tutorial-highlight'/)[1];
	const selected = tracking => runInNewContext(expression, { state: { equipment_tracking: () => tracking }, task: { task_id: 'smithing|bronze' } });
	assert.equal(selected({ source: 'equipment', task_id: 'smithing|bronze' }), true);
	assert.equal(selected({ source: 'equipment', task_id: 'mining|copper' }), false);
	assert.equal(selected({ source: 'chamber', task_id: 'smithing|bronze' }), false);
	assert.equal(selected(null), false);
});

test('equipment tiles select without mutations and confirmation rechecks affordability and instance scope', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const equipment_module = await import('../../mod/equipment-projects.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const calls = [];
	const model = { access: [{ slot: 'Weapon', unlock_cost_micros: 1e6, tiers: [] }], slots: [], catalog: [{ item_id: 'bronze' }] };
	const state = { combat_tutorial_access: () => true, combat: { ep_micros: 2e6 }, equipment_model: () => model, equipment_grid: () => [{ slot: 'Weapon', title: 'Weapon' }],
		equipment_can_mutate: () => true, combat_name: key => key, equipment_slot_name: slot => slot, equipment_purchase: async (...args) => calls.push(args),
		equipment_project_title: () => 'Bronze', equipment_project_can_start: () => true,
		equipment_start: async id => calls.push(['start', id]) };
	const context = { state, equipment_module, server_host: 'server-a', session_generation: 1, getLangString: key => key, queue_modal: () => true, close_modal_and_wait: async () => {} };
	runInNewContext(main.slice(main.indexOf('\tstate.equipment_selected ='), main.indexOf('\tstate.equipment_unlocked_items =')), context);
	state.equipment_select('combat', 'slot', 'Weapon');
	assert.equal(calls.length, 0);
	assert.equal(state.equipment_selection('combat')[0].cost, 1e6);
	state.combat.ep_micros = 0;
	await state.equipment_confirm('combat');
	assert.equal(calls.length, 0);
	state.combat.ep_micros = 2e6;
	await state.equipment_confirm('combat');
	assert.deepEqual(calls, [['unlock-slot', 'Weapon']]);
	assert.equal(state.equipment_selected.combat, null);
	state.equipment_select('project', 'project', 'bronze');
	assert.equal(calls.length, 1);
	context.session_generation = 2;
	await state.equipment_confirm('project');
	assert.equal(calls.length, 1, 'stale selection cannot act in a new session');
	state.equipment_select('project', 'project', 'bronze');
	await state.equipment_confirm('project');
	assert.deepEqual(calls[1], ['start', 'bronze']);
});

test('compact evidence preserves namespaces, zero baselines and counters exactly across JSON reloads', () => {
	const value = { epoch: '00000000-0000-4000-8000-000000000001', time_ms: {
		'melvorD:Mining|melvorD:Copper_Ore': 0,
		'melvorD:Smithing|melvorD:Bronze_Helmet': Number.MAX_SAFE_INTEGER,
		'other:Mining|other:Ore': 1234,
		'melvorD:__proto__|melvorD:__proto__': 99
	} };
	assert.deepEqual(unpack_equipment_evidence(JSON.parse(JSON.stringify(pack_equipment_evidence(value)))), value);
	assert.equal(unpack_equipment_evidence(value), value, 'legacy records remain readable');
	assert.equal(unpack_equipment_evidence({ v: 1, t: null }), null);
});

test('actual full catalog migrates below the 8 KB budget with a pending equipment report', async () => {
	const { readFile } = await import('node:fs/promises');
	const catalog = JSON.parse(await readFile(new URL('../../server/equipment-recipes-v1.json', import.meta.url))).items;
	const project = catalog.find(item => item.item_id === 'melvorD:Bronze_Helmet');
	const x = fixture(); x.evidence.start(x.game);
	const old = { epoch: x.evidence.snapshot().epoch, time_ms: Object.fromEntries(equipment_catalog_action_keys(catalog.filter(item => !item.unlock_only)).map(key => [key, 0])) };
	old.time_ms[pilot_action_keys[0]] = 123000;
	x.evidence.stop(); x.storage.set('server-a:character-a', old);
	x.evidence.start(x.game); x.evidence.configure([project]);
	const actions = x.evidence.snapshot(pilot_action_keys[0]);
	assert.deepEqual(actions, { epoch: old.epoch, time_ms: { [pilot_action_keys[0]]: 123000 } });
	const disk = x.storage.get('server-a:character-a');
	const legacy_bytes = Buffer.byteLength(JSON.stringify(old));
	const compact_bytes = Buffer.byteLength(JSON.stringify(disk));
	assert.ok(compact_bytes < 256);
	assert.ok(compact_bytes < legacy_bytes / 10);
	// Leave the rest of the observed 7,389-byte save untouched, then replace only evidence.
	const other_bytes = 7389 - legacy_bytes;
	const report = { endpoint: '/api/expedition/task/start', payload: { source: 'equipment', operation_id: old.epoch,
		project_id: 1, task_id: pilot_action_keys[0], captured_at: Date.now(), actions,
		activities: [{ type: 'skill', skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore' }],
		statistics: { version: 1, time_ms: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`melvorD:Skill_${i}`, 1234567890123])) } } };
	assert.ok(other_bytes + compact_bytes + Buffer.byteLength(JSON.stringify(report)) < 8192);
	for (const candidate of catalog) {
		x.evidence.configure([candidate]);
		assert.ok(Buffer.byteLength(JSON.stringify(x.storage.get('server-a:character-a'))) < 384);
		const largest = { epoch: old.epoch, time_ms: Object.fromEntries(equipment_catalog_action_keys([candidate]).map(key => [key, Number.MAX_SAFE_INTEGER])) };
		const bytes = Buffer.byteLength(JSON.stringify(pack_equipment_evidence(largest)));
		assert.ok(bytes <= 416);
		assert.ok(other_bytes + bytes + Buffer.byteLength(JSON.stringify(report)) < 8192);
	}
	// Return to the same project before reload and prove offline events retain its epoch/baselines.
	x.evidence.configure([project]); x.action('mining', 'Copper_Ore');
	const before = x.evidence.snapshot(pilot_action_keys[0]);
	x.evidence.stop(); x.evidence.start(x.game); x.action('mining', 'Copper_Ore');
	assert.equal(x.evidence.snapshot(pilot_action_keys[0]).time_ms[pilot_action_keys[0]], before.time_ms[pilot_action_keys[0]] + 3000);
	assert.equal(x.evidence.snapshot().epoch, old.epoch);
});

test('failed evidence writes keep counters in memory, rate-limit errors and recover without losing work', () => {
	let fail = true, saved, time = 0, notices = 0;
	const evidence = create_equipment_evidence({ is_skill_active, action_id: native_work_action_id, read: () => saved, write: value => {
		if (fail) throw new Error('quota'); saved = structuredClone(value);
	}, scope: () => 'a', uuid: () => '00000000-0000-4000-8000-000000000001', now: () => time, on_error: () => notices++ });
	const skill = Object.assign(new EventEmitter(), { id: 'melvorD:Mining' });
	evidence.start({ skills: { registeredObjects: new Map([['mining', skill]]) } });
	const event = { skill: { id: skill.id }, action: { id: 'melvorD:Copper_Ore' }, interval: 3000 };
	skill.emit('action', event);
	assert.equal(evidence.snapshot(pilot_action_keys[0]), null);
	assert.equal(evidence.snapshot(pilot_action_keys[0]), null);
	assert.equal(notices, 1);
	time = 30000; skill.emit('action', event);
	assert.equal(notices, 2);
	fail = false;
	assert.equal(evidence.snapshot(pilot_action_keys[0]).time_ms[pilot_action_keys[0]], 6000);
});

test('pending report quota failures prevent sending and retain an earlier recovery request', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const notices = [], prior = { payload: { operation_id: 'prior' } };
	const context = { EXPEDITION_PENDING_KEY: 'pending', set_instance_storage_item: () => { throw new Error('quota'); },
		get_instance_storage_item: () => prior, log: () => {}, getLangString: key => key,
		expedition_notify: message => notices.push(message) };
	runInNewContext(main.slice(main.indexOf('function save_expedition_report('), main.indexOf('async function submit_expedition_work(')), context);
	assert.equal(context.save_expedition_report({ payload: { operation_id: 'new' } }), false);
	assert.equal(prior.payload.operation_id, 'prior');
	assert.deepEqual(notices, ['MOD_MP_EXPEDITION_WORK_STORAGE_FAILED']);
	context.set_instance_storage_item = () => {};
	assert.equal(context.save_expedition_report({ payload: { operation_id: 'new' } }), false, 'a silent dropped write also fails');
});


test('switching instances cannot carry the previous project recipes into another instance', () => {
	const x = fixture(); x.evidence.start(x.game);
	const project = { stages: [[{ skill_id: 'melvorD:Smithing', action_id: 'melvorD:Bronze_Helmet' }]] };
	x.evidence.configure([project]); x.action('smithing', 'Bronze_Helmet');
	const first = x.evidence.snapshot();
	x.scope('server-b:character-a');
	assert.equal(x.evidence.snapshot().time_ms['melvorD:Smithing|melvorD:Bronze_Helmet'], undefined);
	x.evidence.configure([]);
	x.scope('server-a:character-a');
	assert.deepEqual(x.evidence.snapshot(), first);
});


test('production automatic start saves one task counter and replays the immutable report after reload', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const x = fixture(); x.evidence.start(x.game);
	const task_id = pilot_action_keys[0];
	const task = { task_id, skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore', available: true };
	x.evidence.configure([{ stages: [[task, { skill_id: 'melvorD:Mining', action_id: 'melvorD:Tin_Ore' }]] }]);
	x.action('mining', 'Copper_Ore');
	let disk, sent = 0;
	const state = { expedition_state: { equipment_projects: { project: { id: 12, stages: [[task]] } } } };
	const context = { expedition_tasks: await import('../../mod/expedition-tasks.mjs'), state, offline_work_gate: null, EXPEDITION_PENDING_KEY: 'pending', crypto: { randomUUID: () => 'operation-1' },
		capture_status_activities: () => [{ type: 'skill', skill_id: task.skill_id, action_id: task.action_id }],
		capture_expedition_work_statistics: () => ({ version: 1, time_ms: { 'melvorD:Mining': 3000 } }), equipment_evidence: x.evidence,
		set_instance_storage_item: (key, value) => { disk = JSON.parse(JSON.stringify(value)); }, get_instance_storage_item: () => disk,
		retry_expedition_report: async () => { sent++; }, getLangString: key => key, expedition_notify: () => {}, log: () => {} };
	runInNewContext(main.slice(main.indexOf('function save_expedition_report('), main.indexOf('async function vote_expedition_exit(')), context);
	await context.submit_expedition_work('start', task_id, true);
	assert.equal(sent, 1);
	assert.deepEqual(disk.payload.actions.time_ms, { [task_id]: 3000 });
	const captured = JSON.stringify(disk);
	x.action('mining', 'Copper_Ore'); x.evidence.snapshot();
	assert.equal(JSON.stringify(disk), captured);
	state.expedition_pending_report = JSON.parse(captured);
	await context.submit_expedition_work('start', task_id, true);
	assert.equal(sent, 1, 'a reloaded pending report cannot be overwritten by a fresh automatic start');
});

test('admin project preview is explicit and cannot cross server/session or project boundaries', async () => {
	const {readFile} = await import('node:fs/promises');
	const {runInNewContext} = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
	const calls=[]; let tracking=null, refreshes=0;
	const project={id:42,item_id:'helmet'};
	const state={combat:{debug_enabled:true,character:{revision:3}},equipment_model:()=>({project}),
		equipment_can_mutate:()=>true,equipment_tracking:()=>tracking,equipment_task_name:task=>task.task_id,equipment_project_name:p=>p.item_id};
	const context={state,server_host:'server-a',session_generation:1,
		combat_inventory:{debug_equipment:async payload=>{calls.push(payload);return true;}},refresh_expedition_state:async()=>refreshes++};
	runInNewContext(main.slice(main.indexOf('\tstate.equipment_debug_selection ='),main.indexOf('\tstate.equipment_task_name =')),context);
	state.equipment_debug_preview({task_id:'smelt'});
	assert.equal(calls.length,0);
	context.session_generation=2;
	assert.equal(await state.equipment_debug_confirm(),false);
	state.equipment_debug_preview(null); project.id=43;
	assert.equal(await state.equipment_debug_confirm(),false);
	state.equipment_debug_preview(null); tracking={source:'equipment'};
	assert.equal(await state.equipment_debug_confirm(),false);
	tracking=null;state.expedition_pending_report={};
	assert.equal(await state.equipment_debug_confirm(),false);
	state.expedition_pending_report=null;
	assert.equal(await state.equipment_debug_confirm(),true);
	assert.equal(calls.length,1); assert.equal(calls[0].project_id,43); assert.equal(calls[0].task_id,null);
	assert.equal(refreshes,1);assert.equal(state.equipment_debug_selection,null);
	state.combat.debug_enabled=false;state.equipment_debug_preview(null);
	assert.equal(state.equipment_debug_selection,null);
});

test('any Woodcutting counts one completed interval for multiple trees and preserves exact Fletching evidence', async () => {
	const { equipment_activity_matches } = await import('../../mod/expedition-tasks.mjs');
	const x = fixture();
	const wood = Object.assign(new EventEmitter(), { id: 'melvorD:Woodcutting' });
	const fletch = Object.assign(new EventEmitter(), { id: 'melvorD:Fletching' });
	x.game.skills.registeredObjects.set('wood', wood); x.game.skills.registeredObjects.set('fletch', fletch);
	const task = { skill_id: wood.id, action_id: 'multiplayer:Any_Woodcutting', available: true, player_ms: 0, target_ms: 300000, source: 'equipment' };
	const final = { skill_id: fletch.id, action_id: 'melvorF:Bronze_Arrows' };
	x.evidence.start(x.game); x.evidence.configure([{ stages: [[task], [final]] }]);
	wood.emit('action', { skill: wood, actions: new Set([{ id: 'melvorD:Oak' }, { id: 'melvorD:Willow' }]), interval: 3000 });
	wood.emit('action', { skill: wood, actions: new Set(), interval: 3000 });
	wood.emit('action', { skill: wood, actions: new Set([{}]), interval: 3000, successful: false });
	fletch.emit('action', { skill: fletch, action: { id: 'melvorF:Iron_Arrows' }, interval: 2000 });
	fletch.emit('action', { skill: fletch, action: { id: final.action_id }, interval: 2000 });
	assert.equal(x.evidence.snapshot().time_ms[`${wood.id}|${task.action_id}`], 3000);
	assert.equal(x.evidence.snapshot().time_ms[`${fletch.id}|${final.action_id}`], 2000);
	const activities = [{ type: 'skill', skill_id: wood.id, action_id: 'melvorD:Redwood' }];
	assert.equal(can_track_task(task, activities), true);
	assert.equal(equipment_activity_matches({ ...task, skill_id: 'melvorD:Mining' }, activities[0]), false);
	assert.equal(can_track_task({ ...task, skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore' }, [{ type: 'skill', skill_id: 'melvorD:Mining', action_id: 'melvorD:Tin_Ore' }]), false);
	x.evidence.start(x.game); assert.equal(wood.listenerCount('action'), 1);
	assert.equal(x.evidence.snapshot().time_ms[`${wood.id}|${task.action_id}`], 3000);
	x.evidence.stop(); assert.equal(wood.listenerCount('action'), 0); assert.equal(fletch.listenerCount('action'), 0);
});

test('Quiver projects stay outside the melee grid and expose no equip action', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const equipment_module = await import('../../mod/equipment-projects.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const arrow = { item_id: 'melvorD:Bronze_Arrows', slot: 'Quiver', unlock_only: true };
	const model = { access: [{ slot: 'Helmet', tiers: [] }, { slot: 'Platebody', tiers: [] }, { slot: 'Quiver', tiers: [] }], slots: [], catalog: [arrow] };
	const state = { combat_tutorial_access: () => true, combat: { ep_micros: 2e6 }, equipment_model: () => model, equipment_slot: () => null,
		equipment_slot_name: slot => slot, equipment_can_mutate: () => true, format_ep: String, combat_name: id => id,
		equipment_project_name: item => item.item_id, equipment_requirement_text: () => '', equipment_is_equipped: () => false };
	const game = { equipmentSlots: [
		{ localID: 'Helmet', gridPosition: { col: 2, row: 0 } },
		{ localID: 'Platebody', gridPosition: { col: 2, row: 2 } },
		{ localID: 'Quiver', gridPosition: { col: 3, row: 1 } }
	] };
	const context = { state, game, equipment_module, server_host: 'server-a', session_generation: 1, getLangString: key => key,
		get_registered_game_objects: objects => objects, queue_modal: () => true };
	runInNewContext(main.slice(main.indexOf('\tstate.equipment_grid ='), main.indexOf('\tstate.equipment_unlocked_items =')), context);
	assert.equal(state.equipment_grid().length, 2);
	assert.equal(state.equipment_grid()[1].row, 2, 'Quiver row must not add a gap to melee layout');
	const ranged = state.equipment_grid('ranged');
	assert.equal(ranged.find(tile => tile.slot === 'Quiver').available, true);
	assert.equal(ranged.find(tile => tile.slot === 'Helmet').available, false);
	state.combat.equipment_set = 'ranged';
	state.equipment_select('combat', 'slot', 'Helmet');
	assert.equal(state.equipment_selection('combat')[0].can_confirm, false);
	state.equipment_select('combat', 'item', arrow.item_id);
	assert.equal(state.equipment_selection('combat')[0].can_confirm, false);
	assert.equal(state.equipment_selection('combat')[0].label, 'MOD_MP_EQUIPMENT_ARROWS_DEFERRED');
});

test('an in-progress project survives reset visibility while other projects require renewed access', async () => {
	const { equipment_project_visible } = await import('../../mod/equipment-projects.mjs');
	const active = { item_id: 'melvorD:Iron_Dagger', slot: 'Weapon', tier: 2 };
	const other = { item_id: 'melvorD:Bronze_Sword', slot: 'Weapon', tier: 1 };
	const model = { slots: [], catalog: [active, other], project: active, unlocked: [] };
	assert.equal(equipment_project_visible(model, active), true);
	assert.equal(equipment_project_visible(model, other), false);
});

test('Quick Equip includes only permanent unlocks for the chosen slot, highest material first', async () => {
	const { equipment_slot_items, equipment_stat_groups } = await import('../../mod/equipment-projects.mjs');
	const bronze = { item_id: 'bronze', tier: 1, slot: 'Boots', stats: [{ key: 'rangedAttackBonus', value: -1 }, { key: 'meleeDefenceBonus', value: 1 }] };
	const rune = { item_id: 'rune', tier: 6, slot: 'Boots' };
	const model = { catalog: [bronze, { item_id: 'helmet', tier: 6, slot: 'Helmet' }, rune, { item_id: 'iron', tier: 2, slot: 'Boots' }], unlocked: ['bronze', 'rune', 'helmet'] };
	assert.deepEqual(equipment_slot_items(model, 'Boots'), [rune, bronze]);
	assert.deepEqual(equipment_slot_items(null, 'Boots'), []);
	const rows = equipment_stat_groups(bronze, key => key).flatMap(group => group.rows);
	assert.equal(rows.find(row => row.key === 'rangedAttackBonus').tone, 'text-danger');
	assert.equal(rows.find(row => row.key === 'meleeDefenceBonus').text, '1');
	assert.equal(rows.some(row => row.key === 'attackSpeed'), false, 'armor must not invent an attack interval');
	assert.equal(rows.find(row => row.key === 'magicDefenceBonus').text, '0');
	assert.equal(equipment_stat_groups({ stats: [{ key: 'attackSpeed', value: 2200 }] }, String)[0].rows[0].text, '2.2s');
});

test('equipment modal guards refuse another instance and recheck quotes after closing', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const equipment_module = await import('../../mod/equipment-projects.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const model = { access: [{ slot: 'Boots', unlock_cost_micros: 1e6, tiers: [] }], slots: [] };
	let mutations = 0, options, modal_title, localize_title;
	const state = { combat_tutorial_access: () => true, combat: { ep_micros: 2e6 }, equipment_model: () => model, equipment_can_mutate: () => true,
		equipment_grid: () => [{ slot: 'Boots', available: true }], equipment_slot_name: String,
		equipment_purchase: async () => { mutations++; return true; } };
	const context = { state, equipment_module, server_host: 'a', session_generation: 1, getLangString: String,
		queue_modal: (title, template, image, data, localize) => { options = data; modal_title = title; localize_title = localize; }, close_modal_and_wait: async () => {} };
	runInNewContext(main.slice(main.indexOf('\tstate.equipment_selected ='), main.indexOf('\tstate.equipment_unlocked_items =')), context);
	state.equipment_select('combat', 'slot', 'Boots');
	assert.equal(options.showClass.popup, '');
	assert.equal(options.hideClass.popup, '');
	assert.equal(modal_title, 'Boots');
	assert.equal(localize_title, false);
	context.server_host = 'b';
	assert.equal(state.equipment_modal_slot_actions().length, 0);
	await state.equipment_modal_upgrade();
	state.equipment_modal_choose({ item_id: 'other' });
	assert.equal(state.equipment_selected.combat.id, 'Boots');
	assert.equal(mutations, 0);
	context.server_host = 'a';
	context.close_modal_and_wait = async () => { model.access[0].unlock_cost_micros = 2e6; };
	await state.equipment_confirm('combat');
	assert.equal(mutations, 0, 'changed cost requires reopening the modal');
	context.close_modal_and_wait = async () => {};
	state.equipment_modal_choose({ item_id: 'bronze' });
	await state.equipment_modal_upgrade();
	assert.equal(mutations, 1, 'upgrade targets the slot even when an item detail is selected');
});

test('food action time uses native products, counts burned active cooking and excludes passive recipes', () => {
	const x = fixture();
	const fishing = Object.assign(new EventEmitter(), { id: 'melvorD:Fishing' });
	const cooking = Object.assign(new EventEmitter(), { id: 'melvorD:Cooking' });
	x.game.skills.registeredObjects.set('fishing', fishing); x.game.skills.registeredObjects.set('cooking', cooking);
	const raw = { id: 'melvorD:Fishing_Shrimp', product: { id: 'melvorD:Raw_Shrimp' } };
	const cooked = { id: 'melvorD:Cooking_Shrimp', product: { id: 'melvorD:Shrimp' } };
	const fish_key = 'melvorD:Fishing|melvorD:Raw_Shrimp', cook_key = 'melvorD:Cooking|melvorD:Shrimp';
	x.evidence.start(x.game);
	x.evidence.configure([{ stages: [[{ skill_id: fishing.id, action_id: raw.product.id }], [{ skill_id: cooking.id, action_id: cooked.product.id }]] }]);
	x.game.activeAction = fishing;
	for (let i = 0; i < 600; i++) fishing.emit('action', { skill: fishing, action: raw, interval: 3000, productQuantity: 50 });
	assert.equal(x.evidence.snapshot().time_ms[fish_key], 1800000);
	cooking.masteryAction = cooked;
	cooking.emit('action', { skill: cooking, action: cooked, interval: 3000 });
	assert.equal(x.evidence.snapshot().time_ms[cook_key], 0, 'passive cooking while fishing earns no cooking time');
	x.game.activeAction = cooking;
	cooking.isActive = true;
	cooking.masteryAction = { id: 'native:Other', product: { id: 'melvorD:Herring' } };
	cooking.emit('action', { skill: cooking, action: cooked, interval: 3000 });
	assert.equal(x.evidence.snapshot().time_ms[cook_key], 0, 'passive second recipe earns no time');
	cooking.masteryAction = cooked;
	for (let i = 0; i < 300; i++) cooking.emit('action', { skill: cooking, action: cooked, interval: 3000, successful: false });
	x.evidence.snapshot(); x.evidence.stop(); x.evidence.start(x.game);
	assert.equal(cooking.listenerCount('action'), 1);
	for (let i = 0; i < 300; i++) cooking.emit('action', { skill: cooking, action: cooked, interval: 3000, successful: true, isPassiveCooking: true, productQuantity: 100 });
	assert.equal(x.evidence.snapshot().time_ms[cook_key], 1800000, 'offline bursts and burns count elapsed actions, independent of quantity');
	x.evidence.stop(); assert.equal(cooking.listenerCount('action'), 0);
});

test('concurrent Cooking credits only its active recipe through a Multitasking wrapper', () => {
	const x = fixture();
	const cooking = Object.assign(new EventEmitter(), { id: 'melvorD:Cooking', isActive: true });
	const shrimp = { id: 'melvorD:Cooking_Shrimp', product: { id: 'melvorD:Shrimp' } };
	const herring = { id: 'melvorD:Cooking_Herring', product: { id: 'melvorD:Herring' } };
	const key = 'melvorD:Cooking|melvorD:Shrimp';
	x.game.skills.registeredObjects.set('cooking', cooking);
	x.game.activeAction = { id: 'multitasking:multitasking', isActive: true };
	cooking.masteryAction = shrimp;
	x.evidence.start(x.game);
	x.evidence.configure([{ stages: [[{ skill_id: cooking.id, action_id: shrimp.product.id }]] }]);
	const cook = (successful = true) => cooking.emit('action', {
		skill: cooking, action: shrimp, interval: 3000, successful, isPassiveCooking: true
	});
	cook(); cook(false);
	assert.equal(x.evidence.snapshot().time_ms[key], 6000, 'active cooks and burns count while another station cooks passively');
	cooking.masteryAction = herring;
	cook();
	assert.equal(x.evidence.snapshot().time_ms[key], 6000, 'a passive shrimp recipe does not count');
	cooking.masteryAction = shrimp;
	cooking.isActive = false;
	cook();
	assert.equal(x.evidence.snapshot().time_ms[key], 6000, 'selection and passive-only cooking do not count');
	cooking.isActive = true;
	x.evidence.stop(); x.evidence.start(x.game);
	assert.equal(cooking.listenerCount('action'), 1);
	cook();
	assert.equal(x.evidence.snapshot().time_ms[key], 9000, 'reload retains evidence and one subscription');
	x.evidence.stop(); cook();
	assert.equal(x.evidence.snapshot().time_ms[key], 9000, 'cleanup stops capture');
});

test('food tier purchases have no separate slot charge and require the current food equipped', async () => {
	const { equipment_slot_purchase, equipment_project_visible } = await import('../../mod/equipment-projects.mjs');
	const shrimp = { item_id: 'melvorD:Shrimp', slot: 'Food', tier: 1 };
	const herring = { item_id: 'melvorD:Herring', slot: 'Food', tier: 2 };
	const model = { catalog: [shrimp, herring], access: [{ slot: 'Food', unlock_cost_micros: 0, tiers: [1, 2].map(tier => ({ tier, cost_micros: 1e6 })) }], slots: [], unlocked: [] };
	assert.deepEqual(equipment_slot_purchase(model, 'Food', 1e6), { action: 'unlock-tier', tier: 1, cost_micros: 1e6, affordable: true, eligible: true });
	model.slots.push({ slot: 'Food', tier: 2, upgrade_ready: false });
	assert.equal(equipment_project_visible(model, herring), false);
	model.unlocked.push(shrimp.item_id);
	assert.equal(equipment_project_visible(model, herring), true);
});


test('second food slot shares best-first unlocks but purchases its own access', async () => {
	const {equipment_slot_items,equipment_slot_purchase,equipment_project_visible}=await import('../../mod/equipment-projects.mjs');
	const shrimp={item_id:'melvorD:Shrimp',slot:'Food',tier:1}, herring={item_id:'melvorD:Herring',slot:'Food',tier:2};
	const model={catalog:[shrimp,herring],unlocked:[shrimp.item_id,herring.item_id],
		access:['Food','Food2'].map(slot=>({slot,unlock_cost_micros:0,tiers:[1,2].map(tier=>({tier,cost_micros:1e6}))})),
		slots:[{slot:'Food2',tier:1,upgrade_ready:false}]};
	assert.deepEqual(equipment_slot_items(model,'Food2'),[herring,shrimp]);
	assert.equal(equipment_slot_purchase(model,'Food2',1e6).eligible,false);
	model.slots[0].upgrade_ready=true;
	assert.equal(equipment_slot_purchase(model,'Food2',1e6).eligible,true);
	assert.equal(equipment_slot_purchase(model,'Food',1e6).tier,1);
	assert.equal(equipment_project_visible(model,shrimp),true);
});


test('undiscovered projects can start while slot, predecessor, completion and active-project gates remain', () => {
	const bronze = { item_id: 'melvorD:Bronze_Sword', slot: 'Weapon', tier: 1 };
	const iron = { item_id: 'melvorD:Iron_Sword', slot: 'Weapon', tier: 2 };
	const model = { catalog: [bronze, iron], slots: [{ slot: 'Weapon', tier: 2 }], unlocked: [] };
	assert.equal(equipment_project_startable(model, bronze), true);
	assert.equal(equipment_project_startable(model, iron), false);
	assert.equal(equipment_project_startable({ ...model, unlocked: [bronze.item_id] }, iron), true);
	assert.equal(equipment_project_startable({ ...model, unlocked: [bronze.item_id] }, bronze), false);
	assert.equal(equipment_project_startable({ ...model, slots: [] }, bronze), false);
	assert.equal(equipment_project_startable({ ...model, caps: { material_caps: { Weapon: 0 } } }, bronze), false);
	assert.equal(equipment_project_startable({ ...model, project: { item_id: iron.item_id } }, bronze), false);
	const main = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const html = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.doesNotMatch(main + html, /equipment_discovered|mp-equipment-project-undiscovered/);
	const install = main.slice(main.indexOf('state.equipment_project_can_start ='), main.indexOf('state.equipment_project_title ='));
	let tutorial = true, mutable = true;
	const state = { combat_tutorial_access: () => tutorial, equipment_can_mutate: () => mutable, equipment_model: () => model };
	new Function('state', 'equipment_module', install)(state, { equipment_project_startable });
	assert.equal(state.equipment_project_can_start(bronze), true);
	tutorial = false; assert.equal(state.equipment_project_can_start(bronze), false);
	tutorial = true; mutable = false; assert.equal(state.equipment_project_can_start(bronze), false);
});

test('stage headings follow actual localized skills for final-only and legacy multi-stage recipes', () => {
	const skill_name = id => ({ 'melvorD:Cooking': 'Cuisine', 'melvorD:Smithing': 'Forge', 'melvorD:Fletching': 'Empennage', 'melvorD:Mining': 'Minage' })[id];
	for (const skill of ['Cooking', 'Smithing', 'Fletching']) {
		const item = { stages: [[{ skill_id: `melvorD:${skill}` }]] };
		assert.equal(equipment_project_stage_name(item, 0, skill_name, 'Travail'), skill_name(`melvorD:${skill}`));
	}
	const legacy = { stages: [[{ skill_id: 'melvorD:Mining' }, { skill_id: 'melvorD:Mining' }], [{ skill_id: 'melvorD:Smithing' }]] };
	assert.equal(equipment_project_stage_name(legacy, 0, skill_name, 'Travail'), 'Minage');
	assert.equal(equipment_project_stage_name(legacy, 1, skill_name, 'Travail'), 'Forge');
	assert.equal(equipment_project_stage_name({ stages: [[{ skill_id: 'custom:Crafting' }]] }, 0, skill_name, 'Travail'), 'Crafting');
	assert.equal(equipment_project_stage_name({}, 0, skill_name, 'Travail'), 'Travail');
});
