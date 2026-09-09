import { db } from './db';
import type { JsonObject } from './http';
import type * as db_row from './db/types/db_types';

export const MAX_INBOX_EXISTING_ITEM_IDS = 512;

type InboxItem = { item_id: string; qty: number };

export type InboxSource = {
	type: string;
	name?: string;
};

export function get_inbox_source_name(client_id: number): string {
	return (db.query<{ display_name: string }, [number]>(
		' SELECT `display_name` FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(client_id)?.display_name ?? '').trim();
}

export function parse_inbox_existing_item_ids(value: unknown): string[] | null {
	if (!Array.isArray(value) || value.length > MAX_INBOX_EXISTING_ITEM_IDS)
		return null;
	const item_ids = value.map(item_id => typeof item_id === 'string' && item_id.length > 0 ? item_id : null);
	if (item_ids.some(item_id => item_id === null))
		return null;
	const unique = new Set(item_ids as string[]);
	return unique.size === item_ids.length ? item_ids as string[] : null;
}

export function add_inbox_items(client_id: number, items: readonly InboxItem[], source: InboxSource = { type: 'other' }): void {
	let added = false;
	const created_at = Date.now();
	const source_name = source.name?.trim() ?? '';
	for (const item of items) {
		if (item.qty <= 0)
			continue;
		db.query(
			'INSERT INTO `inbox_items` (`client_id`, `source_type`, `source_name`, `item_id`, `qty`, `created_at`, `updated_at`) ' +
			'VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT (`client_id`, `source_type`, `source_name`, `item_id`) ' +
			'DO UPDATE SET `qty` = `qty` + excluded.`qty`, ' +
			'`created_at` = COALESCE(`inbox_items`.`created_at`, excluded.`created_at`), ' +
			'`updated_at` = excluded.`updated_at`'
		).run(client_id, source.type, source_name, item.item_id, item.qty, created_at, created_at);
		added = true;
	}
	if (added)
		db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(client_id);
}

export function add_inbox_gp(client_id: number, qty: number, source: InboxSource = { type: 'other' }): void {
	add_inbox_items(client_id, [{ item_id: 'melvorD:GP', qty }], source);
}

export function get_inbox(client_id: number): { items: JsonObject[]; groups: JsonObject[]; pending_claim: boolean } {
	const items = db.query<db_row.inbox_items, [number]>(
		' SELECT * FROM `inbox_items` WHERE `client_id` = ? ' +
		'ORDER BY COALESCE(`created_at`, 0), `source_type`, `source_name`, `item_id`'
	).all(client_id);
	const groups: JsonObject[] = [];
	const groups_by_source = new Map<string, { source_type: string; source_name: string; items: JsonObject[] }>();
	for (const item of items) {
		const key = `${item.source_type}\0${item.source_name}`;
		let group = groups_by_source.get(key);
		if (group === undefined) {
			group = { source_type: item.source_type, source_name: item.source_name, items: [] };
			groups_by_source.set(key, group);
			groups.push(group);
		}
		group.items.push({ item_id: item.item_id, qty: item.qty });
	}
	groups.sort((left, right) => Number(left.source_type === 'other') - Number(right.source_type === 'other'));
	const pending_claim = db.query(
		' SELECT 1 FROM `inbox_claims` WHERE `client_id` = ? AND `acknowledged_at` IS NULL LIMIT 1'
	).get(client_id) !== null;
	const item_totals = new Map<string, number>();
	for (const item of items)
		item_totals.set(item.item_id, (item_totals.get(item.item_id) ?? 0) + item.qty);
	return {
		items: [...item_totals].sort(([left], [right]) => left.localeCompare(right))
			.map(([item_id, qty]) => ({ item_id, qty })),
		groups,
		pending_claim
	};
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
			' SELECT * FROM `inbox_items` WHERE `client_id` = ? ORDER BY `item_id`, `source_type`, `source_name`'
		).all(client_id);
		const admitted = new Set<string>();
		const selected = available.filter(item => {
			if (item.item_id === 'melvorD:GP' || existing.has(item.item_id) || admitted.has(item.item_id))
				return true;
			if (remaining_slots <= 0)
				return false;
			remaining_slots--;
			admitted.add(item.item_id);
			return true;
		});
		if (selected.length === 0)
			return null;

		const claim_id = crypto.randomUUID();
		db.query(
			' INSERT INTO `inbox_claims` (`id`, `client_id`, `created_at`) VALUES(?, ?, ?)'
		).run(claim_id, client_id, Date.now());
		const totals = new Map<string, number>();
		for (const item of selected) {
			totals.set(item.item_id, (totals.get(item.item_id) ?? 0) + item.qty);
			db.query(
				' DELETE FROM `inbox_items` WHERE `client_id` = ? AND `source_type` = ? AND `source_name` = ? AND `item_id` = ?'
			).run(client_id, item.source_type, item.source_name, item.item_id);
		}
		for (const [item_id, qty] of totals) {
			db.query(
				' INSERT INTO `inbox_claim_items` (`claim_id`, `item_id`, `qty`) VALUES(?, ?, ?)'
			).run(claim_id, item_id, qty);
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
