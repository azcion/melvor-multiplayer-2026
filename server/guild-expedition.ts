import { db, get_service_setting } from './db';
import { EXPEDITION_CONTENT_PREVIEW, preview_task_available } from './expedition-content';
import type { ExpeditionChamber, ExpeditionContent } from './expedition-content';
import { RECENTLY_ACTIVE_AFTER } from './recent-activity';
import { CHARITY_NORMAL_DECAY_MS } from './charity-decay';
import { add_charity_contribution } from './charity-contributors';
import { createHash } from 'node:crypto';
import { update_unlocks } from './expedition-work';
import { transfer_expedition_stash_to_crucible } from './crucible-actions';

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

export function debug_advance_expedition(guild_id: number, expedition_id: number,
	visit_id: number | null, action: 'registration' | 'task' | 'vote', task_id: string | null,
	expire_charity: ExpireCharity, now = Date.now()): boolean {
	const changed = db.transaction(() => {
		const expedition = current_expedition(guild_id);
		if (!expedition || expedition.id !== expedition_id) return false;
		if (action === 'registration') {
			if (expedition.status !== 'registration' || visit_id !== null || task_id !== null) return false;
			if (recent_registered_participants(expedition, now) === 0) return false;
			db.query('UPDATE expeditions SET registration_ends_at = ? WHERE id = ?').run(now, expedition.id);
			advance_registration(guild_id, now);
			return true;
		}
		if (expedition.status !== 'active' || expedition.current_visit_id !== visit_id || visit_id === null) return false;
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
		if (!task || task.unlocked_at === null || task.completed_at !== null) return false;
		const content = JSON.parse(expedition.content_snapshot) as ExpeditionContent;
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
		if (definition.requirement !== 'required' && task.promoted_at === null && !discovered_exit) return false;
		db.query('UPDATE expedition_tasks SET system_ms = ?, completed_at = ? WHERE visit_id = ? AND task_id = ?')
			.run(Math.max(task.system_ms, task.target_ms - task.player_ms), now, visit_id, task_id);
		update_unlocks(expedition.id, visit_id, now);
		db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
		return true;
	}).immediate();
	if (changed) reconcile_expedition_visit(guild_id, expire_charity, now);
	return changed;
}

export function debug_cancel_expedition(guild_id: number, expedition_id: number,
	expire_charity: ExpireCharity, now = Date.now()): boolean {
	return db.transaction(() => {
		const expedition = current_expedition(guild_id);
		if (!expedition || expedition.id !== expedition_id) return false;
		dispose_stash(expedition, now, expire_charity);
		db.query("UPDATE expedition_work_sessions SET ended_at = MAX(started_at, ?), credited_ms = 0, guild_ms = 0, end_reason = 'cancelled' WHERE expedition_id = ? AND ended_at IS NULL")
			.run(now, expedition_id);
		db.query('UPDATE expedition_work_claims SET settled_at = MAX(started_at, ?), credited_ms = 0 WHERE expedition_id = ? AND settled_at IS NULL')
			.run(now, expedition_id);
		if (expedition.current_visit_id !== null)
			db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL')
				.run(now, expedition.current_visit_id);
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
		const other_guild_history = db.query<{ found: number }, [number, number]>(
			'SELECT 1 AS found FROM expedition_personal_records WHERE source_guild_id <> ? AND client_id IN (' +
			'SELECT registration.client_id FROM expedition_registrations AS registration ' +
			'JOIN expeditions AS expedition ON expedition.id = registration.expedition_id WHERE expedition.guild_id = ?) LIMIT 1'
		).get(guild_id, guild_id);
		if (other_guild_history) return null;
		for (const { id } of runs) {
			db.query('DELETE FROM expedition_work_claims WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_ep_ledger WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_personal_records WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_membership_tenures WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expedition_stash_disposals WHERE expedition_id = ?').run(id);
			db.query('DELETE FROM expeditions WHERE id = ?').run(id);
		}
		db.query('DELETE FROM expedition_charted WHERE guild_id = ?').run(guild_id);
		for (const { client_id } of clients) {
			const balance = db.query<{ points: number }, [number]>(
				'SELECT COALESCE(SUM(points_micros), 0) AS points FROM expedition_ep_ledger WHERE client_id = ?'
			).get(client_id)?.points ?? 0;
			db.query('DELETE FROM expedition_ep_balances WHERE client_id = ?').run(client_id);
			if (balance > 0) db.query('INSERT INTO expedition_ep_balances (client_id, points_micros) VALUES (?, ?)')
				.run(client_id, balance);
		}
		return runs.length;
	}).immediate();
}

