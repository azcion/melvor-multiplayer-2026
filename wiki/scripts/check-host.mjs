// Read-only smoke check for the actual static server (not just the Node preview).
import assert from 'node:assert/strict';
const origin = process.argv[2];
if (!origin || !/^https?:\/\//.test(origin)) throw new Error('Usage: node wiki/scripts/check-host.mjs http://127.0.0.1:3081');
const cases = [
	['/wiki/',200,'text/html'], ['/wiki/council/',200,'text/html'],
	['/wiki/category/economy/',200,'text/html'],
	['/wiki/assets/wiki.mjs',200,'text/javascript'], ['/wiki/assets/search.mjs',200,'text/javascript'],
	['/wiki/assets/wiki.css',200,'text/css'], ['/wiki/assets/search-index.json',200,'application/json'],
	['/wiki/assets/logo.png',200,'image/png'], ['/wiki/assets/multiplayer.svg',200,'image/svg+xml'],
	['/wiki/not-a-real-article/',404,'text/html'], ['/wiki/assets/not-an-asset.mjs',404,'text/html'],
	['/wiki/revision.txt',200,'text/plain']
];
for (const [path,status,type] of cases) {
	const response = await fetch(new URL(path,origin),{signal:AbortSignal.timeout(10_000)});
	assert.equal(response.status,status,path);
	assert.ok(response.headers.get('content-type')?.startsWith(type),`${path}: ${response.headers.get('content-type')}`);
	assert.equal(response.headers.get('cache-control'),'no-cache',path);
	assert.equal(response.headers.get('x-content-type-options'),'nosniff',path);
	assert.equal(response.headers.get('referrer-policy'),'no-referrer',path);
	const csp = response.headers.get('content-security-policy');
	assert.ok(csp?.includes("frame-ancestors 'none'") && !csp.includes('unsafe-inline'),path);
	assert.ok((await response.arrayBuffer()).byteLength > 0,path);
}
const canonical = await fetch(new URL('/wiki?q=heat',origin),{redirect:'manual'});
assert.equal(canonical.status,308);
assert.equal(canonical.headers.get('location'),'/wiki/?q=heat');
const article = await fetch(new URL('/wiki/council',origin),{redirect:'manual'});
assert.ok([301,308].includes(article.status)); assert.equal(article.headers.get('location'),'/wiki/council/');
console.log(`${cases.length + 2} static hosting checks passed for ${origin}`);
