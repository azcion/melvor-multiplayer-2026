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

test('a blocked receipt still hydrates incoming Gifts without advancing the recovery revision', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function get_client_events_request('), main.indexOf('\nfunction start_client_event_polling('));
	let contents = 0;
	const state = { events: {}, gifts: [], trades: [], resolved_trades: [], inbox_items: [] };
	const context = {
		state, client_events_hydrated: true, economy_command_journal: null, session_generation: 1, client_event_revision: 4, CHAT_CAPABILITIES: '', chat_page_visible: false,
		social_mode: { SOCIAL_MODE_FULL: 'full', SOCIAL_MODE_SOCIAL: 'social' },
		polling: { has_pending_events: () => true }, event_snapshots: { reconcile_event_transfers },
		api_get: async () => ({ revision: 5, gifts: [42], economy_receipts: [{ id: 'blocked' }] }),
		enter_unsupported_multiplayer: () => false,
		check_released_mod_version() {},
		reconcile_economy_receipts: async () => false,
		reconcile_campaign_event() {}, invalidate_guild_state() {}, update_chat_nav() {},
		reconcile_guild_member_social_modes() {}, update_transfer_inventory_nav() {}, update_multiplayer_nav() {},
		set_instance_storage_item() {}, leave_social_only_disabled_page() {},
		reconcile_pending_gifts: async () => { contents++; }
	};
	await runInNewContext(source + '\nget_client_events_request(true, 1)', context);
	assert.equal(state.gifts[0].id, 42);
	assert.equal(contents, 1);
	assert.equal(context.client_event_revision, 4);
});
