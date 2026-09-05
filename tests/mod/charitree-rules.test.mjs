import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import {
	CHARITREE_LEAF_COVERAGE_PERCENTAGES,
	format_charitree_remaining,
	get_charitree_leaf_coverage,
	get_charitree_leaf_coverage_percentage,
	get_charitree_leaf_roll,
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
});

test('always covers undiscovered items and returns them to normal odds after discovery', () => {
	const hour = 3_600_000;
	const now = 10 * hour;
	const expiring_item = { id: 'melvorD:Coal_Ore', qty: 25, expires_at: now + 5 * hour };
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => false, () => false),
		{ covered: true, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => false, () => true),
		{ covered: false, percentage: 0 });
	assert.deepEqual(get_charitree_leaf_coverage(expiring_item, now, () => true, () => false),
		{ covered: false, percentage: 0 });
});

test('finds the next Charitree opportunity from the chances available to the player', () => {
	const day = 86_400_000;
	assert.equal(get_charitree_next_opportunity(10_000, 2_000, false, day), 10_000 + day);
	assert.equal(get_charitree_next_opportunity(10_000, 2_000, true, day), 2_000 + day);
});

test('wires completion-log discovery, first-find receipt, and per-stack expiry into the Charitree page', async () => {
	const [main, templates, style, language_source] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_source);

	assert.match(main, /game\.stats\.itemFindCount\(item\) > 0/);
	assert.match(main, /item_id === 'melvorD:GP' \|\| is_transfer_currency\(item_id\)/);
	assert.match(main, /receipt\.kind === 'charity-take' && !state\.is_charity_item_discovered\(item_id\)/);
	assert.match(main, /qty: this\.get_charity_take_quantity\(item\)/);
	assert.match(main, /item_remaining_qty/);
	assert.match(main, /game\.bank\.addItemByID\(item_id, amount, false, found, true\)/);
	assert.match(main, /const CHARITY_CLOCK_INTERVAL = 30 \* 1000;/);
	assert.match(main, /setInterval\(update_charity_clock, CHARITY_CLOCK_INTERVAL\)/);
	assert.doesNotMatch(main, /setInterval\(update_charity_clock, 1000\)/);
	assert.match(main, /get charity_next_opportunity_at\(\)/);
	assert.match(main, /charity_next_opportunity_timestamp: 0/);
	assert.match(main, /get charity_next_opportunity_at\(\) \{\s*return state\.charity_next_opportunity_timestamp;/);
	assert.doesNotMatch(main, /return state\.charity_next_opportunity_at;/);
	assert.match(main, /charity_server_supported/);
	assert.match(main, /apply_charity_state\(response\.charity\)/);
	assert.match(main, /apply_charity_state\(res\.charity\)/);
	assert.doesNotMatch(main, /charity_timeout/);
	assert.doesNotMatch(main, /charity_bonus_timeout/);
	assert.match(main, /get transfer_inventory_donation_value\(\)/);
	assert.match(main, /zero_gp_count/);
	assert.match(main, /currency_count/);
	assert.match(main, /sellsFor\?\.currency !== game\.gp/);
	assert.match(main, /Summoning_Familiar_/);
	assert.match(main, /api_post\('\/api\/charity\/donate', \{ items, donation_value, command_id: crypto\.randomUUID\(\) \}\)/);
	assert.doesNotMatch(main, /charitree_rules\.get_charitree_pet_chance\(donation_value\)/);
	assert.doesNotMatch(main, /game\.petManager/);
	assert.match(templates, /state\.format_charity_expiry\(item\.expires_at\)/);
	assert.match(templates, /role="timer"/);
	assert.match(templates, /state\.charity_next_opportunity_formatted/);
	const charitree_page = templates.slice(
		templates.indexOf('<template id="template-mp-charity-page">'),
		templates.indexOf('<template id="template-mp-transfer-page">')
	);
	assert.match(charitree_page, /class="mp-charitree-window-copy">[\s\S]*<p class="mb-2">[\s\S]*<ul class="mb-2">/);
	assert.match(charitree_page, /MOD_MP_CHARITY_INFO_ONCE_PER_DAY[\s\S]*MOD_MP_CHARITY_INFO_INTRO/);
	assert.match(charitree_page, /MOD_MP_CHARITY_INFO_PICK_PREFIX[\s\S]*MOD_MP_CHARITY_INFO_CURRENT_BALANCE[\s\S]*MOD_MP_CHARITY_INFO_CURRENCY_SUFFIX/);
	assert.match(charitree_page, /MOD_MP_CHARITY_INFO_LARGE_STACK/);
	assert.match(charitree_page, /MOD_MP_CHARITY_INFO_NEW_PREFIX[\s\S]*MOD_MP_CHARITY_INFO_NEW[\s\S]*MOD_MP_CHARITY_INFO_NEW_SUFFIX/);
	assert.match(charitree_page, /MOD_MP_CHARITY_INFO_LEAVES/);
	assert.match(charitree_page, /MOD_MP_CHARITY_INFO_DECAY_PREFIX[\s\S]*MOD_MP_CHARITY_INFO_FOUR_DAYS[\s\S]*MOD_MP_CHARITY_INFO_DECAY_SUFFIX/);
	assert.doesNotMatch(charitree_page, /skill-icon-xxs/);
	assert.match(charitree_page, /MOD_MP_CHARITY_OPPORTUNITY_READY[\s\S]*MOD_MP_CHARITY_NEXT_OPPORTUNITY/);
	assert.match(templates, /state\.selected_charity_take_block/);
	assert.match(templates, /mp-charitree-new-item/);
	assert.match(templates, /mp-charitree-lock/);
	assert.match(templates, /state\.selected_charity_take_warning/);
	assert.match(templates, /MOD_MP_CHARITY_TAKE_AMOUNT/);
	assert.match(templates, /:lang-arg-1="state\.selected_charity_take_amount"/);
	assert.match(main, /get selected_charity_take_amount\(\) \{[\s\S]*getLangString\('MOD_MP_CHARITY_ENTIRE_STACK'\)[\s\S]*formatNumber\(this\.selected_charity_take_quantity\)/);
	assert.match(main, /get_charity_leaf_coverage\([\s\S]*item_id === 'melvorD:GP' \|\| is_transfer_currency\(item_id\),[\s\S]*this\.is_charity_item_discovered\(item_id\)/);
	assert.match(charitree_page, /<template v-for="item of state\.charity_tree_inventory">[\s\S]*<mp-item-icon v-if="!state\.get_charity_leaf_coverage\(item\)\.covered" class="bank-item pointer-enabled m-2 mp-charitree-item"[\s\S]*:data-item-id="item\.id"/);
	assert.match(charitree_page, /<img class="bank-img mp-charitree-img" :src="state\.get_item_icon\(item\.id\)" :class="\{ 'mp-charitree-border': state\.selected_charity_item_id === item\.id \}">/);
	assert.match(charitree_page, /MOD_MP_CHARITY_INFO_NEW_PREFIX[\s\S]*<lang-string lang-id="MOD_MP_CHARITY_INFO_NEW" style="border-radius: 5px;outline: 2px solid rgb\(45 210 75\);box-shadow: 0 0 8px 2px rgb\(45 210 75 \/ 75%\);padding: 0 \.25rem;"><\/lang-string>[\s\S]*MOD_MP_CHARITY_INFO_NEW_SUFFIX/);
	assert.match(charitree_page, /<div v-else class="bank-item pointer-enabled m-2 mp-charitree-item mp-charitree-leaf" :class="\[`mp-charitree-leaf-coverage-\$\{state\.get_charity_leaf_coverage\(item\)\.percentage\}`[\s\S]*<img class="bank-img mp-charitree-img" src="https:\/\/cdn2-main\.melvor\.net\/assets\/media\/bank\/Golden_Leaf\.png" :class="\{ 'mp-charitree-border': state\.selected_charity_item_id === item\.id \}">/);
	assert.doesNotMatch(charitree_page, /<img class="bank-img p-3"/);
	assert.doesNotMatch(charitree_page, /'border border-4x border-success'/);
	assert.doesNotMatch(charitree_page, /v-else[\s\S]*:data-item-id="item\.id"/);
	assert.match(style, /\.mp-charitree-new-item \{/);
	assert.match(style, /\.mp-charitree-item \.mp-charitree-border \{[\s\S]*padding: \.75rem;[\s\S]*border-width: \.25rem;/);
	assert.match(style, /\.mp-charitree-item \.mp-charitree-img \{[\s\S]*padding: 1rem;[\s\S]*border: 0 solid #46c37b;[\s\S]*border-radius: 6px;/);
	assert.ok(style.indexOf('.mp-charitree-item .mp-charitree-img {') < style.indexOf('.mp-charitree-item .mp-charitree-border {'));
	assert.match(style, /\.mp-charitree-item\.mp-charitree-leaf \.mp-charitree-border \{[\s\S]*padding: \.25rem;[\s\S]*border-width: \.25rem;/);
	assert.match(style, /\.mp-charitree-item\.mp-charitree-leaf \.mp-charitree-img \{[\s\S]*transform: scaleX\(-100%\) rotate\(90deg\);[\s\S]*padding: \.5rem;/);
	assert.ok(style.indexOf('.mp-charitree-item.mp-charitree-leaf .mp-charitree-img {') < style.indexOf('.mp-charitree-item.mp-charitree-leaf .mp-charitree-border {'));
	const leaf_filters = new Map([
		[0, -80], [5, -50], [15, -20], [30, -10], [50, 0], [70, 10], [85, 50], [95, 60], [100, 80]
	]);
	for (const [percentage, degrees] of leaf_filters) {
		assert.match(style, new RegExp(
			`\\.mp-charitree-item\\.mp-charitree-leaf\\.mp-charitree-leaf-coverage-${percentage} \\.mp-charitree-img \\{\\s*filter: hue-rotate\\(${degrees}deg\\);`
		));
	}
	const last_percentage_filter = style.indexOf('.mp-charitree-item.mp-charitree-leaf.mp-charitree-leaf-coverage-100');
	const new_item_filter = style.indexOf('.mp-charitree-item.mp-charitree-leaf.mp-charitree-new-item');
	assert.ok(last_percentage_filter >= 0 && new_item_filter > last_percentage_filter);
	assert.match(style, /\.mp-charitree-item\.mp-charitree-leaf\.mp-charitree-new-item \.mp-charitree-img \{\s*filter: hue-rotate\(-130deg\);/);
	assert.match(style, /\.mp-charitree-new-item \{[\s\S]*border-radius: 6\.5px;/);
	assert.doesNotMatch(style, /box-sizing: content-box/);
	assert.match(style, /outline: 2px solid rgb\(45 210 75\);/);
	assert.match(style, /box-shadow: 0 0 8px 2px rgb\(45 210 75 \/ 75%\);/);
	assert.match(style, /\.mp-charitree-window-copy \{[\s\S]*flex-direction: column;/);
	assert.doesNotMatch(style, /mp-item-icon\.mp-charitree-new-item > a/);
	assert.doesNotMatch(style, /mp-charitree-new-item-glow/);
	assert.equal(language.MOD_MP_CHARITY_OPPORTUNITY_READY, 'You may seek an offering now.');
	assert.equal(language.MOD_MP_CHARITY_NEXT_OPPORTUNITY, 'You may seek another offering in %s.');
	assert.equal(language.MOD_MP_CHARITY_SERVER_UNSUPPORTED, 'Charitree claiming requires a newer multiplayer server. Update the server and reload the game.');
	assert.equal(language.MOD_MP_CHARITY_TAKE_AMOUNT, 'Claiming: %s');
	assert.equal(language.MOD_MP_CHARITY_ENTIRE_STACK, 'entire stack');
	assert.equal(language.MOD_MP_CHARITY_INFO_ONCE_PER_DAY, 'Once every 20 hours');
	assert.equal(language.MOD_MP_CHARITY_INFO_CURRENT_BALANCE, 'half of your current balance');
	assert.equal(language.MOD_MP_CHARITY_INFO_LEAVES, 'Leaves may conceal any item while it is far from expiring.');
	assert.equal(language.MOD_MP_CHARITY_INFO_FOUR_DAYS, '4 days');
	assert.equal(language.MOD_MP_CHARITY_INFO_NEW, 'undiscovered');
	assert.equal(language.MOD_MP_CHARITY_UNDISCOVERED_STACK,
		'This offering is undiscovered. You may claim only one; the rest will remain upon the Charitree.');
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
