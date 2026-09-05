import * as runtime from '../app-runtime';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonSerializable } from '../http';
import { add_inbox_gp, add_inbox_items } from '../inbox';

const { db, get_client_guild_id, is_social_only_client, is_valid_uuid, run_economy_command,
	market_completed_cached, session_get_route, session_post_route } = runtime;

const HAGGLE_LIFETIME = 72 * 60 * 60 * 1000;
const MAX_ACTIVE_HAGGLES = 4;

function safe_total(qty: number, price: number): number | null {
	const total = qty * price;
	return Number.isSafeInteger(total) ? total : null;
}

function add_claim(haggle_id: string, client_id: number, item_id: string | null, item_qty: number, gp: number): void {
	if (item_qty === 0 && gp === 0)
		return;
	db.query(
		'INSERT INTO `market_haggle_claims` (`haggle_id`, `client_id`, `item_id`, `item_qty`, `gp`) ' +
		'VALUES(?, ?, ?, ?, ?) ON CONFLICT (`haggle_id`, `client_id`) DO UPDATE SET ' +
		'`item_id` = COALESCE(`market_haggle_claims`.`item_id`, excluded.`item_id`), ' +
		'`item_qty` = `market_haggle_claims`.`item_qty` + excluded.`item_qty`, ' +
		'`gp` = `market_haggle_claims`.`gp` + excluded.`gp`'
	).run(haggle_id, client_id, item_id, item_qty, gp);
}

function terminate_active_haggle(haggle: db_row.market_haggles, status: 'cancelled' | 'rejected' | 'expired',
	restore_listing = true, now = Date.now()): boolean {
	const changed = db.query(
		'UPDATE `market_haggles` SET `status` = ?, `turn_client_id` = NULL, `expires_at` = NULL, ' +
		'`terminal_at` = ?, `updated_at` = ? WHERE `id` = ? AND `status` = \'active\' AND `revision` = ?'
	).run(status, now, now, haggle.id, haggle.revision);
	if (changed.changes === 0)
		return false;
	if (restore_listing && haggle.listing_id !== null) {
		db.query(
			'UPDATE `market_items` SET `available` = `available` + ?, `reserved` = `reserved` - ?, ' +
			'`escrow_gp` = `escrow_gp` + ?, `updated_at` = ? WHERE `id` = ?'
		).run(haggle.item_qty, haggle.item_qty, haggle.listing_reserved_gp, now, haggle.listing_id);
	}
	market_completed_cached.delete(haggle.owner_id);
	if (haggle.direction === 'sell')
		add_claim(haggle.id, haggle.initiator_id, null, 0, haggle.payer_escrow_gp);
	else {
		add_claim(haggle.id, haggle.initiator_id, haggle.item_id, haggle.item_qty, 0);
		add_claim(haggle.id, haggle.owner_id, null, 0,
			Math.max(haggle.payer_escrow_gp - haggle.listing_reserved_gp, 0));
	}
	return true;
}

export function expire_market_haggles(now = Date.now()): number {
	const expired = db.query<db_row.market_haggles, [number]>(
		'SELECT * FROM `market_haggles` WHERE `status` = \'active\' AND `expires_at` <= ? ORDER BY `id` LIMIT 100'
	).all(now);
	let count = 0;
	for (const haggle of expired)
		if (terminate_active_haggle(haggle, 'expired', true, now))
			count++;
	return count;
}

export function cancel_listing_haggles(listing_id: number, now = Date.now()): number {
	const haggles = db.query<db_row.market_haggles, [number]>(
		'SELECT * FROM `market_haggles` WHERE `listing_id` = ? AND `status` = \'active\''
	).all(listing_id);
	let count = 0;
	for (const haggle of haggles)
		if (terminate_active_haggle(haggle, 'cancelled', true, now))
			count++;
	return count;
}

export function cancel_client_haggles(client_id: number, now = Date.now()): number {
	const haggles = db.query<db_row.market_haggles, [number, number]>(
		'SELECT * FROM `market_haggles` WHERE `status` = \'active\' AND (`initiator_id` = ? OR `owner_id` = ?)'
	).all(client_id, client_id);
	let count = 0;
	for (const haggle of haggles)
		if (terminate_active_haggle(haggle, 'cancelled', true, now))
			count++;
	return count;
}

