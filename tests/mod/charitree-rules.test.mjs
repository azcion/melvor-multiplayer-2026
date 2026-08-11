import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	format_charitree_remaining,
	get_charitree_next_opportunity,
	get_charitree_stack_gp_value,
	get_charitree_take_block,
	get_charitree_take_quantity
} from '../../mod/charitree-rules.mjs';

const root = new URL('../../', import.meta.url);

const gp_currency = {};
const gp_item = { sellsFor: { currency: gp_currency, quantity: 100 } };
const other_currency_item = { sellsFor: { currency: {}, quantity: 1_000_000 } };
const options = {
	current_gp: 1_000,
	gp_currency,
	get_item: id => id === 'test:gp' ? gp_item : id === 'test:other' ? other_currency_item : undefined,
	get_sale_price: (item, qty) => item.sellsFor.quantity * qty,
	is_discovered: id => id === 'test:known' || id === 'test:gp'
};

test('values GP and GP-sale stacks while ignoring other currencies', () => {
	assert.equal(get_charitree_stack_gp_value({ id: 'melvorD:GP', qty: 600 }, options), 600);
	assert.equal(get_charitree_stack_gp_value({ id: 'test:gp', qty: 6 }, options), 600);
	assert.equal(get_charitree_stack_gp_value({ id: 'test:other', qty: 6 }, options), 0);
});

test('blocks stacks above half of current GP, including positive stacks at zero GP', () => {
	assert.equal(get_charitree_take_block({ id: 'test:gp', qty: 5 }, options), null);
	assert.equal(get_charitree_take_block({ id: 'test:gp', qty: 6 }, options), 'value_limit');
	assert.equal(get_charitree_take_block(
		{ id: 'melvorD:GP', qty: 1 }, { ...options, current_gp: 0 }
	), 'value_limit');
});

test('limits an undiscovered item to one without blocking its stack', () => {
	assert.equal(get_charitree_take_block({ id: 'test:new', qty: 1 }, options), null);
	assert.equal(get_charitree_take_block({ id: 'test:new', qty: 2 }, options), null);
	assert.equal(get_charitree_take_block({ id: 'test:known', qty: 2 }, options), null);
	assert.equal(get_charitree_take_quantity({ id: 'test:new', qty: 2 }, options), 1);
	assert.equal(get_charitree_take_quantity({ id: 'test:known', qty: 2 }, options), 2);
});

test('formats the expiry countdown at useful day, hour, and minute precision', () => {
	const now = 1_000_000;
	assert.equal(format_charitree_remaining(now + 3 * 86_400_000 + 2 * 3_600_000, now), '3d 2h');
	assert.equal(format_charitree_remaining(now + 2 * 3_600_000 + 5 * 60_000, now), '2h 5m');
	assert.equal(format_charitree_remaining(now + 20_000, now), '1m');
	assert.equal(format_charitree_remaining(now - 1, now), '0m');
});

test('finds the next Charitree opportunity from the chances available to the player', () => {
	const day = 86_400_000;
	assert.equal(get_charitree_next_opportunity(10_000, 2_000, false, day), 10_000 + day);
	assert.equal(get_charitree_next_opportunity(10_000, 2_000, true, day), 2_000 + day);
});

test('wires completion-log discovery, first-find receipt, and per-stack expiry into the Charitree page', async () => {
	const [main, templates, style, language_source] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8')
	]);
	const language = JSON.parse(language_source);

	assert.match(main, /game\.stats\.itemFindCount\(item\) > 0/);
	assert.match(main, /add_bank_item\(item\.id, res\.item_qty, !was_discovered\)/);
	assert.match(main, /qty: this\.get_charity_take_quantity\(item\)/);
	assert.match(main, /item_remaining_qty/);
	assert.match(main, /game\.bank\.addItemByID\(item_id, amount, false, found, true\)/);
	assert.match(main, /setInterval\(update_charity_clock, 1000\)/);
	assert.match(main, /get charity_next_opportunity_at\(\)/);
	assert.match(templates, /state\.format_charity_expiry\(item\.expires_at\)/);
	assert.match(templates, /role="timer"/);
	assert.match(templates, /state\.charity_next_opportunity_formatted/);
	assert.match(templates, /class="mp-charitree-window-copy">[\s\S]*MOD_MP_CHARITY_WINDOW_INFO[\s\S]*MOD_MP_CHARITY_OPPORTUNITY_READY[\s\S]*MOD_MP_CHARITY_NEXT_OPPORTUNITY/);
	assert.match(templates, /state\.selected_charity_take_block/);
	assert.match(templates, /mp-charitree-new-item/);
	assert.match(templates, /mp-charitree-lock/);
	assert.match(templates, /state\.selected_charity_take_warning/);
	assert.match(style, /mp-item-icon\.mp-charitree-new-item \{/);
	assert.match(style, /outline: 2px solid rgb\(45 210 75\);/);
	assert.match(style, /box-shadow: 0 0 8px 2px rgb\(45 210 75 \/ 75%\);/);
	assert.match(style, /\.mp-charitree-window-copy \{[\s\S]*flex-direction: column;/);
	assert.doesNotMatch(style, /mp-item-icon\.mp-charitree-new-item > a/);
	assert.doesNotMatch(style, /mp-charitree-new-item-glow/);
	assert.equal(language.MOD_MP_CHARITY_OPPORTUNITY_READY, 'You may seek an offering now.');
	assert.equal(language.MOD_MP_CHARITY_NEXT_OPPORTUNITY, 'You may seek another offering in %s.');
});
