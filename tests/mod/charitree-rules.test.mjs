import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import {
	CHARITREE_LEAF_COVERAGE_PERCENTAGES,
	CHARITREE_WEIRD_GLOOP_ID,
	format_charitree_remaining,
	get_charitree_leaf_coverage,
	get_charitree_leaf_coverage_percentage,
	get_charitree_leaf_roll,
	get_charitree_max_shuffle_offers,
	get_charitree_shuffle_offer,
	get_charitree_next_opportunity,
	get_charitree_stack_value,
	get_charitree_take_block,
	get_charitree_take_quantity,
	get_charitree_whole_hours_remaining
} from '../../mod/charitree-rules.mjs';

const root = new URL('../../', import.meta.url);

const gp_currency = {};
const sc_currency = {};
const ap_currency = {};
const asc_currency = {};
const gp_item = { sellsFor: { currency: gp_currency, quantity: 100 } };
const cabbage_item = { sellsFor: { currency: gp_currency, quantity: 5 } };
const other_currency_item = { sellsFor: { currency: {}, quantity: 1_000_000 } };
const sc_item = { sellsFor: { currency: sc_currency, quantity: 100 } };
const expensive_item = { sellsFor: { currency: gp_currency, quantity: 600 } };
const partial_item = { sellsFor: { currency: gp_currency, quantity: 1_000 } };
const indivisible_item = { sellsFor: { currency: gp_currency, quantity: 3_000 } };

class PrototypeCurrency {
	constructor(amount) {
		this.value = amount;
	}

	get amount() {
		return this.value;
	}
}

function make_options({ gp = 1_000, sc = 1_000, ap = 1_000, asc = 1_000, discovered = () => false } = {}) {
	const currencies = [gp_currency, sc_currency, ap_currency, asc_currency];
	return {
		get_currency: id => id === 'melvorD:GP' ? gp_currency : id === 'melvorD:SlayerCoins' ? sc_currency :
			id === 'melvorItA:AbyssalPieces' ? ap_currency : id === 'melvorItA:AbyssalSlayerCoins' ? asc_currency : null,
		get_supported_currency: currency => currencies.includes(currency) ? currency : null,
		get_currency_amount: currency => currency === gp_currency ? gp : currency === sc_currency ? sc :
			currency === ap_currency ? ap : currency === asc_currency ? asc : undefined,
		get_item: id => id === 'test:gp' ? gp_item : id === 'test:cabbage' ? cabbage_item : id === 'test:other' ? other_currency_item :
			id === 'test:sc' ? sc_item : id === 'test:expensive' ? expensive_item : id === 'test:partial' ? partial_item :
			id === 'test:indivisible' ? indivisible_item : undefined,
		get_sale_price: (item, qty) => item.sellsFor.quantity * qty,
		is_discovered: discovered
	};
}

const options = make_options({ discovered: id => id === 'test:known' || id === 'test:gp' });

test('values supported currencies and sale stacks in their own currency', () => {
	assert.equal(get_charitree_stack_value({ id: 'melvorD:GP', qty: 600 }, options), 600);
	assert.equal(get_charitree_stack_value({ id: 'test:gp', qty: 6 }, options), 600);
	assert.equal(get_charitree_stack_value({ id: 'melvorD:SlayerCoins', qty: 600 }, options), 600);
	assert.equal(get_charitree_stack_value({ id: 'test:sc', qty: 6 }, options), 600);
	assert.equal(get_charitree_stack_value({ id: 'test:other', qty: 6 }, options), 0);
});

test('keeps indivisible stacks above half the current balance blocked, including positive stacks at zero GP', () => {
	assert.equal(get_charitree_take_block({ id: 'test:gp', qty: 5 }, options), null);
	assert.equal(get_charitree_take_block({ id: 'test:expensive', qty: 1 }, options), 'value_limit');
	assert.equal(get_charitree_take_block(
		{ id: 'melvorD:GP', qty: 1 }, make_options({ gp: 0 })
	), 'value_limit');
});

