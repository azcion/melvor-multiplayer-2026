import { expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { pair_browser } from '../../browser-chat-auth';
import { post, post_json, request, register_client } from './http';
const origin = 'https://melvor.azcn.io';
const path = '/test-state/browser-chat.json';
const exchange = (code: string, cookie = '', csrf = '') =>
	request('/chat/api/pair', {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie, 'X-Chat-CSRF': csrf },
		body: JSON.stringify({ code })
	});
// Seed credentials through the real domain against the shared test database so
// earlier API guessing tests cannot exhaust the restart fixture's source bucket.
// Post-restart exchanges still exercise the actual HTTP boundary.
function persist_pair(code: string, cookie = ''): Response {
	const db = new Database(process.env.TEST_DB_PATH!, { strict: true });
	try {
		db.run('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
		const paired = pair_browser(db, code, Date.now(), cookie ? cookie.split('=')[1] : undefined);
		expect(paired).not.toBeNull();
		return Response.json({ link_id: paired!.id }, { headers: { 'Set-Cookie': `__Secure-mp-chat=${paired!.token}` } });
	} finally { db.close(); }
}
export async function setup_browser_chat_restart(): Promise<void> {
	const client = await register_client('Browser restart');
	const first = (await post_json<{ code: string }>('/api/chat/browser-links/issue', {}, client.session_token))
		.json.code;
	const paired = persist_pair(first);
	expect(paired.status).toBe(200);
	const cookie = paired.headers.get('Set-Cookie')!.split(';')[0];
	const first_link = ((await paired.json()) as { link_id: number }).link_id;
	const extra_client = await register_client('Second browser identity');
	const bootstrap = await request('/chat/api/session', { headers: { Cookie: cookie } });
	expect(bootstrap.status).toBe(200);
	const extra_code = (await post_json<{code: string}>('/api/chat/browser-links/issue', {}, extra_client.session_token)).json.code;
	const extra = persist_pair(extra_code, cookie);
	expect(extra.status).toBe(200);
	const extra_link = ((await extra.json()) as { link_id: number }).link_id;
	const second = (
		await post_json<{ code: string }>('/api/chat/browser-links/issue', {}, client.session_token)
	).json.code;
	const revoked = persist_pair(second);
	expect(revoked.status).toBe(200);
	const revoked_cookie = revoked.headers.get('Set-Cookie')!.split(';')[0];
	const revoked_link = ((await revoked.json()) as { link_id: number }).link_id;
	const session = await request('/chat/api/session', { headers: { Cookie: revoked_cookie } });
	const csrf = ((await session.json()) as { csrf_token: string }).csrf_token;
	expect(
		(
			await request('/chat/api/logout', {
				method: 'POST',
				headers: {
					Origin: origin,
					Cookie: revoked_cookie,
					'X-Chat-CSRF': csrf,
					'X-Chat-Link-ID': String(revoked_link),
					'Content-Type': 'application/json'
				},
				body: '{}'
			})
		).status
	).toBe(200);
	const unused = (
		await post_json<{ code: string }>('/api/chat/browser-links/issue', {}, client.session_token)
	).json.code;
	await Bun.write(
		path,
		JSON.stringify({ cookie, revoked_cookie, first_link, extra_link, consumed: first, unused, game_token: client.session_token })
	);
}
export async function verify_browser_chat_restart(): Promise<void> {
	const state = (await Bun.file(path).json()) as {
		cookie: string;
		first_link: number;
		extra_link: number;
		revoked_cookie: string;
		consumed: string;
		unused: string;
		game_token: string;
	};
	const bootstrap = await request('/chat/api/session', { headers: { Cookie: state.cookie } });
	expect(bootstrap.status).toBe(200);
	const current = await bootstrap.json() as { links: { link_id: number }[]; csrf_token: string };
	expect(current.links.map(link => link.link_id)).toEqual([state.first_link, state.extra_link]);
	expect((await request('/chat/api/session', { headers: { Cookie: state.revoked_cookie } })).status).toBe(
		401
	);
	expect((await exchange(state.consumed)).status).toBe(401);
	expect((await exchange(state.unused)).status).toBe(200);
	const limited = await post('/api/chat/browser-links/issue', {}, state.game_token);
	expect(limited.status).toBe(429);
	expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
}
