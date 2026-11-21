import { claim_expedition_ending, get_expedition_return_summary } from './expedition-ending';
import type { JsonObject } from './http';
import { PREPARATION_CHAMBER_ID, close_preparations, ensure_preparations, get_preparation_chamber, preparation_visit_id } from './expedition-preparations';
import { record_economy_operation } from './save-rollback';
import { db } from './db';
import { EXPEDITION_CONTENT_V1, EXPEDITION_CONTENT_PREVIEW, EXPEDITION_CONTENT_V3, EXPEDITION_CONTENT_V4, EXPEDITION_CONTENT_V5, EXPEDITION_CONTENT_V6, preview_task_available, parse_expedition_content } from './expedition-content';
import type { ExpeditionChamber, ExpeditionContent } from './expedition-content';
import { RECENTLY_ACTIVE_AFTER } from './recent-activity';
import { createHash } from 'node:crypto';
import { settle_expedition_work_for_launch_cutover, update_unlocks } from './expedition-work';
import { destroy_expedition_stash } from './crucible-actions';

import { global_expedition_guild_participates, maintain_global_expedition_launch,
	set_global_expedition_participation_handler } from './global-expedition-governance';

type ExpeditionOwner = number | null;

export function expedition_scope_for_guild(guild_id: number): ExpeditionOwner {
	return global_expedition_guild_participates(guild_id) ? null : guild_id;
}

export const EXPEDITION_REGISTRATION_MS = 20 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const VOTE_MS = 20 * HOUR_MS;
const PPC_MS = 48 * HOUR_MS;

const debug_identifiers = new Set((process.env.EXPEDITION_DEBUG_CLIENT_IDENTIFIERS ?? '')
	.split(',').map(value => value.trim()).filter(value => /^[0-9a-f-]{36}$/i.test(value)));

export function can_debug_expedition(client_id: number): boolean {
	if (debug_identifiers.size === 0) return false;
	const client = db.query<{ client_identifier: string }, [number]>(
		'SELECT client_identifier FROM clients WHERE id = ? AND deleted_at IS NULL'
	).get(client_id);
	return !!client && debug_identifiers.has(client.client_identifier);
}

export function debug_expedition_chambers(content: ExpeditionContent): ExpeditionChamber[] {
	if (!content.preview_route) return content.chambers;
	const supported = new Set(['entrance', ...Object.keys(content.preview_route)]);
	for (const chamber of content.chambers) {
		const edge = chamber.exits.find(edge => edge.id === content.preview_route![chamber.id]);
		if (edge) supported.add(edge.target);
	}
	return content.chambers.filter(chamber => supported.has(chamber.id));
}

export function get_debug_expedition_chambers(guild_id: number) {
	const expedition = current_expedition(guild_id);
	return expedition ? debug_expedition_chambers(parse_expedition_content(expedition.content_snapshot))
		.map(({ id, label }) => ({ id, label })) : [];
}

export function debug_advance_expedition(guild_id: number, expedition_id: number,
	visit_id: number | null, action: 'registration' | 'task' | 'vote' | 'phase' | 'chamber' | 'jump', task_id: string | null,
	now = Date.now()): boolean {
	const changed = db.transaction(() => {
		const expedition = current_expedition(guild_id);
		if (!expedition || expedition.id !== expedition_id) return false;
		if (action === 'jump') {
			if (!task_id || (expedition.current_visit_id !== visit_id &&
				!(expedition.status === 'registration' && visit_id === preparation_visit_id(expedition.id)))) return false;
			const content = parse_expedition_content(expedition.content_snapshot);
			const chamber = debug_expedition_chambers(content).find(entry => entry.id === task_id);
			const participants = recent_registered_participants(expedition, now);
			if (!chamber || participants === 0) return false;
			if (expedition.current_visit_id !== null) db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL').run(now, visit_id);
			close_preparations(expedition.id, now);
			begin_visit(expedition, content, chamber, participants, now);
			return true;
		}
		if (action === 'registration') {
			if (expedition.status !== 'registration' || task_id !== null) return false;
			// Registration now exposes a preparation visit through the ordinary Chamber model.
			if (visit_id !== null && visit_id !== preparation_visit_id(expedition.id)) return false;
			if (recent_registered_participants(expedition, now) === 0) return false;
			db.query('UPDATE expeditions SET registration_ends_at = ? WHERE id = ?').run(now, expedition.id);
			advance_registration(guild_id, now);
			return true;
		}
		if (expedition.status !== 'active' || expedition.current_visit_id !== visit_id || visit_id === null) return false;
		if (action === 'phase' || action === 'chamber') {
			if (action === 'phase' ? !['arrival', 'exploration', 'departure'].includes(task_id ?? '') : task_id !== null) return false;
			const content = parse_expedition_content(expedition.content_snapshot);
			const chamber_id = db.query<{ chamber_id: string }, [number]>('SELECT chamber_id FROM expedition_visits WHERE id = ?').get(visit_id)?.chamber_id;
			const definitions = content.chambers.find(chamber => chamber.id === chamber_id)?.tasks ?? [];
			// Complete the selected phase and its earlier phases as one batch. Reconcile only
			// after all tasks, so an early departure cannot strand optional work.
			const phases = ['arrival', 'exploration', 'departure'];
			const through = action === 'chamber' ? 2 : phases.indexOf(task_id!);
			for (const definition of definitions.filter(task => phases.indexOf(task.phase) <= through)) {
				db.query('UPDATE expedition_tasks SET system_ms = MAX(system_ms, target_ms - player_ms), ' +
					'unlocked_at = COALESCE(unlocked_at, ?), completed_at = ? WHERE visit_id = ? AND task_id = ? AND completed_at IS NULL')
					.run(now, now, visit_id, definition.id);
			}
			update_unlocks(expedition.id, visit_id, now);
			db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
			return true;
		}
		if (action === 'vote') {
			if (task_id !== null) return false;
			const vote = db.query<{ vote_deadline_at: number | null; vote_locked_at: number | null }, [number]>(
				'SELECT vote_deadline_at, vote_locked_at FROM expedition_visits WHERE id = ?'
			).get(visit_id);
			if (!vote || vote.vote_deadline_at === null || vote.vote_locked_at !== null) return false;
			db.query('UPDATE expedition_visits SET vote_deadline_at = ? WHERE id = ?').run(now, visit_id);
			return true;
		}
		if (action !== 'task' || !task_id) return false;
		const task = db.query<{ target_ms: number; player_ms: number; system_ms: number;
			unlocked_at: number | null; completed_at: number | null; promoted_at: number | null }, [number, string]>(
			'SELECT target_ms, player_ms, system_ms, unlocked_at, completed_at, promoted_at FROM expedition_tasks WHERE visit_id = ? AND task_id = ?'
		).get(visit_id, task_id);
		if (!task || task.unlocked_at === null) return false;
		if (task.completed_at !== null) return true;
		const content = parse_expedition_content(expedition.content_snapshot);
		const chamber_id = db.query<{ chamber_id: string }, [number]>(
			'SELECT chamber_id FROM expedition_visits WHERE id = ?'
		).get(visit_id)?.chamber_id;
		const definition = content.chambers.find(chamber => chamber.id === chamber_id)?.tasks
			.find(entry => entry.id === task_id);
		const chamber = content.chambers.find(entry => entry.id === chamber_id);
		if (!definition || !chamber || !preview_task_available(content, chamber, definition)) return false;
		const discovered_exit = definition.kind === 'exit_preparation' && definition.exit_id &&
			db.query<{ discovered_at: number | null }, [number, string]>(
				'SELECT discovered_at FROM expedition_exits WHERE visit_id = ? AND exit_id = ?'
			).get(visit_id, definition.exit_id)?.discovered_at != null;
		if (definition.requirement !== 'required' && definition.requirement !== 'optional' && task.promoted_at === null && !discovered_exit) return false;
		db.query('UPDATE expedition_tasks SET system_ms = ?, completed_at = ? WHERE visit_id = ? AND task_id = ?')
			.run(Math.max(task.system_ms, task.target_ms - task.player_ms), now, visit_id, task_id);
		update_unlocks(expedition.id, visit_id, now);
		db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
		return true;
	}).immediate();
	if (changed) reconcile_expedition_visit(guild_id, now);
	return changed;
}

