import assert from 'node:assert/strict';
import test from 'node:test';
import { can_track_task, create_work_prompt_gate, eligible_prompt_tasks, task_available_points_micros, task_contribution_time, task_remaining, tracked_skill_ids } from '../../mod/expedition-tasks.mjs';

test('sidebar icons identify active accepted skills and disappear when tracking ends', () => {
	const tracking = { visit_id: 3, task_id: 'chart' };
	const task = { task_id: 'chart', completed_at: null,
		evidence: { skill_ids: ['melvorD:Astrology', 'melvorD:Summoning', 'melvorD:Combat'] } };
	const state = { tracking, expedition: { chamber: { visit_id: 3, tasks: [task] } } };
	const astrology = { type: 'skill', skill_id: 'melvorD:Astrology' };
	assert.deepEqual(tracked_skill_ids(state, [astrology,
		{ type: 'skill', skill_id: 'melvorD:Woodcutting' }]), ['melvorD:Astrology']);
	assert.deepEqual(tracked_skill_ids(state, [astrology, astrology, { type: 'combat' }]),
		['melvorD:Astrology', 'melvorD:Combat']);
	assert.deepEqual(tracked_skill_ids(state, []), []);
	assert.deepEqual(tracked_skill_ids({ ...state, tracking: null }, [astrology]), []);
	assert.deepEqual(tracked_skill_ids({ ...state, tracking: { ...tracking, pending_boundary_at: 10 } }, [astrology]), []);
	assert.deepEqual(tracked_skill_ids({ ...state, tracking: { ...tracking, claim: true } }, [astrology]), []);
	assert.deepEqual(tracked_skill_ids({ ...state, tracking: { ...tracking, visit_id: 4 } }, [astrology]), []);
	assert.deepEqual(tracked_skill_ids({ ...state, tracking: { ...tracking, task_id: 'other' } }, [astrology]), []);
	task.completed_at = 10;
	assert.deepEqual(tracked_skill_ids(state, [astrology]), []);
});

test('task tracking requires an active listed skill or combat activity', () => {
	const task = { evidence: { skill_ids: ['melvorD:Woodcutting', 'melvorD:Mining'] } };
	assert.equal(can_track_task(task, []), false);
	assert.equal(can_track_task(task, [{ type: 'skill', skill_id: 'melvorD:Fishing' }]), false);
	assert.equal(can_track_task(task, [{ type: 'skill', skill_id: 'melvorD:Fishing' },
		{ type: 'skill', skill_id: 'melvorD:Woodcutting' }]), true);
	assert.equal(can_track_task(task, [{ type: 'combat', area_id: 'melvorD:Volcanic_Cave' }]), false);
	assert.equal(can_track_task({ evidence: { skill_ids: ['melvorD:Combat'] } },
		[{ type: 'combat', area_id: 'melvorD:Volcanic_Cave' }]), true);
	assert.equal(can_track_task(null, [{ type: 'skill', skill_id: 'melvorD:Woodcutting' }]), false);
});

test('contribution time uses hours and minutes and omits displayed zero', () => {
	assert.equal(task_contribution_time(6.5 * 3_600_000), '6:30h');
	assert.equal(task_contribution_time(36_000), '0:01h');
	assert.equal(task_contribution_time(0), null);
	assert.equal(task_contribution_time(20_000), null);
});

test('remaining time includes player work and assistance, rounding up partial minutes', () => {
	const hours = 3_600_000;
	assert.equal(task_remaining({ target_ms: 20 * hours, player_ms: 0, system_ms: 0 }), '20h remaining');
	assert.equal(task_remaining({ target_ms: 20 * hours, player_ms: 14 * hours + 11 * 60_000,
		system_ms: 0 }), '5h 49m remaining');
	assert.equal(task_remaining({ target_ms: hours, player_ms: 30 * 60_000,
		system_ms: 15 * 60_000 }), '15m remaining');
	assert.equal(task_remaining({ target_ms: hours, player_ms: hours - 1, system_ms: 0 }), '1m remaining');
	assert.equal(task_remaining({ target_ms: hours, player_ms: hours, system_ms: 0 }), 'Complete');
});

