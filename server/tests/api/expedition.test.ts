import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

const woodcutting = { type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' };
const mining = { type: 'skill', skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore' };
const statistics = (time_ms: Record<string, number> = {}) => ({ version: 1, time_ms });

describe('development Expedition work tracking', () => {
	test('requires Guild membership, active Woodcutting, and a valid statistics snapshot', async () => {
		const guildless = await register_client('Guildless Worker');
		const guildless_start = await post_json('/api/expedition/work-tracking/start', {
			activities: [woodcutting], statistics: statistics()
		}, guildless.session_token);
		const guild = await make_guildmates('Worker', 'Guildmate', 'Work Guild');
		await db_run("UPDATE clients SET social_mode = 'social' WHERE id = ?", [guild.first_id]);
		const inactive = await post_json<{ success: boolean; error: string; activities: unknown[] }>(
			'/api/expedition/work-tracking/start', { activities: [mining], statistics: statistics() }, guild.first.session_token
		);

		expect(guildless_start.json).toEqual({ error_lang: 'MOD_MP_GUILD_REQUIRED' });
		expect(inactive.json).toEqual({ success: false, error: 'woodcutting_not_active', activities: [mining] });
		expect((await post('/api/expedition/work-tracking/start', {
			activities: [woodcutting], statistics: { version: 1, time_ms: { bad: 1 } }
		}, guild.first.session_token)).status).toBe(400);
		expect(await db_all('SELECT * FROM dev_work_tracking_sessions')).toEqual([]);
	});

	test('credits an offline ten-skill hour as one tenth using statistic deltas', async () => {
		const guild = await make_guildmates('Tracked Worker', 'Tracking Witness', 'Tracking Guild');
		const skill_ids = ['Woodcutting', 'Fishing', 'Firemaking', 'Cooking', 'Mining', 'Smithing', 'Fletching', 'Crafting', 'Runecrafting', 'Herblore'];
		const baseline = Object.fromEntries(skill_ids.map(skill => [`melvorD:${skill}`, skill === 'Woodcutting' ? 10_000 : 0]));
		const started = await post_json<{ success: boolean; session_id: number; started_at: number }>(
			'/api/expedition/work-tracking/start',
			{ activities: [woodcutting], statistics: statistics(baseline) },
			guild.first.session_token
		);
		expect(started.json.success).toBe(true);

		const hour_ago = Date.now() - 3_600_000;
		await db_run('UPDATE dev_work_tracking_sessions SET started_at = ? WHERE id = ?', [hour_ago, started.json.session_id]);
		await db_run('UPDATE dev_work_tracking_activity_events SET observed_at = ? WHERE session_id = ?', [hour_ago, started.json.session_id]);
		await db_run('UPDATE dev_work_tracking_stat_snapshots SET observed_at = ? WHERE session_id = ?', [hour_ago, started.json.session_id]);
		const time_ms: Record<string, number> = { 'melvorD:Woodcutting': 3_610_000 };
		for (const skill of skill_ids.filter(skill => skill !== 'Woodcutting'))
			time_ms[`melvorD:${skill}`] = 3_600_000;
		const activities = [woodcutting, mining];
		const checked = await post_json<{
			success: boolean; elapsed_ms: number; target_work_ms: number; total_work_ms: number;
			timeline_credit_ms: number; statistics_credit_ms: number; credited_ms: number; concurrency_factor: number;
		}>('/api/expedition/work-tracking/check-in', { activities, statistics: statistics(time_ms) }, guild.first.session_token);

		expect(checked.json.success).toBe(true);
		expect(checked.json.elapsed_ms).toBeGreaterThanOrEqual(3_600_000);
		expect(checked.json.target_work_ms).toBeGreaterThanOrEqual(3_600_000);
		expect(checked.json.total_work_ms).toBeGreaterThanOrEqual(36_000_000);
		expect(checked.json.concurrency_factor).toBeGreaterThanOrEqual(9.9);
		expect(checked.json.statistics_credit_ms).toBeGreaterThanOrEqual(350_000);
		expect(checked.json.statistics_credit_ms).toBeLessThanOrEqual(370_000);
		expect(checked.json.credited_ms).toBe(checked.json.statistics_credit_ms);
		expect((await get_json_with_session<{ active: boolean }>('/api/expedition/work-tracking', guild.first.session_token)).json.active).toBe(false);

		const sessions = await db_all<{ credited_ms: number; end_reason: string }>(
			'SELECT credited_ms, end_reason FROM dev_work_tracking_sessions WHERE id = ?', [started.json.session_id]
		);
		expect(sessions[0].end_reason).toBe('check_in');
		expect(sessions[0].credited_ms).toBe(checked.json.credited_ms);
		expect((await db_all('SELECT * FROM dev_work_tracking_activity_events WHERE session_id = ?', [started.json.session_id])).length).toBe(2);
		expect((await db_all('SELECT * FROM dev_work_tracking_stat_snapshots WHERE session_id = ?', [started.json.session_id])).length).toBe(2);
	});

	test('records activity changes and stops with a statistics-backed result', async () => {
		const guild = await make_guildmates('Stopped Worker', 'Stop Witness', 'Stop Guild');
		await post_json('/api/expedition/work-tracking/start', {
			activities: [woodcutting], statistics: statistics({ 'melvorD:Woodcutting': 1_000 })
		}, guild.first.session_token);
		const stopped = await post_json<{
			success: boolean; work_tracking_stopped: { credited_ms: number; activities: unknown[] };
		}>('/api/client/status/sync', {
			activities: [mining],
			work_statistics: statistics({ 'melvorD:Woodcutting': 2_000, 'melvorD:Mining': 2_000 })
		}, guild.first.session_token);
		expect(stopped.json.work_tracking_stopped.activities).toEqual([mining]);
		expect(stopped.json.work_tracking_stopped.credited_ms).toBeGreaterThanOrEqual(0);
	});
});
