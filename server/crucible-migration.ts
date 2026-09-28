import type { Database } from 'bun:sqlite';
import { db } from './db';
import type * as db_row from './db/types/db_types';
import { CHARITY_NORMAL_DECAY_MS, CHARITY_WISH_DECAY_MS,
	get_effective_charity_expiry } from './charity-decay';
import { CRUCIBLE_GLOOP_ID, CRUCIBLE_PROGRESS_MAX, crucible_known_valuation } from './crucible-values';
import { CHARITY_PET_ID, CRUCIBLE_PET_ID } from './pets';
import { is_client_version_at_least } from './client-version-policy';

const MINUTE_MS = 60_000;
const OLD_WISH_FORMATION_MS = 20 * 60 * MINUTE_MS;
const OLD_WISH_DELIVERY_MS = 96 * 60 * MINUTE_MS;

export type CrucibleMigrationCounts = {
	guilds: number;
	offerings: number;
	offering_qty: number;
	lots: number;
	lot_qty: number;
	wishes: number;
	wish_progress_gp: number;
	currency_locks: number;
	pets: number;
};

export type CrucibleMigrationReport = {
	started_at: number;
	completed_at: number;
	source: CrucibleMigrationCounts;
	destination: CrucibleMigrationCounts;
};

function tally(database: Database, source: boolean): CrucibleMigrationCounts {
	const table = (old_name: string, new_name: string) => source ? old_name : new_name;
	const count = (sql: string): number => {
		const value = database.query<{ value: number }, []>(sql).get()?.value ?? 0;
		if (!Number.isSafeInteger(value) || value < 0)
			throw new Error('Crucible migration count exceeds safe integer range');
		return value;
	};
	return {
		guilds: count(`SELECT COUNT(*) AS value FROM ${table('guilds', 'crucible_guilds')}`),
		offerings: count(`SELECT COUNT(*) AS value FROM ${table('charity_items', 'crucible_offerings')} WHERE qty > 0`),
		offering_qty: count(`SELECT COALESCE(SUM(qty), 0) AS value FROM ${table('charity_items', 'crucible_offerings')} WHERE qty > 0`),
		lots: count(`SELECT COUNT(*) AS value FROM ${table('charity_contribution_lots', 'crucible_contribution_lots')}`),
		lot_qty: count(`SELECT COALESCE(SUM(qty), 0) AS value FROM ${table('charity_contribution_lots', 'crucible_contribution_lots')}`),
		wishes: count(`SELECT COUNT(*) AS value FROM ${table('charity_wishes', 'crucible_wishes')}`),
		wish_progress_gp: count(`SELECT COALESCE(SUM(progress_gp), 0) AS value FROM ${table('charity_wishes', 'crucible_wishes')}`),
		currency_locks: count(`SELECT COUNT(*) AS value FROM ${table('charity_currency_locks', 'crucible_currency_locks')}`),
		pets: count(`SELECT COUNT(*) AS value FROM multiplayer_pet_ownership WHERE pet_id = '${source ? CHARITY_PET_ID : CRUCIBLE_PET_ID}'`)
	};
}

function fraction_to_points(now: number, deadline: number, lifetime: number): number {
	const remaining = Math.max(0, Math.min(lifetime, deadline - now));
	return Math.floor((1 - remaining / lifetime) * CRUCIBLE_PROGRESS_MAX);
}

function read_report(database: Database): CrucibleMigrationReport | null {
	const row = database.query<{ started_at: number; completed_at: number | null; source_json: string;
		destination_json: string | null }, []>('SELECT * FROM crucible_migration WHERE id = 1').get();
	if (row?.completed_at === null || row === null || row.destination_json === null) return null;
	return { started_at: row.started_at, completed_at: row.completed_at,
		source: JSON.parse(row.source_json) as CrucibleMigrationCounts,
		destination: JSON.parse(row.destination_json) as CrucibleMigrationCounts };
}

