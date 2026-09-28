import type { Database } from 'bun:sqlite';
import { db } from './db';
import { create_audit_lot, move_audit_value_with_fallback, record_audit_event } from './audit';
import type * as db_row from './db/types/db_types';
import { CRUCIBLE_GLOOP_ID, CRUCIBLE_PROGRESS_MAX, crucible_estimated_completion_at,
	crucible_gloop_quantity, crucible_heat, crucible_heat_value, crucible_stack_value,
	safe_crucible_add } from './crucible-values';

const MINUTE_MS = 60_000;
const WISH_DELIVERY_MS = 20 * 60 * MINUTE_MS;
const MAX_RECONCILIATION_TRANSITIONS = 1_024;

type Offering = db_row.crucible_offerings;
type Wish = db_row.crucible_wishes;

function offerings(guild_id: number, database: Database): Offering[] {
	return database.query<Offering, [number]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ? ORDER BY id').all(guild_id);
}

function active_wishes(guild_id: number, database: Database): Wish[] {
	return database.query<Wish, [number]>(
		'SELECT * FROM crucible_wishes WHERE guild_id = ? ORDER BY id').all(guild_id);
}

function heat_for_offerings(rows: Offering[]): { value: number; tier: number; points_per_minute: number } {
	const value = crucible_heat_value(rows);
	return { value, ...crucible_heat(value) };
}

function add_gloop(guild_id: number, quantity: number, now: number, database: Database): void {
	if (quantity <= 0) return;
	const prior = database.query<Offering, [number, string]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ? AND item_id = ?'
	).get(guild_id, CRUCIBLE_GLOOP_ID);
	if (prior !== null)
		database.query('UPDATE crucible_offerings SET qty = ? WHERE id = ?')
			.run(safe_crucible_add(prior.qty, quantity), prior.id);
	else
		database.query('INSERT INTO crucible_offerings (guild_id, item_id, qty, ' +
			'created_at, refreshed_at, is_untimed, valuation_source) VALUES (?, ?, ?, ?, ?, 1, ?)')
			.run(guild_id, CRUCIBLE_GLOOP_ID, quantity, now, now, 'server');
}

function mark_melded_wishes(guild_id: number, now: number, database: Database): void {
	database.query('UPDATE crucible_wishes SET melded_at = ?, auto_deliver_at = ? ' +
		'WHERE guild_id = ? AND melded_at IS NULL AND formation_points >= ? AND progress_gp >= required_gp')
		.run(now, safe_crucible_add(now, WISH_DELIVERY_MS), guild_id, CRUCIBLE_PROGRESS_MAX);
}

function distribute_once(guild_id: number, value: bigint, now: number, database: Database,
	filter: (wish: Wish) => boolean): bigint {
	let remaining = value;
	while (remaining > 0n) {
		const candidates = active_wishes(guild_id, database).filter(wish =>
			wish.formation_points >= CRUCIBLE_PROGRESS_MAX && wish.progress_gp < wish.required_gp && filter(wish));
		if (candidates.length === 0) break;
		const share = (remaining + BigInt(candidates.length - 1)) / BigInt(candidates.length);
		let granted = 0n;
		for (const wish of candidates) {
			const budget = remaining - granted;
			if (budget === 0n) break;
			const available = BigInt(wish.required_gp - wish.progress_gp);
			const amount = share < available ? share : available;
			const capped = amount < budget ? amount : budget;
			if (capped === 0n) continue;
			database.query('UPDATE crucible_wishes SET progress_gp = progress_gp + ? WHERE id = ?')
				.run(Number(capped), wish.id);
			granted += capped;
		}
		if (granted === 0n) break;
		remaining -= granted;
	}
	mark_melded_wishes(guild_id, now, database);
	return remaining;
}

export function distribute_crucible_value(guild_id: number, value: number, now: number,
	preferred_client_ids: ReadonlySet<number> = new Set(), database: Database = db): number {
	let remaining = BigInt(value);
	if (preferred_client_ids.size > 0)
		remaining = distribute_once(guild_id, remaining, now, database,
			wish => preferred_client_ids.has(wish.owner_client_id));
	remaining = distribute_once(guild_id, remaining, now, database,
		wish => !preferred_client_ids.has(wish.owner_client_id));
	return Number(remaining);
}

