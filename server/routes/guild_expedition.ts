import { claim_expedition_ending, unclaimed_expedition_endings } from '../expedition-ending';
import { expedition_leaderboard } from '../expedition-leaderboard';
import { equipment_catalog_response, change_equipment_work, parse_action_statistics } from '../equipment-projects';
import * as runtime from '../app-runtime';
import { can_debug_expedition, get_debug_expedition_chambers, debug_advance_expedition, debug_cancel_expedition, debug_wipe_expedition_data, cast_expedition_vote, get_expedition_state, get_personal_expedition_history, reconcile_expedition_visit,
	register_for_expedition } from '../guild-expedition';
import type { HandlerResult } from '../http';
import { change_expedition_work, get_expedition_work } from '../expedition-work';
import { parse_work_statistics } from './expedition';
import { donate_expedition_supply, expedition_supply_catalog, get_expedition_supply_score } from '../expedition-supplies';

const { get_client_guild_id, parse_player_status_activities, session_get_route, session_post_route } = runtime;
const operation_uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function register_guild_expedition_routes(): void {
	session_post_route('/api/expedition/ending/claim', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (!Number.isSafeInteger(json.expedition_id) || Number(json.expedition_id) <= 0) return 400;
		return claim_expedition_ending(runtime.db, client_id, json.expedition_id as number) ?? 409;
	});

	session_get_route('/api/expedition/leaderboard', async (req, url): Promise<HandlerResult> => {
		const raw_page = url.searchParams.get('page') ?? '0';
		const page = Number(raw_page);
		if (!/^\d+$/.test(raw_page) || !Number.isSafeInteger(page) || page < 0) return 400;
		return expedition_leaderboard(runtime.db, page);
	});

	session_get_route('/api/expedition/personal', async (req, url, client_id): Promise<HandlerResult> => {
		const history = get_personal_expedition_history(client_id);
		return equipment_catalog_response({ contract_version: 1, history, ending_rewards: unclaimed_expedition_endings(runtime.db, client_id), ...get_expedition_work(client_id),
			supply_score: get_expedition_supply_score(client_id, history[0]?.expedition_id ?? null) }, url);
	});
	session_get_route('/api/expedition/supply/catalog', async (): Promise<HandlerResult> =>
		expedition_supply_catalog());

	session_get_route('/api/expedition/state', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		reconcile_expedition_visit(guild_id);
		const state = get_expedition_state(guild_id, client_id, Date.now(), url.searchParams.get('view') === 'tracking');
		return equipment_catalog_response({ ...state, ...(url.searchParams.get('view') === 'tracking' ? {} : { ending_rewards: unclaimed_expedition_endings(runtime.db, client_id) }), debug_enabled: can_debug_expedition(client_id),
			...(can_debug_expedition(client_id) ? { debug_chambers: get_debug_expedition_chambers(guild_id) } : {}), ...get_expedition_work(client_id),
			supply_score: get_expedition_supply_score(client_id, state.expedition?.id ?? null) }, url);
	});

	session_post_route('/api/expedition/debug/advance', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (!can_debug_expedition(client_id)) return 403;
		if (!Number.isSafeInteger(json.expedition_id) ||
			(json.visit_id !== null && !Number.isSafeInteger(json.visit_id)) ||
			(json.task_id !== null && typeof json.task_id !== 'string') ||
			!['registration', 'task', 'vote', 'phase', 'chamber', 'jump'].includes(String(json.action))) return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return 403;
		const advanced = debug_advance_expedition(guild_id, json.expedition_id as number,
			json.visit_id as number | null, json.action as 'registration' | 'task' | 'vote' | 'phase' | 'chamber' | 'jump',
			json.task_id as string | null);
		return advanced ? { success: true } : 409;
	});

	session_post_route('/api/expedition/debug/cancel', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (!can_debug_expedition(client_id)) return 403;
		if (!Number.isSafeInteger(json.expedition_id)) return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return 403;
		return debug_cancel_expedition(guild_id, json.expedition_id as number)
			? { success: true } : 409;
	});

	session_post_route('/api/expedition/debug/wipe', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (!can_debug_expedition(client_id)) return 403;
		if (json.current_expedition_id !== null && !Number.isSafeInteger(json.current_expedition_id)) return 400;
		if (json.confirm !== 'WIPE EXPEDITION DATA') return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return 403;
		const wiped_count = debug_wipe_expedition_data(guild_id, json.current_expedition_id as number | null);
		return wiped_count === null ? 409 : { success: true, wiped_count };
	});

	session_post_route('/api/expedition/register', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (typeof json.operation_id !== 'string' || !operation_uuid.test(json.operation_id)) return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (json.content_version !== undefined && json.content_version !== 2 && json.content_version !== 3) return 400;
		const expedition_id = register_for_expedition(guild_id, client_id, json.operation_id, Date.now(),
			json.content_version === 3 ? 3 : 2);
		if (expedition_id === null) return 409;
		const state = get_expedition_state(guild_id, client_id);
		return state.expedition?.id === expedition_id
			? { success: true, expedition_id, ...state }
			: { success: true, expedition_id, replayed_terminal: true };
	});

	for (const kind of ['start', 'check-in', 'stop'] as const) {
		session_post_route(`/api/expedition/task/${kind}`, async (req, url, client_id, json): Promise<HandlerResult> => {
			if (json.source === 'equipment') {
				if (runtime.is_social_only_client(client_id)) return 403;
				const actions = parse_action_statistics(json.actions);
				const statistics = parse_work_statistics(json.statistics);
				const activities = parse_player_status_activities(json.activities);
				if (typeof json.operation_id !== 'string' || !operation_uuid.test(json.operation_id) ||
					!Number.isSafeInteger(json.project_id) || !Number.isSafeInteger(json.captured_at) || Number(json.captured_at) < 0 ||
					(typeof json.task_id !== 'string' && json.task_id !== null) || !actions || !statistics || !activities) return 400;
				return equipment_catalog_response(change_equipment_work(runtime.db, client_id, json.operation_id, { kind, project_id: Number(json.project_id),
					task_id: json.task_id as string | null, captured_at: Number(json.captured_at), actions, statistics, activities }, Date.now(), url.searchParams.has('equipment_catalog')), url);
			}
			if (typeof json.operation_id !== 'string' || !operation_uuid.test(json.operation_id) ||
				!Number.isSafeInteger(json.expedition_id) || !Number.isSafeInteger(json.visit_id) ||
				(typeof json.task_id !== 'string' && json.task_id != null) ||
				!Number.isSafeInteger(json.captured_at)) return 400;
			const statistics = parse_work_statistics(json.statistics);
			const activities = parse_player_status_activities(json.activities);
			if ((json.statistics !== null && !statistics) || !activities) return 400;
			if (kind === 'start' && (typeof json.task_id !== 'string' || !statistics)) return 400;
			const result = change_expedition_work(client_id, json.operation_id, {
				expedition_id: json.expedition_id as number, visit_id: json.visit_id as number,
				task_id: json.task_id as string | null | undefined, statistics, activities,
				captured_at: json.captured_at as number, kind
			});
			const guild_id = await get_client_guild_id(client_id);
			if (result.success && guild_id !== null)
				reconcile_expedition_visit(guild_id);
			return result;
		});
	}

	session_post_route('/api/expedition/vote', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (typeof json.operation_id !== 'string' || !operation_uuid.test(json.operation_id) ||
			!Number.isSafeInteger(json.expedition_id) || !Number.isSafeInteger(json.visit_id) ||
			typeof json.exit_id !== 'string') return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		reconcile_expedition_visit(guild_id);
		return cast_expedition_vote(guild_id, client_id, json.expedition_id as number,
			json.visit_id as number, json.exit_id, json.operation_id);
	});

	// Both the wrapper and command journal preserve committed receipts across release activation.
	session_post_route('/api/expedition/supply/donate', async (req, url, client_id, json): Promise<HandlerResult> =>
		donate_expedition_supply(client_id, json.command_id, json));
}