/** Copies a point-in-time Charitree snapshot. Cutover retires legacy ingress after reconciliation. */
export function migrate_charitree_to_crucible(now = Date.now(), database: Database = db,
	cutover = false): CrucibleMigrationReport {
	if (!Number.isSafeInteger(now) || now < 0)
		throw new RangeError('Invalid Crucible migration timestamp');
	const migrate = database.transaction(() => {
		const previous = read_report(database);
		if (previous !== null) {
			if (cutover && database.query<{ value: string }, [string]>(
				'SELECT value FROM service_settings WHERE key = ?').get('crucible_cutover')?.value !== '1')
				throw new Error('Existing Crucible test snapshot cannot be used for live cutover');
			return previous;
		}
		if (cutover && database.query<{ value: string }, [string]>(
			'SELECT value FROM service_settings WHERE key = ?').get('maintenance')?.value !== '1')
			throw new Error('Crucible cutover requires maintenance mode');
		if (database.query('SELECT 1 FROM crucible_migration LIMIT 1').get() !== null ||
			database.query('SELECT 1 FROM crucible_offerings LIMIT 1').get() !== null ||
			database.query('SELECT 1 FROM crucible_wishes LIMIT 1').get() !== null ||
			database.query('SELECT 1 FROM crucible_commands LIMIT 1').get() !== null ||
			database.query('SELECT 1 FROM crucible_reclaim_state LIMIT 1').get() !== null ||
			database.query('SELECT 1 FROM crucible_clear_events LIMIT 1').get() !== null)
			throw new Error('Crucible destination is not empty; migration refused');

		const invalid = database.query<{ guild_id: number; item_id: string }, [string]>(
			'SELECT item.guild_id, item.item_id FROM charity_items AS item WHERE item.qty <= 0 OR ' +
			'(item.item_id != ? AND item.expires_at <= 0) OR ' +
			'(SELECT COALESCE(SUM(lot.qty), 0) FROM charity_contribution_lots AS lot ' +
			'WHERE lot.guild_id = item.guild_id AND lot.item_id = item.item_id) > item.qty LIMIT 1'
		).get(CRUCIBLE_GLOOP_ID);
		if (invalid !== null)
			throw new Error(`Invalid Charitree stack at guild ${invalid.guild_id}, item ${invalid.item_id}`);

		const source = tally(database, true);
		const support_floor = database.query<{ value: string }, [string]>(
			'SELECT value FROM service_settings WHERE key = ?'
		).get('minimum_supported_mod_version')?.value ?? '';
		if (is_client_version_at_least(support_floor, '1.5.17'))
			throw new Error('Support floor must keep 1.5.16 clients available');
		database.query('UPDATE service_settings SET value = ? WHERE key = ?')
			.run('1.5.16', 'minimum_supported_mod_version');
		const active_locks = database.query<{ value: number }, [number]>(
			'SELECT COUNT(*) AS value FROM charity_currency_locks WHERE locked_until > ?'
		).get(now)?.value ?? 0;
		source.currency_locks = active_locks;
		database.query('INSERT INTO crucible_migration (id, started_at, source_json) VALUES (1, ?, ?)')
			.run(now, JSON.stringify(source));
		const processed_minute = Math.floor(now / MINUTE_MS);
		database.query('INSERT OR IGNORE INTO crucible_guilds (guild_id, processed_minute, created_at) ' +
			'SELECT id, ?, ? FROM guilds').run(processed_minute, now);
		database.query('UPDATE crucible_guilds SET processed_minute = ?').run(processed_minute);

		const active_wishes = database.query<{ guild_id: number; created_at: number }, [number]>(
			'SELECT guild_id, MIN(created_at) AS created_at FROM charity_wishes ' +
			'WHERE matures_at > ? OR progress_gp < required_gp GROUP BY guild_id'
		).all(now);
		const activation = new Map(active_wishes.map(row => [row.guild_id, row.created_at]));
		const existing_activations = database.query<{ guild_id: number; activated_at: number }, []>(
			'SELECT guild_id, activated_at FROM charity_decay_activations').all();
		for (const row of existing_activations)
			if (activation.has(row.guild_id)) activation.set(row.guild_id, row.activated_at);

		const offerings = database.query<db_row.charity_items, []>(
			'SELECT * FROM charity_items ORDER BY guild_id, item_id').all();
		const snapshot_event = offerings.length === 0 ? null : database.query<{ id: number }, [number, string, string, string, string]>(
			'INSERT INTO audit_events (occurred_at, event_type, actor_kind, source_key, details_json) ' +
			'VALUES (?, ?, ?, ?, ?) RETURNING id'
		).get(now, 'crucible.snapshot', 'operator', `crucible-snapshot:${now}`,
			JSON.stringify({ legacy_retained: true, offerings: offerings.length }))!.id;
		let audit_ordinal = 0;
		for (const old of offerings) {
			const is_untimed = old.item_id === CRUCIBLE_GLOOP_ID;
			const activated_at = activation.get(old.guild_id);
			const context = activated_at === undefined ? null : {
				activation_at: activated_at, effective_lifetime_ms: CHARITY_WISH_DECAY_MS
			};
			const deadline = get_effective_charity_expiry(old.expires_at, context);
			const lifetime = context === null ? CHARITY_NORMAL_DECAY_MS : CHARITY_WISH_DECAY_MS;
			const points = is_untimed ? 0 : fraction_to_points(now, deadline, lifetime);
			const known = crucible_known_valuation(old.item_id);
			const valuation = known ?? old;
			const created_at = Math.max(0, Math.min(old.donated_at, now));
			database.query(
				'INSERT INTO crucible_offerings (guild_id, item_id, qty, value_currency_id, value_per_item, ' +
				'meld_points, created_at, refreshed_at, is_untimed, valuation_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
			).run(old.guild_id, old.item_id, old.qty, valuation.value_currency_id,
				valuation.value_per_item, points, created_at, now, is_untimed ? 1 : 0, 'migration');
			if (snapshot_event !== null) {
				const audit_lot = database.query<{ id: number }, [number, string, number]>(
					'INSERT INTO audit_value_lots (created_by_event_id, object_id, original_quantity) ' +
					'VALUES (?, ?, ?) RETURNING id'
				).get(snapshot_event, old.item_id, old.qty)!.id;
				database.query('INSERT INTO audit_value_lot_positions ' +
					'(lot_id, position_kind, position_key, quantity) VALUES (?, ?, ?, ?)')
					.run(audit_lot, 'crucible', String(old.guild_id), old.qty);
				database.query('INSERT INTO audit_value_movements ' +
					'(event_id, ordinal, lot_id, to_kind, to_key, object_id, quantity) ' +
					'VALUES (?, ?, ?, ?, ?, ?, ?)')
					.run(snapshot_event, audit_ordinal++, audit_lot, 'crucible', String(old.guild_id), old.item_id, old.qty);
			}
		}
		const lots = database.query<db_row.charity_contribution_lots, []>(
			'SELECT * FROM charity_contribution_lots ORDER BY contributed_at, id').all();
		for (const lot of lots) {
			const offering = database.query<{ id: number }, [number, string]>(
				'SELECT id FROM crucible_offerings WHERE guild_id = ? AND item_id = ?'
			).get(lot.guild_id, lot.item_id);
			if (offering === null) throw new Error(`Orphan Charitree lot ${lot.id}`);
			database.query('INSERT INTO crucible_contribution_lots ' +
				'(offering_id, client_id, qty, contributed_at, source_kind, source_id) VALUES (?, ?, ?, ?, ?, ?)')
				.run(offering.id, lot.client_id, lot.qty, lot.contributed_at, 'migration', String(lot.id));
		}

		const wishes = database.query<db_row.charity_wishes, []>(
			'SELECT * FROM charity_wishes ORDER BY id').all();
		for (const wish of wishes) {
			const points = fraction_to_points(now, wish.matures_at, OLD_WISH_FORMATION_MS);
			const formed_at = points === CRUCIBLE_PROGRESS_MAX ? wish.matures_at : null;
			const melded_at = formed_at !== null && wish.progress_gp >= wish.required_gp
				? Math.max(formed_at, wish.ripe_at ?? formed_at) : null;
			const auto_deliver_at = melded_at === null ? null
				: (wish.ripe_at ?? melded_at) + OLD_WISH_DELIVERY_MS;
			database.query('INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, ' +
				'item_id, qty, required_gp, progress_gp, formation_points, created_at, formed_at, melded_at, auto_deliver_at) ' +
				'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
				.run(wish.guild_id, wish.owner_client_id, wish.melvor_account_id, wish.item_id, wish.qty,
					wish.required_gp, wish.progress_gp, points, wish.created_at, formed_at, melded_at, auto_deliver_at);
			const owner = database.query<{ melvor_account_id: number | null }, [number]>(
				'SELECT melvor_account_id FROM clients WHERE id = ?').get(wish.owner_client_id);
			const owner_key = owner?.melvor_account_id === null || owner?.melvor_account_id === undefined
				? `client:${wish.owner_client_id}` : `account:${owner.melvor_account_id}`;
			database.query('INSERT OR REPLACE INTO crucible_visibility_resets (owner_key, reset_at) VALUES (?, ?)')
				.run(owner_key, now);
		}
		database.query('INSERT INTO crucible_currency_locks (guild_id, owner_key, currency_id, locked_until) ' +
			'SELECT guild_id, owner_key, currency_id, locked_until FROM charity_currency_locks WHERE locked_until > ?')
			.run(now);
		database.query('INSERT INTO multiplayer_pet_ownership (client_id, pet_id, created_at, updated_at) ' +
			'SELECT client_id, ?, created_at, ? FROM multiplayer_pet_ownership WHERE pet_id = ? ' +
			'ON CONFLICT (client_id, pet_id) DO NOTHING')
			.run(CRUCIBLE_PET_ID, now, CHARITY_PET_ID);

		const destination = tally(database, false);
		if (JSON.stringify(source) !== JSON.stringify(destination))
			throw new Error(`Crucible migration reconciliation failed: ${JSON.stringify({ source, destination })}`);
		database.query('UPDATE crucible_migration SET completed_at = ?, destination_json = ? WHERE id = 1')
			.run(now, JSON.stringify(destination));
		if (cutover) {
			database.query("UPDATE guild_petitions SET lifecycle = 'lapsed', resolved_at = ?, subject_locked = 0 " +
				"WHERE type LIKE 'charitree_%' AND lifecycle = 'active'").run(now);
			database.query('INSERT INTO service_settings (key, value) VALUES (?, ?) ' +
				'ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('crucible_cutover', '1');
		}
		return { started_at: now, completed_at: now, source, destination };
	});
	return migrate.immediate();
}
