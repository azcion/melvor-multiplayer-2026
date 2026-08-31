import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { is_installation_id } from './diagnostics';

function credential_hash(key: string): string { return createHash('sha256').update(key).digest('hex'); }
export function authenticate_installation(client_id: number, installation_id: unknown, key: unknown): 'valid' | 'invalid' | 'revoked' {
	if (!is_installation_id(installation_id) || !is_installation_id(key)) return 'invalid';
	const row = db.query<{ credential_hash: string | null; revoked_at: number | null }, [number, string]>(
		'SELECT credential_hash, revoked_at FROM installation_credentials WHERE client_id = ? AND installation_id = ?'
	).get(client_id, installation_id.toLowerCase());
	if (!row?.credential_hash || !/^[0-9a-f]{64}$/.test(row.credential_hash) || !timingSafeEqual(Buffer.from(row.credential_hash, 'hex'), Buffer.from(credential_hash(key), 'hex'))) return 'invalid';
	return row.revoked_at === null ? 'valid' : 'revoked';
}
export function enroll_installation(client_id: number, installation_id: unknown, key: unknown): 'enrolled' | 'invalid' | 'conflict' {
	if (!is_installation_id(installation_id) || !is_installation_id(key)) return 'invalid';
	// A valid session is required by the route. Replays use the key persisted locally before sending.
	return db.transaction(() => {
		const row = db.query<{ credential_hash: string | null; revoked_at: number | null }, [number, string]>(
			'SELECT credential_hash, revoked_at FROM installation_credentials WHERE client_id = ? AND installation_id = ?'
		).get(client_id, installation_id.toLowerCase());
		if (row?.revoked_at != null) return 'conflict';
		if (!row && (db.query<{ count: number }, [number]>('SELECT COUNT(*) AS count FROM installation_credentials WHERE client_id = ?').get(client_id)?.count ?? 0) >= 32) return 'conflict';
		if (!db.query('SELECT 1 FROM client_installations WHERE client_id = ? AND installation_id = ?').get(client_id, installation_id.toLowerCase())) return 'conflict';
		const hash = credential_hash(key);
		if (row && row.credential_hash !== hash) return 'conflict';
		db.query('INSERT INTO installation_credentials (client_id, installation_id, credential_hash) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
			.run(client_id, installation_id.toLowerCase(), hash);
		return 'enrolled';
	}).immediate();
}
export function revoke_installation(client_id: number, installation_id: string): boolean {
	if (!is_installation_id(installation_id)) return false;
	return db.transaction(() => {
		const result = db.query('UPDATE installation_credentials SET revoked_at = COALESCE(revoked_at, ?) WHERE client_id = ? AND installation_id = ?')
			.run(Date.now(), client_id, installation_id.toLowerCase());
		db.query('DELETE FROM client_sessions WHERE client_id = ? AND installation_id = ?').run(client_id, installation_id.toLowerCase());
		return result.changes > 0;
	}).immediate();
}