type ExpeditionRow = {
	id: number;
	guild_id: number;
	status: 'registration' | 'active' | 'completed' | 'inactive' | 'dissolved';
	content_version: number;
	content_snapshot: string;
	registered_at: number;
	registration_ends_at: number;
	current_visit_id: number | null;
	last_qualifying_activity_at: number;
	ended_at: number | null;
	stash_outcome: 'pending' | 'empty' | 'charitree' | 'destroyed';
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

function current_expedition(guild_id: number): ExpeditionRow | null {
	return db.query<ExpeditionRow, [number]>(
		"SELECT * FROM expeditions WHERE guild_id = ? AND status IN ('registration', 'active') LIMIT 1"
	).get(guild_id);
}

type ExpireCharity = (now: number, guild_id: number) => number;

function dispose_stash(expedition: ExpeditionRow, now: number, expire_charity: ExpireCharity): void {
	const supplies = db.query<{
		item_id: string; qty: number; value_currency_id: string | null; value_per_item: number | null;
	}, [number]>('SELECT item_id, qty, value_currency_id, value_per_item FROM expedition_supplies WHERE expedition_id = ?')
		.all(expedition.id);
	if (supplies.length === 0) {
		db.query("UPDATE expeditions SET stash_outcome = 'empty' WHERE id = ? AND stash_outcome = 'pending'")
			.run(expedition.id);
		return;
	}
	if (get_service_setting('crucible_cutover') === '1') {
		const outcome = transfer_expedition_stash_to_crucible(expedition.guild_id, expedition.id, now);
		db.query('INSERT INTO expedition_crucible_outcomes ' +
			'(expedition_id, source_guild_id, outcome, disposed_at) VALUES (?, ?, ?, ?)')
			.run(expedition.id, expedition.guild_id, outcome, now);
		for (const supply of supplies)
			db.query('INSERT INTO expedition_crucible_disposals (expedition_id, item_id, qty) VALUES (?, ?, ?)')
				.run(expedition.id, supply.item_id, supply.qty);
		db.query('DELETE FROM expedition_supplies WHERE expedition_id = ?').run(expedition.id);
		// The legacy column cannot store the new outcome. The companion row is authoritative for 1.6 clients.
		db.query("UPDATE expeditions SET stash_outcome = 'empty' WHERE id = ? AND stash_outcome = 'pending'")
			.run(expedition.id);
		return;
	}
	const guild = db.query<{ charitree_enabled: number }, [number]>(
		'SELECT charitree_enabled FROM guilds WHERE id = ?'
	).get(expedition.guild_id);
	const outcome = guild?.charitree_enabled === 1 ? 'charitree' : 'destroyed';
	if (outcome === 'charitree') {
		expire_charity(now, expedition.guild_id);
		const clearing = db.query<{ cutoff: number | null }, [number]>(
			'SELECT MAX(charitree_expires_before) AS cutoff FROM guild_petitions ' +
			"WHERE guild_id = ? AND type = 'charitree_ingratitude' AND subject_locked = 1"
		).get(expedition.guild_id);
		const expires_at = Math.max(now + CHARITY_NORMAL_DECAY_MS, (clearing?.cutoff ?? -1) + 1);
		for (const supply of supplies) {
			const lots = db.query<{ client_id: number; owner_key: string; qty: number; contributed_at: number }, [number, string]>(
				'SELECT client_id, owner_key, qty, contributed_at FROM expedition_supply_lots ' +
				'WHERE expedition_id = ? AND item_id = ? ORDER BY contributed_at, id'
			).all(expedition.id, supply.item_id);
			if (lots.reduce((total, lot) => total + lot.qty, 0) !== supply.qty)
				throw new Error('Expedition stash provenance does not match held quantity');
			const existing = db.query<{ qty: number }, [number, string]>(
				'SELECT qty FROM charity_items WHERE guild_id = ? AND item_id = ?'
			).get(expedition.guild_id, supply.item_id);
			if (!Number.isSafeInteger((existing?.qty ?? 0) + supply.qty))
				throw new Error('Expedition stash exceeds safe Charitree quantity');
			db.query('INSERT INTO charity_items ' +
				'(guild_id, item_id, qty, expires_at, donated_at, value_currency_id, value_per_item) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, item_id) DO UPDATE SET ' +
				'qty = qty + excluded.qty, expires_at = excluded.expires_at, donated_at = excluded.donated_at, ' +
				'value_currency_id = CASE WHEN value_per_item IS NULL THEN excluded.value_currency_id ELSE value_currency_id END, ' +
				'value_per_item = COALESCE(value_per_item, excluded.value_per_item)')
				.run(expedition.guild_id, supply.item_id, supply.qty, expires_at, now,
					supply.value_currency_id, supply.value_per_item);
			for (const lot of lots) {
				add_charity_contribution(expedition.guild_id, supply.item_id, lot.client_id, lot.qty, now);
				db.query('INSERT INTO charity_currency_locks (guild_id, owner_key, currency_id, locked_until) ' +
					'VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, owner_key, currency_id) DO UPDATE SET ' +
					'locked_until = MAX(locked_until, excluded.locked_until)')
					.run(expedition.guild_id, lot.owner_key, supply.item_id, now + 24 * HOUR_MS);
			}
		}
	}
	for (const supply of supplies)
		db.query('INSERT INTO expedition_stash_disposals ' +
			'(expedition_id, source_guild_id, item_id, qty, outcome, disposed_at) VALUES (?, ?, ?, ?, ?, ?)')
			.run(expedition.id, expedition.guild_id, supply.item_id, supply.qty, outcome, now);
	db.query('DELETE FROM expedition_supplies WHERE expedition_id = ?').run(expedition.id);
	db.query('UPDATE expeditions SET stash_outcome = ? WHERE id = ? AND stash_outcome = \'pending\'')
		.run(outcome, expedition.id);
}

function end_if_inactive(expedition: ExpeditionRow, now: number, expire_charity: ExpireCharity): boolean {
	if (expedition.last_qualifying_activity_at > now - RECENTLY_ACTIVE_AFTER) return false;
	dispose_stash(expedition, now, expire_charity);
	const ended = db.query(
		"UPDATE expeditions SET status = 'inactive', ended_at = ?, current_visit_id = NULL, " +
		"revision = revision + 1 WHERE id = ? AND status IN ('registration', 'active') " +
		'AND last_qualifying_activity_at <= ?'
	).run(now, expedition.id, now - RECENTLY_ACTIVE_AFTER);
	if (ended.changes === 0) return false;
	if (expedition.current_visit_id !== null)
		db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL')
			.run(now, expedition.current_visit_id);
	return true;
}

// Called before the session guard writes last_multiplayer_active_at. A return after four
// days must not make the old Expedition appear active again.
export function catch_up_expedition_before_activity(client_id: number, expire_charity: ExpireCharity,
	now = Date.now()): void {
	db.transaction(() => {
		const membership = db.query<{ id: number; guild_id: number }, [number]>(
			'SELECT id, guild_id FROM guild_memberships WHERE client_id = ?'
		).get(client_id);
		if (!membership) return;
		const expedition = current_expedition(membership.guild_id);
		if (!expedition || end_if_inactive(expedition, now, expire_charity)) return;
		const registered = db.query<{ found: number }, [number, number]>(
			'SELECT 1 AS found FROM expedition_registrations WHERE expedition_id = ? AND client_id = ?'
		).get(expedition.id, client_id);
		if (registered) {
			db.query('INSERT INTO expedition_membership_tenures ' +
				'(expedition_id, source_guild_id, membership_id, client_id, started_at) ' +
				'VALUES (?, ?, ?, ?, ?) ON CONFLICT (expedition_id, membership_id) DO NOTHING')
				.run(expedition.id, membership.guild_id, membership.id, client_id, now);
			db.query('UPDATE expeditions SET last_qualifying_activity_at = ? WHERE id = ?')
				.run(now, expedition.id);
		}
	}).immediate();
}

export function maintain_inactive_expeditions(expire_charity: ExpireCharity, now = Date.now()): number {
	return db.transaction(() => {
		const overdue = db.query<ExpeditionRow, [number]>(
			"SELECT * FROM expeditions WHERE status IN ('registration', 'active') " +
			'AND last_qualifying_activity_at <= ?'
		).all(now - RECENTLY_ACTIVE_AFTER);
		let ended = 0;
		for (const expedition of overdue)
			if (end_if_inactive(expedition, now, expire_charity)) ended++;
		return ended;
	}).immediate();
}

function recent_registered_participants(expedition: ExpeditionRow, now: number): number {
	return db.query<{ count: number }, [number, number, number]>(
		'SELECT COUNT(*) AS count FROM expedition_registrations AS registration ' +
		'JOIN guild_memberships AS membership ON membership.client_id = registration.client_id ' +
		'JOIN clients AS client ON client.id = registration.client_id ' +
		'WHERE registration.expedition_id = ? AND membership.guild_id = ? ' +
		'AND client.last_multiplayer_active_at >= ?'
	).get(expedition.id, expedition.guild_id, now - RECENTLY_ACTIVE_AFTER)?.count ?? 0;
}

function begin_visit(expedition: ExpeditionRow, content: ExpeditionContent, chamber: ExpeditionChamber,
	participants: number, now: number): void {
	const charted = db.query<{ found: number }, [number, string]>(
		'SELECT 1 AS found FROM expedition_charted WHERE guild_id = ? AND chamber_id = ?'
	).get(expedition.guild_id, chamber.id) !== null;
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
		).run(inserted.id, task.id, scale_expedition_hours(task.baseline_hours, participants) * HOUR_MS, unlocked_at);
	}
	for (const edge of chamber.exits)
		db.query('INSERT INTO expedition_exits (visit_id, exit_id) VALUES (?, ?)').run(inserted.id, edge.id);
	db.query("UPDATE expeditions SET status = 'active', current_visit_id = ?, revision = revision + 1 WHERE id = ?")
		.run(inserted.id, expedition.id);
}

