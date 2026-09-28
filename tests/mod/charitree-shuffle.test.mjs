import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { install_market_charity_actions } from '../../mod/client-actions-market-charity.mjs';
import * as charitree_rules from '../../mod/charitree-rules.mjs';
import * as transfer_currency_support from '../../mod/transfer-currencies.mjs';
import { create_pending_economy_actions } from '../../mod/pending-economy-actions.mjs';
import { apply_economy_receipt } from '../../mod/economy-receipts.mjs';
import { install_crucible_actions } from '../../mod/client-crucible.mjs';

test('confirmation captures one offering, deducts through a once-only receipt, and refreshes the tree', async () => {
	const game = { slayerCoins: { id: 'melvorD:SlayerCoins', amount: 10000 } };
	const state = { charity_shuffle_offer: null, charity_shuffle_max_offers: [], owned_pet_ids: [], charity_currency_locks: [], charity_update_time: 10 };
	const storage = new Map();
	let processed = [];
	let requests = 0;
	let refreshes = 0;
	let modal;
	let receipt;
	let response_lost = true;
	let modal_closes = 0;
	const loader_delays = [];
	const adapter = {
		has_bank_item: id => id === game.slayerCoins.id, get_bank_qty: () => game.slayerCoins.amount,
		remove_bank_item: (id, qty) => { game.slayerCoins.amount -= qty; },
		get_transfer_inventory: () => [], maximum_transfer_entries: 6,
		persist_processed_ids: ids => { processed = ids; }
	};
	const pending = create_pending_economy_actions({
		read: key => storage.get(key), write: (key, value) => storage.set(key, structuredClone(value)), remove: key => storage.delete(key),
		uuid: () => 'shuffle-command',
		post: async (endpoint, payload) => {
			requests++;
			assert.equal(endpoint, '/api/charity/shuffle');
			assert.equal(payload.balance, 10000);
			receipt = { id: payload.command_id, kind: 'charity-shuffle', effects: [{ storage: 'bank', item_id: payload.currency_id, qty: -10 }] };
			return response_lost ? null : { success: true, receipt };
		},
		reconcile: async receipts => receipts.every(r => ['applied', 'already-applied'].includes(apply_economy_receipt(r, processed, adapter)))
	});
	const actions = install_market_charity_actions({
		state, game, charitree_rules, transfer_currency_support, is_social_only: () => false,
		queue_modal: (...args) => { modal = args; return true; }, notify() {}, notify_error() {},
		close_modal_and_wait: async template_id => {
			assert.equal(template_id, 'charity-shuffle-modal');
			modal_closes++;
			modal[3].didClose();
		},
		setTimeout: (callback, delay) => { loader_delays.push(delay); callback(); },
		run_pending_economy_action: (...args) => pending.run(...args),
		request_charity_tree_contents: async () => { refreshes++; }
	});
	Object.assign(state, actions);
	state.show_charity_shuffle();
	assert.equal(modal[1], 'charity-shuffle-modal');
	assert.equal(requests, 0);
	assert.deepEqual(state.charity_shuffle_offer, { currency_id: game.slayerCoins.id, balance: 10000, qty: 10 });
	assert.equal(state.charity_shuffle_currency().shorthand, 'SC');
	state.charity_shuffle_count = 25;
	assert.equal(state.charity_shuffle_bonus(), 20);
	await Promise.all([state.confirm_charity_shuffle({}), state.confirm_charity_shuffle({})]);
	assert.equal(modal_closes, 1);
	assert.equal(requests, 1);
	assert.equal(game.slayerCoins.amount, 10000, 'lost response never directly mutates the character');
	response_lost = false;
	state.show_charity_shuffle();
	await state.confirm_charity_shuffle({});
	assert.equal(game.slayerCoins.amount, 9990);
	assert.equal(refreshes, 1);
	assert.deepEqual(loader_delays, [2000, 2000]);
	assert.equal(apply_economy_receipt(receipt, processed, adapter), 'already-applied');
	assert.equal(game.slayerCoins.amount, 9990);
	state.charity_currency_locks = [{ currency_id: game.slayerCoins.id, locked_until: 20 }];
	assert.equal(state.get_charity_take_block({ id: game.slayerCoins.id }), 'shuffle_lock');
});

