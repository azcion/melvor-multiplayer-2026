import assert from 'node:assert/strict';
import test from 'node:test';
import { api_endpoint, select_api_major, validate_api_bootstrap } from '../../mod/api-contract.mjs';

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
	const pending = runInNewContext(source + '\ndiscover_api_contract()', context);
	context.server_host = 'https://two.example';
	context.session_generation++;
	resolve(2);
	await assert.rejects(pending, /Stale API discovery/);
	assert.equal(context.selected_api_major, null);
});
