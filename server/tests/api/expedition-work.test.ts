import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';
import { EXPEDITION_CONTENT_PREVIEW, EXPEDITION_CONTENT_V1 } from '../../expedition-content';

const woodcutting = { type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' };
const fishing = { type: 'skill', skill_id: 'melvorD:Fishing', action_id: 'melvorD:Raw_Shrimp' };
const firemaking = { type: 'skill', skill_id: 'melvorD:Firemaking', action_id: 'melvorD:Normal_Logs' };
const stats = (woodcutting_ms: number) => ({ version: 1, time_ms: { 'melvorD:Woodcutting': woodcutting_ms } });

type State = { expedition: { id: number; chamber: { visit_id: number; tasks: {
	task_id: string; unlocked_at: number | null; evidence: { skill_ids: string[] }
}[] } } };

async function entrance() {
	const guild = await make_guildmates('Expedition Worker', 'Expedition Witness', 'Work Guild');
	const registered = await post_json<{ expedition_id: number }>(
		'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
	await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
		[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, registered.json.expedition_id]);
	const state = (await get_json_with_session<State>('/api/expedition/state', guild.first.session_token)).json;
	const task = state.expedition.chamber.tasks.find(row => row.unlocked_at !== null &&
		row.evidence.skill_ids.includes('melvorD:Woodcutting'))!;
	const unrelated = [fishing, firemaking].find(activity => !task.evidence.skill_ids.includes(activity.skill_id))!;
	return { guild, expedition_id: state.expedition.id, visit_id: state.expedition.chamber.visit_id,
		task: task.task_id, unrelated };
}

function request(expedition_id: number, visit_id: number, kind: string, task_id?: string, value = 0) {
	return { operation_id: crypto.randomUUID(), expedition_id, visit_id, task_id,
		statistics: stats(value), activities: [woodcutting], captured_at: Date.now() };
}

async function restore_v1_content(expedition_id: number, visit_id: number) {
	await db_run('UPDATE expeditions SET content_version = ?, content_snapshot = ? WHERE id = ?',
		[EXPEDITION_CONTENT_V1.version, JSON.stringify(EXPEDITION_CONTENT_V1), expedition_id]);
	const entrance = EXPEDITION_CONTENT_V1.chambers.find(chamber => chamber.id === 'entrance')!;
	for (const task of entrance.tasks.filter(task => task.discovery_target || task.exit_id))
		await db_run('INSERT OR IGNORE INTO expedition_tasks (visit_id, task_id, target_ms) VALUES (?, ?, ?)',
			[visit_id, task.id, task.baseline_hours * 3_600_000]);
}

describe('Expedition verified work', () => {
	test('credits a short verified statistic delta in full after task completion', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const hour = 3_600_000;
		await db_run('UPDATE expedition_tasks SET target_ms = ?, player_ms = ?, system_ms = ? WHERE visit_id = ? AND task_id = ?',
			[45 * hour, 28 * hour, 0, visit_id, task]);
		const started = await post_json<any>('/api/expedition/task/start',
			request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const start_at = Date.now() - 10 * hour;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[start_at, start_at, started.json.tracking.session_id]);
		await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[start_at + 3 * hour, visit_id, task]);
		const report = { ...request(expedition_id, visit_id, 'check-in', undefined, 270_000), captured_at: start_at + 10 * hour };
		const settled = await post_json<any>('/api/expedition/task/check-in', report, guild.first.session_token);
		expect(settled.json.settlement).toMatchObject({ credited_ms: 270_000, guild_ms: 0,
			points_micros: 75_000, estimated_cutoff: false });
		expect(settled.json.tracking).toBeNull();
		expect((await post_json<any>('/api/expedition/task/check-in', report, guild.first.session_token)).json).toEqual(settled.json);
	});

	test('caps a late offline return by the starting remaining work', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const hour = 3_600_000;
		await db_run('UPDATE expedition_tasks SET target_ms = ?, player_ms = 0, system_ms = 0 WHERE visit_id = ? AND task_id = ?',
			[10 * hour, visit_id, task]);
		const started = await post_json<any>('/api/expedition/task/start',
			request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const start_at = Date.now() - 12 * hour;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[start_at, start_at, started.json.tracking.session_id]);
		await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[start_at + 11 * hour, visit_id, task]);
		const report = { ...request(expedition_id, visit_id, 'stop', undefined, 12 * hour), captured_at: start_at + 12 * hour };
		const settled = await post_json<any>('/api/expedition/task/stop', report, guild.first.session_token);
		expect(settled.json.settlement).toMatchObject({ credited_ms: 10 * hour, guild_ms: 0, points_micros: 10_000_000 });
	});

	test('a 99% complete task grants only its remaining allowance, including assistance', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const hour = 3_600_000;
		await db_run('UPDATE expedition_tasks SET target_ms = ?, player_ms = ?, system_ms = ? WHERE visit_id = ? AND task_id = ?',
			[10 * hour, 9 * hour, 0.9 * hour, visit_id, task]);
		const started = await post_json<any>('/api/expedition/task/start',
			request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const start_at = Date.now() - 8 * hour;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[start_at, start_at, started.json.tracking.session_id]);
		const settled = await post_json<any>('/api/expedition/task/check-in',
			{ ...request(expedition_id, visit_id, 'check-in', undefined, 8 * hour), captured_at: start_at + 8 * hour }, guild.first.session_token);
		expect(settled.json.settlement).toMatchObject({ credited_ms: 360_000, guild_ms: 360_000, points_micros: 100_000 });
		expect(settled.json.tracking).toBeNull();
	});

	test('same-task check-ins carry unused allowance and dissolution cannot renew it', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const hour = 3_600_000;
		await db_run('UPDATE expedition_tasks SET target_ms = ?, player_ms = 0, system_ms = 0 WHERE visit_id = ? AND task_id = ?',
			[10 * hour, visit_id, task]);
		const started = await post_json<any>('/api/expedition/task/start',
			request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		let tracking = started.json.tracking;
		expect(tracking.reward_remaining_ms).toBe(10 * hour);
		for (const kind of ['check-in', 'start']) {
			const start_at = Date.now() - hour;
			await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
				[start_at, start_at, tracking.session_id]);
			const settled = await post_json<any>(`/api/expedition/task/${kind}`,
				{ ...request(expedition_id, visit_id, kind, kind === 'start' ? task : undefined, kind === 'start' ? 2 * hour : hour),
					captured_at: start_at + hour }, guild.first.session_token);
			expect(settled.json.settlement.credited_ms).toBe(hour);
			tracking = settled.json.tracking;
			expect(tracking.reward_remaining_ms).toBe((kind === 'check-in' ? 9 : 8) * hour);
			if (kind === 'check-in')
				await db_run('UPDATE expedition_tasks SET player_ms = player_ms + ? WHERE visit_id = ? AND task_id = ?',
					[4 * hour, visit_id, task]);
		}
		expect((await db_all('SELECT reward_remaining_ms FROM expedition_work_sessions WHERE id = ?', [tracking.session_id]))[0])
			.toMatchObject({ reward_remaining_ms: 8 * hour });
		const start_at = Date.now() - 12 * hour;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[start_at, start_at, tracking.session_id]);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		expect((await db_all('SELECT reward_remaining_ms FROM expedition_work_claims WHERE session_id = ?', [tracking.session_id]))[0])
			.toMatchObject({ reward_remaining_ms: 8 * hour });
		expect((await get_json_with_session<any>('/api/expedition/personal', guild.first.session_token)).json.tracking)
			.toMatchObject({ claim: true, reward_remaining_ms: 8 * hour });
		const settled = await post_json<any>('/api/expedition/task/stop',
			{ ...request(expedition_id, visit_id, 'stop', undefined, 14 * hour), captured_at: start_at + 12 * hour }, guild.first.session_token);
		expect(settled.json.settlement).toMatchObject({ credited_ms: 8 * hour, guild_ms: 0, points_micros: 8_000_000 });
	});

	test('dissolution retains an earlier Chamber departure but not task completion as the reward cutoff', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const hour = 3_600_000;
		const started = await post_json<any>('/api/expedition/task/start',
			request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const start_at = Date.now() - 4 * hour;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[start_at, start_at, started.json.tracking.session_id]);
		await db_run('UPDATE expedition_visits SET entered_at = ?, departed_at = ? WHERE id = ?',
			[start_at, start_at + hour, visit_id]);
		await db_run('UPDATE expedition_tasks SET completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[start_at + hour / 2, visit_id, task]);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		expect((await db_all('SELECT cutoff_at FROM expedition_work_claims WHERE session_id = ?', [started.json.tracking.session_id]))[0])
			.toEqual({ cutoff_at: start_at + hour });
		const settled = await post_json<any>('/api/expedition/task/stop',
			{ ...request(expedition_id, visit_id, 'stop', undefined, 4 * hour), captured_at: start_at + 4 * hour }, guild.first.session_token);
		expect(settled.json.settlement).toMatchObject({ credited_ms: hour, guild_ms: 0, points_micros: 1_000_000, estimated_cutoff: true });
	});

	test('accepts clocks ahead or behind and records the measured offset', async () => {
		for (const offset of [-86_400_000, 86_400_000]) {
			const { guild, expedition_id, visit_id, task } = await entrance();
			const report = { ...request(expedition_id, visit_id, 'start', task), captured_at: Date.now() + offset };
			const started = await post_json<any>('/api/expedition/task/start', report, guild.first.session_token);
			expect(started.json.success).toBe(true);
			expect(started.json.clock.reported_capture_at).toBe(report.captured_at);
			expect(started.json.clock.effective_capture_at).toBe(started.json.tracking.started_at);
			const rows = await db_all('SELECT start_clock_offset_ms FROM expedition_work_sessions WHERE id = ?',
				[started.json.tracking.session_id]);
			expect(rows[0]!.start_clock_offset_ms).toBe(report.captured_at - started.json.tracking.started_at);
		}
	});

	test('reconciles skewed clocks conservatively and replays settlement once', async () => {
		for (const reported_elapsed of [-60_000, 30_000, 3_600_000]) {
			const { guild, expedition_id, visit_id, task } = await entrance();
			const initial = { ...request(expedition_id, visit_id, 'start', task), captured_at: Date.now() + 86_400_000 };
			const started = await post_json<any>('/api/expedition/task/start', initial, guild.first.session_token);
			const start_at = Date.now() - 60_000;
			const offset = initial.captured_at - started.json.tracking.started_at;
			await db_run('UPDATE expedition_work_sessions SET started_at = ?, last_observed_at = ? WHERE id = ?',
				[start_at, start_at, started.json.tracking.session_id]);
			const report = { ...request(expedition_id, visit_id, 'check-in', undefined, 3_600_000),
				captured_at: start_at + offset + reported_elapsed };
			const checked = await post_json<any>('/api/expedition/task/check-in', report, guild.first.session_token);
			expect(checked.json.success).toBe(true);
			expect(checked.json.tracking).toBeTruthy();
			expect(checked.json.settlement.elapsed_ms).toBeGreaterThanOrEqual(Math.max(0, Math.min(60_000, reported_elapsed)));
			expect(checked.json.settlement.elapsed_ms).toBeLessThan(65_000);
			if (reported_elapsed <= 30_000)
				expect(checked.json.settlement.elapsed_ms).toBe(Math.max(0, reported_elapsed));
			expect(checked.json.settlement.credited_ms).toBeLessThanOrEqual(checked.json.settlement.elapsed_ms);
			expect((await post_json<any>('/api/expedition/task/check-in', report, guild.first.session_token)).json)
				.toEqual(checked.json);
			const rows = await db_all('SELECT start_clock_offset_ms FROM expedition_work_sessions WHERE id = ?',
				[checked.json.tracking.session_id]);
			expect(rows[0]!.start_clock_offset_ms).toBe(report.captured_at - checked.json.tracking.started_at);
		}
	});

	test('preserves skewed pending capture times through dissolution and exact retries', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const initial = { ...request(expedition_id, visit_id, 'start', task), captured_at: Date.now() + 86_400_000 };
		const started = await post_json<any>('/api/expedition/task/start', initial, guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 60_000, Date.now() - 60_000, started.json.tracking.session_id]);
		const missing = { ...request(expedition_id, visit_id, 'stop'), captured_at: Date.now() + 86_400_000,
			statistics: { version: 1, time_ms: {} } };
		const pending = await post_json<any>('/api/expedition/task/stop', missing, guild.first.session_token);
		expect(pending.json.pending).toBe(true);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		const claims = await db_all('SELECT start_clock_offset_ms, pending_reported_capture_at FROM expedition_work_claims WHERE session_id = ?',
			[started.json.tracking.session_id]);
		expect(claims[0]!.pending_reported_capture_at).toBe(missing.captured_at);
		expect(claims[0]!.start_clock_offset_ms).toBe(initial.captured_at - started.json.tracking.started_at);
		const retry = { ...missing, operation_id: crypto.randomUUID() };
		const retried = await post_json<any>('/api/expedition/task/stop', retry, guild.first.session_token);
		expect(retried.json.pending).toBe(true);
		expect(retried.json.clock.effective_capture_at).toBe(pending.json.clock.effective_capture_at);
		const substituted = await post_json<any>('/api/expedition/task/stop',
			{ ...retry, operation_id: crypto.randomUUID(), statistics: stats(60_000) }, guild.first.session_token);
		expect(substituted.json.error).toBe('original_snapshot_missing');
		const moved = await post_json<any>('/api/expedition/task/stop',
			{ ...retry, operation_id: crypto.randomUUID(), captured_at: missing.captured_at + 1 }, guild.first.session_token);
		expect(moved.json.error).toBe('boundary_capture_mismatch');
	});

	test('accepts a nearby skewed snapshot after an automatic stop without credit beyond the boundary', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const initial = { ...request(expedition_id, visit_id, 'start', task), captured_at: Date.now() - 86_400_000 };
		const started = await post_json<any>('/api/expedition/task/start', initial, guild.first.session_token);
		const start_at = Date.now() - 60_000;
		await db_run('UPDATE expedition_work_sessions SET started_at = ?, last_observed_at = ? WHERE id = ?',
			[start_at, start_at, started.json.tracking.session_id]);
		const stopped = await post_json<any>('/api/client/status/sync', { activities: [] }, guild.first.session_token);
		const boundary = stopped.json.expedition_work_stopped.boundary_at;
		const offset = initial.captured_at - started.json.tracking.started_at;
		const checked = await post_json<any>('/api/expedition/task/stop',
			{ ...request(expedition_id, visit_id, 'stop', undefined, 60_000), captured_at: boundary + offset + 15_000 },
			guild.first.session_token);
		expect(checked.json.success).toBe(true);
		expect(checked.json.clock.effective_capture_at).toBe(boundary);
		expect(checked.json.settlement.credited_ms).toBeLessThanOrEqual(boundary - start_at);
	});

	test('requires qualifying activity before starting task tracking', async () => {
		const { guild, expedition_id, visit_id, task, unrelated } = await entrance();
		for (const activities of [[], [unrelated]]) {
			const start = await post_json<{ success: boolean; error: string }>(
				'/api/expedition/task/start', { ...request(expedition_id, visit_id, 'start', task), activities },
				guild.first.session_token);
			expect(start.json).toEqual({ success: false, error: 'activity_required' });
		}
		expect(await db_all('SELECT id FROM expedition_work_sessions WHERE client_id = ?',
			[guild.first.client_id])).toEqual([]);
		const active = await post_json<{ success: boolean; tracking: { task_id: string } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		expect(active.json.success).toBe(true);
		expect(active.json.tracking.task_id).toBe(task);
	});

	test('check-in does not restart tracking after the qualifying activity ends', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ success: boolean; tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		expect(started.json.success).toBe(true);
		const checked = await post_json<{ success: boolean; tracking: unknown; settlement: unknown }>(
			'/api/expedition/task/check-in', { ...request(expedition_id, visit_id, 'check-in', undefined, 1000),
				activities: [] }, guild.first.session_token);
		expect(checked.json.success).toBe(true);
		expect(checked.json.settlement).toBeTruthy();
		expect(checked.json.tracking).toBeNull();
		expect(await db_all('SELECT id FROM expedition_work_sessions WHERE id = ? AND ended_at IS NULL',
			[started.json.tracking.session_id])).toEqual([]);
	});

	test('accepts one registered task and settles once into Guild progress and personal EP', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const start = await post_json<{ success: boolean; tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		expect(start.json.success).toBe(true);
		const hour_ago = Date.now() - 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ? WHERE id = ?', [hour_ago, start.json.tracking.session_id]);
		const check = request(expedition_id, visit_id, 'check-in', undefined, 3_600_000);
		const settled = await post_json<{ success: boolean; settlement: { credited_ms: number; guild_ms: number };
			points_micros: number }>('/api/expedition/task/check-in', check, guild.first.session_token);
		expect(settled.json.success).toBe(true);
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect(settled.json.settlement.guild_ms).toBe(settled.json.settlement.credited_ms);
		const replay = await post_json('/api/expedition/task/check-in', check, guild.first.session_token);
		expect(replay.json).toEqual(settled.json);
		const progress = await db_all<{ player_ms: number }>(
			'SELECT player_ms FROM expedition_tasks WHERE visit_id = ? AND task_id = ?', [visit_id, task]);
		expect(progress[0].player_ms).toBe(settled.json.settlement.guild_ms);
		expect((await db_all('SELECT id FROM expedition_ep_ledger WHERE source_kind = ? AND source_id = ?',
			['work', start.json.tracking.session_id])).length).toBe(1);
		expect(settled.json.points_micros).toBeGreaterThan(0);
	});

	test('rejects a stale or foreign task and gives no credit without statistic evidence', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const foreign = await post_json<{ success: boolean; error: string }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.second.session_token);
		expect(foreign.json.error).toBe('task_unavailable');
		const stale = await post_json<{ success: boolean; error: string }>(
			'/api/expedition/task/start', request(expedition_id, visit_id + 99, 'start', task), guild.first.session_token);
		expect(stale.json.error).toBe('task_unavailable');
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, started.json.tracking.session_id]);
		const checked = await post_json<{ settlement: { credited_ms: number; reason: string } }>(
			'/api/expedition/task/stop', request(expedition_id, visit_id, 'stop', undefined, 0), guild.first.session_token);
		expect(checked.json.settlement.credited_ms).toBe(0);
		expect(checked.json.settlement.reason).toBe('unverified');
	});

	test('does not substitute later statistics for a missing original stop snapshot', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, Date.now() - 3_600_000, started.json.tracking.session_id]);
		const missing = { ...request(expedition_id, visit_id, 'stop', undefined, 0),
			statistics: { version: 1, time_ms: {} } };
		const pending = await post_json<any>('/api/expedition/task/stop', missing, guild.first.session_token);
		expect(pending.json.pending).toBe(true);
		expect((await post_json<any>('/api/expedition/task/stop', missing, guild.first.session_token)).json)
			.toEqual(pending.json);
		const changed_boundary = await post_json<any>('/api/expedition/task/stop',
			{ ...missing, operation_id: crypto.randomUUID(), captured_at: missing.captured_at + 1,
				statistics: stats(3_600_000) }, guild.first.session_token);
		expect(changed_boundary.json.error).toBe('boundary_capture_mismatch');
		const substituted = await post_json<any>('/api/expedition/task/stop',
			{ ...missing, operation_id: crypto.randomUUID(), statistics: stats(3_600_000) },
			guild.first.session_token);
		expect(substituted.json.error).toBe('original_snapshot_missing');
		expect((await get_json_with_session<any>('/api/expedition/personal', guild.first.session_token)).json.tracking)
			.toMatchObject({ session_id: started.json.tracking.session_id, pending_boundary_at: missing.captured_at });
		expect((await db_all('SELECT id FROM expedition_ep_ledger WHERE source_kind = ? AND source_id = ?',
			['work', started.json.tracking.session_id])).length).toBe(0);
	});

	test('settles a missing boundary snapshot at zero after 24 hours', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, started.json.tracking.session_id]);
		const missing = { ...request(expedition_id, visit_id, 'stop', undefined, 0),
			statistics: { version: 1, time_ms: {} } };
		const pending = await post_json<any>('/api/expedition/task/stop', missing, guild.first.session_token);
		expect(pending.json.pending).toBe(true);
		await db_run('UPDATE expedition_work_sessions SET pending_boundary_at = ? WHERE id = ?',
			[Date.now() - 24 * 3_600_000 - 1, started.json.tracking.session_id]);
		const personal = (await get_json_with_session<any>('/api/expedition/personal', guild.first.session_token)).json;
		expect(personal.tracking).toBeNull();
		const ended = (await db_all<{ credited_ms: number; end_reason: string }>(
			'SELECT credited_ms, end_reason FROM expedition_work_sessions WHERE id = ?',
			[started.json.tracking.session_id]))[0];
		expect(ended).toMatchObject({ credited_ms: 0, end_reason: 'unverified' });
	});

	test('preserves one personal work claim when the Guild dissolves before check-in', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, Date.now() - 3_600_000, started.json.tracking.session_id]);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		expect(await db_all('SELECT id FROM expeditions WHERE id = ?', [expedition_id])).toEqual([]);
		const personal = (await get_json_with_session<any>('/api/expedition/personal', guild.first.session_token)).json;
		expect(personal.tracking).toMatchObject({ session_id: started.json.tracking.session_id, claim: true });
		const report = request(expedition_id, visit_id, 'stop', undefined, 3_600_000);
		const settled = await post_json<any>('/api/expedition/task/stop', report, guild.first.session_token);
		expect(settled.json.success).toBe(true);
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect(settled.json.settlement.guild_ms).toBe(0);
		expect((await post_json<any>('/api/expedition/task/stop', report, guild.first.session_token)).json)
			.toEqual(settled.json);
		expect((await db_all('SELECT id FROM expedition_ep_ledger WHERE source_kind = ? AND source_id = ?',
			['work', started.json.tracking.session_id])).length).toBe(1);
		const after = (await get_json_with_session<any>('/api/expedition/personal', guild.first.session_token)).json;
		expect(after.tracking).toBeNull();
		expect(after.history.find((entry: any) => entry.expedition_id === expedition_id).earned_points_micros)
			.toBe(settled.json.settlement.points_micros);
	});

	test('settles a dissolved Guild claim through its saved capture boundary after a delayed delivery', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const captured_at = Date.now() - 2 * 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[captured_at - 3_600_000, captured_at - 3_600_000, started.json.tracking.session_id]);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		const report = request(expedition_id, visit_id, 'stop', undefined, 3_600_000);
		report.captured_at = captured_at;
		const settled = await post_json<any>('/api/expedition/task/stop', report, guild.first.session_token);
		expect(settled.json.settlement.elapsed_ms).toBe(3_600_000);
		expect(settled.json.settlement.credited_ms).toBe(3_600_000);
		expect(settled.json.settlement.guild_ms).toBe(0);
	});

	test('retains a pending original boundary after Guild dissolution', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, Date.now() - 3_600_000, started.json.tracking.session_id]);
		const report = request(expedition_id, visit_id, 'stop', undefined, 3_600_000);
		const stopped = await post_json<any>('/api/client/status/sync', { activities: [] }, guild.first.session_token);
		expect(stopped.json.expedition_work_stopped.pending).toBe(true);
		report.captured_at = stopped.json.expedition_work_stopped.boundary_at - 1;
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		const personal = (await get_json_with_session<any>('/api/expedition/personal', guild.first.session_token)).json;
		expect(personal.tracking).toMatchObject({ claim: true,
			pending_boundary_at: stopped.json.expedition_work_stopped.boundary_at });
		const settled = await post_json<any>('/api/expedition/task/stop',
			report,
			guild.first.session_token);
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect(settled.json.settlement.guild_ms).toBe(0);
	});

	test('credits departed members only before their cutoff and advances an open original task', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, Date.now() - 3_600_000, started.json.tracking.session_id]);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		const settled = await post_json<any>('/api/expedition/task/stop',
			request(expedition_id, visit_id, 'stop', undefined, 3_600_000), guild.first.session_token);
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect(settled.json.settlement.guild_ms).toBe(settled.json.settlement.credited_ms);
		expect((await db_all<{ player_ms: number }>(
			'SELECT player_ms FROM expedition_tasks WHERE visit_id = ? AND task_id = ?', [visit_id, task]))[0].player_ms)
			.toBe(settled.json.settlement.guild_ms);
	});

	test('prorates verified work at the membership cutoff before applying original visit progress', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const two_hours_ago = Date.now() - 2 * 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[two_hours_ago, two_hours_ago, started.json.tracking.session_id]);
		await db_run('UPDATE expedition_membership_tenures SET started_at = ?, ended_at = ? WHERE id = ' +
			'(SELECT tenure_id FROM expedition_work_sessions WHERE id = ?)',
			[two_hours_ago, two_hours_ago + 3_600_000, started.json.tracking.session_id]);
		const settled = await post_json<any>('/api/expedition/task/stop',
			request(expedition_id, visit_id, 'stop', undefined, 2 * 3_600_000), guild.first.session_token);
		expect(settled.json.success).toBe(true);
		expect(settled.json.settlement.estimated_cutoff).toBe(true);
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect(settled.json.settlement.credited_ms).toBeLessThan(3_600_001);
		expect(settled.json.settlement.guild_ms).toBe(settled.json.settlement.credited_ms);
	});

	test('uses the original capture boundary when a stop report arrives later', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const captured_at = Date.now() - 2 * 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[captured_at - 3_600_000, captured_at - 3_600_000, started.json.tracking.session_id]);
		const report = request(expedition_id, visit_id, 'stop', undefined, 3_600_000);
		report.captured_at = captured_at;
		const settled = await post_json<any>('/api/expedition/task/stop', report, guild.first.session_token);
		expect(settled.json.success).toBe(true);
		expect(settled.json.settlement.elapsed_ms).toBe(3_600_000);
		expect(settled.json.settlement.credited_ms).toBe(3_600_000);
		expect((await post_json<any>('/api/expedition/task/stop', report, guild.first.session_token)).json)
			.toEqual(settled.json);
	});

	test('settles work earned before inactivity without reopening Guild progress', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, Date.now() - 3_600_000, started.json.tracking.session_id]);
		await db_run("UPDATE expeditions SET status = 'inactive', ended_at = ?, current_visit_id = NULL WHERE id = ?",
			[Date.now(), expedition_id]);
		await db_run('UPDATE expedition_visits SET departed_at = ? WHERE id = ?', [Date.now(), visit_id]);
		const settled = await post_json<any>('/api/expedition/task/stop',
			request(expedition_id, visit_id, 'stop', undefined, 3_600_000), guild.first.session_token);
		expect(settled.json.success).toBe(true);
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect(settled.json.settlement.guild_ms).toBe(0);
		expect((await db_all<{ player_ms: number }>(
			'SELECT player_ms FROM expedition_tasks WHERE visit_id = ? AND task_id = ?', [visit_id, task]))[0].player_ms).toBe(0);
	});

	test('settles a departed Chamber visit for personal credit only', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, Date.now() - 3_600_000, started.json.tracking.session_id]);
		await db_run('UPDATE expedition_visits SET departed_at = ? WHERE id = ?', [Date.now(), visit_id]);
		await db_run('INSERT INTO expedition_visits (expedition_id, chamber_id, entered_at, participant_count, charted_on_arrival) ' +
			'VALUES (?, ?, ?, ?, ?)', [expedition_id, 'rootforge_passage', Date.now(), 1, 0]);
		const next = (await db_all<{ id: number }>(
			'SELECT id FROM expedition_visits WHERE expedition_id = ? AND departed_at IS NULL', [expedition_id]))[0].id;
		for (const next_task of EXPEDITION_CONTENT_V1.chambers.find(chamber => chamber.id === 'rootforge_passage')!.tasks)
			await db_run('INSERT INTO expedition_tasks (visit_id, task_id, target_ms) VALUES (?, ?, ?)',
				[next, next_task.id, Math.max(1, next_task.baseline_hours * 3_600_000)]);
		await db_run('UPDATE expeditions SET current_visit_id = ? WHERE id = ?', [next, expedition_id]);
		const settled = await post_json<any>('/api/expedition/task/check-in',
			request(expedition_id, visit_id, 'check-in', undefined, 3_600_000), guild.first.session_token);
		expect(settled.json.success).toBe(true);
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect(settled.json.settlement.guild_ms).toBe(0);
		expect(settled.json.tracking).toBeNull();
	});

	test('caps concurrent work at the task target while crediting each player personally', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
		const first = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const second = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.second.session_token);
		const hour_ago = Date.now() - 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id IN (?, ?)',
			[hour_ago, hour_ago, first.json.tracking.session_id, second.json.tracking.session_id]);
		await db_run('UPDATE expedition_tasks SET target_ms = ? WHERE visit_id = ? AND task_id = ?',
			[3_600_000, visit_id, task]);
		const first_report = await post_json<any>('/api/expedition/task/stop',
			request(expedition_id, visit_id, 'stop', undefined, 3_600_000), guild.first.session_token);
		const second_report = await post_json<any>('/api/expedition/task/stop',
			request(expedition_id, visit_id, 'stop', undefined, 3_600_000), guild.second.session_token);
		expect(first_report.json.settlement.guild_ms).toBeGreaterThan(3_500_000);
		expect(second_report.json.settlement.guild_ms).toBeLessThan(100_000);
		expect(second_report.json.settlement.credited_ms).toBeGreaterThan(3_500_000);
		expect((await db_all<{ player_ms: number }>(
			'SELECT player_ms FROM expedition_tasks WHERE visit_id = ? AND task_id = ?', [visit_id, task]))[0].player_ms)
			.toBeLessThanOrEqual(3_600_000);
	});
	test('accepts official DLC work alongside a base-game path', async () => {
		const { guild, expedition_id, visit_id } = await entrance();
		const content = structuredClone(EXPEDITION_CONTENT_PREVIEW);
		content.chambers.find(chamber => chamber.id === 'entrance')!.tasks
			.find(task => task.id === 'arrival_chart')!.evidence.skill_ids.push('melvorAoD:Archaeology');
		await db_run('UPDATE expeditions SET content_snapshot = ? WHERE id = ?', [JSON.stringify(content), expedition_id]);
		const archaeology = { type: 'skill', skill_id: 'melvorAoD:Archaeology', action_id: 'melvorAoD:Dig_Site' };
		const start = await post_json<{ success: boolean; tracking: { session_id: number } }>(
			'/api/expedition/task/start', { ...request(expedition_id, visit_id, 'start', 'arrival_chart'),
				activities: [archaeology], statistics: { version: 1, time_ms: { 'melvorAoD:Archaeology': 0 } } },
			guild.first.session_token);
		expect(start.json.success).toBe(true);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, start.json.tracking.session_id]);
		const stop = await post_json<{ settlement: { guild_ms: number } }>('/api/expedition/task/stop',
			{ ...request(expedition_id, visit_id, 'stop'), activities: [archaeology],
				statistics: { version: 1, time_ms: { 'melvorAoD:Archaeology': 3_600_000 } } },
			guild.first.session_token);
		expect(stop.json.settlement.guild_ms).toBeGreaterThan(3_500_000);
	});

});

