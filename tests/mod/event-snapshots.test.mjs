import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcile_event_transfers } from '../../mod/event-snapshots.mjs';

test('removes gifts and trades absent from an authoritative event snapshot', () => {
	const state = {
		gifts: [{ id: 1, data: { sender: 'kept' } }, { id: 2, data: { sender: 'removed' } }],
		trades: [
			{ trade_id: 3, state: 0, attending: true, data: { items: ['kept'] } },
			{ trade_id: 4, state: 0, attending: false, data: { items: ['removed'] } }
		],
		resolved_trades: [
			{ trade_id: 5, data: { items: ['kept'] } },
			{ trade_id: 6, data: { items: ['removed'] } }
		]
	};

	reconcile_event_transfers(state, {
		gifts: [1],
		trades: [{ trade_id: 3, state: 0, attending: true }],
		resolved_trades: [5]
	});

	assert.deepEqual(state.gifts, [{ id: 1, data: { sender: 'kept' } }]);
	assert.deepEqual(state.trades, [
		{ trade_id: 3, state: 0, attending: true, data: { items: ['kept'] } }
	]);
	assert.deepEqual(state.resolved_trades, [{ trade_id: 5, data: { items: ['kept'] } }]);
});

test('creates missing transfers and invalidates loaded content when trade metadata changes', () => {
	const state = {
		gifts: [{ id: 1, data: { sender: 'known' } }],
		trades: [{ trade_id: 2, state: 0, attending: true, data: { items: ['stale'] } }],
		resolved_trades: [{ trade_id: 3, data: { items: ['known'] } }]
	};

	reconcile_event_transfers(state, {
		gifts: [1, 4],
		trades: [
			{ trade_id: 2, state: 1, attending: false },
			{ trade_id: 5, state: 0, attending: true }
		],
		resolved_trades: [3, 6]
	});

	assert.deepEqual(state.gifts, [
		{ id: 1, data: { sender: 'known' } },
		{ id: 4, data: null }
	]);
	assert.deepEqual(state.trades, [
		{ trade_id: 2, state: 1, attending: false, data: null },
		{ trade_id: 5, state: 0, attending: true, data: null }
	]);
	assert.deepEqual(state.resolved_trades, [
		{ trade_id: 3, data: { items: ['known'] } },
		{ trade_id: 6, data: null }
	]);
});
