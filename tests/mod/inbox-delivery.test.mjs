import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
	apply_inbox_claim,
	forget_inbox_claim,
	get_inbox_existing_item_ids,
	load_inbox_delivery_state
} from '../../mod/inbox-delivery.mjs';

const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
const bank_helpers_and_claim = main.slice(
	main.indexOf('function get_bank_item_ids()'),
	main.indexOf('async function reconcile_pending_gifts')
);

function claim_harness({ maximumSlots = 900, occupiedSlots = 808, existing = false, fail_ack = false } = {}) {
	const item = { id: 'melvorTotH:Gauntlets_of_Rage' };
	const bank = { maximumSlots, occupiedSlots, items: new Map(existing ? [[item, { quantity: 1 }]] : []) };
	const requests = [], deliveries = [], notices = [], persisted = [];
	let pending_claim = null;
	let inbox_items = [{ item_id: item.id, qty: 1 }];
	const state = { inbox_claiming: false, inbox_items };
	const api_post = async (route, body) => {
		requests.push({ route, body });
		if (route === '/api/inbox/claim') {
			if (pending_claim === null && inbox_items.length > 0 &&
				(body.available_slots > 0 || body.existing_item_ids.includes(item.id))) {
				pending_claim = { claim_id: 'claim-1', items: [{ id: item.id, qty: 1 }] };
				inbox_items = [];
			}
			return { claim: pending_claim };
		}
		assert.equal(route, '/api/inbox/acknowledge');
		assert.equal(deliveries.length, 1, 'deliver before acknowledging');
		assert.deepEqual(persisted.at(-1).processed_claim_ids, ['claim-1']);
		if (fail_ack) { fail_ack = false; return null; }
		pending_claim = null;
		return { success: true };
	};
	const runtime = new Function('game', 'state', 'api_post', 'update_inbox', 'add_bank_item',
		'notify_error', 'set_instance_storage_item', 'remove_instance_storage_item',
		'apply_inbox_claim', 'get_inbox_existing_item_ids', 'forget_inbox_claim', `
		let inbox_delivery_state = { version: 1, processed_claim_ids: [] };
		const transfer_currency_support = null;
		const is_button_spinning = () => false;
		const show_button_spinner = () => {};
		const hide_button_spinner = () => {};
		${bank_helpers_and_claim}
		return { claim_inbox, get_bank_free_slots };
	`)(
		{ bank, items: { getObjectByID: id => id === item.id ? item : undefined } }, state, api_post,
		async () => { state.inbox_items = inbox_items; },
		(id, qty) => { deliveries.push({ id, qty }); bank.items.set(item, { quantity: qty }); bank.occupiedSlots++; },
		message => notices.push(message),
		(key, value) => persisted.push(value), () => {},
		apply_inbox_claim, get_inbox_existing_item_ids, forget_inbox_claim
	);
	return { ...runtime, bank, state, requests, deliveries, notices };
}

test('claims a new item with Melvor native 808/900 Bank counters and acknowledges after delivery', async () => {
	const runtime = claim_harness();
	assert.equal(runtime.get_bank_free_slots(), 92);
	await runtime.claim_inbox({ currentTarget: {} });
	assert.deepEqual(runtime.requests[0].body, { existing_item_ids: [], available_slots: 92 });
	assert.equal(runtime.deliveries.length, 1);
	assert.equal(runtime.requests[1].route, '/api/inbox/acknowledge');
	assert.deepEqual(runtime.state.inbox_items, []);
	assert.equal(runtime.state.inbox_claiming, false);
});

test('full Bank leaves new Inbox items available and explains why nothing was claimed', async () => {
	const runtime = claim_harness({ occupiedSlots: 900 });
	await runtime.claim_inbox({ currentTarget: {} });
	assert.equal(runtime.requests[0].body.available_slots, 0);
	assert.equal(runtime.requests.length, 1);
	assert.equal(runtime.deliveries.length, 0);
	assert.equal(runtime.state.inbox_items.length, 1);
	assert.deepEqual(runtime.notices, ['MOD_MP_INBOX_CLAIM_BLOCKED']);
});

test('existing Bank stacks can be claimed with no free slots', async () => {
	const runtime = claim_harness({ occupiedSlots: 900, existing: true });
	await runtime.claim_inbox({ currentTarget: {} });
	assert.deepEqual(runtime.requests[0].body.existing_item_ids, ['melvorTotH:Gauntlets_of_Rage']);
	assert.equal(runtime.deliveries.length, 1);
});

