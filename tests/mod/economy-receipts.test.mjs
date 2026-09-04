import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	apply_economy_receipt,
	forget_processed_economy_receipt,
	is_complete_economy_receipt_page,
	remember_acknowledged_economy_receipt,
	summarize_market_fulfillment_receipts
} from '../../mod/economy-receipts.mjs';

function harness({ bank = {}, gp = 0, transfer = [], maximum = 6 } = {}) {
	const state = { bank: { ...bank }, gp, transfer: transfer.map(item => ({ ...item })), saved_ids: [] };
	return {
		state,
		adapter: {
			maximum_transfer_entries: maximum,
			has_bank_item: id => Object.hasOwn(state.bank, id),
			get_bank_qty: id => state.bank[id],
			add_bank_item: (id, qty) => state.bank[id] += qty,
			remove_bank_item: (id, qty) => state.bank[id] -= qty,
			get_gp: () => state.gp,
			add_gp: qty => state.gp += qty,
			remove_gp: qty => state.gp -= qty,
			get_transfer_inventory: () => state.transfer,
			replace_transfer_inventory: value => state.transfer = value,
			persist_processed_ids: value => state.saved_ids = [...value]
		}
	};
}

test('applies all effects once and records the receipt', () => {
	const { state, adapter } = harness({ bank: { logs: 10 }, gp: 100, transfer: [{ id: 'logs', qty: 5 }] });
	const processed = [];
	const receipt = {
		id: 'receipt-1',
		kind: 'test',
		effects: [
			{ storage: 'bank', item_id: 'logs', qty: -2 },
			{ storage: 'gp', qty: 25 },
			{ storage: 'transfer', item_id: 'logs', qty: -3 }
		]
	};

	assert.equal(apply_economy_receipt(receipt, processed, adapter), 'applied');
	assert.deepEqual(state, { bank: { logs: 8 }, gp: 125, transfer: [{ id: 'logs', qty: 2 }], saved_ids: ['receipt-1'] });
	assert.equal(apply_economy_receipt(receipt, processed, adapter), 'already-applied');
	assert.deepEqual(state, { bank: { logs: 8 }, gp: 125, transfer: [{ id: 'logs', qty: 2 }], saved_ids: ['receipt-1'] });
});

test('rounds a legacy fractional Campaign GP receipt before applying it', () => {
	const { state, adapter } = harness({ gp: 100 });
	const processed = [];
	const receipt = {
		id: 'legacy-campaign-receipt',
		kind: 'campaign-claim',
		effects: [{ storage: 'gp', qty: 125.6 }]
	};

	assert.equal(apply_economy_receipt(receipt, processed, adapter), 'applied');
	assert.equal(state.gp, 226);
	assert.deepEqual(state.saved_ids, ['legacy-campaign-receipt']);
});

test('does not normalize fractional effects outside legacy Campaign claims', () => {
	const { state, adapter } = harness({ gp: 100 });
	const result = apply_economy_receipt({
		id: 'fractional-market-receipt',
		kind: 'market-buy',
		effects: [{ storage: 'gp', qty: 125.6 }]
	}, [], adapter);

	assert.equal(result, 'invalid');
	assert.equal(state.gp, 100);
});

test('forgets a receipt ID after acknowledgement without affecting other IDs', () => {
	assert.deepEqual(
		forget_processed_economy_receipt(['receipt-1', 'receipt-2', 'receipt-1'], 'receipt-1'),
		['receipt-2']
	);
	assert.deepEqual(forget_processed_economy_receipt(['receipt-2'], 'receipt-2'), []);
});

test('retains a bounded in-memory guard for stale duplicate deliveries after acknowledgement', () => {
	const acknowledged = [];
	remember_acknowledged_economy_receipt(acknowledged, 'receipt-1');
	remember_acknowledged_economy_receipt(acknowledged, 'receipt-1');
	assert.deepEqual(acknowledged, ['receipt-1']);

	for (let index = 2; index <= 129; index++)
		remember_acknowledged_economy_receipt(acknowledged, `receipt-${index}`);

	assert.equal(acknowledged.length, 128);
	assert.equal(acknowledged.includes('receipt-1'), false);
	assert.equal(acknowledged.at(-1), 'receipt-129');
});

