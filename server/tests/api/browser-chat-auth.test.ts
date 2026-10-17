import { expect, test } from 'bun:test';
import { post, post_json, request, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';
import { Database } from 'bun:sqlite';
import { pair_browser, issue_browser_code } from '../../browser-chat-auth';
function seed_browser(client_id: number) {
	const db = new Database(process.env.TEST_DB_PATH!, { strict: true });
	try {
		db.run('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
		const pair = pair_browser(db, issue_browser_code(db, client_id).code)!;
		return { cookie: `__Secure-mp-chat=${pair.token}`, link_id: pair.id };
	} finally { db.close(); }
}
const origin = 'https://melvor.azcn.io';
const browser = (path: string, cookie = '', init: RequestInit = {}) =>
	request('/chat/api/' + path, { ...init, headers: { Origin: origin, Cookie: cookie, ...init.headers } });
test('pair race, secure cookie, CSRF, game isolation, revocation and no browser gameplay activity', async () => {
	const a = (
		await post_json<any>('/api/register', {
			client_key: crypto.randomUUID(),
			display_name: 'Browser auth',
			client_runtime: { mod_version: '1.6.14', active_mods: [] }
		})
	).json;
	const b = (
		await post_json<any>('/api/register', {
			client_key: crypto.randomUUID(),
			display_name: 'Other browser',
			client_runtime: { mod_version: '1.6.14', active_mods: [] }
		})
	).json;
	expect((await post('/api/chat/browser-links/issue', {})).status).toBe(401);
	const issued = await post_json<any>('/api/chat/browser-links/issue', {}, a.session_token);
	expect(issued.response.status).toBe(200);
	const before = await db_all('SELECT * FROM clients WHERE id=?', [a.chat.client_id]);
	const runtimeBefore = await db_all('SELECT * FROM client_runtime_snapshots WHERE client_id=?', [
		a.chat.client_id
	]);
	const sessionsBefore = await db_all('SELECT * FROM client_sessions WHERE client_id=?', [a.chat.client_id]);
	const payload = {
		method: 'POST',
		body: JSON.stringify({ code: issued.json.code }),
		headers: { 'Content-Type': 'application/json' }
	};
	expect((await request('/chat/api/pair', payload)).status).toBe(403);
	expect(
		(
			await browser('pair', '', {
				...payload,
				headers: { ...payload.headers, Origin: 'https://foreign.example' }
			})
		).status
	).toBe(403);
	const results = await Promise.all([browser('pair', '', payload), browser('pair', '', payload)]);
	expect(results.map(r => r.status).sort()).toEqual([200, 401]);
	const success = results.find(r => r.status === 200)!;
	const set = success.headers.get('Set-Cookie')!;
	expect(set).toContain('__Secure-mp-chat=');
	expect(set).toContain('Path=/chat');
	expect(set).toContain('HttpOnly');
	expect(set).toContain('SameSite=Strict');
	expect(set).toContain('Secure');
	expect(set).not.toContain('Domain=');
	const cookie = set.split(';')[0];
	const bootstrap = await browser('session', cookie);
	expect(bootstrap.status).toBe(200);
	expect(bootstrap.headers.get('Cache-Control')).toBe('private, no-store');
	expect(bootstrap.headers.get('Access-Control-Allow-Origin')).toBeNull();
	const session = (await bootstrap.json()) as any;
	expect(
		(await browser('logout', cookie, { method: 'POST', headers: { 'X-Chat-CSRF': session.csrf_token, 'X-Chat-Link-ID': String(session.links[0].link_id) } }))
			.status
	).toBe(400);
	expect(session.links.map((link: any) => link.client_id)).toEqual([a.chat.client_id]);
	expect((await browser('session', cookie, { headers: { Origin: 'null' } })).status).toBe(403);
	expect((await browser('logout', cookie, { method: 'POST', headers: { 'X-Chat-Link-ID': String(session.links[0].link_id) } })).status).toBe(403);
	expect((await request('/api/v2/events', { headers: { Cookie: cookie } })).status).toBe(401);
	expect((await post('/api/chat/browser-links/issue', {}, undefined, { Cookie: cookie })).status).toBe(401);
	expect((await browser('state', cookie)).status).toBe(400);
	expect((await browser('pair', cookie)).status).toBe(405);
	expect(await db_all('SELECT * FROM clients WHERE id=?', [a.chat.client_id])).toEqual(before);
	const listed = await request('/api/v2/chat/browser-links/list', {
		headers: { 'X-Session-Token': a.session_token }
	});
	const links = ((await listed.json()) as any).sessions;
	expect(links).toHaveLength(1);
	expect(links[0].token_hash).toBeUndefined();
	await post('/api/chat/browser-links/revoke', { session_id: links[0].id }, b.session_token);
	expect((await browser('session', cookie)).status).toBe(200);
	// Game list itself follows the existing game wrapper. Capture after it for browser-only checks.
	const afterList = await db_all('SELECT * FROM clients WHERE id=?', [a.chat.client_id]);
	expect(
		(
			await browser('logout', cookie, {
				method: 'POST',
				body: '{}',
				headers: { 'X-Chat-CSRF': session.csrf_token, 'X-Chat-Link-ID': String(session.links[0].link_id), 'Content-Type': 'application/json' }
			})
		).status
	).toBe(200);
	expect((await browser('session', cookie)).status).toBe(401);
	expect(await db_all('SELECT * FROM clients WHERE id=?', [a.chat.client_id])).toEqual(afterList);
	expect(
		await db_all('SELECT * FROM client_runtime_snapshots WHERE client_id=?', [a.chat.client_id])
	).toEqual(runtimeBefore);
	expect(await db_all('SELECT * FROM client_sessions WHERE client_id=?', [a.chat.client_id])).toEqual(
		sessionsBefore
	);
	const cookie2 = seed_browser(a.chat.client_id).cookie;
	await db_run('UPDATE clients SET disabled=1 WHERE id=?', [a.chat.client_id]);
	await db_run('UPDATE clients SET disabled=0 WHERE id=?', [a.chat.client_id]);
	expect((await browser('session', cookie2)).status).toBe(401);
});

test('multiple explicit identities retain independent links, CSRF, selection, logout and stale-cookie recovery', async () => {
	const account = { cloud_username: 'Browser group', playfab_id: crypto.randomUUID() };
	const a = await register_client('Browser A', account), b = await register_client('Browser B', account);
	const sibling = await register_client('Unpaired sibling', account);
	const first = seed_browser(a.client_id);
	const initial = (await (await browser('session', first.cookie)).json()) as any;
	const csrf = initial.csrf_token;
	const code = (await post_json<any>('/api/chat/browser-links/issue', {}, b.session_token)).json.code;
	const pair_init = (code: string, extra: Record<string, string> = {}) => ({
		method: 'POST', body: JSON.stringify({ code }), headers: { 'Content-Type': 'application/json', 'X-Chat-CSRF': csrf, ...extra }
	});
	let before = await db_all('SELECT * FROM clients WHERE id IN (?,?,?) ORDER BY id', [a.client_id, b.client_id, sibling.client_id]);
	const browser_rows_before = await db_all('SELECT * FROM chat_browser_sessions WHERE id=?', [first.link_id]);
	expect((await browser('pair', first.cookie, pair_init(code, { 'X-Chat-CSRF': 'wrong' }))).status).toBe(403);
	expect((await browser('pair', first.cookie, { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } })).status).toBe(400);
	const added = await browser('pair', first.cookie, pair_init(code));
	expect(added.status).toBe(200);
	expect(added.headers.get('Set-Cookie')!.split(';')[0]).toBe(first.cookie);
	expect(added.headers.get('Set-Cookie')).toContain('Max-Age=2592000');
	const b_link = ((await added.json()) as any).link_id;
	const listed = (await (await browser('session', first.cookie)).json()) as any;
	expect(listed.csrf_token).toBe(csrf);
	expect(listed.links.map((link: any) => link.client_id)).toEqual([a.client_id, b.client_id]);
	expect(listed.client_id).toBeUndefined();
	expect(listed.links.every((link: any) => link.token_hash === undefined && link.browser_id === undefined && link.last_browser_seen_at === undefined)).toBe(true);
	expect(await db_all('SELECT * FROM chat_browser_sessions WHERE id=?', [first.link_id])).toEqual(browser_rows_before);
	const duplicate_code = (await post_json<any>('/api/chat/browser-links/issue', {}, b.session_token)).json.code;
	before = await db_all('SELECT * FROM clients WHERE id IN (?,?,?) ORDER BY id', [a.client_id, b.client_id, sibling.client_id]);
	const duplicate = await browser('pair', first.cookie, pair_init(duplicate_code));
	expect(duplicate.status).toBe(200);
	expect(((await duplicate.json()) as any).link_id).toBe(b_link);
	expect(((await (await browser('session', first.cookie)).json()) as any).links).toEqual(listed.links);
	const auth = (link: string | number) => ({ 'X-Chat-CSRF': csrf, 'X-Chat-Link-ID': String(link), 'Content-Type': 'application/json' });
	for (const selector of ['', '0', '01', `${first.link_id},${b_link}`, '9007199254740992'])
		expect((await browser('logout', first.cookie, { method: 'POST', body: '{}', headers: auth(selector) })).status).toBe(400);
	expect((await browser('logout', first.cookie, { method: 'POST', body: '{}', headers: { 'X-Chat-CSRF': csrf, 'Content-Type': 'application/json' } })).status).toBe(400);
	expect((await browser('logout', first.cookie, { method: 'POST', body: '{}', headers: auth(9007199254740991) })).status).toBe(401);
	const other = seed_browser(sibling.client_id);
	expect((await browser('logout', first.cookie, { method: 'POST', body: '{}', headers: auth(other.link_id) })).status).toBe(401);
	for (const path of ['logout', 'logout-all']) {
		expect((await browser(path, first.cookie, { method: 'POST', body: '{}', headers: { ...auth(first.link_id), Origin: 'https://foreign.example' } })).status).toBe(403);
		expect((await browser(path, first.cookie, { method: 'POST', body: '{}', headers: { ...auth(first.link_id), 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
		expect((await browser(path, first.cookie, { method: 'POST', body: '{}', headers: { ...auth(first.link_id), 'X-Chat-CSRF': 'wrong' } })).status).toBe(403);
		expect((await browser(path, first.cookie, { method: 'POST', body: '{', headers: auth(first.link_id) })).status).toBe(400);
		expect((await browser(path, first.cookie)).status).toBe(405);
	}
	expect((await browser('logout-all', `${first.cookie}; ${first.cookie}`, { method: 'POST', body: '{}', headers: auth(first.link_id) })).status).toBe(401);
	expect((await browser('session', first.cookie, { headers: { Origin: 'null' } })).status).toBe(403);
	const one = await browser('logout', first.cookie, { method: 'POST', body: '{}', headers: auth(first.link_id) });
	expect(one.status).toBe(200);
	expect(one.headers.get('Set-Cookie')).toBeNull();
	expect(((await (await browser('session', first.cookie)).json()) as any).links.map((link: any) => link.link_id)).toEqual([b_link]);
	expect((await browser('logout', first.cookie, { method: 'POST', body: '{}', headers: auth(first.link_id) })).status).toBe(401);
	const all = await browser('logout-all', first.cookie, { method: 'POST', body: '{}', headers: { 'X-Chat-CSRF': csrf, 'Content-Type': 'application/json' } });
	expect(all.status).toBe(200);
	expect(all.headers.get('Set-Cookie')).toContain('Max-Age=0');
	const stale_bootstrap = await browser('session', first.cookie);
	expect(stale_bootstrap.status).toBe(401);
	expect(stale_bootstrap.headers.get('Set-Cookie')).toContain('Max-Age=0');
	expect((await browser('session', other.cookie)).status).toBe(200);
	expect(await db_all('SELECT * FROM clients WHERE id IN (?,?,?) ORDER BY id', [a.client_id, b.client_id, sibling.client_id])).toEqual(before);
	const recovery_code = (await post_json<any>('/api/chat/browser-links/issue', {}, a.session_token)).json.code;
	const stale_pair = await browser('pair', first.cookie, pair_init(recovery_code));
	expect(stale_pair.status).toBe(401);
	expect(stale_pair.headers.get('Set-Cookie')).toContain('Max-Age=0');
	// The stale attempt did not consume the code or mint a replacement. A new,
	// explicit no-cookie attempt can link after the browser clears its cookie.
	const recovery = await browser('pair', '', pair_init(recovery_code));
	expect(recovery.status).toBe(200);
	expect(recovery.headers.get('Set-Cookie')!.split(';')[0]).not.toBe(first.cookie);
});
