import manifest from '../fixtures/v1-route-manifest.json';
import { expect, test } from 'bun:test';
import contracts from '../fixtures/supported-client-contracts.json';
import { get_json_with_session, get_with_session, post, post_json, register_client, request } from '../support/http';
import { register_guild_client } from '../support/fixtures';

test('published supported clients retain bootstrap and v1 event/read contracts', async () => {
	for (const contract of contracts) {
		expect(contract.automatic_gift_decline_without_command).toBe(true);
		expect(contract.read_post_supported_used).toBe(false);
		const client = await register_client(`API ${contract.version}`, undefined, contract.version);
		const auth = await post_json<Record<string, any>>('/api/v1/authenticate', {
			client_identifier: client.client_identifier, client_key: client.client_key,
			client_runtime: { mod_version: contract.version, active_mods: [] }
		});
		expect(auth.response.status).toBe(200);
		expect(auth.json.api_version).toBe(1);
		expect(auth.json.read_post_supported).toBe(true);
		expect(auth.json.status_visible).toBe(true);
		expect(auth.json.skills_visible).toBe(true);
		expect(auth.json.server_owned_pets).toBe(contract.version >= '1.5.3');
		const token = auth.json.session_token;
		const old = await get_json_with_session('/api/events', token);
		const explicit = await get_json_with_session('/api/v1/events', token);
		expect(explicit.json).toEqual(old.json);
		expect((await post_json('/api/v1/events', {}, token)).json).toEqual(old.json);
	}
});

test('v1 aliases share command journal and missing-ID acceptance', async () => {
	const client = await register_guild_client('API Journal');
	const body = { command_id: crypto.randomUUID(), item_id: 'melvorD:API_Ore', item_qty: 3, item_sell_price: 7 };
	const first = await post_json('/api/market/sell', body, client.session_token);
	expect((await post_json('/api/v1/market/sell', body, client.session_token)).json).toEqual(first.json);
	expect((await post('/api/v1/market/sell', { ...body, command_id: undefined }, client.session_token)).status).toBe(200);
});

test('explicit aliases preserve the unsupported-client gate and query parameters', async () => {
	const client = await register_client('API Old', undefined, '1.4.5');
	expect((await get_with_session('/api/v1/guilds/state', client.session_token)).status).toBe(403);
	const messages = await get_json_with_session<{ messages: unknown[] }>('/api/v1/chat/messages?conversation_kind=support&conversation_id=0&support_team_id=0', client.session_token);
	expect(messages.json.messages).toHaveLength(1);
});

test('discovery and alias method boundaries are explicit', async () => {
	const versions = await request('/api/versions');
	expect(versions.status).toBe(200);
	expect((await versions.json() as { api_versions: number[] }).api_versions).toContain(1);
	expect((await request('/api/v99/events')).status).toBe(404);
	expect((await request('/api/v1/events', { method: 'PUT' })).status).toBe(405);
	const preflight = await request('/api/v1/events', { method: 'OPTIONS', headers: {
		Origin: 'https://play.melvoridle.com', 'Access-Control-Request-Method': 'GET',
		'Access-Control-Request-Headers': 'X-Session-Token'
	} });
	expect(preflight.status).toBe(204);
	expect((await request('/api/v1/events')).status).toBe(401);
	expect((await request('/api/v1/client/icon-catalog/upload', { method: 'POST' })).status).toBe(401);
});

// Authentication is checked before domain handlers, so this inventory cannot mutate player state.
test('every frozen v1 route and method has an explicit alias', async () => {
	for (const route of manifest) {
		for (const method of route.methods.filter(method => method !== 'OPTIONS')) {
			const init = method === 'POST'
				? { method, headers: { 'Content-Type': 'application/json' }, body: '{}' } : { method };
			const original = await request(route.path, init);
			const alias = await request(route.path.replace('/api/', '/api/v1/'), init);
			expect(alias.status, `${method} ${route.path}`).toBe(original.status);
			expect(alias.status, `${method} ${route.path}`).not.toBe(404);
		}
	}
});

