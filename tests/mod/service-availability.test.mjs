import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import { create_service_availability, service_conversation } from '../../mod/service-availability.mjs';
import * as polling from '../../mod/polling.mjs';
import { install_chat_actions } from '../../mod/client-actions-chat.mjs';

function fixture(probe = async () => false) {
	let time = 1000, next = 0;
	const jobs = new Map(), changes = [];
	const availability = create_service_availability({ probe, changed: kind => changes.push(kind),
		now: () => time, random: () => 0,
		schedule: (fn, delay) => { jobs.set(++next, { fn, at: time + delay }); return next; },
		cancel: id => jobs.delete(id) });
	return { availability, jobs, changes, async tick() {
		const [id, job] = [...jobs][0]; jobs.delete(id); time = job.at; await job.fn();
	} };
}

test('maintenance honors Retry-After, probes once, and resolves without duplicate notices', async () => {
	const f = fixture(async () => true);
	const ticket = f.availability.ticket();
	f.availability.fail('maintenance', '300', ticket);
	f.availability.fail('unreachable', null, ticket); // Older in-flight response.
	assert.equal(f.jobs.size, 1);
	assert.equal([...f.jobs.values()][0].at, 301000);
	assert.deepEqual(f.changes, ['maintenance']);
	await f.tick();
	assert.equal(f.availability.active(), false);
	assert.deepEqual(f.changes, ['maintenance', 'resolved']);
	assert.equal(f.jobs.size, 0);
});

test('outage retries back off, reset cancels timers and late probe results', async () => {
	let release;
	const f = fixture(async () => false);
	f.availability.fail('unreachable');
	await f.tick();
	assert.equal([...f.jobs.values()][0].at, 7000);
	for (let i = 0; i < 6; i++) await f.tick();
	assert.equal(f.changes.length, 1);
	f.availability.reset();
	assert.equal(f.jobs.size, 0);
	const g = fixture(() => new Promise(resolve => { release = resolve; }));
	g.availability.fail('unreachable');
	const running = g.tick();
	g.availability.reset(); release(true); await running;
	assert.deepEqual(g.changes, ['unreachable']);
	assert.equal(g.jobs.size, 0);
});

test('probe can change outage reason without its old retry overwriting maintenance timing', async () => {
	let f;
	f = fixture(async () => { f.availability.fail('maintenance', '300'); return false; });
	f.availability.fail('unreachable'); await f.tick();
	assert.deepEqual(f.changes, ['unreachable', 'maintenance']);
	assert.equal(f.jobs.size, 1);
	assert.equal([...f.jobs.values()][0].at, 303000);
});

test('Retry-After dates and malformed values stay bounded', () => {
	const f = fixture();
	f.availability.fail('maintenance', new Date(601000).toUTCString());
	assert.equal([...f.jobs.values()][0].at, 601000);
	f.availability.fail('maintenance', 'bad');
	assert.equal([...f.jobs.values()][0].at, 301000);
});

const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
function transport(fetch_impl) {
	const f = fixture();
	const context = vm.createContext({ polling, fetch: fetch_impl, service_availability: f.availability,
		session_generation: 3, server_host: 'https://selected.example', state: { multiplayer_unsupported: false },
		Error, Date });
	vm.runInContext(main.slice(main.indexOf('async function service_fetch('), main.indexOf('async function probe_multiplayer_service(')), context);
	return { context, ...f, run: request => context.service_fetch(fetch_impl, 'https://selected.example/api/versions', {}, request) };
}

test('transport identifies explicit maintenance, generic 503, gateway and network failures', async () => {
	for (const [fetch_impl, expected] of [
		[async () => Response.json({ error: 'maintenance' }, { status: 503, headers: { 'Retry-After': '300' } }), 'maintenance'],
		[async () => new Response('Service Unavailable', { status: 503 }), 'unavailable'],
		[async () => new Response('<html>gateway</html>', { status: 502 }), 'unavailable'],
		[async () => { throw new TypeError('network'); }, 'unreachable']
	]) {
		const f = transport(fetch_impl);
		try { await f.run({ consume: response => response.text() }); } catch {}
		assert.deepEqual(f.changes, [expected]);
		let dispatched = false;
		await assert.rejects(f.context.service_fetch(async () => { dispatched = true; }, '', {}, {}), { code: 'service_paused' });
		assert.equal(dispatched, false);
		f.availability.reset();
	}
});

test('transport ignores old-origin failures and does not treat 401/429 as outages', async () => {
	for (const status of [200, 401, 426, 429]) {
		const f = transport(async () => new Response('', { status }));
		await f.run({}); assert.deepEqual(f.changes, []);
	}
	let release;
	const f = transport(() => new Promise(resolve => { release = resolve; }));
	const running = f.run({});
	f.context.session_generation++;
	release(Response.json({ error: 'maintenance' }, { status: 503 }));
	await running; assert.deepEqual(f.changes, []);
});

