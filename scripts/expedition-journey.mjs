#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const files = new Map([
	['/', ['tools/expedition-journey/index.html', 'text/html']],
	['/mod/expedition-journey-graph.mjs', ['mod/expedition-journey-graph.mjs', 'text/javascript']],
	...['studio.css', 'studio.mjs', 'graph.mjs'].map(file => [`/${file}`, [`tools/expedition-journey/${file}`, file.endsWith('.css') ? 'text/css' : 'text/javascript']]),
	...['v1', 'v3'].map(version => [`/content-${version}.json`, [`server/expedition-content-${version}.json`, 'application/json']])
]);
export function create_journey_server() {
	return createServer(async (request, response) => {
		const entry = files.get(request.url);
		if (!entry || request.method !== 'GET') { response.writeHead(404); response.end('Not found'); return; }
		try {
			const bytes = await readFile(new URL(`../${entry[0]}`, import.meta.url));
			response.writeHead(200, { 'Content-Type': `${entry[1]}; charset=utf-8`, 'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff',
				'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
			response.end(bytes);
		} catch { response.writeHead(500); response.end('Unable to load harness asset'); }
	});
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const port = Number(process.env.EXPEDITION_JOURNEY_PORT || 4175);
	const server = create_journey_server();
	server.on('error', error => { console.error(error.message); process.exitCode = 1; });
	server.listen(port, '127.0.0.1', () => console.log(`Journey studio: http://127.0.0.1:${server.address().port}/`));
}
