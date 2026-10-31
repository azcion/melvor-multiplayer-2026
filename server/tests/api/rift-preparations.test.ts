import { describe, expect, test } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import type { RegisteredClient } from '../support/http';
import { db_all, db_run } from '../support/persistence';
import { PREPARATION_SKILLS } from '../../expedition-preparations';

const HOUR_MS = 3_600_000;
const woodcutting = { type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' };

type Chamber = { id: string; visit_id: number; preparation?: boolean; tasks: {
	task_id: string; title: string; target_ms: number; player_ms: number; completed_at: number | null;
	requirement: string; evidence: { skill_ids: string[] };
}[] };
type State = { expedition: { id: number; status: string; chamber: Chamber | null;
	history: { chamber_id: string }[] } };

async function state(client: RegisteredClient) {
	return (await get_json_with_session<State>('/api/expedition/state', client.session_token)).json.expedition;
}

async function register(client: RegisteredClient) {
	return (await post_json<{ expedition_id: number }>('/api/expedition/register',
		{ operation_id: crypto.randomUUID() }, client.session_token)).json.expedition_id;
}

// Works the preparation task as Woodcutting for the given verified duration.
async function work(client: RegisteredClient, expedition_id: number, chamber: Chamber, duration_ms: number) {
	const task = chamber.tasks[0]!;

	const report = (kind: string, value: number, captured_at = Date.now()) => post_json<any>(`/api/expedition/task/${kind}`, {
		operation_id: crypto.randomUUID(), expedition_id, visit_id: chamber.visit_id, task_id: task.task_id,
		statistics: { version: 1, time_ms: { 'melvorD:Woodcutting': value } }, activities: [woodcutting], captured_at
	}, client.session_token);
	const start = await report('start', 1000);
	expect(start.json.tracking?.task_id).toBe(task.task_id);
	const started_at = Date.now() - duration_ms;
	await db_run('UPDATE expedition_work_sessions SET started_at = ?, last_observed_at = ?, start_clock_offset_ms = 0 WHERE id = ?',
		[started_at, started_at, start.json.tracking.session_id]);
	return (await report('stop', 1000 + duration_ms)).json;
}

describe('Rift Preparations', () => {
	test('gives each registrant one optional 20 hour task over the fixed eight activities', async () => {
		const guild = await make_guildmates('Prep One', 'Prep Two', 'Prep Guild');
		await register(guild.first);
		const expedition = await state(guild.first);
		expect(expedition.status).toBe('registration');
		expect(expedition.chamber?.preparation).toBe(true);
		const tasks = expedition.chamber!.tasks;
		expect(tasks.map(task => [task.title, task.target_ms])).toEqual([['Gather Rift Provisions', 20 * HOUR_MS]]);
		const skills = tasks[0]!.evidence.skill_ids;
		expect(skills).toEqual([...PREPARATION_SKILLS]);
		expect(tasks.every(task => task.requirement === 'optional' && task.player_ms === 0)).toBe(true);
		// Unregistered guildmates see no personal tasks and never anyone else's.
		expect((await state(guild.second)).chamber).toBeNull();
		await register(guild.second);
		const second = (await state(guild.second)).chamber!;
		expect(second.visit_id).toBe(expedition.chamber!.visit_id);
		expect(second.tasks.map(task => task.task_id)).not.toContain(tasks[0]!.task_id);
	});

	test('credits one EP per verified hour and caps the task at its target', async () => {
		const guild = await make_guildmates('Prep Worker', 'Prep Witness', 'Prep Work Guild');
		const expedition_id = await register(guild.first);
		const chamber = (await state(guild.first)).chamber!;
		await db_run('UPDATE expedition_ep_balances SET points_micros = 0 WHERE client_id = ?', [guild.first_id]);
		const result = await work(guild.first, expedition_id, chamber, 2 * HOUR_MS);
		expect(result.settlement.credited_ms).toBeGreaterThanOrEqual(2 * HOUR_MS - 1000);
		expect(result.settlement.points_micros).toBe(Math.floor(result.settlement.credited_ms * 1_000_000 / HOUR_MS));
		const after = (await state(guild.first)).chamber!;
		expect(after.tasks[0]!.player_ms).toBe(result.settlement.credited_ms);
		expect(await db_all("SELECT points_micros FROM expedition_ep_ledger WHERE client_id = ? AND source_kind = 'work'",
			[guild.first_id])).toEqual([{ points_micros: result.settlement.points_micros }]);
		// Another start may only earn what remains of the 20 hour task.
		const rest = await work(guild.first, expedition_id, after, 19 * HOUR_MS);
		expect(rest.settlement.credited_ms).toBe(20 * HOUR_MS - result.settlement.credited_ms);
		expect((await state(guild.first)).chamber!.tasks[0]!.completed_at).toBeNumber();
	});

	test('rejects another player\'s task and work after registration closes', async () => {
		const guild = await make_guildmates('Prep Owner', 'Prep Intruder', 'Prep Owner Guild');
		const expedition_id = await register(guild.first);
		await register(guild.second);
		const chamber = (await state(guild.first)).chamber!;
		const intruder = await post_json<any>('/api/expedition/task/start', {
			operation_id: crypto.randomUUID(), expedition_id, visit_id: chamber.visit_id,
			task_id: chamber.tasks[0]!.task_id, statistics: { version: 1, time_ms: {
				[chamber.tasks[0]!.evidence.skill_ids[0]!]: 0 } },
			activities: [], captured_at: Date.now()
		}, guild.second.session_token);
		expect(intruder.json.success).toBe(false);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * HOUR_MS - 1, Date.now() - 1, expedition_id]);
		const departed = await state(guild.first);
		expect(departed.status).toBe('active');
		expect(departed.chamber?.id).toBe('entrance');
		expect(departed.history.map(visit => visit.chamber_id)).not.toContain('rift_preparations');
		expect(await db_all('SELECT departed_at IS NOT NULL AS closed FROM expedition_visits WHERE id = ?',
			[chamber.visit_id])).toEqual([{ closed: 1 }]);
	});

	test('hides preparations once registration ends even while the Expedition waits for activity', async () => {
		const guild = await make_guildmates('Prep Late', 'Prep Late Two', 'Prep Late Guild');
		const expedition_id = await register(guild.first);
		await db_run('UPDATE expeditions SET registered_at = 0, registration_ends_at = ?, last_qualifying_activity_at = ? WHERE id = ?',
			[Date.now() - 1, Date.now(), expedition_id]);
		await db_run('UPDATE clients SET last_multiplayer_active_at = 0 WHERE id IN (?, ?)', [guild.first_id, guild.second_id]);
		const late = await state(guild.first);
		expect(late.status).toBe('registration');
		expect(late.chamber).toBeNull();
	});


	test.each(['parallel accepted', 'parallel unaccepted', 'sequential accepted', 'solo', 'combat'])(
		'uses corrected verification for %s activity and replays concurrent reports', async mode => {
		const guild = await make_guildmates('Fixed Worker', 'Fixed Witness', 'Fixed Skills');
		const expedition_id = await register(guild.first);
		const chamber = (await state(guild.first)).chamber!;
		const second = mode === 'parallel unaccepted' ? 'melvorD:Agility' : 'melvorD:Fishing';
		const first = mode === 'combat' ? 'melvorD:Combat' : 'melvorD:Woodcutting';
		const activities = mode === 'combat' ? [{ type: 'combat' }] : [woodcutting];
		const statistics = { version: 1, time_ms: { [first]: 1000, [second]: 1000 } };
		const base = { expedition_id, visit_id: chamber.visit_id, task_id: chamber.tasks[0]!.task_id, activities };
		const start_payload = { ...base, operation_id: crypto.randomUUID(), statistics, captured_at: Date.now() };
		const starts = await Promise.all([0, 1].map(() => post_json<any>('/api/expedition/task/start', start_payload, guild.first.session_token)));
		expect(starts[0]!.json).toEqual(starts[1]!.json);
		const session_id = starts[0]!.json.tracking.session_id;
		const now = Date.now(), started = now - HOUR_MS;
		await db_run('UPDATE expedition_work_sessions SET started_at=?,last_observed_at=?,start_clock_offset_ms=0 WHERE id=?', [started, started, session_id]);
		const parallel = mode.startsWith('parallel');
		const sequential = mode === 'sequential accepted';
		const end = { version: 1, time_ms: { [first]: 1000 + (sequential ? HOUR_MS / 2 : HOUR_MS),
			[second]: 1000 + (parallel ? HOUR_MS : sequential ? HOUR_MS / 2 : 0) } };
		const payload = { ...base, operation_id: crypto.randomUUID(), statistics: end, captured_at: now };
		const replies = await Promise.all([0, 1].map(() => post_json<any>('/api/expedition/task/stop', payload, guild.first.session_token)));
		expect(replies[0]!.json).toEqual(replies[1]!.json);
		expect(replies[0]!.json.settlement.credited_ms).toBe(parallel ? HOUR_MS / 2 : HOUR_MS);
		expect(replies[0]!.json.settlement.points_micros).toBe(parallel ? 500000 : 1000000);
		expect(await db_all("SELECT points_micros FROM expedition_ep_ledger WHERE source_kind='work' AND source_id=?", [session_id]))
			.toEqual([{ points_micros: parallel ? 500000 : 1000000 }]);
	});

	test.each([false, true])('retains the deadline for late offline work, dissolved=%s', async dissolved => {
		const player = await register_guild_client('Deadline Worker', 'Deadline Guild');
		const expedition_id = await register(player);
		const chamber = (await state(player)).chamber!;
		const base = { expedition_id, visit_id: chamber.visit_id, task_id: chamber.tasks[0]!.task_id,
			activities: [woodcutting] };
		const start = await post_json<any>('/api/expedition/task/start', { ...base, operation_id: crypto.randomUUID(),
			statistics: { version: 1, time_ms: { 'melvorD:Woodcutting': 0 } }, captured_at: Date.now() }, player.session_token);
		const now = Date.now(), started = now - HOUR_MS, deadline = started + HOUR_MS / 2;
		await db_run('UPDATE expedition_work_sessions SET started_at=?,last_observed_at=?,start_clock_offset_ms=0 WHERE id=?', [started, started, start.json.tracking.session_id]);
		await db_run('UPDATE expeditions SET registered_at=?,registration_ends_at=? WHERE id=?', [started - 19 * HOUR_MS, deadline, expedition_id]);
		if (dissolved) {
			await post_json('/api/guilds/leave', {}, player.session_token);
			const claim = await db_all<{ cutoff_at: number }>('SELECT cutoff_at FROM expedition_work_claims WHERE session_id=?', [start.json.tracking.session_id]);
			expect(claim).toEqual([{ cutoff_at: deadline }]);
		}
		const payload = { ...base, operation_id: crypto.randomUUID(), statistics: { version: 1,
			time_ms: { 'melvorD:Woodcutting': HOUR_MS } }, captured_at: now };
		const result = await post_json<any>('/api/expedition/task/stop', payload, player.session_token);
		expect(result.json.settlement.credited_ms).toBe(HOUR_MS / 2);
		expect(result.json.settlement.points_micros).toBe(500000);
		expect((await post_json<any>('/api/expedition/task/stop', payload, player.session_token)).json).toEqual(result.json);
	});

	test('late registrants share the original deadline and do not need to complete preparations to scale', async () => {
		const guild = await make_guildmates('Early Prep', 'Late Prep', 'Late Registration');
		const expedition_id = await register(guild.first);
		const deadline = Date.now() + HOUR_MS;
		await db_run('UPDATE expeditions SET registered_at=?,registration_ends_at=? WHERE id=?', [deadline - 20 * HOUR_MS, deadline, expedition_id]);
		await register(guild.second);
		expect(await db_all('SELECT registration_ends_at FROM expeditions WHERE id=?', [expedition_id])).toEqual([{ registration_ends_at: deadline }]);
		expect((await state(guild.second)).chamber!.tasks[0]!.player_ms).toBe(0);
		await db_run('UPDATE expeditions SET registration_ends_at=? WHERE id=?', [Date.now()-1, expedition_id]);
		const departed = await state(guild.first);
		expect(departed.status).toBe('active');
		expect((departed.chamber as any).participant_count).toBe(2);
	});

});

describe('Expedition supplies', () => {
	test('are no longer accepted and the catalog is empty', async () => {
		const guild = await make_guildmates('Supply Gone', 'Supply Gone Two', 'Supply Gone Guild');
		const expedition_id = await register(guild.first);
		const donated = await post_json<any>('/api/expedition/supply/donate', { command_id: crypto.randomUUID(),
			expedition_id, item_id: 'melvorD:Shrimp', qty: 1000, source: 'bank',
			value_currency_id: 'melvorD:GP', value_per_item: 2 }, guild.first.session_token);
		expect(donated.json).toEqual({ success: false, error: 'supplies_removed' });
		expect(await db_all('SELECT item_id FROM expedition_supplies WHERE expedition_id = ?', [expedition_id])).toEqual([]);
		expect((await get_json_with_session<any>('/api/expedition/supply/catalog', guild.first.session_token)).json)
			.toEqual({ version: 0, items: {} });
	});
});