function meld_offering(row: Offering, now: number, database: Database): void {
	const contributor_ids = new Set(database.query<{ client_id: number }, [number]>(
		'SELECT DISTINCT client_id FROM crucible_contribution_lots WHERE offering_id = ?'
	).all(row.id).map(lot => lot.client_id));
	const value = crucible_stack_value(row.qty, row);
	const residual = distribute_crucible_value(row.guild_id, value, now, contributor_ids, database);
	const gloop_qty = crucible_gloop_quantity(residual);
	const event_id = record_audit_event({ event_type: 'crucible.offering_melded',
		source_key: `crucible-meld:${row.id}:${row.generation}`, actor: { kind: 'system' },
		guild_id: row.guild_id, occurred_at: now,
		values: [{ object_id: row.item_id, quantity: row.qty, direction: 'destroy' },
			...(gloop_qty > 0 ? [{ object_id: CRUCIBLE_GLOOP_ID, quantity: gloop_qty,
				direction: 'create' as const }] : [])],
		details: { value_gp_equivalent: value, residual_gp_equivalent: residual,
			value_currency_id: row.value_currency_id, value_per_item: row.value_per_item,
			valuation_source: row.valuation_source, offering_id: row.id } }, database);
	move_audit_value_with_fallback(event_id, row.item_id, row.qty, 'crucible',
		String(row.guild_id), null, null, database);
	if (gloop_qty > 0)
		create_audit_lot(event_id, CRUCIBLE_GLOOP_ID, gloop_qty, 'crucible', String(row.guild_id), database);
	database.query('DELETE FROM crucible_offerings WHERE id = ?').run(row.id);
	add_gloop(row.guild_id, gloop_qty, now, database);
}

function deliver_due_wishes(guild_id: number, now: number, database: Database): void {
	const due = database.query<Wish, [number, number]>(
		'SELECT * FROM crucible_wishes WHERE guild_id = ? AND auto_deliver_at <= ? ORDER BY id'
	).all(guild_id, now);
	for (const wish of due) {
		const event_id = record_audit_event({ event_type: 'crucible.wish_delivered',
			source_key: `crucible-wish-auto:${wish.id}`, actor: { kind: 'system' },
			guild_id, occurred_at: now, participants: [{ role: 'owner', client_id: wish.owner_client_id }],
			values: [{ object_id: wish.item_id, quantity: wish.qty, direction: 'create' }],
			details: { wish_id: wish.id, required_gp: wish.required_gp, progress_gp: wish.progress_gp }
		}, database);
		create_audit_lot(event_id, wish.item_id, wish.qty, 'inbox',
			`${wish.owner_client_id}:crucible:Wish Granted`, database);
		// Inbox is the durable recipient value boundary. The delete and insert share the caller transaction.
		database.query('INSERT INTO inbox_items (client_id, source_type, source_name, item_id, qty, created_at, updated_at) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id, source_type, source_name, item_id) ' +
			'DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at')
			.run(wish.owner_client_id, 'crucible', 'Wish Granted', wish.item_id, wish.qty, now, now);
		database.query('DELETE FROM crucible_wishes WHERE id = ?').run(wish.id);
	}
}

/** Reconciles completed UTC minute boundaries within the caller's write transaction. */
export function reconcile_crucible(guild_id: number, now = Date.now(), database: Database = db): number {
	const guild = database.query<db_row.crucible_guilds, [number]>(
		'SELECT * FROM crucible_guilds WHERE guild_id = ?').get(guild_id);
	if (guild === null) return 0;
	const target = Math.floor(now / MINUTE_MS);
	let cursor = guild.processed_minute;
	let transitions = 0;
	while (cursor < target && transitions < MAX_RECONCILIATION_TRANSITIONS) {
		const current_offerings = offerings(guild_id, database);
		const rate = heat_for_offerings(current_offerings).points_per_minute;
		const wishes = active_wishes(guild_id, database);
		const incomplete = [...current_offerings.filter(row => !row.is_untimed).map(row => row.meld_points),
			...wishes.filter(row => row.formation_points < CRUCIBLE_PROGRESS_MAX).map(row => row.formation_points)];
		const already_ready = current_offerings.some(row => !row.is_untimed &&
			row.meld_points >= CRUCIBLE_PROGRESS_MAX);
		const until_transition = already_ready ? 1 : rate === 0 || incomplete.length === 0 ? target - cursor
			: Math.max(1, Math.min(...incomplete.map(points =>
				Math.ceil((CRUCIBLE_PROGRESS_MAX - points) / rate))));
		const step = Math.min(target - cursor, until_transition);
		if (rate > 0) {
			const earned = step * rate;
			database.query('UPDATE crucible_wishes SET formation_points = MIN(?, formation_points + ?) ' +
				'WHERE guild_id = ? AND formation_points < ?')
				.run(CRUCIBLE_PROGRESS_MAX, earned, guild_id, CRUCIBLE_PROGRESS_MAX);
			database.query('UPDATE crucible_offerings SET meld_points = MIN(?, meld_points + ?) ' +
				'WHERE guild_id = ? AND is_untimed = 0 AND meld_points < ?')
				.run(CRUCIBLE_PROGRESS_MAX, earned, guild_id, CRUCIBLE_PROGRESS_MAX);
		}
		cursor += step;
		const boundary = cursor * MINUTE_MS;
		database.query('UPDATE crucible_wishes SET formed_at = ? WHERE guild_id = ? ' +
			'AND formation_points >= ? AND formed_at IS NULL')
			.run(boundary, guild_id, CRUCIBLE_PROGRESS_MAX);
		mark_melded_wishes(guild_id, boundary, database);
		const ready = database.query<Offering, [number, number]>(
			'SELECT * FROM crucible_offerings WHERE guild_id = ? AND is_untimed = 0 AND meld_points >= ? ORDER BY id'
		).all(guild_id, CRUCIBLE_PROGRESS_MAX);
		for (const row of ready) meld_offering(row, boundary, database);
		deliver_due_wishes(guild_id, boundary, database);
		transitions++;
	}
	if (cursor === target) deliver_due_wishes(guild_id, now, database);
	database.query('UPDATE crucible_guilds SET processed_minute = ? WHERE guild_id = ?')
		.run(cursor, guild_id);
	return cursor;
}

