import { beforeAll, describe, expect, test } from 'bun:test';
import { get_with_session, post, post_json, register_client, request } from '../support/http';
import { db_all, db_run } from '../support/persistence';
import type { RegisteredClient } from '../support/http';

const allowed_origins = [
	'https://melvoridle.com',
	'https://play.melvoridle.com',
	'https://ios.melvoridle.com',
	'https://android.melvoridle.com'
];
const allowed_origin = allowed_origins[0];
const custom_origin = 'https://example.invalid';

describe('browser and request boundaries', () => {
	let client: RegisteredClient;

	beforeAll(async () => {
		client = await register_client('Boundary Test');
	});

	test('allows official browser and mobile app preflights', async () => {
		for (const origin of allowed_origins) {
			const response = await request('/api/register', {
				method: 'OPTIONS',
				headers: {
					'Origin': origin,
					'Access-Control-Request-Method': 'POST',
					'Access-Control-Request-Headers': 'content-type,x-session-token'
				}
			});

			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
			expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
			expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
				'content-type,x-session-token'
			);
			expect(response.headers.get('Access-Control-Max-Age')).toBe('600');
			expect(response.headers.get('Vary')).toContain('Origin');
		}
	});

	test('allows custom and opaque app origins without bypassing authentication', async () => {
		for (const origin of [custom_origin, 'null', 'capacitor://localhost', 'http://localhost:8080']) {
			const response = await request('/api/register', {
				method: 'OPTIONS',
				headers: {
					'Origin': origin,
					'Access-Control-Request-Method': 'POST'
				}
			});

			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
			expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
			for (const token of [undefined, 'invalid-session', crypto.randomUUID(), client.session_token]) {
				const headers: Record<string, string> = { Origin: origin };
				if (token) headers['X-Session-Token'] = token;
				const read = await request('/api/guilds/state', { headers });
				expect(read.status).toBe(token === client.session_token ? 200 : 401);
				expect(read.headers.get('Access-Control-Allow-Origin')).toBe(origin);
			}
		}
	});

	test('does not add browser headers to server-to-server requests', async () => {
		const response = await get_with_session('/api/events', client.session_token);

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
	});

	test('requires sessions on authenticated routes', async () => {
		const missing = await request('/api/events');
		const malformed = await get_with_session('/api/events', 'not-a-session-token');
		const unknown = await get_with_session('/api/events', crypto.randomUUID());

		expect(missing.status).toBe(401);
		expect(malformed.status).toBe(401);
		expect(unknown.status).toBe(401);
	});

	test('rejects malformed event revisions', async () => {
		for (const revision of ['-1', '1.5', 'nope'])
			expect((await get_with_session(`/api/events?revision=${revision}`, client.session_token)).status).toBe(400);
	});

	test('bounds and validates transfer-content identifier collections', async () => {
		const invalid_collections = [
			[0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], [1, 1],
			Array.from({ length: 129 }, (_, index) => index + 1)
		];
		for (const field of ['gift_ids', 'trade_ids', 'resolved_trade_ids'])
			for (const collection of invalid_collections) {
				const body = { gift_ids: [], trade_ids: [], resolved_trade_ids: [], [field]: collection };
				expect((await post('/api/transfers/get_contents', body, client.session_token)).status).toBe(400);
			}
	});

	test('coalesces authenticated activity writes across frequent polling', async () => {
		const poller = await register_client('Activity Write Poller');
		await get_with_session('/api/events', poller.session_token);
		await db_run('UPDATE `clients` SET `last_multiplayer_active_at` = 123 WHERE `id` = ?', [poller.client_id]);
		await get_with_session('/api/events', poller.session_token);
		const rows = await db_all<{ last_multiplayer_active_at: number }>(
			'SELECT `last_multiplayer_active_at` FROM `clients` WHERE `id` = ?',
			[poller.client_id]
		);

		expect(rows[0]?.last_multiplayer_active_at).toBe(123);
	});

	test('requires JSON content on authenticated POST routes', async () => {
		const missing_content_type = await request('/api/market/sell', {
			method: 'POST',
			headers: {
				'X-Session-Token': client.session_token
			},
			body: '{}'
		});
		const non_object = await request('/api/market/sell', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Session-Token': client.session_token
			},
			body: '[]'
		});
		const content_type_with_charset = await request('/api/market/sell', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'X-Session-Token': client.session_token
			},
			body: '{}'
		});

		expect(missing_content_type.status).toBe(400);
		expect(non_object.status).toBe(400);
		expect(content_type_with_charset.status).toBe(400);
	});

	test('rejects malformed JSON on public routes', async () => {
		const response = await request('/api/register', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: '{'
		});

		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Bad Request');
	});

	test('rejects oversized JSON before parsing it', async () => {
		const response = await request('/api/register', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Origin': allowed_origin
			},
			body: JSON.stringify({ padding: 'x'.repeat(32768) })
		});

		expect(response.status).toBe(413);
		expect(await response.text()).toBe('Payload Too Large');
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowed_origin);
	});

	test('rejects unsupported methods', async () => {
		const response = await request('/api/events', {
			method: 'DELETE',
			headers: {
				'X-Session-Token': client.session_token
			}
		});

		expect(response.status).toBe(405);
		expect(await response.text()).toBe('Method Not Allowed');
	});

	test('advertises POST reads during both registration and authentication', async () => {
		const registered = await register_client('Read Compatibility');
		expect((registered as RegisteredClient & { read_post_supported: boolean }).read_post_supported).toBe(true);
		const { response, json } = await post_json<{ read_post_supported: boolean }>('/api/authenticate', {
			client_identifier: registered.client_identifier, client_key: registered.client_key
		});
		expect(response.status).toBe(200);
		expect(json.read_post_supported).toBe(true);
	});

	test('serves Guild state and discovery through the same authenticated POST read handlers', async () => {
		for (const endpoint of ['/api/guilds/state', '/api/guilds/list']) {
			const get_response = await get_with_session(endpoint, client.session_token);
			const post_response = await post(endpoint, {}, client.session_token, { Origin: allowed_origins[3] });
			expect(post_response.status).toBe(200);
			expect(await post_response.json()).toEqual(await get_response.json());
			expect(post_response.headers.get('Access-Control-Allow-Origin')).toBe(allowed_origins[3]);
			expect(post_response.headers.get('Cache-Control')).toBe('private, no-store');
		}
	});

	test('preserves query selectors and cross-Guild privacy on POST reads', async () => {
		const outsider = await register_client('Read Outsider');
		const endpoint = `/api/guilds/equipment?client_id=${outsider.client_id}&_mp_cache=probe`;
		const get_response = await get_with_session(endpoint, client.session_token);
		const post_response = await post(endpoint, {}, client.session_token);
		expect(get_response.status).toBe(200);
		expect(post_response.status).toBe(get_response.status);
		const expected = await get_response.json();
		expect(expected).toEqual({ error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' });
		expect(await post_response.json()).toEqual(expected);
		expect((await post('/api/guilds/equipment?client_id=invalid', {}, client.session_token)).status).toBe(400);
	});

	test('keeps POST reads behind session and bounded JSON validation', async () => {
		expect((await post('/api/guilds/state', {})).status).toBe(401);
		expect((await post('/api/guilds/state', {}, 'invalid-session')).status).toBe(401);
		expect((await post('/api/guilds/state', {}, client.session_token, { Origin: custom_origin })).status).toBe(200);
		expect((await post('/api/guilds/state', [], client.session_token)).status).toBe(400);
		expect((await post('/api/guilds/state', { padding: 'x'.repeat(32768) }, client.session_token)).status).toBe(413);
	});

	test('echoes the allowed origin on JSON responses', async () => {
		const { response } = await post_json('/api/client/set_icon', {
			icon_id: 'melvorF:Golbin'
		}, client.session_token, {
			'Origin': allowed_origin
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowed_origin);
		expect(response.headers.get('Cache-Control')).toBe('private, no-store');
		expect(response.headers.get('Vary')).toContain('X-Session-Token');
	});

	test('allows cache-bypass headers added to non-cached browser GETs', async () => {
		const response = await request('/api/guilds/state', {
			method: 'OPTIONS',
			headers: {
				'Origin': allowed_origin,
				'Access-Control-Request-Method': 'GET',
				'Access-Control-Request-Headers': 'cache-control, pragma, x-session-token, x-requested-with'
			}
		});

		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Headers')).toBe(
			'cache-control, pragma, x-session-token, x-requested-with'
		);
		expect(response.headers.get('Vary')).toContain('Access-Control-Request-Headers');
	});

	test('adds browser headers to numeric error responses', async () => {
		const response = await post('/api/client/set_icon', {
			icon_id: 'invalid'
		}, client.session_token, {
			'Origin': allowed_origin
		});

		expect(response.status).toBe(400);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(allowed_origin);
		expect(response.headers.get('Vary')).toContain('Origin');
	});

	test('returns a retryable maintenance response without blocking browser preflight', async () => {
		await db_run("UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'maintenance'");
		try {
			const response = await get_with_session('/api/events', client.session_token);
			const post_read = await post('/api/events', {}, client.session_token);
			const preflight = await request('/api/register', {
				method: 'OPTIONS',
				headers: {
					'Origin': allowed_origin,
					'Access-Control-Request-Method': 'POST'
				}
			});

			expect(response.status).toBe(503);
			expect(post_read.status).toBe(503);
			expect(response.headers.get('Retry-After')).toBe('300');
			expect(await response.text()).toBe('Service Unavailable');
			expect(preflight.status).toBe(204);
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '0' WHERE `key` = 'maintenance'");
		}
	});
});
