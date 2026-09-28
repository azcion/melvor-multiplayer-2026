import * as runtime from '../app-runtime';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject } from '../http';

const { db, guild_membership_exists, parse_player_status_activities, session_get_route, session_post_route } = runtime;
const WOODCUTTING_SKILL_ID = 'melvorD:Woodcutting';
const MAX_STATISTICS = 32;

type ActiveActivity = { type: 'skill' | 'combat'; skill_id?: string; action_id?: string; area_id?: string | null };
export type WorkStatistics = { version: 1; time_ms: Record<string, number> };

function is_woodcutting(activities: ActiveActivity[]): boolean {
	return activities.some(activity => activity.type === 'skill' && activity.skill_id === WOODCUTTING_SKILL_ID);
}

export function parse_work_statistics(value: unknown): WorkStatistics | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as { version?: unknown; time_ms?: unknown };
	if (candidate.version !== 1 || candidate.time_ms === null || typeof candidate.time_ms !== 'object' || Array.isArray(candidate.time_ms)) return null;
	const entries = Object.entries(candidate.time_ms as Record<string, unknown>);
	if (entries.length > MAX_STATISTICS) return null;
	const time_ms: Record<string, number> = {};
	for (const [skill_id, amount] of entries) {
		if (!/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(skill_id) || !Number.isSafeInteger(amount) || (amount as number) < 0) return null;
		time_ms[skill_id] = amount as number;
	}
	return { version: 1, time_ms };
}

async function require_guild(client_id: number): Promise<HandlerResult | null> {
	return await guild_membership_exists(client_id, client_id) ? null : { error_lang: 'MOD_MP_GUILD_REQUIRED' };
}

function active_session(client_id: number): db_row.dev_work_tracking_sessions | null {
	return db.query<db_row.dev_work_tracking_sessions, [number]>(
		'SELECT * FROM `dev_work_tracking_sessions` WHERE `client_id` = ? AND `ended_at` IS NULL LIMIT 1'
	).get(client_id);
}

function tracking_state(client_id: number, now = Date.now()): HandlerResult {
	const row = active_session(client_id);
	return row === null ? { success: true, active: false } : {
		success: true, active: true, session_id: row.id, work_type: row.work_type,
		started_at: row.started_at, server_now: now, elapsed_ms: Math.max(0, now - row.started_at)
	};
}

function record_activity_event(session_id: number, activities: ActiveActivity[], now: number): void {
	const serialized = JSON.stringify(activities);
	const latest = db.query<{ activities: string }, [number]>(
		'SELECT `activities` FROM `dev_work_tracking_activity_events` WHERE `session_id` = ? ORDER BY `observed_at` DESC, `id` DESC LIMIT 1'
	).get(session_id);
	if (latest?.activities === serialized) return;
	db.query('INSERT INTO `dev_work_tracking_activity_events` (`session_id`, `observed_at`, `activities`, `activity_count`) VALUES(?, ?, ?, ?)')
		.run(session_id, now, serialized, activities.length);
}

function record_statistics(session_id: number, phase: 'start' | 'check_in' | 'stop', statistics: WorkStatistics, now: number): void {
	db.query('INSERT INTO `dev_work_tracking_stat_snapshots` (`session_id`, `phase`, `observed_at`, `statistics`) VALUES(?, ?, ?, ?)')
		.run(session_id, phase, now, JSON.stringify(statistics));
}

function timeline_credit(session: db_row.dev_work_tracking_sessions, ended_at: number): number {
	const events = db.query<db_row.dev_work_tracking_activity_events, [number]>(
		'SELECT * FROM `dev_work_tracking_activity_events` WHERE `session_id` = ? ORDER BY `observed_at`, `id`'
	).all(session.id);
	let credit = 0;
	for (let index = 0; index < events.length; index++) {
		const start = Math.max(session.started_at, events[index].observed_at);
		const end = Math.min(ended_at, events[index + 1]?.observed_at ?? ended_at);
		if (end <= start) continue;
		const activities = JSON.parse(events[index].activities) as ActiveActivity[];
		if (is_woodcutting(activities)) credit += (end - start) / Math.max(1, activities.length);
	}
	return Math.max(0, Math.floor(credit));
}

