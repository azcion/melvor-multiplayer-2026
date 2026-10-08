import assert from 'node:assert/strict';
import test from 'node:test';
import { create_read_cache, create_request_scheduler } from '../../mod/request-coordinator.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
test('shares concurrent reads, clones results, expires and invalidates after mutations', async () => {
	let clock = 0, scope = 'a', calls = 0;
	const cache = create_read_cache({ scope: () => scope, now: () => clock, ttl: 100 });
	const load = async () => { calls++; await delay(1); return { items: [1] }; };
	const [first, second] = await Promise.all([cache.read('inbox', load), cache.read('inbox', load)]);
	first.items.push(2);
	assert.deepEqual(second.items, [1]);
	assert.equal(calls, 1);
	await cache.read('inbox', load); assert.equal(calls, 1);
	clock = 101; await cache.read('inbox', load); assert.equal(calls, 2);
	cache.invalidate(); await cache.read('inbox', load); assert.equal(calls, 3);
	scope = 'b'; await cache.read('inbox', load); assert.equal(calls, 4);
});

test('an old read cannot overwrite a mutation or another server/session', async () => {
	let scope = 'a', finish;
	const cache = create_read_cache({ scope: () => scope });
	const pending = cache.read('inbox', () => new Promise(resolve => { finish = resolve; }));
	await Promise.resolve();
	cache.invalidate(); cache.prime('inbox', { items: [2] }); finish({ items: [1] });
	assert.deepEqual(await pending, { items: [2] });
	assert.deepEqual(await cache.read('inbox', () => null), { items: [2] });
	const other = cache.read('guild', () => new Promise(resolve => { finish = resolve; }));
	await Promise.resolve(); scope = 'b'; finish({ private: true });
	assert.equal(await other, null);
});

test('queued acknowledgements run before optional reads and capacity replenishes', async () => {
	const scheduler = create_request_scheduler({ concurrency: 1, capacity: 2, read_reserve: 0, refill_per_second: 100 });
	const order = []; let release;
	const first = scheduler.run(0, () => new Promise(resolve => { release = resolve; order.push('first'); }));
	await Promise.resolve();
	const read = scheduler.run(0, () => order.push('history'));
	const ack = scheduler.run(1, () => order.push('acknowledge'));
	release(); await Promise.all([first, read, ack]);
	assert.deepEqual(order, ['first', 'acknowledge', 'history']);
});

test('reads preserve request tokens for durable writes', async () => {
	const scheduler = create_request_scheduler({ capacity: 2, read_reserve: 1, refill_per_second: 100 });
	const order = [];
	await scheduler.run(0, () => order.push('first'));
	const history = scheduler.run(0, () => order.push('history'));
	const ack = scheduler.run(1, () => order.push('acknowledge'));
	await Promise.all([history, ack]);
	assert.deepEqual(order, ['first', 'acknowledge', 'history']);
});

