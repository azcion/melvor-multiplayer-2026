import { expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';

const state = async (token: string) => (await get_json_with_session<any>('/api/expedition/state', token)).json;
async function finish(visit_id: number) {
	await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ?', [Date.now(), visit_id]);
	await db_run('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ?', [Date.now(), visit_id]);
}

for (const route of [
	['entrance', 'drowned_cloister', 'tideworn_crypts'],
	['entrance', 'drowned_cloister', 'mossbound_reliquary'],
	['entrance', 'prismatic_descent', 'tideworn_crypts'],
	['entrance', 'prismatic_descent', 'embervein_machinery'],
	['entrance', 'rootforge_passage', 'glassroot_terraces', 'buried_observatory', 'prismatic_orrery', 'voidwatch_threshold', 'hollow_star'],
	['entrance', 'prismatic_descent', 'glassroot_terraces', 'buried_observatory', 'prismatic_orrery', 'voidwatch_threshold', 'hollow_star']
]) test(`supported participants complete ${route.join(' → ')}`, async () => {
	const guild = await make_guildmates('Expansion New', 'Expansion Legacy', 'Expansion Guild', { first: '1.7.9', second: '1.7.9' });
	const created = await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 3 }, guild.first.session_token);
	expect(created.response.status).toBe(200);
	const expedition_id = created.json.expedition_id;
	expect((await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token)).json.content_version).toBe(3);
	const snapshot = await db_all('SELECT content_snapshot FROM expeditions WHERE id = ?', [expedition_id]);
	await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?', [Date.now() - 20 * 3_600_000, Date.now() - 1, expedition_id]);
	for (const [index, id] of route.entries()) {
		const view = await state(guild.second.session_token);
		expect(view.content_version).toBe(3);
		const c = view.expedition.chamber;
		expect(c.id).toBe(id);
		expect(c.preview_exit_id).toBeNull();
		expect(c.exits.every((edge: any) => edge.label === '???')).toBe(true);
		if (index === route.length - 1) {
			expect(c.exits).toEqual([]);
			await finish(c.visit_id);
			break;
		}
		// Extra required Arrival work must gate the poll and Exploration together.
		await db_run("UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = 'arrival_chart'", [Date.now(), c.visit_id]);
		if (c.tasks.some((t: any) => t.phase === 'arrival' && t.requirement === 'required' && t.task_id !== 'arrival_chart')) {
			const gated = (await state(guild.first.session_token)).expedition.chamber;
			expect(gated.vote.opened_at).toBeNull();
			expect(gated.tasks.find((t: any) => t.task_id === 'groundwork').unlocked_at).toBeNull();
		}
		// State reconciling is read-only with respect to task unlocks; settlement/debug owns unlocks.
		await db_run("UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = 'arrival_support'", [Date.now(), c.visit_id]);
		const opened = (await state(guild.second.session_token)).expedition.chamber;
		const catalog = JSON.parse(String(snapshot[0].content_snapshot));
		const edge = catalog.chambers.find((entry: any) => entry.id === id).exits.find((entry: any) => entry.target === route[index + 1]);
		expect(edge).toBeDefined();
		if (opened.exits.length > 1) {
			const vote = await post_json<any>('/api/expedition/vote', { operation_id: crypto.randomUUID(), expedition_id, visit_id: c.visit_id, exit_id: edge.id }, guild.second.session_token);
			expect(vote.json.success).toBe(true);
			await db_run('UPDATE expedition_visits SET vote_deadline_at = ? WHERE id = ?', [Date.now() - 1, c.visit_id]);
		} else expect(opened.vote.chosen_exit_id).toBe(edge.id);
		await finish(c.visit_id);
	}
	const completed = await state(guild.first.session_token);
	expect(completed.expedition.status).toBe('completed');
	expect(completed.expedition.return_summary).toMatchObject({ ending_bonus_eligible: 1, contributed_ms: 0, chamber_count: 0 });
	await db_run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(?,'work',?,123456789,?,?)",
		[guild.first.client_id, 90000000 + expedition_id, Date.now(), expedition_id]);
	const claims = await Promise.all([1,2].map(() => post_json<any>('/api/expedition/ending/claim', { expedition_id }, guild.first.session_token)));
	expect(claims.map(reply => reply.json.claimed_points_micros).sort((a,b) => a-b)).toEqual([0,24691357]);
	expect((await state(guild.first.session_token)).expedition.return_summary).toMatchObject({ bonus_claimed_micros:24691357, bonus_available_micros:0 });
	expect((await post('/api/expedition/ending/claim', { expedition_id: -1 }, guild.first.session_token)).status).toBe(400);

	expect(completed.expedition.stash_outcome).toBe('empty');
	expect(completed.expedition.history.map((v: any) => v.chamber_id)).toEqual(route);
	expect(await db_all('SELECT content_snapshot FROM expeditions WHERE id = ?', [expedition_id])).toEqual(snapshot);
	if (route.join(',') === 'entrance,drowned_cloister,tideworn_crypts') {
		// The fixture revealed all Rift exits, but visited only the Drowned Cloister.
		const replay = await post_json<any>('/api/expedition/register',
			{ operation_id: crypto.randomUUID(), content_version: 3 }, guild.first.session_token);
		await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000, Date.now() - 1, replay.json.expedition_id]);
		const next = (await state(guild.second.session_token)).expedition;
		expect(next.history.map((visit: any) => visit.chamber_id)).toEqual(route);
		expect(next.journey.revealed).toContain('entrance:exit_1');
		expect(next.chamber.participant_count).toBe(2);
		expect(next.chamber.exits).toContainEqual(expect.objectContaining({
			id: 'entrance:exit_1', label: 'Prismatic Descent'
		}));
		const repeat = next.chamber.tasks.find((task: any) => task.discovery_target === 'entrance:exit_1');
		const original = JSON.parse(String(snapshot[0].content_snapshot)).chambers[0].tasks
			.find((task: any) => task.discovery_target === 'entrance:exit_1');
		expect(repeat).toMatchObject({ target_ms: 3_600_000, evidence: original.evidence, completed_at: null });
	}

});

