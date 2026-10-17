import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { install_browser_link_actions } from '../../mod/browser-links.mjs';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function harness(overrides = {}) {
	const state = { is_connected: true }, requests = [], timers = new Map();
	let scope = 'https://first.example:1', origin = 'https://first.example', clock = 1000, next_timer = 0;
	Object.assign(state, install_browser_link_actions({
		state, get_scope: () => scope, get_origin: () => origin, now: () => clock,
		getLangString: key => key, navigator: {},
		set_timer: (callback, delay) => { timers.set(++next_timer, { callback, delay }); return next_timer; },
		clear_timer: id => timers.delete(id),
		api_get: async (path, valid) => { requests.push({ path, valid }); return { sessions: [{ id: 7, created_at: 1, last_browser_seen_at: 2, expires_at: 9000 }] }; },
		api_post_response: async (path, payload) => { requests.push({ path, payload }); return { response: { status: 200 }, json: { code: 'TEST-ONE-USE', expires_at: 5000, ok: true } }; },
		...overrides
	}));
	return { state, requests, timers, switch_scope() { origin = 'https://second.example'; scope = origin + ':2'; state.clear_browser_links(); }, set_clock(value) { clock = value; } };
}

test('uses logical owner endpoints, exact session revocation and the selected server Chat URL', async () => {
	const { state, requests, switch_scope } = harness();
	assert.equal(state.browser_chat_url(), 'https://first.example/chat');
	await state.manage_browser_links('issue');
	assert.equal(state.browser_link_code, 'TEST-ONE-USE');
	assert.deepEqual(requests[0], { path: '/api/chat/browser-links/issue', payload: {} });
	await state.manage_browser_links();
	assert.equal(requests[1].path, '/api/chat/browser-links/list');
	assert.equal(requests[1].valid(), true);
	await state.manage_browser_links('revoke', 999);
	assert.equal(requests.length, 2);
	await state.manage_browser_links('revoke', 7);
	assert.deepEqual(requests[2], { path: '/api/chat/browser-links/revoke', payload: { session_id: 7 } });
	assert.deepEqual(state.browser_link_sessions, []);
	assert.match(state.browser_link_feedback, /REVOKED$/);
	switch_scope();
	assert.equal(state.browser_chat_url(), 'https://second.example/chat');
	assert.equal(requests[1].valid(), false);
});

test('clears memory and expiry timer on teardown and ignores late issue/list responses', async () => {
	for (const operation of ['issue', 'list']) {
		const waiting = deferred();
		const { state, switch_scope, timers } = harness(operation === 'issue'
			? { api_post_response: () => waiting.promise } : { api_get: () => waiting.promise });
		const pending = state.manage_browser_links(operation);
		assert.equal(state.browser_link_pending, true);
		switch_scope();
		waiting.resolve(operation === 'issue' ? { response: { status: 200 }, json: { code: 'STALE', expires_at: 5000 } } : { sessions: [{ id: 99 }] });
		await pending;
		assert.equal(state.browser_link_code, '');
		assert.deepEqual(state.browser_link_sessions, []);
		assert.equal(state.browser_link_feedback, '');
		assert.equal(state.browser_link_pending, false);
		assert.equal(timers.size, 0);
	}
	const { state, timers } = harness();
	await state.manage_browser_links('issue');
	assert.equal(timers.size, 1);
	state.clear_browser_links();
	assert.equal(timers.size, 0);
});

test('a late revoke cannot delete a new scope session or clear its in-flight guard', async () => {
	const waiting = deferred();
	const { state, switch_scope } = harness({ api_post_response: () => waiting.promise });
	await state.manage_browser_links();
	const pending = state.manage_browser_links('revoke', 7);
	switch_scope();
	state.browser_link_sessions = [{ id: 7 }];
	state.browser_link_pending = true;
	waiting.resolve({ response: { status: 200 }, json: { ok: true } });
	await pending;
	assert.deepEqual(state.browser_link_sessions, [{ id: 7 }]);
	assert.equal(state.browser_link_pending, true);
	assert.equal(state.browser_link_feedback, '');
});

test('duplicate mutations are suppressed and rate-limit/offline failures release the guard for retry', async () => {
	const waiting = deferred(); let calls = 0;
	const { state } = harness({ api_post_response: () => { calls++; return waiting.promise; } });
	const issue = state.manage_browser_links('issue');
	await state.manage_browser_links('issue');
	assert.equal(calls, 1);
	waiting.resolve({ response: { status: 429 }, json: null });
	await issue;
	assert.match(state.browser_link_feedback, /RATE_LIMIT$/);
	assert.equal(state.browser_link_pending, false);
	const offline = harness({ api_post_response: async () => { throw new Error('offline'); } });
	await offline.state.manage_browser_links('issue');
	assert.match(offline.state.browser_link_feedback, /ERROR$/);
	assert.equal(offline.state.browser_link_pending, false);
	const capacity = harness({ api_post_response: async () => ({ response: { status: 409 }, json: null }) });
	await capacity.state.manage_browser_links('issue');
	assert.match(capacity.state.browser_link_feedback, /CAPACITY$/);
	assert.equal(capacity.state.browser_link_pending, false);
});