export function debug_cancel_expedition(guild_id: number, expedition_id: number,
	now = Date.now()): boolean {
	return db.transaction(() => {
		const expedition = current_expedition(guild_id);
		if (!expedition || expedition.id !== expedition_id) return false;
		dispose_stash(expedition, now);
		db.query("UPDATE expedition_work_sessions SET ended_at = MAX(started_at, ?), credited_ms = 0, guild_ms = 0, end_reason = 'cancelled' WHERE expedition_id = ? AND ended_at IS NULL")
			.run(now, expedition_id);
		db.query('UPDATE expedition_work_claims SET settled_at = MAX(started_at, ?), credited_ms = 0 WHERE expedition_id = ? AND settled_at IS NULL')
			.run(now, expedition_id);
		if (expedition.current_visit_id !== null)
			db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL')
				.run(now, expedition.current_visit_id);
		close_preparations(expedition_id, now);
		db.query("UPDATE expeditions SET status = 'inactive', ended_at = ?, current_visit_id = NULL, revision = revision + 1 WHERE id = ?")
			.run(now, expedition_id);
		return true;
	}).immediate();
}

export function debug_wipe_expedition_data(guild_id: number, expected_current_id: number | null): number | null {
	return db.transaction(() => {
		if ((current_expedition(guild_id)?.id ?? null) !== expected_current_id) return null;
		const runs = db.query<{ id: number }, [number]>(
			'SELECT id FROM expeditions WHERE guild_id = ? ORDER BY id'
		).all(guild_id);
		if (runs.length === 0) return 0;
		const clients = db.query<{ client_id: number }, [number]>(
			'SELECT DISTINCT registration.client_id FROM expedition_registrations AS registration ' +
			'JOIN expeditions AS expedition ON expedition.id = registration.expedition_id WHERE expedition.guild_id = ?'
		).all(guild_id);
		for (const { id } of runs) {
			db.query('DELETE FROM expedition_work_claims WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_ending_claims WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_ep_ledger WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_personal_records WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_membership_tenures WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_stash_disposals WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expeditions WHERE id = ?').run(id);
		}
		db.query('DELETE FROM expedition_charted WHERE guild_id = ?').run(guild_id);
		for (const { client_id } of clients) {
			const balance = db.query<{ points: number }, [number,number,number,number]>(
				"SELECT MAX(0,COALESCE((SELECT SUM(points_micros) FROM expedition_ep_ledger WHERE client_id=?),0)-COALESCE((SELECT SUM(c.quantity) FROM economy_corrections c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=? AND c.object_id='multiplayer:ExpeditionPointsMicros' AND c.disposition='held'),0)-COALESCE((SELECT SUM(points_micros) FROM wish_ep_spends WHERE client_id=?),0)+COALESCE((SELECT SUM(amount_micros) FROM combat_ep_ledger WHERE client_id=?),0)) AS points"
			).get(client_id,client_id,client_id,client_id)?.points ?? 0;
			db.query('DELETE FROM expedition_ep_balances WHERE client_id = ?').run(client_id);
			if (balance > 0) db.query('INSERT INTO expedition_ep_balances (client_id, points_micros) VALUES (?, ?)')
				.run(client_id, balance);
		}
		return runs.length;
	}).immediate();
}

type ExpeditionRow = {
	id: number;
	guild_id: ExpeditionOwner;
	status: 'registration' | 'active' | 'completed' | 'inactive' | 'dissolved';
	content_version: number;
	content_snapshot: string;
	registered_at: number;
	registration_ends_at: number;
	current_visit_id: number | null;
	last_qualifying_activity_at: number;
	ended_at: number | null;
	stash_outcome: 'pending' | 'empty' | 'crucible' | 'destroyed';
	revision: number;
};

export function scale_expedition_hours(baseline_hours: number, participants: number): number {
	if (!Number.isSafeInteger(baseline_hours) || baseline_hours < 1 ||
		!Number.isSafeInteger(participants) || participants < 1)
		throw new RangeError('Expedition target requires positive baseline hours and participants');
	if (participants === 1) return Math.ceil(0.75 * baseline_hours);
	if (participants === 2) return baseline_hours;
	return Math.ceil(baseline_hours * Math.sqrt(participants / 2)) + participants;
}

function current_expedition(guild_id: ExpeditionOwner): ExpeditionRow | null {
	return db.query<ExpeditionRow, [ExpeditionOwner]>(
		"SELECT * FROM expeditions WHERE guild_id IS ? AND status IN ('registration', 'active') LIMIT 1"
	).get(guild_id);
}

function open_expedition(guild_id: ExpeditionOwner, now: number, content_version: number): ExpeditionRow {
	const content = content_version === 6 ? EXPEDITION_CONTENT_V6 : content_version === 5 ? EXPEDITION_CONTENT_V5 :
		content_version === 4 ? EXPEDITION_CONTENT_V4 : content_version === 3 ? EXPEDITION_CONTENT_V3 : EXPEDITION_CONTENT_PREVIEW;
	const expedition = db.query<ExpeditionRow, [ExpeditionOwner, number, string, number, number, number]>(
		"INSERT INTO expeditions (guild_id, status, content_version, content_snapshot, registered_at, " +
		"registration_ends_at, last_qualifying_activity_at) VALUES (?, 'registration', ?, ?, ?, ?, ?) RETURNING *"
	).get(guild_id, content.version, JSON.stringify(content), now, now + EXPEDITION_REGISTRATION_MS, now);
	if (!expedition) throw new Error('Expedition registration was not created');
	return expedition;
}

