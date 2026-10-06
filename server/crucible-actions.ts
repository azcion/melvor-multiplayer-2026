import { readFileSync } from 'node:fs';
import { db } from './db';
import { create_audit_lot, move_audit_value_with_fallback, record_audit_event } from './audit';
import type * as db_row from './db/types/db_types';
import type { JsonObject } from './http';
import { crucible_contents, distribute_crucible_value, reconcile_crucible } from './crucible-service';
import { CRUCIBLE_GLOOP_ID, CRUCIBLE_PROGRESS_MAX, crucible_heat_value, crucible_known_valuation,
	crucible_stack_value, safe_crucible_add, type CrucibleValuation } from './crucible-values';
import { CRUCIBLE_PET_ID, get_charity_pet_chance, grant_pet } from './pets';

const RECLAIM_COOLDOWN_MS = 20 * 60 * 60_000;
const CLEAR_LOCK_MS = 4 * 60 * 60_000;
const CLEAR_WINDOW_MS = 48 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const wish_catalog = new Map<string, number>();
for (const entry of JSON.parse(readFileSync(new URL('./openable-wish-values.json', import.meta.url), 'utf8')) as
	Array<{ id: string; max_item_value: number }>)
	wish_catalog.set(entry.id, entry.max_item_value);

export type CastItem = { id: string; qty: number; value_currency_id: string | null; value_per_item: number | null };
export type CrucibleActor = { client_id: number; guild_id: number; account_id: number | null; owner_key: string };

export function crucible_actor(client_id: number): CrucibleActor | null {
	const row = db.query<{ guild_id: number; melvor_account_id: number | null }, [number]>(
		'SELECT membership.guild_id, client.melvor_account_id FROM guild_memberships AS membership ' +
		'JOIN clients AS client ON client.id = membership.client_id WHERE membership.client_id = ?'
	).get(client_id);
	if (row === null) return null;
	return { client_id, guild_id: row.guild_id, account_id: row.melvor_account_id,
		owner_key: row.melvor_account_id === null ? `client:${client_id}` : `account:${row.melvor_account_id}` };
}

export function crucible_available(actor: CrucibleActor, now: number): boolean {
	if (!crucible_migration_complete()) return false;
	const state = db.query<db_row.crucible_guilds, [number]>(
		'SELECT * FROM crucible_guilds WHERE guild_id = ?').get(actor.guild_id);
	if (state === null) return false;
	reconcile_crucible(actor.guild_id, now);
	return db.query<{ processed_minute: number }, [number]>(
		'SELECT processed_minute FROM crucible_guilds WHERE guild_id = ?'
	).get(actor.guild_id)!.processed_minute >= Math.floor(now / 60_000);
}

function crucible_migration_complete(): boolean {
	return db.query('SELECT 1 FROM crucible_migration WHERE id = 1 AND completed_at IS NOT NULL').get() !== null;
}

function is_open(guild_id: number): boolean {
	return db.query<{ is_open: number }, [number]>(
		'SELECT is_open FROM crucible_guilds WHERE guild_id = ?').get(guild_id)?.is_open === 1;
}

export function add_crucible_offering(guild_id: number, item: CastItem, now: number,
	source_kind: 'cast' | 'clear' | 'expedition', source_id: string,
	client_id: number | null = null, locked_until: number | null = null): number {
	const previous = db.query<db_row.crucible_offerings, [number, string]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ? AND item_id = ?'
	).get(guild_id, item.id);
	const known = crucible_known_valuation(item.id);
	const valuation: CrucibleValuation = known ?? { value_currency_id: item.value_currency_id,
		value_per_item: item.value_per_item };
	let id: number;
	if (previous === null) {
		id = db.query<{ id: number }, [number, string, number, string | null, number | null,
			number, number, number, string]>(
			'INSERT INTO crucible_offerings (guild_id, item_id, qty, value_currency_id, value_per_item, ' +
			'created_at, refreshed_at, is_untimed, valuation_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
		).get(guild_id, item.id, item.qty, valuation.value_currency_id, valuation.value_per_item,
			now, now, item.id === CRUCIBLE_GLOOP_ID ? 1 : 0, known === null ? 'client' : 'server')!.id;
	} else {
		id = previous.id;
		const sticky = previous.value_per_item === null ? valuation : previous;
		db.query('UPDATE crucible_offerings SET qty = ?, value_currency_id = ?, value_per_item = ?, ' +
			'meld_points = 0, generation = generation + 1, refreshed_at = ?, valuation_source = ? WHERE id = ?')
			.run(safe_crucible_add(previous.qty, item.qty), sticky.value_currency_id,
				sticky.value_per_item, now, previous.value_per_item === null && known !== null ? 'server'
					: previous.valuation_source, id);
	}
	if (client_id !== null && item.id !== CRUCIBLE_GLOOP_ID)
		db.query('INSERT INTO crucible_contribution_lots ' +
			'(offering_id, client_id, qty, contributed_at, source_kind, source_id, locked_until) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?)')
			.run(id, client_id, item.qty, now, source_kind, source_id, locked_until);
	return id;
}

