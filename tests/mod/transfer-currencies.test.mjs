import assert from 'node:assert/strict';
import test from 'node:test';

import {
	get_available_transfer_currencies,
	get_transfer_currency,
	get_transfer_currencies,
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
