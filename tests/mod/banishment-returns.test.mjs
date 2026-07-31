import assert from 'node:assert/strict';
import test from 'node:test';

import { apply_banishment_claim } from '../../mod/banishment-returns.mjs';

test('merges returned items and GP into existing transfer entries once', () => {
	const inventory = [{ id: 'melvorD:Iron_Ore', qty: 2 }];
	const processed = [];
	const claim = {
		claim_id: 'claim-1',
		items: [
			{ id: 'melvorD:Iron_Ore', qty: 3 },
			{ id: 'melvorD:Coal_Ore', qty: 4 }
		],
		gp: 5
	};

	assert.equal(apply_banishment_claim(inventory, processed, claim, 32), true);
	assert.deepEqual(inventory, [
		{ id: 'melvorD:Iron_Ore', qty: 5 },
		{ id: 'melvorD:GP', qty: 5 },
		{ id: 'melvorD:Coal_Ore', qty: 4 }
	]);
	assert.equal(apply_banishment_claim(inventory, processed, claim, 32), false);
	assert.deepEqual(inventory[0], { id: 'melvorD:Iron_Ore', qty: 5 });
});

test('rejects a server claim that exceeds the declared local capacity', () => {
	const inventory = [{ id: 'melvorD:Iron_Ore', qty: 1 }];
	assert.throws(() => apply_banishment_claim(inventory, [], {
		claim_id: 'claim-2',
		items: [{ id: 'melvorD:Coal_Ore', qty: 1 }],
		gp: 0
	}, 1), RangeError);
});
