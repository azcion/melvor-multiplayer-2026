import { describe, expect, test } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import type { RegisteredClient } from '../support/http';
import { db_all, db_run } from '../support/persistence';
import { EXPEDITION_CONTENT_V1, EXPEDITION_WORK_SKILLS } from '../../expedition-content';

const HOUR_MS = 3_600_000;
const woodcutting = { type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' };

type Chamber = { id: string; visit_id: number; preparation?: boolean; tasks: {
	task_id: string; slot: number; target_ms: number; player_ms: number; completed_at: number | null;
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

async function account(ids: number[]) {
	const key = crypto.randomUUID();
	await db_run('INSERT INTO melvor_accounts(cloud_username,playfab_id,created_at) VALUES(?,?,?)', [key, key, Date.now()]);
	const row = (await db_all<{ id: number }>('SELECT id FROM melvor_accounts WHERE playfab_id=?', [key]))[0]!;
	for (const id of ids) await db_run('UPDATE clients SET melvor_account_id=? WHERE id=?', [row.id, id]);
}

// Works the first preparation slot as Woodcutting for the given verified duration.
async function work(client: RegisteredClient, expedition_id: number, chamber: Chamber, duration_ms: number) {
	const task = chamber.tasks[0]!;
	await db_run('UPDATE expedition_preparation_tasks SET skill_id = ? WHERE visit_id = ? AND task_id = ?',
		['melvorD:Woodcutting', chamber.visit_id, task.task_id]);
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
	test('gives each registrant three distinct personal skills totalling 20 hours', async () => {
		const guild = await make_guildmates('Prep One', 'Prep Two', 'Prep Guild');
		await register(guild.first);
		const expedition = await state(guild.first);
		expect(expedition.status).toBe('registration');
		expect(expedition.chamber?.preparation).toBe(true);
		const tasks = expedition.chamber!.tasks;
		expect(tasks.map(task => task.target_ms)).toEqual([8 * HOUR_MS, 6 * HOUR_MS, 6 * HOUR_MS]);
		const skills = tasks.map(task => task.evidence.skill_ids[0]!);
		expect(new Set(skills).size).toBe(3);
		for (const skill of skills) expect(EXPEDITION_WORK_SKILLS.has(skill)).toBe(true);
		expect(tasks.every(task => task.requirement === 'optional' && task.player_ms === 0)).toBe(true);
		// Unregistered guildmates see no personal tasks and never anyone else's.
		expect((await state(guild.second)).chamber).toBeNull();
		await register(guild.second);
		const second = (await state(guild.second)).chamber!;
		expect(second.visit_id).toBe(expedition.chamber!.visit_id);
		expect(second.tasks.map(task => task.task_id)).not.toContain(tasks[0]!.task_id);
	});

	test('credits one EP per verified hour and caps the slot at its target', async () => {
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
		// Another start may only earn what remains of the 8 hour slot.
		const rest = await work(guild.first, expedition_id, after, 7 * HOUR_MS);
		expect(rest.settlement.credited_ms).toBe(8 * HOUR_MS - result.settlement.credited_ms);
		expect((await state(guild.first)).chamber!.tasks[0]!.completed_at).toBeNumber();
	});

	test('rejects another player\'s slot and work after registration closes', async () => {
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

	test('keeps the skill roll across Guild hops and alternate characters but resets progress', async () => {
		const first = await register_guild_client('Prep Hopper', 'Prep Hop One');
		const alt = await register_guild_client('Prep Hopper Alt', 'Prep Hop Alt');
		await account([first.client_id, alt.client_id]);
		const expedition_id = await register(first);
		const original = (await state(first)).chamber!;
		const skills = original.tasks.map(task => task.evidence.skill_ids[0]);
		await work(first, expedition_id, original, HOUR_MS);
		await post_json('/api/guilds/leave', {}, first.session_token);
		await post_json('/api/guilds/create', { name: 'Prep Hop Two', icon_id: 'melvorD:Farmlands' }, first.session_token);
		await register(first);
		const hopped = (await state(first)).chamber!;
		expect(hopped.visit_id).not.toBe(original.visit_id);
		expect(hopped.tasks.map(task => task.evidence.skill_ids[0])).toEqual(skills);
		expect(hopped.tasks.every(task => task.player_ms === 0)).toBe(true);
		await register(alt);
		expect((await state(alt)).chamber!.tasks.map(task => task.evidence.skill_ids[0])).toEqual(skills);
	});

	test('rolls new skills only after an Expedition the player registered for is completed', async () => {
		const guild = await make_guildmates('Prep Finisher', 'Prep Partner', 'Prep Finish Guild');
		const expedition_id = await register(guild.first);
		await db_run('UPDATE expedition_preparation_rolls SET skill_ids = ? WHERE owner_key = ?',
			[JSON.stringify(['melvorD:Mining', 'melvorD:Fishing', 'melvorD:Cooking']), `client:${guild.first_id}`]);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * HOUR_MS - 1, Date.now() - 1, expedition_id]);
		const visit_id = (await state(guild.first)).chamber!.visit_id;
		const ending = EXPEDITION_CONTENT_V1.chambers.find(chamber => chamber.type === 'ending')!;
		await db_run('DELETE FROM expedition_tasks WHERE visit_id = ?', [visit_id]);
		await db_run('DELETE FROM expedition_exits WHERE visit_id = ?', [visit_id]);
		await db_run('UPDATE expedition_visits SET chamber_id = ? WHERE id = ?', [ending.id, visit_id]);
		for (const task of ending.tasks.filter(task => task.kind !== 'scout'))
			await db_run('INSERT INTO expedition_tasks (visit_id, task_id, target_ms, player_ms, unlocked_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
				[visit_id, task.id, HOUR_MS, task.requirement === 'required' ? HOUR_MS : 0,
					Date.now(), task.requirement === 'required' ? Date.now() : null]);
		expect((await state(guild.first)).status).toBe('completed');
		expect(await db_all('SELECT owner_key FROM expedition_preparation_rolls WHERE owner_key = ?',
			[`client:${guild.first_id}`])).toEqual([]);
		await register(guild.first);
		expect((await state(guild.first)).chamber!.tasks).toHaveLength(3);
	});

	test('keeps the roll when an Expedition ends without completing', async () => {
		const guild = await make_guildmates('Prep Idle', 'Prep Idle Two', 'Prep Idle Guild');
		const expedition_id = await register(guild.first);
		const before = await db_all('SELECT skill_ids FROM expedition_preparation_rolls WHERE owner_key = ?', [`client:${guild.first_id}`]);
		await db_run('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?', [0, expedition_id]);
		expect((await state(guild.first)).status).toBe('inactive');
		expect(await db_all('SELECT skill_ids FROM expedition_preparation_rolls WHERE owner_key = ?', [`client:${guild.first_id}`]))
			.toEqual(before);
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
