import assert from 'node:assert/strict';
import test from 'node:test';

import {
	apply_banishment_claim,
	load_transfer_delivery_state,
	replace_transfer_inventory
} from '../../mod/banishment-returns.mjs';

function delivery_state(inventory = [], processed = []) {
	return { version: 1, inventory, processed_banishment_claim_ids: processed };
}

test('preflights and applies returned items and GP to a cloned state once', () => {
	const initial = delivery_state([{ id: 'melvorD:Iron_Ore', qty: 2 }]);
	const claim = {
		claim_id: 'claim-1',
		items: [
			{ id: 'melvorD:Iron_Ore', qty: 3 },
			{ id: 'melvorD:Coal_Ore', qty: 4 }
		],
		gp: 5
	};

	const applied = apply_banishment_claim(initial, claim, 6);
	assert.equal(applied.status, 'applied');
	assert.deepEqual(applied.state, delivery_state([
		{ id: 'melvorD:Iron_Ore', qty: 5 },
		{ id: 'melvorD:GP', qty: 5 },
		{ id: 'melvorD:Coal_Ore', qty: 4 }
	], ['claim-1']));
	assert.deepEqual(initial, delivery_state([{ id: 'melvorD:Iron_Ore', qty: 2 }]));
	assert.equal(apply_banishment_claim(applied.state, claim, 6).status, 'already-applied');
});

test('leaves the complete state unchanged when capacity changes before application', () => {
	const initial = delivery_state([{ id: 'melvorD:Iron_Ore', qty: 1 }]);
	const result = apply_banishment_claim(initial, {
		claim_id: 'claim-2',
		items: [
			{ id: 'melvorD:Iron_Ore', qty: 3 },
			{ id: 'melvorD:Coal_Ore', qty: 1 }
		],
		gp: 0
	}, 1);

	assert.equal(result.status, 'blocked');
	assert.equal(result.state, initial);
	assert.deepEqual(initial, delivery_state([{ id: 'melvorD:Iron_Ore', qty: 1 }]));
});

test('migrates legacy inventory and processed IDs into one versioned record', () => {
	const migrated = load_transfer_delivery_state(
		undefined,
		[{ id: 'melvorD:Logs', qty: 2 }],
		['old-claim']
	);
	assert.deepEqual(migrated, delivery_state([{ id: 'melvorD:Logs', qty: 2 }], ['old-claim']));

	const replaced = replace_transfer_inventory(migrated, [{ id: 'melvorD:Fish', qty: 3 }]);
	assert.deepEqual(replaced, delivery_state([{ id: 'melvorD:Fish', qty: 3 }], ['old-claim']));
});

test('preserves legacy inventory entries above the current capacity', () => {
	const inventory = Array.from({ length: 7 }, (_, index) => ({ id: `melvorD:Legacy_${index}`, qty: 1 }));

	assert.deepEqual(
		load_transfer_delivery_state(undefined, inventory, []).inventory,
		inventory
	);
});