test('retrying a failed acknowledgement does not deliver the item twice', async () => {
	const runtime = claim_harness({ fail_ack: true });
	await runtime.claim_inbox({ currentTarget: {} });
	await runtime.claim_inbox({ currentTarget: {} });
	assert.equal(runtime.deliveries.length, 1);
	assert.equal(runtime.requests.filter(request => request.route.endsWith('/acknowledge')).length, 2);
	assert.deepEqual(runtime.state.inbox_items, []);
});

test('native counters override map size and malformed or overfull counters grant no new slots', () => {
	const runtime = claim_harness();
	runtime.bank.items = { size: 1000 };
	assert.equal(runtime.get_bank_free_slots(), 92);
	for (const [maximumSlots, occupiedSlots] of [[900, 901], [undefined, 808], [900, undefined],
		[Infinity, 808], [900, NaN], [900, -1], [-1, 0], [900.5, 808]]) {
		Object.assign(runtime.bank, { maximumSlots, occupiedSlots });
		assert.equal(runtime.get_bank_free_slots(), 0);
	}
});

function harness({ bank = [], free_slots = 0, known = [] } = {}) {
	return {
		bank: new Set(bank),
		free_slots,
		known: new Set(known),
		is_known_item(id) { return this.known.has(id); },
		has_bank_item(id) { return this.bank.has(id); },
		get_bank_free_slots() { return this.free_slots; }
	};
}

test('sends only bank items that can affect the current inbox claim', () => {
	assert.deepEqual(get_inbox_existing_item_ids([
		{ item_id: 'melvorD:GP' },
		{ item_id: 'melvorD:Logs' }
	], [
		...Array.from({ length: 513 }, (_, index) => `melvorD:Bank_Item_${index}`),
		'melvorD:Logs',
		'melvorD:SlayerCoins'
	]), ['melvorD:Logs']);
});

test('claims supported currencies without consuming bank slots', () => {
	const state = load_inbox_delivery_state();
	const adapter = harness({ free_slots: 0 });
	adapter.is_known_currency = id => id === 'melvorD:SlayerCoins' || id === 'melvorItA:AbyssalPieces';

	const applied = apply_inbox_claim(state, {
		claim_id: 'currency-claim',
		items: [
			{ id: 'melvorD:SlayerCoins', qty: 4 },
			{ id: 'melvorItA:AbyssalPieces', qty: 7 }
		]
	}, adapter);

	assert.equal(applied.status, 'applied');
});

test('claims GP and complete item stacks using item-type bank slots', () => {
	const state = load_inbox_delivery_state(undefined, ['old-claim']);
	const adapter = harness({ bank: ['melvorD:Iron_Ore'], free_slots: 1, known: ['melvorD:Iron_Ore', 'melvorD:Logs'] });
	const claim = {
		claim_id: 'claim-1',
		items: [
			{ id: 'melvorD:GP', qty: 11 },
			{ id: 'melvorD:Iron_Ore', qty: 4 },
			{ id: 'melvorD:Logs', qty: 9 }
		]
	};

	const applied = apply_inbox_claim(state, claim, adapter);
	assert.equal(applied.status, 'applied');
	assert.deepEqual(applied.state.processed_claim_ids, ['old-claim', 'claim-1']);
	assert.equal(apply_inbox_claim(applied.state, claim, adapter).status, 'already-applied');
});

test('blocks the entire claim when complete stacks exceed available bank slots', () => {
	const state = load_inbox_delivery_state();
	const adapter = harness({ free_slots: 0, known: ['melvorD:Logs'] });
	const claim = { claim_id: 'claim-2', items: [{ id: 'melvorD:Logs', qty: 9 }] };

	const blocked = apply_inbox_claim(state, claim, adapter);
	assert.equal(blocked.status, 'blocked');
	assert.deepEqual(blocked.state, state);
});

test('rejects unknown item stacks without consuming the claim', () => {
	const state = load_inbox_delivery_state();
	const blocked = apply_inbox_claim(state, {
		claim_id: 'claim-3',
		items: [{ id: 'missing-mod:Item', qty: 1 }]
	}, harness({ free_slots: 1 }));

	assert.equal(blocked.status, 'blocked');
	assert.deepEqual(blocked.state, state);
	assert.deepEqual(forget_inbox_claim({ version: 1, processed_claim_ids: ['claim-3', 'claim-4'] }, 'claim-3'), {
		version: 1,
		processed_claim_ids: ['claim-4']
	});
});