export function transfer_expedition_stash_to_crucible(guild_id: number, expedition_id: number,
	now = Date.now()): 'crucible' | 'destroyed' {
	if (!crucible_migration_complete()) throw new Error('Crucible snapshot migration is incomplete');
	const state = db.query<{ is_open: number; processed_minute: number }, [number]>(
		'SELECT is_open, processed_minute FROM crucible_guilds WHERE guild_id = ?').get(guild_id);
	if (state === null) throw new Error('Crucible Guild state is missing');
	reconcile_crucible(guild_id, now);
	if (db.query<{ processed_minute: number }, [number]>(
		'SELECT processed_minute FROM crucible_guilds WHERE guild_id = ?'
	).get(guild_id)!.processed_minute < Math.floor(now / 60_000))
		throw new Error('Crucible must catch up before Expedition disposal');
	const outcome = state.is_open === 1 ? 'crucible' : 'destroyed';
	const supplies = db.query<{ item_id: string; qty: number; value_currency_id: string | null;
		value_per_item: number | null }, [number]>(
		'SELECT item_id, qty, value_currency_id, value_per_item FROM expedition_supplies WHERE expedition_id = ?'
	).all(expedition_id);
	for (const supply of supplies) {
		const lots = db.query<{ id: number; client_id: number; qty: number }, [number, string]>(
			'SELECT id, client_id, qty FROM expedition_supply_lots WHERE expedition_id = ? AND item_id = ? ' +
			'ORDER BY contributed_at, id'
		).all(expedition_id, supply.item_id);
		if (lots.reduce((sum, lot) => safe_crucible_add(sum, lot.qty), 0) !== supply.qty)
			throw new Error('Expedition stash provenance does not match held quantity');
		if (outcome === 'crucible')
			for (const lot of lots)
				add_crucible_offering(guild_id, { id: supply.item_id, qty: lot.qty,
					value_currency_id: supply.value_currency_id, value_per_item: supply.value_per_item }, now,
					'expedition', `expedition:${expedition_id}:lot:${lot.id}`, lot.client_id,
					now + 24 * 60 * 60_000);
	}
	const transfer_event = record_audit_event({ event_type: outcome === 'crucible'
		? 'crucible.expedition_transferred' : 'crucible.expedition_destroyed',
		source_key: `crucible-expedition:${expedition_id}`, actor: { kind: 'system' },
		guild_id, occurred_at: now, values: supplies.map(supply => ({ object_id: supply.item_id,
			quantity: supply.qty, direction: outcome === 'crucible' ? 'in' as const : 'destroy' as const })),
		details: { expedition_id, outcome } });
	if (outcome === 'crucible')
		for (const supply of supplies)
			create_audit_lot(transfer_event, supply.item_id, supply.qty, 'crucible', String(guild_id));
	crucible_heat_value(db.query<db_row.crucible_offerings, [number]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ?').all(guild_id));
	return outcome;
}

export function cast_crucible_items(actor: CrucibleActor, items: CastItem[], source_id: string,
	now = Date.now(), donation_value = 0): JsonObject {
	if (!crucible_available(actor, now)) return { success: false, error: 'Crucible is catching up.' };
	if (!is_open(actor.guild_id)) return { success: false, error: 'Crucible is sealed.' };
	for (const item of items)
		add_crucible_offering(actor.guild_id, item, now, 'cast', `${source_id}:${item.id}`, actor.client_id);
	const cast_event = record_audit_event({ event_type: 'crucible.cast',
		source_key: `crucible-cast:${actor.client_id}:${source_id}`, command_id: source_id,
		actor: { kind: 'client', client_id: actor.client_id }, guild_id: actor.guild_id, occurred_at: now,
		values: items.map(item => ({ object_id: item.id, quantity: item.qty, direction: 'move' })),
		details: { donation_value } });
	for (const item of items)
		move_audit_value_with_fallback(cast_event, item.id, item.qty, 'client', String(actor.client_id),
			'crucible', String(actor.guild_id));
	crucible_heat_value(db.query<db_row.crucible_offerings, [number]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ?').all(actor.guild_id));
	const pet_granted = Math.random() < get_charity_pet_chance(donation_value) &&
		grant_pet(actor.client_id, CRUCIBLE_PET_ID, now);
	return { success: true, ...(pet_granted ? { pet_id: CRUCIBLE_PET_ID } : {}) };
}

function consume_lots(offering: db_row.crucible_offerings, qty: number): Array<{ client_id: number; qty: number }> {
	const lots = db.query<db_row.crucible_contribution_lots, [number]>(
		'SELECT * FROM crucible_contribution_lots WHERE offering_id = ? ORDER BY contributed_at, id'
	).all(offering.id);
	const attributed = lots.reduce((sum, lot) => safe_crucible_add(sum, lot.qty), 0);
	let remaining = Math.max(0, qty - Math.max(0, offering.qty - attributed));
	const consumed: Array<{ client_id: number; qty: number }> = [];
	for (const lot of lots) {
		if (remaining === 0) break;
		const amount = Math.min(remaining, lot.qty);
		if (amount === lot.qty) db.query('DELETE FROM crucible_contribution_lots WHERE id = ?').run(lot.id);
		else db.query('UPDATE crucible_contribution_lots SET qty = qty - ? WHERE id = ?').run(amount, lot.id);
		consumed.push({ client_id: lot.client_id, qty: amount });
		remaining -= amount;
	}
	return consumed;
}

function bonus_from_reclaim(actor: CrucibleActor, offering: db_row.crucible_offerings,
	consumed: Array<{ client_id: number; qty: number }>, now: number): number {
	const unit = crucible_stack_value(1, offering);
	let gloop_qty = 0;
	for (const lot of consumed) {
		const contributor = db.query<{ melvor_account_id: number | null }, [number]>(
			'SELECT melvor_account_id FROM clients WHERE id = ?').get(lot.client_id);
		if (contributor?.melvor_account_id === null || contributor?.melvor_account_id === undefined ||
			contributor.melvor_account_id === actor.account_id) continue;
		const wish = db.query<db_row.crucible_wishes, [number, number]>(
			'SELECT * FROM crucible_wishes WHERE guild_id = ? AND melvor_account_id = ?'
		).get(actor.guild_id, contributor.melvor_account_id);
		if (wish === null) continue;
		const raw = BigInt(lot.qty) * BigInt(unit) * 10n;
		const missing = BigInt(wish.required_gp - wish.progress_gp);
		const directed = raw < missing ? raw : missing;
		if (directed > 0n)
			db.query('UPDATE crucible_wishes SET progress_gp = progress_gp + ? WHERE id = ?')
				.run(Number(directed), wish.id);
		const overflow = raw - directed;
		if (overflow > 0n) {
			if (overflow > BigInt(Number.MAX_SAFE_INTEGER))
				throw new RangeError('Reclaim bonus exceeds safe integer range');
			const residual = distribute_crucible_value(actor.guild_id, Number(overflow), now,
				new Set([lot.client_id]));
			if (residual > 0)
				gloop_qty = safe_crucible_add(gloop_qty, Math.ceil(residual / 1_000));
		}
	}
	return gloop_qty;
}

function add_crucible_gloop(guild_id: number, qty: number, now: number): void {
	if (qty <= 0) return;
	const prior = db.query<db_row.crucible_offerings, [number, string]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ? AND item_id = ?'
	).get(guild_id, CRUCIBLE_GLOOP_ID);
	if (prior !== null)
		db.query('UPDATE crucible_offerings SET qty = ? WHERE id = ?').run(safe_crucible_add(prior.qty, qty), prior.id);
	else
		db.query('INSERT INTO crucible_offerings (guild_id, item_id, qty, created_at, refreshed_at, ' +
			'is_untimed, valuation_source) VALUES (?, ?, ?, ?, ?, 1, ?)')
			.run(guild_id, CRUCIBLE_GLOOP_ID, qty, now, now, 'server');
}

export function reclaim_crucible_offering(actor: CrucibleActor, item_id: string, qty: number,
	now = Date.now(), source_id: string = crypto.randomUUID()): JsonObject {
	if (!crucible_available(actor, now)) return { success: false, error: 'Crucible is catching up.' };
	if (!is_open(actor.guild_id)) return { success: false, error: 'Crucible is sealed.' };
	const membership = db.query<{ charitree_take_available_at: number }, [number]>(
		'SELECT charitree_take_available_at FROM guild_memberships WHERE client_id = ?').get(actor.client_id);
	if (membership !== null && membership.charitree_take_available_at > now)
		return { success: false, error: 'Guild join lock is active.', available_at: membership.charitree_take_available_at };
	const last = db.query<{ last_reclaimed_at: number }, [number]>(
		'SELECT last_reclaimed_at FROM crucible_reclaim_state WHERE client_id = ?').get(actor.client_id)?.last_reclaimed_at;
	if (last !== undefined && last + RECLAIM_COOLDOWN_MS > now)
		return { success: false, error: 'Reclaim cooldown is active.', available_at: last + RECLAIM_COOLDOWN_MS };
	const lock = db.query<{ locked_until: number }, [number, string, string]>(
		'SELECT locked_until FROM crucible_currency_locks WHERE guild_id = ? AND owner_key = ? AND currency_id = ?'
	).get(actor.guild_id, actor.owner_key, item_id);
	if (lock !== null && lock.locked_until > now)
		return { success: false, error: 'Paid currency lock is active.', available_at: lock.locked_until };
	const offering = db.query<db_row.crucible_offerings, [number, string]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ? AND item_id = ?'
	).get(actor.guild_id, item_id);
	if (offering === null || qty > offering.qty)
		return { success: false, error: 'Offering is unavailable.' };
	const expedition_lock = db.query<{ locked_until: number }, [number, string, number, number, number, number]>(
		'SELECT lot.locked_until FROM crucible_contribution_lots AS lot JOIN clients AS client ' +
		'ON client.id = lot.client_id WHERE lot.offering_id = ? AND lot.source_kind = ? ' +
		'AND (lot.client_id = ? OR (? > 0 AND client.melvor_account_id = ?)) ' +
		'AND lot.locked_until > ? LIMIT 1'
	).get(offering.id, 'expedition', actor.client_id,
		actor.account_id ?? 0, actor.account_id ?? 0, now);
	if (expedition_lock !== null)
		return { success: false, error: 'Expedition supply lock is active.', available_at: expedition_lock.locked_until };
	const consumed = consume_lots(offering, qty);
	const bonus_gloop = bonus_from_reclaim(actor, offering, consumed, now);
	if (qty === offering.qty)
		db.query('DELETE FROM crucible_offerings WHERE id = ?').run(offering.id);
	else
		db.query('UPDATE crucible_offerings SET qty = qty - ?, meld_points = 0, ' +
			'generation = generation + 1, refreshed_at = ? WHERE id = ?').run(qty, now, offering.id);
	db.query('INSERT INTO crucible_reclaim_state (client_id, last_reclaimed_at) VALUES (?, ?) ' +
		'ON CONFLICT (client_id) DO UPDATE SET last_reclaimed_at = excluded.last_reclaimed_at')
		.run(actor.client_id, now);
	db.query('INSERT INTO inbox_items (client_id, source_type, source_name, item_id, qty, created_at, updated_at) ' +
		'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id, source_type, source_name, item_id) ' +
		'DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at')
		.run(actor.client_id, 'crucible', '', item_id, qty, now, now);
	const reclaim_event = record_audit_event({ event_type: 'crucible.reclaimed',
		source_key: `crucible-reclaim:${actor.client_id}:${source_id}`, command_id: source_id,
		actor: { kind: 'client', client_id: actor.client_id }, guild_id: actor.guild_id, occurred_at: now,
		values: [{ object_id: item_id, quantity: qty, direction: 'move' },
			...(bonus_gloop > 0 ? [{ object_id: CRUCIBLE_GLOOP_ID, quantity: bonus_gloop,
				direction: 'create' as const }] : [])],
		details: { remaining_qty: offering.qty - qty } });
	move_audit_value_with_fallback(reclaim_event, item_id, qty, 'crucible', String(actor.guild_id),
		'inbox', `${actor.client_id}:crucible:`);
	if (bonus_gloop > 0) {
		create_audit_lot(reclaim_event, CRUCIBLE_GLOOP_ID, bonus_gloop, 'crucible', String(actor.guild_id));
		add_crucible_gloop(actor.guild_id, bonus_gloop, now);
	}
	return { success: true, item_qty: qty, remaining_qty: offering.qty - qty,
		next_reclaim_at: now + RECLAIM_COOLDOWN_MS };
}