test('available EP includes assistance and never exceeds the remaining work', () => {
	const hour = 3_600_000;
	assert.equal(task_available_points_micros({ target_ms: 15 * hour, player_ms: 3 * hour, system_ms: hour }), 11_000_000);
	assert.equal(task_available_points_micros({ target_ms: 3600, player_ms: 1 }), 999);
	assert.equal(task_available_points_micros({ target_ms: hour, player_ms: 2 * hour }), 0);
});

test('work prompts offer only unlocked unfinished matching tasks for registered active participants', () => {
	const task = { task_id: 'chart', unlocked_at: 1, completed_at: null,
		evidence: { skill_ids: ['melvorD:Astrology'] } };
	const activities = [{ type: 'skill', skill_id: 'melvorD:Astrology' }];
	const state = { expedition: { status: 'active', registered: true, chamber: { tasks: [task,
		{ ...task, task_id: 'done', completed_at: 2 }, { ...task, task_id: 'locked', unlocked_at: null },
		{ ...task, task_id: 'hidden', requirement: 'conditional', exit_id: 'one' },
		{ ...task, task_id: 'other', evidence: { skill_ids: ['melvorD:Mining'] } }],
		exits: [{ id: 'one', label: '???' }] } } };
	assert.deepEqual(eligible_prompt_tasks(state, activities).map(task => task.task_id), ['chart']);
	state.expedition.chamber.exits[0].label = 'Prismatic Descent';
	assert.deepEqual(eligible_prompt_tasks(state, activities).map(task => task.task_id), ['chart', 'hidden']);
	assert.deepEqual(eligible_prompt_tasks({ ...state, tracking: { task_id: 'old' } }, activities), []);
	assert.deepEqual(eligible_prompt_tasks({ expedition: { ...state.expedition, registered: false } }, activities), []);
	assert.deepEqual(eligible_prompt_tasks({ expedition: { ...state.expedition, status: 'inactive' } }, activities), []);
	assert.deepEqual(eligible_prompt_tasks(state, []), []);
});

test('work prompts delay login, wait for modals and suppress repeated reminders until activity changes', () => {
	const gate = create_work_prompt_gate();
	const input = { session: 1, activities: [{ type: 'skill', skill_id: 'melvorD:Astrology' }], enabled: true, tracking: false };
	const observe = now => gate.observe({ ...input, now });
	assert.equal(observe(0), false);
	assert.equal(observe(7999), false);
	assert.equal(observe(8000), true);
	gate.defer(8000);
	assert.equal(observe(9499), false);
	assert.equal(observe(9500), true);
	gate.consume();
	assert.equal(observe(60000), false);
	input.activities = [{ type: 'skill', skill_id: 'melvorD:Mining' }];
	assert.equal(observe(60001), false);
	assert.equal(observe(62501), true);
	gate.consume();
	input.activities = [];
	assert.equal(observe(65000), false);
	input.activities = [{ type: 'skill', skill_id: 'melvorD:Mining' }];
	assert.equal(observe(66000), false);
	assert.equal(observe(68500), true);
});

test('tracking, opt-out and session changes cancel pending work prompts', () => {
	const gate = create_work_prompt_gate();
	const input = { session: 1, activities: [{ type: 'combat' }], enabled: true, tracking: false };
	assert.equal(gate.observe({ ...input, now: 0 }), false);
	assert.equal(gate.observe({ ...input, tracking: true, now: 8000 }), false);
	assert.equal(gate.observe({ ...input, now: 20000 }), false);
	input.session = 2;
	assert.equal(gate.observe({ ...input, now: 20000 }), false);
	assert.equal(gate.observe({ ...input, enabled: false, now: 28000 }), false);
	assert.equal(gate.observe({ ...input, now: 30000 }), false);
	gate.reset();
	assert.equal(gate.observe({ ...input, now: 30001 }), false);
	assert.equal(gate.observe({ ...input, now: 38001 }), true);
});
