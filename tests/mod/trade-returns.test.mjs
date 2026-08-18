import assert from 'node:assert/strict';
import test from 'node:test';

import {
	complete_trade_cancellation,
	deliver_resolved_trade
} from '../../mod/trade-returns.mjs';

test('conserves escrowed inventory across offer, cancel, poll, and resolved return', () => {
	const offered_qty = 10;
	let bank_qty = 25 - offered_qty;
	const state = {
		trades: [{
			trade_id: 41,
			state: 0,
			data: { items: [{ item_id: 'melvorD:Iron_Ore', qty: offered_qty, counter: 0 }] }
		}],
		resolved_trades: []
	};

	complete_trade_cancellation(state, 41);
	assert.equal(bank_qty, 15, 'cancellation waits for the durable server return');
	assert.deepEqual(state.trades, []);

	state.resolved_trades.push({
		trade_id: 41,
		data: { items: [{ item_id: 'melvorD:Iron_Ore', qty: offered_qty, counter: 0 }] }
	});
	deliver_resolved_trade(
		state,
		41,
		state.resolved_trades[0].data.items,
		(_item_id, qty) => bank_qty += qty
	);

	assert.equal(bank_qty, 25, 'the durable return restores exactly the escrowed quantity');
	assert.deepEqual(state.resolved_trades, []);
});