function advance_registration(guild_id: number, now: number): void {
	const expedition = current_expedition(guild_id);
	if (!expedition || expedition.status !== 'registration' || now < expedition.registration_ends_at) return;
	const participants = recent_registered_participants(expedition, now);
	if (participants === 0) return; // An empty Fellowship may gain a registrant before the inactivity deadline.
	const content = JSON.parse(expedition.content_snapshot) as ExpeditionContent;
	const entrance = content.chambers.find(chamber => chamber.id === 'entrance');
	if (!entrance) throw new Error('Expedition snapshot lacks Entrance');
	begin_visit(expedition, content, entrance, participants, now);
}

// The locked vote records its winner in chosen_exit_id. This reconciliation is safe to
// repeat on reads and settlements after restart: the old visit is closed before the next
// one is inserted in the same transaction.
export function reconcile_expedition_visit(guild_id: number, expire_charity: ExpireCharity,
	now = Date.now()): boolean {
	return db.transaction(() => {
		const expedition = current_expedition(guild_id);
		if (!expedition || expedition.status !== 'active' || expedition.current_visit_id === null) return false;
		if (end_if_inactive(expedition, now, expire_charity)) return true;
		const visit = db.query<{ id: number; chamber_id: string; charted_on_arrival: number;
			chosen_exit_id: string | null; vote_opened_at: number | null; vote_deadline_at: number | null;
			vote_locked_at: number | null; vote_full_shortened: number }, [number]>(
			'SELECT id, chamber_id, charted_on_arrival, chosen_exit_id, vote_opened_at, vote_deadline_at, vote_locked_at, vote_full_shortened FROM expedition_visits ' +
			'WHERE id = ? AND departed_at IS NULL'
		).get(expedition.current_visit_id);
		if (!visit) throw new Error('Current Expedition visit is missing');
		const content = JSON.parse(expedition.content_snapshot) as ExpeditionContent;
		const chamber = content.chambers.find(entry => entry.id === visit.chamber_id);
		if (!chamber) throw new Error('Current Chamber is missing from content snapshot');
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
		if (chart?.completed_at !== null && chart?.completed_at !== undefined)
			db.query('INSERT INTO expedition_charted (guild_id, chamber_id, completed_at) VALUES (?, ?, ?) ' +
				'ON CONFLICT (guild_id, chamber_id) DO NOTHING')
				.run(guild_id, chamber.id, chart.completed_at);
		const done = (task_id: string) => progress.get(task_id)?.completed_at != null;
		const arrival = visit.charted_on_arrival ? 'arrival_scout' : 'arrival_chart';
		if (chamber.type !== 'ending' && done(arrival) && visit.vote_opened_at === null) {
			db.query('UPDATE expedition_visits SET vote_opened_at = ? WHERE id = ? AND vote_opened_at IS NULL')
				.run(now, visit.id);
			db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition.id);
		}
		if (chamber.type !== 'ending' && visit.vote_locked_at === null &&
			((chamber.exits.length === 1 && done(arrival)) ||
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
			dispose_stash(expedition, now, expire_charity);
			db.query('UPDATE expedition_visits SET departed_at = ? WHERE id = ? AND departed_at IS NULL')
				.run(now, visit.id);
			db.query("UPDATE expeditions SET status = 'completed', ended_at = ?, current_visit_id = NULL, " +
				'revision = revision + 1 WHERE id = ?').run(now, expedition.id);
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

export function register_for_expedition(guild_id: number, client_id: number, operation_id: string, now = Date.now()): number | null {
	return db.transaction(() => {
		const member = db.query<{ id: number; guild_id: number }, [number, number]>(
			'SELECT id, guild_id FROM guild_memberships WHERE client_id = ? AND guild_id = ?'
		).get(client_id, guild_id);
		if (!member) throw new Error('Expedition registration requires current Guild membership');
		const replay = db.query<{ expedition_id: number; guild_id: number; kind: string }, [number, string]>(
			'SELECT operation.expedition_id, expedition.guild_id, operation.kind FROM expedition_operations AS operation ' +
			'JOIN expeditions AS expedition ON expedition.id = operation.expedition_id ' +
			'WHERE operation.client_id = ? AND operation.operation_id = ?'
		).get(client_id, operation_id);
		if (replay) return replay.guild_id === guild_id && replay.kind === 'register' ? replay.expedition_id : null;
		advance_registration(guild_id, now); // A late entrant cannot change the Entrance snapshot.
		let expedition = current_expedition(guild_id);
		if (!expedition) {
			const inserted = db.query<{ id: number }, [number, number, string, number, number, number]>(
				'INSERT INTO expeditions (guild_id, status, content_version, content_snapshot, registered_at, ' +
				'registration_ends_at, last_qualifying_activity_at) VALUES (?, \'registration\', ?, ?, ?, ?, ?) RETURNING id'
			).get(guild_id, EXPEDITION_CONTENT_PREVIEW.version, JSON.stringify(EXPEDITION_CONTENT_PREVIEW), now,
				now + EXPEDITION_REGISTRATION_MS, now);
			if (!inserted) throw new Error('Expedition registration was not created');
			expedition = current_expedition(guild_id);
		}
		if (!expedition) throw new Error('Expedition registration was not found');
		const result = db.query(
			'INSERT INTO expedition_registrations (expedition_id, client_id, registered_at) VALUES (?, ?, ?) ' +
			'ON CONFLICT (expedition_id, client_id) DO NOTHING'
		).run(expedition.id, client_id, now);
		if (result.changes > 0)
			db.query('INSERT INTO expedition_personal_records ' +
				'(expedition_id, client_id, source_guild_id, source_guild_name, registered_at, status) ' +
				'SELECT ?, ?, guild.id, guild.name, ?, expedition.status FROM guilds AS guild ' +
				'JOIN expeditions AS expedition ON expedition.guild_id = guild.id ' +
				'WHERE expedition.id = ?').run(expedition.id, client_id, now, expedition.id);
		db.query('INSERT INTO expedition_membership_tenures ' +
			'(expedition_id, source_guild_id, membership_id, client_id, started_at) ' +
			'VALUES (?, ?, ?, ?, ?) ON CONFLICT (expedition_id, membership_id) DO NOTHING')
			.run(expedition.id, guild_id, member.id, client_id, now);
		if (result.changes > 0)
			db.query('UPDATE expeditions SET revision = revision + 1, last_qualifying_activity_at = ? WHERE id = ?')
				.run(now, expedition.id);
		db.query('INSERT INTO expedition_operations (client_id, operation_id, kind, expedition_id, created_at) ' +
			'VALUES (?, ?, \'register\', ?, ?)').run(client_id, operation_id, expedition.id, now);
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
		const expedition = current_expedition(guild_id);
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
		const content = JSON.parse(expedition.content_snapshot) as ExpeditionContent;
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
		const ppc = db.query<{ count: number }, [number, number, number]>(
			'SELECT COUNT(*) AS count FROM expedition_interactions AS interaction ' +
			'JOIN guild_memberships AS membership ON membership.client_id = interaction.client_id ' +
			'WHERE interaction.visit_id = ? AND membership.guild_id = ? AND interaction.interacted_at >= ?'
		).get(visit_id, guild_id, now - PPC_MS)?.count ?? 0;
		const voter_active = db.query<{ found: number }, [number, number, number]>(
			'SELECT 1 AS found FROM expedition_interactions WHERE visit_id = ? AND client_id = ? AND interacted_at >= ?'
		).get(visit_id, client_id, now - PPC_MS);
		if (registered_count === 1) {
			deadline = Math.min(deadline, now + HOUR_MS);
			half = 1;
			full = 1;
		} else if (ppc > 0 && voter_active) {
			const ballots = db.query<{ count: number }, [number, number, number]>(
				'SELECT COUNT(*) AS count FROM expedition_votes AS vote JOIN expedition_interactions AS interaction ON interaction.visit_id = vote.visit_id AND interaction.client_id = vote.client_id JOIN guild_memberships AS membership ON membership.client_id = vote.client_id WHERE vote.visit_id = ? AND membership.guild_id = ? AND interaction.interacted_at >= ?'
			).get(visit_id, guild_id, now - PPC_MS)?.count ?? 0;
			if (!half && ballots * 2 >= ppc) { deadline = Math.min(deadline, now + 4 * HOUR_MS); half = 1; }
			if (!full && ballots >= ppc) { deadline = Math.min(deadline, now + HOUR_MS); full = 1; }
		}
		db.query('UPDATE expedition_visits SET vote_deadline_at = ?, vote_half_shortened = ?, vote_full_shortened = ? WHERE id = ?')
			.run(deadline, half, full, visit_id);
		db.query('UPDATE expeditions SET revision = revision + 1 WHERE id = ?').run(expedition_id);
		const response = { success: true, exit_id, vote_deadline_at: deadline, ppc };
		db.query('INSERT INTO expedition_work_operations (client_id, operation_id, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)')
			.run(client_id, operation_id, request_hash, JSON.stringify(response), now);
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

export function get_expedition_state(guild_id: number, client_id: number, now = Date.now()) {
	return db.transaction(() => {
		advance_registration(guild_id, now);
		const expedition = current_expedition(guild_id) ?? db.query<ExpeditionRow, [number]>(
			'SELECT * FROM expeditions WHERE guild_id = ? ORDER BY id DESC LIMIT 1'
		).get(guild_id);
		if (!expedition) return { contract_version: 1, content_version: EXPEDITION_CONTENT_PREVIEW.version,
			server_now: now, expedition: null };
		const registered = db.query<{ found: number }, [number, number]>(
			'SELECT 1 AS found FROM expedition_registrations WHERE expedition_id = ? AND client_id = ?'
		).get(expedition.id, client_id) !== null;
		const registered_count = db.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS count FROM expedition_registrations WHERE expedition_id = ?'
		).get(expedition.id)?.count ?? 0;
		const content = JSON.parse(expedition.content_snapshot) as ExpeditionContent;
		const chamber_names = new Map(content.chambers.map(entry => [entry.id, entry.label]));
		const history = db.query<{
			chamber_id: string; entered_at: number; departed_at: number | null; chosen_exit_id: string | null;
		}, [number]>(
			'SELECT chamber_id, entered_at, departed_at, chosen_exit_id FROM expedition_visits ' +
			'WHERE expedition_id = ? AND departed_at IS NOT NULL ORDER BY id'
		).all(expedition.id).map(visit => {
			const source = content.chambers.find(entry => entry.id === visit.chamber_id);
			const target = source?.exits.find(edge => edge.id === visit.chosen_exit_id)?.target;
			return { ...visit, label: chamber_names.get(visit.chamber_id) ?? visit.chamber_id,
				chosen_exit_label: target ? chamber_names.get(target) ?? target : null };
		});
		let chamber = null;
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
			const personal = new Map(db.query<{ task_id: string; credited_ms: number }, [number, number]>(
				'SELECT task_id, COALESCE(SUM(credited_ms), 0) AS credited_ms FROM expedition_work_sessions WHERE visit_id = ? AND client_id = ? GROUP BY task_id'
			).all(visit.id, client_id).map(row => [row.task_id, row.credited_ms]));
			const trackers = new Map<string, { client_id: number; display_name: string; icon_id: string }[]>();
			for (const row of db.query<{ task_id: string; client_id: number; display_name: string; icon_id: string }, [number]>(
				'SELECT session.task_id, session.client_id, client.display_name, client.icon_id FROM expedition_work_sessions AS session JOIN clients AS client ON client.id = session.client_id WHERE session.visit_id = ? AND session.ended_at IS NULL'
			).all(visit.id)) {
				const list = trackers.get(row.task_id) ?? [];
				list.push({ client_id: row.client_id, display_name: row.display_name, icon_id: row.icon_id });
				trackers.set(row.task_id, list);
			}
			const exits = db.query<{ exit_id: string; discovered_at: number | null }, [number]>(
				'SELECT exit_id, discovered_at FROM expedition_exits WHERE visit_id = ?'
			).all(visit.id);
			const discovered = new Set(exits.filter(exit => exit.discovered_at !== null).map(exit => exit.exit_id));
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
					label: discovered.has(edge.id) ? chamber_names.get(edge.target) ?? edge.target : '???' })) };
		}
		return { contract_version: 1, content_version: expedition.content_version, server_now: now,
			expedition: { id: expedition.id, status: expedition.status, revision: expedition.revision,
				registered_at: expedition.registered_at, registration_ends_at: expedition.registration_ends_at,
				ended_at: expedition.ended_at, stash_outcome: db.query<{ outcome: string }, [number]>(
					'SELECT outcome FROM expedition_crucible_outcomes WHERE expedition_id = ?'
				).get(expedition.id)?.outcome ?? expedition.stash_outcome,
				registered_count, registered, chamber, history } };
	}).immediate();
}