function dispose_stash(expedition: ExpeditionRow, now: number): void {
	const supplies = db.query<{
		item_id: string; qty: number; value_currency_id: string | null; value_per_item: number | null;
	}, [number]>('SELECT item_id, qty, value_currency_id, value_per_item FROM expedition_supplies WHERE expedition_id = ?')
		.all(expedition.id);
	if (supplies.length === 0) {
		db.query("UPDATE expeditions SET stash_outcome = 'empty' WHERE id = ? AND stash_outcome = 'pending'")
			.run(expedition.id);
		return;
	}
	if (expedition.guild_id === null) throw new Error('A shared Expedition cannot hold Guild supplies');
	const outcome = destroy_expedition_stash(expedition.guild_id, expedition.id, now);
	db.query('INSERT INTO expedition_crucible_outcomes ' +
		'(expedition_id, source_guild_id, outcome, disposed_at) VALUES (?, ?, ?, ?)')
		.run(expedition.id, expedition.guild_id, outcome, now);
	for (const supply of supplies)
		db.query('INSERT INTO expedition_crucible_disposals (expedition_id, item_id, qty) VALUES (?, ?, ?)')
			.run(expedition.id, supply.item_id, supply.qty);
	db.query('DELETE FROM expedition_supplies WHERE expedition_id = ?').run(expedition.id);
	// Crucible disposal outcomes are stored in the companion row.
	db.query("UPDATE expeditions SET stash_outcome = 'empty' WHERE id = ? AND stash_outcome = 'pending'")
		.run(expedition.id);
	return;
}

function import_guild_journey(guild_id: number): void {
	db.query(`INSERT OR IGNORE INTO expedition_shared_knowledge (chamber_id, exit_id)
		SELECT visit.chamber_id, '' FROM expedition_visits visit
		JOIN expeditions run ON run.id = visit.expedition_id
		WHERE run.guild_id = ? AND visit.chamber_id <> ?
		UNION SELECT visit.chamber_id, passage.exit_id FROM expedition_exits passage
		JOIN expedition_visits visit ON visit.id = passage.visit_id
		JOIN expeditions run ON run.id = visit.expedition_id
		WHERE run.guild_id = ? AND passage.discovered_at IS NOT NULL`)
		.run(guild_id, PREPARATION_CHAMBER_ID, guild_id);
}

set_global_expedition_participation_handler((guild_id, opted_in, now) => {
	const leaving = current_expedition(opted_in ? guild_id : null);
	if (leaving)
		db.query(`UPDATE expedition_membership_tenures SET ended_at = MAX(started_at, ?)
			WHERE expedition_id = ? AND source_guild_id = ? AND ended_at IS NULL`)
			.run(now, leaving.id, guild_id);
	if (opted_in) import_guild_journey(guild_id);
});

export function maintain_expedition_launch(now = Date.now()): void {
	maintain_global_expedition_launch(now, (guild_ids, switch_at) => {
		for (const guild_id of guild_ids) {
			import_guild_journey(guild_id);
			const expedition = current_expedition(guild_id);
			if (!expedition) continue;
			settle_expedition_work_for_launch_cutover(db, expedition.id, switch_at, now);
			dispose_stash(expedition, switch_at);
			close_preparations(expedition.id, switch_at);
			db.query('UPDATE expedition_visits SET departed_at = ? WHERE expedition_id = ? AND departed_at IS NULL')
				.run(switch_at, expedition.id);
			db.query("UPDATE expeditions SET status = 'completed', ended_at = ?, current_visit_id = NULL, revision = revision + 1 WHERE id = ?")
				.run(switch_at, expedition.id);
			db.query('UPDATE expedition_personal_records SET ending_bonus_eligible = 1 WHERE expedition_id = ?')
				.run(expedition.id);
			const contributors = db.query<{ client_id: number }, [number]>(
				'SELECT client_id FROM expedition_personal_records WHERE expedition_id = ?'
			).all(expedition.id);
			for (const { client_id } of contributors)
				if (!claim_expedition_ending(db, client_id, expedition.id, now))
					throw new Error('Expedition cutover could not award an ending bonus');
		}
		open_expedition(null, switch_at, EXPEDITION_CONTENT_V6.version);
	});
}

function end_if_inactive(expedition: ExpeditionRow, now: number): boolean {
	if (expedition.last_qualifying_activity_at > now - RECENTLY_ACTIVE_AFTER) return false;
	dispose_stash(expedition, now);
	const ended = db.query(
		"UPDATE expeditions SET status = 'inactive', ended_at = ?, current_visit_id = NULL, " +
		"revision = revision + 1 WHERE id = ? AND status IN ('registration', 'active') " +
		'AND last_qualifying_activity_at <= ?'
	).run(now, expedition.id, now - RECENTLY_ACTIVE_AFTER);
	if (ended.changes === 0) return false;
	if (expedition.current_visit_id !== null)
		db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL')
			.run(now, expedition.current_visit_id);
	close_preparations(expedition.id, now);
	return true;
}

// Called before the session guard writes last_multiplayer_active_at. A return after four
// days must not make the old Expedition appear active again.
export function catch_up_expedition_before_activity(client_id: number,
	now = Date.now()): void {
	maintain_expedition_launch(now);
	db.transaction(() => {
		const membership = db.query<{ id: number; guild_id: number }, [number]>(
			'SELECT id, guild_id FROM guild_memberships WHERE client_id = ?'
		).get(client_id);
		if (!membership) return;
		const expedition = current_expedition(expedition_scope_for_guild(membership.guild_id));
		if (!expedition || end_if_inactive(expedition, now)) return;
		const registered = db.query<{ found: number }, [number, number]>(
			'SELECT 1 AS found FROM expedition_registrations WHERE expedition_id = ? AND client_id = ?'
		).get(expedition.id, client_id);
		if (registered) {
			db.query('INSERT INTO expedition_membership_tenures ' +
				'(expedition_id, source_guild_id, membership_id, client_id, started_at) ' +
				'VALUES (?, ?, ?, ?, ?) ON CONFLICT (expedition_id, membership_id) WHERE ended_at IS NULL DO NOTHING')
				.run(expedition.id, membership.guild_id, membership.id, client_id, now);
			db.query('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?')
				.run(now, expedition.id);
		}
	}).immediate();
}

export function maintain_inactive_expeditions(now = Date.now()): number {
	maintain_expedition_launch(now);
	return db.transaction(() => {
		const overdue = db.query<ExpeditionRow, [ExpeditionOwner]>(
			"SELECT * FROM expeditions WHERE status IN ('registration', 'active') " +
			'AND last_qualifying_activity_at <= ?'
		).all(now - RECENTLY_ACTIVE_AFTER);
		let ended = 0;
		for (const expedition of overdue)
			if (end_if_inactive(expedition, now)) ended++;
		return ended;
	}).immediate();
}