test('timeouts and interrupted JSON bodies create notices and retain the body timeout', async () => {
	const f = transport((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))));
	await assert.rejects(f.run({ timeout: 5 }));
	assert.deepEqual(f.changes, ['unreachable']);
	const g = transport(async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }));
	await assert.rejects(g.run({ consume: response => response.json() }));
	assert.deepEqual(g.changes, ['unavailable']);
});

test('local Support conversation opens without requests and has no composer or reactions', async () => {
	const c = service_conversation('maintenance', key => key, null, 100);
	const same = service_conversation('maintenance', key => key, c, 200);
	assert.equal(c.created_at, same.created_at);
	assert.equal(c.unread_count, 1);
	assert.equal(c.viewer_side, 'player');
	const state = { chat_notification_preferences: {}, chat_messages: [], chat_conversations: [c],
		scroll_chat_messages_to_bottom: async () => {} };
	Object.assign(state, install_chat_actions({ state, runtime: { chat_view_generation: 0 } }));
	state.scroll_chat_messages_to_bottom = async () => {};
	await state.open_chat_conversation(c);
	assert.deepEqual(state.chat_messages, [c.latest_message]);
	await state.send_chat_message(); // A stale composer event cannot send to a synthetic ID.
	assert.equal(state.get_chat_notification_unread(), 1);
	const resolved = service_conversation('resolved', key => key, c, 200);
	assert.equal(resolved.conversation_id, c.conversation_id);
	assert.equal(resolved.unread_count, 0);
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.match(templates, /mp-chat-compose[^\n]*synthetic_service !== true/);
	assert.ok(c.latest_message.message_id < 1);
});

test('all packaged languages translate every service notice and title', async () => {
	const root = new URL('../../mod/data/lang/', import.meta.url);
	const english = JSON.parse(await readFile(new URL('en.json', root), 'utf8'));
	for (const file of await readdir(root)) {
		if (!file.endsWith('.json')) continue;
		const language = JSON.parse(await readFile(new URL(file, root), 'utf8'));
		for (const key of ['TITLE', 'MAINTENANCE', 'UNREACHABLE', 'UNAVAILABLE', 'RESOLVED']) {
			const id = 'MOD_MP_SERVICE_' + key;
			assert.equal(typeof language[id], 'string', `${file}: ${id}`);
			assert.ok(language[id].trim());
			if (file !== 'en.json') assert.notEqual(language[id], english[id], `${file}: untranslated ${id}`);
		}
	}
});

test('one Support notice survives inbox refreshes, changes reason, and clears its badge on recovery', () => {
	const notices = [], state = { chat_conversations: [{ conversation_kind: 'private', unread_count: 2 }],
		get_chat_notification_unread() { return this.chat_conversations.reduce((n, c) => n + c.unread_count, 0); } };
	const context = vm.createContext({ state, service_module: { service_conversation }, getLangString: key => key,
		interface_ready: true, update_chat_nav: () => notices.push(state.chat_unread), stop_chat_polling() {} });
	vm.runInContext(main.slice(main.indexOf('function update_service_notice('), main.indexOf('async function service_fetch(')), context);
	context.update_service_notice('maintenance');
	const c = state.chat_conversations.find(c => c.synthetic_service);
	state.selected_chat_conversation = c;
	context.update_service_notice('unreachable');
	assert.equal(state.chat_conversations.length, 2);
	assert.equal(state.selected_chat_conversation.service_status, 'unreachable');
	assert.equal(state.chat_messages.length, 1);
	context.update_service_notice('resolved');
	assert.equal(state.service_status, null);
	assert.equal(state.selected_chat_conversation.service_status, 'resolved');
	assert.deepEqual(notices, [3, 3, 2]);
});

test('successful probes resume live polling or bootstrap a failed initial connection, without replaying a command', async () => {
	for (const connected of [true, false]) {
		const calls = [], f = fixture();
		f.availability.fail('maintenance');
		const state = { is_connected: connected };
		const context = vm.createContext({ state, server_host: 'https://selected.example', session_generation: 1,
			document: {}, polling: { is_foreground: () => true }, service_availability: f.availability,
			service_fetch: async (...args) => { assert.equal(args[4], true); return { status: 200, json: { api_versions: [2] } }; },
			fetch() {}, update_service_notice: kind => calls.push(kind),
			start_multiplayer_session: async () => calls.push('login'), read_cache: { invalidate: () => calls.push('invalidate') },
			start_client_event_polling: () => calls.push('events'), start_chat_polling: () => calls.push('chat') });
		vm.runInContext(main.slice(main.indexOf('async function probe_multiplayer_service('), main.indexOf('function handle_session_response(')), context);
		assert.equal(await context.probe_multiplayer_service(), true);
		assert.equal(f.availability.active(), false);
		assert.deepEqual(calls, connected ? ['resolved', 'invalidate', 'events', 'chat'] : ['resolved', 'login']);
	}
});
