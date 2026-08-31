import assert from 'node:assert/strict';
import test from 'node:test';
import { create_installation_store, create_transport_diagnostics, detect_runtime, sanitize_app_details, diagnostic_route } from '../../mod/connection-diagnostics.mjs';
import { fetch_with_timeout } from '../../mod/polling.mjs';
import { read_client_source } from './source.mjs';

function storage() {
	const values = new Map();
	return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
test('installation IDs and reported app details stay local and isolated by normalized server origin', () => {
	const local = storage();
	const store = create_installation_store(local);
	const first = store.read('https://one.example/');
	store.update('https://one.example', { app_channel: 'beta', distribution: 'huawei_appgallery', client_key: 'SECRET' });
	const restored = create_installation_store(local).read('https://one.example');
	assert.equal(restored.installation_id, first.installation_id);
	assert.equal(restored.app_channel, 'beta');
	assert.equal(restored.distribution, 'huawei_appgallery');
	assert.equal('client_key' in restored, false);
	assert.notEqual(store.read('https://two.example').installation_id, first.installation_id);
	assert.equal(store.read('https://two.example').app_channel, 'unknown');
	assert.notEqual(create_installation_store(storage()).read('https://one.example').installation_id, first.installation_id);
});
test('restricted storage retains an ephemeral installation without blocking or regenerating each request', () => {
	const store = create_installation_store({ getItem() { throw Error(); }, setItem() { throw Error(); } });
	assert.equal(store.read('https://one.example').installation_id, store.read('https://one.example').installation_id);
});
test('engine, beta promotion, and handset brand never imply a release channel or distribution', () => {
	assert.deepEqual(detect_runtime({ isAndroid: true, isGeckoView: true, showNewAppBeta: true }, 'SECRET huawei'), { platform: 'android', engine: 'gecko' });
	assert.equal(sanitize_app_details({ showNewAppBeta: true }).app_channel, 'unknown');
	assert.equal(sanitize_app_details({ manufacturer: 'Huawei' }).distribution, 'unknown');
	assert.deepEqual(detect_runtime({ isIOS: true }, 'AppleWebKit/1 SECRET'), { platform: 'ios', engine: 'webkit' });
	assert.deepEqual(detect_runtime({ isSteam: true }, 'Chrome/1 SECRET'), { platform: 'steam', engine: 'chromium' });
	assert.deepEqual(detect_runtime(undefined), { platform: 'unknown', engine: 'unknown' });
	assert.doesNotThrow(() => detect_runtime({ get isAndroid() { throw Error('restricted'); } }));
});
test('reports are bounded, strip queries and unknown routes, and reconstruct an explicit allowlist', () => {
	const diagnostic = create_transport_diagnostics(() => 1234);
	for (let i = 0; i < 55; i++) diagnostic.record({ route: 'https://private-host/api/events?token=SECRET', method: 'GET', status: 200, outcome: 'ok', duration_ms: i, body: 'SECRET' });
	const report = diagnostic.report({ mod_version: '1.4.5', connected: true,
		device: { installation_id: crypto.randomUUID(), platform: 'android', engine: 'gecko', app_channel: 'beta', user_agent: 'SECRET', ip: 'SECRET', token: 'SECRET' } });
	const parsed = JSON.parse(report);
	assert.equal(parsed.requests.length, 50);
	assert.equal(parsed.requests[0].duration_ms, 5);
	assert.equal(parsed.requests[0].route, '/api/events');
	assert.ok(!report.includes('SECRET'));
	assert.ok(!report.includes('private-host'));
	assert.equal(diagnostic_route('/api/SECRET'), 'other');
	assert.equal(diagnostic_route('/api/events?secret=SECRET'), '/api/events');
});
test('request observations separate HTTP, transport, response-body, and timeout failures without changing results', async () => {
	const seen = [];
	const observe = entry => seen.push(entry);
	const response = await fetch_with_timeout(async () => new Response('busy', { status: 503 }), '/api/events', {}, { observe });
	assert.equal(response.status, 503);
	assert.equal(seen.at(-1).outcome, 'http_error');
	await assert.rejects(fetch_with_timeout(async () => { throw new TypeError('SECRET'); }, '/api/events', {}, { observe }));
	assert.equal(seen.at(-1).outcome, 'network_error');
	await assert.rejects(fetch_with_timeout(async () => new Response('{'), '/api/events', {}, { observe, consume: response => response.json() }));
	assert.equal(seen.at(-1).outcome, 'response_error');
	await assert.rejects(fetch_with_timeout((_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))), '/api/events', {}, { observe, timeout: 1 }));
	assert.equal(seen.at(-1).outcome, 'timeout');
	assert.ok(!JSON.stringify(seen).includes('SECRET'));
	await assert.doesNotReject(fetch_with_timeout(async () => new Response('{}'), '/api/events', {}, { observe() { throw Error(); } }));
});
test('main client reports diagnostics without introducing new preflight headers', async () => {
	const source = await read_client_source();
	assert.match(source, /get_device_diagnostics\(\)/);
	assert.match(source, /install_diagnostics_settings/);
	assert.doesNotMatch(source, /X-Installation|X-Device|X-Diagnostic/);
});

test('diagnostics settings remain usable offline and select the report when clipboard is unavailable', async () => {
	const { install_diagnostics_settings } = await import('../../mod/connection-diagnostics.mjs');
	class Element {
		constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; }
		append(child) { this.children.push(child); }
		replaceChildren() { this.children = []; }
		addEventListener(name, fn) { this.listeners[name] = fn; }
		setAttribute() {}
		focus() { this.focused = true; }
		select() { this.selected = true; }
	}
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: tag => new Element(tag) } });
	try {
		let setting_type;
		let saved;
		install_diagnostics_settings({ settings: { type(_name, config) { setting_type = config; }, section() { return { add() {} }; } } }, {
			t: key => key, get_device: () => ({ app_channel: 'unknown' }), get_report: () => '{"connected":false}', save_details: details => { saved = details; }
		});
		assert.equal(setting_type.get(), null); // No installation data serialized into character settings.
		const root = setting_type.render();
		root.children[0].listeners.click();
		const panel = root.children[1];
		const channel = panel.children.find(e => e.textContent === 'APP_CHANNEL').children[0];
		channel.value = 'beta';
		panel.children.find(e => e.textContent === 'SAVE').listeners.click();
		assert.equal(saved.app_channel, 'beta');
		await panel.children.find(e => e.textContent === 'COPY').listeners.click();
		const report = panel.children.find(e => e.tag === 'textarea');
		assert.equal(report.value, '{"connected":false}');
		assert.equal(report.selected, true);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'document', previous);
		else delete globalThis.document;
	}
});