test('v2 commits to server-owned pets without trusting a reported mod version', async () => {
	const auth = await post_json<Record<string, any>>('/api/v2/register', {
		client_key: crypto.randomUUID(), display_name: 'V Two'
	});
	expect(auth.response.status).toBe(200);
	expect(auth.json.api_version).toBe(2);
	expect(auth.json.server_owned_pets).toBe(true);
	expect(auth.json.read_post_supported).toBeUndefined();
	expect(auth.json.status_visible).toBeUndefined();
	expect(auth.json.skills_visible).toBe(true);
	expect((await post('/api/v2/events', {}, auth.json.session_token)).status).toBe(405);
	expect((await post('/api/v2/client/status/visibility', { visible: false }, auth.json.session_token)).status).toBe(404);
	expect((await post('/api/v2/client/status/sync', { activity: { type: 'idle' } }, auth.json.session_token)).status).toBe(400);
	expect((await post('/api/v2/client/status/sync', { activities: [] }, auth.json.session_token)).status).toBe(200);
	const old = await register_client('V2 Gate', undefined, '1.4.5');
	expect((await post('/api/v2/market/sell', {}, old.session_token)).status).toBe(403);
});

test('every v2 economy command rejects omitted or malformed IDs before state changes', async () => {
	const client = await register_guild_client('Strict Commands');
	for (const route of manifest.filter(route => route.command_kinds.length > 0)) {
		const path = route.path.replace('/api/', '/api/v2/');
		for (const command_id of [undefined, null, 'x', '-'.repeat(36)])
			expect((await post(path, { command_id }, client.session_token)).status, path).toBe(400);
	}
	const events = await get_json_with_session<{ economy_receipts: unknown[] }>('/api/v2/events', client.session_token);
	expect(events.json.economy_receipts).toEqual([]);
});

test('v2 and v1 share receipts, acknowledgement ownership, and replay after acknowledgement', async () => {
	const client = await register_guild_client('V2 Replay');
	const other = await register_client('V2 Other');
	const body = { command_id: crypto.randomUUID(), item_id: 'melvorD:V2_Ore', item_qty: 3, item_sell_price: 7 };
	const first = await post_json('/api/v2/market/sell', body, client.session_token);
	expect(first.response.status).toBe(200);
	expect((await post_json('/api/market/sell', body, client.session_token)).json).toEqual(first.json);
	expect((await post_json('/api/v1/market/sell', body, client.session_token)).json).toEqual(first.json);
	expect((await post('/api/v2/economy/receipts/acknowledge', { receipt_id: body.command_id }, other.session_token)).status).toBe(404);
	await post('/api/v1/economy/receipts/acknowledge', { receipt_id: body.command_id }, client.session_token);
	const replay = await post_json<{ receipt: unknown }>('/api/v2/market/sell', body, client.session_token);
	expect(replay.json.receipt).toBeNull();
});

test('duplicate Charity retries commit once while a pending receipt and incoming Gift coexist', async () => {
	const { make_guildmates, get_events } = await import('../support/fixtures');
	const pair = await make_guildmates('V2 Sender', 'V2 Recipient');
	const token = pair.second.session_token;
	const body = { command_id: crypto.randomUUID(), items: [{ id: 'melvorD:V2_Logs', qty: 3 }], donation_value: 30 };
	const [first, twin] = await Promise.all([
		post_json('/api/v2/charity/donate', body, token), post_json('/api/v2/charity/donate', body, token)
	]);
	expect(first.json).toEqual(twin.json);
	expect(first.response.status).toBe(200);
	const stock = await get_json_with_session<{ items: Array<{ id: string; qty: number }> }>('/api/v2/charity/contents', token);
	expect(stock.json.items.find(item => item.id === 'melvorD:V2_Logs')?.qty).toBe(3);
	await post('/api/gift/send', { recipient_id: pair.second_id, items: [{ id: 'melvorD:V2_Fish', qty: 2 }] }, pair.first.session_token);
	const events = await get_events(pair.second);
	expect(events.economy_receipts).toHaveLength(1);
	expect(events.gifts).toHaveLength(1);
	const contents = await post_json<{ gifts: Record<string, unknown> }>('/api/v2/transfers/get_contents', {
		gift_ids: events.gifts, trade_ids: [], resolved_trade_ids: []
	}, token);
	expect(contents.json.gifts[String(events.gifts[0])]).toBeDefined();
	const declined = await post_json<{ success: boolean }>('/api/v2/gift/decline', { gift_id: events.gifts[0], command_id: crypto.randomUUID() }, token);
	expect(declined.json.success).toBe(true);
	expect((await get_events(pair.second)).economy_receipts.some(receipt => receipt.id === body.command_id)).toBe(true);
});

