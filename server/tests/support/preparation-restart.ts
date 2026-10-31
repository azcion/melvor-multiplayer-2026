import { expect } from 'bun:test';
import { make_guildmates } from './fixtures';
import { get_json_with_session, post_json } from './http';
import { db_all } from './persistence';

export type PreparationRestartState = {
	session_token: string; expedition_id: number; visit_id: number; deadline: number;
	report: Record<string, unknown>; response: unknown; tasks: Record<string, unknown>[];
};
export async function setup_preparation_restart(): Promise<PreparationRestartState> {
	const guild = await make_guildmates('Preparation Owner', 'Preparation Legacy', 'Preparation Restart', { first: '1.7.0', second: '1.6.17' });
	const created = await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
	const expedition_id = created.json.expedition_id;
	await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
	const view = (await get_json_with_session<any>('/api/expedition/state', guild.second.session_token)).json.expedition;
	const chamber = view.chamber;
	const report = { operation_id: crypto.randomUUID(), expedition_id, visit_id: chamber.visit_id, task_id: chamber.tasks[0].task_id,
		captured_at: Date.now(), activities: [{ type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' }],
		statistics: { version: 1, time_ms: { 'melvorD:Woodcutting': 0 } } };
	const started = await post_json<any>('/api/expedition/task/start', report, guild.second.session_token);
	expect(started.json).toHaveProperty('tracking.task_id', report.task_id);
	expect(started.json.tracking.task_id).toBe(report.task_id);
	return { session_token: guild.second.session_token, expedition_id, visit_id: chamber.visit_id,
		deadline: view.registration_ends_at, report, response: started.json,
		tasks: await db_all('SELECT * FROM expedition_preparation_tasks WHERE visit_id=? ORDER BY task_id', [chamber.visit_id]) };
}
export async function verify_preparation_restart(saved: PreparationRestartState): Promise<void> {
	const view = (await get_json_with_session<any>('/api/expedition/state', saved.session_token)).json;
	expect(view.expedition.registration_ends_at).toBe(saved.deadline);
	expect(view.expedition.chamber.preparation).toBe(true);
	expect(view.expedition.chamber.visit_id).toBe(saved.visit_id);
	expect(view.tracking.task_id).toBe(saved.report.task_id);
	expect(await db_all('SELECT * FROM expedition_preparation_tasks WHERE visit_id=? ORDER BY task_id', [saved.visit_id])).toEqual(saved.tasks);
	expect((await post_json('/api/expedition/task/start', saved.report, saved.session_token)).json).toEqual(saved.response);
}
