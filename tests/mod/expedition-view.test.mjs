import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	EXPEDITION_PREVIEW_CHAMBER_IDS, EXPEDITION_PREVIEW_LABEL_IDS,
	arrival_complete, display_expedition_label, passage_gateway, passage_name, phase_tasks, phase_summary,
	sync_phase_state, tracked_task_ended, tracking_task_title, visible_tasks, work_skill_icon, work_skill_name
} from '../../mod/expedition-view.mjs';

const task = (task_id, phase, overrides = {}) => ({
	task_id, title: task_id, phase, requirement: 'required', unlocked_at: 1,
	completed_at: null, player_ms: 0, system_ms: 0, trackers: [], ...overrides
});

test('arrival gates later sections and completed work remains visible in its summary', () => {
	const chamber = { visit_id: 4, exits: [], tasks: [
		task('scout', 'arrival'), task('supplies', 'arrival', { requirement: 'optional' }),
		task('explore', 'exploration'), task('prepare', 'departure')
	] };
	assert.equal(arrival_complete(chamber), false);
	assert.equal(phase_summary(chamber, 'arrival'), '0 of 2 done');
	assert.deepEqual(phase_tasks(chamber, 'exploration'), []);
	assert.deepEqual(phase_tasks(chamber, 'departure'), []);
	chamber.tasks[0].completed_at = 2;
	assert.equal(arrival_complete(chamber), true);
	assert.equal(phase_summary(chamber, 'arrival'), '1 of 2 done');
	assert.deepEqual(phase_tasks(chamber, 'exploration').map(value => value.task_id), ['explore']);
	assert.deepEqual(phase_tasks(chamber, 'departure').map(value => value.task_id), ['prepare']);
	assert.deepEqual(phase_tasks(chamber, 'arrival', 'pending').map(value => value.task_id), ['supplies']);
});

test('each Chamber opens all phases and preserves manual toggles during the same visit', () => {
	const state = { expedition_phase_visit_id: null, expedition_phase_open: {
		arrival: false, exploration: false, departure: false
	} };
	sync_phase_state(state, { visit_id: 4, tasks: [task('arrival', 'arrival', { completed_at: 1 })] });
	assert.deepEqual(state.expedition_phase_open, { arrival: true, exploration: true, departure: true });
	state.expedition_phase_open.arrival = false;
	sync_phase_state(state, { visit_id: 4, tasks: [task('arrival', 'arrival', { completed_at: 1 })] });
	assert.equal(state.expedition_phase_open.arrival, false);
	sync_phase_state(state, { visit_id: 5, tasks: [task('arrival', 'arrival', { completed_at: 1 })] });
	assert.deepEqual(state.expedition_phase_open, { arrival: true, exploration: true, departure: true });
});

test('resolves Expedition skill names and icons, including Alt. Magic outside the skill registry', () => {
	const game = {
		altMagic: { media: 'alt-magic.png' },
		skills: { getObjectByID: id => id === 'melvorD:Woodcutting'
			? { name: 'Woodcutting', media: 'woodcutting.png' } : undefined }
	};
	assert.equal(work_skill_name(game, 'melvorD:AltMagic'), 'Alt. Magic');
	assert.equal(work_skill_icon(game, 'melvorD:AltMagic'), 'alt-magic.png');
	assert.equal(work_skill_name(game, 'melvorD:Combat'), 'Combat');
	assert.equal(work_skill_name(game, 'melvorD:Woodcutting'), 'Woodcutting');
	assert.equal(work_skill_icon(game, 'melvorD:Woodcutting'), 'woodcutting.png');
	assert.equal(work_skill_name(game, 'unknown:Skill'), 'unknown:Skill');
	assert.equal(work_skill_icon(game, 'unknown:Skill'), 'assets/media/main/question.png');
	assert.equal(work_skill_icon({}, 'melvorD:AltMagic'), 'assets/media/main/question.png');
});

test('work stages use completion, Guild progress, and the viewer tracking session', () => {
	const chamber = { visit_id: 4, exits: [{ id: 'exit:1', label: '???' }], tasks: [
		task('scout', 'arrival', { completed_at: 2 }),
		task('done', 'exploration', { completed_at: 3 }),
		task('mine', 'exploration', { player_ms: 1 }),
		task('study', 'exploration'),
		task('hidden', 'departure', { requirement: 'conditional', exit_id: 'exit:1' }),
		task('locked', 'exploration', { unlocked_at: null })
	] };
	const tracking = { visit_id: 4, task_id: 'study' };
	assert.deepEqual(phase_tasks(chamber, 'exploration', 'done', tracking).map(value => value.task_id), ['done']);
	assert.deepEqual(phase_tasks(chamber, 'exploration', 'active', tracking).map(value => value.task_id), ['mine', 'study']);
	assert.deepEqual(phase_tasks(chamber, 'departure'), []);
	assert.equal(visible_tasks(chamber).some(value => value.task_id === 'locked'), false);
	chamber.exits[0].label = 'Prismatic Descent';
	assert.deepEqual(phase_tasks(chamber, 'departure').map(value => value.task_id), ['hidden']);
});