function calculate_statistics(session: db_row.dev_work_tracking_sessions, statistics: WorkStatistics, ended_at: number) {
	const start_row = db.query<db_row.dev_work_tracking_stat_snapshots, [number]>(
		"SELECT * FROM `dev_work_tracking_stat_snapshots` WHERE `session_id` = ? AND `phase` = 'start' ORDER BY `id` LIMIT 1"
	).get(session.id);
	const start = start_row === null ? { version: 1, time_ms: {} } as WorkStatistics : JSON.parse(start_row.statistics) as WorkStatistics;
	const elapsed_ms = Math.max(0, ended_at - session.started_at);
	const tolerance_ms = Math.max(30_000, Math.floor(elapsed_ms * 0.02));
	const deltas: number[] = [];
	let target_work_ms = 0;
	for (const [skill_id, end_value] of Object.entries(statistics.time_ms)) {
		const start_value = start.time_ms[skill_id];
		if (!Number.isSafeInteger(start_value) || end_value < start_value) continue;
		const delta = Math.min(end_value - start_value, elapsed_ms + tolerance_ms);
		deltas.push(delta);
		if (skill_id === WOODCUTTING_SKILL_ID) target_work_ms = Math.min(delta, elapsed_ms);
	}
	const total_work_ms = deltas.reduce((sum, value) => sum + value, 0);
	const effective_total_ms = total_work_ms <= elapsed_ms + tolerance_ms ? elapsed_ms : total_work_ms;
	const concurrency_factor = elapsed_ms === 0 ? 1 : Math.max(1, effective_total_ms / elapsed_ms);
	const statistics_credit_ms = Math.max(0, Math.floor(target_work_ms / concurrency_factor));
	return { elapsed_ms, target_work_ms, total_work_ms, statistics_credit_ms, concurrency_factor };
}

function finish_session(session: db_row.dev_work_tracking_sessions, activities: ActiveActivity[], statistics: WorkStatistics,
	reason: 'check_in' | 'activity_stopped', now: number) {
	record_activity_event(session.id, activities, now);
	record_statistics(session.id, reason === 'check_in' ? 'check_in' : 'stop', statistics, now);
	const stats = calculate_statistics(session, statistics, now);
	const timeline_credit_ms = timeline_credit(session, now);
	const credited_ms = Math.min(timeline_credit_ms, stats.statistics_credit_ms);
	db.query('UPDATE `dev_work_tracking_sessions` SET `ended_at` = ?, `end_reason` = ?, `elapsed_ms` = ?, ' +
		'`target_work_ms` = ?, `total_work_ms` = ?, `timeline_credit_ms` = ?, `statistics_credit_ms` = ?, `credited_ms` = ? ' +
		'WHERE `id` = ? AND `ended_at` IS NULL')
		.run(now, reason, stats.elapsed_ms, stats.target_work_ms, stats.total_work_ms, timeline_credit_ms,
			stats.statistics_credit_ms, credited_ms, session.id);
	return { ...stats, timeline_credit_ms, credited_ms, activities };
}

export function observe_dev_work_tracking(client_id: number, activities: ActiveActivity[], statistics: WorkStatistics | null,
	now = Date.now()): JsonObject | null {
	const session = active_session(client_id);
	if (session === null) return null;
	record_activity_event(session.id, activities, now);
	if (is_woodcutting(activities) || statistics === null) return null;
	return finish_session(session, activities, statistics, 'activity_stopped', now);
}

export function register_expedition_routes(): void {
	session_get_route('/api/expedition/work-tracking', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_error = await require_guild(client_id);
		return guild_error ?? tracking_state(client_id);
	});

	session_post_route('/api/expedition/work-tracking/start', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_error = await require_guild(client_id);
		if (guild_error !== null) return guild_error;
		const activities = parse_player_status_activities(json.activities) as ActiveActivity[] | null;
		const statistics = parse_work_statistics(json.statistics);
		if (activities === null || statistics === null) return 400;
		if (!is_woodcutting(activities)) return { success: false, error: 'woodcutting_not_active', activities };
		const now = Date.now();
		const session_id = db.transaction(() => {
			const existing = active_session(client_id);
			if (existing !== null)
				db.query("UPDATE `dev_work_tracking_sessions` SET `ended_at` = ?, `end_reason` = 'activity_stopped', `elapsed_ms` = ? WHERE `id` = ?")
					.run(now, Math.max(0, now - existing.started_at), existing.id);
			const inserted = db.query("INSERT INTO `dev_work_tracking_sessions` (`client_id`, `work_type`, `started_at`) VALUES(?, 'woodcutting', ?)")
				.run(client_id, now);
			const id = Number(inserted.lastInsertRowid);
			record_activity_event(id, activities, now);
			record_statistics(id, 'start', statistics, now);
			return id;
		}).immediate();
		return { success: true, active: true, session_id, work_type: 'woodcutting', started_at: now, server_now: now, elapsed_ms: 0 };
	});

	session_post_route('/api/expedition/work-tracking/check-in', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_error = await require_guild(client_id);
		if (guild_error !== null) return guild_error;
		const activities = parse_player_status_activities(json.activities) as ActiveActivity[] | null;
		const statistics = parse_work_statistics(json.statistics);
		if (activities === null || statistics === null) return 400;
		const session = active_session(client_id);
		if (session === null) return { success: false, error: 'no_active_tracking' };
		const now = Date.now();
		const result = db.transaction(() => finish_session(session, activities, statistics, 'check_in', now)).immediate();
		return { success: true, active: false, work_type: session.work_type, started_at: session.started_at,
			ended_at: now, server_now: now, ...result };
	});
}
