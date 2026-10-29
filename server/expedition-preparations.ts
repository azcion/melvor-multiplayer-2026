import { randomInt } from 'node:crypto';
import { db } from './db';
import { EXPEDITION_WORK_SKILLS } from './expedition-content';
import type { ExpeditionTask } from './expedition-content';

// Rift Preparations: personal tasks worked while an Expedition waits for registrants.
// They live in a registration-only visit so work sessions reuse chamber verification.
export const PREPARATION_CHAMBER_ID = 'rift_preparations';
export const PREPARATION_TITLE = 'Rift Preparations';
export const PREPARATION_HOURS = [8, 6, 6] as const;
const HOUR_MS = 3_600_000;

type PreparationRow = { task_id: string; client_id: number; slot: number; skill_id: string };

// Melvor account when known, so alternate characters share one roll.
export function expedition_owner_key(client_id: number): string {
	const account_id = db.query<{ melvor_account_id: number | null }, [number]>(
		'SELECT melvor_account_id FROM clients WHERE id = ?').get(client_id)?.melvor_account_id;
	return account_id == null ? `client:${client_id}` : `account:${account_id}`;
}

export function is_preparation_visit(visit_id: number): boolean {
	return db.query<{ found: number }, [number, string]>(
		'SELECT 1 AS found FROM expedition_visits WHERE id = ? AND chamber_id = ?'
	).get(visit_id, PREPARATION_CHAMBER_ID) !== null;
}

export function preparation_visit_id(expedition_id: number): number | null {
	return db.query<{ id: number }, [number, string]>(
		'SELECT id FROM expedition_visits WHERE expedition_id = ? AND chamber_id = ?'
	).get(expedition_id, PREPARATION_CHAMBER_ID)?.id ?? null;
}

// The roll survives Guild changes; only a completed Expedition consumes it.
function preparation_roll(owner_key: string, now: number): string[] {
	const existing = db.query<{ skill_ids: string }, [string]>(
		'SELECT skill_ids FROM expedition_preparation_rolls WHERE owner_key = ?'
	).get(owner_key);
	if (existing) return JSON.parse(existing.skill_ids) as string[];
	const pool = [...EXPEDITION_WORK_SKILLS];
	const skills: string[] = [];
	while (skills.length < PREPARATION_HOURS.length)
		skills.push(...pool.splice(randomInt(pool.length), 1));
	db.query('INSERT INTO expedition_preparation_rolls (owner_key, skill_ids, rolled_at) VALUES (?, ?, ?)')
		.run(owner_key, JSON.stringify(skills), now);
	return skills;
}

// Idempotent: creates the registration visit and this registrant's three tasks.
export function ensure_preparations(expedition_id: number, client_id: number, now: number): void {
	const expedition = db.query<{ status: string; registration_ends_at: number }, [number]>(
		'SELECT status, registration_ends_at FROM expeditions WHERE id = ?'
	).get(expedition_id);
	if (expedition?.status !== 'registration') return;
	let visit_id = preparation_visit_id(expedition_id);
	if (visit_id === null)
		visit_id = db.query<{ id: number }, [number, string, number]>(
			'INSERT INTO expedition_visits (expedition_id, chamber_id, entered_at, participant_count, charted_on_arrival) ' +
			'VALUES (?, ?, ?, 1, 0) RETURNING id'
		).get(expedition_id, PREPARATION_CHAMBER_ID, now)!.id;
	if (db.query('SELECT 1 FROM expedition_preparation_tasks WHERE visit_id = ? AND client_id = ? LIMIT 1')
		.get(visit_id, client_id) !== null) return;
	const skills = preparation_roll(expedition_owner_key(client_id), now);
	for (const [index, skill_id] of skills.entries()) {
		const task_id = `prep:${client_id}:${index + 1}`;
		db.query('INSERT INTO expedition_tasks (visit_id, task_id, target_ms, unlocked_at) VALUES (?, ?, ?, ?)')
			.run(visit_id, task_id, PREPARATION_HOURS[index]! * HOUR_MS, now);
		db.query('INSERT INTO expedition_preparation_tasks (visit_id, task_id, client_id, slot, skill_id) VALUES (?, ?, ?, ?, ?)')
			.run(visit_id, task_id, client_id, index + 1, skill_id);
	}
}