describe('Expedition Chamber progression', () => {
	test('preview keeps other poll exits visible but never offers their work, including old snapshots', async () => {
		const { guild, expedition_id, visit_id } = await entrance();
		const state = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(state.expedition.chamber.exits).toHaveLength(3);
		expect(state.expedition.chamber.tasks.map((task: any) => task.task_id)).toContain('reveal_1');
		expect(state.expedition.chamber.tasks.map((task: any) => task.task_id)).not.toContain('reveal_2');
		expect(state.expedition.chamber.tasks.map((task: any) => task.task_id)).not.toContain('prepare_2');
		const old_preview = { ...EXPEDITION_CONTENT_V1, version: 2,
			preview_route: EXPEDITION_CONTENT_PREVIEW.preview_route };
		await db_run('UPDATE expeditions SET content_snapshot = ? WHERE id = ?',
			[JSON.stringify(old_preview), expedition_id]);
		for (const task_id of ['reveal_2', 'prepare_2'])
			await db_run('INSERT INTO expedition_tasks (visit_id, task_id, target_ms, unlocked_at) VALUES (?, ?, ?, ?)',
				[visit_id, task_id, 3_600_000, Date.now()]);
		const old_state = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(old_state.expedition.chamber.tasks.map((task: any) => task.task_id)).not.toContain('reveal_2');
		expect(old_state.expedition.chamber.tasks.map((task: any) => task.task_id)).not.toContain('prepare_2');
		for (const [task_id, activities] of [
			['reveal_2', [{ type: 'skill', skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore' }]],
			['prepare_2', [woodcutting]]
		] as const) {
			const start = await post_json<{ success: boolean; error: string }>(
				'/api/expedition/task/start', { ...request(expedition_id, visit_id, 'start', task_id), activities },
				guild.first.session_token);
			expect(start.json).toEqual({ success: false, error: 'task_unavailable' });
		}
		await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[Date.now(), visit_id, 'arrival_chart']);
		await get_json_with_session('/api/expedition/state', guild.first.session_token);
		const vote = await post_json<{ success: boolean; error: string }>('/api/expedition/vote',
			{ operation_id: crypto.randomUUID(), expedition_id, visit_id, exit_id: 'entrance:exit_2' },
			guild.first.session_token);
		expect(vote.json.error).toBe('preview_exit_restricted');
	});

	test('assistance stays below 100 percent and never advances optional or preparation work', async () => {
		const { guild, visit_id } = await entrance();
		const old = Date.now() - 200 * 3_600_000;
		await db_run('UPDATE expedition_tasks SET unlocked_at = ? WHERE visit_id = ? AND task_id IN (?, ?)',
			[old, visit_id, 'arrival_chart', 'exploration']);
		const state = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		const chart = state.expedition.chamber.tasks.find((row: any) => row.task_id === 'arrival_chart');
		const optional = state.expedition.chamber.tasks.find((row: any) => row.task_id === 'exploration');
		expect(chart.system_ms).toBeLessThanOrEqual(Math.floor(chart.target_ms * 0.96));
		expect(chart.system_ms).toBeGreaterThan(0);
		expect(optional.system_ms).toBe(0);
	});

	test('opens a hidden-slot vote after arrival and locks a durable winner', async () => {
		const { guild, expedition_id, visit_id } = await entrance();
		await restore_v1_content(expedition_id, visit_id);
		await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[Date.now(), visit_id, 'arrival_chart']);
		const opened = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(opened.expedition.chamber.vote.opened_at).toBeNumber();
		expect(opened.expedition.chamber.exits.every((edge: any) => edge.label === '???')).toBe(true);
		const exit_id = opened.expedition.chamber.exits[2].id;
		const vote = { operation_id: crypto.randomUUID(), expedition_id, visit_id, exit_id };
		const first = await post_json<any>('/api/expedition/vote', vote, guild.first.session_token);
		expect(first.json.success).toBe(true);
		expect((await post_json<any>('/api/expedition/vote', vote, guild.first.session_token)).json).toEqual(first.json);
		await db_run('UPDATE expedition_visits SET vote_deadline_at = ? WHERE id = ?', [Date.now() - 1, visit_id]);
		const locked = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(locked.expedition.chamber.vote.chosen_exit_id).toBe(exit_id);
		expect(locked.expedition.chamber.vote.locked_at).toBeNumber();
		expect(locked.expedition.chamber.exits[2].label).toBe('???');
		const reveal = locked.expedition.chamber.tasks.find((row: any) => row.task_id === 'reveal_3');
		expect(reveal.promoted_at).toBeNumber();
		expect(locked.expedition.chamber.tasks.find((row: any) => row.task_id === 'exploration').promoted_at).toBeNumber();
		await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? ' +
			'WHERE visit_id = ? AND task_id IN (?, ?, ?, ?)',
			[Date.now(), visit_id, 'groundwork', 'exploration', 'reveal_3', 'prepare_3']);
		await db_run('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ? AND exit_id = ?',
			[Date.now(), visit_id, exit_id]);
		const moved = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(moved.expedition.chamber.id).toBe('rootforge_passage');
		expect(moved.expedition.history[0].chosen_exit_label).toBe('Rootforge Passage');
	});

	test('counts only PPC workers for vote deadline shortening and never lengthens it', async () => {
		const { guild, expedition_id, visit_id } = await entrance();
		await restore_v1_content(expedition_id, visit_id);
		await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
		await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[Date.now(), visit_id, 'arrival_chart']);
		await get_json_with_session('/api/expedition/state', guild.first.session_token);
		await db_run('INSERT INTO expedition_interactions (visit_id, client_id, interacted_at) VALUES (?, ?, ?)',
			[visit_id, guild.first_id, Date.now()]);
		const outsider = await post_json<any>('/api/expedition/vote', {
			operation_id: crypto.randomUUID(), expedition_id, visit_id, exit_id: 'entrance:exit_1'
		}, guild.second.session_token);
		expect(outsider.json.success).toBe(true);
		expect(outsider.json.vote_deadline_at).toBeGreaterThan(Date.now() + 19 * 3_600_000);
		const worker = await post_json<any>('/api/expedition/vote', {
			operation_id: crypto.randomUUID(), expedition_id, visit_id, exit_id: 'entrance:exit_2'
		}, guild.first.session_token);
		expect(worker.json.vote_deadline_at).toBeLessThanOrEqual(Date.now() + 3_600_000);
		const changed = await post_json<any>('/api/expedition/vote', {
			operation_id: crypto.randomUUID(), expedition_id, visit_id, exit_id: 'entrance:exit_3'
		}, guild.first.session_token);
		expect(changed.json.vote_deadline_at).toBe(worker.json.vote_deadline_at);
		expect((await db_all<{ exit_id: string }>('SELECT exit_id FROM expedition_votes WHERE visit_id = ? AND client_id = ?',
			[visit_id, guild.first_id]))[0].exit_id).toBe('entrance:exit_3');
	});
});