test('a 429 pauses the shared queue for Retry-After', async () => {
	let clock = 0;
	const scheduler = create_request_scheduler({ now: () => clock, refill_per_second: 100 });
	scheduler.observe(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
	let sent = false;
	const request = scheduler.run(1, () => { sent = true; });
	await delay(5); assert.equal(sent, false);
	clock = 3000;
	// New work wakes the queue; both use the same cooldown/budget.
	await Promise.all([request, scheduler.run(1, () => {})]);
	assert.equal(sent, true);
});

test('invalidating Inbox leaves unrelated in-flight Guild reads intact', async () => {
	const cache = create_read_cache({ scope: () => 'a' });
	let finish;
	const guild = cache.read('guild', () => new Promise(resolve => { finish = resolve; }));
	await Promise.resolve();
	cache.invalidate(key => key === 'inbox'); finish({ members: [2] });
	assert.deepEqual(await guild, { members: [2] });
});

test('all callers discard an invalidated response and share its fresh replacement', async () => {
	const cache = create_read_cache({ scope: () => 'a' });
	let finish;
	let calls = 0;
	const load = () => ++calls === 1 ? new Promise(resolve => { finish = resolve; }) : { fresh: true };
	const first = cache.read('inbox', load);
	const second = cache.read('inbox', load);
	await Promise.resolve(); cache.invalidate(); finish({ old: true });
	assert.deepEqual(await Promise.all([first, second]), [{ fresh: true }, { fresh: true }]);
	assert.equal(calls, 2);
});

test('stale queued reads are discarded before consuming request capacity', async () => {
	const scheduler = create_request_scheduler({ capacity: 1, read_reserve: 0, concurrency: 1, refill_per_second: 100 });
	let release, valid = true;
	const active = scheduler.run(0, () => new Promise(resolve => { release = resolve; }));
	await Promise.resolve();
	const stale = scheduler.run(0, () => assert.fail('stale read sent'), () => valid);
	const rejection = assert.rejects(stale, { name: 'AbortError' });
	valid = false; release();
	await Promise.all([active, rejection, scheduler.run(1, () => {})]);
});

test('twenty repeated page visits share one Transfers and one Guild snapshot', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const transfers = ['/api/inbox', '/api/market/haggles', ...['inbox', 'outbox', 'pending'].map(pane => `/api/transfers/history?pane=${pane}`)];
	const guild = ['/api/guilds/state', '/api/alliances', '/api/guilds/council?page=0', '/api/guilds/members/shadowed?page=0&search=', '/api/guilds/activity'];
	const calls = [];
	const context = {
		state: { multiplayer_unsupported: false }, read_cache: create_read_cache({ scope: () => 'a' }),
		page_snapshots_supported: true, session_generation: 1, selected_api_major: 2, server_host: 'https://example.test',
		session_token: 'test-session', CACHED_READS: new Set([...transfers, ...guild]), transport_diagnostics: null,
		cache_bust_api_endpoint: endpoint => endpoint, resolve_api_endpoint: endpoint => endpoint,
		handle_session_response() {}, enter_unsupported_multiplayer() {}, error() {},
		coordinated_request: async (url, _options, request) => {
			calls.push(url);
			const routes = url.includes('page=transfers') ? transfers : guild;
			const data = Object.fromEntries(routes.map(route => [route, { entries: [], server_time: 100 }]));
			return request.consume(Response.json({ data }));
		}
	};
	const prepare = main.slice(main.indexOf('async function prepare_page_snapshot'), main.indexOf('async function coordinated_request'));
	const reads = main.slice(main.indexOf('async function api_get(endpoint)'), main.indexOf('async function api_post_response('));
	runInNewContext(prepare + reads, context);
	for (let i = 0; i < 20; i++) {
		await context.prepare_page_snapshot('transfers');
		await Promise.all(transfers.map(route => context.api_get(route)));
		await context.prepare_page_snapshot('guild');
		await Promise.all(guild.map(route => context.api_get(route)));
	}
	assert.equal(calls.length, 2);
	context.read_cache.invalidate();
	await Promise.all([context.prepare_page_snapshot('transfers'), context.prepare_page_snapshot('transfers')]);
	assert.equal(calls.length, 3);
});

test('History refreshes coalesce and wait for claim/receipt completion', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('function schedule_transfer_history_refresh'), main.indexOf('async function refresh_transfer_history'));
	const timers = new Map(); let id = 0, refreshes = 0;
	const context = {
		state: { inbox_claiming: true, is_connected: true, is_transfer_page_visible: true },
		economy_commands_ready: true, transfer_history_refresh_timer: null,
		clearTimeout: timer => timers.delete(timer), setTimeout: callback => { timers.set(++id, callback); return id; },
		refresh_transfer_history: async () => { refreshes++; }
	};
	runInNewContext(source, context);
	context.schedule_transfer_history_refresh(); context.schedule_transfer_history_refresh();
	assert.equal(timers.size, 1);
	const tick = () => { const callback = [...timers.values()][0]; timers.clear(); callback(); };
	tick(); assert.equal(refreshes, 0); assert.equal(timers.size, 1);
	context.state.inbox_claiming = false; context.economy_commands_ready = false;
	tick(); assert.equal(refreshes, 0);
	context.economy_commands_ready = true;
	tick(); assert.equal(refreshes, 1);
});

