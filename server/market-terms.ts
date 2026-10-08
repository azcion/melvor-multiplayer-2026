import { db } from './db';
import type { market_items } from './db/types/db_types';
import { is_client_version_at_least } from './client-version-policy';
import { get_transfer_currency_cap } from './transfer-caps';
import type { EconomyEffect } from './economy';

export function supports_market_terms(version: string | null): boolean {
	return version === 'development' || is_client_version_at_least(version, '1.6.6');
}
export function legacy_market_filter(alias = 'm'): string {
	return `${alias}.currency_id='melvorD:GP' AND ${alias}.alliance_price=0 AND ${alias}.purchase_limit=0 AND ${alias}.allow_haggles=1`;
}
export function market_terms_readable(lot: market_items, version: string | null): boolean {
	return supports_market_terms(version) || (lot.currency_id === 'melvorD:GP' && lot.alliance_price === 0 &&
		lot.purchase_limit === 0 && lot.allow_haggles === 1);
}
export function market_currency_effect(currency_id: string, qty: number): EconomyEffect {
	return currency_id === 'melvorD:GP' ? { storage: 'gp', qty } : { storage: 'bank', item_id: currency_id, qty };
}
export function market_owner_key(client_id: number): string {
	const account = db.query<{ melvor_account_id: number | null }, [number]>('SELECT melvor_account_id FROM clients WHERE id=?').get(client_id);
	return account?.melvor_account_id ? `account:${account.melvor_account_id}` : `client:${client_id}`;
}
export function market_remaining_limit(lot: market_items, client_id: number): number {
	if (!lot.purchase_limit) return lot.available;
	const key = market_owner_key(client_id);
	const used = db.query<{ qty: number }, [number, string]>('SELECT qty FROM market_purchases WHERE listing_id=? AND owner_key=?').get(lot.id, key)?.qty ?? 0;
	const reserved = db.query<{ qty: number }, [number, string]>(`SELECT COALESCE(SUM(h.item_qty),0) qty FROM market_haggles h
		JOIN clients c ON c.id=h.initiator_id WHERE h.listing_id=? AND h.status='active' AND h.direction='sell'
		AND CASE WHEN c.melvor_account_id IS NULL THEN 'client:' || c.id ELSE 'account:' || c.melvor_account_id END=?`).get(lot.id, key)?.qty ?? 0;
	return Math.max(0, Math.min(lot.available, lot.purchase_limit - used - reserved));
}
export function record_market_purchase(lot: market_items, client_id: number, qty: number): void {
	if (!lot.purchase_limit) return;
	db.query(`INSERT INTO market_purchases(listing_id,owner_key,qty) VALUES(?,?,?)
		ON CONFLICT(listing_id,owner_key) DO UPDATE SET qty=qty+excluded.qty`).run(lot.id, market_owner_key(client_id), qty);
}
export function market_price(lot: market_items, guild_id: number): number {
	return guild_id !== lot.guild_id && lot.alliance_price > 0 ? lot.alliance_price : lot.price;
}
export function market_currency_cap(currency_id: string): number {
	return get_transfer_currency_cap(currency_id) ?? 0;
}