test('takes a half-value portion of oversized stacks when whole units fit', () => {
	const rich_options = make_options({ gp: 10_000, sc: 10_000, ap: 10_000, asc: 10_000, discovered: () => true });
	assert.equal(get_charitree_take_quantity({ id: 'melvorD:GP', qty: 33_000 }, rich_options), 5_000);
	assert.equal(get_charitree_take_block({ id: 'melvorD:GP', qty: 33_000 }, rich_options), null);
	assert.equal(get_charitree_take_quantity({ id: 'melvorD:GP', qty: 5_000 }, rich_options), 5_000);
	assert.equal(get_charitree_take_quantity({ id: 'melvorD:GP', qty: 5_100 }, rich_options), 5_000);
	assert.equal(get_charitree_take_quantity({ id: 'melvorD:SlayerCoins', qty: 33_000 }, rich_options), 5_000);
	assert.equal(get_charitree_take_block({ id: 'melvorD:SlayerCoins', qty: 33_000 }, rich_options), null);
	assert.equal(get_charitree_take_quantity({ id: 'melvorItA:AbyssalPieces', qty: 33_000 }, rich_options), 5_000);
	assert.equal(get_charitree_take_quantity({ id: 'melvorItA:AbyssalSlayerCoins', qty: 33_000 }, rich_options), 5_000);
	const currency_specific_options = make_options({ gp: 1_000, sc: 10_000, discovered: () => true });
	assert.equal(get_charitree_take_quantity({ id: 'melvorD:SlayerCoins', qty: 33_000 }, currency_specific_options), 5_000);
	assert.equal(get_charitree_take_block(
		{ id: 'melvorD:SlayerCoins', qty: 1 }, make_options({ gp: 10_000, sc: 0 })
	), 'value_limit');
	assert.equal(get_charitree_take_quantity({ id: 'test:partial', qty: 6 }, rich_options), 5);
	assert.equal(get_charitree_take_block(
		{ id: 'test:partial', qty: 6 }, make_options({ gp: 3_000, discovered: () => true })
	), null);
});

test('keeps oversized item stacks blocked when one unit exceeds half the current balance', () => {
	const rich_options = make_options({ gp: 5_000, discovered: () => true });
	assert.equal(get_charitree_take_quantity({ id: 'test:indivisible', qty: 2 }, rich_options), 1);
	assert.equal(get_charitree_take_block({ id: 'test:indivisible', qty: 2 }, rich_options), 'value_limit');
});

test('limits an undiscovered item to one without blocking its stack', () => {
	assert.equal(get_charitree_take_block({ id: 'test:new', qty: 1 }, options), null);
	assert.equal(get_charitree_take_block({ id: 'test:new', qty: 2 }, options), null);
	assert.equal(get_charitree_take_block({ id: 'test:known', qty: 2 }, options), null);
	assert.equal(get_charitree_take_quantity({ id: 'test:new', qty: 2 }, options), 1);
	assert.equal(get_charitree_take_quantity({ id: 'test:known', qty: 2 }, options), 2);
});

test('lets a new item use the half-balance limit for its single claim', () => {
	const new_item_options = make_options({ gp: 10, discovered: () => false });
	assert.equal(get_charitree_take_quantity({ id: 'test:cabbage', qty: 3_185 }, new_item_options), 1);
	assert.equal(get_charitree_take_block({ id: 'test:cabbage', qty: 3_185 }, new_item_options), null);
});

test('formats the expiry countdown at useful day, hour, and minute precision', () => {
	const now = 1_000_000;
	assert.equal(format_charitree_remaining(now + 3 * 86_400_000 + 2 * 3_600_000, now), '3d 2h');
	assert.equal(format_charitree_remaining(now + 2 * 3_600_000 + 5 * 60_000, now), '2h 5m');
	assert.equal(format_charitree_remaining(now + 20_000, now), '1m');
	assert.equal(format_charitree_remaining(now - 1, now), '0m');
});

test('assigns the accepted leaf coverage percentage at every whole-hour boundary', () => {
	assert.deepEqual(CHARITREE_LEAF_COVERAGE_PERCENTAGES, [0, 5, 15, 30, 50, 70, 85, 95, 100]);
	const boundaries = [
		[0, 0], [11, 0], [12, 5], [23, 5], [24, 15], [35, 15], [36, 30], [47, 30],
		[48, 50], [59, 50], [60, 70], [71, 70], [72, 85], [83, 85], [84, 95], [90, 95],
		[91, 100], [96, 100]
	];
	for (const [hours, percentage] of boundaries)
		assert.equal(get_charitree_leaf_coverage_percentage(hours), percentage, `${hours} hours`);
	assert.equal(get_charitree_leaf_coverage_percentage(-1), 0);
	assert.equal(get_charitree_leaf_coverage_percentage(12.5), 0);
});

