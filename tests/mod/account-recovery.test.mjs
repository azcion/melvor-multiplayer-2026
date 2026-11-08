import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { create_account_recovery } from '../../mod/account-recovery.mjs';
function harness({ post = async () => ({ response: { status: 200 }, json: { identities: [{ client_id: 1 }] } }) } = {}) {
	const state = {}, calls = [], connections = [];
	let current_scope = 'origin:session:identity', reads = 0;
	const flow = create_account_recovery({ state, scope: () => current_scope,
		read_login: () => { reads++; return { melvor_token: 'synthetic-token', character_name: 'Exact Name' }; },
		post: async (path, payload) => { calls.push({ path, payload }); return post(path, payload); },
		reconnect: async value => connections.push(value), translate: value => value });
	flow.open(false);
	return { flow, state, calls, connections, reads: () => reads, change_scope: () => { current_scope = 'another'; } };
}
test('tokens are read only after explicit consent and never placed in UI state', async () => {
	const h = harness();
	await h.flow.run('list');
	assert.equal(h.reads(), 0);
	assert.equal(h.calls.length, 0);
	h.state.account_recovery_consent = true;
	await h.flow.run('list');
	assert.equal(h.calls[0].payload.character_name, 'Exact Name');
	assert.equal(h.reads(), 1);
	assert.ok(!JSON.stringify(h.state).includes('synthetic-token'));
	h.flow.close();
	assert.equal(h.state.account_recovery_consent, false);
	assert.deepEqual(h.state.account_recovery_candidates, []);
});
test('a player chooses a listed identity before recovery reauthenticates existing proof', async () => {
	const h = harness({ post: async path => ({ response: { status: 200 }, json: path.endsWith('/list')
		? { identities: [{ client_id: 1 }, { client_id: 2 }] } : { credentials: { client_identifier: 'restored', client_key: 'proof' } } }) });
	h.state.account_recovery_consent = true;
	await h.flow.run('list');
	assert.deepEqual(h.connections, []);
	await h.flow.run('connect', 3);
	assert.equal(h.calls.length, 1);
	await h.flow.run('connect', 2);
	assert.deepEqual(h.connections, [{ client_identifier: 'restored', client_key: 'proof' }]);
	assert.equal(h.state.account_recovery_busy, false);
});
test('closed dialogs and changed server/session scopes discard pending results', async () => {
	for (const stale of [h => h.flow.close(), h => h.change_scope()]) {
		let finish;
		const h = harness({ post: () => new Promise(resolve => { finish = resolve; }) });
		h.state.account_recovery_consent = true;
		const running = h.flow.run('list');
		stale(h);
		finish({ response: { status: 200 }, json: { identities: [{ client_id: 1 }] } });
		await running;
		assert.deepEqual(h.state.account_recovery_candidates, []);
	}
});
test('enrollment is opt-in while disabling recovery needs only the existing multiplayer session', async () => {
	const h = harness(); h.flow.open(true);
	await h.flow.run('enroll');
	assert.equal(h.calls.length, 0);
	h.state.account_recovery_consent = true;
	await h.flow.run('enroll');
	assert.equal(h.calls[0].path, '/api/identity-recovery/enroll');
	h.state.account_recovery_consent = false;
	await h.flow.run('disable');
	assert.equal(h.reads(), 1);
	assert.deepEqual(h.calls[1].payload, {});
});
test('failure messages never expose login tokens or raw server errors', async () => {
	const h = harness({ post: async () => { throw Error('synthetic-token'); } });
	h.state.account_recovery_consent = true;
	await h.flow.run('list');
	assert.equal(h.state.account_recovery_message, 'MOD_MP_ACCOUNT_RECOVERY_FAILED');
	assert.equal(h.state.account_recovery_busy, false);
});
test('candidate scrolling keeps modal actions outside and preserves native touch scrolling', () => {
	const html = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const modal = html.slice(html.indexOf('<template id="template-mp-account-recovery-modal">'), html.indexOf('<template id="template-mp-identity-bootstrap-modal">'));
	assert.match(modal, /mp-account-recovery-list[^>]*@touchmove\.stop/);
	const scroller = modal.split('class="mp-account-recovery-list"')[1].split('\n\t</div>')[0];
	assert.doesNotMatch(scroller, /<button/);
	assert.doesNotMatch(modal, /preventDefault|touchmove\.prevent/);
	const css = readFileSync(new URL('../../mod/ui/style.css', import.meta.url), 'utf8').split('.mp-account-recovery-list {')[1].split('}')[0];
	for (const rule of ['max-height:', 'overflow-y: scroll', '-webkit-overflow-scrolling: touch', 'touch-action: pan-y', 'overscroll-behavior-y: contain']) assert.ok(css.includes(rule));
});
