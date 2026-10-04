import { expedition_capture_time, EXPEDITION_BOUNDARY_TOLERANCE_MS, EXPEDITION_FRESH_CAPTURE_MS } from './expedition-clock';
import { write_log } from './log';
import { createHash } from 'node:crypto';
import { db } from './db';
import { EXPEDITION_WORK_SKILLS, preview_task_available } from './expedition-content';
import type { ExpeditionContent, ExpeditionTask } from './expedition-content';
import { RECENTLY_ACTIVE_AFTER } from './recent-activity';
import type { WorkStatistics } from './routes/expedition';
import type { JsonObject } from './http';

type Activity = { type: 'skill' | 'combat'; skill_id?: string; action_id?: string; area_id?: string | null };
type Session = { id: number; expedition_id: number; visit_id: number; client_id: number; tenure_id: number;
	task_id: string; started_at: number; start_statistics: string; start_activities: string; ended_at: number | null;
	last_observed_at: number | null; max_observation_gap_ms: number; evidence_skill_ids: string;
	pending_boundary_at: number | null; pending_capture_at: number | null;
	start_clock_offset_ms: number | null; pending_reported_capture_at: number | null; reward_remaining_ms: number | null };
type Claim = { session_id: number; client_id: number; expedition_id: number; visit_id: number; task_id: string;
	started_at: number; cutoff_at: number; start_statistics: string; start_activities: string;
	evidence_skill_ids: string; last_observed_at: number | null; max_observation_gap_ms: number;
	pending_boundary_at: number | null; pending_capture_at: number | null;
	start_clock_offset_ms: number | null; pending_reported_capture_at: number | null; reward_remaining_ms: number | null };
type TaskRow = { target_ms: number; player_ms: number; system_ms: number; unlocked_at: number | null;
	completed_at: number | null; promoted_at: number | null };
const HOUR_MS = 3_600_000;
const MICROS_PER_HOUR = 1_000_000;
const UNVERIFIED_WAIT_MS = 24 * HOUR_MS;

function comparable_evidence(start_json: string, statistics: WorkStatistics, evidence: string[]): boolean {
	const start = JSON.parse(start_json) as WorkStatistics;
	return evidence.some(skill_id => start.time_ms[skill_id] !== undefined &&
		statistics.time_ms[skill_id] !== undefined && statistics.time_ms[skill_id] >= start.time_ms[skill_id]);
}

function pending_response(boundary_at: number): JsonObject {
	return { success: true, pending: true, boundary_at, settle_zero_at: boundary_at + UNVERIFIED_WAIT_MS,
		reason: 'awaiting_boundary_snapshot' };
}

function active_session(client_id: number): Session | null {
	return db.query<Session, [number]>(
		'SELECT * FROM expedition_work_sessions WHERE client_id = ? AND ended_at IS NULL'
	).get(client_id);
}

function active_claim(client_id: number): Claim | null {
	return db.query<Claim, [number]>(
		'SELECT * FROM expedition_work_claims WHERE client_id = ? AND settled_at IS NULL'
	).get(client_id);
}

function task_definition(expedition_id: number, visit_id: number, task_id: string,
	available_only = false): ExpeditionTask | null {
	const expedition = db.query<{ content_snapshot: string }, [number]>(
		'SELECT content_snapshot FROM expeditions WHERE id = ?'
	).get(expedition_id);
	const visit = db.query<{ chamber_id: string }, [number, number]>(
		'SELECT chamber_id FROM expedition_visits WHERE id = ? AND expedition_id = ?'
	).get(visit_id, expedition_id);
	if (!expedition || !visit) return null;
	const content = JSON.parse(expedition.content_snapshot) as ExpeditionContent;
	const chamber = content.chambers.find(chamber => chamber.id === visit.chamber_id);
	const task = chamber?.tasks.find(entry => entry.id === task_id);
	if (!chamber || !task) return null;
	return available_only && !preview_task_available(content, chamber, task) ? null : task;
}

