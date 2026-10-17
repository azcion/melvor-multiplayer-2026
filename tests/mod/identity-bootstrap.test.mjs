import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import * as bootstrap from '../../mod/identity-bootstrap.mjs';
import * as bindings from '../../mod/identity-bindings.mjs';

const origin = 'https://example.test';
const account = { playfab_id: 'account-a', cloud_username: 'Player' };
const proof = () => ({ client_identifier: randomUUID(), client_key: randomUUID() });
const source = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
const flow = source.slice(source.indexOf('async function start_multiplayer_session('), source.indexOf('async function enroll_current_installation('));
function harness({ storage = new Map(), server = new Map(), account_value = account, supported = true, write = null, request = null } = {}) {
	const calls = [], notices = [], errors = [];
	const state = { close_modal() {}, identity_error: '' };
	const context = vm.createContext({
		state, active_identity_credentials: null, cloudManager: {}, localStorage: {}, IS_DEV_MODE: true, is_creator_toolkit_local_mod: () => false, is_connecting: false, listing_filter_prompt: null,
		close_expedition_work_prompt() {}, session_generation: 0, events_refreshed_at: 0, last_events_result: null,
		transfer_history_module: { create_transfer_history_state: () => ({}) }, economy_commands_ready: false,
		economy_command_journal: null, rollback_client: null, selected_api_major: 1,
		identity_bootstrap: bootstrap, identity_bindings: { ...bindings, read_melvor_account: () => account_value },
		identity_registration_supported: supported, server_host: origin,
		get_instance_storage_item: key => storage.get(key),
		set_instance_storage_item: (key, value) => write ? write(key, value, storage) : storage.set(key, value),
		remove_instance_storage_item: key => storage.delete(key),
		discover_api_contract: async () => {}, enter_unsupported_multiplayer: () => false,
		api_contract: { validate_api_bootstrap: data => !!data.client_identifier },
		installation_credentials: { auth: () => ({}) }, get_device_diagnostics: () => ({}),
		get_client_runtime_report: () => ({}), game: { characterName: 'Test' },
		getLangString: key => key, notify_error() {}, log() {}, error: (...args) => errors.push(args),
		queue_identity_notice: kind => notices.push(kind), queue_modal() {},
		enroll_current_installation: async () => {}, activate_multiplayer_identity: () => { state.is_connected = true; },
		async api_post_response(path, payload) {
			calls.push({ path, payload });
			if (request) { const result = await request(path, payload, server); if (result) return result; }
			const data = { ...payload, friend_code: 'TEST01' };
			if (path === '/api/register') {
				assert.equal(storage.get(bootstrap.pending_registration_key(account_value))?.client_key, payload.client_key);
				if (server.has(payload.registration_id)) return response(409, { identity_status: 'registration_exists' });
				data.client_identifier = payload.registration_id;
				server.set(data.client_identifier, data);
				return response(200, data);
			}
			return server.get(payload.client_identifier)?.client_key === payload.client_key ? response(200, server.get(payload.client_identifier)) : response(401);
		}
	});
	vm.runInContext(flow, context);
	return { run: options => context.start_multiplayer_session(options), context, storage, server, state, calls, notices, errors };
}
const response = (status, json = null) => ({ response: { status }, json });

test('missing, malformed and rejected proof require an explicit choice without registration', async () => {
	for (const credentials of [null, { client_identifier: 'bad', client_key: 'bad' }, proof()]) {
		const h = harness();
		if (credentials) { h.storage.set('client_identifier', credentials.client_identifier); h.storage.set('client_key', credentials.client_key); }
		await h.run();
		assert.deepEqual(h.notices, ['bootstrap']);
		assert.ok(h.calls.every(call => call.path !== '/api/register'));
	}
});

test('explicit creation persists proof before the request and authenticates it on reload', async () => {
	const h = harness();
	await h.run({ create: true });
	assert.equal(h.state.is_connected, true);
	assert.equal(h.server.size, 1);
	assert.equal(h.storage.has(bootstrap.pending_registration_key(account)), false);
	await h.run();
	assert.deepEqual(h.calls.map(c => c.path), ['/api/register', '/api/authenticate']);
});

test('storage rejection or silent loss prevents registration', async () => {
	for (const write of [() => { throw Error('quota'); }, () => {}]) {
		const h = harness({ write });
		await h.run({ create: true });
		assert.equal(h.calls.length, 0);
		assert.equal(h.state.is_connected, false);
	}
});

test('lost committed response and failed binding promotion reconnect the same pending identity', async () => {
	for (const failure of ['response', 'promotion']) {
		const storage = new Map(), server = new Map();
		const h = harness({ storage, server,
			write: (key, value, map) => { if (failure === 'promotion' && key === 'identity_bindings') throw Error('quota'); map.set(key, value); },
			request: (path, payload, remote) => {
				if (failure === 'response' && path === '/api/register') {
					remote.set(payload.registration_id, { ...payload, client_identifier: payload.registration_id });
					throw Error('lost response');
				}
			} });
		await h.run({ create: true });
		assert.equal(h.state.is_connected, false);
		assert.ok(storage.has(bootstrap.pending_registration_key(account)));
		const reload = harness({ storage, server });
		await reload.run();
		assert.equal(reload.state.is_connected, true);
		assert.deepEqual(reload.calls.map(c => c.path), ['/api/authenticate']);
		assert.equal(server.size, 1);
	}
});