function recent_registered_participants(expedition: ExpeditionRow, now: number): number {
	return db.query<{ count: number }, [number, number, ExpeditionOwner, ExpeditionOwner, number]>(`
		SELECT COUNT(*) AS count FROM expedition_registrations AS registration
		JOIN guild_memberships AS membership ON membership.client_id = registration.client_id
		JOIN clients AS client ON client.id = registration.client_id
		WHERE registration.expedition_id = ? AND client.last_multiplayer_active_at >= ?
		AND (membership.guild_id = ? OR (? IS NULL AND EXISTS (
			SELECT 1 FROM global_expedition_guild_participation AS participation
			JOIN global_expedition_launch AS launch ON launch.id = 1 AND launch.applied_at IS NOT NULL
			WHERE participation.guild_id = membership.guild_id AND participation.opted_in = 1 AND participation.effective_at <= ?
		)))
	`).get(expedition.id, now - RECENTLY_ACTIVE_AFTER, expedition.guild_id, expedition.guild_id, now)!.count;
}

// Visits and completed reveals are the durable Guild record, including preview runs.
function guild_chamber_knowledge(guild_id: ExpeditionOwner, include_inherited = true) {
	const evidence = db.query<{ chamber_id: string; exit_id: string | null }, [ExpeditionOwner, ExpeditionOwner]>(
		'SELECT visit.chamber_id, NULL AS exit_id FROM expeditions AS run ' +
		'JOIN expedition_visits AS visit ON visit.expedition_id = run.id WHERE run.guild_id IS ? ' +
		'UNION SELECT visit.chamber_id, edge.exit_id FROM expeditions AS run ' +
		'JOIN expedition_visits AS visit ON visit.expedition_id = run.id ' +
		'JOIN expedition_exits AS edge ON edge.visit_id = visit.id WHERE run.guild_id IS ? AND edge.discovered_at IS NOT NULL'
	).all(guild_id, guild_id);
	if (include_inherited) {
		const inherited = guild_id === null
			? db.query<{ chamber_id: string; exit_id: string }, []>('SELECT chamber_id, exit_id FROM expedition_shared_knowledge').all()
			: db.query<{ chamber_id: string; exit_id: string }, [number]>(
				'SELECT chamber_id, exit_id FROM expedition_inherited_knowledge WHERE guild_id = ?').all(guild_id);
		evidence.push(...inherited.map(row => ({ ...row, exit_id: row.exit_id || null })));
	}
	const chambers = new Map([...EXPEDITION_CONTENT_V1.chambers, ...EXPEDITION_CONTENT_V6.chambers]
		.map(chamber => [chamber.id, chamber]));
	const known = new Set<string>();
	const revealed = new Set<string>();
	for (const { chamber_id, exit_id } of evidence) {
		const target = exit_id === null ? chamber_id : chambers.get(chamber_id)?.exits.find(edge => edge.id === exit_id)?.target;
		if (target) known.add(target);
		if (exit_id !== null) revealed.add(exit_id);
	}
	return { known, revealed };
}

function begin_visit(expedition: ExpeditionRow, content: ExpeditionContent, chamber: ExpeditionChamber,
	participants: number, now: number): void {
	const charted = expedition.guild_id === null
		? db.query('SELECT 1 FROM expedition_global_charted WHERE chamber_id = ?').get(chamber.id) !== null
		: db.query('SELECT 1 FROM expedition_charted WHERE guild_id = ? AND chamber_id = ?')
			.get(expedition.guild_id, chamber.id) !== null;
	const { known } = guild_chamber_knowledge(expedition.guild_id);
	const known_exits = new Set(chamber.exits.filter(edge => known.has(edge.target)).map(edge => edge.id));
	const inserted = db.query<{ id: number }, [number, string, number, number, number]>(
		'INSERT INTO expedition_visits (expedition_id, chamber_id, entered_at, participant_count, charted_on_arrival) ' +
		'VALUES (?, ?, ?, ?, ?) RETURNING id'
	).get(expedition.id, chamber.id, now, participants, charted ? 1 : 0);
	if (!inserted) throw new Error('Expedition visit was not created');
	for (const task of chamber.tasks.filter(task => preview_task_available(content, chamber, task))) {
		if (task.kind === (charted ? 'chart' : 'scout')) continue;
		const unlocked_at = task.phase === 'arrival' && task.depends_on.length === 0 ? now : null;
		db.query(
			'INSERT INTO expedition_tasks (visit_id, task_id, target_ms, unlocked_at) VALUES (?, ?, ?, ?)'
		).run(inserted.id, task.id, task.discovery_target && known_exits.has(task.discovery_target)
			? HOUR_MS : scale_expedition_hours(task.baseline_hours, participants) * HOUR_MS, unlocked_at);
	}
	for (const edge of chamber.exits)
		db.query('INSERT INTO expedition_exits (visit_id, exit_id) VALUES (?, ?)').run(inserted.id, edge.id);
	db.query("UPDATE expeditions SET status = 'active', current_visit_id = ?, revision = revision + 1 WHERE id = ?")
		.run(inserted.id, expedition.id);
}

function advance_registration(guild_id: ExpeditionOwner, now: number): void {
	const expedition = current_expedition(guild_id);
	if (!expedition || expedition.status !== 'registration' || now < expedition.registration_ends_at) return;
	const participants = recent_registered_participants(expedition, now);
	if (participants === 0) return; // An empty Fellowship may gain a registrant before the inactivity deadline.
	const content = parse_expedition_content(expedition.content_snapshot);
	const entrance = content.chambers.find(chamber => chamber.id === 'entrance');
	if (!entrance) throw new Error('Expedition snapshot lacks Entrance');
	close_preparations(expedition.id, now);
	begin_visit(expedition, content, entrance, participants, now);
}

