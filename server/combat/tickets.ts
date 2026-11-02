import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const COMBAT_PROTOCOL = 4;

export function read_combat_key(path = process.env.COMBAT_TICKET_KEY_FILE): string | null {
	if (!path) return null;
	try {
		const key = readFileSync(path, 'utf8').trim();
		return /^[a-f0-9]{64,128}$/i.test(key) ? key : null;
	} catch { return null; }
}

export function issue_ticket(client_id: number, key: string, now = Date.now()) {
	const payload = Buffer.from(JSON.stringify({ aud: 'combat-arena-1', sub: client_id, jti: crypto.randomUUID(), exp: now + 30_000 })).toString('base64url');
	return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
}

export function verify_ticket(token: unknown, key: string, now = Date.now()): { sub: number; jti: string; exp: number } | null {
	if (typeof token !== 'string' || token.length > 1024) return null;
	const parts = token.split('.');
	if (parts.length !== 2 || !parts.every(part => /^[\w-]+$/.test(part))) return null;
	const signature = createHmac('sha256', key).update(parts[0]).digest();
	const supplied = Buffer.from(parts[1], 'base64url');
	if (supplied.length !== signature.length || !timingSafeEqual(supplied, signature)) return null;
	try {
		const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
		if (value.aud !== 'combat-arena-1' || !Number.isSafeInteger(value.sub) || value.sub < 1 ||
			!Number.isSafeInteger(value.exp) || value.exp <= now || value.exp > now + 30_000 ||
			typeof value.jti !== 'string' || !/^[\da-f-]{36}$/.test(value.jti)) return null;
		return value;
	} catch { return null; }
}
