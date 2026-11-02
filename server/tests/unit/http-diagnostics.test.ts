import { expect, test } from 'bun:test';
import { post_json, request_json } from '../support/http';

test('JSON response errors identify the request without exposing query or body data', async () => {
	const server = Bun.serve({
		port: 0,
		fetch(request) {
			return new URL(request.url).pathname === '/plain'
				? new Response('response-secret', { status: 400 })
				: new Response('response-secret', { headers: { 'Content-Type': 'application/json' } });
		}
	});
	try {
		for (const [path, expected] of [
			['plain', 'Expected JSON response for POST /plain'],
			['invalid', 'Invalid JSON response for GET /invalid']
		] as const) {
			let message = '';
			try {
				const url = `${server.url}${path}?token=query-secret`;
				if (path === 'plain') await post_json(url, { secret: 'request-secret' });
				else await request_json(url);
			} catch (error) {
				message = String(error);
			}
			expect(message).toContain(expected);
			expect(message).not.toContain('secret');
		}
	} finally {
		server.stop(true);
	}
});