// The locked vote records its winner in chosen_exit_id. This reconciliation is safe to
// repeat on reads and settlements after restart: the old visit is closed before the next
// one is inserted in the same transaction.
export function reconcile_expedition_visit(guild_id: ExpeditionOwner,
	now = Date.now()): boolean {
	return db.transaction(() => {
		const expedition = current_expedition(guild_id);
		if (!expedition || expedition.status !== 'active' || expedition.current_visit_id === null) return false;
		if (end_if_inactive(expedition, now)) return true;
		const visit = db.query<{ id: number; chamber_id: string; charted_on_arrival: number;
			chosen_exit_id: string | null; vote_opened_at: number | null; vote_deadline_at: number | null;
			vote_locked_at: number | null; vote_full_shortened: number }, [number]>(
			'SELECT id, chamber_id, charted_on_arrival, chosen_exit_id, vote_opened_at, vote_deadline_at, vote_locked_at, vote_full_shortened FROM expedition_visits ' +
			'WHERE id = ? AND departed_at IS NULL'
		).get(expedition.current_visit_id);
		if (!visit) throw new Error('Current Expedition visit is missing');
		const content = parse_expedition_content(expedition.content_snapshot);
		const chamber = content.chambers.find(entry => entry.id === visit.chamber_id);
		if (!chamber) throw new Error('Current Chamber is missing from content snapshot');
		// Bring pending reveals on visits that were already open at rollout onto the same target.
		const pending_reveals = db.query<{ task_id: string }, [number, number]>(
			'SELECT task_id FROM expedition_tasks WHERE visit_id = ? AND target_ms <> ? AND completed_at IS NULL'
		).all(visit.id, HOUR_MS);
		const reveal_targets = new Map(chamber.tasks.filter(task => task.discovery_target)
			.map(task => [task.id, chamber.exits.find(edge => edge.id === task.discovery_target)?.target]));
		const pending_discoveries = pending_reveals.filter(task => reveal_targets.has(task.task_id));
		if (guild_id !== null && pending_discoveries.length > 0) {
			const { known } = guild_chamber_knowledge(guild_id, false);
			let shortened = false;
			let completed = false;
			for (const { task_id } of pending_discoveries) {
				const target = reveal_targets.get(task_id);
				if (!target || !known.has(target)) continue;
				const updated = db.query<{ completed_at: number | null }, [number, number, number, number, string]>(
					'UPDATE expedition_tasks SET target_ms = ?, completed_at = CASE ' +
					'WHEN unlocked_at IS NOT NULL AND player_ms + system_ms >= ? THEN ? END ' +
					'WHERE visit_id = ? AND task_id = ? RETURNING completed_at'
				).get(HOUR_MS, HOUR_MS, now, visit.id, task_id);
				shortened = true;
				completed ||= updated?.completed_at != null;
			}
			if (completed) update_unlocks(expedition.id, visit.id, now);
			if (shortened) db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
		}
		const preview_exit_id = content.preview_route?.[chamber.id];
		if (visit.vote_deadline_at !== null && visit.vote_locked_at === null && !visit.vote_full_shortened) {
			const sole_vote = db.query<{ found: number }, [number, number, number]>(
				'SELECT 1 AS found FROM expedition_votes AS vote ' +
				'JOIN expedition_registrations AS registration ON registration.client_id = vote.client_id ' +
				'WHERE vote.visit_id = ? AND registration.expedition_id = ? AND ' +
				'(SELECT COUNT(*) FROM expedition_registrations WHERE expedition_id = ?) = 1'
			).get(visit.id, expedition.id, expedition.id);
			if (sole_vote) {
				const deadline = visit.vote_deadline_at - VOTE_MS + HOUR_MS;
				if (deadline < visit.vote_deadline_at) {
					db.query('UPDATE expedition_visits SET vote_deadline_at = ?, vote_half_shortened = 1, vote_full_shortened = 1 WHERE id = ?')
						.run(deadline, visit.id);
					db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
					visit.vote_deadline_at = deadline;
				}
			}
		}
		let assisted = false;
		for (const task of chamber.tasks.filter(task => preview_task_available(content, chamber, task))) {
			if (task.kind === 'exit_preparation') continue;
			const row = db.query<{ target_ms: number; player_ms: number; system_ms: number;
				unlocked_at: number | null; completed_at: number | null; promoted_at: number | null }, [number, string]>(
				'SELECT target_ms, player_ms, system_ms, unlocked_at, completed_at, promoted_at FROM expedition_tasks WHERE visit_id = ? AND task_id = ?'
			).get(visit.id, task.id);
			if (!row || row.completed_at !== null || row.unlocked_at === null ||
				(task.requirement !== 'required' && row.promoted_at === null)) continue;
			const hours = Math.floor(Math.max(0, now - Math.max(row.unlocked_at, row.promoted_at ?? 0) - 24 * HOUR_MS) / HOUR_MS);
			const cap = Math.floor(row.target_ms * 0.96);
			const system_ms = Math.max(row.system_ms, Math.min(cap - row.player_ms,
				Math.floor(row.target_ms * hours / 100)));
			if (system_ms > row.system_ms) {
				db.query('UPDATE expedition_tasks SET system_ms = ? WHERE visit_id = ? AND task_id = ?')
					.run(system_ms, visit.id, task.id);
				assisted = true;
			}
		}
		if (assisted) db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
		const tasks = db.query<{ task_id: string; completed_at: number | null; promoted_at: number | null }, [number]>(
			'SELECT task_id, completed_at, promoted_at FROM expedition_tasks WHERE visit_id = ?'
		).all(visit.id);
		const progress = new Map(tasks.map(task => [task.task_id, task]));
		const expected = chamber.tasks.filter(task => preview_task_available(content, chamber, task) &&
			task.kind !== (visit.charted_on_arrival ? 'chart' : 'scout'));
		if (expected.some(task => !progress.has(task.id)))
			throw new Error('Current Chamber lacks a snapshotted task');
		const chart = progress.get('arrival_chart');
		if (chart?.completed_at != null) {
			if (guild_id === null)
				db.query('INSERT OR IGNORE INTO expedition_global_charted (chamber_id, completed_at) VALUES (?, ?)')
					.run(chamber.id, chart.completed_at);
			else
				db.query('INSERT OR IGNORE INTO expedition_charted (guild_id, chamber_id, completed_at) VALUES (?, ?, ?)')
					.run(guild_id, chamber.id, chart.completed_at);
		}
		const done = (task_id: string) => progress.get(task_id)?.completed_at != null;
		const arrival = visit.charted_on_arrival ? 'arrival_scout' : 'arrival_chart';
		const arrived = done(arrival) && (content.version < 3 || expected.filter(task =>
			task.phase === 'arrival' && task.requirement === 'required').every(task => done(task.id)));
		if (chamber.type !== 'ending' && arrived && visit.vote_opened_at === null) {
			db.query('UPDATE expedition_visits SET vote_opened_at = ? WHERE id = ? AND vote_opened_at IS NULL')
				.run(now, visit.id);
			db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
		}
		if (chamber.type !== 'ending' && visit.vote_locked_at === null &&
			((chamber.exits.length === 1 && arrived) ||
				(visit.vote_deadline_at !== null && now >= visit.vote_deadline_at))) {
			const votes = db.query<{ exit_id: string; count: number }, [number]>(
				'SELECT exit_id, COUNT(*) AS count FROM expedition_votes WHERE visit_id = ? GROUP BY exit_id'
			).all(visit.id);
			const highest = Math.max(0, ...votes.map(vote => vote.count));
			const tied = votes.filter(vote => vote.count === highest && chamber.exits.some(edge => edge.id === vote.exit_id));
			const winner = preview_exit_id ?? tied[Math.floor(Math.random() * tied.length)]?.exit_id ??
				chamber.exits[Math.floor(Math.random() * chamber.exits.length)].id;
			if (chamber.exits.length === 1)
				db.query('UPDATE expedition_visits SET chosen_exit_id = ?, vote_locked_at = ?, vote_deadline_at = NULL WHERE id = ? AND vote_locked_at IS NULL')
					.run(winner, now, visit.id);
			else
				db.query('UPDATE expedition_visits SET chosen_exit_id = ?, vote_locked_at = ? WHERE id = ? AND vote_locked_at IS NULL')
					.run(winner, now, visit.id);
			visit.chosen_exit_id = winner;
			const reveal = expected.find(task => task.kind === 'discovery' && task.discovery_target === winner);
			const promote = (task_id: string): void => {
				const task = expected.find(entry => entry.id === task_id);
				if (!task || done(task_id)) return;
				db.query('UPDATE expedition_tasks SET promoted_at = ? WHERE visit_id = ? AND task_id = ? AND promoted_at IS NULL')
					.run(now, visit.id, task_id);
				for (const dependency of task.depends_on)
					promote(dependency === 'arrival' ? arrival : dependency);
			};
			if (reveal) promote(reveal.id);
			db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
		}
		const promoted = new Set(db.query<{ task_id: string }, [number]>(
			'SELECT task_id FROM expedition_tasks WHERE visit_id = ? AND promoted_at IS NOT NULL'
		).all(visit.id).map(row => row.task_id));
		if (expected.some(task =>
			(task.requirement === 'required' || promoted.has(task.id)) && !done(task.id)))
			return false;
		if (chamber.type === 'ending') {
			if (!chamber.tasks.some(task => task.kind === 'completion' && done(task.id))) return false;
			dispose_stash(expedition, now);
			db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL')
				.run(now, visit.id);
			db.query("UPDATE expeditions SET status = 'completed', ended_at = ?, current_visit_id = NULL, " +
				'revision = revision + 1 WHERE id = ?').run(now, expedition.id);
			db.query('UPDATE expedition_personal_records SET ending_bonus_eligible = 1 WHERE expedition_id = ?').run(expedition.id);
			return true;
		}
		if (!visit.chosen_exit_id) return false;
		const edge = chamber.exits.find(entry => entry.id === visit.chosen_exit_id);
		if (!edge) throw new Error('Chosen Expedition exit is absent from content snapshot');
		const discovered = db.query<{ discovered_at: number | null }, [number, string]>(
			'SELECT discovered_at FROM expedition_exits WHERE visit_id = ? AND exit_id = ?'
		).get(visit.id, edge.id);
		if (discovered?.discovered_at == null ||
			!chamber.tasks.some(task => task.kind === 'discovery' && task.discovery_target === edge.id && done(task.id)) ||
			!chamber.tasks.some(task => task.kind === 'exit_preparation' && task.exit_id === edge.id && done(task.id)))
			return false;
		const next = content.chambers.find(entry => entry.id === edge.target);
		if (!next) throw new Error('Next Chamber is absent from content snapshot');
		const participants = recent_registered_participants(expedition, now);
		if (participants === 0) return false;
		db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL')
			.run(now, visit.id);
		begin_visit(expedition, content, next, participants, now);
		return true;
	}).immediate();
}