test('floors remaining lifetime and hashes stable stack inputs deterministically', () => {
	const hour = 3_600_000;
	assert.equal(get_charitree_whole_hours_remaining(100 * hour, 4 * hour + 1), 95);
	assert.equal(get_charitree_whole_hours_remaining(100 * hour, 100 * hour + 1), 0);
	assert.equal(get_charitree_whole_hours_remaining('invalid', 0), null);
	assert.equal(get_charitree_leaf_roll('melvorD:Coal_Ore', 25, 95), 1);
	assert.equal(get_charitree_leaf_roll('melvorD:Coal_Ore', 26, 95), 74);
	assert.equal(get_charitree_leaf_roll('mod:火', 1, 91), 25);
	assert.equal(get_charitree_leaf_roll('', 1, 91), null);
	assert.equal(get_charitree_leaf_roll('melvorD:Coal_Ore', 0, 91), null);
});

test('covers by the stable roll while revealing currencies and invalid inputs', () => {
	const hour = 3_600_000;
	const now = 10 * hour;
	const item = { id: 'melvorD:Coal_Ore', qty: 25, expires_at: now + 95 * hour };
	assert.deepEqual(get_charitree_leaf_coverage(item, now), { covered: true, percentage: 100 });
	assert.deepEqual(get_charitree_leaf_coverage({ ...item, expires_at: now + 5 * hour }, now),
		{ covered: false, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage(item, now, () => true),
		{ covered: false, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage({ ...item, expires_at: 'invalid' }, now),
		{ covered: false, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage({ ...item, qty: 0 }, now),
		{ covered: false, percentage: 100 });
	assert.deepEqual(get_charitree_leaf_coverage({ id: CHARITREE_WEIRD_GLOOP_ID, qty: 5, expires_at: 0 }, now),
		{ covered: false, percentage: 0 });
});

test('always covers undiscovered items until a shuffle bonus lowers their coverage', () => {
	const hour = 3_600_000;
	const now = 10 * hour;
	const expiring_item = { id: 'melvorD:Coal_Ore', qty: 25, expires_at: now + 5 * hour };
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => false, () => false),
		{ covered: true, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => false, () => false, null, 1),
		{ covered: true, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => false, () => true),
		{ covered: false, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => true, () => false),
		{ covered: false, percentage: 0 });
	const distant_item = { ...expiring_item, expires_at: now + 95 * hour };
	assert.deepEqual(get_charitree_leaf_coverage(distant_item, now, () => false, () => false, null, 1),
		{ covered: true, percentage: 100 });
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => false, () => true, null, -10),
		{ covered: true, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage(distant_item, now, () => false, () => true, null, -10),
		{ covered: true, percentage: 100 });
	assert.deepEqual(get_charitree_leaf_coverage(distant_item, now, () => false, () => true, null, 20),
		{ covered: false, percentage: 100 });
	assert.deepEqual(get_charitree_leaf_coverage(
		{ ...expiring_item, expires_at: now + 90 * hour }, now, () => false, () => true, null, 1
	), { covered: true, percentage: 95 });
});

test('finds the next Charitree opportunity from the chances available to the player', () => {
	const day = 86_400_000;
	assert.equal(get_charitree_next_opportunity(10_000, 2_000, false, day), 10_000 + day);
	assert.equal(get_charitree_next_opportunity(10_000, 2_000, true, day), 2_000 + day);
});

test('wires first-find receipt and progress-based Slag into the Crucible page', async () => {
 const [main, actions, templates] = await Promise.all([
  read_client_source(root),
  readFile(new URL('mod/client-crucible.mjs', root), 'utf8'),
  readFile(new URL('mod/ui/templates.html', root), 'utf8')
 ]);
 const page = templates.slice(templates.indexOf('<template id="template-mp-crucible-page">'), templates.indexOf('<template id="template-mp-transfer-page">'));
 assert.match(main, /game\.stats\.itemFindCount\(item\) > 0/);
 assert.match(main, /receipt\.kind === 'crucible-reclaim'/);
 assert.match(main, /game\.bank\.addItemByID\(item_id, amount, false, found, true\)/);
 assert.match(actions, /get_crucible_slag_coverage/);
 assert.match(actions, /get_crucible_reclaim_quantity/);
 assert.match(page, /mp-crucible-heat-track[\s\S]*mp-crucible-grid/);
 assert.match(page, /state\.crucible_select_offering\(item\)/);
 assert.match(page, /state\.crucible_select_wish\(wish\)/);
 assert.match(page, /mp-item-icon v-if="!state\.crucible_slag\(item\)\.covered" :data-item-id="item\.id"/);
 assert.match(page, /mp-item-icon :data-item-id="wish\.item_id"/);
 assert.match(page, /state\.crucible_reclaim\(item\)/);
 assert.match(page, /state\.crucible_slag\(item\)\.covered/);
});

