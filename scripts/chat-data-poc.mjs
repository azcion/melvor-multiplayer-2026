#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const UPSTREAM = 'https://steam.melvoridle.com/';
// Exact files only: this is not an arbitrary URL proxy. No game cookies or credentials.
export const SOURCES = Object.freeze({
	items: 'assets/data/melvorDemo.json',
	en: 'lang/en.json',
	de: 'lang/de.json',
	'zh-CN': 'lang/zh-CN.json',
	assets: 'assets/js/built/assets.js'
});
const files = new Map([
	['/', ['index.html', 'text/html']],
	['/poc.css', ['poc.css', 'text/css']],
	['/poc.mjs', ['poc.mjs', 'text/javascript']],
	['/resolve.mjs', ['resolve.mjs', 'text/javascript']]
]);

export function create_poc_server({ fetch_upstream = fetch } = {}) {
	const cache = new Map();
	return createServer(async (req, res) => {
		const host = `127.0.0.1:${req.socket.localPort}`;
		const send = (status, body, type = 'text/plain') => {
			res.writeHead(status, {
				'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
				'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://steam.melvoridle.com; img-src https://cdn2-main.melvor.net; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
			});
			res.end(body);
		};
		if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== `http://${host}`))
			return send(403, 'Localhost only');
		if (req.method !== 'GET') return send(405, 'GET only');
		const url = new URL(req.url, `http://${host}`);
		try {
			if (files.has(url.pathname)) {
				const [file, type] = files.get(url.pathname);
				return send(200, await readFile(new URL(`./chat-data-poc/${file}`, import.meta.url)), type);
			}
			if (url.pathname === '/source') {
				const key = url.searchParams.get('key');
				if (!Object.hasOwn(SOURCES, key)) return send(404, 'Unknown source');
				if (!cache.has(key)) {
					const task = (async () => {
						const upstream = await fetch_upstream(new URL(SOURCES[key], UPSTREAM), {
							signal: AbortSignal.timeout(20_000), redirect: 'error', credentials: 'omit', cache: 'no-cache'
						});
						if (!upstream.ok) throw new Error(`Official source returned HTTP ${upstream.status}`);
						const body = await upstream.text();
						if (body.length > 8_000_000) throw new Error('Official source exceeds prototype limit');
						if (key !== 'assets') JSON.parse(body);
						return body;
					})();
					cache.set(key, task);
					task.catch(() => cache.delete(key));
				}
				return send(200, await cache.get(key), key === 'assets' ? 'text/plain' : 'application/json');
			}
			return send(404, 'Not found');
		} catch (error) {
			return send(502, error.message);
		}
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const port = Number(process.env.CHAT_DATA_POC_PORT ?? 3347);
	create_poc_server().listen(port, '127.0.0.1', function () {
		console.log(`Melvor chat data proof of concept: http://127.0.0.1:${this.address().port}`);
	});
}
