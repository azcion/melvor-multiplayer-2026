import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { create_poc_server } from '../../scripts/chat-data-poc.mjs';
import { discover_media_root, resolve_items } from '../../scripts/chat-data-poc/resolve.mjs';

test('resolves official IDs, localized names and media while rejecting unsafe media', () => {
	const data = { namespace: 'melvorD', data: { items: [
		{ id: 'Normal_Logs', name: 'Normal Logs', media: 'assets/media/bank/logs_normal.png?2' },
		{ id: 'Unknown', name: 'Fallback', media: 'https://untrusted.example/image.png' }
	] } };
	const items = resolve_items(data, { ITEM_NAME_Normal_Logs: 'Holzscheite' }, 'https://cdn2-main.melvor.net/');
	assert.equal(items[0].id, 'melvorD:Normal_Logs');
	assert.equal(items[0].name, 'Holzscheite');
	assert.equal(items[0].media, 'https://cdn2-main.melvor.net/assets/media/bank/logs_normal.png?2');
	assert.equal(items[1].name, 'Fallback'); assert.equal(items[1].media, null);
	assert.throws(() => resolve_items({}, {}, ''), /format/);
});

test('discovers the observed CDN expression without executing source and fails on drift', () => {
	assert.equal(discover_media_root('return `https://cdn2-main.melvor.net${getPathWithoutFile()}/`;'), 'https://cdn2-main.melvor.net/');
	assert.throws(() => discover_media_root('throw new Error("must not execute")'), /resolver changed/);
});

test('relay limits sources, rejects foreign origins, and caches only successful upstream results', async t => {
	const calls = [];
	const server = create_poc_server({ fetch_upstream: async (url, options) => {
		calls.push({ url: url.href, options }); return new Response('{"ok":true}');
	} });
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(() => { server.closeAllConnections(); server.close(); });
	const base = `http://127.0.0.1:${server.address().port}`;
	assert.equal((await fetch(`${base}/source?key=items`)).status, 200);
	assert.equal((await fetch(`${base}/source?key=items`)).status, 200);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://steam.melvoridle.com/assets/data/melvorDemo.json');
	assert.equal(calls[0].options.credentials, 'omit');
	assert.equal(calls[0].options.redirect, 'error');
	assert.equal((await fetch(`${base}/source?key=https://example.com`)).status, 404);
	assert.equal((await fetch(`${base}/source?key=items`, { headers: { Origin: 'https://example.com' } })).status, 403);
	assert.equal((await fetch(base, { method: 'POST' })).status, 405);
	assert.equal(calls.length, 1);
});

test('a failed upstream response can be retried without restarting the relay', async t => {
	let attempts = 0;
	const server = create_poc_server({ fetch_upstream: async () => ++attempts === 1
		? new Response('Unavailable', { status: 503 }) : new Response('{"ok":true}') });
	server.listen(0, '127.0.0.1'); await once(server, 'listening');
	t.after(() => { server.closeAllConnections(); server.close(); });
	const url = `http://127.0.0.1:${server.address().port}/source?key=en`;
	assert.equal((await fetch(url)).status, 502);
	assert.deepEqual(await (await fetch(url)).json(), { ok: true });
	assert.equal(attempts, 2);
});
