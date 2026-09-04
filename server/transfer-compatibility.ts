import { db } from './db';
import { get_request_mod_version } from './http';

export const LEGACY_TRANSFER_VERSION = '1.4.5';

export function is_legacy_transfer_request(req: Request): boolean {
	return get_request_mod_version(req) === LEGACY_TRANSFER_VERSION;
}

export function client_uses_legacy_transfer_protocol(client_id: number): boolean {
	return db.query(
		'SELECT 1 FROM `client_runtime_snapshots` WHERE `client_id` = ? AND `mod_version` = ? LIMIT 1'
	).get(client_id, LEGACY_TRANSFER_VERSION) !== null;
}

export function participants_use_legacy_trade_protocol(req: Request, client_ids: number[]): boolean {
	return is_legacy_transfer_request(req) || client_ids.some(client_uses_legacy_transfer_protocol);
}
