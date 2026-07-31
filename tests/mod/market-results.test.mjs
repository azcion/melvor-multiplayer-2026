import assert from 'node:assert/strict';
import test from 'node:test';

import { remove_sold_out_market_result } from '../../mod/market-results.mjs';

test('removes a sold-out result and updates buyer pagination', () => {
	const state = {
		market_results: [{ id: 41 }, { id: 42 }],
		market_total_items: 31,
		market_current_page: 2
	};

	assert.equal(remove_sold_out_market_result(state, 41, 30), true);
	assert.deepEqual(state.market_results, [{ id: 42 }]);
	assert.equal(state.market_total_items, 30);
	assert.equal(state.market_current_page, 1);
});

test('leaves buyer results unchanged when the listing is not displayed', () => {
	const state = {
		market_results: [{ id: 42 }],
		market_total_items: 1,
		market_current_page: 1
	};

	assert.equal(remove_sold_out_market_result(state, 41, 30), false);
	assert.deepEqual(state.market_results, [{ id: 42 }]);
	assert.equal(state.market_total_items, 1);
	assert.equal(state.market_current_page, 1);
});
