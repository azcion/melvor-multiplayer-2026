import * as runtime from '../app-runtime';
import { can_debug_expedition, debug_advance_expedition, debug_cancel_expedition, debug_wipe_expedition_data, cast_expedition_vote, get_expedition_state, get_personal_expedition_history, reconcile_expedition_visit,
	register_for_expedition } from '../guild-expedition';
import type { HandlerResult } from '../http';
import { change_expedition_work, get_expedition_work } from '../expedition-work';
import { parse_work_statistics } from './expedition';
import { donate_expedition_supply, expedition_supply_catalog, get_expedition_supply_score } from '../expedition-supplies';

const { get_client_guild_id, parse_player_status_activities, session_get_route, session_post_route } = runtime;
const operation_uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function register_guild_expedition_routes(): void {
	session_get_route('/api/expedition/personal', async (req, url, client_id): Promise<HandlerResult> => ({
		contract_version: 1, history: get_personal_expedition_history(client_id),
		...get_expedition_work(client_id), supply_score: get_expedition_supply_score(client_id)
	}));
	session_get_route('/api/expedition/supply/catalog', async (): Promise<HandlerResult> =>
		expedition_supply_catalog());

	session_get_route('/api/expedition/state', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		reconcile_expedition_visit(guild_id, runtime.expire_charity_items_now);
		return { ...get_expedition_state(guild_id, client_id), debug_enabled: can_debug_expedition(client_id), ...get_expedition_work(client_id),
			supply_score: get_expedition_supply_score(client_id) };
	});

	session_post_route('/api/expedition/debug/advance', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (!can_debug_expedition(client_id)) return 403;
		if (!Number.isSafeInteger(json.expedition_id) ||
			(json.visit_id !== null && !Number.isSafeInteger(json.visit_id)) ||
			(json.task_id !== null && typeof json.task_id !== 'string') ||
			!['registration', 'task', 'vote'].includes(String(json.action))) return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return 403;
		const advanced = debug_advance_expedition(guild_id, json.expedition_id as number,
			json.visit_id as number | null, json.action as 'registration' | 'task' | 'vote',
			json.task_id as string | null, runtime.expire_charity_items_now);
		return advanced ? { success: true } : 409;
	});

	session_post_route('/api/expedition/debug/cancel', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (!can_debug_expedition(client_id)) return 403;
		if (!Number.isSafeInteger(json.expedition_id)) return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return 403;
		return debug_cancel_expedition(guild_id, json.expedition_id as number, runtime.expire_charity_items_now)
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
		const expedition_id = register_for_expedition(guild_id, client_id, json.operation_id);
		if (expedition_id === null) return 409;
		const state = get_expedition_state(guild_id, client_id);
		return state.expedition?.id === expedition_id
			? { success: true, expedition_id, ...state }
			: { success: true, expedition_id, replayed_terminal: true };
	});

	for (const kind of ['start', 'check-in', 'stop'] as const) {
		session_post_route(`/api/expedition/task/${kind}`, async (req, url, client_id, json): Promise<HandlerResult> => {
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
				reconcile_expedition_visit(guild_id, runtime.expire_charity_items_now);
			return result;
		});
	}

	session_post_route('/api/expedition/vote', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (typeof json.operation_id !== 'string' || !operation_uuid.test(json.operation_id) ||
			!Number.isSafeInteger(json.expedition_id) || !Number.isSafeInteger(json.visit_id) ||
			typeof json.exit_id !== 'string') return 400;
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null) return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		reconcile_expedition_visit(guild_id, runtime.expire_charity_items_now);
		return cast_expedition_vote(guild_id, client_id, json.expedition_id as number,
			json.visit_id as number, json.exit_id, json.operation_id);
	});

	session_post_route('/api/expedition/supply/donate', async (req, url, client_id, json): Promise<HandlerResult> =>
		donate_expedition_supply(client_id, json.command_id, json) ?? 400);
}