test('clears Charitree state when the server omits the state payload', async () => {
	const main = await read_client_source(root);
	const start = main.indexOf('function apply_charity_state(charity)');
	const end = main.indexOf('\nfunction remove_instance_storage_item', start);
	const state = {
		charity_server_supported: true,
		charity_enabled: true,
		charity_eligible: true,
		charity_next_opportunity_timestamp: 123,
		charity_update_time: 0
	};
	const apply_charity_state = new Function('state', `${main.slice(start, end)}; return apply_charity_state;`)(state);

	apply_charity_state(undefined);
	assert.equal(state.charity_server_supported, false);
	assert.equal(state.charity_enabled, false);
	assert.equal(state.charity_eligible, false);
	assert.equal(state.charity_next_opportunity_timestamp, 0);

	apply_charity_state({ enabled: true, eligible: false, next_opportunity_at: '456' });
	assert.equal(state.charity_server_supported, false);

	apply_charity_state({ enabled: true, eligible: false, next_opportunity_at: 456 });
	assert.equal(state.charity_server_supported, true);
	assert.equal(state.charity_next_opportunity_timestamp, 456);
});


test('shuffle prices select only eligible currencies and round down to whole units', () => {
	const currencies = [1000, 1000.5, 1999, 10000].map((amount, index) => ({ id: `currency:${index}`, currency: { amount } }));
	assert.equal(get_charitree_shuffle_offer(currencies.slice(0, 1)), null);
	assert.deepEqual(get_charitree_shuffle_offer(currencies, () => 0), { currency_id: 'currency:1', balance: 1000.5, qty: 1 });
	assert.deepEqual(get_charitree_shuffle_offer(currencies, () => 0.5), { currency_id: 'currency:2', balance: 1999, qty: 1 });
	assert.deepEqual(get_charitree_shuffle_offer(currencies, () => 0.999), { currency_id: 'currency:3', balance: 10000, qty: 10 });
});

test('max shuffle simulates each remaining deduction and stops when no currency can fund another request', () => {
	const currencies = [
		{ id: 'currency:gp', currency: { amount: 2000 } },
		{ id: 'currency:sc', currency: { amount: 2000 } }
	];
	const rolls = [0, 0.99];
	assert.deepEqual(get_charitree_max_shuffle_offers(currencies, 18, () => 1000, () => rolls.shift()), [
		{ currency_id: 'currency:gp', balance: 2000, qty: 2 },
		{ currency_id: 'currency:sc', balance: 2000, qty: 2 }
	]);
	assert.deepEqual(currencies.map(entry => entry.currency.amount), [2000, 2000], 'simulation does not mutate live balances');
	assert.equal(get_charitree_max_shuffle_offers([{ id: 'currency:gp', currency: { amount: 1001 } }], 18).length, 1);
	assert.equal(get_charitree_max_shuffle_offers(currencies, 20).length, 0);
	const melvor_currencies = [
		{ id: 'melvorD:GP', currency: new PrototypeCurrency(7_024_376_442) },
		{ id: 'melvorD:SlayerCoins', currency: new PrototypeCurrency(5_000_000) }
	];
	assert.equal(get_charitree_max_shuffle_offers(melvor_currencies, 10, () => Number.MAX_SAFE_INTEGER, () => 0).length, 10);
});

test('shuffle hash affects only older donations, preserves currency and undiscovered rules', () => {
	const now = 100000;
	let changed = 0;
	for (let i = 0; i < 100; i++) {
		const item = { id: `test:Leaf${i}`, qty: 5, donated_at: now - 2, expires_at: now + 55 * 3600000 };
		const base = get_charitree_leaf_coverage(item, now);
		const shuffled = get_charitree_leaf_coverage(item, now, () => false, () => true, now - 1);
		if (base.covered !== shuffled.covered) changed++;
		assert.deepEqual(get_charitree_leaf_coverage({ ...item, donated_at: now }, now, () => false, () => true, now - 1), base);
		assert.deepEqual(get_charitree_leaf_coverage({ ...item, donated_at: now - 1 }, now, () => false, () => true, now - 1), base);
		assert.equal(get_charitree_leaf_coverage(item, now, () => false, () => false, now - 1).covered, true);
		assert.equal(get_charitree_leaf_coverage(item, now, () => true, () => true, now - 1).covered, false);
		assert.deepEqual(get_charitree_leaf_coverage(item, now, () => false, () => true, now - 1), shuffled);
	}
	assert.ok(changed > 20 && changed < 80);
});
