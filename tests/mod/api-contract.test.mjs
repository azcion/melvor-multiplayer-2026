import assert from 'node:assert/strict';
import test from 'node:test';
import { api_endpoint, select_api_major, validate_api_bootstrap, wiki_url, DEFAULT_WIKI_URL } from '../../mod/api-contract.mjs';
import { install_page_guide_actions } from '../../mod/page-guides.mjs';

test('selects only the published v2 contract', () => {
	assert.equal(select_api_major(200, { api_versions: [2] }), 2);
	for (const status of [0, 404, 405, 401, 403, 429, 500, 503]) assert.throws(() => select_api_major(status, null));
	for (const body of [{}, { api_versions: [1] }, { api_versions: [3] }, { api_versions: ['2'] }, { api_versions: [] }])
		assert.throws(() => select_api_major(200, body));
});

test('resolves logical paths exactly once and preserves query strings', () => {
	assert.equal(api_endpoint('/api/events?revision=3', 2), '/api/v2/events?revision=3');
	assert.throws(() => api_endpoint('/api/authenticate', 1));
	assert.equal(api_endpoint('/api/client/icon-catalog/upload', 2), '/api/v2/client/icon-catalog/upload');
	for (const endpoint of ['https://other/api/events', '/api/v2/events', '/health'])
		assert.throws(() => api_endpoint(endpoint, 2));
	assert.throws(() => api_endpoint('/api/events', null));
});

test('requires the selected v2 bootstrap contract', () => {
	assert.equal(validate_api_bootstrap({}, 2), false);
	assert.equal(validate_api_bootstrap({ api_version: 1, api_versions: [1, 2] }, 2), false);
	assert.equal(validate_api_bootstrap({ api_version: 2, api_versions: [2] }, 2), true);
});

test('a stale discovery cannot pin another session or origin', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function discover_api_contract('), main.indexOf('\nfunction resolve_api_endpoint('));
	let resolve;
	const context = {
		server_host: 'https://one.example', session_generation: 1, selected_api_major: null, fetch() {},
		transport_diagnostics: null, api_contract: { select_api_major },
		polling: { fetch_with_timeout: () => new Promise(done => resolve = done) }
	};
	context.service_fetch = context.polling.fetch_with_timeout;
	const pending = runInNewContext(source + '\ndiscover_api_contract()', context);
	context.server_host = 'https://two.example';
	context.session_generation++;
	resolve(2);
	await assert.rejects(pending, /Stale API discovery/);
	assert.equal(context.selected_api_major, null);
});

test('uses only safe server-advertised wiki links', () => {
	assert.equal(wiki_url('https://wiki.example/path'), 'https://wiki.example/path');
	assert.equal(wiki_url('http://localhost:3000/wiki'), 'http://localhost:3000/wiki');
	for (const value of [undefined, '', 'javascript:alert(1)', '//example.com', 'https://user:pass@example.com/', 'x'.repeat(2049)])
		assert.equal(wiki_url(value), DEFAULT_WIKI_URL);
});

test('discovery applies the selected server wiki after the session check', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function discover_api_contract('), main.indexOf('\nfunction resolve_api_endpoint('));
	let release;
	const state = { wiki_url: DEFAULT_WIKI_URL, adventures: {supported: false} };
	const links = [];
	Object.assign(state, install_page_guide_actions({ state, queue_modal() {},
		get_element: id => ({ classList: { contains: () => id !== 'mp-raid-page' } }),
		openLink: url => links.push(url) }));
	state.show_page_guide();
	const context = { server_host: 'https://one.example', session_generation: 1, selected_api_major: null, fetch() {},
		state, transport_diagnostics: null, api_contract: { select_api_major, wiki_url },
		enter_unsupported_multiplayer() {},
		service_fetch: async (_fetch, _url, _options, { consume }) => consume({ status: 200, json: async () => {
			await new Promise(resolve => release = resolve);
			return { api_versions: [2], wiki_url: 'https://one.example/wiki' };
		} }) };
	const pending = runInNewContext(source + '\ndiscover_api_contract()', context);
	context.server_host = 'https://two.example'; context.session_generation++; release();
	await assert.rejects(pending, /Stale API discovery/);
	assert.equal(state.wiki_url, DEFAULT_WIKI_URL);
	state.open_page_guide_wiki();
	assert.equal(links.at(-1), DEFAULT_WIKI_URL + '/raids/');
	await runInNewContext(source + '\ndiscover_api_contract()', { ...context,
		service_fetch: async (_fetch, _url, _options, { consume }) => consume({ status: 200, json: async () => ({ api_versions: [2], wiki_url: 'https://two.example/wiki', capabilities: ['fighter-adventures-v1'] }) }) });
	assert.equal(state.wiki_url, 'https://two.example/wiki');
	assert.equal(state.adventures.supported, true);
	state.open_page_guide_wiki();
	assert.equal(links.at(-1), 'https://two.example/wiki/raids/');
});