test('display names change without changing server task identity or evidence', () => {
	const tracked = task('side', 'exploration', {
		title: 'Study Entrance', evidence: { skill_ids: ['melvorD:Crafting', 'melvorD:Mining'] }
	});
	const chamber = { visit_id: 4, exits: [{}, {}, {}], tasks: [tracked] };
	assert.equal(tracking_task_title(chamber, { task_id: 'side' }), 'Study The Rift');
	assert.equal(tracked.task_id, 'side');
	assert.deepEqual(tracked.evidence.skill_ids, ['melvorD:Crafting', 'melvorD:Mining']);
	assert.equal(display_expedition_label('Trace exit 2', 3), 'Trace Second Passage');
	assert.equal(display_expedition_label('Prepare exit 1', 1), 'Prepare The Passage');
	assert.equal(passage_name(3, 3), 'Third Passage');
});

test('localizes only Preview route chamber and task labels from persisted English content', async () => {
	const english = key => key;
	assert.equal(display_expedition_label('Prismatic Descent', 0, english),
		'MOD_MP_EXPEDITION_CONTENT_PRISMATIC_DESCENT');
	assert.equal(display_expedition_label('Explore the chamber', 3, english, 'entrance'),
		'MOD_MP_EXPEDITION_CONTENT_EXPLORE_THE_CHAMBER');
	assert.equal(display_expedition_label('Explore the chamber', 3, english, 'drowned_cloister'),
		'Explore the chamber');
	assert.equal(display_expedition_label('Untranslated task', 3, english, 'entrance'),
		'Untranslated task');
	const [content, chinese] = await Promise.all([
		readFile(new URL('../../server/expedition-content-v1.json', import.meta.url), 'utf8').then(JSON.parse),
		readFile(new URL('../../mod/data/lang/zh-CN.json', import.meta.url), 'utf8').then(JSON.parse)
	]);
	const route = { entrance: 1, prismatic_descent: 1, glassroot_terraces: 3,
		buried_observatory: 1, prismatic_orrery: 3, voidwatch_threshold: 1 };
	assert.equal(EXPEDITION_PREVIEW_CHAMBER_IDS.length, 7);
	for (const chamber of content.chambers.filter(value => EXPEDITION_PREVIEW_CHAMBER_IDS.includes(value.id))) {
		const labels = [chamber.label, ...chamber.tasks.filter(task => {
			const selected_exit = `${chamber.id}:exit_${route[chamber.id]}`;
			return (!task.discovery_target || task.discovery_target === selected_exit) &&
				(!task.exit_id || task.exit_id === selected_exit);
		}).map(task => task.title)];
		for (const label of labels) {
			const key = EXPEDITION_PREVIEW_LABEL_IDS[label];
			assert.ok(key, `${chamber.id}: ${label}`);
			assert.ok(chinese[key], `${chamber.id}: ${key}`);
		}
	}
});

test('passage frames follow Chamber slots without repeating within a Chamber', async () => {
	const content = JSON.parse(await readFile(new URL('../../server/expedition-content-v1.json', import.meta.url), 'utf8'));
	for (const chamber of content.chambers) {
		const frames = chamber.exits.map(edge => passage_gateway(chamber.id, edge.slot));
		assert.equal(new Set(frames).size, frames.length, chamber.id);
	}
	assert.deepEqual(content.chambers.find(chamber => chamber.id === 'entrance').exits.map(edge =>
		passage_gateway('entrance', edge.slot)), ['rocky-cave', 'ruined-stone', 'petrified-roots']);
});

test('finished tracked work is detected after completion or Chamber departure', () => {
	const state = { tracking: { visit_id: 4, task_id: 'scout' }, expedition: { chamber: {
		visit_id: 4, tasks: [task('scout', 'arrival')]
	} } };
	assert.equal(tracked_task_ended(state), false);
	state.expedition.chamber.tasks[0].completed_at = 2;
	assert.equal(tracked_task_ended(state), true);
	state.expedition.chamber.tasks[0].completed_at = null;
	state.expedition.chamber.visit_id = 5;
	assert.equal(tracked_task_ended(state), true);
	assert.equal(tracked_task_ended({ expedition: state.expedition }), false);
});
