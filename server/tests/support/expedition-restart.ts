import { expect } from 'bun:test';
import { make_guildmates } from './fixtures';
import { get_json_with_session, post_json } from './http';
import { db_all, db_run } from './persistence';

export type ExpandedRestartState = {
	session_token: string; expedition_id: number; report: Record<string, unknown>; response: unknown;
	snapshot: Record<string, unknown>[]; visits: Record<string, unknown>[]; tasks: Record<string, unknown>[];
};
export async function setup_expanded_restart(): Promise<ExpandedRestartState> {
	const guild = await make_guildmates('Expansion Owner', 'Expansion Worker', 'Expansion Restart', { first: '1.7.9', second: '1.7.9' });
	const created = await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 3 }, guild.first.session_token);
	const expedition_id = created.json.expedition_id;
	await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
	await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?', [Date.now()-72_000_000, Date.now()-1, expedition_id]);
	const view = async () => (await get_json_with_session<any>('/api/expedition/state', guild.second.session_token)).json;
	const entrance = (await view()).expedition.chamber;
	await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ?', [Date.now(), entrance.visit_id]);
	await db_run('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ?', [Date.now(), entrance.visit_id]);
	await view();
	await post_json('/api/expedition/vote', { operation_id: crypto.randomUUID(), expedition_id, visit_id: entrance.visit_id, exit_id: 'entrance:exit_2' }, guild.second.session_token);
	await db_run('UPDATE expedition_visits SET vote_deadline_at = ? WHERE id = ?', [Date.now()-1, entrance.visit_id]);
	const chamber = (await view()).expedition.chamber;
	expect(chamber.id).toBe('drowned_cloister');
	const report = { operation_id: crypto.randomUUID(), expedition_id, visit_id: chamber.visit_id, task_id: 'arrival_support', captured_at: Date.now(),
		activities: [{ type: 'skill', skill_id: 'melvorD:Crafting', action_id: 'melvorD:Leather_Gloves' }],
		statistics: { version: 1, time_ms: { 'melvorD:Crafting': 0 } } };
	const started = await post_json<any>('/api/expedition/task/start', report, guild.second.session_token);
	expect(started.json.success).toBe(true);
	return { session_token: guild.second.session_token, expedition_id, report, response: started.json,
		snapshot: await db_all('SELECT content_version, content_snapshot, current_visit_id FROM expeditions WHERE id = ?', [expedition_id]),
		visits: await db_all('SELECT * FROM expedition_visits WHERE expedition_id = ? ORDER BY id', [expedition_id]),
		tasks: await db_all('SELECT * FROM expedition_tasks WHERE visit_id = ? ORDER BY task_id', [chamber.visit_id]) };
}
export async function verify_expanded_restart(saved: ExpandedRestartState): Promise<void> {
	expect(await db_all('SELECT content_version, content_snapshot, current_visit_id FROM expeditions WHERE id = ?', [saved.expedition_id])).toEqual(saved.snapshot);
	expect(await db_all('SELECT * FROM expedition_visits WHERE expedition_id = ? ORDER BY id', [saved.expedition_id])).toEqual(saved.visits);
	const view = (await get_json_with_session<any>('/api/expedition/state', saved.session_token)).json;
	expect(view.content_version).toBe(3);
	expect(view.expedition.chamber.id).toBe('drowned_cloister');
	expect(view.expedition.history.map((v: any) => v.chamber_id)).toEqual(['entrance']);
	expect(await db_all('SELECT * FROM expedition_tasks WHERE visit_id = ? ORDER BY task_id', [view.expedition.chamber.visit_id])).toEqual(saved.tasks);
	expect((await post_json('/api/expedition/task/start', saved.report, saved.session_token)).json).toEqual(saved.response);
	expect((await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID() }, saved.session_token)).json.content_version).toBe(3);
}

export type PreparationRestartState = {
	session_token: string; expedition_id: number; visit_id: number; deadline: number;
	report: Record<string, unknown>; response: unknown; tasks: Record<string, unknown>[];
};
export async function setup_preparation_restart(): Promise<PreparationRestartState> {
	await db_run("INSERT INTO service_settings (key, value) VALUES ('expedition_preparations_enabled', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
	const guild = await make_guildmates('Preparation Owner', 'Preparation Legacy', 'Preparation Restart', { first: '1.7.9', second: '1.7.9' });
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
