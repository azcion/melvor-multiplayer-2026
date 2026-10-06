import assert from 'node:assert/strict';
import test from 'node:test';
import { install_trading_actions } from '../../mod/client-actions-trading.mjs';
import { install_market_charity_actions } from '../../mod/client-actions-market-charity.mjs';

test('every synthetic Pending action exits before Bank, Outbox, journal, confirmation or real API code', async () => {
	const calls = [];
	const state = {
		is_pending_preview: (kind, id) => id === (kind === 'haggle' ? 'preview:active:sell:true:true' : -1),
		pending_preview_action: async (...args) => calls.push(args),
	};
	// Missing real runtime dependencies deliberately fail if an action crosses the no-op boundary.
	Object.assign(state, install_trading_actions({ state }));
	Object.assign(state, install_market_charity_actions({ state }));
	for (const [method, action] of [['counter_trade', 'counter'], ['resolve_trade', 'resolve'],
		['decline_trade', 'decline'], ['accept_trade', 'accept'], ['cancel_trade', 'cancel']]) {
		await state[method](null, -1);
		assert.deepEqual(calls.pop(), ['trade', -1, action]);
	}
	for (const accept of [true, false]) {
		await state.resolve_gift(null, -1, accept);
		assert.deepEqual(calls.pop(), ['gift', -1, accept ? 'accept' : 'decline']);
	}
	await state.show_discard_returned_gift_confirmation(-1);
	assert.deepEqual(calls.pop(), ['gift', -1, 'discard']);
	for (const action of ['counter', 'accept', 'terminate', 'claim']) {
		const id = 'preview:active:sell:true:true';
		await state.respond_market_haggle(null, { id }, action);
		assert.deepEqual(calls.pop(), ['haggle', id, action]);
	}
});

test('real IDs retain the ordinary action path', async () => {
	const state = { trades: [], is_pending_preview: () => false };
	let checked = false;
	Object.assign(state, install_trading_actions({ state, is_social_only: () => { checked = true; return false; } }));
	await state.counter_trade(null, 1);
	assert.equal(checked, true);
});