test('the transport prioritizes acknowledgements and treats POST read routes as reads', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function coordinated_request'), main.indexOf('async function api_get(endpoint)'));
	const priorities = [];
	const context = { session_generation: 1, server_host: 'https://example.test', fetch: () => {},
		request_scheduler: { run(priority, run, valid) { assert.equal(valid(), true); priorities.push(priority); return run(); }, observe() {} },
		polling: { fetch_with_timeout: async (_fetch, _url, _options, request) => request.consume(Response.json({ success: true })) }
	};
	runInNewContext(source, context);
	for (const [route, method] of [['market/catalog', 'POST'], ['market/search', 'POST'], ['transfers/get_contents', 'POST'],
		['market/cancel', 'POST'], ['inbox/acknowledge', 'POST'], ['economy/receipts/acknowledge', 'POST'], ['pages/snapshot', 'GET']])
		await context.coordinated_request('https://example.test/api/v2/' + route, { method }, { consume: response => response.json() });
	assert.deepEqual(priorities, [0, 0, 0, 1, 2, 2, 0]);
});


test('repeated invalidation retries are bounded and never cross a session boundary', async () => {
	let scope = 'a', calls = 0;
	const cache = create_read_cache({ scope: () => scope });
	assert.equal(await cache.read('guild', () => { calls++; cache.invalidate(); return { stale: true }; }), null);
	assert.equal(calls, 3);
	calls = 0;
	assert.equal(await cache.read('guild', () => { calls++; scope = 'b'; return { old_identity: true }; }), null);
	assert.equal(calls, 1);
});

test('changed Events preserve pending startup and Chat reads while refreshing cached page reads', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const cache = create_read_cache({ scope: () => 'a' });
	const finishes = new Map();
	const routes = ['/api/identities', '/api/expedition/state', '/api/chat/state', '/api/guilds/state'];
	const calls = new Map();
	const reads = routes.map(route => cache.read(route, () => {
		calls.set(route, (calls.get(route) ?? 0) + 1);
		return calls.get(route) === 1 ? new Promise(resolve => finishes.set(route, resolve)) : { fresh: true };
	}));
	await Promise.resolve();
	const constants = main.slice(main.indexOf('const CACHED_READS ='), main.indexOf('let transfer_history_module'));
	const invalidate = main.match(/read_cache\.invalidate\(key => CACHED_READS[^;]+;/)[0];
	runInNewContext(constants + invalidate, { read_cache: cache });
	for (const finish of finishes.values()) finish({ initial: true });
	const values = await Promise.all(reads);
	assert.deepEqual(values, [{ initial: true }, { initial: true }, { initial: true }, { fresh: true }]);
	assert.deepEqual([...calls.values()], [1, 1, 1, 2]);
});

test('expected read cancellation is quiet while a genuine transport timeout stays visible', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function api_get_request('), main.indexOf('async function api_post_response('));
	const errors = [];
	const context = { state: {}, session_generation: 1, selected_api_major: 2, server_host: 'https://example.test',
		session_token: 'fixture', transport_diagnostics: null, resolve_api_endpoint: route => route,
		cache_bust_api_endpoint: route => route, error: (...args) => errors.push(args),
		coordinated_request: async () => { throw new DOMException('Cancelled', 'AbortError'); }
	};
	runInNewContext(source, context);
	assert.equal(await context.api_get_request('/api/guilds/state', () => false), null);
	assert.equal(errors.length, 0);
	assert.equal(await context.api_get_request('/api/guilds/state', () => true), null);
	assert.equal(errors.length, 1);
});
