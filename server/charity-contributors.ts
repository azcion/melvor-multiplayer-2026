import type { Database } from 'bun:sqlite';
import { db } from './db';

export type CharityContributor = {
	client_id: number;
	icon_id: string;
};

export function add_charity_contribution(guild_id: number, item_id: string, client_id: number, qty: number,
	contributed_at: number, database: Database = db): void {
	database.query(
		'INSERT INTO `charity_contribution_lots` (`guild_id`, `item_id`, `client_id`, `qty`, `contributed_at`) ' +
		'VALUES(?, ?, ?, ?, ?)'
	).run(guild_id, item_id, client_id, qty, contributed_at);
}

export function consume_charity_contributions(guild_id: number, item_id: string, stack_qty: number, take_qty: number,
	database: Database = db): void {
	const attributed_qty = database.query<{ qty: number }, [number, string]>(
		'SELECT COALESCE(SUM(`qty`), 0) AS `qty` FROM `charity_contribution_lots` ' +
		'WHERE `guild_id` = ? AND `item_id` = ?'
	).get(guild_id, item_id)?.qty ?? 0;
	let remaining = Math.max(0, take_qty - Math.max(0, stack_qty - attributed_qty));
	if (remaining === 0) return;
	const lots = database.query<{ id: number; qty: number }, [number, string]>(
		'SELECT `id`, `qty` FROM `charity_contribution_lots` WHERE `guild_id` = ? AND `item_id` = ? ' +
		'ORDER BY `contributed_at`, `id`'
	).all(guild_id, item_id);
	for (const lot of lots) {
		if (remaining === 0) break;
		const consumed = Math.min(remaining, lot.qty);
		if (consumed === lot.qty)
			database.query('DELETE FROM `charity_contribution_lots` WHERE `id` = ?').run(lot.id);
		else
			database.query('UPDATE `charity_contribution_lots` SET `qty` = `qty` - ? WHERE `id` = ?')
				.run(consumed, lot.id);
		remaining -= consumed;
	}
}

export function remove_charity_contributor_quantity(guild_id: number, item_id: string, client_id: number, qty: number,
	database: Database = db): number {
	let remaining = qty;
	const lots = database.query<{ id: number; qty: number }, [number, string, number]>(
		'SELECT `id`, `qty` FROM `charity_contribution_lots` ' +
		'WHERE `guild_id` = ? AND `item_id` = ? AND `client_id` = ? ORDER BY `contributed_at` DESC, `id` DESC'
	).all(guild_id, item_id, client_id);
	for (const lot of lots) {
		if (remaining === 0) break;
		const removed = Math.min(remaining, lot.qty);
		if (removed === lot.qty)
			database.query('DELETE FROM `charity_contribution_lots` WHERE `id` = ?').run(lot.id);
		else
			database.query('UPDATE `charity_contribution_lots` SET `qty` = `qty` - ? WHERE `id` = ?')
				.run(removed, lot.id);
		remaining -= removed;
	}
	return qty - remaining;
}

export function list_charity_contributor_client_ids(guild_id: number, item_id: string,
	database: Database = db): Set<number> {
	return new Set(database.query<{ client_id: number }, [number, string]>(
		'SELECT DISTINCT `client_id` FROM `charity_contribution_lots` ' +
		'WHERE `guild_id` = ? AND `item_id` = ?'
	).all(guild_id, item_id).map(row => row.client_id));
}

export function list_charity_contributors(guild_id: number, database: Database = db): Map<string, CharityContributor[]> {
	const rows = database.query<CharityContributor & { item_id: string; qty: number; first_lot_id: number }, [number]>(
		'SELECT lot.`item_id`, lot.`client_id`, client.`icon_id`, SUM(lot.`qty`) AS `qty`, ' +
		'MIN(lot.`id`) AS `first_lot_id` FROM `charity_contribution_lots` AS lot ' +
		'JOIN `clients` AS client ON client.`id` = lot.`client_id` WHERE lot.`guild_id` = ? ' +
		'GROUP BY lot.`item_id`, lot.`client_id`, client.`icon_id` ' +
		'ORDER BY lot.`item_id`, `qty` DESC, MIN(lot.`contributed_at`), `first_lot_id`, lot.`client_id`'
	).all(guild_id);
	const contributors = new Map<string, CharityContributor[]>();
	for (const row of rows) {
		const item_contributors = contributors.get(row.item_id) ?? [];
		if (item_contributors.length >= 3) continue;
		item_contributors.push({ client_id: row.client_id, icon_id: row.icon_id });
		contributors.set(row.item_id, item_contributors);
	}
	return contributors;
}
