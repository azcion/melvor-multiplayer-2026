// Runs only against disposable services started by scripts/self-host-acceptance.sh.
import assert from 'node:assert/strict';

const [backend, wiki, origin, proxy] = process.argv.slice(2);
assert.ok(backend && wiki && origin, 'expected backend, wiki, and configured Browser Chat origin');
const request = (base, path, options) => fetch(base + path, options);
const jsonPost = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

for (const path of ['/chat', '/chat/assets/chat.mjs', '/chat/assets/chat.css', '/mod/chat-items.mjs']) {
	const response = await request(backend, path);
	assert.equal(response.status, 200, path);
	assert.ok((await response.arrayBuffer()).byteLength > 100, path);
}
const registration = await request(backend, '/api/v2/register', jsonPost({
	client_key: crypto.randomUUID(), display_name: 'Self-host acceptance',
	client_runtime: { mod_version: '1.7.9', active_mods: [] }
}));
assert.equal(registration.status, 200);
const player = await registration.json();
assert.ok(player.session_token);
const issued = await request(backend, '/api/v2/chat/browser-links/issue', jsonPost({}, { 'X-Session-Token': player.session_token }));
assert.equal(issued.status, 200);
const { code } = await issued.json();
assert.ok(code);
const pairRequest = jsonPost({ code }, { Origin: origin });
assert.equal((await request(backend, '/chat/api/pair', jsonPost({ code }, { Origin: 'https://foreign.example' }))).status, 403);
const paired = await request(backend, '/chat/api/pair', pairRequest);
assert.equal(paired.status, 200);
const cookie = paired.headers.get('set-cookie');
assert.ok(cookie?.includes('mp-chat-local='));
assert.equal((await request(backend, '/chat/api/pair', pairRequest)).status, 401);
const session = await request(backend, '/chat/api/session', { headers: { Origin: origin, Cookie: cookie.split(';')[0] } });
assert.equal(session.status, 200);
assert.equal((await session.json()).links[0].client_id, player.chat.client_id);

for (const path of ['/wiki/', '/wiki/council/', '/wiki/assets/wiki.mjs', '/wiki/revision.txt']) {
	const response = await request(wiki, path);
	assert.equal(response.status, 200, path);
	assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
	assert.ok((await response.arrayBuffer()).byteLength > 0, path);
}
const redirect = await request(wiki, '/wiki?q=test', { redirect: 'manual' });
assert.equal(redirect.status, 308);
assert.equal(redirect.headers.get('location'), '/wiki/?q=test');
for (const path of ['/wiki/missing/', '/chat', '/api/versions']) assert.equal((await request(wiki, path)).status, 404, path);
assert.ok(proxy);
for (const path of ['/health', '/api/versions', '/chat', '/chat/assets/chat.mjs', '/mod/chat-items.mjs', '/wiki/', '/wiki/council/', '/wiki/assets/wiki.mjs']) {
	assert.equal((await request(proxy, path)).status, 200, `proxy ${path}`);
}
const proxyRedirect = await request(proxy, '/wiki?q=test', { redirect: 'manual' });
assert.equal(proxyRedirect.status, 308);
assert.equal(proxyRedirect.headers.get('location'), '/wiki/?q=test');
assert.equal((await request(proxy, '/wiki/missing/')).status, 404);
console.log('Self-host acceptance passed: Browser Chat link exchange, wiki, and documented proxy routes.');