function haggle_view(row: db_row.market_haggles, client_id: number): JsonSerializable {
	const claim = db.query<db_row.market_haggle_claims, [string, number]>(
		'SELECT * FROM `market_haggle_claims` WHERE `haggle_id` = ? AND `client_id` = ?'
	).get(row.id, client_id);
	const other_id = row.initiator_id === client_id ? row.owner_id : row.initiator_id;
	const other = db.query<Pick<db_row.clients, 'display_name' | 'icon_id'>, [number]>(
		'SELECT `display_name`, `icon_id` FROM `clients` WHERE `id` = ?'
	).get(other_id);
	return {
		id: row.id, listing_id: row.listing_ref, direction: row.direction, item_id: row.item_id,
		item_qty: row.item_qty, listing_price: row.listing_price, offer_price: row.offer_price,
		payer_escrow_gp: row.payer_escrow_gp, revision: row.revision, status: row.status,
		expires_at: row.expires_at, is_initiator: row.initiator_id === client_id,
		is_turn: row.turn_client_id === client_id, counterparty: other,
		claim: claim === null ? null : { item_id: claim.item_id, item_qty: claim.item_qty, gp: claim.gp,
			claimed: claim.claimed_at !== null }
	};
}

export function register_haggle_routes(): void {
	session_get_route('/api/market/haggles', async (_req, _url, client_id): Promise<HandlerResult> => {
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
		db.transaction(() => expire_market_haggles()).immediate();
		const rows = db.query<db_row.market_haggles, [number, number]>(
			'SELECT * FROM `market_haggles` WHERE `initiator_id` = ? OR `owner_id` = ? ORDER BY `updated_at` DESC, `id` DESC'
		).all(client_id, client_id);
		return { success: true, haggles: rows.map(row => haggle_view(row, client_id)) };
	});

	session_post_route('/api/market/haggle', async (_req, _url, client_id, json) => {
		const listing_id = json.id;
		const item_qty = json.qty;
		const offer_price = json.price;
		if (typeof listing_id !== 'number' || !Number.isSafeInteger(listing_id) ||
			typeof item_qty !== 'number' || !Number.isSafeInteger(item_qty) || item_qty <= 0 ||
			typeof offer_price !== 'number' || !Number.isSafeInteger(offer_price) || offer_price <= 0)
			return 400;
		const offered_total = safe_total(item_qty, offer_price);
		if (offered_total === null)
			return { error_lang: 'MOD_MP_MARKET_VALUE_TOO_LARGE' };
		const result = run_economy_command(client_id, json.command_id, 'market-haggle', () => {
			expire_market_haggles();
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const lot = db.query<db_row.market_items, [number]>(
				'SELECT * FROM `market_items` WHERE `id` = ? LIMIT 1'
			).get(listing_id);
			if (lot === null || lot.client_id === client_id || lot.available < item_qty)
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_INVALID' };
			const guild = db.query('SELECT 1 FROM `guild_memberships` WHERE `guild_id` = ? AND `client_id` = ?')
				.get(lot.guild_id, client_id);
			if (guild === null)
				return { success: false, error_lang: 'MOD_MP_GUILD_REQUIRED' };
			const active = db.query<{ count: number }, [number]>(
				'SELECT COUNT(*) AS `count` FROM `market_haggles` WHERE `initiator_id` = ? AND `status` = \'active\''
			).get(client_id)?.count ?? 0;
			if (active >= MAX_ACTIVE_HAGGLES)
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_LIMIT' };
			const listing_reserved_gp = lot.direction === 'buy' ? safe_total(item_qty, lot.price) : 0;
			if (listing_reserved_gp === null || listing_reserved_gp > lot.escrow_gp)
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_INVALID' };
			const now = Date.now();
			const id = crypto.randomUUID();
			const payer_escrow_gp = lot.direction === 'sell' ? offered_total : listing_reserved_gp;
			try {
				db.query(
					'INSERT INTO `market_haggles` (`id`, `listing_id`, `listing_ref`, `guild_id`, `initiator_id`, `owner_id`, ' +
					'`direction`, `item_id`, `item_qty`, `listing_price`, `offer_price`, `listing_reserved_gp`, ' +
					'`payer_escrow_gp`, `turn_client_id`, `created_at`, `updated_at`, `expires_at`) ' +
					'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
				).run(id, lot.id, lot.id, lot.guild_id, client_id, lot.client_id, lot.direction, lot.item_id, item_qty,
					lot.price, offer_price, listing_reserved_gp, payer_escrow_gp, lot.client_id, now, now, now + HAGGLE_LIFETIME);
			} catch (error) {
				if (String(error).includes('UNIQUE'))
					return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_EXISTS' };
				throw error;
			}
			db.query('UPDATE `market_items` SET `available` = `available` - ?, `reserved` = `reserved` + ?, ' +
				'`escrow_gp` = `escrow_gp` - ?, `updated_at` = ? WHERE `id` = ?')
				.run(item_qty, item_qty, listing_reserved_gp, now, lot.id);
			market_completed_cached.delete(lot.client_id);
			return { success: true, haggle_id: id, effects: lot.direction === 'sell'
				? [{ storage: 'gp' as const, qty: -offered_total }]
				: [{ storage: 'bank' as const, item_id: lot.item_id, qty: -item_qty }] };
		});
		return result ?? 400;
	});

	session_post_route('/api/market/haggle/counter', async (_req, _url, client_id, json) => {
		if (typeof json.id !== 'string' || !is_valid_uuid(json.id) || typeof json.revision !== 'number' ||
			!Number.isSafeInteger(json.revision) || typeof json.price !== 'number' ||
			!Number.isSafeInteger(json.price) || json.price <= 0)
			return 400;
		const haggle_id = json.id as string;
		const revision = json.revision as number;
		const price = json.price as number;
		const result = run_economy_command(client_id, json.command_id, 'market-haggle-counter', () => {
			expire_market_haggles();
			const haggle = db.query<db_row.market_haggles, [string]>(
				'SELECT * FROM `market_haggles` WHERE `id` = ?'
			).get(haggle_id);
			if (haggle === null || haggle.status !== 'active' || haggle.turn_client_id !== client_id ||
				haggle.revision !== revision || is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_STALE' };
			const total = safe_total(haggle.item_qty, price);
			if (total === null)
				return { success: false, error_lang: 'MOD_MP_MARKET_VALUE_TOO_LARGE' };
			const payer_id = haggle.direction === 'sell' ? haggle.initiator_id : haggle.owner_id;
			const top_up = client_id === payer_id ? Math.max(total - haggle.payer_escrow_gp, 0) : 0;
			const now = Date.now();
			db.query(
				'UPDATE `market_haggles` SET `offer_price` = ?, `payer_escrow_gp` = `payer_escrow_gp` + ?, ' +
				'`turn_client_id` = ?, `revision` = `revision` + 1, `updated_at` = ?, `expires_at` = ? ' +
				'WHERE `id` = ? AND `status` = \'active\' AND `revision` = ?'
			).run(price, top_up, client_id === haggle.initiator_id ? haggle.owner_id : haggle.initiator_id,
				now, now + HAGGLE_LIFETIME, haggle.id, haggle.revision);
			return { success: true, revision: haggle.revision + 1,
				effects: top_up > 0 ? [{ storage: 'gp' as const, qty: -top_up }] : [] };
		});
		return result ?? 400;
	});

	session_post_route('/api/market/haggle/accept', async (_req, _url, client_id, json) => {
		if (typeof json.id !== 'string' || !is_valid_uuid(json.id) || typeof json.revision !== 'number' ||
			!Number.isSafeInteger(json.revision))
			return 400;
		const haggle_id = json.id as string;
		const revision = json.revision as number;
		const result = run_economy_command(client_id, json.command_id, 'market-haggle-accept', () => {
			expire_market_haggles();
			const haggle = db.query<db_row.market_haggles, [string]>('SELECT * FROM `market_haggles` WHERE `id` = ?').get(haggle_id);
			if (haggle === null || haggle.status !== 'active' || haggle.turn_client_id !== client_id ||
				haggle.revision !== revision || is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_STALE' };
			const agreed = safe_total(haggle.item_qty, haggle.offer_price);
			if (agreed === null)
				return { success: false, error_lang: 'MOD_MP_MARKET_VALUE_TOO_LARGE' };
			const payer_id = haggle.direction === 'sell' ? haggle.initiator_id : haggle.owner_id;
			const top_up = client_id === payer_id ? Math.max(agreed - haggle.payer_escrow_gp, 0) : 0;
			if (haggle.payer_escrow_gp + top_up < agreed)
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_UNFUNDED' };
			const now = Date.now();
			const changed = db.query(
				'UPDATE `market_haggles` SET `status` = \'accepted\', `payer_escrow_gp` = `payer_escrow_gp` + ?, ' +
				'`turn_client_id` = NULL, `expires_at` = NULL, `terminal_at` = ?, `updated_at` = ? ' +
				'WHERE `id` = ? AND `status` = \'active\' AND `revision` = ?'
			).run(top_up, now, now, haggle.id, haggle.revision);
			if (changed.changes === 0)
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_STALE' };
			if (haggle.listing_id !== null)
				db.query('UPDATE `market_items` SET `reserved` = `reserved` - ?, `haggled` = `haggled` + ?, `updated_at` = ? WHERE `id` = ?')
					.run(haggle.item_qty, haggle.item_qty, now, haggle.listing_id);
			market_completed_cached.delete(haggle.owner_id);
			const buyer_id = haggle.direction === 'sell' ? haggle.initiator_id : haggle.owner_id;
			const seller_id = haggle.direction === 'sell' ? haggle.owner_id : haggle.initiator_id;
			add_claim(haggle.id, buyer_id, haggle.item_id, haggle.item_qty,
				Math.max(haggle.payer_escrow_gp + top_up - agreed, 0));
			add_claim(haggle.id, seller_id, null, 0, agreed);
			return { success: true, effects: top_up > 0 ? [{ storage: 'gp' as const, qty: -top_up }] : [] };
		});
		return result ?? 400;
	});

	session_post_route('/api/market/haggle/terminate', async (_req, _url, client_id, json) => {
		if (typeof json.id !== 'string' || !is_valid_uuid(json.id) || typeof json.revision !== 'number' ||
			!Number.isSafeInteger(json.revision))
			return 400;
		const haggle_id = json.id as string;
		const revision = json.revision as number;
		const result = run_economy_command(client_id, json.command_id, 'market-haggle-terminate', () => {
			expire_market_haggles();
			const haggle = db.query<db_row.market_haggles, [string]>('SELECT * FROM `market_haggles` WHERE `id` = ?').get(haggle_id);
			if (haggle === null || haggle.status !== 'active' || haggle.revision !== revision ||
				(client_id !== haggle.initiator_id && client_id !== haggle.owner_id))
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_STALE' };
			const status = client_id === haggle.owner_id && haggle.turn_client_id === client_id ? 'rejected' : 'cancelled';
			return terminate_active_haggle(haggle, status) ? { success: true, effects: [] }
				: { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_STALE' };
		});
		return result ?? 400;
	});

	session_post_route('/api/market/haggle/claim', async (_req, _url, client_id, json) => {
		if (typeof json.id !== 'string' || !is_valid_uuid(json.id))
			return 400;
		const haggle_id = json.id as string;
		const result = run_economy_command(client_id, json.command_id, 'market-haggle-claim', () => {
			const claim = db.query<db_row.market_haggle_claims, [string, number]>(
				'SELECT * FROM `market_haggle_claims` WHERE `haggle_id` = ? AND `client_id` = ?'
			).get(haggle_id, client_id);
			if (claim === null || claim.claimed_at !== null)
				return { success: false, error_lang: 'MOD_MP_MARKET_HAGGLE_CLAIMED' };
			if (claim.item_id !== null && claim.item_qty > 0)
				add_inbox_items(client_id, [{ item_id: claim.item_id, qty: claim.item_qty }]);
			if (claim.gp > 0)
				add_inbox_gp(client_id, claim.gp);
			db.query('UPDATE `market_haggle_claims` SET `claimed_at` = ? WHERE `haggle_id` = ? AND `client_id` = ?')
				.run(Date.now(), claim.haggle_id, client_id);
			return { success: true, effects: [] };
		});
		return result ?? 400;
	});
}