test('expires the in-memory code and prevents copying an expired code', async () => {
	let copies = 0;
	const { state, timers, set_clock } = harness({ navigator: { clipboard: { writeText: async () => { copies++; } } } });
	await state.manage_browser_links('issue');
	assert.equal([...timers.values()][0].delay, 4000);
	set_clock(5001);
	await state.copy_browser_link_code();
	assert.equal(copies, 0);
	[...timers.values()][0].callback();
	assert.equal(state.browser_link_code, '');
	assert.equal(state.browser_link_expiry, 0);
	assert.match(state.browser_link_feedback, /EXPIRED$/);
});

test('clipboard fallback keeps the code selectable and stale clipboard feedback stays cleared', async () => {
	const fallback = harness();
	await fallback.state.manage_browser_links('issue');
	await fallback.state.copy_browser_link_code();
	assert.equal(fallback.state.browser_link_code, 'TEST-ONE-USE');
	assert.match(fallback.state.browser_link_feedback, /COPY_MANUALLY$/);
	const waiting = deferred(); let copied;
	const { state, switch_scope } = harness({ navigator: { clipboard: { writeText: value => { copied = value; return waiting.promise; } } } });
	await state.manage_browser_links('issue');
	const pending = state.copy_browser_link_code();
	assert.equal(copied, 'TEST-ONE-USE');
	switch_scope(); waiting.resolve(); await pending;
	assert.equal(state.browser_link_feedback, '');
});

test('Browser Chat teardown invokes cleanup through the real cached modal component lifecycle', async () => {
	const source = await readFile(new URL('../../mod/client-components.mjs', import.meta.url), 'utf8');
	const body = source.slice(source.indexOf('class MPModalComponent'), source.indexOf('class LangStringFormattedElement'));
	let clears = 0, unmounts = 0;
	class Element { getAttribute() { return 'browser-chat-modal'; } replaceChildren() {} }
	const Component = new Function('HTMLElement', 'state', body + '; return MPModalComponent;')(Element, { clear_browser_links() { clears++; } });
	const component = new Component();
	component.template_app = { unmount() { unmounts++; } };
	component.disconnectedCallback();
	assert.equal(clears, 1); assert.equal(unmounts, 1); assert.equal(component.template_app, null);
});

test('UI wires selectable code, timestamps and controls; every scope reset clears browser memory', async () => {
	const root = new URL('../../', import.meta.url);
	const [main, templates, module] = await Promise.all(['mod/main.mjs', 'mod/ui/templates.html', 'mod/browser-links.mjs'].map(path => readFile(new URL(path, root), 'utf8')));
	for (const operation of ['issue', 'list', 'revoke']) assert.ok(templates.includes(`state.manage_browser_links('${operation}'`));
	for (const field of ['created_at', 'expires_at', 'last_browser_seen_at']) assert.ok(templates.includes('browser.' + field));
	assert.match(templates, /readonly :value="state.browser_link_code"[^>]+@click="\$event.target.select\(\)"/);
	assert.match(main, /get_scope: \(\) => server_host \+ ':' \+ session_generation, get_origin: \(\) => server_host/);
	for (const match of main.matchAll(/session_generation\+\+;/g)) assert.match(main.slice(match.index, match.index + 100), /state.clear_browser_links\?\.\(\)/);
	for (const hook of ['onCharacterLoaded', 'onCharacterSelectionLoaded']) assert.ok(main.includes(`ctx.${hook}(() => {\n\t\tstate.clear_browser_links?.();`));
	assert.doesNotMatch(module, /(?:localStorage|characterStorage|set_instance_storage|session_token|console\.|fetch\()/);
});


test('Options waits for self modal teardown before opening and auto-loading Browser Chat', async () => {
	const source = await readFile(new URL('../../mod/client-actions-transfer.mjs', import.meta.url), 'utf8');
	const start = source.indexOf('async open_browser_chat_from_options()');
	const end = source.indexOf('\n\t\topen_listing_filters_settings', start);
	const waiting = deferred(), calls = [];
	const actions = new Function('queue_modal', 'return ({' + source.slice(start, end) + '});')((...args) => calls.push(args));
	const state = { ...actions, close_modal_and_wait(id) { assert.equal(id, 'member-actions-modal'); return waiting.promise; }, manage_browser_links(operation) { calls.push(operation); } };
	const opening = state.open_browser_chat_from_options();
	assert.equal(calls.length, 0);
	waiting.resolve(); await opening;
	assert.equal(calls[0][1], 'browser-chat-modal');
	assert.equal(calls[0][3].showConfirmButton, false);
	calls[0][3].didOpen();
	assert.equal(calls[1], 'list');
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const settings = templates.slice(templates.indexOf('<template id="template-mp-multiplayer-settings-modal">'), templates.indexOf('</template>', templates.indexOf('<template id="template-mp-multiplayer-settings-modal">')));
	assert.doesNotMatch(settings, /MOD_MP_BROWSER_LINK/);
	assert.match(templates, /@click="state.open_browser_chat_from_options\(\)"/);
	const modal = templates.slice(templates.indexOf('<template id="template-mp-browser-chat-modal">'));
	assert.doesNotMatch(modal, /mp-browser-chat-scroll/);
	assert.doesNotMatch(modal, /touchmove[^>]*prevent/);
	assert.ok(modal.indexOf('mp-browser-chat-close') > modal.lastIndexOf('</article>'));
});

test('failed initial list shows retry feedback without claiming the browser list is empty', async () => {
	const { state } = harness({ api_get: async () => { throw new Error('offline'); } });
	await state.manage_browser_links('list');
	assert.equal(state.browser_links_visible, false);
	assert.equal(state.browser_link_pending, false);
	assert.match(state.browser_link_feedback, /ERROR$/);
});
