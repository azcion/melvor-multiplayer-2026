import { describe, expect, test } from 'bun:test';
import { attach_to_free_fellowship, make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';
import { scale_expedition_hours } from '../../guild-expedition';
import { EXPEDITION_CONTENT_V1 } from '../../expedition-content';
import { RECENTLY_ACTIVE_AFTER } from '../../recent-activity';

type ExpeditionState = {
	contract_version: number;
	content_version: number;
	expedition: null | {
		id: number;
		status: string;
		ended_at?: number | null;
		stash_outcome: string;
		registered: boolean;
		registered_count: number;
		history: { chamber_id: string; label: string; departed_at: number | null }[];
		chamber: null | {
			id: string; visit_id: number;
			participant_count: number;
			arrival_kind: string;
			tasks: { task_id: string; title: string; phase: string; requirement: string; kind: string;
				evidence: { skill_ids: string[] };
				target_ms: number; unlocked_at: number | null }[];
			exits: { id: string; label: string }[];
		};
	};
};

describe('Guild Expedition registration', () => {
	async function restore_branching_snapshot(expedition_id: number) {
		await db_run('UPDATE expeditions SET content_version = ?, content_snapshot = ? WHERE id = ?',
			[EXPEDITION_CONTENT_V1.version, JSON.stringify(EXPEDITION_CONTENT_V1), expedition_id]);
	}
	test('restricts new preview runs to the seven-Chamber route while keeping votes', async () => {
		const guild = await make_guildmates('Preview One', 'Preview Two', 'Preview Guild');
		const registration = await post_json<{ expedition_id: number }>('/api/expedition/register',
			{ operation_id: crypto.randomUUID() }, guild.first.session_token);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000, Date.now() - 1, registration.json.expedition_id]);
		const route = ['entrance', 'prismatic_descent', 'glassroot_terraces',
			'buried_observatory', 'prismatic_orrery', 'voidwatch_threshold', 'hollow_star'];
		for (const [index, chamber_id] of route.entries()) {
			const state = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
			const chamber = state.expedition.chamber;
			expect(chamber.id).toBe(chamber_id);
			const visit_id = chamber.visit_id;
			if (index === route.length - 1) {
				expect(chamber.preview_exit_id).toBeNull();
				await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ?',
					[Date.now(), visit_id]);
				break;
			}
			expect(chamber.exits.some((edge: any) => edge.id === chamber.preview_exit_id)).toBe(true);
			await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ? AND task_id = ?',
				[Date.now(), visit_id, 'arrival_chart']);
			const opened = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
			if (chamber.exits.length > 1) {
				expect(opened.expedition.chamber.vote.opened_at).toBeNumber();
				const wrong = chamber.exits.find((edge: any) => edge.id !== chamber.preview_exit_id);
				const rejected = await post_json<any>('/api/expedition/vote', {
					operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id,
					visit_id, exit_id: wrong.id
				}, guild.first.session_token);
				expect(rejected.json).toEqual({ success: false, error: 'preview_exit_restricted' });
				const voted = await post_json<any>('/api/expedition/vote', {
					operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id,
					visit_id, exit_id: chamber.preview_exit_id
				}, guild.first.session_token);
				expect(voted.json.success).toBe(true);
				await db_run('UPDATE expedition_visits SET vote_deadline_at = ? WHERE id = ?', [Date.now() - 1, visit_id]);
				const locked = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
				expect(locked.expedition.chamber.vote.chosen_exit_id).toBe(chamber.preview_exit_id);
			} else {
				expect(opened.expedition.chamber.vote.opened_at).toBeNumber();
				expect(opened.expedition.chamber.vote.deadline_at).toBeNull();
				expect(opened.expedition.chamber.vote.locked_at).toBeNumber();
				expect(opened.expedition.chamber.vote.chosen_exit_id).toBe(chamber.preview_exit_id);
				if (chamber_id === 'buried_observatory') {
					await db_run('UPDATE expedition_visits SET chosen_exit_id = NULL, vote_locked_at = NULL, vote_opened_at = ?, vote_deadline_at = ? WHERE id = ?',
						[Date.now(), Date.now() + 20 * 3_600_000, visit_id]);
					const corrected = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
					expect(corrected.expedition.chamber.vote.opened_at).toBeNumber();
					expect(corrected.expedition.chamber.vote.deadline_at).toBeNull();
					expect(corrected.expedition.chamber.vote.locked_at).toBeNumber();
					expect(corrected.expedition.chamber.vote.chosen_exit_id).toBe(chamber.preview_exit_id);
				}
				const rejected = await post_json<any>('/api/expedition/vote', {
					operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id,
					visit_id, exit_id: chamber.preview_exit_id
				}, guild.first.session_token);
				expect(rejected.json).toEqual({ success: false, error: 'vote_closed' });
			}
			await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ?',
				[Date.now(), visit_id]);
			await db_run('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ? AND exit_id = ?',
				[Date.now(), visit_id, chamber.preview_exit_id]);
		}
		const completed = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(completed.expedition.status).toBe('completed');
		expect(completed.expedition.history.map((entry: any) => entry.chamber_id)).toEqual(route);
	});
	test('chooses a sole exit after arrival work without a ballot', async () => {
		const guild = await make_guildmates('Sole Exit A', 'Sole Exit B', 'Sole Exit Guild');
		const registration = await post_json<{ expedition_id: number }>('/api/expedition/register',
			{ operation_id: crypto.randomUUID() }, guild.first.session_token);
		await restore_branching_snapshot(registration.json.expedition_id);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, registration.json.expedition_id]);
		let state = (await get_json_with_session<ExpeditionState>(
			'/api/expedition/state', guild.first.session_token)).json;
		const parents = new Map<string, { source: string; exit_id: string }>();
		const queue = ['entrance'];
		for (const chamber_id of queue) {
			const chamber = EXPEDITION_CONTENT_V1.chambers.find(entry => entry.id === chamber_id)!;
			for (const edge of chamber.exits) if (!parents.has(edge.target)) {
				parents.set(edge.target, { source: chamber_id, exit_id: edge.id });
				queue.push(edge.target);
			}
		}
		const route: string[] = [];
		for (let chamber_id = 'rootforge_passage'; chamber_id !== 'entrance';) {
			const parent = parents.get(chamber_id)!;
			route.unshift(parent.exit_id);
			chamber_id = parent.source;
		}
		for (const exit_id of route) {
			const visit_id = state.expedition?.chamber?.visit_id ?? -1;
			await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ?',
				[Date.now(), visit_id]);
			await db_run('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ? AND exit_id = ?',
				[Date.now(), visit_id, exit_id]);
			await db_run('UPDATE expedition_visits SET chosen_exit_id = ?, vote_locked_at = ? WHERE id = ?',
				[exit_id, Date.now(), visit_id]);
			state = (await get_json_with_session<ExpeditionState>(
				'/api/expedition/state', guild.first.session_token)).json;
		}
		expect(state.expedition?.chamber?.id).toBe('rootforge_passage');
		const visit_id = state.expedition?.chamber?.visit_id ?? -1;
		const exit_id = state.expedition?.chamber?.exits[0]?.id;
		expect(state.expedition?.chamber?.exits).toHaveLength(1);
		await db_run('UPDATE expedition_tasks SET completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[Date.now(), visit_id, 'arrival_chart']);
		state = (await get_json_with_session<ExpeditionState>(
			'/api/expedition/state', guild.first.session_token)).json;
		const locked = await db_all('SELECT chosen_exit_id, vote_opened_at, vote_locked_at, vote_deadline_at FROM expedition_visits WHERE id = ?', [visit_id]);
		expect(locked[0]?.chosen_exit_id).toBe(exit_id);
		expect(locked[0]?.vote_opened_at).toBeNumber();
		expect(locked[0]?.vote_locked_at).toBeNumber();
		expect(locked[0]?.vote_deadline_at).toBeNull();
		expect(state.expedition?.chamber?.exits[0]?.label).toBe('???');
		const ballot = await post_json<{ success: boolean; error: string }>('/api/expedition/vote',
			{ operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id, visit_id, exit_id },
			guild.first.session_token);
		expect(ballot.json).toEqual({ success: false, error: 'vote_closed' });
	});
	test('shortens a sole registrant vote to one hour and corrects an existing long deadline', async () => {
		const guild = await make_guildmates('Solo Voter', 'Guildmate', 'Solo Vote Guild');
		const registration = await post_json<{ expedition_id: number }>('/api/expedition/register',
			{ operation_id: crypto.randomUUID() }, guild.first.session_token);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, registration.json.expedition_id]);
		const state = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		const visit_id = state.expedition.chamber.visit_id;
		await db_run('UPDATE expedition_tasks SET completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[Date.now(), visit_id, 'arrival_chart']);
		await get_json_with_session('/api/expedition/state', guild.first.session_token);
		const voted = await post_json<{ success: boolean; ppc: number; vote_deadline_at: number }>(
			'/api/expedition/vote', {
				operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id,
				visit_id, exit_id: state.expedition.chamber.preview_exit_id
			}, guild.first.session_token);
		expect(voted.json.success).toBe(true);
		expect(voted.json.ppc).toBe(0);
		expect(voted.json.vote_deadline_at).toBeLessThanOrEqual(Date.now() + 3_600_000);
		const original_deadline = voted.json.vote_deadline_at + 19 * 3_600_000;
		await db_run('UPDATE expedition_visits SET vote_deadline_at = ?, vote_half_shortened = 0, vote_full_shortened = 0 WHERE id = ?',
			[original_deadline, visit_id]);
		const corrected = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(corrected.expedition.chamber.vote.deadline_at).toBe(voted.json.vote_deadline_at);
		const repeated = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(repeated.expedition.chamber.vote.deadline_at).toBe(voted.json.vote_deadline_at);
	});
	for (const source of EXPEDITION_CONTENT_V1.chambers) for (const edge of source.exits) {
		test(`moves through ${edge.id} to ${edge.target} and completes an ending once`, async () => {
			const parents = new Map<string, { source: string; exit_id: string }>();
			const queue = ['entrance'];
			for (const chamber_id of queue) {
				const chamber = EXPEDITION_CONTENT_V1.chambers.find(entry => entry.id === chamber_id)!;
				for (const candidate of chamber.exits) if (!parents.has(candidate.target)) {
					parents.set(candidate.target, { source: chamber_id, exit_id: candidate.id });
					queue.push(candidate.target);
				}
			}
			const route = [edge.id];
			for (let chamber_id = source.id; chamber_id !== 'entrance';) {
				const parent = parents.get(chamber_id)!;
				route.unshift(parent.exit_id);
				chamber_id = parent.source;
			}
			const guild = await make_guildmates('Graph Member A', 'Graph Member B',
				`G ${source.id.slice(0, 12)} ${edge.slot}`);
			const registration = await post_json<{ expedition_id: number }>('/api/expedition/register',
				{ operation_id: crypto.randomUUID() }, guild.first.session_token);
			await restore_branching_snapshot(registration.json.expedition_id);
			await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
				[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, registration.json.expedition_id]);
			let state = (await get_json_with_session<ExpeditionState>(
				'/api/expedition/state', guild.first.session_token)).json;
			for (const exit_id of route) {
				const visit_id = state.expedition?.chamber?.visit_id ?? -1;
				const chosen = state.expedition?.chamber?.exits.find(candidate => candidate.id === exit_id);
				expect(chosen?.label).toBe('???');
				await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ?',
					[Date.now(), visit_id]);
				await db_run('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ? AND exit_id = ?',
					[Date.now(), visit_id, exit_id]);
				await db_run('UPDATE expedition_visits SET chosen_exit_id = ?, vote_locked_at = ? WHERE id = ?',
					[exit_id, Date.now(), visit_id]);
				state = (await get_json_with_session<ExpeditionState>(
					'/api/expedition/state', guild.first.session_token)).json;
			}
			expect(state.expedition?.chamber?.id).toBe(edge.target);
			expect(state.expedition?.history.length).toBe(route.length);
			if (EXPEDITION_CONTENT_V1.chambers.find(chamber => chamber.id === edge.target)?.type === 'ending') {
				const visit_id = state.expedition?.chamber?.visit_id ?? -1;
				await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? WHERE visit_id = ?',
					[Date.now(), visit_id]);
				state = (await get_json_with_session<ExpeditionState>(
					'/api/expedition/state', guild.first.session_token)).json;
				expect(state.expedition?.status).toBe('completed');
				expect(state.expedition?.chamber).toBeNull();
				const replay = (await get_json_with_session<ExpeditionState>(
					'/api/expedition/state', guild.first.session_token)).json;
				expect(replay.expedition?.history).toEqual(state.expedition?.history);
			}
		});
	}
	test('shortens a vote only for current Chamber participants and never extends it after PPC churn', async () => {
		const guild = await make_guildmates('PPC One', 'PPC Two', 'PPC Guild');
		const registration = await post_json<{ expedition_id: number }>('/api/expedition/register',
			{ operation_id: crypto.randomUUID() }, guild.first.session_token);
		await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, registration.json.expedition_id]);
		const state = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		const visit_id = state.json.expedition?.chamber?.visit_id ?? -1;
		await db_run('UPDATE expedition_tasks SET completed_at = ? WHERE visit_id = ? AND task_id = ?',
			[Date.now(), visit_id, 'arrival_chart']);
		const opened = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		const exit_id = opened.json.expedition?.chamber?.exits[0]?.id;
		expect(exit_id).toBeString();
		const first_vote = await post_json<{ ppc: number; vote_deadline_at: number }>('/api/expedition/vote',
			{ operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id, visit_id, exit_id },
			guild.first.session_token);
		expect(first_vote.json.ppc).toBe(0);
		const original_deadline = first_vote.json.vote_deadline_at;
		expect(original_deadline).toBeGreaterThan(Date.now() + 4 * 3_600_000);
		await db_run('INSERT INTO expedition_interactions (visit_id, client_id, interacted_at) VALUES (?, ?, ?)',
			[visit_id, guild.second_id, Date.now()]);
		const inactive_vote = await post_json<{ ppc: number; vote_deadline_at: number }>('/api/expedition/vote',
			{ operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id, visit_id, exit_id },
			guild.first.session_token);
		expect(inactive_vote.json.ppc).toBe(1);
		expect(inactive_vote.json.vote_deadline_at).toBe(original_deadline);
		const active_vote = await post_json<{ ppc: number; vote_deadline_at: number }>('/api/expedition/vote',
			{ operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id, visit_id, exit_id },
			guild.second.session_token);
		expect(active_vote.json.vote_deadline_at).toBeLessThan(original_deadline);
		await db_run('UPDATE expedition_interactions SET interacted_at = ? WHERE visit_id = ? AND client_id = ?',
			[Date.now() - 48 * 3_600_000 - 1, visit_id, guild.second_id]);
		const churn_vote = await post_json<{ ppc: number; vote_deadline_at: number }>('/api/expedition/vote',
			{ operation_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id, visit_id, exit_id },
			guild.first.session_token);
		expect(churn_vote.json.ppc).toBe(0);
		expect(churn_vote.json.vote_deadline_at).toBe(active_vote.json.vote_deadline_at);
	});
	test('gates test shortcuts to the configured Client and advances deadlines without player credit', async () => {
		const guild = await make_guildmates('Debug One', 'Debug Two', 'Debug Guild');
		await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?',
			['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', guild.first.client_id]);
		const registration = await post_json<{ expedition_id: number }>('/api/expedition/register',
			{ operation_id: crypto.randomUUID() }, guild.first.session_token);
		const expedition_id = registration.json.expedition_id;
		const denied = await post('/api/expedition/debug/advance',
			{ expedition_id, visit_id: null, action: 'registration', task_id: null }, guild.second.session_token);
		expect(denied.status).toBe(403);
		const advance = async (action: string, visit_id: number | null, task_id: string | null) =>
			post_json('/api/expedition/debug/advance', { expedition_id, visit_id, action, task_id },
				guild.first.session_token);
		expect((await advance('registration', null, null)).response.status).toBe(200);
		const active = await get_json_with_session<ExpeditionState & { debug_enabled: boolean }>(
			'/api/expedition/state', guild.first.session_token);
		expect(active.json.debug_enabled).toBe(true);
		const visit_id = active.json.expedition?.chamber?.visit_id ?? -1;
		expect((await advance('task', visit_id, 'arrival_chart')).response.status).toBe(200);
		const task = await db_all('SELECT player_ms, system_ms, completed_at FROM expedition_tasks WHERE visit_id = ? AND task_id = ?',
			[visit_id, 'arrival_chart']);
		expect(task[0]?.player_ms).toBe(0);
		expect(task[0]?.system_ms).toBeGreaterThan(0);
		expect(task[0]?.completed_at).toBeNumber();
		const after_task = await get_json_with_session<ExpeditionState>(
			'/api/expedition/state', guild.first.session_token);
		const exit_id = after_task.json.expedition?.chamber?.exits[0]?.id;
		expect(exit_id).toBeString();
		await post_json('/api/expedition/vote', { operation_id: crypto.randomUUID(), expedition_id,
			visit_id, exit_id }, guild.first.session_token);
		expect((await advance('vote', visit_id, null)).response.status).toBe(200);
		const locked = await db_all('SELECT vote_locked_at FROM expedition_visits WHERE id = ?', [visit_id]);
		expect(locked[0]?.vote_locked_at).toBeNumber();
		expect((await post('/api/expedition/debug/advance',
			{ expedition_id, visit_id, action: 'vote', task_id: null }, guild.first.session_token)).status).toBe(409);
		expect((await post('/api/expedition/debug/advance',
			{ expedition_id, visit_id, action: 'task', task_id: 'prepare_1' }, guild.first.session_token)).status).toBe(409);
		expect((await advance('task', visit_id, 'groundwork')).response.status).toBe(200);
		expect((await advance('task', visit_id, 'reveal_1')).response.status).toBe(200);
		expect((await advance('task', visit_id, 'prepare_1')).response.status).toBe(200);
		const next = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(next.json.expedition?.chamber?.id).toBe('prismatic_descent');
		expect(await db_all('SELECT COUNT(*) AS count FROM expedition_ep_ledger WHERE expedition_id = ?',
			[expedition_id])).toEqual([{ count: 0 }]);
	});
	test('test controls cancel a run and wipe only its Guild Expedition records and EP', async () => {
		const guild = await make_guildmates('Reset One', 'Reset Two', 'Reset Guild');
		await db_run('UPDATE clients SET client_identifier = ? WHERE client_identifier = ?',
			[crypto.randomUUID(), 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']);
		await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?',
			['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', guild.first.client_id]);
		const registration = await post_json<{ expedition_id: number }>('/api/expedition/register',
			{ operation_id: crypto.randomUUID() }, guild.first.session_token);
		const expedition_id = registration.json.expedition_id;
		await db_run("INSERT INTO expedition_ep_ledger (client_id, source_kind, source_id, expedition_id, points_micros, created_at) VALUES (?, 'work', ?, ?, ?, ?)",
			[guild.first.client_id, 900000 + expedition_id, expedition_id, 1_000_000, Date.now()]);
		await db_run('INSERT INTO expedition_ep_balances (client_id, points_micros) VALUES (?, ?)',
			[guild.first.client_id, 1_000_000]);
		expect((await post('/api/expedition/debug/cancel', { expedition_id }, guild.second.session_token)).status).toBe(403);
		expect((await post_json('/api/expedition/debug/cancel', { expedition_id }, guild.first.session_token)).response.status).toBe(200);
		expect(await db_all('SELECT status FROM expeditions WHERE id = ?', [expedition_id])).toEqual([{ status: 'inactive' }]);
		expect(await db_all('SELECT points_micros FROM expedition_ep_balances WHERE client_id = ?', [guild.first.client_id]))
			.toEqual([{ points_micros: 1_000_000 }]);
		expect((await post('/api/expedition/debug/wipe',
			{ current_expedition_id: null, confirm: 'WIPE EXPEDITION DATA' }, guild.second.session_token)).status).toBe(403);
		expect((await post_json('/api/expedition/debug/wipe',
			{ current_expedition_id: null, confirm: 'WIPE EXPEDITION DATA' }, guild.first.session_token)).response.status).toBe(200);
		expect(await db_all('SELECT id FROM expeditions WHERE id = ?', [expedition_id])).toEqual([]);
		expect(await db_all('SELECT expedition_id FROM expedition_personal_records WHERE expedition_id = ?', [expedition_id])).toEqual([]);
		expect(await db_all('SELECT points_micros FROM expedition_ep_balances WHERE client_id = ?', [guild.first.client_id])).toEqual([]);
	});
	test('scales fixed baseline hours from registered active participants', () => {
		expect([1, 2, 3, 5, 20, 45, 50].map(count => scale_expedition_hours(20, count)))
			.toEqual([15, 20, 28, 37, 84, 140, 150]);
	});

	test('registers one Guild Expedition without changing Campaign state', async () => {
		const guildless = await register_client('Expedition Guildless');
		expect((await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() },
			guildless.session_token)).json).toEqual({ error_lang: 'MOD_MP_GUILD_REQUIRED' });
		const guild = await make_guildmates('Expedition One', 'Expedition Two', 'Expedition Guild');
		const before_campaign = await db_all('SELECT COUNT(*) AS count FROM campaign_state WHERE guild_id = ?', [guild.guild_id]);
		const operation_id = crypto.randomUUID();
		const [first, second] = await Promise.all([
			post_json<{ expedition_id: number }>('/api/expedition/register', { operation_id }, guild.first.session_token),
			post_json<{ expedition_id: number }>('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token)
		]);
		expect(first.json.expedition_id).toBe(second.json.expedition_id);
		const replay = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id }, guild.first.session_token);
		expect(replay.json.expedition_id).toBe(first.json.expedition_id);
		const state = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(state.json.contract_version).toBe(1);
		expect(state.json.content_version).toBe(2);
		expect(state.json.expedition?.status).toBe('registration');
		expect(state.json.expedition?.registered_count).toBe(2);
		expect(state.json.expedition?.registered).toBe(true);
		expect((await db_all('SELECT id FROM expeditions WHERE guild_id = ?', [guild.guild_id])).length).toBe(1);
		expect(await db_all('SELECT COUNT(*) AS count FROM campaign_state WHERE guild_id = ?', [guild.guild_id]))
			.toEqual(before_campaign);
	});

	test('snapshots Entrance targets at the deadline and keeps late registration for future Chambers', async () => {
		const guild = await make_guildmates('Entrance One', 'Entrance Two', 'Entrance Guild');
		const first = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, first.json.expedition_id]);
		const opened = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(opened.json.expedition?.status).toBe('active');
		expect(opened.json.expedition?.chamber?.id).toBe('entrance');
		expect(opened.json.expedition?.chamber?.participant_count).toBe(1);
		expect(opened.json.expedition?.chamber?.arrival_kind).toBe('chart');
		const chart = opened.json.expedition?.chamber?.tasks.find(task => task.task_id === 'arrival_chart');
		expect(chart?.target_ms).toBe(15 * 3_600_000);
		expect(chart?.unlocked_at).toBeNumber();
		expect(chart?.title).toBe('Chart The Rift');
		expect(chart?.phase).toBe('arrival');
		expect(chart?.evidence.skill_ids.length).toBeGreaterThan(0);
		expect(opened.json.expedition?.chamber?.tasks.some(task => task.task_id === 'arrival_scout')).toBe(false);
		expect(opened.json.expedition?.chamber?.exits.every(edge => edge.label === '???')).toBe(true);
		expect(opened.json.expedition?.history).toEqual([]);
		await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
		const after = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.second.session_token);
		expect(after.json.expedition?.registered_count).toBe(2);
		expect(after.json.expedition?.chamber?.participant_count).toBe(1);
		expect(after.json.expedition?.chamber?.tasks.find(task => task.task_id === 'arrival_chart')?.target_ms)
			.toBe(15 * 3_600_000);
		expect((await db_all('SELECT id FROM expedition_visits WHERE expedition_id = ?', [first.json.expedition_id])).length).toBe(1);
		await db_run('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?',
			[Date.now() - RECENTLY_ACTIVE_AFTER - 1, first.json.expedition_id]);
		const ended = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(ended.json.expedition?.history).toEqual([expect.objectContaining({
			chamber_id: 'entrance', label: 'The Rift'
		})]);
	});

	test('moves a ready chosen exit once and snapshots newly active registrants for the next Chamber', async () => {
		const guild = await make_guildmates('Route One', 'Route Two', 'Route Guild');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, started.json.expedition_id]);
		const opened = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		const entrance = opened.json.expedition!.chamber!;
		expect(await db_all('SELECT chamber_id FROM expedition_charted WHERE guild_id = ?', [guild.guild_id]))
			.toEqual([]);
		await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
		const chosen = entrance.exits[0].id;
		await db_run('UPDATE expedition_visits SET chosen_exit_id = ? WHERE id = ?', [chosen, entrance.visit_id]);
		for (const task of entrance.tasks.filter(task => task.requirement === 'required' || task.task_id === 'reveal_1'))
			await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? ' +
				'WHERE visit_id = ? AND task_id = ?', [Date.now(), entrance.visit_id, task.task_id]);
		const blocked = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(blocked.json.expedition?.chamber?.visit_id).toBe(entrance.visit_id);
		expect(await db_all('SELECT chamber_id FROM expedition_charted WHERE guild_id = ?', [guild.guild_id]))
			.toEqual([{ chamber_id: 'entrance' }]);
		await db_run('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ? AND exit_id = ?',
			[Date.now(), entrance.visit_id, chosen]);
		const revealed = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(revealed.json.expedition?.chamber?.visit_id).toBe(entrance.visit_id);
		expect(revealed.json.expedition?.chamber?.exits[0].label).toBe('Prismatic Descent');
		await db_run('UPDATE expedition_tasks SET player_ms = target_ms, completed_at = ? ' +
			'WHERE visit_id = ? AND task_id = ?', [Date.now(), entrance.visit_id, 'prepare_1']);
		const moved = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(moved.json.expedition?.chamber?.id).toBe('prismatic_descent');
		expect(moved.json.expedition?.chamber?.participant_count).toBe(2);
		expect(moved.json.expedition?.history).toContainEqual(expect.objectContaining({
			chamber_id: 'entrance', departed_at: expect.any(Number)
		}));
		const next_id = moved.json.expedition!.chamber!.visit_id;
		await get_json_with_session('/api/expedition/state', guild.second.session_token);
		expect((await db_all('SELECT id FROM expedition_visits WHERE expedition_id = ?',
			[started.json.expedition_id])).length).toBe(2);
		expect((await db_all<{ id: number }>('SELECT id FROM expedition_visits WHERE expedition_id = ? ' +
			'AND departed_at IS NULL', [started.json.expedition_id]))[0].id).toBe(next_id);
	});

	test('completes an ending once and retains Guild history and personal terminal state', async () => {
		const guild = await make_guildmates('Ending One', 'Ending Two', 'Ending Guild');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		await db_run('UPDATE expeditions SET registered_at = ?, registration_ends_at = ? WHERE id = ?',
			[Date.now() - 20 * 3_600_000 - 1, Date.now() - 1, started.json.expedition_id]);
		const opened = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		const visit_id = opened.json.expedition!.chamber!.visit_id;
		const ending = EXPEDITION_CONTENT_V1.chambers.find(chamber => chamber.type === 'ending')!;
		await db_run('DELETE FROM expedition_tasks WHERE visit_id = ?', [visit_id]);
		await db_run('DELETE FROM expedition_exits WHERE visit_id = ?', [visit_id]);
		await db_run('UPDATE expedition_visits SET chamber_id = ? WHERE id = ?', [ending.id, visit_id]);
		for (const task of ending.tasks.filter(task => task.kind !== 'scout'))
			await db_run('INSERT INTO expedition_tasks ' +
				'(visit_id, task_id, target_ms, player_ms, unlocked_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)',
				[visit_id, task.id, 3_600_000, task.requirement === 'required' ? 3_600_000 : 0,
				 Date.now(), task.requirement === 'required' ? Date.now() : null]);
		const completed = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(completed.json.expedition?.status).toBe('completed');
		expect(completed.json.expedition?.chamber).toBeNull();
		expect(completed.json.expedition?.history).toContainEqual(expect.objectContaining({ chamber_id: ending.id }));
		expect(completed.json.expedition?.stash_outcome).toBe('empty');
		await get_json_with_session('/api/expedition/state', guild.first.session_token);
		expect((await db_all('SELECT id FROM expedition_visits WHERE expedition_id = ?',
			[started.json.expedition_id])).length).toBe(1);
		const personal = await get_json_with_session<{ history: { status: string }[] }>(
			'/api/expedition/personal', guild.first.session_token);
		expect(personal.json.history[0].status).toBe('completed');
		const replay = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		expect(replay.json.expedition_id).not.toBe(started.json.expedition_id);
	});

	test('ends inactivity before a returning Client refreshes its activity timestamp', async () => {
		const guild = await make_guildmates('Inactive One', 'Inactive Two', 'Inactive Guild');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		await db_run('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?',
			[Date.now() - RECENTLY_ACTIVE_AFTER - 1, started.json.expedition_id]);
		const returned = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(returned.json.expedition?.status).toBe('inactive');
		expect(returned.json.expedition?.stash_outcome).toBe('empty');
		expect(returned.json.expedition?.history.length).toBe(0);
		expect(returned.json.expedition?.ended_at).toBeNumber();
		const retry = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		expect(retry.json.expedition_id).not.toBe(started.json.expedition_id);
		expect((await db_all<{ status: string }>('SELECT status FROM expeditions WHERE id = ?',
			[started.json.expedition_id]))[0].status).toBe('inactive');
	});

	test('keeps an empty Free Fellowship Expedition until its activity deadline', async () => {
		const member = await register_client('Expedition Fellowship Member');
		const fellowship = await attach_to_free_fellowship(member);
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, member.session_token);
		await post_json('/api/guilds/leave', {}, member.session_token);
		expect((await db_all<{ status: string }>('SELECT status FROM expeditions WHERE id = ?',
			[started.json.expedition_id]))[0].status).toBe('registration');
		const newcomer = await register_client('Expedition Fellowship Newcomer');
		await attach_to_free_fellowship(newcomer);
		const joined = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, newcomer.session_token);
		expect(joined.json.expedition_id).toBe(started.json.expedition_id);
		expect(fellowship.guild_id).toBeGreaterThan(0);
	});

	test('keeps personal registration history after ordinary Guild dissolution', async () => {
		const guild = await make_guildmates('History One', 'History Two', 'History Guild');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		await post_json('/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.second.session_token);
		await db_run('INSERT INTO expedition_supplies (expedition_id, item_id, qty, value_currency_id, value_per_item) ' +
			'VALUES (?, ?, ?, ?, ?)', [started.json.expedition_id, 'melvorD:Shrimp', 3, 'melvorD:GP', 1]);
		await db_run('INSERT INTO expedition_supply_lots ' +
			'(expedition_id, item_id, client_id, owner_key, qty, contributed_at) VALUES (?, ?, ?, ?, ?, ?)',
			[started.json.expedition_id, 'melvorD:Shrimp', guild.first_id, `client:${guild.first_id}`, 3, Date.now()]);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		const still_shared = await db_all('SELECT id FROM expeditions WHERE id = ?', [started.json.expedition_id]);
		expect(still_shared.length).toBe(1);
		const departed_tenure = await db_all<{ ended_at: number | null }>(
			'SELECT ended_at FROM expedition_membership_tenures WHERE expedition_id = ? AND client_id = ?',
			[started.json.expedition_id, guild.first_id]);
		expect(departed_tenure[0].ended_at).toBeNumber();
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		expect(await db_all('SELECT id FROM expeditions WHERE id = ?', [started.json.expedition_id])).toEqual([]);
		expect(await db_all('SELECT item_id FROM expedition_supplies WHERE expedition_id = ?',
			[started.json.expedition_id])).toEqual([]);
		expect(await db_all<{ outcome: string }>(
			'SELECT outcome FROM expedition_stash_disposals WHERE expedition_id = ?', [started.json.expedition_id]))
			.toEqual([{ outcome: 'destroyed' }]);
		const personal = await get_json_with_session<{
			history: { expedition_id: number; source_guild_id: number; status: string; ended_at: number; stash_outcome: string }[];
		}>('/api/expedition/personal', guild.first.session_token);
		expect(personal.json.history).toContainEqual(expect.objectContaining({
			expedition_id: started.json.expedition_id,
			source_guild_id: guild.guild_id,
			status: 'dissolved'
		}));
		expect(personal.json.history[0].stash_outcome).toBe('destroyed');
		expect(personal.json.history[0].ended_at).toBeNumber();
		const tenures = await db_all<{ client_id: number; ended_at: number | null }>(
			'SELECT client_id, ended_at FROM expedition_membership_tenures WHERE expedition_id = ?',
			[started.json.expedition_id]);
		expect(tenures.length).toBe(2);
		expect(tenures.every(tenure => typeof tenure.ended_at === 'number')).toBe(true);
	});

	test('records a new tenure when a registered character rejoins its Guild', async () => {
		const guild = await make_guildmates('Tenure One', 'Tenure Two', 'Tenure Guild');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/apply', { guild_id: guild.guild_id }, guild.first.session_token);
		const state = await get_json_with_session<{
			applicants: { application_id: number; client_id: number }[];
		}>('/api/guilds/state', guild.second.session_token);
		const application = state.json.applicants.find(entry => entry.client_id === guild.first_id);
		expect(application).toBeDefined();
		await post_json('/api/guilds/application/decide', {
			application_id: application!.application_id, approve: true
		}, guild.second.session_token);
		await get_json_with_session('/api/expedition/state', guild.first.session_token);
		const tenures = await db_all<{ ended_at: number | null }>(
			'SELECT ended_at FROM expedition_membership_tenures WHERE expedition_id = ? AND client_id = ? ORDER BY id',
			[started.json.expedition_id, guild.first_id]);
		expect(tenures.length).toBe(2);
		expect(tenures[0].ended_at).toBeNumber();
		expect(tenures[1].ended_at).toBeNull();
	});

	test('transfers an inactive run Stash into a merged Charitree stack once with a 24-hour owner lock', async () => {
		const guild = await make_guildmates('Stash One', 'Stash Two', 'Stash Guild');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		const now = Date.now();
		await db_run('UPDATE guilds SET charitree_enabled = 1 WHERE id = ?', [guild.guild_id]);
		await db_run('INSERT INTO charity_items ' +
			'(guild_id, item_id, qty, expires_at, donated_at, value_currency_id, value_per_item) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?)',
			[guild.guild_id, 'melvorD:Shrimp', 2, now + 3_600_000, now, 'melvorD:GP', 1]);
		await db_run('INSERT INTO expedition_supplies ' +
			'(expedition_id, item_id, qty, value_currency_id, value_per_item) VALUES (?, ?, ?, ?, ?)',
			[started.json.expedition_id, 'melvorD:Shrimp', 3, 'melvorD:GP', 1]);
		await db_run('INSERT INTO expedition_supply_lots ' +
			'(expedition_id, item_id, client_id, owner_key, qty, contributed_at) VALUES (?, ?, ?, ?, ?, ?)',
			[started.json.expedition_id, 'melvorD:Shrimp', guild.first_id, `client:${guild.first_id}`, 3, now]);
		await db_run('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?',
			[now - RECENTLY_ACTIVE_AFTER - 1, started.json.expedition_id]);
		const returned = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(returned.json.expedition?.status).toBe('inactive');
		expect(returned.json.expedition?.stash_outcome).toBe('charitree');
		const stack = await db_all<{ qty: number }>(
			'SELECT qty FROM charity_items WHERE guild_id = ? AND item_id = ?', [guild.guild_id, 'melvorD:Shrimp']);
		expect(stack).toEqual([{ qty: 5 }]);
		const lock = await db_all<{ locked_until: number }>(
			'SELECT locked_until FROM charity_currency_locks WHERE guild_id = ? AND owner_key = ? AND currency_id = ?',
			[guild.guild_id, `client:${guild.first_id}`, 'melvorD:Shrimp']);
		expect(lock[0].locked_until).toBeGreaterThanOrEqual(now + 24 * 3_600_000);
		expect(await db_all('SELECT * FROM expedition_supplies WHERE expedition_id = ?',
			[started.json.expedition_id])).toEqual([]);
		await get_json_with_session('/api/expedition/state', guild.first.session_token);
		expect(await db_all<{ qty: number }>(
			'SELECT qty FROM charity_items WHERE guild_id = ? AND item_id = ?', [guild.guild_id, 'melvorD:Shrimp']))
			.toEqual([{ qty: 5 }]);
		expect(await db_all<{ outcome: string }>(
			'SELECT outcome FROM expedition_stash_disposals WHERE expedition_id = ?', [started.json.expedition_id]))
			.toEqual([{ outcome: 'charitree' }]);
	});

	test('records Crucible Stash disposal after an explicit cutover', async () => {
		const guild = await make_guildmates('Crucible Supply A', 'Crucible Supply B', 'Crucible Stash');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		const now = Date.now();
		await db_run('INSERT INTO expedition_supplies ' +
			'(expedition_id, item_id, qty, value_currency_id, value_per_item) VALUES (?, ?, ?, ?, ?)',
			[started.json.expedition_id, 'melvorD:Shrimp', 3, 'melvorD:GP', 1]);
		await db_run('INSERT INTO expedition_supply_lots ' +
			'(expedition_id, item_id, client_id, owner_key, qty, contributed_at) VALUES (?, ?, ?, ?, ?, ?)',
			[started.json.expedition_id, 'melvorD:Shrimp', guild.first_id, `client:${guild.first_id}`, 3, now]);
		await db_run('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?',
			[now - RECENTLY_ACTIVE_AFTER - 1, started.json.expedition_id]);
		await db_run("INSERT INTO service_settings (key, value) VALUES ('crucible_cutover', '1') " +
			"ON CONFLICT (key) DO UPDATE SET value = '1'");
		try {
			const migrated_at = Date.now();
			await db_run('INSERT OR IGNORE INTO crucible_migration ' +
				'(id, started_at, completed_at, source_json, destination_json) VALUES (1, ?, ?, ?, ?)',
				[migrated_at, migrated_at, '{}', '{}']);
			await db_run('INSERT OR IGNORE INTO crucible_guilds (guild_id, processed_minute, created_at) ' +
				'SELECT id, ?, ? FROM guilds', [Math.floor(migrated_at / 60_000), migrated_at]);
			const state = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
			expect(state.json.expedition?.stash_outcome).toBe('crucible');
			expect(await db_all<{ qty: number }>(
				'SELECT qty FROM crucible_offerings WHERE guild_id = ? AND item_id = ?',
				[guild.guild_id, 'melvorD:Shrimp'])).toEqual([{ qty: 3 }]);
			expect(await db_all<{ outcome: string }>(
				'SELECT outcome FROM expedition_crucible_outcomes WHERE expedition_id = ?',
				[started.json.expedition_id])).toEqual([{ outcome: 'crucible' }]);
			expect(await db_all('SELECT 1 FROM charity_items WHERE guild_id = ? AND item_id = ?',
				[guild.guild_id, 'melvorD:Shrimp'])).toEqual([]);
		} finally {
			await db_run("UPDATE service_settings SET value = '0' WHERE key = 'crucible_cutover'");
		}
	});

	test('destroys an inactive run Stash when its Charitree is absent', async () => {
		const guild = await make_guildmates('No Tree One', 'No Tree Two', 'No Tree Guild');
		const started = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		await db_run('UPDATE guilds SET charitree_enabled = 0 WHERE id = ?', [guild.guild_id]);
		await db_run('INSERT INTO expedition_supplies ' +
			'(expedition_id, item_id, qty, value_currency_id, value_per_item) VALUES (?, ?, ?, ?, ?)',
			[started.json.expedition_id, 'melvorD:Shrimp', 3, 'melvorD:GP', 1]);
		await db_run('INSERT INTO expedition_supply_lots ' +
			'(expedition_id, item_id, client_id, owner_key, qty, contributed_at) VALUES (?, ?, ?, ?, ?, ?)',
			[started.json.expedition_id, 'melvorD:Shrimp', guild.first_id, `client:${guild.first_id}`, 3, Date.now()]);
		await db_run('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?',
			[Date.now() - RECENTLY_ACTIVE_AFTER - 1, started.json.expedition_id]);
		const state = await get_json_with_session<ExpeditionState>('/api/expedition/state', guild.first.session_token);
		expect(state.json.expedition?.stash_outcome).toBe('destroyed');
		expect(await db_all('SELECT * FROM expedition_supplies WHERE expedition_id = ?',
			[started.json.expedition_id])).toEqual([]);
		expect(await db_all<{ outcome: string }>(
			'SELECT outcome FROM expedition_stash_disposals WHERE expedition_id = ?', [started.json.expedition_id]))
			.toEqual([{ outcome: 'destroyed' }]);
	});
});
