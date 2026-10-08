import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { get_transfer_currencies, get_transfer_currency } from '../../mod/transfer-currencies.mjs';

const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
function fixture(owned = 261) {
	const game = { gp: { id: 'melvorD:GP', amount: 500, media: 'gp.svg' }, slayerCoins: { id: 'melvorD:SlayerCoins', amount: 20, media: 'sc.svg' } };
	const getters = main.slice(main.indexOf('\tget market_currencies()'), main.indexOf('\tget transfer_currencies()'));
	const fields = main.slice(main.indexOf('\tbank_action_item_id:'), main.indexOf('\n\ttransfer_inventory:', main.indexOf('\tbank_action_item_id:')));
	const state = new Function('game', 'transfer_currency_support', 'is_local_item_available', 'numberWithCommas', `return ({${fields}${getters}})`)(
		game, { get_transfer_currencies }, () => true, n => Number(n).toLocaleString('en-US'));
	Object.assign(state, { item_slider_value: 1, bank_action_item_owned_qty: owned, get_transfer_currency: id => get_transfer_currency(game, id) });
	return { state, game };
}

test('listing defaults opt out of limits and opt into Haggles; quantity stays within the owned stack', () => {
	const { state } = fixture();
	assert.equal(state.bank_action_unlimited, true);
	assert.equal(state.bank_action_allow_haggles, true);
	state.set_market_listing_qty(260); assert.equal(state.item_slider_value, 260);
	state.set_market_listing_qty(999); assert.equal(state.item_slider_value, 261);
	state.set_market_listing_qty(0); assert.equal(state.item_slider_value, 1);
	state.set_market_listing_qty(NaN); assert.equal(state.item_slider_value, 1);
	state.set_market_listing_qty(1.5); assert.equal(state.item_slider_value, 1);
});

test('invalid optional pricing, finite limits, and unsafe totals prevent listing submission', () => {
	const { state } = fixture();
	assert.equal(state.bank_action_listing_valid, true);
	state.bank_action_alliance_price = '0'; assert.equal(state.bank_action_listing_valid, false);
	state.bank_action_alliance_price = '1080'; assert.equal(state.bank_action_listing_valid, true);
	state.bank_action_unlimited = false; state.bank_action_purchase_limit = 0; assert.equal(state.bank_action_listing_valid, false);
	state.bank_action_purchase_limit = 2; assert.equal(state.bank_action_listing_valid, true);
	state.bank_action_market_price = Number.MAX_SAFE_INTEGER; state.item_slider_value = 2;
	assert.equal(state.bank_action_listing_valid, false);
	assert.equal(state.market_listing_amount(state.bank_action_market_price), '—');
});

test('selected currency drives balances and totals; absent currencies cannot be listed', () => {
	const { state } = fixture();
	state.bank_action_market_currency_id = 'melvorD:SlayerCoins';
	state.bank_action_market_price = 1200; state.item_slider_value = 3;
	assert.equal(state.bank_action_listing_valid, true);
	assert.equal(state.market_listing_amount(state.bank_action_market_price), '3,600');
	assert.equal(state.market_currency_shorthand({ currency_id: state.bank_action_market_currency_id }), 'SC');
	assert.equal(state.market_currency_amount({ currency_id: state.bank_action_market_currency_id }), 20);
	state.bank_action_market_currency_id = 'melvorItA:AbyssalPieces';
	assert.equal(state.bank_action_listing_valid, false);
	assert.equal(state.market_buyable({ available: 8, buyable: 2 }), 2);
});

test('Haggle submissions check and identify the selected currency rather than the GP balance', async () => {
	const { install_market_charity_actions } = await import('../../mod/client-actions-market-charity.mjs');
	const currencies = await import('../../mod/transfer-currencies.mjs');
	const { state, game } = fixture();
	game.gp.amount = 1000000; game.slayerCoins.amount = 19;
	game.items = { getObjectByID: () => ({}) };
	const errors = [], requests = [];
	Object.assign(state, { market_haggle_item: { id: 4, direction: 'sell', item_id: 'melvorD:Apple', price: 10, currency_id: 'melvorD:SlayerCoins' }, market_haggle_price: 10, item_slider_value: 2 });
	const actions = install_market_charity_actions({ state, game, transfer_currency_support: currencies,
		crypto: { randomUUID: () => 'command' }, is_market_item_discovered: () => true,
		notify_error: key => errors.push(key), show_button_spinner: () => {}, hide_button_spinner: () => {},
		api_post: async (route, payload) => { requests.push({ route, payload }); return { success: true, receipt: {} }; },
		reconcile_economy_receipts: async () => true, close_modal_and_wait: async () => {},
		update_market_search: async () => {}, update_market_haggles: async () => {}
	});
	await actions.create_market_haggle.call(state, { currentTarget: {} });
	assert.equal(requests.length, 0);
	assert.equal(errors.length, 1);
	game.slayerCoins.amount = 20;
	await actions.create_market_haggle.call(state, { currentTarget: {} });
	assert.equal(requests.length, 1);
	assert.equal(requests[0].payload.expected_currency_id, 'melvorD:SlayerCoins');
	assert.equal(requests[0].payload.qty, 2);
});


test('listing form grows naturally inside the existing modal without a nested scroll surface', async () => {
	const template = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const style = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	const form = template.slice(template.indexOf('class="mp-market-listing-form"'), template.indexOf('<template id="template-mp-bank-tab">'));
	assert.doesNotMatch(form, /@touchmove/);
	assert.doesNotMatch(style.match(/\.mp-market-listing-form \{([^}]+)\}/)?.[1] ?? '', /overflow|max-height|touch-action/);
});


test('Multiplayer Settings waits for profile closure before opening a separate modal', async () => {
	const { install_transfer_actions } = await import('../../mod/client-actions-transfer.mjs');
	let finishClose;
	const closed = new Promise(resolve => { finishClose = resolve; });
	const calls = [];
	const state = { member_actions_error: 'old error', close_modal_and_wait: async id => { calls.push(id); await closed; } };
	const queued = [];
	const queueSource = main.slice(main.indexOf('function queue_modal('), main.indexOf('function show_modal_error('));
	const queue_modal = new Function('modal_queue_guard', 'modal_component', 'ctx', 'getLangString', 'addModalToQueue', 'log', `${queueSource}; return queue_modal;`)(
		{ reserve: () => true, release: () => {} }, id => id,
		{ getResourceUrl: path => { throw new Error(`Unexpected resource lookup: ${path}`); } }, key => key,
		options => queued.push(options), () => {});
	const actions = install_transfer_actions({ state, queue_modal: (...args) => { calls.push(args); return queue_modal(...args); } });
	const opening = actions.open_multiplayer_settings_from_options.call(state);
	assert.deepEqual(calls, ['member-actions-modal']);
	assert.equal(state.member_actions_error, '');
	finishClose(); await opening;
	assert.equal(calls[1][1], 'multiplayer-settings-modal');
	assert.equal(calls[1][3].showConfirmButton, false);
	assert.equal(queued.length, 1);
	assert.equal(queued[0].imageUrl, '');
	assert.equal(queued[0].titleText, 'MOD_MP_MULTIPLAYER_SETTINGS');
});
