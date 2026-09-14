import { db } from './db';
import type { JsonObject } from './http';

export type EconomyEffect = {
	storage: 'bank' | 'gp' | 'transfer';
	item_id?: string;
	qty: number;
	destroyable?: boolean;
};

export type EconomyReceipt = {
	id: string;
	kind: string;
	effects: EconomyEffect[];
};

export function economy_item_effects(
	items: Array<{ id: string; qty: number }> | Array<{ item_id: string; qty: number }>,
	storage: 'bank' | 'transfer',
	multiplier = 1,
	destroyable = false
): EconomyEffect[] {
	return items.map(item => {
		const item_id = 'id' in item ? item.id : item.item_id;
		return item_id === 'melvorD:GP' && storage === 'bank'
			? { storage: 'gp', qty: item.qty * multiplier }
			: {
				storage,
				item_id,
				qty: item.qty * multiplier,
				...(destroyable ? { destroyable: true } : {})
			};
	});
}

type EconomyResponse = Record<string, unknown> & {
	success?: boolean;
	effects?: EconomyEffect[];
};

type StoredReceipt = {
	client_id: number;
	kind: string;
	response_json: string;
	acknowledged_at: number | null;
};

function valid_command_id(value: unknown): value is string {
	return typeof value === 'string' && value.length === 36 && /^[0-9a-f-]+$/.test(value);
}

function receipt_response(id: string, kind: string, response: EconomyResponse): EconomyResponse {
	const effects = response.effects ?? [];
	const value = { ...response };
	delete value.effects;
	return { ...value, receipt: { id, kind, effects } satisfies EconomyReceipt };
}

// Replays remain readable after runtime metadata, Guild membership, or request schemas change.
// Only the original authenticated owner and command kind may recover this immutable result.
export function replay_economy_command(client_id: number, command_id: unknown, kind: string): JsonObject | null | undefined {
	if (!valid_command_id(command_id)) return null;
	const existing = db.query<StoredReceipt, [string]>(
		'SELECT `client_id`, `kind`, `response_json`, `acknowledged_at` FROM `economy_receipts` WHERE `id` = ?'
	).get(command_id);
	if (existing === null) return undefined;
	if (existing.client_id !== client_id || existing.kind !== kind) return null;
	const response = JSON.parse(existing.response_json) as JsonObject;
	return existing.acknowledged_at === null ? response : { ...response, receipt: null };
}

export function run_economy_command(
	client_id: number,
	command_id: unknown,
	kind: string,
	operation: () => EconomyResponse
): JsonObject | null {
	if (!valid_command_id(command_id))
		return null;

	const execute = db.transaction(() => {
		const replay = replay_economy_command(client_id, command_id, kind);
		if (replay !== undefined) return replay;

		const result = operation();
		if (result.success !== true)
			return result as JsonObject;
		const response = receipt_response(command_id, kind, result);
		db.query(
			'INSERT INTO `economy_receipts` (`id`, `client_id`, `kind`, `response_json`, `created_at`) ' +
			'VALUES(?, ?, ?, ?, ?)'
		).run(command_id, client_id, kind, JSON.stringify(response), Date.now());
		db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(client_id);
		return response as JsonObject;
	});
	return execute.immediate();
}

export function pending_economy_receipts(client_id: number): EconomyReceipt[] {
	return db.query<{ response_json: string }, [number]>(
		'SELECT `response_json` FROM `economy_receipts` WHERE `client_id` = ? AND `acknowledged_at` IS NULL ' +
		'ORDER BY `created_at`, `id` LIMIT 64'
	).all(client_id).map(row => (JSON.parse(row.response_json) as { receipt: EconomyReceipt }).receipt);
}

export function acknowledge_economy_receipt(client_id: number, receipt_id: unknown, now = Date.now()): boolean | null {
	if (!valid_command_id(receipt_id))
		return null;
	const acknowledge = db.transaction(() => {
		const receipt = db.query<{ acknowledged_at: number | null }, [string, number]>(
			'SELECT `acknowledged_at` FROM `economy_receipts` WHERE `id` = ? AND `client_id` = ?'
		).get(receipt_id, client_id);
		if (receipt === null)
			return false;
		if (receipt.acknowledged_at === null) {
			db.query('UPDATE `economy_receipts` SET `acknowledged_at` = ? WHERE `id` = ?').run(now, receipt_id);
			db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(client_id);
		}
		return true;
	});
	return acknowledge.immediate();
}
