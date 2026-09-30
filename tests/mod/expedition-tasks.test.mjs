import assert from 'node:assert/strict';
import test from 'node:test';
import { can_track_task, task_contribution_time, task_remaining, tracked_skill_ids } from '../../mod/expedition-tasks.mjs';

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