test('pending creation takes precedence over an old binding and replay is bounded', async () => {
	const old = proof(), next = proof();
	const storage = new Map([['identity_bindings', bindings.upsert_identity_binding(undefined, account, old)],
		[bootstrap.pending_registration_key(account), { ...next, version: 1, account_id: account.playfab_id }]]);
	const h = harness({ storage, request: path => path === '/api/authenticate' ? response(401) : response(409, { identity_status: 'registration_exists' }) });
	await h.run();
	assert.equal(h.state.is_connected, false);
	assert.deepEqual(h.calls.map(c => c.path), ['/api/authenticate', '/api/register', '/api/authenticate']);
	assert.ok(h.calls.every(c => (c.payload.client_identifier ?? c.payload.registration_id) === next.client_identifier));
});

test('recovery verifies proof before replacing bindings and never registers on rejection', async () => {
	const old = proof(), restored = proof();
	const storage = new Map([['identity_bindings', bindings.upsert_identity_binding(undefined, account, old)]]);
	const h = harness({ storage });
	const code = bootstrap.encode_recovery_code(origin, restored);
	await h.run({ recovery_code: code });
	assert.equal(bindings.find_identity_binding(storage.get('identity_bindings'), account).client_identifier, old.client_identifier);
	assert.equal(h.server.size, 0);
	h.server.set(restored.client_identifier, restored);
	await h.run({ recovery_code: code });
	assert.equal(h.state.is_connected, true);
	assert.equal(bindings.find_identity_binding(storage.get('identity_bindings'), account).client_identifier, restored.client_identifier);
	assert.ok(h.calls.every(c => c.path === '/api/authenticate'));
	assert.ok(!JSON.stringify(h.errors).includes(restored.client_key));
});

test('pending records and recovery codes are isolated by account and normalized origin', () => {
	const storage = new Map();
	const read = key => storage.get(key), write = (key, value) => storage.set(key, value);
	const a = bootstrap.prepare_registration(read, write, account, randomUUID);
	assert.equal(bootstrap.prepare_registration(read, write, account), a);
	const b = bootstrap.prepare_registration(read, write, { playfab_id: 'account-b' }, randomUUID);
	assert.notEqual(a.client_identifier, b.client_identifier);
	assert.equal(bootstrap.read_pending_registration(a, { playfab_id: 'account-b' }), null);
	const code = bootstrap.encode_recovery_code(origin + '/path', a);
	assert.equal(bootstrap.decode_recovery_code(code, origin).client_identifier, a.client_identifier);
	for (const input of ['bad', 'MP1.invalid', 'MP1.' + btoa('{}'), 'x'.repeat(2001)]) assert.equal(bootstrap.decode_recovery_code(input, origin), null);
	assert.equal(bootstrap.decode_recovery_code(code, 'https://other.test'), null);
});

test('old servers permit existing authentication but block unsafe new registration', async () => {
	const existing = proof(), h = harness({ supported: false, server: new Map([[existing.client_identifier, existing]]) });
	h.storage.set('client_identifier', existing.client_identifier); h.storage.set('client_key', existing.client_key);
	await h.run();
	assert.equal(h.state.is_connected, true);
	await h.run({ create: true });
	assert.equal(h.state.identity_error, 'MOD_MP_IDENTITY_HOST_UPGRADE');
	assert.equal(h.calls.length, 1);
});


test('published registration requires a changed, readable native save before contacting the server', async () => {
	for (const mode of ['saved', 'blocked', 'quota']) {
		const h = harness();
		let saved = 'before';
		h.context.IS_DEV_MODE = false;
		h.context.currentCharacter = 2;
		h.context.getKeyForSaveSlot = slot => { assert.equal(slot, 2); return 'slot2:'; };
		h.context.localStorage = { getItem: key => { assert.equal(key, 'slot2:saveGame'); return saved; } };
		h.context.saveData = () => {
			assert.ok(h.storage.has(bootstrap.pending_registration_key(account)));
			if (mode === 'quota') throw Error('quota');
			if (mode === 'saved') saved = JSON.stringify([...h.storage]);
		};
		await h.run({ create: true });
		assert.equal(h.calls.length, mode === 'saved' ? 1 : 0);
		assert.equal(h.state.is_connected, mode === 'saved');
	}
});


test('import persists the recovered binding without resurrecting an abandoned pending registration', async () => {
	const pending = { ...proof(), version: 1, account_id: account.playfab_id }, restored = proof();
	const h = harness({ storage: new Map([[bootstrap.pending_registration_key(account), pending]]),
		server: new Map([[restored.client_identifier, restored]]) });
	let saved = 'before';
	h.context.IS_DEV_MODE = false;
	h.context.currentCharacter = 0;
	h.context.getKeyForSaveSlot = () => 'slot:';
	h.context.localStorage = { getItem: () => saved };
	h.context.saveData = () => { saved = JSON.stringify([...h.storage]); };
	await h.run({ recovery_code: bootstrap.encode_recovery_code(origin, restored) });
	assert.equal(h.state.is_connected, true);
	const reloaded = harness({ storage: new Map(JSON.parse(saved)), server: h.server });
	await reloaded.run();
	assert.equal(reloaded.state.is_connected, true);
	assert.equal(reloaded.calls[0].payload.client_identifier, restored.client_identifier);
	assert.equal(reloaded.calls.length, 1);
});

test('only the established legacy account-mismatch exception creates a profile automatically', async () => {
	const old = proof();
	const h = harness({ request: path => path === '/api/authenticate' ? response(409, { identity_status: 'melvor_account_mismatch' }) : null });
	h.storage.set('client_identifier', old.client_identifier); h.storage.set('client_key', old.client_key);
	await h.run();
	assert.equal(h.state.is_connected, true);
	assert.deepEqual(h.notices, ['account_changed']);
	const imported = harness({ request: () => response(409, { identity_status: 'melvor_account_mismatch' }) });
	await imported.run({ recovery_code: bootstrap.encode_recovery_code(origin, old) });
	assert.deepEqual(imported.calls.map(c => c.path), ['/api/authenticate']);
	assert.equal(imported.state.is_connected, false);
});