export function crucible_clear_state(actor: CrucibleActor, now = Date.now()): {
	level: number; active_wish: boolean; clear_count: number; next_reclaim_at: number | null;
} {
	const active_wish = actor.account_id !== null && db.query(
		'SELECT 1 FROM crucible_wishes WHERE guild_id = ? AND melvor_account_id = ?'
	).get(actor.guild_id, actor.account_id) !== null;
	const reset = db.query<{ reset_at: number }, [number, string]>(
		'SELECT reset_at FROM crucible_visibility_resets WHERE guild_id = ? AND owner_key = ?'
	).get(actor.guild_id, actor.owner_key)?.reset_at;
	const floor = active_wish || (reset !== undefined && reset + CLEAR_WINDOW_MS > now) ? -10 : 0;
	const count = db.query<{ count: number }, [number, string, number]>(
		'SELECT COUNT(*) AS count FROM crucible_clear_events WHERE guild_id = ? AND owner_key = ? AND expires_at > ?'
	).get(actor.guild_id, actor.owner_key, now)?.count ?? 0;
	const last = db.query<{ last_reclaimed_at: number }, [number]>(
		'SELECT last_reclaimed_at FROM crucible_reclaim_state WHERE client_id = ?').get(actor.client_id)?.last_reclaimed_at;
	return { level: Math.min(active_wish ? 10 : 20, floor + count), active_wish, clear_count: count,
		next_reclaim_at: last === undefined ? null : last + RECLAIM_COOLDOWN_MS };
}