function eligible_activity(activities: Activity[], skill_ids: string[]): boolean {
	return activities.some(activity => activity.type === 'skill'
		? skill_ids.includes(activity.skill_id ?? '') && EXPEDITION_WORK_SKILLS.has(activity.skill_id ?? '')
		: skill_ids.includes('melvorD:Combat') && activity.type === 'combat');
}

export function update_unlocks(expedition_id: number, visit_id: number, now: number): void {
	const expedition = db.query<{ content_snapshot: string }, [number]>(
		'SELECT content_snapshot FROM expeditions WHERE id = ?'
	).get(expedition_id);
	const visit = db.query<{ chamber_id: string; charted_on_arrival: number }, [number]>(
		'SELECT chamber_id, charted_on_arrival FROM expedition_visits WHERE id = ?'
	).get(visit_id);
	if (!expedition || !visit) return;
	const content = JSON.parse(expedition.content_snapshot) as ExpeditionContent;
	const chamber = content.chambers.find(entry => entry.id === visit.chamber_id);
	if (!chamber) return;
	const progress = new Map(db.query<{ task_id: string; completed_at: number | null }, [number]>(
		'SELECT task_id, completed_at FROM expedition_tasks WHERE visit_id = ?'
	).all(visit_id).map(row => [row.task_id, row]));
	const arrival = visit.charted_on_arrival ? 'arrival_scout' : 'arrival_chart';
	for (const task of chamber.tasks.filter(task => preview_task_available(content, chamber, task))) {
		if (!progress.has(task.id)) continue;
		const ready = task.depends_on.every(dependency => progress.get(dependency === 'arrival' ? arrival : dependency)?.completed_at != null);
		if (ready) db.query('UPDATE expedition_tasks SET unlocked_at = ? WHERE visit_id = ? AND task_id = ? AND unlocked_at IS NULL')
			.run(now, visit_id, task.id);
	}
	for (const task of chamber.tasks.filter(entry => entry.kind === 'discovery' &&
		preview_task_available(content, chamber, entry) &&
		progress.get(entry.id)?.completed_at != null))
		if (task.discovery_target) db.query('UPDATE expedition_exits SET discovered_at = ? WHERE visit_id = ? AND exit_id = ? AND discovered_at IS NULL')
			.run(now, visit_id, task.discovery_target);
}