export function register_for_expedition(guild_id: number, client_id: number, operation_id: string, now = Date.now(), content_version = 2): number | null {
	return db.transaction(() => {
		const member = db.query<{ id: number; guild_id: number }, [number, number]>(
			'SELECT id, guild_id FROM guild_memberships WHERE client_id = ? AND guild_id = ?'
		).get(client_id, guild_id);
		if (!member) throw new Error('Expedition registration requires current Guild membership');
		const owner = expedition_scope_for_guild(guild_id);
		const replay = db.query<{ expedition_id: number; kind: string }, [number, string]>(
			'SELECT operation.expedition_id, operation.kind FROM expedition_operations AS operation ' +
			'WHERE operation.client_id = ? AND operation.operation_id = ?'
		).get(client_id, operation_id);
		if (replay) return replay.kind === 'register' ? replay.expedition_id : null;
		advance_registration(owner, now); // A late entrant cannot change the Entrance snapshot.
		const expedition = current_expedition(owner) ??
			open_expedition(owner, now, owner === null ? EXPEDITION_CONTENT_V6.version : content_version);
		const result = db.query(
			'INSERT INTO expedition_registrations (expedition_id, client_id, registered_at) VALUES (?, ?, ?) ' +
			'ON CONFLICT (expedition_id, client_id) DO NOTHING'
		).run(expedition.id, client_id, now);
		if (result.changes > 0)
			db.query('INSERT INTO expedition_personal_records ' +
				'(expedition_id, client_id, source_guild_id, source_guild_name, registered_at, status) ' +
				'SELECT ?, ?, guild.id, guild.name, ?, expedition.status FROM guilds AS guild ' +
				'JOIN expeditions AS expedition ON expedition.id = ? ' +
				'WHERE guild.id = ?').run(expedition.id, client_id, now, expedition.id, guild_id);
		db.query('INSERT INTO expedition_membership_tenures ' +
			'(expedition_id, source_guild_id, membership_id, client_id, started_at) ' +
			'VALUES (?, ?, ?, ?, ?) ON CONFLICT (expedition_id, membership_id) WHERE ended_at IS NULL DO NOTHING')
			.run(expedition.id, guild_id, member.id, client_id, now);
		if (result.changes > 0)
			db.query('UPDATE expeditions SET revision = revision + 1, last_qualifying_activity_at = ? WHERE id = ?')
				.run(now, expedition.id);
		ensure_preparations(expedition.id, client_id, now);
		db.query('INSERT INTO expedition_operations (client_id, operation_id, kind, expedition_id, created_at) ' +
			'VALUES (?, ?, \'register\', ?, ?)').run(client_id, operation_id, expedition.id, now);
		record_economy_operation(db,{source_key:`expedition-register:${client_id}:${operation_id}`,client_id,
			kind:'expedition-register',local_effect:'server_only',committed_at:now,evidence:{operation_id,expedition_id:expedition.id}});
		return expedition.id;
	}).immediate();
}