export function close_preparations(expedition_id: number, now: number): void {
	db.query('UPDATE expedition_visits SET departed_at = MAX(entered_at, ?) WHERE expedition_id = ? AND chamber_id = ? AND departed_at IS NULL')
		.run(now, expedition_id, PREPARATION_CHAMBER_ID);
}

export function consume_preparation_rolls(expedition_id: number): void {
	const owners = new Set(db.query<{ client_id: number }, [number]>(
		'SELECT client_id FROM expedition_registrations WHERE expedition_id = ?'
	).all(expedition_id).map(row => expedition_owner_key(row.client_id)));
	for (const owner_key of owners)
		db.query('DELETE FROM expedition_preparation_rolls WHERE owner_key = ?').run(owner_key);
}

function preparation_row(visit_id: number, task_id: string): PreparationRow | null {
	return db.query<PreparationRow, [number, string]>(
		'SELECT task_id, client_id, slot, skill_id FROM expedition_preparation_tasks WHERE visit_id = ? AND task_id = ?'
	).get(visit_id, task_id);
}

export function preparation_owner(visit_id: number, task_id: string): number | null {
	return preparation_row(visit_id, task_id)?.client_id ?? null;
}

export function preparation_definition(visit_id: number, task_id: string): ExpeditionTask | null {
	const row = preparation_row(visit_id, task_id);
	if (!row) return null;
	return { id: row.task_id, title: PREPARATION_TITLE, phase: 'arrival', kind: 'work', requirement: 'optional',
		depends_on: [], baseline_hours: PREPARATION_HOURS[row.slot - 1]!,
		evidence: { type: 'skill_time', skill_ids: [row.skill_id] } };
}

// Shaped like a chamber so clients reuse task tracking, prompts and automatic selection.
export function get_preparation_chamber(expedition_id: number, client_id: number) {
	const visit_id = preparation_visit_id(expedition_id);
	if (visit_id === null) return null;
	const tasks = db.query<{ task_id: string; slot: number; skill_id: string; target_ms: number; player_ms: number;
		system_ms: number; unlocked_at: number | null; completed_at: number | null }, [number, number]>(
		'SELECT prep.task_id, prep.slot, prep.skill_id, task.target_ms, task.player_ms, task.system_ms, ' +
		'task.unlocked_at, task.completed_at FROM expedition_preparation_tasks AS prep JOIN expedition_tasks AS task ' +
		'ON task.visit_id = prep.visit_id AND task.task_id = prep.task_id ' +
		'WHERE prep.visit_id = ? AND prep.client_id = ? ORDER BY prep.slot'
	).all(visit_id, client_id);
	if (tasks.length === 0) return null;
	return { visit_id, id: PREPARATION_CHAMBER_ID, label: PREPARATION_TITLE, theme: 'entry', depth: 0,
		preparation: true, participant_count: 1, preview_exit_id: null, arrival_kind: 'chart',
		vote: { opened_at: null, deadline_at: null, locked_at: null, chosen_exit_id: null, ballot: null },
		tasks: tasks.map(task => ({ task_id: task.task_id, slot: task.slot, target_ms: task.target_ms,
			player_ms: task.player_ms, system_ms: task.system_ms, unlocked_at: task.unlocked_at,
			completed_at: task.completed_at, promoted_at: null, title: PREPARATION_TITLE, phase: 'arrival',
			kind: 'work', requirement: 'optional', depends_on: [],
			evidence: { type: 'skill_time', skill_ids: [task.skill_id] },
			personal_ms: task.player_ms, trackers: [] })),
		exits: [] };
}
