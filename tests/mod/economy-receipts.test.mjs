import assert from 'node:assert/strict';
import test from 'node:test';

import { apply_economy_receipt } from '../../mod/economy-receipts.mjs';

function harness({ bank = {}, gp = 0, transfer = [], maximum = 32 } = {}) {
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
