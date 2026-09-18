import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { apply_economy_receipt } from '../../mod/economy-receipts.mjs';
import * as event_snapshots from '../../mod/event-snapshots.mjs';
import { create_pending_economy_actions } from '../../mod/pending-economy-actions.mjs';
import { create_economy_command_journal } from '../../mod/economy-command-journal.mjs';

// Run with the isolated API runner and TEST_SERVER_URL=http://127.0.0.1:3001.
test('real API and mod recovery expose Gifts during a blocked receipt and never repeat the donation', {
	skip: !process.env.TEST_SERVER_URL
}, async () => {
	const origin = process.env.TEST_SERVER_URL;
	async function request(endpoint, payload, token, major = 2) {
		const response = await fetch(origin + (major === 2 ? endpoint.replace('/api/', '/api/v2/') : endpoint), {
			method: payload === undefined ? 'GET' : 'POST',
			headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Session-Token': token } : {}) },
			body: payload === undefined ? undefined : JSON.stringify(payload)
		});
		assert.equal(response.status, 200, endpoint);
		return { response, json: await response.json() };
	}
	const register = async name => (await request('/api/register', { client_key: crypto.randomUUID(), display_name: name,
		client_runtime: { mod_version: '1.5.5', active_mods: [] } })).json;
	const sender = await register('Integrated Sender'), recipient = await register('Integrated Recipient');
	for (const client of [sender, recipient]) await request('/api/guilds/join-free', {}, client.session_token);
	let transfer = []; // Reproduce a missing local donation snapshot without altering server history.
	const processed = [], acknowledged = [];
	const storage = new Map();
	let journal;
	async function reconcile(receipts) {
		for (const receipt of receipts.filter(Boolean)) {
			const outcome = apply_economy_receipt(receipt, processed, {
				maximum_transfer_entries: 32, get_transfer_inventory: () => transfer,
				replace_transfer_inventory: value => transfer = value, persist_processed_ids() {},
				has_bank_item: () => true, get_bank_qty: () => 0, get_gp: () => 0
			});
			if (outcome === 'blocked' || outcome === 'invalid') return false;
			await request('/api/economy/receipts/acknowledge', { receipt_id: receipt.id }, recipient.session_token);
			acknowledged.push(receipt.id);
			journal.acknowledge(receipt.id);
		}
		return true;
	}
	journal = create_economy_command_journal({
		read: () => storage.get('journal'), write: value => storage.set('journal', structuredClone(value)), remove: () => storage.delete('journal'),
		send: (endpoint, payload, major) => request(endpoint, payload, recipient.session_token, major),
		reconcile, current: () => true, can_submit: () => true
	});
	const options = {
		read: key => storage.get(key), write: (key, value) => storage.set(key, structuredClone(value)), remove: key => storage.delete(key),
		post: async (endpoint, payload) => (await journal.run(endpoint, payload, 2)).json,
		reconcile, uuid: () => crypto.randomUUID()
	};
	const actions = create_pending_economy_actions(options);
	const payload = { items: [{ id: 'melvorD:Integration_Logs', qty: 3 }], donation_value: 30 };
	const first = actions.run('donation', '/api/charity/donate', payload);
	assert.equal(first, actions.run('donation', '/api/charity/donate', payload));
	assert.equal(await first, null);
	const command_id = storage.get('journal').payload.command_id;
	await request('/api/gift/send', { recipient_id: recipient.chat.client_id,
		items: [{ id: 'melvorD:Integration_Fish', qty: 2 }], command_id: crypto.randomUUID() }, sender.session_token);
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const source = main.slice(main.indexOf('async function get_client_events_request('), main.indexOf('\nfunction start_client_event_polling('));
	const state = { chat_notification_preferences: {}, events: {}, gifts: [], trades: [], resolved_trades: [], inbox_items: [] };
	let contents;
	const context = {
		state, client_events_hydrated: false, session_generation: 1, client_event_revision: 0, CHAT_CAPABILITIES: '', chat_page_visible: false,
		legacy_market_payout_migration_started: false, MOD_VERSION: '1.5.5', get_instance_storage_item: () => undefined,
		polling: { has_pending_events: () => true }, event_snapshots, economy_command_journal: journal,
		social_mode: { SOCIAL_MODE_FULL: 'full', SOCIAL_MODE_SOCIAL: 'social' },
		enter_unsupported_multiplayer: () => false, check_released_mod_version() {},
		api_get: async endpoint => (await request(endpoint, undefined, recipient.session_token)).json,
		reconcile_economy_receipts: reconcile, reconcile_campaign_event() {}, invalidate_guild_state() {}, update_chat_nav() {},
		reconcile_guild_member_social_modes() {}, update_transfer_inventory_nav() {}, update_multiplayer_nav() {},
		set_instance_storage_item() {}, leave_social_only_disabled_page() {},
		reconcile_pending_gifts: () => contents = request('/api/transfers/get_contents', {
			gift_ids: state.gifts.map(gift => gift.id), trade_ids: [], resolved_trade_ids: []
		}, recipient.session_token),
		economy_receipts: { is_complete_economy_receipt_page: () => true }, ECONOMY_RECEIPT_PAGE_SIZE: 64,
		remove_instance_storage_item() {}, show_pending_banishment_notice() {}
	};
	await runInNewContext(source + '\nget_client_events_request(true, 1)', context);
	assert.equal(state.gifts.length, 1);
	assert.ok((await contents).json.gifts[state.gifts[0].id]);
	assert.deepEqual(acknowledged, []);
	assert.equal(context.client_event_revision, 0);
	transfer = [{ id: 'melvorD:Integration_Logs', qty: 3 }];
	await runInNewContext(source + '\nget_client_events_request(true, 1)', context);
	await contents;
	assert.equal(transfer.length, 0);
	assert.ok(acknowledged.includes(command_id));
	const reloaded = create_pending_economy_actions(options);
	assert.equal((await reloaded.run('donation', '/api/charity/donate', payload)).success, true);
	const stock = (await request('/api/charity/contents', undefined, recipient.session_token)).json.items;
	assert.equal(stock.find(item => item.id === 'melvorD:Integration_Logs').qty, 3);
});
