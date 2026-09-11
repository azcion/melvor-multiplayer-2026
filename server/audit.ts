import { db } from './db';
import type { DeviceDiagnostics } from './diagnostics';
import { get_request_identity } from './http';

export type AuditActor =
	| { kind: 'client'; client_id: number; request?: Request }
	| { kind: 'operator'; name?: string }
	| { kind: 'system' };

export type AuditParticipant = { role: string; client_id: number };
export type AuditValue = {
	value_kind?: 'item' | 'currency';
	object_id: string;
	quantity: number;
	direction: 'in' | 'out' | 'move' | 'destroy' | 'create';
};

export type AuditEventInput = {
	event_type: string;
	source_key: string;
	actor: AuditActor;
	occurred_at?: number;
	guild_id?: number;
	command_id?: string;
	participants?: AuditParticipant[];
	values?: AuditValue[];
	details?: Record<string, string | number | boolean | null>;
};

export type AuditPositionKind = 'charitree' | 'gift' | 'inbox' | 'client';

export function audit_command_source(kind: string, client_id: number, command_id: unknown): string {
	return typeof command_id === 'string'
		? `command:${client_id}:${kind}:${command_id}`
		: `legacy:${client_id}:${kind}:${crypto.randomUUID()}`;
}

export function audit_position_key(kind: AuditPositionKind, owner_id: number | string,
	source_type?: string, source_name?: string): string {
	if (kind === 'inbox')
		return `${owner_id}:${source_type ?? 'other'}:${source_name ?? ''}`;
	return String(owner_id);
}

function display_name(client_id: number): string {
	const row = db.query<{ display_name: string }, [number]>(
		'SELECT `display_name` FROM `clients` WHERE `id` = ?'
	).get(client_id);
	if (row === null)
		throw new Error(`Cannot audit missing Client #${client_id}`);
	return row.display_name;
}

function guild_name(guild_id: number): string {
	const row = db.query<{ name: string }, [number]>(
		'SELECT `name` FROM `guilds` WHERE `id` = ?'
	).get(guild_id);
	if (row === null)
		throw new Error(`Cannot audit missing Guild #${guild_id}`);
	return row.name;
}

function request_device(actor: AuditActor): DeviceDiagnostics | null {
	if (actor.kind !== 'client' || actor.request === undefined)
		return null;
	return get_request_identity(actor.request)?.device ?? null;
}

export function record_audit_event(input: AuditEventInput): number {
	const actor_client_id = input.actor.kind === 'client' ? input.actor.client_id : null;
	const actor_display_name = actor_client_id === null
		? (input.actor.kind === 'operator' ? input.actor.name?.trim() || null : null)
		: display_name(actor_client_id);
	const device = request_device(input.actor);
	const inserted = db.query<{ id: number }, [
		number, string, string, number | null, string | null, number | null, string | null,
		string | null, string, string | null, string | null, string | null, string | null,
		string | null, string | null, string
	]>(
		'INSERT INTO `audit_events` (`occurred_at`, `event_type`, `actor_kind`, `actor_client_id`, ' +
		'`actor_display_name`, `guild_id`, `guild_name`, `command_id`, `source_key`, `installation_id`, ' +
		'`client_platform`, `app_distribution`, `app_channel`, `app_version`, `app_build`, `details_json`) ' +
		'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`'
	).get(
		input.occurred_at ?? Date.now(), input.event_type, input.actor.kind, actor_client_id,
		actor_display_name, input.guild_id ?? null,
		input.guild_id === undefined ? null : guild_name(input.guild_id), input.command_id ?? null,
		input.source_key, device?.installation_id ?? null, device?.platform ?? null,
		device?.distribution ?? null, device?.app_channel ?? null, device?.app_version ?? null,
		device?.app_build ?? null, JSON.stringify(input.details ?? {})
	) as { id: number };

	for (const participant of input.participants ?? []) {
		db.query(
			'INSERT INTO `audit_event_participants` (`event_id`, `role`, `client_id`, `display_name`) VALUES(?, ?, ?, ?)'
		).run(inserted.id, participant.role, participant.client_id, display_name(participant.client_id));
	}
	(input.values ?? []).forEach((value, ordinal) => {
		db.query(
			'INSERT INTO `audit_event_values` (`event_id`, `ordinal`, `value_kind`, `object_id`, `quantity`, `direction`) ' +
			'VALUES(?, ?, ?, ?, ?, ?)'
		).run(inserted.id, ordinal, value.value_kind ?? (value.object_id === 'melvorD:GP' ? 'currency' : 'item'),
			value.object_id, value.quantity, value.direction);
	});
	return inserted.id;
}

export function link_audit_events(event_id: number, relation: string, related_event_id: number): void {
	db.query(
		'INSERT INTO `audit_event_links` (`event_id`, `relation`, `related_event_id`) VALUES(?, ?, ?) ON CONFLICT DO NOTHING'
	).run(event_id, relation, related_event_id);
}

