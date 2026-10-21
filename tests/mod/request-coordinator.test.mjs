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
		unavailable_guild_previews: new Set(), guild_preview_scope: null,
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
	const reads = main.slice(main.indexOf('async function api_get(endpoint,'), main.indexOf('async function api_post_response('));
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
	const source = main.slice(main.indexOf('async function coordinated_request'), main.indexOf('async function api_get(endpoint,'));
	const priorities = [];
	const context = { session_generation: 1, server_host: 'https://example.test', fetch: () => {},
		chat_page_visible: false, guild_page_visible: false, crucible_page_visible: false, expedition_page_visible: false, state: {},
		request_scheduler: { run(priority, run, valid) { assert.equal(valid(), true); priorities.push(priority); return run(); }, observe() {} },
		polling: { fetch_with_timeout: async (_fetch, _url, _options, request) => request.consume(Response.json({ success: true })) }
	};
	context.service_fetch = context.polling.fetch_with_timeout;
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
	const invalidate = main.match(/read_cache\.invalidate\(key => \(CACHED_READS[^;]+;/)[0];
	runInNewContext(constants + invalidate, { read_cache: cache, guild_changed: true });
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

test('missing Guild previews survive Council refreshes but reset across servers and sessions', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function api_get(endpoint,'), main.indexOf('async function api_post_response('));
	let status = 404, calls = 0;
	const context = { state: {}, session_generation: 1, selected_api_major: 2, server_host: 'https://one.test',
		session_token: 'fixture', transport_diagnostics: null, resolve_api_endpoint: route => route,
		cache_bust_api_endpoint: route => route, handle_session_response: () => {}, error: () => {},
		unavailable_guild_previews: new Set(), guild_preview_scope: null, CACHED_READS: new Set(),
	};
	// Numeric HTTP errors have no JSON body in the actual server.
	context.coordinated_request = async (_url, _options, request) => {
		calls++;
		return request.consume(new Response(status === 200 ? '{"guild":{"guild_id":111}}' : '',
			{ status, headers: status === 200 ? { 'Content-Type': 'application/json' } : {} }));
	};
	context.read_cache = create_read_cache({ scope: () => context.server_host + ':' + context.session_generation });
	runInNewContext(source, context);
	const endpoint = '/api/alliances/guild-preview?guild_id=111';
	assert.equal((await context.api_get(endpoint)).guild, null);
	context.read_cache.invalidate();
	assert.equal((await context.api_get(endpoint)).guild, null);
	assert.equal(calls, 1);
	context.session_generation++;
	await context.api_get(endpoint);
	assert.equal(calls, 2);
	context.server_host = 'https://two.test';
	status = 503;
	assert.equal(await context.api_get(endpoint), null);
	status = 200;
	assert.equal((await context.api_get(endpoint)).guild.guild_id, 111);
	assert.equal(calls, 4);
	status = 404;
	assert.equal(await context.api_get('/api/guilds/state'), null);
	assert.equal(await context.api_get_request(endpoint, () => false), null);
});

test('foreground reads preserve recovery capacity and aged work receives a fair turn', async () => {
	let time = 0, release;
	const observations = [], order = [];
	const scheduler = create_request_scheduler({ now: () => time, concurrency: 1, capacity: 8,
		observe: entry => observations.push(entry) });
	const first = scheduler.run(0, () => new Promise(resolve => { release = resolve; }));
	await Promise.resolve();
	const background = scheduler.run(0, () => order.push('background'));
	time = 16000;
	const foreground = scheduler.run(1, () => order.push('foreground'), () => true, true);
	const ack = scheduler.run(2, () => order.push('ack'));
	release();
	await Promise.all([first, background, foreground, ack]);
	assert.deepEqual(order, ['ack', 'background', 'foreground']);
	assert.equal(observations.some(entry => entry.queue_wait_ms === 16000), true);
});

test('a foreground read cannot consume the reserved acknowledgement token', async () => {
	const order = [];
	// Capacity must accommodate the reserve plus a read after refill.
	const usable = create_request_scheduler({ capacity: 2, read_reserve: 1, refill_per_second: 200 });
	await usable.run(0, () => {});
	const read = usable.run(1, () => order.push('read'), () => true, true);
	const ack = usable.run(2, () => order.push('ack'));
	await Promise.all([read, ack]);
	assert.deepEqual(order, ['ack', 'read']);
});

test('Chat entry hydrates without a second Events-triggered inbox read; background consumers share the same key', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const toggle = main.slice(main.indexOf("on_page_toggle('mp-chat-page'"), main.indexOf("on_page_toggle('mp-crucible-page'"));
	let enter, calls = 0, finish;
	const context = {
		state: { is_connected: true }, chat_page_visible: false, chat_view_generation: 0,
		update_chat_header_offset() {}, stop_chat_polling() {},
		get_client_events: () => assert.fail('Chat entry should not request unrelated Events'),
		refresh_chat_page: () => { calls++; }, on_page_toggle: (_page, callback) => { enter = callback; }
	};
	runInNewContext(toggle, context);
	enter(true); assert.equal(calls, 1);
	enter(false); assert.equal(context.chat_view_generation, 1);

	context.read_cache = create_read_cache({ scope: () => 'origin:session' });
	Object.assign(context, { server_host: 'origin', session_generation: 1, guild_preview_scope: null,
		unavailable_guild_previews: new Set(), CACHED_READS: new Set(),
		api_get_request: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
	runInNewContext(main.slice(main.indexOf('async function api_get(endpoint,'), main.indexOf('async function api_get_request(')), context);
	const route = '/api/chat/conversations?capabilities=global-chat-v1';
	const page = context.api_get(route);
	const events = context.api_get(route);
	await Promise.resolve();
	finish({ conversations: [], unread: 3 });
	assert.deepEqual(await page, await events);
	assert.equal(calls, 2); // One page callback and one transport for both readers.
});

test('Guild startup waits for Events invalidation, reuses hydration, falls back on failure and rejects old sessions', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function refresh_initial_guild_state'), main.indexOf('async function refresh_guild_state_after_invalidation'));
	for (const outcome of ['snapshot', 'failure', 'session-change']) {
		let finish, reads = 0;
		let cache;
		const context = { session_generation: 1, state: { is_connected: true },
			get_client_events: () => new Promise(resolve => { finish = resolve; }),
			refresh_guild_state: () => cache.read('/api/guilds/state', () => { reads++; return { affiliation: 'member' }; }) };
		cache = create_read_cache({ scope: () => context.session_generation });
		runInNewContext(source, context);
		const pending = context.refresh_initial_guild_state();
		assert.equal(reads, 0);
		cache.invalidate();
		if (outcome === 'snapshot') cache.prime('/api/guilds/state', { affiliation: 'member' });
		if (outcome === 'session-change') context.session_generation++;
		finish(outcome === 'failure' ? null : {});
		await pending;
		assert.equal(reads, outcome === 'failure' ? 1 : 0);
	}
});

test('first and changed Guild revisions hydrate eligibility from one snapshot, including Guildless transitions', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const start = main.indexOf('else if (guild_changed || !state.guild_state_loaded)');
	const branch = main.slice(start + 5, main.indexOf('\n\t\tupdate_guild_nav();', start));
	const cache = create_read_cache({ scope: () => 'session' });
	let snapshots = 0, reads = 0, decisions = 0, affiliation = 'member';
	const context = { guild_changed: true, guild_page_visible: false, request_generation: 1, session_generation: 1,
		state: { guild_state_loaded: false, is_guild_member: false, refresh_alliance: async () => { decisions++; } },
		prepare_page_snapshot: async () => { snapshots++; cache.prime('/api/guilds/state', { affiliation }); },
		refresh_guild_state: async () => {
			const result = await cache.read('/api/guilds/state', () => { reads++; return { affiliation }; });
			context.state.is_guild_member = result.affiliation === 'member'; context.state.guild_state_loaded = true;
		}, refresh_council: async () => { decisions++; } };
	runInNewContext('async function refresh() {' + branch + '}', context);
	await context.refresh();
	assert.equal(snapshots, 1); assert.equal(reads, 0); assert.equal(decisions, 2);
	context.guild_changed = false;
	await context.refresh(); assert.equal(snapshots, 1);
	context.guild_changed = true; affiliation = 'none'; cache.invalidate();
	await context.refresh();
	assert.equal(snapshots, 2); assert.equal(reads, 0); assert.equal(decisions, 2);
	assert.equal(context.state.is_guild_member, false);
});

test('page entry waits for Events before Guild reads so revision invalidation cannot duplicate hydration', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	for (const page of ['transfer', 'market', 'crucible']) {
		for (const changed of [true, false, null]) {
			let enter, finish, reads = 0, content = 0;
			const cache = create_read_cache({ scope: () => 'session' });
			const context = { crucible_page_entry: 0, crucible_page_hydrating: false,
				state: { refresh_crucible: async () => { content++; } }, performance: { now: () => 1 },
				on_page_toggle: (_page, callback) => { enter = callback; },
				get_client_events: () => new Promise(resolve => { finish = async () => {
					if (changed) {
						cache.invalidate();
						cache.prime('/api/guilds/state', { affiliation: 'member' });
					}
					resolve(changed === null ? null : {});
				}; }),
				refresh_guild_state: () => cache.read('/api/guilds/state', () => { reads++; return { affiliation: 'member' }; }),
				prepare_page_snapshot: async () => {}, update_transfer_contents: async () => { content++; },
				update_market_haggles: async () => {}, refresh_transfer_history: async () => {},
				update_market_page: async () => { content++; }, set_crucible_page_visible() {}, recover_pending_crucible_wish_actions: async () => {} };
			const start = main.indexOf("on_page_toggle('mp-" + page + "-page'");
			const end = main.indexOf(page === 'transfer' ? '\n\t});' : '\n\t\t\t},', start);
			runInNewContext(main.slice(start, end) + '\n});', context);
			const pending = enter(true);
			await Promise.resolve();
			assert.equal(reads, 0, page + ' must wait for Events');
			assert.equal(content, 0);
			await finish();
			await pending;
			assert.equal(reads, changed ? 0 : 1, page + ' reuses changed-revision hydration or falls back');
			assert.equal(content, 1);
		}
	}
});