export function clear_crucible_slag(actor: CrucibleActor, offers: Array<{ currency_id: string; qty: number }>,
	source_id: string, now = Date.now()): JsonObject {
	if (!crucible_available(actor, now)) return { success: false, error: 'Crucible is catching up.' };
	if (!is_open(actor.guild_id)) return { success: false, error: 'Crucible is sealed.' };
	const current = crucible_clear_state(actor, now);
	if (current.level + offers.length > (current.active_wish ? 10 : 20))
		return { success: false, error: 'Maximum Slag clearing level changed.' };
	for (let index = 0; index < offers.length; index++) {
		const offer = offers[index]!;
		add_crucible_offering(actor.guild_id, { id: offer.currency_id, qty: offer.qty,
			value_currency_id: offer.currency_id, value_per_item: 1 }, now,
			'clear', `${source_id}:${index}`, actor.client_id);
		db.query('INSERT INTO crucible_clear_events (guild_id, owner_key, cleared_at, expires_at) VALUES (?, ?, ?, ?)')
			.run(actor.guild_id, actor.owner_key, now, now + CLEAR_WINDOW_MS);
		db.query('INSERT INTO crucible_currency_locks (guild_id, owner_key, currency_id, locked_until) ' +
			'VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, owner_key, currency_id) DO UPDATE ' +
			'SET locked_until = excluded.locked_until')
			.run(actor.guild_id, actor.owner_key, offer.currency_id, now + CLEAR_LOCK_MS);
	}
	const totals = new Map<string, number>();
	for (const offer of offers)
		totals.set(offer.currency_id, safe_crucible_add(totals.get(offer.currency_id) ?? 0, offer.qty));
	const clear_event = record_audit_event({ event_type: 'crucible.slag_cleared',
		source_key: `crucible-clear:${actor.client_id}:${source_id}`, command_id: source_id,
		actor: { kind: 'client', client_id: actor.client_id }, guild_id: actor.guild_id, occurred_at: now,
		values: [...totals].map(([object_id, quantity]) => ({ object_id, quantity, direction: 'move' })),
		details: { clear_count: offers.length } });
	for (const [currency_id, qty] of totals)
		move_audit_value_with_fallback(clear_event, currency_id, qty, 'client', String(actor.client_id),
			'crucible', String(actor.guild_id));
	crucible_heat_value(db.query<db_row.crucible_offerings, [number]>(
		'SELECT * FROM crucible_offerings WHERE guild_id = ?').all(actor.guild_id));
	const pet_granted = offers.some(offer => Math.random() < get_charity_pet_chance(offer.qty)) &&
		grant_pet(actor.client_id, CRUCIBLE_PET_ID, now);
	return { success: true, ...crucible_clear_state(actor, now),
		...(pet_granted ? { pet_id: CRUCIBLE_PET_ID } : {}) };
}

