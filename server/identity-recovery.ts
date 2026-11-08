import type { Database } from 'bun:sqlite';
import type { JsonObject } from './http';

const VALIDATION_URL = 'https://melvoridle.com/cloud/api/validateToken.php';
const MAX_RESPONSE_BYTES = 65536;
export type VerifiedMelvorAccount = { playfab_id: string; username: string };
export type AccountVerifier = (token: unknown) => Promise<VerifiedMelvorAccount | 'invalid' | 'unavailable'>;
export const normalized_account_id = (value: string) => value.trim().toUpperCase();

// Only this fixed upstream receives the token. Never decode claims as proof, follow redirects,
// persist the token/response, or include upstream errors in logs or player-facing responses.
export async function verify_melvor_account(token: unknown, request: (url: string, options: RequestInit) => Promise<Response> = fetch): ReturnType<AccountVerifier> {
	if (typeof token !== 'string' || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return 'invalid';
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 8000);
	try {
		const response = await request(VALIDATION_URL, { method: 'POST', redirect: 'error',
			credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jwt: token }), signal: controller.signal });
		if (!response.ok) { await response.body?.cancel(); return response.status === 401 || response.status === 403 ? 'invalid' : 'unavailable'; }
		const reader = response.body?.getReader();
		if (!reader) return 'unavailable';
		const chunks: Uint8Array[] = []; let size = 0;
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); return 'unavailable'; }
				chunks.push(value);
			}
		} finally { reader.releaseLock(); }
		const bytes = new Uint8Array(size); let offset = 0;
		for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
		const json = JSON.parse(new TextDecoder().decode(bytes));
		const data = json?.data;
		if (typeof data?.playfabID !== 'string' || !data.playfabID.trim() || data.playfabID.length > 128 ||
			typeof data?.username !== 'string' || !data.username.trim() || data.username.length > 64) return 'invalid';
		return { playfab_id: normalized_account_id(data.playfabID), username: data.username };
	} catch { return 'unavailable'; }
	finally { clearTimeout(timeout); }
}

function reply(body: object, status = 200) {
	return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
const failed = (status: number) => reply({ error: 'account_recovery_failed' }, status);
function character_name(value: unknown): value is string {
	// Exact native character names, independent of Multiplayer's editable display name.
	return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

export function create_identity_recovery_service(database: Database, verify: AccountVerifier = verify_melvor_account) {
	async function account(json: JsonObject) {
		if (!character_name(json.character_name)) return failed(400);
		const verified = await verify(json.melvor_token);
		return verified === 'invalid' ? failed(422) : verified === 'unavailable' ? failed(503) : verified;
	}
	return {
		disable(client_id: number): Response {
			return database.transaction(() => {
				// Keep a marker even without an enrolled binding: first-time verification may be pending.
				database.query('UPDATE clients SET account_recovery_revocation=? WHERE id=?').run(crypto.randomUUID(), client_id);
				database.query('DELETE FROM verified_identity_accounts WHERE client_id=?').run(client_id);
				return reply({ enabled: false });
			}).immediate();
		},
		async enroll(client_id: number, json: JsonObject, still_authorized: () => boolean): Promise<Response> {
			const revocation = database.query<{ account_recovery_revocation: string }, [number]>(
				'SELECT account_recovery_revocation FROM clients WHERE id=?').get(client_id)?.account_recovery_revocation;
			const verified = await account(json);
			if (verified instanceof Response) return verified;
			return database.transaction(() => {
				if (!still_authorized()) return failed(401);
				const current = database.query<{ account_recovery_revocation: string }, [number]>(
					'SELECT account_recovery_revocation FROM clients WHERE id=?').get(client_id);
				if (!current || current.account_recovery_revocation !== revocation) return failed(409);
				const owner = database.query<{ playfab_id: string }, [number]>(
					'SELECT a.playfab_id FROM clients c JOIN melvor_accounts a ON a.id=c.melvor_account_id ' +
					'WHERE c.id=? AND c.disabled=0 AND c.deleted_at IS NULL').get(client_id);
				if (!owner || normalized_account_id(owner.playfab_id) !== verified.playfab_id) return failed(403);
				const existing = database.query<{ playfab_id: string }, [number]>(
					'SELECT playfab_id FROM verified_identity_accounts WHERE client_id=?').get(client_id);
				if (existing && existing.playfab_id !== verified.playfab_id) return failed(409);
				database.query('INSERT INTO verified_identity_accounts (client_id,playfab_id,character_name,verified_at) VALUES (?,?,?,?) ' +
					'ON CONFLICT(client_id) DO UPDATE SET character_name=excluded.character_name,verified_at=excluded.verified_at')
					.run(client_id, verified.playfab_id, String(json.character_name), Date.now());
				return reply({ enabled: true });
			}).immediate();
		},
		async list(json: JsonObject): Promise<Response> {
			const verified = await account(json);
			if (verified instanceof Response) return verified;
			const identities = database.query<{ client_id: number; display_name: string; last_active_at: number }, [string, string]>(
				'SELECT c.id AS client_id,c.display_name,c.last_multiplayer_active_at AS last_active_at ' +
				'FROM verified_identity_accounts v JOIN clients c ON c.id=v.client_id JOIN melvor_accounts a ON a.id=c.melvor_account_id ' +
				'WHERE v.playfab_id=? AND v.character_name=? AND upper(trim(a.playfab_id))=v.playfab_id ' +
				'AND c.disabled=0 AND c.deleted_at IS NULL ORDER BY c.last_multiplayer_active_at DESC,c.id LIMIT 50')
				.all(verified.playfab_id, String(json.character_name));
			return reply({ identities });
		},
		async connect(json: JsonObject): Promise<Response> {
			if (!Number.isSafeInteger(json.client_id) || Number(json.client_id) < 1) return failed(400);
			const verified = await account(json);
			if (verified instanceof Response) return verified;
			const credentials = database.query<{ client_identifier: string; client_key: string }, [number, string, string]>(
				'SELECT c.client_identifier,c.client_key FROM verified_identity_accounts v JOIN clients c ON c.id=v.client_id ' +
				'JOIN melvor_accounts a ON a.id=c.melvor_account_id WHERE c.id=? AND v.playfab_id=? AND v.character_name=? ' +
				'AND upper(trim(a.playfab_id))=v.playfab_id AND c.disabled=0 AND c.deleted_at IS NULL')
				.get(Number(json.client_id), verified.playfab_id, String(json.character_name));
			// Restore save proof; normal authentication still enforces all installation/account restrictions.
			return credentials ? reply({ credentials }) : failed(404);
		}
	};
}
