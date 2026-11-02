import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { JsonObject } from './http';

export function compact_work_reply(database: Database, response: string): { response: string; catalog_hash: string | null } {
	const value = JSON.parse(response) as JsonObject;
	const model = value.equipment_projects;
	if (!model || typeof model !== 'object' || Array.isArray(model) ||
		!Object.hasOwn(model, 'catalog') || !Object.hasOwn(model, 'access'))
		return { response, catalog_hash: null };
	const { catalog, access, ...state } = model as JsonObject;
	const definitions = JSON.stringify({ catalog, access });
	const hash = createHash('sha256').update(definitions).digest('hex');
	database.query('INSERT OR IGNORE INTO expedition_work_catalogs(hash, definitions) VALUES (?, ?)').run(hash, definitions);
	return { response: JSON.stringify({ ...value, equipment_projects: state }), catalog_hash: hash };
}

export function restore_work_reply(database: Database, response: string, catalog_hash: string | null): JsonObject {
	const value = JSON.parse(response) as JsonObject;
	if (catalog_hash === null) return value;
	const catalog = database.query<{ definitions: string }, [string]>(
		'SELECT definitions FROM expedition_work_catalogs WHERE hash = ?'
	).get(catalog_hash);
	if (!catalog || !value.equipment_projects || typeof value.equipment_projects !== 'object' || Array.isArray(value.equipment_projects))
		throw new Error('Missing saved Expedition work catalog');
	Object.assign(value.equipment_projects, JSON.parse(catalog.definitions));
	return value;
}

export function store_work_reply(database: Database, client: number, operation: string, request_hash: string,
	response: JsonObject, now: number): void {
	const compact = compact_work_reply(database, JSON.stringify(response));
	database.query('INSERT INTO expedition_work_operations(client_id, operation_id, request_hash, response, created_at, catalog_hash) VALUES (?, ?, ?, ?, ?, ?)')
		.run(client, operation, request_hash, compact.response, now, compact.catalog_hash);
}

export function compact_work_reply_batch(database: Database, after_row: number, limit = 50) {
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
		throw new Error('Compaction batch size must be between 1 and 100');
	return database.transaction(() => {
		const rows = database.query<{ row_id: number; response: string }, [number, number]>(
			'SELECT rowid AS row_id, response FROM expedition_work_operations WHERE rowid > ? AND catalog_hash IS NULL ORDER BY rowid LIMIT ?'
		).all(after_row, limit);
		let compacted = 0;
		let saved_bytes = 0;
		for (const row of rows) {
			const compact = compact_work_reply(database, row.response);
			if (compact.catalog_hash === null) continue;
			database.query('UPDATE expedition_work_operations SET response=?, catalog_hash=? WHERE rowid=? AND catalog_hash IS NULL')
				.run(compact.response, compact.catalog_hash, row.row_id);
			compacted++;
			saved_bytes += Buffer.byteLength(row.response) - Buffer.byteLength(compact.response);
		}
		return { scanned: rows.length, compacted, saved_bytes, after_row: rows.at(-1)?.row_id ?? after_row };
	}).immediate();
}