export function run_crucible_wish_command(client_id: number, command_id: unknown, kind: string,
	operation: () => JsonObject): JsonObject | null {
	if (typeof command_id !== 'string' || !UUID.test(command_id)) return null;
	const transact = db.transaction(() => {
		const prior = db.query<{ kind: string; response_json: string }, [string, number]>(
			'SELECT kind, response_json FROM crucible_commands WHERE id = ? AND client_id = ?'
		).get(command_id, client_id);
		if (prior !== null) return prior.kind === kind ? JSON.parse(prior.response_json) as JsonObject : null;
		const response = operation();
		if (response.success === true)
			db.query('INSERT INTO crucible_commands (id, client_id, kind, response_json, created_at) ' +
				'VALUES (?, ?, ?, ?, ?)').run(command_id, client_id, kind, JSON.stringify(response), Date.now());
		return response;
	});
	return transact.immediate();
}

export function make_crucible_wish(actor: CrucibleActor, item_id: string, qty: number,
	now = Date.now()): JsonObject {
	if (!crucible_available(actor, now)) return { success: false, error: 'Crucible is catching up.' };
	if (!is_open(actor.guild_id)) return { success: false, error: 'Crucible is sealed.' };
	if (actor.account_id === null) return { success: false, error: 'Melvor account is required.' };
	if (db.query('SELECT 1 FROM crucible_wishes WHERE guild_id = ? AND melvor_account_id = ?')
		.get(actor.guild_id, actor.account_id) !== null)
		return { success: false, error: 'An active Wish already exists.' };
	const max_value = wish_catalog.get(item_id);
	if (max_value === undefined) return { success: false, error: 'Wish item is unavailable.' };
	const required = max_value * qty * 5;
	if (!Number.isSafeInteger(required)) return { success: false, error: 'Wish value is too large.' };
	db.query('DELETE FROM crucible_clear_events WHERE guild_id = ? AND owner_key = ?').run(actor.guild_id, actor.owner_key);
	db.query('INSERT INTO crucible_visibility_resets (guild_id, owner_key, reset_at) VALUES (?, ?, ?) ' +
		'ON CONFLICT (guild_id, owner_key) DO UPDATE SET reset_at = excluded.reset_at').run(actor.guild_id, actor.owner_key, now);
	const wish = db.query<{ id: number }, [number, number, number, string, number, number, number]>(
		'INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
		'required_gp, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id'
	).get(actor.guild_id, actor.client_id, actor.account_id, item_id, qty, required, now)!;
	record_audit_event({ event_type: 'crucible.wish_made', source_key: `crucible-wish-make:${wish.id}`,
		actor: { kind: 'client', client_id: actor.client_id }, guild_id: actor.guild_id, occurred_at: now,
		details: { wish_id: wish.id, item_id, qty, required_gp: required } });
	return { success: true, wish_id: wish.id };
}