test('only treats a short pending-receipt page as complete', () => {
	assert.equal(is_complete_economy_receipt_page([], 64), true);
	assert.equal(is_complete_economy_receipt_page(Array.from({ length: 63 }), 64), true);
	assert.equal(is_complete_economy_receipt_page(Array.from({ length: 64 }), 64), false);
	assert.equal(is_complete_economy_receipt_page(null, 64), false);
});

test('subtracts only the submitted transfer quantity when inventory changes in flight', () => {
	const { state, adapter } = harness({ transfer: [{ id: 'logs', qty: 9 }, { id: 'fish', qty: 4 }] });
	const result = apply_economy_receipt({
		id: 'receipt-2',
		kind: 'gift-send',
		effects: [{ storage: 'transfer', item_id: 'logs', qty: -5 }]
	}, [], adapter);

	assert.equal(result, 'applied');
	assert.deepEqual(state.transfer, [{ id: 'logs', qty: 4 }, { id: 'fish', qty: 4 }]);
});

test('preflights the complete receipt before mutating any asset', () => {
	const { state, adapter } = harness({ bank: { logs: 1 }, gp: 5 });
	const result = apply_economy_receipt({
		id: 'receipt-3',
		kind: 'market-buy',
		effects: [
			{ storage: 'bank', item_id: 'logs', qty: 2 },
			{ storage: 'gp', qty: -10 }
		]
	}, [], adapter);

	assert.equal(result, 'blocked');
	assert.deepEqual(state, { bank: { logs: 1 }, gp: 5, transfer: [], saved_ids: [] });
});

test('retains an oversized Transfer Inventory while blocking new receipt entries', () => {
	const transfer = Array.from({ length: 7 }, (_, index) => ({ id: `item-${index}`, qty: 1 }));
	const { state, adapter } = harness({ transfer, maximum: 6 });

	const blocked = apply_economy_receipt({
		id: 'receipt-over-cap',
		kind: 'market-fulfill',
		effects: [{ storage: 'transfer', item_id: 'new-item', qty: 1 }]
	}, [], adapter);

	assert.equal(blocked, 'blocked');
	assert.deepEqual(state.transfer, transfer);
});

test('preserves the destroyable transfer boundary', () => {
	const { state, adapter } = harness({ transfer: [{ id: 'logs', qty: 2 }] });
	const result = apply_economy_receipt({
		id: 'receipt-4',
		kind: 'market-destroy',
		effects: [{ storage: 'transfer', item_id: 'logs', qty: 1, destroyable: true }]
	}, [], adapter);

	assert.equal(result, 'blocked');
	assert.deepEqual(state.transfer, [{ id: 'logs', qty: 2 }]);
});

test('summarizes fulfilled items and combines repeated item receipts', () => {
	const summary = summarize_market_fulfillment_receipts([
		{ id: 'market-1', kind: 'market-fulfill', effects: [{ storage: 'bank', item_id: 'logs', qty: 5 }] },
		{ id: 'gift-1', kind: 'gift-accept', effects: [{ storage: 'bank', item_id: 'fish', qty: 7 }] },
		{ id: 'market-2', kind: 'market-fulfill', effects: [
			{ storage: 'bank', item_id: 'fish', qty: 3 },
			{ storage: 'bank', item_id: 'logs', qty: 2 },
			{ storage: 'gp', qty: 10 }
		] }
	]);

	assert.deepEqual(summary, {
		order_count: 2,
		items: [
			{ item_id: 'logs', qty: 7 },
			{ item_id: 'fish', qty: 3 }
		]
	});
});

test('hydrates Campaign event state before a blocked receipt can stop event reconciliation', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const events = main.slice(
		main.indexOf('async function get_client_events_request'),
		main.indexOf('function start_client_event_polling')
	);

	assert.ok(events.indexOf('reconcile_campaign_event(res.campaign)') <
		events.indexOf('reconcile_economy_receipts(pending_economy_receipts'));
});

test('rounds and validates Campaign rewards before submitting a claim', async () => {
	const actions = await readFile(
		new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url),
		'utf8'
	);
	const claim = actions.slice(
		actions.indexOf('async claim_campaign_reward'),
		actions.indexOf('// #endregion', actions.indexOf('async claim_campaign_reward'))
	);

	assert.match(claim, /const reward_value = Math\.round\(/);
	assert.match(claim, /!Number\.isSafeInteger\(reward_value\) \|\| reward_value <= 0/);
	assert.ok(claim.indexOf('Number.isSafeInteger(reward_value)') < claim.indexOf("api_post('/api/campaign/claim'"));
});
