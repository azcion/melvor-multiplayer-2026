import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { create_economy_receipt_reviews } from '../../mod/economy-receipt-reviews.mjs';
import * as economy_receipts from '../../mod/economy-receipts.mjs';

const receipt = { id: '11111111-1111-4111-8111-111111111111', kind: 'crucible-cast',
	effects: [{ storage: 'bank', item_id: 'heads', qty: -353 }] };

function queue_harness() {
	let stored, current = true, result = null;
	const reports = [];
	const options = { read: () => stored, write: value => { stored = structuredClone(value); }, current: () => current,
		report: async payload => { reports.push(payload); return result; } };
	return { options, reports, saved: () => stored, stale: () => { current = false; }, respond: value => { result = value; } };
}

test('review persists before background reporting and retries after reload without duplicate reports', async () => {
	const h = queue_harness(), queue = create_economy_receipt_reviews(h.options);
	assert.equal(queue.defer(receipt.id, 'blocked'), true);
	assert.equal(h.reports.length, 0);
	assert.equal(h.saved()[0].reported, false);
	await queue.flush();
	const reloaded = create_economy_receipt_reviews(h.options);
	assert.equal(reloaded.has(receipt.id), true);
	h.respond({ success: true });
	assert.equal(reloaded.flush(), reloaded.flush());
	await reloaded.flush();
	await reloaded.flush();
	assert.equal(h.reports.length, 2);
	assert.equal(h.saved()[0].reported, true);
	assert.equal(reloaded.has(receipt.id), true, 'reported IDs remain protected from stale responses');
});

test('review never releases a command without durable storage and isolates stale sessions', async () => {
	const h = queue_harness();
	assert.equal(create_economy_receipt_reviews({ ...h.options, write() {} }).defer(receipt.id, 'blocked'), false);
	assert.equal(create_economy_receipt_reviews({ ...h.options, write() { throw Error('denied'); } }).defer(receipt.id, 'blocked'), false);
	let release;
	const queue = create_economy_receipt_reviews({ ...h.options, report: () => new Promise(resolve => { release = resolve; }) });
	queue.defer(receipt.id, 'invalid');
	const pending = queue.flush();
	await Promise.resolve();
	h.stale();
	release({ success: true });
	await pending;
	assert.equal(h.saved()[0].reported, false);
	assert.equal(queue.has(receipt.id), false);
	assert.equal(queue.defer(crypto.randomUUID(), 'blocked'), false);
});

test('main recovery quarantines missing deductions, continues later receipts, and never deducts them after reload', async () => {
	const h = queue_harness(), storage = new Map(), retired = [], acknowledged = [];
	let bank = 0;
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('function reconcile_economy_receipts('), main.indexOf('\nfunction show_pending_banishment_notice'));
	const context = {
		economy_receipt_reviews: create_economy_receipt_reviews(h.options), economy_receipts,
		server_host: 'https://one.test', session_generation: 1, economy_receipt_reconciliation: Promise.resolve(),
		rollback_client: null, acknowledged_economy_receipt_ids: [],
		get_instance_storage_item: key => storage.get(key), set_instance_storage_item: (key, value) => storage.set(key, value), remove_instance_storage_item: key => storage.delete(key),
		economy_command_journal: { retire: id => retired.push(id), acknowledge: id => acknowledged.push(id) },
		TRANSFER_INVENTORY_MAX_LIMIT: 6, transfer_currency_support: null,
		game: { items: { getObjectByID: () => ({}) }, bank: { getQty: () => bank, removeItemQuantity: (_item, qty) => { bank -= qty; } } },
		state: { transfer_inventory: [], is_crucible_item_discovered: () => true }, add_bank_item: (_id, qty) => { bank += qty; },
		api_post: async () => ({ success: true }), queue_market_fulfillment_notice() {}, error() {}
	};
	runInNewContext(source, context);
	const incoming = { id: crypto.randomUUID(), kind: 'market-buy', effects: [{ storage: 'bank', item_id: 'ore', qty: 7 }] };
	assert.equal(await context.reconcile_economy_receipts([receipt, incoming]), true);
	assert.equal(bank, 7);
	assert.deepEqual(retired, [receipt.id]);
	assert.deepEqual(acknowledged, [incoming.id]);
	bank = 500;
	context.economy_receipt_reviews = create_economy_receipt_reviews(h.options);
	assert.equal(await context.reconcile_economy_receipts([receipt]), true);
	assert.equal(bank, 500, 'later Bank changes must not trigger an unexpected old deduction');
	const malformed = { id: crypto.randomUUID(), kind: 'market-buy', effects: [{ storage: 'bank', qty: 'invalid' }] };
	assert.equal(await context.reconcile_economy_receipts([malformed]), true);
	assert.equal(context.economy_receipt_reviews.has(malformed.id), true);
	context.api_post = async () => null;
	const lost_ack = { ...incoming, id: crypto.randomUUID() };
	assert.equal(await context.reconcile_economy_receipts([lost_ack]), true);
	assert.equal(bank, 507);
	assert.equal(await context.reconcile_economy_receipts([lost_ack]), true);
	assert.equal(bank, 507, 'lost acknowledgement cannot cause duplicate application');
	assert.equal(h.saved().find(entry => entry.id === lost_ack.id).reason, 'acknowledgement_failed');
	const held = { ...receipt, id: crypto.randomUUID() };
	context.rollback_client = { is_retired: () => false, allows_receipt: () => false };
	assert.equal(await context.reconcile_economy_receipts([held]), false);
	assert.equal(context.economy_receipt_reviews.has(held.id), false, 'explicit rollback holds still require admission');
	assert.equal(bank, 507);
});
