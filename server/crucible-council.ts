import type { Database } from 'bun:sqlite';
import { db } from './db';
import { create_audit_lot, move_audit_value_with_fallback, record_audit_event } from './audit';
import type * as db_row from './db/types/db_types';
import { distribute_crucible_value, reconcile_crucible } from './crucible-service';
import { CRUCIBLE_GLOOP_ID, crucible_gloop_quantity, safe_crucible_add } from './crucible-values';

export type CruciblePetitionType = 'crucible_purging' | 'crucible_sealing' | 'crucible_unsealing';

export function is_crucible_petition_type(type: string): type is CruciblePetitionType {
	return type === 'crucible_purging' || type === 'crucible_sealing' || type === 'crucible_unsealing';
}

export function crucible_migration_complete(database: Database = db): boolean {
	return database.query('SELECT 1 FROM crucible_migration WHERE id = 1 AND completed_at IS NOT NULL').get() !== null;
}

export function snapshot_crucible_petition(petition_id: number, guild_id: number,
	type: CruciblePetitionType, database: Database = db): void {
	if (type !== 'crucible_purging') return;
	database.query('INSERT INTO guild_petition_crucible_targets (petition_id, offering_id, generation) ' +
		'SELECT ?, id, generation FROM crucible_offerings WHERE guild_id = ?').run(petition_id, guild_id);
	database.query('INSERT INTO guild_petition_crucible_wishes (petition_id, wish_id) ' +
		'SELECT ?, id FROM crucible_wishes WHERE guild_id = ?').run(petition_id, guild_id);
}

export function apply_crucible_petition(petition: db_row.guild_petitions,
	now = Date.now(), database: Database = db): string {
	return database.transaction(() => apply_crucible_petition_transaction(petition, now, database)).immediate();
}

function apply_crucible_petition_transaction(petition: db_row.guild_petitions,
	now: number, database: Database): string {
	if (!is_crucible_petition_type(petition.type)) throw new RangeError('Not a Crucible petition');
	if (!crucible_migration_complete(database)) throw new Error('Crucible snapshot migration is incomplete');
	if (reconcile_crucible(petition.guild_id, now, database) < Math.floor(now / 60_000))
		throw new Error('Crucible is catching up');
	if (petition.type === 'crucible_unsealing') {
		const updated = database.query('UPDATE crucible_guilds SET is_open = 1 WHERE guild_id = ? AND is_open = 0')
			.run(petition.guild_id);
		if (updated.changes === 1)
			record_audit_event({ event_type: 'crucible.unsealed', source_key: `crucible-petition:${petition.id}`,
				actor: { kind: 'system' }, guild_id: petition.guild_id, occurred_at: now,
				details: { petition_id: petition.id } }, database);
		return updated.changes === 1 ? 'unsealed' : 'already_open_or_absent';
	}
	const targets = petition.type === 'crucible_sealing'
		? database.query<db_row.crucible_offerings, [number]>(
			'SELECT * FROM crucible_offerings WHERE guild_id = ?').all(petition.guild_id)
		: database.query<db_row.crucible_offerings, [number, number]>(
			'SELECT offering.* FROM crucible_offerings AS offering ' +
			'JOIN guild_petition_crucible_targets AS target ON target.offering_id = offering.id ' +
			'WHERE offering.guild_id = ? AND target.petition_id = ? AND target.generation = offering.generation'
		).all(petition.guild_id, petition.id);
	const target_wishes = petition.type === 'crucible_sealing'
		? database.query<db_row.crucible_wishes, [number]>(
			'SELECT * FROM crucible_wishes WHERE guild_id = ?').all(petition.guild_id)
		: database.query<db_row.crucible_wishes, [number, number]>(
			'SELECT wish.* FROM crucible_wishes AS wish ' +
			'JOIN guild_petition_crucible_wishes AS target ON target.wish_id = wish.id ' +
			'WHERE wish.guild_id = ? AND target.petition_id = ?'
		).all(petition.guild_id, petition.id);
	if (petition.type === 'crucible_sealing') {
		const updated = database.query('UPDATE crucible_guilds SET is_open = 0 WHERE guild_id = ? AND is_open = 1')
			.run(petition.guild_id);
		const offerings = database.query('DELETE FROM crucible_offerings WHERE guild_id = ?')
			.run(petition.guild_id).changes;
		const wishes = database.query('DELETE FROM crucible_wishes WHERE guild_id = ?')
			.run(petition.guild_id).changes;
		if (updated.changes + offerings + wishes > 0)
			audit_petition_disposal(petition, now, targets, target_wishes, database);
		return updated.changes === 1 ? (offerings + wishes > 0 ? 'sealed_and_destroyed' : 'sealed_empty')
			: 'already_sealed_or_absent';
	}
	const offerings = database.query('DELETE FROM crucible_offerings WHERE guild_id = ? AND id IN (' +
		'SELECT offering_id FROM guild_petition_crucible_targets WHERE petition_id = ? ' +
		'AND generation = crucible_offerings.generation)')
		.run(petition.guild_id, petition.id).changes;
	const wishes = database.query('DELETE FROM crucible_wishes WHERE guild_id = ? AND id IN (' +
		'SELECT wish_id FROM guild_petition_crucible_wishes WHERE petition_id = ?)')
		.run(petition.guild_id, petition.id).changes;
	if (offerings + wishes > 0)
		audit_petition_disposal(petition, now, targets, target_wishes, database);
	return offerings + wishes > 0 ? 'purged' : 'already_empty';
}