export function cast_expedition_vote(guild_id: number, client_id: number, expedition_id: number,
	visit_id: number, exit_id: string, operation_id: string, now = Date.now()) {
	return db.transaction(() => {
		const request_hash = createHash('sha256').update(JSON.stringify([expedition_id, visit_id, exit_id])).digest('hex');
		const replay = db.query<{ request_hash: string; response: string }, [number, string]>(
			'SELECT request_hash, response FROM expedition_work_operations WHERE client_id = ? AND operation_id = ?'
		).get(client_id, operation_id);
		if (replay) return replay.request_hash === request_hash ? JSON.parse(replay.response) :
			{ success: false, error: 'operation_conflict' };
		const owner = expedition_scope_for_guild(guild_id);
		const expedition = current_expedition(owner);
		if (!expedition || expedition.id !== expedition_id || expedition.status !== 'active' ||
			expedition.current_visit_id !== visit_id) return { success: false, error: 'stale_visit' };
		const member = db.query<{ found: number }, [number, number, number]>(
			'SELECT 1 AS found FROM expedition_registrations AS registration JOIN guild_memberships AS membership ON membership.client_id = registration.client_id WHERE registration.expedition_id = ? AND registration.client_id = ? AND membership.guild_id = ?'
		).get(expedition_id, client_id, guild_id);
		if (!member) return { success: false, error: 'not_registered' };
		const visit = db.query<{ chamber_id: string; vote_opened_at: number | null; vote_deadline_at: number | null;
			vote_locked_at: number | null; vote_half_shortened: number; vote_full_shortened: number }, [number]>(
			'SELECT * FROM expedition_visits WHERE id = ?'
		).get(visit_id);
		if (!visit || visit.vote_opened_at === null || visit.vote_locked_at !== null)
			return { success: false, error: 'vote_closed' };
		const content = parse_expedition_content(expedition.content_snapshot);
		const chamber = content.chambers.find(entry => entry.id === visit.chamber_id);
		if (!chamber?.exits.some(edge => edge.id === exit_id)) return { success: false, error: 'invalid_exit' };
		if (content.preview_route?.[chamber.id] && content.preview_route[chamber.id] !== exit_id)
			return { success: false, error: 'preview_exit_restricted' };
		if (chamber.exits.length === 1)
			return { success: false, error: 'vote_closed' };
		if (visit.vote_deadline_at !== null && now >= visit.vote_deadline_at)
			return { success: false, error: 'vote_expired' };
		db.query('INSERT INTO expedition_votes (visit_id, client_id, exit_id, voted_at) VALUES (?, ?, ?, ?) ' +
			'ON CONFLICT (visit_id, client_id) DO UPDATE SET exit_id = excluded.exit_id, voted_at = excluded.voted_at')
			.run(visit_id, client_id, exit_id, now);
		let deadline = visit.vote_deadline_at ?? now + VOTE_MS;
		let half = visit.vote_half_shortened;
		let full = visit.vote_full_shortened;
		const registered_count = db.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS count FROM expedition_registrations WHERE expedition_id = ?'
		).get(expedition_id)?.count ?? 0;
		const participants = db.query<{ client_id: number; guild_id: number }, [number, number]>(
			'SELECT interaction.client_id, membership.guild_id FROM expedition_interactions AS interaction ' +
			'JOIN guild_memberships AS membership ON membership.client_id = interaction.client_id ' +
			'WHERE interaction.visit_id = ? AND interaction.interacted_at >= ?'
		).all(visit_id, now - PPC_MS)
			.filter(member => expedition_scope_for_guild(member.guild_id) === owner);
		const ppc = participants.length;
		const voter_active = db.query<{ found: number }, [number, number, number]>(
			'SELECT 1 AS found FROM expedition_interactions WHERE visit_id = ? AND client_id = ? AND interacted_at >= ?'
		).get(visit_id, client_id, now - PPC_MS);
		if (registered_count === 1) {
			deadline = Math.min(deadline, now + HOUR_MS);
			half = 1;
			full = 1;
		} else if (ppc > 0 && voter_active) {
			const votes = new Set(db.query<{ client_id: number }, [number]>(
				'SELECT client_id FROM expedition_votes WHERE visit_id = ?'
			).all(visit_id).map(vote => vote.client_id));
			const ballots = participants.filter(member => votes.has(member.client_id)).length;
			if (!half && ballots * 2 >= ppc) { deadline = Math.min(deadline, now + 4 * HOUR_MS); half = 1; }
			if (!full && ballots >= ppc) { deadline = Math.min(deadline, now + HOUR_MS); full = 1; }
		}
		db.query('UPDATE expedition_visits SET vote_deadline_at = ?, vote_half_shortened = ?, vote_full_shortened = ? WHERE id = ?')
			.run(deadline, half, full, visit_id);
		db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition_id);
		const response = { success: true, exit_id, vote_deadline_at: deadline, ppc };
		db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
			.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
		record_economy_operation(db,{source_key:`expedition-action:${client_id}:${operation_id}`,client_id,
			kind:'expedition-action',local_effect:'server_only',committed_at:now,evidence:{operation_id}});
		return response;
	}).immediate();
}

export function get_personal_expedition_history(client_id: number) {
	return db.query<{
		expedition_id: number; source_guild_id: number; source_guild_name: string;
		registered_at: number; status: string; ended_at: number | null; stash_outcome: string;
		earned_points_micros: number;
	}, [number]>(
		'SELECT record.expedition_id, record.source_guild_id, record.source_guild_name, record.registered_at, ' +
		'record.status, record.ended_at, COALESCE(crucible.outcome, record.stash_outcome) AS stash_outcome, ' +
		'COALESCE((SELECT SUM(points_micros) FROM expedition_ep_ledger AS ledger WHERE ledger.client_id = record.client_id AND ledger.expedition_id = record.expedition_id), 0) AS earned_points_micros ' +
		'FROM expedition_personal_records AS record LEFT JOIN expedition_crucible_outcomes AS crucible ' +
		'ON crucible.expedition_id = record.expedition_id ' +
		'WHERE record.client_id = ? ORDER BY record.expedition_id DESC LIMIT 50'
	).all(client_id);
}

