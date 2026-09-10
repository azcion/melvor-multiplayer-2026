import assert from 'node:assert/strict';
import test from 'node:test';

import {
	get_available_transfer_currencies,
	get_transfer_currency_cap,
	get_transfer_currency,
	get_transfer_currency_for_currency,
	get_transfer_currencies,
	get_transfer_currency_overages,
	cap_transfer_items,
	is_transfer_currency
} from '../../mod/transfer-currencies.mjs';

function game_with_currencies(amounts = {}) {
	return {
		gp: { id: 'melvorD:GP', amount: amounts.gp ?? 0 },
		slayerCoins: { id: 'melvorD:SlayerCoins', amount: amounts.sc ?? 0 },
		abyssalPieces: { id: 'melvorItA:AbyssalPieces', amount: amounts.ap ?? 0 },
		abyssalSlayerCoins: { id: 'melvorItA:AbyssalSlayerCoins', amount: amounts.asc ?? 0 }
	};
}

test('lists the four supported currencies in game order', () => {
	const currencies = get_transfer_currencies(game_with_currencies({ gp: 10, sc: 20, ap: 30, asc: 40 }));

	assert.deepEqual(currencies.map(currency => [currency.id, currency.shorthand]), [
		['melvorD:GP', 'GP'],
		['melvorD:SlayerCoins', 'SC'],
		['melvorItA:AbyssalPieces', 'AP'],
		['melvorItA:AbyssalSlayerCoins', 'ASC']
	]);
});

test('only offers currencies with a positive balance and ignores unavailable expansion objects', () => {
	const game = game_with_currencies({ gp: 1, sc: 0, ap: 2, asc: 0 });
	delete game.abyssalSlayerCoins;

	assert.deepEqual(get_available_transfer_currencies(game).map(currency => currency.id), [
		'melvorD:GP',
		'melvorItA:AbyssalPieces'
	]);
	assert.equal(get_transfer_currency(game, 'melvorD:SlayerCoins').currency.amount, 0);
	assert.equal(is_transfer_currency(game, 'melvorItA:AbyssalSlayerCoins'), false);
});

test('resolves supported currencies by the game currency objects used for sale values', () => {
	const game = game_with_currencies({ gp: 10, sc: 20, ap: 30, asc: 40 });

	assert.equal(get_transfer_currency_for_currency(game, game.slayerCoins).id, 'melvorD:SlayerCoins');
	assert.equal(get_transfer_currency_for_currency(game, game.abyssalPieces).id, 'melvorItA:AbyssalPieces');
	assert.equal(get_transfer_currency_for_currency(game, {}), null);
});

test('caps each supported currency independently and leaves ordinary items unchanged', () => {
	const game = game_with_currencies();
	const items = cap_transfer_items(game, [
		{ id: 'melvorD:GP', qty: 1_000_000_005 },
		{ id: 'melvorD:SlayerCoins', qty: 1_000_005 },
		{ id: 'melvorD:Coal_Ore', qty: 2 }
	]);

	assert.equal(get_transfer_currency_cap(game, 'melvorD:GP'), 1_000_000_000);
	assert.equal(get_transfer_currency_cap(game, 'melvorD:SlayerCoins'), 1_000_000);
	assert.deepEqual(items, [
		{ id: 'melvorD:GP', qty: 1_000_000_000 },
		{ id: 'melvorD:SlayerCoins', qty: 1_000_000 },
		{ id: 'melvorD:Coal_Ore', qty: 2 }
	]);
	assert.deepEqual(get_transfer_currency_overages(game, [
		{ id: 'melvorD:GP', qty: 1_000_000_005 },
		{ id: 'melvorD:SlayerCoins', qty: 1_000_005 }
	]).map(({ id, cap }) => [id, cap]), [
		['melvorD:GP', 1_000_000_000],
		['melvorD:SlayerCoins', 1_000_000]
	]);
});