test('v2 covers the frozen route surface with only deliberate read/status omissions', async () => {
	for (const route of manifest) {
		const path = route.path.replace('/api/', '/api/v2/');
		for (const method of route.methods.filter(method => method !== 'OPTIONS')) {
			const init = method === 'POST'
				? { method, headers: { 'Content-Type': 'application/json' }, body: '{}' } : { method };
			const response = await request(path, init);
			if (path === '/api/v2/client/status/visibility') expect(response.status).toBe(404);
			else if (method === 'POST' && route.methods.includes('GET')) expect(response.status).toBe(405);
			else expect(response.status, `${method} ${path}`).not.toBe(404);
		}
	}
});

test('v2 split status updates retain persisted fallback and v1 readers', async () => {
	const { make_guildmates } = await import('../support/fixtures');
	const pair = await make_guildmates('Status V1', 'Status V2');
	await post('/api/client/status/sync', { activity: { type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Normal_Tree' } }, pair.first.session_token);
	const before = await get_json_with_session<{ activities: unknown[] }>(`/api/v2/guilds/status?client_id=${pair.first_id}`, pair.second.session_token);
	expect(before.json.activities).toHaveLength(1);
	await post('/api/v2/client/status/sync', { activities: [] }, pair.first.session_token);
	const after = await get_json_with_session<{ activity: unknown; activities: unknown[] }>(`/api/guilds/status?client_id=${pair.first_id}`, pair.second.session_token);
	expect(after.json.activities).toEqual([]);
	expect(after.json.activity).toEqual({ type: 'idle' });
	await post('/api/v2/client/activity/visibility', { visible: false }, pair.first.session_token);
	expect((await post('/api/v2/client/status/sync', { activities: [] }, pair.first.session_token)).status).toBe(200);
});

test('a stored v1 reward remains recoverable after new-session validation changes', async () => {
	const { db_run } = await import('../support/persistence');
	const client = await register_guild_client('Old Reward', 'Old Reward Guild', '1.5.1');
	const command_id = crypto.randomUUID();
	const stored = { success: true, receipt: { id: command_id, kind: 'campaign-claim', effects: [{ storage: 'gp', qty: 100 }] } };
	await db_run('INSERT INTO economy_receipts (id, client_id, kind, response_json, created_at) VALUES (?, ?, ?, ?, ?)',
		[command_id, client.client_id, 'campaign-claim', JSON.stringify(stored), Date.now()]);
	const auth = await post_json<{ session_token: string }>('/api/v2/authenticate', {
		client_identifier: client.client_identifier, client_key: client.client_key,
		client_runtime: { mod_version: '1.5.5', active_mods: [] }
	});
	for (const prefix of ['/api', '/api/v1', '/api/v2']) {
		const recovered = await post_json(`${prefix}/campaign/claim`, { campaign_id: 123, value: 100, command_id }, auth.json.session_token);
		expect(recovered.json).toEqual(stored);
	}
	expect((await post('/api/v2/charity/donate', { command_id }, auth.json.session_token)).status).toBe(400);
});