export function get_expedition_state(guild_id: ExpeditionOwner, client_id: number, now = Date.now(), tracking_only = false) {
	return db.transaction(() => {
		advance_registration(guild_id, now);
		const expedition = current_expedition(guild_id) ?? db.query<ExpeditionRow, [ExpeditionOwner]>(
			'SELECT * FROM expeditions WHERE guild_id IS ? ORDER BY id DESC LIMIT 1'
		).get(guild_id);
		if (!expedition) return { contract_version: 1, content_version: EXPEDITION_CONTENT_PREVIEW.version,
			server_now: now, expedition: null };
		const registered = db.query<{ found: number }, [number, number]>(
			'SELECT 1 AS found FROM expedition_registrations WHERE expedition_id = ? AND client_id = ?'
		).get(expedition.id, client_id) !== null;
		const registered_count = db.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS count FROM expedition_registrations WHERE expedition_id = ?'
		).get(expedition.id)?.count ?? 0;
		const content = parse_expedition_content(expedition.content_snapshot);
		const chamber_names = new Map(EXPEDITION_CONTENT_V1.chambers.map(entry => [entry.id, entry.label]));
		for (const entry of content.chambers) chamber_names.set(entry.id, entry.label);
		const { known, revealed } = guild_chamber_knowledge(guild_id);
		// The client infers traversal from adjacent visits. Never connect the end of one run to the next.
		const history = tracking_only ? [] : db.query<{
			chamber_id: string; entered_at: number; departed_at: number | null; chosen_exit_id: string | null;
		}, [ExpeditionOwner, number, string]>(
			'WITH visits AS (SELECT visit.*, LEAD(visit.id) OVER (PARTITION BY visit.expedition_id ORDER BY visit.id) AS next_visit_id ' +
			'FROM expeditions AS run JOIN expedition_visits AS visit ON visit.expedition_id = run.id WHERE run.guild_id IS ?) ' +
			'SELECT chamber_id, entered_at, departed_at, CASE WHEN next_visit_id IS NOT NULL THEN chosen_exit_id END AS chosen_exit_id ' +
			'FROM visits WHERE (expedition_id <> ? OR departed_at IS NOT NULL) AND chamber_id <> ? ORDER BY expedition_id, id'
		).all(guild_id, expedition.id, PREPARATION_CHAMBER_ID).map(visit => {
			const source = EXPEDITION_CONTENT_V1.chambers.find(entry => entry.id === visit.chamber_id);
			const target = source?.exits.find(edge => edge.id === visit.chosen_exit_id)?.target;
			return { ...visit, label: chamber_names.get(visit.chamber_id) ?? visit.chamber_id,
				chosen_exit_label: target ? chamber_names.get(target) ?? target : null };
		});
		let chamber: JsonObject | null = null;
		// Past the deadline an idle Expedition can stay in registration, but preparation work is closed.
		if (registered && expedition.status === 'registration' && now < expedition.registration_ends_at) {
			ensure_preparations(expedition.id, client_id, now);
			chamber = get_preparation_chamber(expedition.id, client_id);
		}
		if (expedition.current_visit_id !== null) {
			const visit = db.query<{ id: number; chamber_id: string; participant_count: number; charted_on_arrival: number;
				vote_opened_at: number | null; vote_deadline_at: number | null; vote_locked_at: number | null;
				chosen_exit_id: string | null }, [number]>(
				'SELECT id, chamber_id, participant_count, charted_on_arrival, vote_opened_at, vote_deadline_at, vote_locked_at, chosen_exit_id FROM expedition_visits WHERE id = ?'
			).get(expedition.current_visit_id);
			if (!visit) throw new Error('Current Expedition visit is missing');
			const definition = content.chambers.find(entry => entry.id === visit.chamber_id);
			if (!definition) throw new Error('Current Chamber is missing from content snapshot');
			const tasks = db.query<{ task_id: string; target_ms: number; player_ms: number; system_ms: number;
				unlocked_at: number | null; completed_at: number | null; promoted_at: number | null }, [number]>(
				'SELECT task_id, target_ms, player_ms, system_ms, unlocked_at, completed_at, promoted_at FROM expedition_tasks WHERE visit_id = ?'
			).all(visit.id);
			const task_progress = new Map(tasks.map(task => [task.task_id, task]));
			const personal = new Map(tracking_only ? [] : db.query<{ task_id: string; credited_ms: number }, [number, number]>(
				'SELECT task_id, COALESCE(SUM(credited_ms), 0) AS credited_ms FROM expedition_work_sessions WHERE visit_id = ? AND client_id = ? GROUP BY task_id'
			).all(visit.id, client_id).map(row => [row.task_id, row.credited_ms]));
			const trackers = new Map<string, { client_id: number; display_name: string; icon_id: string }[]>();
			for (const row of tracking_only ? [] : db.query<{ task_id: string; client_id: number; display_name: string; icon_id: string }, [number]>(
				'SELECT session.task_id, session.client_id, client.display_name, client.icon_id FROM expedition_work_sessions AS session JOIN clients AS client ON client.id = session.client_id WHERE session.visit_id = ? AND session.ended_at IS NULL'
			).all(visit.id)) {
				const list = trackers.get(row.task_id) ?? [];
				list.push({ client_id: row.client_id, display_name: row.display_name, icon_id: row.icon_id });
				trackers.set(row.task_id, list);
			}
			const ballot = db.query<{ exit_id: string }, [number, number]>(
				'SELECT exit_id FROM expedition_votes WHERE visit_id = ? AND client_id = ?'
			).get(visit.id, client_id)?.exit_id ?? null;
			chamber = { visit_id: visit.id, id: definition.id, label: definition.label, theme: definition.theme,
				depth: definition.depth, participant_count: visit.participant_count,
				preview_exit_id: content.preview_route?.[definition.id] ?? null,
				arrival_kind: visit.charted_on_arrival ? 'scout' : 'chart',
				vote: { opened_at: visit.vote_opened_at, deadline_at: visit.vote_deadline_at,
					locked_at: visit.vote_locked_at, chosen_exit_id: visit.chosen_exit_id, ballot },
			tasks: definition.tasks.filter(task => preview_task_available(content, definition, task)).flatMap(task => {
					const progress = task_progress.get(task.id);
					return progress ? [{ ...progress, title: task.title, phase: task.phase, kind: task.kind,
						requirement: task.requirement, depends_on: task.depends_on,
						evidence: task.evidence,
						...(task.exit_id ? { exit_id: task.exit_id } : {}),
						...(task.discovery_target ? { discovery_target: task.discovery_target } : {}),
						personal_ms: personal.get(task.id) ?? 0, trackers: trackers.get(task.id) ?? [] }] : [];
				}),
				exits: definition.exits.map(edge => ({ id: edge.id, slot: edge.slot,
					label: known.has(edge.target) ? chamber_names.get(edge.target) ?? edge.target : '???' })) };
		}
		// Keep the immediately preceding Guild run visible to its participants while back in the Rift.
		const previous = !tracking_only && (expedition.status === 'registration' ||
			expedition.status === 'active' && chamber?.id === 'entrance')
			? db.query<{ id: number }, [ExpeditionOwner, number]>(
				"SELECT id FROM expeditions WHERE guild_id IS ? AND id < ? AND status IN ('completed','inactive','dissolved') ORDER BY id DESC LIMIT 1"
			).get(guild_id, expedition.id) : null;
		const previous_summary = previous ? get_expedition_return_summary(db, client_id, previous.id) : null;
		const visited = new Set(history.map(visit => visit.chamber_id));
		if (typeof chamber?.id === 'string' && !chamber.preparation) visited.add(chamber.id);
		const journey_catalog = content.version >= 6 ? EXPEDITION_CONTENT_V6 : content.version >= 5 ? EXPEDITION_CONTENT_V5 :
			content.version >= 4 ? EXPEDITION_CONTENT_V4 : EXPEDITION_CONTENT_V3;
		const frontier = tracking_only ? [] : journey_catalog.chambers
			.filter(entry => visited.has(entry.id))
			.flatMap(entry => entry.exits.filter(edge => !visited.has(edge.target) && !revealed.has(edge.id))
				.map(edge => edge.id));

		return { contract_version: 1, content_version: expedition.content_version, server_now: now,
			expedition: { id: expedition.id, status: expedition.status, revision: expedition.revision,
				registered_at: expedition.registered_at, registration_ends_at: expedition.registration_ends_at,
				ended_at: expedition.ended_at, stash_outcome: db.query<{ outcome: string }, [number]>(
					'SELECT outcome FROM expedition_crucible_outcomes WHERE expedition_id = ?'
				).get(expedition.id)?.outcome ?? expedition.stash_outcome,
				registered_count, registered, chamber, history,
				...(!tracking_only ? { previous_return: previous_summary ? { expedition_id: previous!.id, ...previous_summary } : null } : {}),
				...(!tracking_only ? { journey: {
					supported_ids: [...new Set([...content.chambers.map(entry => entry.id), ...known])],
					// Older clients draw both kinds of passage from revealed.
					revealed: [...revealed, ...frontier],
					frontier
				} } : {}),
				return_summary: !tracking_only && ['completed', 'inactive', 'dissolved'].includes(expedition.status)
					? get_expedition_return_summary(db, client_id, expedition.id) : null } };
	}).immediate();
}
