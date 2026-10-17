import { expect, test } from 'bun:test';
import { request } from '../support/http';
test('canonical shell and exact packaged assets have restrictive security headers', async () => {
	for (const path of ['/chat', '/chat/assets/chat.css', '/chat/assets/chat.mjs', '/chat/assets/transport.mjs', '/chat/assets/controller.mjs', '/chat/assets/render.mjs', '/mod/chat-items.mjs', '/chat/assets/multiplayer.svg']) {
		const response = await request(path);
		expect(response.status).toBe(200);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
		const policy = response.headers.get('Content-Security-Policy')!;
		expect(policy).toContain("script-src 'self'");
		expect(policy).toContain("connect-src 'self'");
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).not.toContain('unsafe-inline');
		expect((await response.text()).length).toBeGreaterThan(100);
		expect((await request(path, { method: 'POST' })).status).toBe(405);
	}
	const redirect = await request('/chat/', { redirect: 'manual' });
	expect(redirect.status).toBe(308);
	expect(redirect.headers.get('Location')).toBe('/chat');
	for (const path of ['/chat/missing', '/chat/assets/missing.mjs', '/chat/api/unknown', '/chat/assets/index.html'])
		expect((await request(path)).status).toBe(404);
});
test('demo endpoint has explicit selected browser auth and never accepts game headers as fallback', async () => {
	expect((await request('/chat/api/data', { headers: { 'X-Chat-Link-ID': '1' } })).status).toBe(401);
	expect((await request('/chat/api/data', { headers: { 'X-Session-Token': 'untrusted' } })).status).toBe(400);
	expect((await request('/chat/api/data', { headers: { Origin: 'https://evil.test', 'X-Chat-Link-ID': '1' } })).status).toBe(403);
	expect((await request('/chat/api/data', { method: 'POST' })).status).toBe(405);
});
