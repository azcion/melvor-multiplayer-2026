import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import {
	market_page_window,
	remove_sold_out_market_result
} from '../../mod/market-results.mjs';
import { install_market_campaign_charity_actions } from '../../mod/client-actions-market-campaign-charity.mjs';

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
	assert.match(search, /const direction = state\.market_direction/);
	assert.match(search, /const item_id = state\.market_filter_item/);
	assert.match(search, /api_post\('\/api\/market\/catalog',[\s\S]*direction\s*\n?\s*\}/);
	assert.match(search, /unresolved_item_ids = \(catalog\.item_ids \?\? \[\]\)\.filter\(item_id => !is_local_item_resolved\(item_id\)\)/);
	assert.match(search, /market_owner: item\.buyer \?\? item\.seller \?\? null/);
	assert.equal((search.match(/generation !== market_search_generation/g) ?? []).length, 2);
	assert.match(search, /if \(generation === market_search_generation\)\s*state\.market_search_loading = false/);
});

test('clears stale results when switching Marketplace direction', async () => {
	const actions = await readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8');
	const direction_switch = actions.slice(
		actions.indexOf('\t\tswitch_market_direction(direction)'),
		actions.indexOf('\n\t\tshow_market_buy_modal', actions.indexOf('\t\tswitch_market_direction(direction)'))
	);

	assert.match(direction_switch, /this\.market_results = \[\]/);
	assert.match(direction_switch, /this\.market_total_items = 0/);
	assert.match(direction_switch, /this\.market_page_first\(true\)/);
});

test('limits both Marketplace item pickers to 24 results', async () => {
	const [main, templates] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8')
	]);
	const filter_getter = main.slice(
		main.indexOf('\tget market_filter_items_filtered()'),
		main.indexOf('\n\tget market_page_count')
	);

	assert.match(main, /const MARKET_FILTER_ITEMS_LIMIT = 24/);
	assert.match(filter_getter, /return items\.slice\(0, MARKET_FILTER_ITEMS_LIMIT\)/);
	assert.match(templates, /id="mp-market-create-filter-input"[^>]*class="mp-market-search-input/);
	assert.match(templates, /id="mp-market-filter-input"[^>]*class="mp-market-search-input/);
});

test('tears down the buy modal before changing its reactive slider maximum', async () => {
	const main = await read_client_source();
	const buy = main.slice(main.indexOf('\tasync buy_market_item'), main.indexOf('\n\tmarket_page('));

	assert.match(buy, /hide_button_spinner\(\$button\);\s*await this\.close_modal_and_wait\('market-buy-modal'\);/);
	assert.match(buy, /close_modal_and_wait\('market-buy-modal'\);[\s\S]*state\.market_buy_item\.available/);
});

test('exposes distinct buy-order creation and fulfillment flows', async () => {
	const [actions, templates] = await Promise.all([
		readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8')
	]);

	assert.match(actions, /api_post\('\/api\/market\/buy-order'/);
	assert.match(actions, /api_post\('\/api\/market\/fulfill'/);
	assert.match(actions, /reconcile_economy_receipts\(\[res\.receipt\]\)/);
	assert.match(actions, /queue_modal\('MOD_MP_MARKET_BUY_ORDER_CREATED_TITLE', 'market-buy-order-created-modal'/);
	assert.match(templates, /MOD_MP_MARKET_BUY_ITEMS/);
	assert.match(templates, /MOD_MP_MARKET_SELL_ITEMS/);
	assert.match(templates, /MOD_MP_BUTTON_MARKET_CREATE_BUY_ORDER/);
	assert.match(templates, /template-mp-market-fulfill-modal/);
	assert.match(templates, /template-mp-market-buy-order-created-modal/);
	assert.match(templates, /MOD_MP_MARKET_BUY_ORDER_CREATED/);
	assert.match(templates, /class="mp-market-buy-order-form"/);
	assert.match(templates, /MOD_MP_MARKET_BUY_ORDER_QTY/);
	assert.doesNotMatch(templates, /item\.buyer\.icon_id/);
	assert.match(templates, /item\.market_owner\.icon_id/);
});

test('splits owned Marketplace orders into responsive direction tabs', async () => {
	const [main, actions, templates, style] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);

	assert.match(main, /market_listing_direction: 'buy'/);
	assert.match(main, /get market_listings_filtered\(\) \{[\s\S]*item\.direction === this\.market_listing_direction/);
	assert.match(actions, /switch_market_listing_direction\(direction\)/);
	assert.match(templates, /class="mp-market-listing-tabs"/);
	assert.match(templates, /state\.market_listings_filtered/);
	assert.match(templates, /MOD_MP_MARKET_MY_BUY_ORDERS/);
	assert.match(templates, /MOD_MP_MARKET_MY_SELL_LISTINGS/);
	assert.match(style, /\.mp-market-listing-tabs \{[\s\S]*width: 100%/);
	assert.match(style, /\.mp-market-listing-tabs \.btn \{[\s\S]*flex: 1 1 0/);
});

test('switches the owned Marketplace direction without accepting invalid values', () => {
	const state = { market_listing_direction: 'buy' };
	const actions = install_market_campaign_charity_actions({ state });

	actions.switch_market_listing_direction.call(state, 'sell');
	assert.equal(state.market_listing_direction, 'sell');

	actions.switch_market_listing_direction.call(state, 'unknown');
	assert.equal(state.market_listing_direction, 'sell');
});

test('keeps the top Marketplace cards equal-width on desktop and full-width on mobile', async () => {
	const [templates, style, english] = await Promise.all([
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8')
	]);
	const market_tabs = templates.slice(
		templates.indexOf('<div class="row row-deck gutters-tiny mp-market-tabs">'),
		templates.indexOf('\n\t\t<div v-if="state.market_active_tab == \'create-filter\'">')
	);

	assert.equal((market_tabs.match(/<div>\s*<a/g) ?? []).length, 3);
	assert.match(english, /"MOD_MP_MARKET_TAB_PUBLIC_SUB": "View items for sale"/);
	assert.match(english, /"MOD_MP_MARKET_TAB_OWN_SUB": "View items you're selling"/);
	assert.match(english, /"MOD_MP_MARKET_TAB_CREATE_SUB": "Request items to buy"/);
	assert.match(style, /\.mp-market-tabs > div \{[\s\S]*flex: 1 1 0/);
	assert.match(style, /\.mp-market-tabs > div > a \{[\s\S]*width: 100%/);
	assert.match(style, /@media \(max-width: 767\.98px\) \{[\s\S]*\.mp-market-tabs \{[\s\S]*flex-direction: column/);
	assert.match(style, /\.mp-market-tabs > div \{[\s\S]*width: 100%/);
});

test('defaults a selected buy order item to its game sale value', () => {
	const item = { id: 'melvorD:Logs' };
	const state = {
		market_active_tab: 'create-filter',
		market_create_item: null,
		market_create_price: 1
	};
	const actions = install_market_campaign_charity_actions({
		state,
		game: {
			items: { getObjectByID: item_id => item_id === item.id ? item : undefined },
			bank: { getItemSalePrice: selected_item => selected_item === item ? 42 : 0 }
		}
	});

	actions.select_market_filter_item.call(state, item.id);

	assert.equal(state.market_create_item, item.id);
	assert.equal(state.market_create_price, 42);
	assert.equal(state.market_active_tab, 'create');
});