function settle(session: Session, statistics: WorkStatistics, activities: Activity[], captured_at: number, now: number): JsonObject {
	const definition = task_definition(session.expedition_id, session.visit_id, session.task_id);
	const expedition = db.query<{ status: string; current_visit_id: number | null; ended_at: number | null }, [number]>(
		'SELECT status, current_visit_id, ended_at FROM expeditions WHERE id = ?'
	).get(session.expedition_id);
	if (!definition || !expedition) return { success: false, error: 'expedition_unavailable' };
	const visit = db.query<{ departed_at: number | null }, [number]>(
		'SELECT departed_at FROM expedition_visits WHERE id = ?'
	).get(session.visit_id);
	const task = db.query<TaskRow, [number, string]>(
		'SELECT * FROM expedition_tasks WHERE visit_id = ? AND task_id = ?'
	).get(session.visit_id, session.task_id);
	const tenure = db.query<{ ended_at: number | null }, [number]>(
		'SELECT ended_at FROM expedition_membership_tenures WHERE id = ?'
	).get(session.tenure_id);
	if (!task || !visit || !tenure) return { success: false, error: 'work_source_unavailable' };
	const captured_elapsed_ms = captured_at - session.started_at;
	if (captured_elapsed_ms < 0 || captured_at > now) return { success: false, error: 'invalid_capture_time' };
	const elapsed_ms = captured_elapsed_ms;
	const start = JSON.parse(session.start_statistics) as WorkStatistics;
	const start_activities = JSON.parse(session.start_activities) as Activity[];
	const tolerance = Math.max(30_000, Math.floor(elapsed_ms * 0.02));
	let target_ms = 0;
	let total_ms = 0;
	for (const [skill_id, end_value] of Object.entries(statistics.time_ms)) {
		const start_value = start.time_ms[skill_id];
		if (start_value === undefined || end_value < start_value) continue;
		const delta = Math.min(end_value - start_value, elapsed_ms + tolerance);
		total_ms += delta;
		if (definition.evidence.skill_ids.includes(skill_id)) target_ms += delta;
	}
	const concurrency = elapsed_ms === 0 ? 1 : Math.max(1, total_ms / elapsed_ms);
	const observed = eligible_activity(start_activities, definition.evidence.skill_ids);
	const verified_ms = observed ? Math.min(elapsed_ms, Math.floor(target_ms / concurrency)) : 0;
	const cutoff = Math.min(captured_at, visit.departed_at ?? captured_at,
		tenure.ended_at ?? captured_at, expedition.ended_at ?? captured_at);
	const eligible_elapsed_ms = Math.max(0, cutoff - session.started_at);
	const observation_gap = Math.max(session.max_observation_gap_ms,
		captured_at - (session.last_observed_at ?? session.started_at));
	const overlong = observation_gap > RECENTLY_ACTIVE_AFTER;
	const credited_ms = overlong ? 0 : Math.min(session.reward_remaining_ms ?? Number.MAX_SAFE_INTEGER, eligible_elapsed_ms,
		Math.floor(verified_ms * eligible_elapsed_ms / Math.max(1, elapsed_ms)));
	const guild_ms = expedition.status === 'active' && visit.departed_at === null &&
		task.completed_at === null
		? Math.min(credited_ms, Math.max(0, task.target_ms - task.player_ms - task.system_ms)) : 0;
	const completed = guild_ms > 0 && task.player_ms + task.system_ms + guild_ms >= task.target_ms;
	db.query('UPDATE expedition_work_sessions SET ended_at = ?, credited_ms = ?, guild_ms = ?, end_reason = ? WHERE id = ? AND ended_at IS NULL')
		.run(now, credited_ms, guild_ms, overlong ? 'offline_limit' : credited_ms === 0 ? 'unverified' : 'settled', session.id);
	if (guild_ms > 0) {
		db.query('UPDATE expedition_tasks SET player_ms = player_ms + ?, completed_at = CASE WHEN ? = 1 THEN ? ELSE completed_at END WHERE visit_id = ? AND task_id = ?')
			.run(guild_ms, completed ? 1 : 0, now, session.visit_id, session.task_id);
		if (completed) update_unlocks(session.expedition_id, session.visit_id, now);
		db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(session.expedition_id);
	}
	if (credited_ms > 0 && visit.departed_at === null && tenure.ended_at === null)
		db.query('INSERT INTO expedition_interactions (visit_id, client_id, interacted_at) VALUES (?, ?, ?) ' +
			'ON CONFLICT (visit_id, client_id) DO UPDATE SET interacted_at = excluded.interacted_at')
			.run(session.visit_id, session.client_id, now);
	const points_micros = Math.floor(credited_ms * MICROS_PER_HOUR / HOUR_MS);
	if (points_micros > 0) {
		db.query("INSERT INTO expedition_ep_ledger (client_id, source_kind, source_id, expedition_id, points_micros, created_at) VALUES (?, 'work', ?, ?, ?, ?)")
			.run(session.client_id, session.id, session.expedition_id, points_micros, now);
		db.query('INSERT INTO expedition_ep_balances (client_id, points_micros) VALUES (?, ?) ON CONFLICT (client_id) DO UPDATE SET points_micros = points_micros + excluded.points_micros')
			.run(session.client_id, points_micros);
	}
	return { success: true, session_id: session.id, credited_ms, guild_ms, points_micros,
		elapsed_ms, target_ms, total_ms, concurrency_factor: concurrency,
		estimated_cutoff: eligible_elapsed_ms < elapsed_ms,
		reason: overlong ? 'offline_limit' : credited_ms === 0 ? 'unverified' : 'settled',
		activities, continued: false };
}

