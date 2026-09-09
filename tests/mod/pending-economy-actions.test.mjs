import assert from 'node:assert/strict';
import test from 'node:test';
import { create_pending_economy_actions } from '../../mod/pending-economy-actions.mjs';

function harness() {
	const storage = new Map();
	const requests = [];
	let applied = false;
	let response = null;
	const options = {
		read: key => storage.get(key), write: (key, value) => storage.set(key, structuredClone(value)),
		remove: key => storage.delete(key), uuid: () => crypto.randomUUID(),
		post: async (endpoint, payload) => { requests.push(structuredClone({ endpoint, payload })); return response; },
		reconcile: async () => applied
	};
	return { options, storage, requests, respond: value => response = value, apply: () => applied = true };
}

test('coalesces separate buttons and preserves the exact donation across timeout and reload', async () => {
	const h = harness();
	const actions = create_pending_economy_actions(h.options);
	const payload = { items: [{ id: 'logs', qty: 3 }], donation_value: 30 };
	const first = actions.run('donate', '/api/charity/donate', payload);
	const second = actions.run('donate', '/api/charity/donate', payload);
	assert.equal(first, second);
	await first;
	payload.items[0].qty = 9;
	const reloaded = create_pending_economy_actions(h.options);
	h.respond({ success: true, receipt: { id: 'receipt', effects: [] } });
	assert.equal(await reloaded.run('donate', '/api/charity/donate', payload), null);
	assert.equal(h.storage.size, 1, 'blocked receipt retains command');
	h.apply();
	assert.equal((await reloaded.run('donate', '/api/charity/donate', payload)).success, true);
	assert.equal(h.storage.size, 0);
	assert.deepEqual(h.requests[0], h.requests[1]);
	assert.deepEqual(h.requests[1], h.requests[2]);
	assert.equal(h.requests[2].payload.items[0].qty, 3);
});

test('refuses unsaved commands and never clears ambiguous failures', async () => {
	const h = harness();
	const unsaved = create_pending_economy_actions({ ...h.options, write() {} });
	assert.equal(await unsaved.run('donate', '/api/charity/donate', {}), null);
	assert.equal(h.requests.length, 0);
	const actions = create_pending_economy_actions(h.options);
	await actions.run('donate', '/api/charity/donate', {});
	assert.equal(h.storage.size, 1);
	h.respond({ error_lang: 'MOD_MP_GENERIC_ERR' });
	await actions.run('donate', '/api/charity/donate', {});
	assert.equal(h.storage.size, 0);
});

test('never saves a new donation snapshot while an earlier spend is unresolved', async () => {
	const h = harness();
	const actions = create_pending_economy_actions({ ...h.options, can_start: () => false });
	assert.equal(await actions.run('donate', '/api/charity/donate', { items: [{ id: 'logs', qty: 3 }] }), null);
	assert.equal(h.storage.size, 0);
	assert.equal(h.requests.length, 0);
});
