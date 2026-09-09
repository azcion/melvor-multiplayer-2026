import * as runtime from './app-runtime';
import type * as db_row from './db/types/db_types';
import { add_inbox_gp, add_inbox_items } from './inbox';
import { expire_market_haggles } from './routes/haggle';

const { db, market_completed_cached, remove_player_cache_entry, report_error } = runtime;

export const MARKET_LISTING_LIFETIME = 14 * 24 * 60 * 60 * 1000;
const MARKET_MAINTENANCE_INTERVAL = 60 * 1000;
const EXPIRED_MARKET_SOURCE = { type: 'market_expired' } as const;

export function expire_market_listings_now(now = Date.now()): number {
	expire_market_haggles(now);
	const cutoff = now - MARKET_LISTING_LIFETIME;
	const expired = db.query<db_row.market_items, [number]>(
		'SELECT * FROM `market_items` WHERE COALESCE(`updated_at`, `published_at`) <= ? ' +
		'AND `reserved` = 0 AND NOT EXISTS (' +
			'SELECT 1 FROM `market_haggles` WHERE `listing_id` = `market_items`.`id` AND `status` = \'active\'' +
		') ORDER BY COALESCE(`updated_at`, `published_at`), `id`'
	).all(cutoff);
	let count = 0;
	for (const lot of expired) {
		const removed = db.query(
			'DELETE FROM `market_items` WHERE `id` = ? AND COALESCE(`updated_at`, `published_at`) <= ? ' +
			'AND `reserved` = 0 RETURNING `id`'
		).get(lot.id, cutoff);
		if (removed === null)
			continue;
		remove_player_cache_entry(market_completed_cached, lot.client_id, lot.id);
		if (lot.direction === 'buy')
			add_inbox_gp(lot.client_id, lot.escrow_gp, EXPIRED_MARKET_SOURCE);
		else {
			const sold_qty = lot.qty - lot.available - lot.reserved - lot.haggled;
			const payout = sold_qty * lot.price - lot.payout;
			add_inbox_items(lot.client_id, [{ item_id: lot.item_id, qty: lot.available }], EXPIRED_MARKET_SOURCE);
			add_inbox_gp(lot.client_id, payout, EXPIRED_MARKET_SOURCE);
		}
		count++;
	}
	return count;
}

export function expire_market_listings(now = Date.now()): number {
	return db.transaction(() => expire_market_listings_now(now)).immediate();
}

export function maintain_market_listings(): void {
	try {
		expire_market_listings();
	} catch (error) {
		report_error('Marketplace maintenance failed', error);
	}
	setTimeout(maintain_market_listings, MARKET_MAINTENANCE_INTERVAL);
}