describe('Expedition status observations', () => {
	test('credits only the statistic delta when a long offline session returns idle', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const four_hours_ago = Date.now() - 4 * 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[four_hours_ago, four_hours_ago, started.json.tracking.session_id]);
		const changed = await post_json<any>('/api/client/status/sync', {
			activities: [], work_statistics: stats(5 * 60_000)
		}, guild.first.session_token);
		expect(changed.json.expedition_work_stopped).toMatchObject({
			success: true, credited_ms: 5 * 60_000, guild_ms: 5 * 60_000,
			target_ms: 5 * 60_000, reason: 'settled'
		});
		expect(changed.json.expedition_work_stopped.elapsed_ms).toBeGreaterThan(4 * 3_600_000);
	});

	test('accepts a report captured at the exact four-day observation boundary', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const captured_at = Date.now() - 5_000;
		const last_observed_at = captured_at - 4 * 24 * 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[last_observed_at - 3_600_000, last_observed_at, started.json.tracking.session_id]);
		const report = request(expedition_id, visit_id, 'stop', undefined, 4 * 24 * 3_600_000 + 3_600_000);
		report.captured_at = captured_at;
		const settled = await post_json<any>('/api/expedition/task/stop', report, guild.first.session_token);
		expect(settled.json.settlement.reason).toBe('settled');
		expect(settled.json.settlement.credited_ms).toBeGreaterThan(0);
	});

	test('stops changed activity once with verified work and leaves no active registration', async () => {
		const { guild, expedition_id, visit_id, task, unrelated } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[Date.now() - 3_600_000, Date.now() - 3_600_000, started.json.tracking.session_id]);
		const changed = await post_json<any>('/api/client/status/sync', {
			activities: [unrelated],
			work_statistics: stats(3_600_000)
		}, guild.first.session_token);
		expect(changed.json.expedition_work_stopped.success).toBe(true);
		expect(changed.json.expedition_work_stopped.credited_ms).toBeGreaterThan(3_500_000);
		const state = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(state.tracking).toBeNull();
		expect((await db_all('SELECT id FROM expedition_ep_ledger WHERE source_kind = ? AND source_id = ?',
			['work', started.json.tracking.session_id])).length).toBe(1);
	});

	test('rejects the entire offline gap beyond four days even with matching cumulative statistics', async () => {
		const { guild, expedition_id, visit_id, task } = await entrance();
		const started = await post_json<{ tracking: { session_id: number } }>(
			'/api/expedition/task/start', request(expedition_id, visit_id, 'start', task), guild.first.session_token);
		const five_days_ago = Date.now() - 5 * 24 * 3_600_000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?',
			[five_days_ago, five_days_ago, started.json.tracking.session_id]);
		const checked = await post_json<any>('/api/expedition/task/stop',
			request(expedition_id, visit_id, 'stop', undefined, 5 * 24 * 3_600_000), guild.first.session_token);
		expect(checked.json.settlement.reason).toBe('offline_limit');
		expect(checked.json.settlement.credited_ms).toBe(0);
		expect((await db_all('SELECT player_ms FROM expedition_tasks WHERE visit_id = ? AND task_id = ?',
			[visit_id, task]))[0].player_ms).toBe(0);
	});
});
