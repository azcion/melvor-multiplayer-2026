import assert from 'node:assert/strict';
import test from 'node:test';
import { create_installation_credentials } from '../../mod/installation-credentials.mjs';
function storage() { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; }

test('installation credentials persist separately per identity and server and replay a lost enrollment response', async () => {
	const local = storage();
	const store = create_installation_credentials(local);
	const installation = crypto.randomUUID();
	const sent = [];
	const send = async payload => { sent.push(payload); return { response: null }; };
	assert.equal(store.auth('https://one.example', 'client-a', installation), null);
	assert.equal(await store.enroll('https://one.example', 'client-a', installation, send), false);
	const restored = create_installation_credentials(local);
	await restored.enroll('https://one.example', 'client-a', installation, async payload => {
		sent.push(payload); return { response: { status: 200 }, json: { success: true } };
	});
	assert.equal(sent[0].installation_key, sent[1].installation_key);
	assert.equal(restored.auth('https://one.example', 'client-a', installation).installation_key, sent[0].installation_key);
	assert.equal(restored.auth('https://two.example', 'client-a', installation), null);
	assert.equal(restored.auth('https://one.example', 'client-b', installation), null);
	assert.equal(restored.auth('https://one.example', 'client-a', crypto.randomUUID()), null);
});

test('unavailable storage never enrolls a credential that cannot be recovered', async () => {
	const store = create_installation_credentials({ getItem() { throw Error(); }, setItem() { throw Error(); } });
	let sent = false;
	assert.equal(await store.enroll('https://one.example', 'client', crypto.randomUUID(), async () => { sent = true; }), false);
	assert.equal(sent, false);
});

test('failed enrollment stays pending and does not become installation authentication', async () => {
	const store = create_installation_credentials(storage());
	const id = crypto.randomUUID();
	await store.enroll('https://one.example', 'client', id, async () => ({ response: { status: 409 }, json: null }));
	assert.equal(store.auth('https://one.example', 'client', id), null);
});

test('replaced sessions pause once, do not reconnect automatically, and ignore stale responses', async () => {
	const { read_client_source } = await import('./source.mjs');
	const { runInNewContext } = await import('node:vm');
	const source = await read_client_source();
	const body = source.slice(source.indexOf('function handle_session_response('), source.indexOf('function cache_bust_api_endpoint('));
	const notices = [];
	const context = { state: { is_connected: true }, session_generation: 2, client_event_poll_id: 3, status_sync_timer: null,
		stop_chat_polling() {}, stop_status_observer() {}, clearTimeout() {}, notify_error: text => notices.push(text) };
	runInNewContext(body, context);
	const replaced = new Response('Unauthorized', { status: 401, headers: { 'X-Multiplayer-Session-State': 'replaced' } });
	context.handle_session_response(replaced, 1);
	assert.equal(context.state.is_connected, true);
	context.handle_session_response(replaced, 2);
	assert.equal(context.state.is_connected, false);
	assert.equal(context.client_event_poll_id, 4);
	assert.deepEqual(notices, ['MOD_MP_SESSION_REPLACED']);
	context.handle_session_response(replaced, 2);
	assert.equal(notices.length, 1);
	assert.ok(!body.includes('start_multiplayer_session'));
});