test('clears an offer when the shared modal queue rejects it so Shuffle Leaves can be retried', () => {
	const game = { slayerCoins: { id: 'melvorD:SlayerCoins', amount: 10000 } };
	const state = { charity_shuffle_offer: null };
	let queue_result = false;
	let queue_calls = 0;
	const actions = install_market_charity_actions({
		state, game, charitree_rules, transfer_currency_support, is_social_only: () => false,
		queue_modal: () => { queue_calls++; return queue_result; }, notify() {}, notify_error() {}
	});
	Object.assign(state, actions);

	state.show_charity_shuffle();
	assert.equal(state.charity_shuffle_offer, null);

	queue_result = true;
	state.show_charity_shuffle();
	assert.deepEqual(state.charity_shuffle_offer, { currency_id: game.slayerCoins.id, balance: 10000, qty: 10 });
	assert.equal(queue_calls, 2);
});

test('max preview aggregates simulated offerings and submits them as one economy command', async () => {
	const game = {
		gp: { id: 'melvorD:GP', amount: 2000, media: 'gp.svg', name: 'Gold Pieces' },
		slayerCoins: { id: 'melvorD:SlayerCoins', amount: 2000, media: 'sc.svg', name: 'Slayer Coins' }
	};
	const state = {
		charity_shuffle_offer: null,
		charity_shuffle_max_offers: [],
		charity_shuffle_count: 18,
		owned_pet_ids: []
	};
	let modal;
	let submitted;
	const actions = install_market_charity_actions({
		state, game, charitree_rules, transfer_currency_support, is_social_only: () => false,
		queue_modal: (...args) => { modal = args; return true; }, notify() {}, notify_error() {},
		close_modal_and_wait: async template_id => {
			if (template_id === modal?.[1]) modal[3].didClose();
		},
		setTimeout: callback => callback(),
		run_pending_economy_action: async (kind, endpoint, payload) => {
			submitted = { kind, endpoint, payload };
			return { success: true };
		},
		request_charity_tree_contents: async () => {}
	});
	Object.assign(state, actions);
	state.show_charity_shuffle();
	await state.show_charity_shuffle_max();
	assert.equal(modal[1], 'charity-shuffle-max-modal');
	assert.equal(state.charity_shuffle_max_offers.length, 2);
	assert.equal(state.charity_shuffle_max_totals().reduce((sum, offer) => sum + offer.qty, 0),
		state.charity_shuffle_max_offers.reduce((sum, offer) => sum + offer.qty, 0));
	await state.confirm_charity_shuffle({}, true);
	assert.equal(submitted.kind, 'charity_shuffle');
	assert.equal(submitted.endpoint, '/api/charity/shuffle');
	assert.equal(submitted.payload.offers.length, 2);
	assert.equal(state.charity_shuffle_max_offers.length, 0);
});

test('clears the single-shuffle offer when Max is cancelled so Shuffle Leaves can be retried', async () => {
	const game = {
		gp: { id: 'melvorD:GP', amount: 2000 },
		slayerCoins: { id: 'melvorD:SlayerCoins', amount: 2000 }
	};
	const state = {
		charity_shuffle_offer: null,
		charity_shuffle_max_offers: [],
		charity_shuffle_count: 18,
		owned_pet_ids: []
	};
	const modals = [];
	const actions = install_market_charity_actions({
		state, game, charitree_rules, transfer_currency_support, is_social_only: () => false,
		queue_modal: (...args) => { modals.push(args); return true; }, notify() {}, notify_error() {},
		close_modal_and_wait: async template_id => assert.equal(template_id, 'charity-shuffle-modal')
	});
	Object.assign(state, actions);
	state.show_charity_shuffle();
	await state.show_charity_shuffle_max();
	assert.equal(state.charity_shuffle_offer, null);
	modals.at(-1)[3].didClose();
	state.show_charity_shuffle();
	assert.equal(modals.at(-1)[1], 'charity-shuffle-modal');
});