/** Advances a bounded set of lagging Guilds; repeated runs drain long recovery backlogs. */
export function maintain_crucibles(now = Date.now(), limit = 100, database: Database = db): number {
	const target = Math.floor(now / MINUTE_MS);
	const guilds = database.query<{ guild_id: number }, [number, number]>(
		'SELECT guild_id FROM crucible_guilds WHERE processed_minute < ? ' +
		'ORDER BY processed_minute, guild_id LIMIT ?'
	).all(target, limit);
	for (const guild of guilds)
		database.transaction(() => reconcile_crucible(guild.guild_id, now, database)).immediate();
	return guilds.length;
}

export function crucible_contents(guild_id: number, now = Date.now(), database: Database = db) {
	const guild = database.query<db_row.crucible_guilds, [number]>(
		'SELECT * FROM crucible_guilds WHERE guild_id = ?').get(guild_id);
	if (guild === null) return null;
	const rows = offerings(guild_id, database);
	const heat = heat_for_offerings(rows);
	const contribution_rows = database.query<{ offering_id: number; client_id: number; icon_id: string }, [number]>(
		'SELECT lot.offering_id, lot.client_id, client.icon_id FROM crucible_contribution_lots AS lot ' +
		'JOIN crucible_offerings AS offering ON offering.id = lot.offering_id ' +
		'JOIN clients AS client ON client.id = lot.client_id WHERE offering.guild_id = ? ' +
		'GROUP BY lot.offering_id, lot.client_id, client.icon_id ' +
		'ORDER BY lot.offering_id, SUM(lot.qty) DESC, MIN(lot.contributed_at), MIN(lot.id), lot.client_id'
	).all(guild_id);
	const contributors = new Map<number, Array<{ client_id: number; icon_id: string }>>();
	for (const row of contribution_rows) {
		const stack_contributors = contributors.get(row.offering_id) ?? [];
		if (stack_contributors.length >= 3) continue;
		stack_contributors.push({ client_id: row.client_id, icon_id: row.icon_id });
		contributors.set(row.offering_id, stack_contributors);
	}
	const wishes = database.query<Wish & { wisher: string; icon_id: string }, [number]>(
		'SELECT wish.*, owner.display_name AS wisher, owner.icon_id FROM crucible_wishes AS wish ' +
		'JOIN clients AS owner ON owner.id = wish.owner_client_id WHERE wish.guild_id = ? ORDER BY wish.id'
	).all(guild_id);
	return {
		is_open: guild.is_open === 1, heat, processed_minute: guild.processed_minute,
		offerings: rows.map(row => ({ id: row.id, item_id: row.item_id, qty: row.qty,
			meld_points: row.meld_points, meld_percent: Math.floor(row.meld_points * 100 / CRUCIBLE_PROGRESS_MAX),
			estimated_meld_at: row.is_untimed ? null : crucible_estimated_completion_at(row.meld_points,
				heat.points_per_minute, now), generation: row.generation, is_untimed: row.is_untimed === 1,
			contributors: contributors.get(row.id) ?? [] })),
		wishes: wishes.map(wish => ({ id: wish.id,
			owner_client_id: wish.owner_client_id, item_id: wish.item_id, qty: wish.qty,
			wisher: wish.wisher, contributors: [{ client_id: wish.owner_client_id, icon_id: wish.icon_id }],
			required_gp: wish.required_gp, progress_gp: wish.progress_gp,
			formation_points: wish.formation_points,
			phase: wish.formation_points < CRUCIBLE_PROGRESS_MAX ? 'forming'
				: wish.progress_gp < wish.required_gp ? 'melding' : 'melded',
			estimated_formation_at: crucible_estimated_completion_at(wish.formation_points,
				heat.points_per_minute, now), auto_deliver_at: wish.auto_deliver_at }))
	};
}
