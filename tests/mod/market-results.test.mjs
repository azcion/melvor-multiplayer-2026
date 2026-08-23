import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import {
	market_page_window,
	remove_sold_out_market_result
} from '../../mod/market-results.mjs';

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

test('renders a bounded Marketplace page window around the current page', () => {
	assert.deepEqual(market_page_window(1, 20), [1, 2, 3, 4, 5]);
	assert.deepEqual(market_page_window(10, 20), [8, 9, 10, 11, 12]);
	assert.deepEqual(market_page_window(20, 20), [16, 17, 18, 19, 20]);
});

test('clamps a page window when no Marketplace results exist', () => {
	assert.deepEqual(market_page_window(3, 0), [1]);
});

test('captures Marketplace queries and ignores stale generations', async () => {
	const main = await read_client_source();
	const search = main.slice(main.indexOf('async function update_market_search'),
		main.indexOf('function load_market_filter_items'));

	assert.match(search, /const generation = \+\+market_search_generation/);
	assert.match(search, /const page = state\.market_current_page/);
	assert.match(search, /const sort = state\.market_sort_direction/);
	assert.match(search, /const item_id = state\.market_filter_item/);
	assert.match(search, /api_post\('\/api\/market\/catalog'/);
	assert.match(search, /unresolved_item_ids = \(catalog\.item_ids \?\? \[\]\)\.filter\(item_id => !is_local_item_resolved\(item_id\)\)/);
	assert.equal((search.match(/generation !== market_search_generation/g) ?? []).length, 2);
	assert.match(search, /if \(generation === market_search_generation\)\s*state\.market_search_loading = false/);
});

test('tears down the buy modal before changing its reactive slider maximum', async () => {
	const main = await read_client_source();
	const buy = main.slice(main.indexOf('\tasync buy_market_item'), main.indexOf('\n\tmarket_page('));

	assert.match(buy, /hide_button_spinner\(\$button\);\s*await this\.close_modal_and_wait\('market-buy-modal'\);/);
	assert.match(buy, /close_modal_and_wait\('market-buy-modal'\);[\s\S]*state\.market_buy_item\.available/);
});