export function create_audit_lot(event_id: number, object_id: string, quantity: number,
	position_kind: AuditPositionKind, position_key: string): number {
	const lot = db.query<{ id: number }, [number, string, number]>(
		'INSERT INTO `audit_value_lots` (`created_by_event_id`, `object_id`, `original_quantity`) VALUES(?, ?, ?) RETURNING `id`'
	).get(event_id, object_id, quantity) as { id: number };
	db.query(
		'INSERT INTO `audit_value_lot_positions` (`lot_id`, `position_kind`, `position_key`, `quantity`) VALUES(?, ?, ?, ?)'
	).run(lot.id, position_kind, position_key, quantity);
	const ordinal = db.query<{ ordinal: number }, [number]>(
		'SELECT COALESCE(MAX(`ordinal`) + 1, 0) AS `ordinal` FROM `audit_value_movements` WHERE `event_id` = ?'
	).get(event_id)?.ordinal ?? 0;
	db.query(
		'INSERT INTO `audit_value_movements` (`event_id`, `ordinal`, `lot_id`, `to_kind`, `to_key`, `object_id`, `quantity`) ' +
		'VALUES(?, ?, ?, ?, ?, ?, ?)'
	).run(event_id, ordinal, lot.id, position_kind, position_key, object_id, quantity);
	return lot.id;
}

export function move_audit_value(event_id: number, object_id: string, quantity: number,
	from_kind: AuditPositionKind, from_key: string, to_kind: AuditPositionKind | null, to_key: string | null): number {
	let remaining = quantity;
	let ordinal = db.query<{ ordinal: number }, [number]>(
		'SELECT COALESCE(MAX(`ordinal`) + 1, 0) AS `ordinal` FROM `audit_value_movements` WHERE `event_id` = ?'
	).get(event_id)?.ordinal ?? 0;
	const positions = db.query<{ lot_id: number; quantity: number }, [string, string, string]>(
		'SELECT position.`lot_id`, position.`quantity` FROM `audit_value_lot_positions` AS position ' +
		'JOIN `audit_value_lots` AS lot ON lot.`id` = position.`lot_id` ' +
		'WHERE position.`position_kind` = ? AND position.`position_key` = ? AND lot.`object_id` = ? ' +
		'ORDER BY lot.`created_by_event_id`, lot.`id`'
	).all(from_kind, from_key, object_id);
	for (const position of positions) {
		if (remaining === 0)
			break;
		const moved = Math.min(position.quantity, remaining);
		if (moved === position.quantity) {
			db.query('DELETE FROM `audit_value_lot_positions` WHERE `lot_id` = ? AND `position_kind` = ? AND `position_key` = ?')
				.run(position.lot_id, from_kind, from_key);
		} else {
			db.query('UPDATE `audit_value_lot_positions` SET `quantity` = `quantity` - ? ' +
				'WHERE `lot_id` = ? AND `position_kind` = ? AND `position_key` = ?')
				.run(moved, position.lot_id, from_kind, from_key);
		}
		if (to_kind !== null && to_key !== null) {
			db.query(
				'INSERT INTO `audit_value_lot_positions` (`lot_id`, `position_kind`, `position_key`, `quantity`) ' +
				'VALUES(?, ?, ?, ?) ON CONFLICT (`lot_id`, `position_kind`, `position_key`) ' +
				'DO UPDATE SET `quantity` = `quantity` + excluded.`quantity`'
			).run(position.lot_id, to_kind, to_key, moved);
		}
		db.query(
			'INSERT INTO `audit_value_movements` (`event_id`, `ordinal`, `lot_id`, `from_kind`, `from_key`, ' +
			'`to_kind`, `to_key`, `object_id`, `quantity`) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run(event_id, ordinal++, position.lot_id, from_kind, from_key, to_kind, to_key, object_id, moved);
		remaining -= moved;
	}
	return quantity - remaining;
}

export function create_missing_audit_lot(event_id: number, object_id: string, quantity: number,
	position_kind: AuditPositionKind, position_key: string): void {
	if (quantity > 0)
		create_audit_lot(event_id, object_id, quantity, position_kind, position_key);
}

export function move_audit_value_with_fallback(event_id: number, object_id: string, quantity: number,
	from_kind: AuditPositionKind, from_key: string, to_kind: AuditPositionKind | null, to_key: string | null): void {
	const moved = move_audit_value(event_id, object_id, quantity, from_kind, from_key, to_kind, to_key);
	if (moved === quantity)
		return;
	const missing = quantity - moved;
	if (to_kind !== null && to_key !== null)
		create_audit_lot(event_id, object_id, missing, to_kind, to_key);
	else {
		create_audit_lot(event_id, object_id, missing, from_kind, from_key);
		move_audit_value(event_id, object_id, missing, from_kind, from_key, null, null);
	}
}

export function change_display_name(client_id: number, next_name: string, request: Request, now = Date.now()): boolean {
	const current = display_name(client_id);
	if (current === next_name)
		return false;
	const event_id = record_audit_event({
		event_type: 'identity.display_name_changed',
		source_key: `display-name:${client_id}:${now}:${crypto.randomUUID()}`,
		actor: { kind: 'client', client_id, request },
		occurred_at: now,
		details: { old_display_name: current, new_display_name: next_name }
	});
	const open_intervals = db.query<{ count: number }, [number]>(
		'SELECT COUNT(*) AS `count` FROM `client_display_name_history` WHERE `client_id` = ? AND `valid_to` IS NULL'
	).get(client_id)?.count ?? 0;
	if (open_intervals !== 1)
		throw new Error(`Client #${client_id} does not have exactly one current display name`);
	db.query(
		'UPDATE `client_display_name_history` SET `valid_to` = ? WHERE `client_id` = ? AND `valid_to` IS NULL'
	).run(now, client_id);
	db.query(
		'INSERT INTO `client_display_name_history` (`client_id`, `display_name`, `valid_from`, `changed_by_event_id`) ' +
		'VALUES(?, ?, ?, ?)'
	).run(client_id, next_name, now, event_id);
	db.query('UPDATE `clients` SET `display_name` = ? WHERE `id` = ?').run(next_name, client_id);
	return true;
}
