import assert from 'node:assert/strict';
import test from 'node:test';
import { create_economy_command_journal } from '../../mod/economy-command-journal.mjs';

function harness() {
	let saved, response = { response: null, json: null }, current = true, ready = true;
	const calls = [];
	const options = {
		read: () => saved, write: value => saved = structuredClone(value), remove: () => { saved = undefined; },
		send: async (...args) => { calls.push(structuredClone(args)); return response; },
		reconcile: async () => false, current: () => current, can_submit: () => ready
	};
	return { options, calls, saved: () => saved, respond: value => response = value,
		stale: () => current = false, block: () => ready = false };
}

test('coalesces duplicate commands despite newly generated UUIDs and blocks a second spend', async () => {
	const h = harness(), journal = create_economy_command_journal(h.options);
	const first = journal.run('/api/market/sell', { command_id: 'one', item_qty: 3 }, 2);
	const duplicate = journal.run('/api/market/sell', { command_id: 'two', item_qty: 3 }, 2);
	assert.equal(first, duplicate);
	await first;
	await journal.run('/api/market/sell', { command_id: 'three', item_qty: 9 }, 2);
	await journal.run('/api/gift/send', { command_id: 'four', item_qty: 3 }, 2);
	assert.equal(h.calls.length, 1);
	assert.equal(h.saved().payload.command_id, 'one');
	await journal.run('/api/market/sell', { command_id: 'five', item_qty: 3 }, 2);
	assert.deepEqual(h.calls[0], h.calls[1]);
});

test('reload recovery uses originating protocol and retains blocked receipts until acknowledgement', async () => {
	const h = harness();
	await create_economy_command_journal(h.options).run('/api/market/sell', { command_id: 'one', item_qty: 3 }, 1);
	h.respond({ response: { status: 200 }, json: { success: true, receipt: { id: 'one', effects: [] } } });
	const reloaded = create_economy_command_journal(h.options);
	assert.equal(await reloaded.recover(), false);
	assert.equal(h.calls[1][2], 1);
	reloaded.acknowledge('another');
	assert.ok(h.saved());
	reloaded.acknowledge('one');
	assert.equal(h.saved(), undefined);
});

test('does not send before recovery or after a stale generation, and keeps ambiguous failures', async () => {
	const h = harness(), journal = create_economy_command_journal(h.options);
	h.block();
	await journal.run('/api/market/sell', { command_id: 'one' }, 2);
	assert.equal(h.calls.length, 0);
	h.stale();
	await journal.run('/api/market/sell', { command_id: 'two' }, 2);
	assert.equal(h.saved(), undefined);
});

test('acknowledged replay retires the journal without reapplying effects', async () => {
	const h = harness(), journal = create_economy_command_journal(h.options);
	await journal.run('/api/market/sell', { command_id: 'one' }, 2);
	h.respond({ response: { status: 200 }, json: { success: true, receipt: null } });
	await journal.run('/api/market/sell', { command_id: 'two' }, 2);
	assert.equal(h.saved(), undefined);
});

test('does not mistake an old HTTP response for a new action after event acknowledgement', async () => {
	const h = harness();
	let release;
	const journal = create_economy_command_journal({ ...h.options,
		send: () => new Promise(resolve => release = resolve) });
	const old = journal.run('/api/market/sell', { command_id: 'one', item_qty: 3 }, 2);
	await Promise.resolve();
	journal.acknowledge('one');
	const next = await journal.run('/api/gift/send', { command_id: 'two', item_qty: 1 }, 2);
	assert.equal(next.response, null);
	assert.equal(h.saved(), undefined);
	release({ response: { status: 200 }, json: { success: true, receipt: null } });
	await old;
});

test('storage denial fails closed without sending or rejecting the recovery loop', async () => {
	const h = harness();
	const journal = create_economy_command_journal({ ...h.options, write() { throw new Error('storage denied'); } });
	assert.equal((await journal.run('/api/market/sell', { command_id: 'one' }, 2)).response, null);
	assert.equal(h.calls.length, 0);
	const denied = create_economy_command_journal({ ...h.options, read() { throw new Error('storage denied'); } });
	assert.equal(await denied.recover(), false);
	assert.equal(denied.has_pending(), true);
});