function settle_claim(claim: Claim, statistics: WorkStatistics, captured_at: number, now: number): JsonObject {
	if (captured_at < claim.started_at || captured_at > now)
		return { success: false, error: 'invalid_capture_time' };
	const elapsed_ms = captured_at - claim.started_at;
	const start = JSON.parse(claim.start_statistics) as WorkStatistics;
	const evidence = JSON.parse(claim.evidence_skill_ids) as string[];
	const tolerance = Math.max(30_000, Math.floor(elapsed_ms * 0.02));
	let target_ms = 0;
	let total_ms = 0;
	for (const [skill_id, end_value] of Object.entries(statistics.time_ms)) {
		const start_value = start.time_ms[skill_id];
		if (start_value === undefined || end_value < start_value) continue;
		const delta = Math.min(end_value - start_value, elapsed_ms + tolerance);
		total_ms += delta;
		if (evidence.includes(skill_id)) target_ms += delta;
	}
	const concurrency = elapsed_ms === 0 ? 1 : Math.max(1, total_ms / elapsed_ms);
	const observed = eligible_activity(JSON.parse(claim.start_activities) as Activity[], evidence);
	const verified_ms = observed ? Math.min(elapsed_ms, Math.floor(target_ms / concurrency)) : 0;
	const eligible_elapsed_ms = Math.max(0, Math.min(captured_at, claim.cutoff_at) - claim.started_at);
	const overlong = Math.max(claim.max_observation_gap_ms,
		captured_at - (claim.last_observed_at ?? claim.started_at)) > RECENTLY_ACTIVE_AFTER;
	const credited_ms = overlong ? 0 : Math.min(claim.reward_remaining_ms ?? Number.MAX_SAFE_INTEGER, eligible_elapsed_ms,
		Math.floor(verified_ms * eligible_elapsed_ms / Math.max(1, elapsed_ms)));
	const points_micros = Math.floor(credited_ms * MICROS_PER_HOUR / HOUR_MS);
	db.query('UPDATE expedition_work_claims SET settled_at = ?, credited_ms = ? WHERE session_id = ? AND settled_at IS NULL')
		.run(now, credited_ms, claim.session_id);
	if (points_micros > 0) {
		db.query("INSERT INTO expedition_ep_ledger (client_id, source_kind, source_id, expedition_id, points_micros, created_at) VALUES (?, 'work', ?, ?, ?, ?)")
			.run(claim.client_id, claim.session_id, claim.expedition_id, points_micros, now);
		db.query('INSERT INTO expedition_ep_balances (client_id, points_micros) VALUES (?, ?) ' +
			'ON CONFLICT (client_id) DO UPDATE SET points_micros = points_micros + excluded.points_micros')
			.run(claim.client_id, points_micros);
	}
	return { success: true, session_id: claim.session_id, credited_ms, guild_ms: 0, points_micros,
		elapsed_ms, target_ms, total_ms, concurrency_factor: concurrency,
		estimated_cutoff: eligible_elapsed_ms < elapsed_ms,
		reason: overlong ? 'offline_limit' : credited_ms === 0 ? 'unverified' : 'settled',
		continued: false };
}

