import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import {
	market_page_window,
	remove_sold_out_market_result
} from '../../mod/market-results.mjs';
import { install_market_campaign_charity_actions } from '../../mod/client-actions-market-campaign-charity.mjs';
import * as charitree_rules from '../../mod/charitree-rules.mjs';

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

test('hides Marketplace pagination when there is only one page', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');

	assert.match(templates, /<div id="mp-market-pagation" v-if="state\.market_page_count > 1">/);
});

test('removes Marketplace descriptions and progress bars', async () => {
	const [templates, style] = await Promise.all([
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);
	const market_page = templates.slice(
		templates.indexOf('<template id="template-mp-market-page">'),
		templates.indexOf('<template id="template-mp-charity-page">')
	);

	assert.doesNotMatch(market_page, /MOD_MP_MARKET_WINDOW_INFO/);
	assert.doesNotMatch(market_page, /mp-market-item-bar/);
	assert.doesNotMatch(style, /mp-market-item-bar/);
	assert.doesNotMatch(style, /mp-market-item-bar-fill/);
	assert.match(style, /\.mp-market-listing-result \{\s*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
});

test('captures Marketplace queries and ignores stale generations', async () => {
	const main = await read_client_source();
	const search = main.slice(main.indexOf('async function update_market_search'),
		main.indexOf('function load_market_filter_items'));

	assert.match(search, /const generation = \+\+market_search_generation/);
	assert.match(search, /const page = state\.market_current_page/);
	assert.match(search, /const sort = state\.market_sort/);
	assert.match(search, /const direction = state\.market_direction/);
	assert.match(search, /const item_id = state\.market_filter_item/);
	assert.match(search, /api_post\('\/api\/market\/catalog',[\s\S]*direction\s*\n?\s*\}/);
	assert.match(search, /unresolved_item_ids = \(catalog\.item_ids \?\? \[\]\)\.filter\(item_id => !is_local_item_resolved\(item_id\)\)/);
	assert.match(search, /market_owner: item\.buyer \?\? item\.seller \?\? null/);
	assert.equal((search.match(/generation !== market_search_generation/g) ?? []).length, 2);
	assert.match(search, /if \(generation === market_search_generation\)\s*state\.market_search_loading = false/);
});

test('serializes overlapping Haggle refreshes and keeps the post-response refresh', async () => {
	const main = await read_client_source();
	const haggles = main.slice(main.indexOf('async function update_market_haggles'),
		main.indexOf('async function update_market_search'));

	assert.match(main, /let market_haggles_update_request = null/);
	assert.match(main, /let market_haggles_update_requested = false/);
	assert.match(haggles, /market_haggles_update_requested = true/);
	assert.match(haggles, /if \(market_haggles_update_request !== null\)\s*return market_haggles_update_request/);
	assert.match(haggles, /while \(market_haggles_update_requested\)/);
	assert.match(haggles, /if \(market_haggles_update_requested\)\s*continue/);
});

test('defaults Marketplace sorting to Recent and toggles to direction-specific Price sorting', async () => {
	const [main, actions, templates, english, chinese] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/zh-CN.json', import.meta.url), 'utf8')
	]);

	assert.match(main, /market_sort: 'recent'/);
	assert.match(actions, /this\.market_sort = 'recent'/);
	assert.match(actions, /state\.market_sort = state\.market_sort === 'recent' \? 'price' : 'recent'/);
	assert.match(templates, /MOD_MP_BUTTON_MARKET_SORT_RECENT/);
	assert.match(templates, /MOD_MP_BUTTON_MARKET_SORT_PRICE/);
	for (const language of [english, chinese]) {
		assert.match(language, /"MOD_MP_BUTTON_MARKET_SORT_RECENT":/);
		assert.match(language, /"MOD_MP_BUTTON_MARKET_SORT_PRICE":/);
		assert.doesNotMatch(language, /MOD_MP_BUTTON_MARKET_SORT_(ASC|DESC)/);
	}
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

test('uses responsive fixed columns for Marketplace item pickers and shared direction tabs', async () => {
	const [templates, style] = await Promise.all([
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);
	const market_search = templates.slice(
		templates.indexOf('<div v-if="state.market_active_tab == \'search\'">'),
		templates.indexOf('<div v-if="state.market_active_tab == \'listing\'">')
	);
	const filter_style = style.slice(
		style.indexOf('#mp-market-filter-items {'),
		style.indexOf('#mp-market-pagation')
	);
	const tablet_start = style.indexOf('@media (max-width: 1199.98px) {');
	const mobile_start = style.indexOf('@media (max-width: 767.98px) {', tablet_start);
	const mobile_filter_style = style.slice(mobile_start, style.indexOf('.mp-market-tabs > div', mobile_start));

	assert.match(market_search, /<div class="mp-market-listing-tabs" role="group">/);
	assert.doesNotMatch(market_search, /btn-group/);
	assert.match(filter_style, /display: grid;[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
	assert.match(style, /\.mp-market-search-result \{[\s\S]*grid-template-columns: 1fr \.5fr \.5fr \.5fr auto;/);
	assert.match(style.slice(tablet_start, mobile_start), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
	assert.match(mobile_filter_style, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('keeps Marketplace search inputs half-width on desktop and full-width on mobile', async () => {
	const style = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	const search_input = style.slice(
		style.indexOf('.mp-market-search-input {'),
		style.indexOf('.mp-market-search-input::placeholder')
	);
	const mobile_start = style.indexOf('@media (max-width: 767.98px) {');
	const mobile_style = style.slice(mobile_start, style.indexOf('\n\t.mp-market-tabs > div', mobile_start));

	assert.match(search_input, /width: 50%/);
	assert.doesNotMatch(search_input, /max-width:/);
	assert.match(mobile_style, /\.mp-market-search-input \{[\s\S]*width: 100%/);
});

test('tears down the buy modal before changing its reactive slider maximum', async () => {
	const main = await read_client_source();
	const buy = main.slice(main.indexOf('\tasync buy_market_item'), main.indexOf('\n\tmarket_page('));

	assert.match(buy, /hide_button_spinner\(\$button\);\s*await this\.close_modal_and_wait\('market-buy-modal'\);/);
	assert.match(buy, /close_modal_and_wait\('market-buy-modal'\);[\s\S]*state\.market_buy_item\.available/);
});

test('exposes distinct buy-order creation and fulfillment flows', async () => {
	const [actions, templates, style] = await Promise.all([
		readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
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
	assert.match(templates, /class="btn btn-success mp-market-create-buy-order-button"/);
	assert.match(templates, /class="mp-market-create-buy-order-icon" aria-hidden="true"/);
	assert.match(templates, /class="mp-market-create-buy-order-plus-horizontal"/);
	assert.match(templates, /class="mp-market-create-buy-order-plus-vertical"/);
	assert.match(style, /.mp-market-create-buy-order-icon {[\s\S]*right: 8px[\s\S]*bottom: 4px[\s\S]*background-color: #30c78d[\s\S]*width: 1\.5rem[\s\S]*height: 1\.5rem/);
	assert.match(style, /.mp-market-create-buy-order-plus-horizontal,[\s\S]*height: 2px/);
	assert.match(style, /.mp-market-create-buy-order-plus-vertical {[\s\S]*width: 2px[\s\S]*height: 100%/);
	assert.doesNotMatch(templates, /item\.buyer\.icon_id/);
	assert.match(templates, /item\.market_owner\.icon_id/);
});

test('renders a responsive buy-order form with a calculated escrow breakdown', async () => {
	const [main, templates, style, english, chinese] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8').then(JSON.parse),
		readFile(new URL('../../mod/data/lang/zh-CN.json', import.meta.url), 'utf8').then(JSON.parse)
	]);
	const form = templates.slice(
		templates.indexOf('<div v-if="state.market_active_tab == \'create\'" class="mp-market-buy-order-form">'),
		templates.indexOf('\n\t\t<div v-if="state.market_active_tab == \'search\'">')
	);

	assert.match(form, /class="p-3"/);
	assert.match(form, /MOD_MP_MARKET_ITEM_TO_REQUEST/);
	assert.match(form, /class="mp-buy-order-item-selector pointer-enabled"/);
	assert.match(form, /class="mp-buy-order-item"[\s\S]*class="mp-buy-order-item-name"/);
	assert.match(form, /class="mp-buy-order-item-chevron" aria-hidden="true">›/);
	assert.match(form, /class="mp-buy-order-item-selector pointer-enabled"[\s\S]*class="mp-buy-order-item-chevron"/);
	assert.match(form, /class="col-md-6 pr-md-2 mb-3"[\s\S]*market_create_qty/);
	assert.match(form, /class="col-md-6 pl-md-2 mb-3"[\s\S]*market_create_price/);
	assert.match(form, /mp-buy-order-field-description mt-1[\s\S]*MOD_MP_MARKET_BUY_ORDER_QTY_HINT/);
	assert.match(form, /mp-buy-order-field-description mt-1[\s\S]*MOD_MP_MARKET_BUY_ORDER_PRICE_HINT/);
	assert.match(form, /class="mp-buy-order-total mb-3"[\s\S]*MOD_MP_MARKET_ESCROW_TOTAL/);
	assert.match(form, /assets\/media\/main\/coins\.svg/);
	assert.match(form, /mp-buy-order-total-calculation[\s\S]*market_create_calculation_formatted/);
	assert.doesNotMatch(form, /class="mp-market-create-buy-order-icon"/);
	assert.match(templates, /class="mr-2" style="position: relative;"[\s\S]*class="mp-market-create-buy-order-icon"/);
	assert.match(main, /get market_create_calculation_formatted\(\)[\s\S]*formatNumber\(item_qty\)[\s\S]*formatNumber\(item_price\)/);
	assert.match(style, /\.mp-market-buy-order-form \{[\s\S]*border-top: 4px solid #f5a900/);
	assert.match(style, /\.mp-buy-order-item > mp-item-icon > img \{[\s\S]*width: 32px[\s\S]*height: 32px/);
	assert.match(style, /\.mp-buy-order-item \{[\s\S]*min-width: 0/);
	assert.match(style, /\.mp-buy-order-item-name \{[\s\S]*min-width: 0[\s\S]*overflow-wrap: break-word/);
	assert.match(style, /\.mp-buy-order-item-selector \{[\s\S]*min-height: 58px/);
	assert.match(style, /@media \(max-width: 767\.98px\) \{[\s\S]*\.mp-buy-order-item-selector \{[\s\S]*min-height: 64px/);
	const market_filter_style = style.slice(style.indexOf('.mp-market-filter {'), style.indexOf('\n}', style.indexOf('.mp-market-filter {')));
	assert.match(market_filter_style, /width: 50%/);
	assert.doesNotMatch(market_filter_style, /padding-right: 45px/);
	assert.equal(english.MOD_MP_MARKET_BUY_ORDER_QTY, 'Quantity');
	assert.equal(chinese.MOD_MP_MARKET_BUY_ORDER_QTY, '数量');
	assert.equal(english.MOD_MP_MARKET_BANK_PPI, 'Price Per Item');
	assert.equal(english.MOD_MP_MARKET_ITEM_TO_REQUEST, 'Item to Request');
	assert.equal(english.MOD_MP_MARKET_BUY_ORDER_QTY_HINT, 'How many items you want to buy');
	assert.equal(english.MOD_MP_MARKET_BUY_ORDER_PRICE_HINT, 'How much you will pay for each item');
	assert.ok(chinese.MOD_MP_MARKET_ITEM_TO_REQUEST);
	assert.ok(chinese.MOD_MP_MARKET_BUY_ORDER_QTY_HINT);
	assert.ok(chinese.MOD_MP_MARKET_BUY_ORDER_PRICE_HINT);
});

test('limits fulfillment to bank quantity and splits the fulfillment title across two lines', async () => {
	const [main, actions, templates, style] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);

	assert.match(main, /get market_fulfill_item_owned_qty\(\)[\s\S]*game\.bank\.getQty\(item\)/);
	assert.match(main, /get market_haggle_item_owned_qty\(\)[\s\S]*game\.bank\.getQty\(item\)/);
	assert.match(actions, /queue_modal\(item_name, 'market-fulfill-modal'[\s\S]*didOpen:[\s\S]*createElement\('span'\)[\s\S]*MOD_MP_MARKET_FULFILL_MODAL_TITLE/);
	assert.match(actions, /\$title\.prepend\(\$prefix\)/);
	assert.match(templates, /:data-min="1" :data-max="Math\.min\(state\.market_fulfill_item\.available, state\.market_fulfill_item_owned_qty\)"/);
	assert.match(templates, /:data-min="1" :data-max="state\.market_haggle_item\.direction == 'buy' \? Math\.min\(state\.market_haggle_item\.available, state\.market_haggle_item_owned_qty\) : state\.market_haggle_item\.available"/);
	assert.match(templates, /MOD_MP_CAMPAIGN_ITEM_OWNED/);
	assert.match(templates, /state\.market_fulfill_item_owned_qty/);
	assert.match(style, /\.mp-market-fulfill-modal-title-prefix[\s\S]*display: block[\s\S]*font-size: 0\.65em/);
});

test('renders Haggle counteroffers in a Marketplace-style modal without a quantity picker', async () => {
	const [actions, templates] = await Promise.all([
		readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8')
	]);
	const counter_template_start = templates.indexOf('template-mp-market-haggle-counter-modal');
	const counter_template = templates.slice(counter_template_start, templates.indexOf('\n</template>', counter_template_start));

	assert.match(actions, /respond_market_haggle\(event, haggle, action, from_modal = false, from_confirmation = false\)/);
	assert.match(actions, /queue_modal\('MOD_MP_MARKET_HAGGLE_COUNTER', 'market-haggle-counter-modal'/);
	assert.match(actions, /this\.market_haggle_price = haggle\.offer_price/);
	assert.match(counter_template, /MOD_MP_MARKET_HAGGLE_PRICE/);
	assert.match(counter_template, /state\.market_haggle_counter\.item_qty/);
	assert.match(counter_template, /state\.respond_market_haggle\(\$event, state\.market_haggle_counter, 'counter', true\)/);
	assert.doesNotMatch(counter_template, /mp-item-slider/);
});

test('sets the Buy, Sell, and Haggle quantity pickers to a minimum of one', async () => {
	const [components, templates] = await Promise.all([
		readFile(new URL('../../mod/client-components.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8')
	]);

	assert.match(components, /getMin\(\)[\s\S]*getAttribute\('data-min'\)[\s\S]*\?\? 0/);
	for (const template_id of ['market-buy-modal', 'market-fulfill-modal', 'market-haggle-modal']) {
		const template_start = templates.indexOf(`template-mp-${template_id}`);
		const template = templates.slice(template_start, templates.indexOf('\n</template>', template_start));
		assert.match(template, /<mp-item-slider[\s\S]*:data-min="1"/);
	}
});

test('keeps the item quantity input aligned when Vue applies a minimum after mount', async () => {
	const components = await readFile(new URL('../../mod/client-components.mjs', import.meta.url), 'utf8');

	assert.match(components, /this\.value_input = \$value/);
	assert.match(components, /current_value = Number\(state\.item_slider_value\)[\s\S]*current_value < min[\s\S]*state\.item_slider_value = min[\s\S]*this\.value_input\.value = min/);
});

test('outlines Marketplace, Transfer, and Haggle numeric inputs', async () => {
	const [components, templates, style] = await Promise.all([
		readFile(new URL('../../mod/client-components.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);

	assert.match(style, /input\.form-control\[type="number"\] \{\s*outline: 1px solid #fff7;\s*\}/);
	assert.match(components, /\$value\.classList\.add\('form-control', 'mt-2'\);\s*\$value\.type = 'number';/);
	for (const template_id of ['market-haggle-modal', 'market-haggle-counter-modal']) {
		const template_start = templates.indexOf(`template-mp-${template_id}`);
		const template = templates.slice(template_start, templates.indexOf('\n</template>', template_start));
		assert.match(template, /<input type="number"[^>]*class="form-control"/);
	}
});

test('adds a shared Max control to item quantity modals', async () => {
	const [main, components, templates, english, chinese] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/client-components.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/zh-CN.json', import.meta.url), 'utf8')
	]);

	assert.match(main, /set_item_slider_max\(\)[\s\S]*document\.querySelector\('mp-item-slider'\)\?\.set_max\(\)/);
	assert.match(components, /set_max\(\)[\s\S]*this\.slider\?\.setSliderPosition\(Infinity\)/);

	for (const template_id of ['campaign-contribute-modal', 'market-buy-modal', 'market-fulfill-modal', 'market-haggle-modal']) {
		const template_start = templates.indexOf(`template-mp-${template_id}`);
		const template = templates.slice(template_start, templates.indexOf('\n</template>', template_start));
		assert.match(template, /class="btn btn-primary" @click="state\.set_item_slider_max\(\)"[\s\S]*MOD_MP_BUTTON_MAX/);
	}

	assert.equal((templates.match(/state\.set_item_slider_max\(\)/g) ?? []).length, 4);
	assert.match(english, /"MOD_MP_BUTTON_MAX": "Max"/);
	assert.match(chinese, /"MOD_MP_BUTTON_MAX":/);
});

test('uses the compact Sell label for Marketplace fulfillment', async () => {
	const english = await readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8');

	assert.match(english, /"MOD_MP_BUTTON_MARKET_FULFILL": "Sell"/);
});

test('uses the compact Search label for every Marketplace item search surface', async () => {
	const [english, chinese] = await Promise.all([
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8').then(JSON.parse),
		readFile(new URL('../../mod/data/lang/zh-CN.json', import.meta.url), 'utf8').then(JSON.parse)
	]);

	for (const [language, expected] of [[english, 'Search'], [chinese, '搜索']]) {
		assert.equal(language.MOD_MP_PLACEHOLDER_SEARCH_ITEMS, expected);
		assert.equal(language.MOD_MP_MARKET_SEARCH, expected);
		assert.equal(language.MOD_MP_MARKET_CREATE_ITEM, expected);
	}
});

test('wraps shared Marketplace modal actions instead of clipping rows', async () => {
	const [style, english] = await Promise.all([
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8')
	]);

	const button_tray = style.slice(style.indexOf('.mp-button-tray {'), style.indexOf('\n}', style.indexOf('.mp-button-tray {')));
	assert.match(button_tray, /display: flex/);
	assert.match(button_tray, /flex-direction: row/);
	assert.match(button_tray, /gap: \.25rem/);
	assert.match(button_tray, /flex-wrap: wrap/);
	assert.match(button_tray, /justify-content: center/);
	assert.doesNotMatch(button_tray, /height:/);
	assert.match(english, /"MOD_MP_BUTTON_MARKET_PURCHASE": "Buy"/);
});

test('shows queued Marketplace fulfillment notices with item details', async () => {
	const [main, templates, style, english, chinese] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/zh-CN.json', import.meta.url), 'utf8')
	]);

	assert.match(main, /summarize_market_fulfillment_receipts\(receipts\)/);
	assert.match(main, /market_fulfillment_notice_queue/);
	assert.match(main, /notice\.order_count === 1/);
	assert.match(main, /queue_modal\([\s\S]*market-fulfillment-notice-modal[\s\S]*assets\/market\.svg/);
	assert.match(main, /market_fulfillment_notice_displaying = false;[\s\S]*show_next_market_fulfillment_notice\(\)/);
	assert.match(templates, /id="template-mp-market-fulfillment-notice-modal"/);
	assert.match(templates, /state\.market_fulfillment_notice_items/);
	assert.match(templates, /numberWithCommas\(item\.qty\)/);
	assert.match(templates, /state\.get_item_icon\(item\.item_id\)/);
	assert.match(templates, /state\.get_item_name\(item\.item_id\)/);
	const fulfillment_notice = templates.slice(
		templates.indexOf('id="template-mp-market-fulfillment-notice-modal"'),
		templates.indexOf('\n</template>', templates.indexOf('id="template-mp-market-fulfillment-notice-modal"'))
	);
	assert.doesNotMatch(fulfillment_notice, /MOD_MP_BUTTON_CLOSE/);
	assert.match(style, /\.mp-market-fulfillment-list/);
	assert.match(style, /\.mp-market-fulfillment-row[\s\S]*justify-content: center/);
	assert.match(english, /"MOD_MP_MARKET_FULFILLMENT_TITLE": "Buy Order Fulfilled"/);
	assert.match(english, /"MOD_MP_MARKET_FULFILLMENTS_TITLE": "Buy Orders Fulfilled"/);
	assert.match(english, /"MOD_MP_MARKET_FULFILLMENT_INFO": "The following items have been added to your bank:"/);
	assert.match(chinese, /"MOD_MP_MARKET_FULFILLMENT_TITLE":/);
	assert.match(chinese, /"MOD_MP_MARKET_FULFILLMENTS_TITLE":/);
	assert.match(chinese, /"MOD_MP_MARKET_FULFILLMENT_INFO":/);
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

test('keys Marketplace rows by listing ID instead of nested action buttons', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const market_page = templates.slice(
		templates.indexOf('<template id="template-mp-market-page">'),
		templates.indexOf('<template id="template-mp-charity-page">')
	);
	const owned_listings = market_page.slice(
		market_page.indexOf('state.market_listings_filtered'),
		market_page.indexOf('<div class="p-4 block" v-else-if="state.market_listings_loading">')
	);

	assert.match(owned_listings, /v-for="item in state\.market_listings_filtered" :key="item\.id"/);
	assert.doesNotMatch(owned_listings, /resolve_market_listing\(\$event, item, '[^']+'\)"[^>]*:key=/);
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

test('places Haggle before the direct Marketplace action and exposes source-labelled claims', async () => {
	const [templates, actions] = await Promise.all([
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/client-actions-market-campaign-charity.mjs', import.meta.url), 'utf8')
	]);
	const result_actions = templates.slice(templates.indexOf('state.show_market_haggle_modal(item)'),
		templates.indexOf('</div>', templates.indexOf('state.show_market_haggle_modal(item)')));
	assert.ok(result_actions.indexOf('MOD_MP_BUTTON_MARKET_HAGGLE') < result_actions.indexOf('MOD_MP_BUTTON_MARKET_BUY'));
	assert.match(templates, /haggle\.claim && !haggle\.claim\.claimed[\s\S]*MOD_MP_BUTTON_CLAIM/);
	assert.match(actions, /\/api\/market\/haggle[\s\S]*command_id: crypto\.randomUUID\(\)/);
});

test('splits Marketplace metric labels from values and keeps GP icons attached', async () => {
	const [templates, style, english, chinese] = await Promise.all([
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/data/lang/zh-CN.json', import.meta.url), 'utf8')
	]);
	const market_page = templates.slice(
		templates.indexOf('<template id="template-mp-market-page">'),
		templates.indexOf('<template id="template-mp-charity-page">')
	);

	assert.match(market_page, /<lang-string lang-id="MOD_MP_MARKET_AVAILABLE" class="mp-market-item-label" v-if="item\.direction == 'sell'"><\/lang-string>/);
	assert.match(market_page, /<lang-string lang-id="MOD_MP_MARKET_REQUESTED" class="mp-market-item-label" v-else><\/lang-string>[\s\S]*numberWithCommas\(item\.available\)/);
	assert.match(market_page, /<lang-string lang-id="MOD_MP_MARKET_WANTED" class="mp-market-item-label"><\/lang-string>[\s\S]*numberWithCommas\(item\.qty\)/);
	assert.match(market_page, /<span class="mp-market-item-value text-success mp-market-item-gp"><span>\{\{ numberWithCommas\(item\.escrow_gp\) \}\}<\/span><img class="skill-icon-xxs"/);
	assert.match(market_page, /<lang-string lang-id="MOD_MP_MARKET_SOLD_BY" class="mp-market-item-label"><\/lang-string>/);
	assert.doesNotMatch(market_page, /<mp-lang-string-f lang-id="MOD_MP_MARKET_(AVAILABLE|WANTED|SOLD|PRICE|PROFIT|ESCROW)"/);
	assert.match(style, /\.mp-market-item-label \{[\s\S]*font-size: 11px/);
	assert.match(style, /\[lang-id="MOD_MP_MARKET_SOLD_BY"\] \+ img,[\s\S]*margin: 0 3px !important/);
	assert.match(style, /\.mp-market-item-gp \{[\s\S]*display: inline-flex[\s\S]*gap: 3px/);
	for (const language of [english, chinese]) {
		assert.match(language, /"MOD_MP_MARKET_AVAILABLE": "[^\"]+"/);
		assert.match(language, /"MOD_MP_MARKET_REQUESTED": "[^\"]+"/);
		assert.doesNotMatch(language, /"MOD_MP_MARKET_AVAILABLE": "[^\"]*%s/);
		assert.match(language, /"MOD_MP_MARKET_ESCROW": "[^\"]+"/);
		assert.doesNotMatch(language, /"MOD_MP_MARKET_ESCROW": "[^\"]*%s/);
	}
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

function haggle_actions_fixture({ gp = 0, bank_qty = 0, price = 10, confirm = true } = {}) {
	const state = { market_haggle_price: price, get_item_icon: item_id => `icon:${item_id}` };
	const requests = [];
	const errors = [];
	const confirmations = [];
	const modals = [];
	state.show_transfer_confirmation = (...args) => { confirmations.push(args); };
	let spinning = false;
	const game = { gp: { amount: gp }, items: { getObjectByID: () => ({}) }, bank: { getQty: () => bank_qty } };
	const actions = install_market_campaign_charity_actions({
		state, game, crypto: { randomUUID: () => 'command' },
		getLangString: key => key,
		queue_modal: (...args) => { modals.push(args); return true; },
		is_button_spinning: () => spinning,
		show_button_spinner: () => { spinning = true; },
		hide_button_spinner: () => { spinning = false; },
		notify_error: key => errors.push(key),
		api_post: async (url, body) => { requests.push({ url, body }); return { success: true, receipt: {} }; },
		reconcile_economy_receipts: async () => true,
		close_modal_and_wait: async () => {},
		update_market_haggles: async () => {}, update_market_search: async () => {}, update_market_listings: async () => {}
	});
	return { actions, state, game, requests, errors, confirmations, modals, is_spinning: () => spinning, event: { currentTarget: {} } };
}

for (const direction of ['sell', 'buy']) {
	for (const action of ['counter', 'accept']) {
		test(`${direction} Haggle ${action} checks only the payer's additional GP`, async () => {
			const fixture = haggle_actions_fixture({ gp: 19 });
			const haggle = { id: 'haggle', revision: 1, direction, is_initiator: direction === 'sell',
				item_qty: 5, offer_price: 10, payer_escrow_gp: 30 };
			await fixture.actions.respond_market_haggle.call(fixture.state, fixture.event, haggle, action, action === 'counter');
			assert.deepEqual(fixture.errors, ['MOD_MP_MARKET_INSUFFICIENT_GP']);
			assert.equal(fixture.requests.length, 0);
			assert.equal(fixture.is_spinning(), false);
			fixture.game.gp.amount = 20;
			await fixture.actions.respond_market_haggle.call(fixture.state, fixture.event, haggle, action, action === 'counter');
			assert.equal(fixture.requests.length, 1);
			fixture.game.gp.amount = 0;
			haggle.payer_escrow_gp = 60;
			await fixture.actions.respond_market_haggle.call(fixture.state, fixture.event, haggle, action, action === 'counter');
			assert.equal(fixture.requests.length, 2);
			haggle.payer_escrow_gp = 0;
			haggle.is_initiator = !haggle.is_initiator;
			await fixture.actions.respond_market_haggle.call(fixture.state, fixture.event, haggle, action, action === 'counter');
			assert.equal(fixture.requests.length, 3);
			assert.equal(fixture.is_spinning(), false);
		});
	}
}

test('Haggle creation rejects missing GP, missing items, and unsafe totals before submission', async () => {
	const fixture = haggle_actions_fixture();
	Object.assign(fixture.state, { market_haggle_item: { id: 1, direction: 'sell', item_id: 'melvorD:Logs' },
		item_slider_value: 5, market_haggle_price: 10 });
	await fixture.actions.create_market_haggle.call(fixture.state, fixture.event);
	fixture.state.market_haggle_item.direction = 'buy';
	await fixture.actions.create_market_haggle.call(fixture.state, fixture.event);
	fixture.state.market_haggle_price = Number.MAX_SAFE_INTEGER;
	await fixture.actions.create_market_haggle.call(fixture.state, fixture.event);
	assert.deepEqual(fixture.errors, ['MOD_MP_MARKET_INSUFFICIENT_GP', 'MOD_MP_MARKET_NOT_ENOUGH_ITEM',
		'MOD_MP_MARKET_VALUE_TOO_LARGE']);
	assert.equal(fixture.requests.length, 0);
});

test('Haggle responses reject unsafe totals but never require GP for cancellation or claims', async () => {
	const fixture = haggle_actions_fixture({ price: Number.MAX_SAFE_INTEGER });
	const haggle = { item_qty: 2, offer_price: Number.MAX_SAFE_INTEGER, direction: 'sell', is_initiator: true,
		payer_escrow_gp: 0 };
	for (const action of ['counter', 'accept']) {
		await fixture.actions.respond_market_haggle.call(fixture.state, fixture.event, haggle, action, action === 'counter');
		assert.equal(fixture.is_spinning(), false);
	}
	assert.equal(fixture.requests.length, 0);
	assert.deepEqual(fixture.errors, ['MOD_MP_MARKET_VALUE_TOO_LARGE', 'MOD_MP_MARKET_VALUE_TOO_LARGE']);
	for (const action of ['terminate', 'claim'])
		await fixture.actions.respond_market_haggle.call(fixture.state, fixture.event, haggle, action, false, action === 'terminate');
	assert.equal(fixture.requests.length, 2);
});

test('opens the Haggle counteroffer modal before submitting', async () => {
	const fixture = haggle_actions_fixture();
	const haggle = { id: 'haggle', item_id: 'melvorD:Logs', item_qty: 2, offer_price: 10 };

	await fixture.actions.respond_market_haggle.call(fixture.state, fixture.event, haggle, 'counter');

	assert.deepEqual(fixture.modals[0], [
		'MOD_MP_MARKET_HAGGLE_COUNTER', 'market-haggle-counter-modal', 'icon:melvorD:Logs', { showConfirmButton: false }
	]);
	assert.equal(fixture.requests.length, 0);
});

test('routes Haggle cancellation and rejection through the shared confirmation modal', async () => {
	const cancelled = haggle_actions_fixture();
	const cancelled_haggle = {
		id: 'haggle', revision: 1, is_initiator: true, is_turn: false
	};
	await cancelled.actions.respond_market_haggle.call(cancelled.state, cancelled.event, cancelled_haggle, 'terminate');
	assert.deepEqual(cancelled.confirmations[0], ['cancel_haggle', cancelled_haggle]);
	assert.equal(cancelled.requests.length, 0);
	await cancelled.actions.respond_market_haggle.call(cancelled.state, cancelled.event, cancelled_haggle, 'terminate', false, true);
	assert.equal(cancelled.requests.length, 1);

	const rejected = haggle_actions_fixture();
	const rejected_haggle = {
		id: 'haggle', revision: 1, is_initiator: false, is_turn: true
	};
	await rejected.actions.respond_market_haggle.call(rejected.state, rejected.event, rejected_haggle, 'terminate');
	assert.deepEqual(rejected.confirmations[0], ['reject_haggle', rejected_haggle]);
	assert.equal(rejected.requests.length, 0);
	await rejected.actions.respond_market_haggle.call(rejected.state, rejected.event, rejected_haggle, 'terminate', false, true);
	assert.equal(rejected.requests.length, 1);
	assert.equal(rejected.requests[0].url, '/api/market/haggle/terminate');
});

test('the payout button excludes reserved and Haggle-settled value', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const expression = templates.match(/resolve_market_listing\(\$event, item, 'payout'\)" :class="\{ disabled: (.*?) \}"/)[1];
	const disabled = new Function('item', `return ${expression}`);
	const item = { price: 10, qty: 5, available: 0, reserved: 5, haggled: 0, payout: 0 };
	assert.equal(disabled(item), true);
	assert.equal(disabled({ ...item, reserved: 0, haggled: 5 }), true);
	assert.equal(disabled({ ...item, reserved: 2, haggled: 1 }), false);
	assert.equal(disabled({ ...item, reserved: 2, haggled: 1, payout: 20 }), true);
});

test('counter affordability uses the current balance when the offer modal is submitted', async () => {
	const errors = [];
	const game = { gp: { amount: 100 } };
	const state = { market_haggle_price: 10 };
	const actions = install_market_campaign_charity_actions({
		state, game,
		is_button_spinning: () => false, show_button_spinner: () => {}, hide_button_spinner: () => {},
		notify_error: key => errors.push(key), api_post: () => assert.fail('unaffordable counter submitted')
	});
	game.gp.amount = 0;
	await actions.respond_market_haggle.call(state, { currentTarget: {} }, {
		direction: 'buy', is_initiator: false, item_qty: 5, offer_price: 5, payer_escrow_gp: 25
	}, 'counter', true);
	assert.deepEqual(errors, ['MOD_MP_MARKET_INSUFFICIENT_GP']);
});

test('passes currency support into the Charitree action module', () => {
	const currency = { amount: 10_000 };
	const game = {
		gp: currency,
		items: { getObjectByID: () => undefined },
		bank: { getItemSalePrice: () => 0 }
	};
	const state = {};
	const actions = install_market_campaign_charity_actions({
		state,
		game,
		charitree_rules,
		is_transfer_currency: item_id => item_id === 'test:currency',
		transfer_currency_support: {
			get_transfer_currency: (_game, item_id) => item_id === 'test:currency' ? { currency } : null,
			get_transfer_currency_for_currency: () => null
		}
	});
	Object.assign(state, actions);

	assert.equal(state.get_charity_take_quantity({ id: 'test:currency', qty: 33_000 }), 5_000);
	assert.equal(state.get_charity_take_block({ id: 'test:currency', qty: 33_000 }), null);
});
