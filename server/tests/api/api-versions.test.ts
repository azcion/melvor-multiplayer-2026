import { expect, test } from 'bun:test';
import { get_json_with_session, get_with_session, post, post_json, register_client, request } from '../support/http';
import { register_guild_client } from '../support/fixtures';

test('publishes only the v2 API contract', async () => {
	const versions = await request('/api/versions');
	expect(versions.status).toBe(200);
	expect(await versions.json()).toEqual({ api_versions: [2], preferred_api_version: 2,
		minimum_supported_mod_version: null });
	const auth = await post_json<Record<string, any>>('/api/v2/register', {
		client_key: crypto.randomUUID(), display_name: 'V2 Bootstrap'
	});
	expect(auth.response.status).toBe(200);
	expect(auth.json.api_version).toBe(2);
	expect(auth.json.api_versions).toEqual([2]);
	expect(auth.json.server_owned_pets).toBe(true);
	expect(auth.json.read_post_supported).toBeUndefined();
	expect((await request('/api/v1/events')).status).toBe(404);
	expect((await request('/api/v99/events')).status).toBe(404);
});

test('serves reads only through GET and does not expose legacy aliases', async () => {
	const client = await register_client('V2 Reads');
	const get_response = await get_with_session('/api/events', client.session_token);
	expect(get_response.status).toBe(200);
	expect((await post('/api/events', {}, client.session_token)).status).toBe(405);
	expect((await request('/api/v1/events', { method: 'POST', body: '{}' })).status).toBe(404);
	expect((await request('/api/v1/events', { method: 'OPTIONS', headers: {
		Origin: 'https://play.melvoridle.com', 'Access-Control-Request-Method': 'GET'
	} })).status).toBe(404);
});

test('requires UUID command IDs for every economy route', async () => {
	const client = await register_guild_client('V2 Commands');
	for (const path of ['/api/v2/market/sell', '/api/v2/gift/decline', '/api/v2/trade/decline']) {
		for (const command_id of [undefined, null, 'invalid', '-'.repeat(36)]) {
			const response = await post(path, { command_id }, client.session_token);
			expect(response.status, `${path} ${String(command_id)}`).toBe(400);
		}
	}
});

test('replays v2 economy receipts idempotently', async () => {
	const client = await register_guild_client('V2 Replay');
	const body = { command_id: crypto.randomUUID(), item_id: 'melvorD:API_Ore', item_qty: 3, item_sell_price: 7 };
	const first = await post_json('/api/market/sell', body, client.session_token);
	expect(first.response.status).toBe(200);
	const replay = await post_json('/api/v2/market/sell', body, client.session_token);
	expect(replay.json).toEqual(first.json);
});

test('accepts current status payloads and preserves split status updates', async () => {
	const { make_guildmates } = await import('../support/fixtures');
	const pair = await make_guildmates('Status One', 'Status Two');
	const sync = await post('/api/client/status/sync', {
		activities: [{ type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' }]
	}, pair.first.session_token);
	expect(sync.status).toBe(200);
	const status = await get_json_with_session<{ activity: unknown; activities: unknown[] }>(`/api/guilds/status?client_id=${pair.first_id}`, pair.second.session_token);
	expect(status.json.activities).toHaveLength(1);
	expect((await post('/api/client/activity/visibility', { visible: false }, pair.first.session_token)).status).toBe(200);
	expect((await post('/api/client/skills/visibility', { visible: true }, pair.first.session_token)).status).toBe(200);
	expect((await post('/api/v2/client/status/sync', { activity: { type: 'idle' } }, pair.first.session_token)).status).toBe(400);
	expect((await post('/api/v2/client/status/sync', {
		activity: { type: 'idle' }, activities: []
	}, pair.first.session_token)).status).toBe(400);
});

test('does not apply removed pre-1.5.9 client gates', async () => {
	const old = await register_client('Old Runtime', undefined, '1.4.5');
	const response = await post('/api/market/sell', {}, old.session_token);
	expect(response.status).not.toBe(403);
});

test('blocks ordinary traffic for feature-aware clients below the operator support floor', async () => {
	const { db_run } = await import('../support/persistence');
	await db_run("UPDATE `service_settings` SET `value` = '9.9.9' WHERE `key` = 'minimum_supported_mod_version'");
	try {
		const feature_aware = await register_client('Unsupported Runtime', undefined, '1.5.10');
		const legacy = await register_client('Legacy Runtime Floor', undefined, '1.5.9');
		const blocked = await get_with_session('/api/identities', feature_aware.session_token);
		expect(blocked.status).toBe(426);
		expect(await blocked.json()).toEqual({ minimum_supported_mod_version: '9.9.9' });
		const events = await get_json_with_session<{ minimum_supported_mod_version: string }>('/api/events', feature_aware.session_token);
		expect(events.response.status).toBe(200);
		expect(events.json.minimum_supported_mod_version).toBe('9.9.9');
		expect((await get_with_session('/api/identities', legacy.session_token)).status).toBe(200);
	} finally {
		await db_run("UPDATE `service_settings` SET `value` = '' WHERE `key` = 'minimum_supported_mod_version'");
	}
});