export function get_expedition_work(client_id: number) {
	return db.transaction(() => {
		const now = Date.now();
		const overdue = active_session(client_id);
		if (overdue?.pending_boundary_at !== null && overdue?.pending_boundary_at !== undefined &&
			now >= overdue.pending_boundary_at + UNVERIFIED_WAIT_MS)
			settle(overdue, { version: 1, time_ms: {} }, [], overdue.pending_capture_at ?? overdue.pending_boundary_at, now);
		const overdue_claim = active_claim(client_id);
		if (overdue_claim?.pending_boundary_at !== null && overdue_claim?.pending_boundary_at !== undefined &&
			now >= overdue_claim.pending_boundary_at + UNVERIFIED_WAIT_MS)
			settle_claim(overdue_claim, { version: 1, time_ms: {} },
				overdue_claim.pending_capture_at ?? overdue_claim.pending_boundary_at, now);
		const session = active_session(client_id);
		const claim = session ? null : active_claim(client_id);
		const balance = db.query<{ points_micros: number }, [number]>(
			'SELECT points_micros FROM expedition_ep_balances WHERE client_id = ?'
		).get(client_id)?.points_micros ?? 0;
		const tracking: JsonObject | null = session ? { session_id: session.id, expedition_id: session.expedition_id,
			visit_id: session.visit_id, task_id: session.task_id, started_at: session.started_at,
			reward_remaining_ms: session.reward_remaining_ms,
			...(session.pending_boundary_at !== null ? { pending_boundary_at: session.pending_boundary_at,
				settle_zero_at: session.pending_boundary_at + UNVERIFIED_WAIT_MS } : {}) } :
			claim ? { session_id: claim.session_id, expedition_id: claim.expedition_id,
				visit_id: claim.visit_id, task_id: claim.task_id, started_at: claim.started_at,
				reward_remaining_ms: claim.reward_remaining_ms,
				claim: true, ...(claim.pending_boundary_at !== null ? { pending_boundary_at: claim.pending_boundary_at,
					settle_zero_at: claim.pending_boundary_at + UNVERIFIED_WAIT_MS } : {}) } : null;
		return { tracking, points_micros: balance, points_display: Math.floor(balance / MICROS_PER_HOUR) };
	}).immediate();
}

