import { observe_economy_load, detect_save_rollback } from './save-rollback';
import type { Database } from 'bun:sqlite';

export type LoadedSaveReport = {
	load_id: string;
	save_timestamp: number | null;
	client_loaded_at: number;
	capture_source: 'decode' | 'character_loaded';
};

export function parse_loaded_save(value: unknown): LoadedSaveReport | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const input = value as Record<string, unknown>;
	if (typeof input.load_id !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.load_id) ||
		(input.save_timestamp !== null && (!Number.isSafeInteger(input.save_timestamp) ||
			(input.save_timestamp as number) <= 0)) ||
		!Number.isSafeInteger(input.client_loaded_at) || (input.client_loaded_at as number) < 0 ||
		(input.capture_source !== 'decode' && input.capture_source !== 'character_loaded')) return null;
	return { load_id: input.load_id.toLowerCase(), save_timestamp: input.save_timestamp as number | null,
		client_loaded_at: input.client_loaded_at as number, capture_source: input.capture_source };
}

// Tracking only: reconnects preserve the first observation, and no report changes economy state.
export function record_character_save_load(database: Database, client_id: number,
	report: LoadedSaveReport | undefined, now = Date.now(), installation_id: string | null = null): number | null {
	if (report === undefined) return null;
	return database.transaction(() => {
		const existing = database.query('SELECT id FROM character_save_loads WHERE client_id=? AND load_id=?').get(client_id,report.load_id);
		const id = database.query<{ id: number }, [number, string, number | null, number, string, number, number]>(
			'INSERT INTO character_save_loads (client_id, load_id, save_timestamp, client_loaded_at, capture_source, ' +
			'first_reported_at, last_reported_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
			'ON CONFLICT(client_id, load_id) DO UPDATE SET last_reported_at = MAX(last_reported_at, excluded.last_reported_at) ' +
			'RETURNING id'
		).get(client_id, report.load_id, report.save_timestamp, report.client_loaded_at, report.capture_source, now, now)!.id;
		observe_economy_load(database,id,installation_id);
		if (existing === null) detect_save_rollback(database,id,now);
		return id;
	}).immediate();
}