function audit_petition_disposal(petition: db_row.guild_petitions, now: number,
	offerings: db_row.crucible_offerings[], wishes: db_row.crucible_wishes[], database: Database): void {
	const event = record_audit_event({
		event_type: petition.type === 'crucible_sealing' ? 'crucible.sealed' : 'crucible.purged',
		source_key: `crucible-petition:${petition.id}`, actor: { kind: 'system' },
		guild_id: petition.guild_id, occurred_at: now,
		values: offerings.map(row => ({ object_id: row.item_id, quantity: row.qty, direction: 'destroy' })),
		details: { petition_id: petition.id, offering_count: offerings.length, wish_count: wishes.length,
			destroyed_wish_progress_gp: wishes.reduce((sum, wish) => safe_crucible_add(sum, wish.progress_gp), 0) }
	}, database);
	for (const row of offerings)
		move_audit_value_with_fallback(event, row.item_id, row.qty, 'crucible',
			String(petition.guild_id), null, null, database);
}

export function settle_departing_crucible_wish(client_id: number, guild_id: number,
	now = Date.now(), database: Database = db): void {
	if (!crucible_migration_complete(database)) return;
	if (reconcile_crucible(guild_id, now, database) < Math.floor(now / 60_000))
		throw new Error('Crucible is catching up');
	const wish = database.query<db_row.crucible_wishes, [number, number]>(
		'SELECT * FROM crucible_wishes WHERE owner_client_id = ? AND guild_id = ?'
	).get(client_id, guild_id);
	if (wish === null) return;
	database.query('DELETE FROM crucible_wishes WHERE id = ?').run(wish.id);
	if (wish.formation_points >= 10_080 && wish.progress_gp >= wish.required_gp) {
		const event = record_audit_event({ event_type: 'crucible.wish_departure_delivered',
			source_key: `crucible-wish-departure:${wish.id}`, actor: { kind: 'system' },
			guild_id, occurred_at: now, participants: [{ role: 'owner', client_id }],
			values: [{ object_id: wish.item_id, quantity: wish.qty, direction: 'create' }],
			details: { wish_id: wish.id, progress_gp: wish.progress_gp } }, database);
		create_audit_lot(event, wish.item_id, wish.qty, 'inbox',
			`${client_id}:crucible:Wish Granted`, database);
		database.query('INSERT INTO inbox_items (client_id, source_type, source_name, item_id, qty, created_at, updated_at) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (client_id, source_type, source_name, item_id) ' +
			'DO UPDATE SET qty = qty + excluded.qty, updated_at = excluded.updated_at')
			.run(client_id, 'crucible', 'Wish Granted', wish.item_id, wish.qty, now, now);
		return;
	}
	const residual = distribute_crucible_value(guild_id, wish.progress_gp, now,
		new Set([client_id]), database);
	const event = record_audit_event({ event_type: 'crucible.wish_departure_cancelled',
		source_key: `crucible-wish-departure:${wish.id}`, actor: { kind: 'system' },
		guild_id, occurred_at: now, participants: [{ role: 'owner', client_id }],
		values: residual > 0 ? [{ object_id: CRUCIBLE_GLOOP_ID,
			quantity: crucible_gloop_quantity(residual), direction: 'create' }] : [],
		details: { wish_id: wish.id, progress_gp: wish.progress_gp, residual_gp: residual } }, database);
	if (residual <= 0) return;
	const quantity = crucible_gloop_quantity(residual);
	create_audit_lot(event, CRUCIBLE_GLOOP_ID, quantity, 'crucible', String(guild_id), database);
	const prior = database.query<{ id: number; qty: number }, [number, string]>(
		'SELECT id, qty FROM crucible_offerings WHERE guild_id = ? AND item_id = ?'
	).get(guild_id, CRUCIBLE_GLOOP_ID);
	if (prior === null)
		database.query('INSERT INTO crucible_offerings (guild_id, item_id, qty, created_at, refreshed_at, ' +
			'is_untimed, valuation_source) VALUES (?, ?, ?, ?, ?, 1, ?)')
			.run(guild_id, CRUCIBLE_GLOOP_ID, quantity, now, now, 'server');
	else database.query('UPDATE crucible_offerings SET qty = ? WHERE id = ?')
		.run(safe_crucible_add(prior.qty, quantity), prior.id);
}