export function cancel_crucible_wish(actor: CrucibleActor, now = Date.now()): JsonObject {
	if (!crucible_available(actor, now)) return { success: false, error: 'Crucible is catching up.' };
	const wish = db.query<db_row.crucible_wishes, [number]>(
		'SELECT * FROM crucible_wishes WHERE owner_client_id = ?').get(actor.client_id);
	if (wish === null) return { success: false, error: 'Wish is missing.' };
	if (wish.formation_points >= CRUCIBLE_PROGRESS_MAX)
		return { success: false, error: 'Formed Wish cannot be canceled.' };
	db.query('DELETE FROM crucible_wishes WHERE id = ?').run(wish.id);
	const residual = distribute_crucible_value(wish.guild_id, wish.progress_gp, now,
		new Set([wish.owner_client_id]));
	const gloop_qty = residual > 0 ? Math.ceil(residual / 1_000) : 0;
	const event = record_audit_event({ event_type: 'crucible.wish_cancelled',
		source_key: `crucible-wish-cancel:${wish.id}`,
		actor: { kind: 'client', client_id: actor.client_id }, guild_id: actor.guild_id, occurred_at: now,
		values: gloop_qty > 0 ? [{ object_id: CRUCIBLE_GLOOP_ID, quantity: gloop_qty,
			direction: 'create' }] : [],
		details: { wish_id: wish.id, progress_gp: wish.progress_gp, formation_points: wish.formation_points } });
	if (gloop_qty > 0) {
		create_audit_lot(event, CRUCIBLE_GLOOP_ID, gloop_qty, 'crucible', String(wish.guild_id));
		add_crucible_gloop(wish.guild_id, gloop_qty, now);
	}
	return { success: true };
}