test('new client joins a legacy run without changing tasks, visits, history or an open work segment', async () => {
	const guild = await make_guildmates('Legacy Creator', 'New Joiner', 'Continuity Guild', { first: '1.7.9', second: '1.7.9' });
	const created = await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
	const id = created.json.expedition_id;
	await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?', [Date.now() - 20 * 3_600_000, Date.now() - 1, id]);
	const before = await state(guild.first.session_token);
	const visit = before.expedition.chamber.visit_id;
	const report = { operation_id: crypto.randomUUID(), expedition_id: id, visit_id: visit, task_id: 'arrival_support', captured_at: Date.now(), statistics: { version: 1, time_ms: { 'melvorD:Woodcutting': 0 } }, activities: [{ type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' }] };
	const started = await post_json<any>('/api/expedition/task/start', report, guild.first.session_token);
	expect(started.json.tracking).not.toBeNull();
	const persisted = await db_all('SELECT content_snapshot, content_version, current_visit_id FROM expeditions WHERE id = ?', [id]);
	const tasks = await db_all('SELECT * FROM expedition_tasks WHERE visit_id = ?', [visit]);
	const joined = await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 3 }, guild.second.session_token);
	expect(joined.json.content_version).toBe(2);
	expect(await db_all('SELECT content_snapshot, content_version, current_visit_id FROM expeditions WHERE id = ?', [id])).toEqual(persisted);
	expect(await db_all('SELECT * FROM expedition_tasks WHERE visit_id = ?', [visit])).toEqual(tasks);
	const stop = { ...report, operation_id: crypto.randomUUID(), captured_at: Date.now() };
	const settled = await post_json<any>('/api/expedition/task/stop', stop, guild.first.session_token);
	expect(settled.json.success).toBe(true);
	expect((await post_json<any>('/api/expedition/task/stop', stop, guild.first.session_token)).json).toEqual(settled.json);
	expect((await state(guild.second.session_token)).expedition.chamber.preview_exit_id).toBe('entrance:exit_1');
	expect((await post('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 999 }, guild.second.session_token)).status).toBe(400);
});

test('legacy work reports unlock expanded phases only after all required arrival work and replay safely', async () => {
	const guild = await make_guildmates('New Content Owner', 'Legacy Worker', 'Phase Gate Guild', { first: '1.7.9', second: '1.7.9' });
	const created = await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 3 }, guild.first.session_token);
	await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
	const expedition_id = created.json.expedition_id;
	await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?', [Date.now() - 20 * 3_600_000, Date.now() - 1, expedition_id]);
	const entrance = (await state(guild.second.session_token)).expedition.chamber;
	await db_run("UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = 'arrival_chart'", [Date.now(), entrance.visit_id]);
	await state(guild.first.session_token);
	await post_json('/api/expedition/vote', { operation_id: crypto.randomUUID(), expedition_id, visit_id: entrance.visit_id, exit_id: 'entrance:exit_2' }, guild.second.session_token);
	await db_run('UPDATE expedition_visits SET vote_deadline_at = ? WHERE id = ?', [Date.now() - 1, entrance.visit_id]);
	await finish(entrance.visit_id);
	const branch = (await state(guild.second.session_token)).expedition.chamber;
	expect(branch.id).toBe('drowned_cloister');
	const visit_id = branch.visit_id;
	let counter = 0;
	async function work(task_id: string, skill_id: string) {
		const request = (amount: number) => ({ operation_id: crypto.randomUUID(), expedition_id, visit_id, task_id,
			captured_at: Date.now(), statistics: { version: 1, time_ms: { [skill_id]: amount } },
			activities: [{ type: 'skill', skill_id, action_id: 'melvorD:Test' }] });
		await db_run('UPDATE expedition_tasks SET target_ms = 1000 WHERE visit_id = ? AND task_id = ?', [visit_id, task_id]);
		const start = await post_json<any>('/api/expedition/task/start', request(counter), guild.second.session_token);
		expect(start.json.success).toBe(true);
		const ago = Date.now() - 3000;
		await db_run('UPDATE expedition_work_sessions SET start_clock_offset_ms = NULL, started_at = ?, last_observed_at = ? WHERE id = ?', [ago, ago, start.json.tracking.session_id]);
		counter += 2000;
		const stop = request(counter);
		const settled = await post_json<any>('/api/expedition/task/stop', stop, guild.second.session_token);
		expect(settled.json.settlement.guild_ms).toBe(1000);
		expect((await post_json<any>('/api/expedition/task/stop', stop, guild.second.session_token)).json).toEqual(settled.json);
	}
	await work('arrival_chart', 'melvorD:Summoning');
	let chamber = (await state(guild.first.session_token)).expedition.chamber;
	expect(chamber.tasks.find((t: any) => t.task_id === 'groundwork').unlocked_at).toBeNull();
	expect(chamber.vote.opened_at).toBeNull();
	await work('arrival_support', 'melvorD:Crafting');
	chamber = (await state(guild.first.session_token)).expedition.chamber;
	expect(chamber.tasks.find((t: any) => t.task_id === 'groundwork').unlocked_at).not.toBeNull();
	expect(chamber.vote.opened_at).not.toBeNull();
	await work('groundwork', 'melvorD:Crafting');
	await work('reveal_1', 'melvorD:Fishing');
	chamber = (await state(guild.second.session_token)).expedition.chamber;
	expect(chamber.exits.find((e: any) => e.id === 'drowned_cloister:exit_1').label).toBe('Tideworn Crypts');
	expect(chamber.tasks.find((t: any) => t.task_id === 'prepare_1').unlocked_at).not.toBeNull();
});


test('Rift retains the previous Guild return only for participants, including claimed rewards', async () => {
	const guild = await make_guildmates('Rift Returner', 'Rift Newcomer', 'Rift Recap', { first: '1.7.9', second: '1.7.9' });
	const old = (await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 3 }, guild.first.session_token)).json.expedition_id;
	await db_run("UPDATE expeditions SET status='completed', ended_at=? WHERE id=?", [Date.now(), old]);
	await db_run("UPDATE expedition_personal_records SET status='completed', ended_at=?, ending_bonus_eligible=1 WHERE expedition_id=?", [Date.now(), old]);
	await db_run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(?,'work',?,10000000,?,?)", [guild.first.client_id, 90000000 + old, Date.now(), old]);
	const next = (await post_json<any>('/api/expedition/register', { operation_id: crypto.randomUUID(), content_version: 3 }, guild.second.session_token)).json.expedition_id;
	expect((await state(guild.second.session_token)).expedition.previous_return).toBeNull();
	const recap = (await state(guild.first.session_token)).expedition.previous_return;
	expect(recap).toMatchObject({ expedition_id: old, earned_points_micros: 10000000, bonus_available_micros: 2000000 });
	await post_json('/api/expedition/ending/claim', { expedition_id: old }, guild.first.session_token);
	expect((await state(guild.first.session_token)).expedition.previous_return).toMatchObject({ bonus_available_micros: 0, bonus_claimed_micros: 2000000 });
	const compact = (await get_json_with_session<any>('/api/expedition/state?view=tracking', guild.first.session_token)).json;
	expect(compact.expedition.previous_return).toBeUndefined();
	await db_run('UPDATE expeditions SET registered_at=?, registration_ends_at=? WHERE id=?', [Date.now() - 20 * 3600000, Date.now() - 1, next]);
	const active = await state(guild.first.session_token);
	expect(active.expedition.chamber.id).toBe('entrance');
	expect(active.expedition.previous_return.expedition_id).toBe(old);
	await db_run("UPDATE expeditions SET status='inactive', ended_at=? WHERE id=?", [Date.now(), next]);
	expect((await state(guild.first.session_token)).expedition.previous_return).toBeNull();
	await db_run("UPDATE expeditions SET status='active', ended_at=NULL WHERE id=?", [next]);
	await db_run("UPDATE expedition_visits SET chamber_id='drowned_cloister' WHERE id=?", [active.expedition.chamber.visit_id]);
	expect((await state(guild.first.session_token)).expedition.previous_return).toBeNull();
});
