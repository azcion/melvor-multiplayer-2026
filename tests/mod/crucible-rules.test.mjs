import assert from 'node:assert/strict';
import test from 'node:test';
import { compare_crucible_offerings, get_crucible_reclaim_quantity, get_crucible_slag_chance,
	get_crucible_slag_coverage } from '../../mod/crucible-rules.mjs';

test('Offerings put Gloop first, then exact Meld progress and older stack IDs', () => {
	const offerings = [
		{ id: 5, item_id: 'test:new', meld_points: 1_000 },
		{ id: 4, item_id: 'test:middle', meld_points: 5_000 },
		{ id: 3, item_id: 'test:older', meld_points: 5_000 },
		{ id: 6, item_id: 'melvorD:Weird_Gloop', meld_points: 0 },
		{ id: 2, item_id: 'test:oldest', meld_points: 9_000 }
	];
	assert.deepEqual(offerings.sort(compare_crucible_offerings).map(row => row.id), [6, 2, 3, 4, 5]);
});

test('Slag follows earned Meld progress and paid clearing while keeping undiscovered items covered', () => {
	assert.equal(get_crucible_slag_chance(0, true, 0), 100);
	assert.equal(get_crucible_slag_chance(10_080, true, 0), 0);
	assert.equal(get_crucible_slag_chance(10_080, false, 0), 100);
	assert.equal(get_crucible_slag_chance(10_080, false, 10), 50);
	const item = { id: 'test:ore', qty: 5, generation: 2, meld_points: 2_000 };
	assert.deepEqual(get_crucible_slag_coverage(item), get_crucible_slag_coverage(item));
	assert.equal(get_crucible_slag_coverage({ ...item, id: 'melvorD:Weird_Gloop' }).covered, false);
});

test('Reclaim chooses the largest whole quantity under half the current currency balance', () => {
	const options = {
		is_currency: id => id === 'melvorD:GP',
		is_discovered: id => id === 'test:known',
		get_sale_currency: () => 'GP',
		get_currency_balance: () => 10_000,
		get_sale_value: (_id, qty) => qty * 1_000
	};
	assert.equal(get_crucible_reclaim_quantity({ id: 'test:known', qty: 8 }, options), 5);
	assert.equal(get_crucible_reclaim_quantity({ id: 'test:new', qty: 8 }, options), 1);
	assert.equal(get_crucible_reclaim_quantity({ id: 'melvorD:GP', qty: 8 }, options), 5);
	assert.equal(get_crucible_reclaim_quantity({ id: 'test:known', qty: 8 },
		{ ...options, get_currency_balance: () => 0 }), 0);
});