test('clears an offer when modal queueing throws before rethrowing the failure', () => {
	const game = { slayerCoins: { id: 'melvorD:SlayerCoins', amount: 10000 } };
	const state = { charity_shuffle_offer: null };
	const actions = install_market_charity_actions({
		state, game, charitree_rules, transfer_currency_support, is_social_only: () => false,
		queue_modal: () => { throw new Error('queue unavailable'); }, notify() {}, notify_error() {}
	});
	Object.assign(state, actions);

	assert.throws(() => state.show_charity_shuffle(), /queue unavailable/);
	assert.equal(state.charity_shuffle_offer, null);
});

test('quotes paid Slag clearing before sending the receipt-backed action', async () => {
 const [page, actions, english] = await Promise.all([
  readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
  readFile(new URL('../../mod/client-crucible.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8').then(JSON.parse)
 ]);
 assert.match(page, /state\.crucible_clear\(false\)/);
 assert.match(page, /state\.crucible_clear\(true\)/);
 assert.match(actions, /quote_clearings\(count\)/);
 assert.match(actions, /queue_modal\('MOD_MP_CRUCIBLE_CLEAR', 'crucible-clear-modal'/);
 assert.match(page, /state\.crucible_clear_totals/);
 assert.match(actions, /run_pending_economy_action\('crucible_clear', '\/api\/crucible\/clear'/);
 assert.equal(english.MOD_MP_CRUCIBLE_CLEAR_QUOTE, 'Increase your Slag clearing bonus by 1 level.');
 assert.equal(english.MOD_MP_CRUCIBLE_CLEAR_MAX_QUOTE, 'This will max out your Slag clearing bonus.');
 assert.match(page, /state\.crucible_clear_max \? 'MOD_MP_CRUCIBLE_CLEAR_MAX_QUOTE' : 'MOD_MP_CRUCIBLE_CLEAR_QUOTE'/);
});

test('Crucible Max quotes aggregate display by currency while keeping sequential balances for submission', async () => {
	const gp = { id: 'gp', amount: 10000, media: 'gp.png', name: 'Gold' };
	const sc = { id: 'sc', amount: 10000, media: 'sc.png', name: 'Slayer Coins' };
	const entries = [{ id: 'gp', shorthand: 'GP', currency: gp }, { id: 'sc', shorthand: 'SC', currency: sc }];
	const state = { crucible: { is_open: true, active_wish: null, level: 17 }, crucible_busy: false };
	let submitted;
	let modal;
	const actions = install_crucible_actions({
		state, game: {}, transfer_currency_support: {
			get_transfer_currencies: () => entries,
			get_transfer_currency_cap: () => 1000,
			is_transfer_currency: () => true
		},
		queue_modal: (...args) => { modal = args; },
		run_pending_economy_action: async (...args) => { submitted = args; return { success: true }; },
		close_modal_and_wait: async () => {}, notify() {}, notify_error() {},
		filter_local_available_items: values => values
	}, {});
	Object.assign(state, actions);
	const original_random = Math.random;
	const sequence = [0, .9, 0];
	try { Math.random = () => sequence.shift(); await state.crucible_clear(true); }
	finally { Math.random = original_random; }
	assert.equal(modal[1], 'crucible-clear-modal');
	assert.equal(state.crucible_clear_max, true);
	assert.deepEqual(state.crucible_clear_totals.map(row => [row.currency_id, row.qty]), [['gp', 19], ['sc', 10]]);
	assert.deepEqual(state.crucible_clear_offers.map(row => [row.currency_id, row.balance, row.qty]),
		[['gp', 10000, 10], ['sc', 10000, 10], ['gp', 9990, 9]]);
	await state.crucible_confirm_clear();
	assert.equal(submitted[1], '/api/crucible/clear');
	assert.deepEqual(submitted[2].offers.map(row => row.qty), [10, 10, 9]);
	const next_random = Math.random;
	try { Math.random = () => 0; await state.crucible_clear(false); }
	finally { Math.random = next_random; }
	assert.equal(state.crucible_clear_max, false);
});