export function claim_crucible_wish(actor: CrucibleActor, now = Date.now()): JsonObject {
	if (!crucible_available(actor, now)) return { success: false, error: 'Crucible is catching up.' };
	const wish = db.query<db_row.crucible_wishes, [number]>(
		'SELECT * FROM crucible_wishes WHERE owner_client_id = ?').get(actor.client_id);
	if (wish === null) return { success: false, error: 'Wish is missing.' };
	if (wish.formation_points < CRUCIBLE_PROGRESS_MAX || wish.progress_gp < wish.required_gp)
		return { success: false, error: 'Wish is not Melded.' };
	db.query('INSERT INTO inbox_items (client_id, source_type, source_name, item_id, qty, created_at, updated_at) ' +
		'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id, source_type, source_name, item_id) ' +
		'DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at')
		.run(actor.client_id, 'crucible', 'Wish Granted', wish.item_id, wish.qty, now, now);
	db.query('DELETE FROM crucible_wishes WHERE id = ?').run(wish.id);
	const wish_event = record_audit_event({ event_type: 'crucible.wish_claimed',
		source_key: `crucible-wish-claim:${wish.id}`, actor: { kind: 'client', client_id: actor.client_id },
		guild_id: actor.guild_id, occurred_at: now,
		values: [{ object_id: wish.item_id, quantity: wish.qty, direction: 'create' }],
		details: { wish_id: wish.id, required_gp: wish.required_gp, progress_gp: wish.progress_gp } });
	create_audit_lot(wish_event, wish.item_id, wish.qty, 'inbox',
		`${actor.client_id}:crucible:Wish Granted`);
	return { success: true };
}

export function get_crucible_state(actor: CrucibleActor, now = Date.now()) {
	if (!crucible_migration_complete()) return { enabled: false };
	const reconcile = db.transaction(() => {
		reconcile_crucible(actor.guild_id, now);
		const contents = crucible_contents(actor.guild_id, now);
		if (contents === null) return { enabled: false };
		const currency_locks = db.query<{ currency_id: string; locked_until: number }, [number, string, number]>(
			'SELECT currency_id, locked_until FROM crucible_currency_locks ' +
			'WHERE guild_id = ? AND owner_key = ? AND locked_until > ?'
		).all(actor.guild_id, actor.owner_key, now);
		const expedition_locks = db.query<{ item_id: string; locked_until: number }, [number, number, number, number]>(
			'SELECT offering.item_id, MAX(lot.locked_until) AS locked_until ' +
			'FROM crucible_contribution_lots AS lot JOIN crucible_offerings AS offering ON offering.id = lot.offering_id ' +
			'JOIN clients AS owner ON owner.id = lot.client_id WHERE offering.guild_id = ? ' +
			"AND lot.source_kind = 'expedition' AND lot.locked_until > ? " +
			'AND (lot.client_id = ? OR (owner.melvor_account_id IS NOT NULL AND owner.melvor_account_id = ?)) ' +
			'GROUP BY offering.item_id'
		).all(actor.guild_id, now, actor.client_id, actor.account_id ?? -1);
		const join_lock = db.query<{ charitree_take_available_at: number }, [number]>(
			'SELECT charitree_take_available_at FROM guild_memberships WHERE client_id = ?'
		).get(actor.client_id)?.charitree_take_available_at ?? 0;
		return { enabled: true, ...contents, ...crucible_clear_state(actor, now), server_now: now,
			join_lock_until: join_lock, currency_locks, expedition_locks,
			offerings: contents.offerings.map(row => ({ ...row,
				blocked_until: Math.max(join_lock, ...currency_locks.filter(lock => lock.currency_id === row.item_id)
					.map(lock => lock.locked_until), ...expedition_locks.filter(lock => lock.item_id === row.item_id)
					.map(lock => lock.locked_until), 0) })),
			wishes: contents.wishes.map(wish => ({ ...wish, owned: wish.owner_client_id === actor.client_id })),
			wish_catalog: [...wish_catalog].map(([id, max_item_value]) => ({ id, max_item_value })) };
	});
	return reconcile.immediate();
}