export function change_expedition_work(client_id: number, operation_id: string, request: {
	expedition_id: number; visit_id: number; task_id?: string | null; statistics: WorkStatistics | null;
	activities: Activity[]; captured_at: number; kind: 'start' | 'check-in' | 'stop';
}, now = Date.now()) {
	const request_hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
	return db.transaction(() => {
		const replay = db.query<{ request_hash: string; response: string }, [number, string]>(
			'SELECT request_hash, response FROM expedition_work_operations WHERE client_id = ? AND operation_id = ?'
		).get(client_id, operation_id);
		if (replay) return replay.request_hash === request_hash ? JSON.parse(replay.response) : { success: false, error: 'operation_conflict' };
		get_expedition_work(client_id);
		const existing = active_session(client_id);
		const claim = existing ? null : active_claim(client_id);
		if (request.captured_at < 0) return { success: false, error: 'invalid_capture_time' };
		const source = existing ?? claim;
		let captured_at = expedition_capture_time(request.captured_at, now, source);
		const clock_reset = source !== null && request.captured_at <
			source.started_at + (source.start_clock_offset_ms ?? 0);
		const clock = { reported_capture_at: request.captured_at, server_received_at: now,
			reported_offset_ms: request.captured_at - now, effective_capture_at: captured_at,
			start_clock_offset_ms: source?.start_clock_offset_ms ?? null, clock_reset };
		write_log('info', `type=expedition_clock identity=${client_id} kind=${request.kind} ` +
			`reported_capture_at=${request.captured_at} server_received_at=${now} ` +
			`reported_offset_ms=${clock.reported_offset_ms} candidate_capture_at=${captured_at} start_clock_offset_ms=${source?.start_clock_offset_ms ?? "unknown"} clock_reset=${clock_reset}`);
		const pending = existing?.pending_boundary_at !== null && existing?.pending_boundary_at !== undefined ? existing : claim;
		if (pending?.pending_boundary_at !== null && pending?.pending_boundary_at !== undefined) {
			if (pending.pending_capture_at === null) {
				if (Math.abs(captured_at - pending.pending_boundary_at) > EXPEDITION_BOUNDARY_TOLERANCE_MS)
					return { success: false, error: 'boundary_capture_mismatch' };
			} else if (request.captured_at !== (pending.pending_reported_capture_at ?? pending.pending_capture_at))
				return { success: false, error: 'boundary_capture_mismatch' };
			captured_at = pending.pending_capture_at ?? Math.min(captured_at, pending.pending_boundary_at);
			clock.effective_capture_at = captured_at;
			if (pending.pending_capture_at !== null && request.statistics &&
				comparable_evidence(pending.start_statistics, request.statistics,
					JSON.parse(pending.evidence_skill_ids) as string[]))
				return { success: false, error: 'original_snapshot_missing' };
		}
		if (claim) {
			if (request.kind === 'start') return { success: false, error: 'claim_pending' };
			if (request.expedition_id !== claim.expedition_id || request.visit_id !== claim.visit_id)
				return { success: false, error: 'tracking_identity_mismatch' };
			if (!request.statistics || !comparable_evidence(claim.start_statistics, request.statistics,
				JSON.parse(claim.evidence_skill_ids) as string[])) {
				if (now >= captured_at + UNVERIFIED_WAIT_MS) {
					const settlement = settle_claim(claim, { version: 1, time_ms: {} }, captured_at, now);
					const response = { success: true, clock, settlement, ...get_expedition_work(client_id) };
					db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
						.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
					return response;
				}
				if (claim.pending_boundary_at === null) db.query(
					'UPDATE expedition_work_claims SET pending_boundary_at = ?, pending_capture_at = ?, pending_reported_capture_at = ? WHERE session_id = ?'
				).run(captured_at, captured_at, request.captured_at, claim.session_id);
				const response = { clock, ...pending_response(claim.pending_boundary_at ?? captured_at), ...get_expedition_work(client_id) };
				db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
					.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
				return response;
			}
			const settlement = settle_claim(claim, request.statistics, captured_at, now);
			if (settlement.success !== true) return settlement;
			const response = { success: true, clock, settlement, ...get_expedition_work(client_id) };
			db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
				.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
			return response;
		}
		if (request.kind !== 'start' && !existing) return { success: false, error: 'no_active_tracking' };
		if (existing && (existing.expedition_id !== request.expedition_id || existing.visit_id !== request.visit_id))
			return { success: false, error: 'tracking_identity_mismatch' };
		if (!existing && !request.statistics) return { success: false, error: 'statistics_required' };
		if (request.kind === 'start' && request.task_id) {
			const requested_task = task_definition(request.expedition_id, request.visit_id, request.task_id, true);
			if (requested_task && !eligible_activity(request.activities, requested_task.evidence.skill_ids))
				return { success: false, error: 'activity_required' };
		}
		let settlement: JsonObject | null = null;
		let requested_unavailable = false;
		let fresh_snapshot_required = false;
		if (existing) {
			if (!request.statistics || !comparable_evidence(existing.start_statistics, request.statistics,
				JSON.parse(existing.evidence_skill_ids) as string[])) {
				if (now >= captured_at + UNVERIFIED_WAIT_MS) {
					settlement = settle(existing, { version: 1, time_ms: {} }, request.activities, captured_at, now);
					const response = { success: true, clock, settlement, ...get_expedition_work(client_id) };
					db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
						.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
					return response;
				}
				if (existing.pending_boundary_at === null) db.query(
					'UPDATE expedition_work_sessions SET pending_boundary_at = ?, pending_capture_at = ?, pending_reported_capture_at = ? WHERE id = ?'
				).run(captured_at, captured_at, request.captured_at, existing.id);
				const response = { clock, ...pending_response(existing.pending_boundary_at ?? captured_at), ...get_expedition_work(client_id) };
				db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
					.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
				return response;
			}
			settlement = settle(existing, request.statistics, request.activities, captured_at, now);
			if (!settlement.success) return settlement;
		}
		let started = null;
		const continued_task = request.kind === 'check-in' && existing
			? task_definition(existing.expedition_id, existing.visit_id, existing.task_id, true) : null;
		const task_id = request.kind === 'stop' ? null : request.kind === 'check-in'
			? continued_task && eligible_activity(request.activities, continued_task.evidence.skill_ids)
				? existing?.task_id : null
			: request.task_id;
		if (task_id && source && !clock_reset && now - captured_at > EXPEDITION_FRESH_CAPTURE_MS)
			fresh_snapshot_required = true;
		if (task_id && !fresh_snapshot_required) {
			const expedition = db.query<{ guild_id: number; status: string; current_visit_id: number | null }, [number]>(
				'SELECT guild_id, status, current_visit_id FROM expeditions WHERE id = ?'
			).get(request.expedition_id);
			const tenure = db.query<{ id: number }, [number, number, number]>(
				'SELECT tenure.id FROM expedition_membership_tenures AS tenure JOIN guild_memberships AS membership ON membership.id = tenure.membership_id WHERE tenure.expedition_id = ? AND tenure.client_id = ? AND membership.guild_id = ? AND tenure.ended_at IS NULL ORDER BY tenure.id DESC LIMIT 1'
			).get(request.expedition_id, client_id, expedition?.guild_id ?? -1);
			const registered = db.query<{ found: number }, [number, number]>(
				'SELECT 1 AS found FROM expedition_registrations WHERE expedition_id = ? AND client_id = ?'
			).get(request.expedition_id, client_id);
			const task = db.query<TaskRow, [number, string]>(
				'SELECT * FROM expedition_tasks WHERE visit_id = ? AND task_id = ?'
			).get(request.visit_id, task_id);
			const definition = task_definition(request.expedition_id, request.visit_id, task_id, true);
			const available = expedition?.status === 'active' && expedition.current_visit_id === request.visit_id &&
				!!tenure && !!registered && !!task && task.unlocked_at !== null && task.completed_at === null && !!definition;
			if (!available && request.kind === 'start' && !existing)
				return { success: false, error: 'task_unavailable' };
			if (!available && request.kind === 'start') requested_unavailable = true;
			if (available) {
				// Check-ins (including a start of the same task) spend the original allowance.
				const remaining_ms = Math.max(0, task.target_ms - task.player_ms - task.system_ms);
				const reward_remaining_ms = existing?.task_id === task_id && existing.reward_remaining_ms !== null
					? Math.max(0, existing.reward_remaining_ms - Number(settlement?.credited_ms ?? 0)) : remaining_ms;
				started = db.query<{ id: number }, [number, number, number, number, string, number, string, string, number, string, number, number]>(
					'INSERT INTO expedition_work_sessions (expedition_id, visit_id, client_id, tenure_id, task_id, started_at, start_statistics, start_activities, last_observed_at, evidence_skill_ids, start_clock_offset_ms, reward_remaining_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
				).get(request.expedition_id, request.visit_id, client_id, tenure.id, task_id, now,
					JSON.stringify(request.statistics), JSON.stringify(request.activities), now,
					JSON.stringify(definition?.evidence.skill_ids ?? []), request.captured_at - now, reward_remaining_ms);
			}
		}
		const response = { success: true, clock, settlement, ...get_expedition_work(client_id),
			...(requested_unavailable ? { warning: 'task_unavailable' } : {}),
			...(fresh_snapshot_required ? { warning: 'fresh_snapshot_required' } : {}) };
		db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
			.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
		return response;
	}).immediate();
}

export function observe_expedition_work(client_id: number, activities: Activity[], statistics: WorkStatistics | null,
	now = Date.now()): JsonObject | null {
	return db.transaction(() => {
		const session = active_session(client_id);
		if (!session) return null;
		if (session.pending_boundary_at !== null) return null;
		const gap = Math.max(0, now - (session.last_observed_at ?? session.started_at));
		db.query('UPDATE expedition_work_sessions SET last_observed_at = ?, max_observation_gap_ms = MAX(max_observation_gap_ms, ?) WHERE id = ?')
			.run(now, gap, session.id);
		const definition = task_definition(session.expedition_id, session.visit_id, session.task_id, true);
		if (definition && eligible_activity(activities, definition.evidence.skill_ids)) return null;
		if (!statistics || !comparable_evidence(session.start_statistics, statistics,
			JSON.parse(session.evidence_skill_ids) as string[])) {
			db.query('UPDATE expedition_work_sessions SET pending_boundary_at = ? WHERE id = ?')
				.run(now, session.id);
			return pending_response(now);
		}
		return settle({ ...session, last_observed_at: now, max_observation_gap_ms: Math.max(session.max_observation_gap_ms, gap) },
			statistics, activities, now, now);
	}).immediate();
}
