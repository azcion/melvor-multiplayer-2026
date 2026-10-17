import { RequestLimitPolicy } from './security';
import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';

export const CHAT_CODE_LIFETIME = 5 * 60_000;
export const CHAT_SESSION_LIFETIME = 30 * 86400_000;
export const CHAT_SESSION_IDLE = 7 * 86400_000;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const secret_hash = (secret: string): string => createHash('sha256').update(secret).digest('hex');
export const browser_csrf = (token: string): string => secret_hash(`chat-csrf:${token}`);
export const CHAT_LINK_LIMIT = 10;
export type ChatBrowser = { id: number; created_at: number };
export type BrowserSession = {
	id: number;
	client_id: number;
	display_name: string;
	expires_at: number;
	last_browser_seen_at: number;
};
function eligible(db: Database, client_id: number): boolean {
	return (
		db.query('SELECT 1 FROM clients WHERE id=? AND disabled=0 AND deleted_at IS NULL').get(client_id) !== null
	);
}
function active_count(db: Database, client_id: number, now: number): number {
	return db
		.query<
			{ n: number },
			[number, number, number]
		>('SELECT COUNT(*) n FROM chat_browser_sessions WHERE client_id=? AND revoked_at IS NULL AND expires_at>? AND last_browser_seen_at>?')
		.get(client_id, now, now - CHAT_SESSION_IDLE)!.n;
}
export function issue_browser_code(db: Database, client_id: number, now = Date.now()) {
	return db
		.transaction(() => {
			if (!eligible(db, client_id)) return { status: 401 };
			if (active_count(db, client_id, now) >= 10) return { status: 409 };
			const window = db
				.query<
					{ window_start: number; issued_count: number },
					[number]
				>('SELECT * FROM chat_pairing_issuance WHERE client_id=?')
				.get(client_id);
			if (window && now < window.window_start + 600_000 && window.issued_count >= 3)
				return { status: 429, retry_after: Math.ceil((window.window_start + 600_000 - now) / 1000) };
			const start = window && now < window.window_start + 600_000 ? window.window_start : now;
			const count = start === window?.window_start ? window.issued_count + 1 : 1;
			db.query(
				'INSERT INTO chat_pairing_issuance VALUES (?,?,?) ON CONFLICT(client_id) DO UPDATE SET window_start=excluded.window_start, issued_count=excluded.issued_count'
			).run(client_id, start, count);
			db.query('DELETE FROM chat_pairing_codes WHERE client_id=? OR expires_at<=?').run(client_id, now);
			const code = Array.from(randomBytes(12), byte => ALPHABET[byte & 31]).join('');
			db.query('INSERT INTO chat_pairing_codes VALUES (?,?,?,?,NULL)').run(
				secret_hash(code),
				client_id,
				now,
				now + CHAT_CODE_LIFETIME
			);
			return { status: 200, code: code.match(/.{4}/g)!.join('-'), expires_at: now + CHAT_CODE_LIFETIME };
		})
		.immediate();
}
// A container without a live identity link is stale. Its cookie cannot mint a new
// container implicitly; the browser must explicitly clear it before fresh pairing.
export function get_browser(db: Database, token: string, now = Date.now()): ChatBrowser | null {
	const browser = get_browser_record(db, token);
	return browser && list_browser_identities(db, browser.id, now).length > 0 ? browser : null;
}
export function get_browser_record(db: Database, token: string): ChatBrowser | null {
	if (!/^[a-f0-9]{64}$/.test(token)) return null;
	return db.query<ChatBrowser, [string]>(
		'SELECT id,created_at FROM chat_browsers WHERE token_hash=? AND revoked_at IS NULL'
	).get(secret_hash(token));
}
export function list_browser_identities(db: Database, browser_id: number, now = Date.now()): BrowserSession[] {
	return db.query<BrowserSession, [number, number, number]>(`
		SELECT s.id,s.client_id,c.display_name,s.expires_at,s.last_browser_seen_at
		FROM chat_browser_sessions s JOIN clients c ON c.id=s.client_id
		WHERE s.browser_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_browser_seen_at>?
		AND c.disabled=0 AND c.deleted_at IS NULL ORDER BY s.id LIMIT 10
	`).all(browser_id, now, now - CHAT_SESSION_IDLE);
}
export function pair_browser(db: Database, input: unknown, at?: number, browser_token?: string) {
	if (typeof input !== 'string' || input.length > 64) return null;
	const code = input.toUpperCase().replace(/[\s-]/g, '');
	if (!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(code)) return null;
	return db.transaction(() => {
		const now = at ?? Date.now();
		// Recheck inside the write transaction, after HTTP body parsing. In
		// particular, a concurrent logout-all must not leave an orphan link.
		let browser = browser_token === undefined ? null : get_browser(db, browser_token, now);
		if (browser_token !== undefined && !browser) return null;
		const row = db.query<{ client_id: number }, [string, number]>(
			'SELECT client_id FROM chat_pairing_codes WHERE code_hash=? AND consumed_at IS NULL AND expires_at>?'
		).get(secret_hash(code), now);
		if (!row || !eligible(db, row.client_id)) return null;
		const existing = browser && list_browser_identities(db, browser.id, now).find(link => link.client_id === row.client_id);
		if (!existing && (active_count(db, row.client_id, now) >= CHAT_LINK_LIMIT ||
			(browser && list_browser_identities(db, browser.id, now).length >= CHAT_LINK_LIMIT))) return null;
		db.query('UPDATE chat_pairing_codes SET consumed_at=? WHERE code_hash=?').run(now, secret_hash(code));
		if (existing) return { id: existing.id, expires_at: existing.expires_at, token: browser_token!, fresh: false };
		const token = browser_token ?? randomBytes(32).toString('hex');
		if (!browser) {
			const result = db.query('INSERT INTO chat_browsers(token_hash,created_at) VALUES (?,?)').run(secret_hash(token), now);
			browser = { id: Number(result.lastInsertRowid), created_at: now };
		}
		// Preserve the 190 token_hash column for source compatibility. Only the
		// first link shares the browser hash; later link secrets are never exposed.
		const link_hash = browser_token === undefined ? secret_hash(token) : secret_hash(randomBytes(32).toString('hex'));
		db.query(`UPDATE chat_browser_sessions SET revoked_at=?
			WHERE browser_id=? AND client_id=? AND revoked_at IS NULL`).run(now, browser.id, row.client_id);
		const result = db.query(`INSERT INTO chat_browser_sessions
			(token_hash,client_id,created_at,expires_at,last_browser_seen_at,browser_id) VALUES (?,?,?,?,?,?)`
		).run(link_hash, row.client_id, now, now + CHAT_SESSION_LIFETIME, now, browser.id);
		return { token, id: Number(result.lastInsertRowid), expires_at: now + CHAT_SESSION_LIFETIME, fresh: browser_token === undefined };
	}).immediate();
}
export function get_browser_session(db: Database, token: string, link_id: number, now = Date.now()): BrowserSession | null {
	const browser = get_browser_record(db, token);
	if (!browser) return null;
	return list_browser_identities(db, browser.id, now).find(link => link.id === link_id) ?? null;
}
export function revoke_browser(db: Database, token: string, now = Date.now()): boolean {
	return db.transaction(() => {
		const browser = get_browser_record(db, token);
		if (!browser) return false;
		db.query('UPDATE chat_browsers SET revoked_at=? WHERE id=?').run(now, browser.id);
		db.query('UPDATE chat_browser_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE browser_id=?').run(now, browser.id);
		return true;
	}).immediate();
}
export function list_browser_sessions(db: Database, client_id: number, now = Date.now()) {
	return db
		.query<
			{ id: number; created_at: number; expires_at: number; last_browser_seen_at: number },
			[number, number, number]
		>(
			`SELECT id,created_at,expires_at,last_browser_seen_at FROM chat_browser_sessions
	 WHERE client_id=? AND revoked_at IS NULL AND expires_at>? AND last_browser_seen_at>? ORDER BY id`
		)
		.all(client_id, now, now - CHAT_SESSION_IDLE);
}
export function revoke_browser_session(db: Database, client_id: number, id: number, now = Date.now()): void {
	db.query(
		'UPDATE chat_browser_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE client_id=? AND id=?'
	).run(now, client_id, id);
}
export function browser_origin_configuration(
	raw = process.env.CHAT_PUBLIC_ORIGIN ?? 'https://melvor.azcn.io'
) {
	const url = new URL(raw);
	const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (url.origin !== raw || url.username || url.password || (url.protocol !== 'https:' && !local))
		throw new Error('CHAT_PUBLIC_ORIGIN must be an HTTPS origin or explicit loopback HTTP origin');
	return { origin: raw, secure: !local, cookie_name: local ? 'mp-chat-local' : '__Secure-mp-chat' };
}

// Process-local guessing budgets intentionally reset on restart.
export function create_browser_exchange_limits(
	trust_proxy = process.env.TRUST_PROXY === '1'
): RequestLimitPolicy {
	return new RequestLimitPolicy({
		trust_proxy,
		source_per_minute: 5,
		source_burst: 5,
		identity_per_minute: 1,
		identity_burst: 1,
		registrations_per_source_hour: 1000,
		registrations_per_service_hour: 1000
	});
}
