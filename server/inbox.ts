import { db } from './db';
import type { JsonObject } from './http';
import type * as db_row from './db/types/db_types';

export const MAX_INBOX_EXISTING_ITEM_IDS = 512;

type InboxItem = { item_id: string; qty: number };

export function parse_inbox_existing_item_ids(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_INBOX_EXISTING_ITEM_IDS)
		return null;
	const item_ids = value.map(item_id => typeof item_id === 'string' && item_id.length > 0 ? item_id : null);
	if (item_ids.some(item_id => item_id === null))
		return null;
	const unique = new Set(item_ids as string[]);
	return unique.size === item_ids.length ? item_ids as string[] : null;
}

export function add_inbox_items(client_id: number, items: readonly InboxItem[]): void {
	let added = false;
	const created_at = Date.now();
	for (const item of items) {
		if (item.qty <= 0)
			continue;
		db.query(
			'INSERT INTO `inbox_items` (`client_id`, `item_id`, `qty`, `created_at`, `updated_at`) VALUES(?, ?, ?, ?, ?) ' +
			'ON CONFLICT (`client_id`, `item_id`) DO UPDATE SET `qty` = `qty` + excluded.`qty`, ' +
			'`created_at` = COALESCE(`inbox_items`.`created_at`, excluded.`created_at`), ' +
			'`updated_at` = excluded.`updated_at`'
		).run(client_id, item.item_id, item.qty, created_at, created_at);
		added = true;
	}
	if (added)
		db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(client_id);
}

export function add_inbox_gp(client_id: number, qty: number): void {
	add_inbox_items(client_id, [{ item_id: 'melvorD:GP', qty }]);
}

export function get_inbox(client_id: number): { items: JsonObject[]; pending_claim: boolean } {
	const items = db.query<db_row.inbox_items, [number]>(
		' SELECT `client_id`, `item_id`, `qty` FROM `inbox_items` WHERE `client_id` = ? ORDER BY `item_id`'
	).all(client_id).map(item => ({ item_id: item.item_id, qty: item.qty }));
	const pending_claim = db.query(
		' SELECT 1 FROM `inbox_claims` WHERE `client_id` = ? AND `acknowledged_at` IS NULL LIMIT 1'
	).get(client_id) !== null;
	return { items, pending_claim };
}

export function has_pending_inbox(client_id: number): boolean {
	return db.query(
		' SELECT 1 FROM `inbox_items` WHERE `client_id` = ? LIMIT 1'
	).get(client_id) !== null || db.query(
		' SELECT 1 FROM `inbox_claims` WHERE `client_id` = ? AND `acknowledged_at` IS NULL LIMIT 1'
	).get(client_id) !== null;
}

function get_inbox_claim(claim_id: string, client_id: number): db_row.inbox_claims | null {
	return db.query<db_row.inbox_claims, [string, number]>(
		' SELECT * FROM `inbox_claims` WHERE `id` = ? AND `client_id` = ? AND `acknowledged_at` IS NULL LIMIT 1'
	).get(claim_id, client_id);
}

export function get_inbox_claim_view(claim_id: string, client_id: number): JsonObject | null {
	const claim = get_inbox_claim(claim_id, client_id);
	if (claim === null)
		return null;
	return {
		claim_id: claim.id,
		items: db.query<Pick<db_row.inbox_claim_items, 'item_id' | 'qty'>, [string]>(
			' SELECT `item_id`, `qty` FROM `inbox_claim_items` WHERE `claim_id` = ? ORDER BY `item_id`'
		).all(claim.id).map(item => ({ id: item.item_id, qty: item.qty }))
	};
}

export function create_inbox_claim(
	client_id: number,
	existing_item_ids: string[],
	available_slots: number
): string | null {
	const create_claim = db.transaction(() => {
		const outstanding = db.query<Pick<db_row.inbox_claims, 'id'>, [number]>(
			' SELECT `id` FROM `inbox_claims` WHERE `client_id` = ? AND `acknowledged_at` IS NULL LIMIT 1'
		).get(client_id);
		if (outstanding !== null)
			return outstanding.id;

		const existing = new Set(existing_item_ids);
		let remaining_slots = available_slots;
		const available = db.query<db_row.inbox_items, [number]>(
			' SELECT * FROM `inbox_items` WHERE `client_id` = ? ORDER BY `item_id`'
		).all(client_id);
		const selected = available.filter(item => {
			if (item.item_id === 'melvorD:GP' || existing.has(item.item_id))
				return true;
			if (remaining_slots <= 0)
				return false;
			remaining_slots--;
			return true;
		});
		if (selected.length === 0)
			return null;

		const claim_id = crypto.randomUUID();
		db.query(
			' INSERT INTO `inbox_claims` (`id`, `client_id`, `created_at`) VALUES(?, ?, ?)'
		).run(claim_id, client_id, Date.now());
		for (const item of selected) {
			db.query(
				' INSERT INTO `inbox_claim_items` (`claim_id`, `item_id`, `qty`) VALUES(?, ?, ?)'
			).run(claim_id, item.item_id, item.qty);
			db.query(
				' DELETE FROM `inbox_items` WHERE `client_id` = ? AND `item_id` = ?'
			).run(client_id, item.item_id);
		}
		return claim_id;
	});
	return create_claim.immediate();
}

export function acknowledge_inbox_claim(client_id: number, claim_id: string): boolean {
	const acknowledged = db.transaction(() => {
		const claim = db.query(
			' SELECT `acknowledged_at` FROM `inbox_claims` WHERE `id` = ? AND `client_id` = ? LIMIT 1'
		).get(claim_id, client_id) as { acknowledged_at: number | null } | null;
		if (claim === null)
			return false;
		if (claim.acknowledged_at === null)
			db.query(' UPDATE `inbox_claims` SET `acknowledged_at` = ? WHERE `id` = ?').run(Date.now(), claim_id);
		return true;
	});
	return acknowledged.immediate();
}
