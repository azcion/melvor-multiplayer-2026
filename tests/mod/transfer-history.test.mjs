import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create_transfer_history_state, create_transfer_history_loader, visible_transfer_history, transfer_history_label, transfer_history_items, transfer_history_context, transfer_history_sources, transfer_history_exchange, HISTORY_WINDOW } from '../../mod/transfer-history.mjs';

const entry = (id, at = 1000) => ({ id, occurred_at: at, event_type: 'market-sell', items: [] });

test('history paging sorts, deduplicates and preserves older loaded entries on a live refresh', async () => {
	const state = { transfer_history: create_transfer_history_state() }; const urls = [];
	const responses = [
		{ server_time: 1000, entries: [entry(3), entry(2)], next_cursor: { occurred_at: 1000, id: 2 } },
		{ server_time: 1000, entries: [entry(2), entry(1)], next_cursor: null },
		{ server_time: 1000, entries: [entry(4), entry(3)], next_cursor: { occurred_at: 1000, id: 3 } }
	];
	const load = create_transfer_history_loader({ state, api_get: async url => { urls.push(url); return responses.shift(); }, scope: () => 'owner', now: () => 1000 });
	assert.equal(await load('outbox'), true); await load('outbox', true); await load('outbox');
	assert.deepEqual(state.transfer_history.outbox.entries.map(row => row.id), [4, 3, 2, 1]);
	assert.equal(state.transfer_history.outbox.next_cursor, null);
	assert.match(urls[1], /pane=outbox&before_at=1000&before_id=2$/);
	assert.equal(await load('outbox', true), false);
});

test('a gap in a busy feed resets paging to the newest complete page', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	const responses = [{ server_time: 1000, entries: [entry(2), entry(1)], next_cursor: null },
		{ server_time: 1000, entries: [entry(5), entry(4)], next_cursor: { occurred_at: 1000, id: 4 } }];
	const load = create_transfer_history_loader({ state, api_get: async () => responses.shift(), scope: () => 'owner', now: () => 1000 });
	await load('inbox'); await load('inbox');
	assert.deepEqual(state.transfer_history.inbox.entries.map(row => row.id), [5, 4]);
	assert.equal(state.transfer_history.inbox.next_cursor.id, 4);
});

test('failed history requests retain rows and cursor, expose retry, and release the loading guard', async () => {
	const state = { transfer_history: create_transfer_history_state() }; let fail = false;
	const load = create_transfer_history_loader({ state, api_get: async () => {
		if (fail) throw Error('offline');
		return { server_time: 1000, entries: [entry(2)], next_cursor: { occurred_at: 1000, id: 2 } };
	}, scope: () => 'owner', now: () => 1000 });
	await load('pending'); fail = true;
	assert.equal(await load('pending', true), false);
	assert.equal(state.transfer_history.pending.error, true);
	assert.equal(state.transfer_history.pending.retry_append, true);
	assert.equal(state.transfer_history.pending.loading, false);
	assert.equal(state.transfer_history.pending.entries.length, 1);
	assert.equal(state.transfer_history.pending.next_cursor.id, 2);
});

test('history responses cannot cross an identity/session reset and parallel clicks remain single-flight', async () => {
	const state = { transfer_history: create_transfer_history_state() }; let scope = 'first'; let release;
	const load = create_transfer_history_loader({ state, api_get: () => new Promise(resolve => release = resolve), scope: () => scope });
	const pending = load('inbox'); assert.equal(await load('inbox'), false);
	scope = 'second'; state.transfer_history = create_transfer_history_state();
	release({ server_time: 1000, entries: [entry(1)], next_cursor: null });
	assert.equal(await pending, false); assert.deepEqual(state.transfer_history.inbox.entries, []);
	assert.equal(state.transfer_history.inbox.loading, false);
});

test('visible history ages out using server time even with a skewed local clock', () => {
	const server_time = 2 * HISTORY_WINDOW;
	const page = { server_time, loaded_at: 0, entries: [entry(1, HISTORY_WINDOW), entry(2, HISTORY_WINDOW - 1), entry(3, server_time + 1)] };
	assert.deepEqual(visible_transfer_history(page, 0).map(row => row.id), [1]);
	assert.deepEqual(visible_transfer_history(page, 2).map(row => row.id), [3]);
});

test('overlapping refreshes replace duplicate snapshots, sort by timestamp then ID, and preserve the older cursor', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	const older_cursor = { occurred_at: 700, id: 1 };
	const replacement = { ...entry(4, 900), items: [{ item_id: 'Sword', qty: 2 }] };
	const responses = [
		{ server_time: 1000, entries: [entry(4, 900), entry(3, 800), entry(2, 800)], next_cursor: older_cursor },
		{ server_time: 1000, entries: [replacement, entry(5, 1000), entry(4, 900)], next_cursor: { occurred_at: 900, id: 4 } },
		{ server_time: 1000, entries: [replacement, entry(5, 1000)], next_cursor: { occurred_at: 900, id: 4 } }
	];
	const load = create_transfer_history_loader({ state, api_get: async () => responses.shift(), scope: () => 'owner', now: () => 50 });
	await load('outbox');
	await load('outbox');
	const page = state.transfer_history.outbox;
	assert.deepEqual(page.entries.map(row => row.id), [5, 4, 3, 2]);
	// Within a response the last duplicate wins, even over an earlier replacement.
	assert.deepEqual(page.entries[1], entry(4, 900));
	assert.deepEqual(page.next_cursor, older_cursor);
	await load('outbox');
	assert.deepEqual(page.entries[1], replacement);
	assert.deepEqual(page.next_cursor, older_cursor);
	assert.equal(page.visible_count, 5);
});

test('refresh without older retained rows adopts the response cursor, including an empty page', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	const responses = [
		{ server_time: 1000, entries: [entry(2)], next_cursor: { occurred_at: 1000, id: 2 } },
		{ server_time: 1000, entries: [entry(3), entry(2)], next_cursor: { occurred_at: 1000, id: 1 } },
		{ server_time: 1000, entries: [] }
	];
	const load = create_transfer_history_loader({ state, api_get: async () => responses.shift(), scope: () => 'owner' });
	await load('inbox');
	await load('inbox');
	assert.equal(state.transfer_history.inbox.next_cursor.id, 1);
	await load('inbox');
	assert.deepEqual(state.transfer_history.inbox.entries, []);
	assert.equal(state.transfer_history.inbox.next_cursor, null);
	assert.equal(state.transfer_history.inbox.loaded, true);
});

test('pagination reveals cached rows before fetching and merges the next page with response precedence', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	const urls = [];
	const replacement = { ...entry(1), items: [{ item_id: 'Sword', qty: 1 }] };
	const responses = [
		{ server_time: 1000, entries: Array.from({ length: 6 }, (_, i) => entry(6 - i)), next_cursor: { occurred_at: 1000, id: 1 } },
		{ server_time: 1000, entries: [replacement, entry(7, 900)], next_cursor: null }
	];
	const load = create_transfer_history_loader({ state, api_get: async url => { urls.push(url); return responses.shift(); }, scope: () => 'owner', now: () => 100 });
	await load('pending');
	await load('pending', true);
	assert.equal(urls.length, 1);
	assert.equal(state.transfer_history.pending.visible_count, 10);
	await load('pending', true);
	const page = state.transfer_history.pending;
	assert.match(urls[1], /pane=pending&before_at=1000&before_id=1$/);
	assert.equal(page.visible_count, 15);
	assert.deepEqual(page.entries.map(row => row.id), [6, 5, 4, 3, 2, 1, 7]);
	assert.deepEqual(page.entries[5], replacement);
	assert.equal(page.next_cursor, null);
	assert.equal(await load('pending', true), false);
});

for (const append of [false, true]) {
	for (const failure of [null, { entries: [], server_time: 1.5 }, { server_time: 1000 }, Error('offline')]) {
		test(`failed ${append ? 'append' : 'refresh'} preserves loaded state and retries (${failure instanceof Error ? 'rejection' : JSON.stringify(failure)})`, async () => {
			const state = { transfer_history: create_transfer_history_state() };
			let response = { server_time: 1000, entries: [entry(2)], next_cursor: { occurred_at: 1000, id: 2 } };
			const load = create_transfer_history_loader({ state, scope: () => 'owner', now: () => 100,
				api_get: async () => { if (response instanceof Error) throw response; return response; } });
			await load('inbox');
			const page = state.transfer_history.inbox;
			const before = structuredClone(page);
			response = failure;
			assert.equal(await load('inbox', append), false);
			assert.deepEqual(page, { ...before, error: true, retry_append: append });
			response = { server_time: 1100, entries: [entry(1)], next_cursor: null };
			assert.equal(await load('inbox', page.retry_append), true);
			assert.equal(page.error, false);
			assert.equal(page.loading, false);
			assert.equal(page.visible_count, append ? 10 : 5);
		});
	}
}

for (const replacement of ['scope', 'pane', 'state']) {
	for (const reject of [false, true]) {
		test(`late ${reject ? 'rejection' : 'response'} is ignored after ${replacement} replacement`, async () => {
			const state = { transfer_history: create_transfer_history_state() };
			let owner = 'first';
			let resolve, fail;
			const load = create_transfer_history_loader({ state, scope: () => owner,
				api_get: () => new Promise((yes, no) => { resolve = yes; fail = no; }) });
			const old_page = state.transfer_history.inbox;
			const pending = load('inbox');
			if (replacement === 'scope') owner = 'second';
			else if (replacement === 'pane') state.transfer_history.inbox = create_transfer_history_state().inbox;
			else state.transfer_history = create_transfer_history_state();
			const current = structuredClone(state.transfer_history);
			if (reject) fail(Error('offline'));
			else resolve({ server_time: 1000, entries: [entry(1)], next_cursor: null });
			assert.equal(await pending, false);
			assert.equal(old_page.loading, false);
			if (replacement === 'scope') current.inbox.loading = false;
			assert.deepEqual(state.transfer_history, current);
		});
	}
}

test('a late response cannot release the loading guard of a replacement page', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	const pending = [];
	const load = create_transfer_history_loader({ state, scope: () => 'owner', now: () => 100,
		api_get: () => new Promise(resolve => pending.push(resolve)) });
	const old_request = load('inbox');
	state.transfer_history = create_transfer_history_state();
	const new_request = load('inbox');
	pending[0]({ server_time: 1000, entries: [entry(1)], next_cursor: null });
	assert.equal(await old_request, false);
	assert.equal(state.transfer_history.inbox.loading, true);
	assert.equal(await load('inbox'), false);
	assert.equal(pending.length, 2);
	pending[1]({ server_time: 1000, entries: [entry(2)], next_cursor: null });
	assert.equal(await new_request, true);
	assert.deepEqual(state.transfer_history.inbox.entries.map(row => row.id), [2]);
	assert.equal(state.transfer_history.inbox.loading, false);
});

test('an initial failure remains unloaded and a successful retry clears the error', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	let response = null;
	const load = create_transfer_history_loader({ state, scope: () => 'owner', now: () => 100,
		api_get: async () => response });
	assert.equal(await load('inbox'), false);
	assert.deepEqual(state.transfer_history.inbox, {
		...create_transfer_history_state().inbox, error: true
	});
	response = { server_time: 1000, entries: [], next_cursor: null };
	assert.equal(await load('inbox'), true);
	assert.equal(state.transfer_history.inbox.loaded, true);
	assert.equal(state.transfer_history.inbox.error, false);
	assert.equal(state.transfer_history.inbox.loading, false);
});

test('history panes load independently while each pane rejects duplicate and invalid requests', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	const pending = [];
	const load = create_transfer_history_loader({ state, scope: () => 'owner', now: () => 100,
		api_get: () => new Promise(resolve => pending.push(resolve)) });
	assert.equal(await load('unknown'), false);
	const inbox = load('inbox');
	const outbox = load('outbox');
	assert.equal(await load('inbox', true), false);
	assert.equal(pending.length, 2);
	pending[1]({ server_time: 1000, entries: [entry(2)], next_cursor: null });
	await outbox;
	assert.equal(state.transfer_history.inbox.loading, true);
	assert.equal(state.transfer_history.pending.loaded, false);
	pending[0]({ server_time: 1000, entries: [entry(1)], next_cursor: null });
	await inbox;
	assert.deepEqual(state.transfer_history.inbox.entries.map(row => row.id), [1]);
	assert.deepEqual(state.transfer_history.outbox.entries.map(row => row.id), [2]);
});

test('loading filters window boundaries and anchors elapsed time to the successful response', async () => {
	const state = { transfer_history: create_transfer_history_state() };
	const server_time = 2 * HISTORY_WINDOW;
	const load = create_transfer_history_loader({ state, scope: () => 'owner', now: () => 500,
		api_get: async () => ({ server_time, entries: [entry(1, HISTORY_WINDOW), entry(2, HISTORY_WINDOW - 1), entry(3, server_time + 1), entry(4, server_time)] }) });
	await load('inbox');
	const page = state.transfer_history.inbox;
	assert.equal(page.server_time, server_time);
	assert.equal(page.loaded_at, 500);
	assert.deepEqual(page.entries.map(row => row.id), [4, 1]);
	assert.deepEqual(visible_transfer_history(page, 499).map(row => row.id), [4, 1]);
	assert.deepEqual(visible_transfer_history(page, 501).map(row => row.id), [4]);
});

test('history titles use localized actions and Inbox source titles without exposing internal event codes', () => {
	const lang = id => id; const inbox = row => 'source:' + row.source_type;
	assert.equal(transfer_history_label({ event_type: 'inbox.received', source_type: 'gift_received' }, lang, inbox), 'source:gift_received');
	assert.equal(transfer_history_label({ event_type: 'inbox.received', source_type: 'crucible', source_name: 'Wish Granted' }, lang, inbox), 'MOD_MP_TRANSFER_HISTORY_WISH_GRANTED');
	assert.equal(transfer_history_label({ event_type: 'inbox.received', source_type: 'campaign' }, lang, inbox), 'MOD_MP_TRANSFER_HISTORY_CAMPAIGN');
	assert.equal(transfer_history_label({ event_type: 'crucible-cast' }, lang, inbox), 'MOD_MP_TRANSFER_HISTORY_CRUCIBLE_CAST');
	assert.equal(transfer_history_label({ event_type: 'unknown', pane: 'outbox' }, lang, inbox), 'MOD_MP_TRANSFER_HISTORY_SENT');
});

test('each equal desktop column owns an accessible History card beneath its current pane', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const page = templates.slice(templates.indexOf('<template id="template-mp-transfer-page">'), templates.indexOf('<template id="template-mp-raid-drops-modal">'));
	const css = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	assert.match(css, /\.mp-transfers-layout \{[^}]*grid-template-columns: 1fr 1fr 1fr;/);
	for (const pane of ['inbox', 'outbox', 'pending']) {
		assert.ok(page.indexOf(`id="mp-transfers-${pane}-column"`) < page.indexOf(`id="mp-transfers-${pane}"`));
		assert.ok(page.indexOf(`id="mp-transfers-${pane}"`) < page.indexOf(`id="mp-transfer-history-${pane}-title"`));
		assert.ok(page.includes(`aria-controls="mp-transfers-${pane}-column"`));
		assert.ok(page.includes(`aria-controls="mp-transfer-history-${pane}-body"`));
		assert.ok(page.includes(`v-show="state.transfers_history_open.${pane}"`));
	}
	assert.ok(page.includes('MOD_MP_TRANSFER_HISTORY_RECONSTRUCTED'));
	assert.ok(page.includes('MOD_MP_TRANSFER_HISTORY_ERROR'));
	assert.ok(page.includes('MOD_MP_TRANSFER_HISTORY_EMPTY'));
	assert.ok(page.includes(':datetime="new Date(entry.occurred_at).toISOString()"'));
});

test('history reveals five cached entries at a time before fetching the next API page', async () => {
	const state = { transfer_history: create_transfer_history_state() }; let calls = 0;
	const load = create_transfer_history_loader({ state, scope: () => 'owner', now: () => 1000,
		api_get: async () => { calls++; return { server_time: 1000, entries: Array.from({ length: 20 }, (_, i) => entry(20 - i)), next_cursor: null }; } });
	await load('inbox'); assert.equal(state.transfer_history.inbox.visible_count, 5);
	for (const count of [10, 15, 20]) { await load('inbox', true); assert.equal(state.transfer_history.inbox.visible_count, count); }
	assert.equal(calls, 1); assert.equal(await load('inbox', true), false);
	await load('inbox'); assert.equal(state.transfer_history.inbox.visible_count, 5);
});

test('currency rows aggregate only within the same direction without mutating recorded items', () => {
	const items = [{ item_id: 'GP', qty: 15, direction: 'out' }, { item_id: 'Sword', qty: 1, direction: 'out' },
		{ item_id: 'GP', qty: 14, direction: 'out' }, { item_id: 'GP', qty: 2, direction: 'in' }];
	assert.deepEqual(transfer_history_items(items, id => id === 'GP'), [
		{ item_id: 'GP', qty: 29, direction: 'out' }, items[1], items[3]]);
	assert.equal(items[0].qty, 15);
});

test('history has inert icons and no layout-shifting loader or periodic refresh', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.equal((templates.match(/<div class="mp-transfer-history-item"/g) ?? []).length, 3);
	assert.doesNotMatch(templates, /<mp-item-icon class="mp-transfer-history-item"/);
	assert.doesNotMatch(templates, /role="status" v-show="state.transfer_history\.\w+\.loading"/);
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	assert.doesNotMatch(main, /transfer_history_timer|page.loaded_at >= 60_000/);
});

test('history context localizes destinations and keeps Claimed unchanged', () => {
	const lang = key => ({ MOD_MP_TRANSFER_HISTORY_TO: 'To: %s', MOD_MP_TRANSFER_HISTORY_FROM: 'From: %s',
		MOD_MP_TRANSFER_HISTORY_WITH: 'With: %s', MOD_MP_PAGE_MARKET: 'Market', MOD_MP_TRANSFER_HISTORY_BANK: 'Bank',
		MOD_MP_TRANSFER_HISTORY_CLAIMED: 'Claimed' }[key] ?? key);
	assert.equal(transfer_history_context({ pane: 'outbox', source_type: 'market', source_name: 'Alice' }, lang), 'To: Market · Alice');
	assert.equal(transfer_history_context({ pane: 'pending', source_name: 'Alice' }, lang), 'With: Alice');
	assert.equal(transfer_history_context({ event_type: 'inbox.claimed' }, lang), 'To: Bank');
	assert.equal(transfer_history_label({ event_type: 'inbox.claimed' }, lang, () => ''), 'Claimed');
	assert.equal(transfer_history_context({ event_type: 'inbox.received', source_name: 'Alice' }, lang), '');
	assert.equal(transfer_history_context({ pane: 'outbox', source_type: 'unknown' }, lang), '');
});

test('claim source breakdown preserves quantities, localizes Crucible and shows unattributed remainder', () => {
	const lang = key => key;
	const item = { qty: 30, sources: [{ source_type: 'gift_received', source_name: 'Alice', qty: 10 },
		{ source_type: 'crucible', source_name: 'Wish Granted', qty: 15 }] };
	const rows = transfer_history_sources(item, lang, row => `Gift from ${row.source_name}`);
	assert.deepEqual(rows.map(row => [row.title, row.qty]), [
		['Gift from Alice', 10], ['MOD_MP_TRANSFER_HISTORY_WISH_GRANTED', 15], ['MOD_MP_TRANSFER_HISTORY_UNKNOWN_SOURCE', 5]
	]);
	assert.equal(item.sources.length, 2);
	assert.deepEqual(transfer_history_sources({ qty: 5, sources: item.sources }, lang, () => ''), []);
	assert.deepEqual(transfer_history_sources({ qty: 10 }, lang, () => ''), []);
});

test('every supported locale translates the new history context labels and preserves placeholders', async () => {
	const { readdir } = await import('node:fs/promises');
	const directory = new URL('../../mod/data/lang/', import.meta.url);
	for (const locale of (await readdir(directory)).filter(name => name.endsWith('.json'))) {
		const strings = JSON.parse(await readFile(new URL(locale, directory), 'utf8'));
		for (const key of ['FROM', 'TO', 'WITH', 'UNKNOWN_SOURCE', 'GIFT', 'TRADE', 'CAMPAIGN', 'BANK']) {
			const value = strings['MOD_MP_TRANSFER_HISTORY_' + key];
			assert.ok(typeof value === 'string' && value.trim(), `${locale}: ${key}`);
			if (['FROM', 'TO', 'WITH'].includes(key)) assert.equal(value.split('%s').length, 2, `${locale}: ${key}`);
		}
	}
});


test('direct marketplace exchanges show the counterparty while escrow destinations retain the feature', () => {
	const lang = key => ({ MOD_MP_TRANSFER_HISTORY_TO: 'To: %s', MOD_MP_PAGE_MARKET: 'Marketplace' }[key] ?? key);
	for (const event_type of ['market-buy', 'market-fulfill'])
		assert.equal(transfer_history_context({ pane: 'outbox', source_type: 'market', source_name: 'Valkorian', event_type }, lang), 'To: Valkorian');
	for (const event_type of ['market-sell', 'market-buy-order'])
		assert.equal(transfer_history_context({ pane: 'outbox', source_type: 'market', event_type }, lang), 'To: Marketplace');
});

test('exchange context renders all four labels without signs and rejects incomplete or unsafe snapshots', async () => {
	const lang = JSON.parse(await readFile(new URL('../../mod/data/lang/en.json', import.meta.url), 'utf8'));
	const format = item => item.qty.toLocaleString('en-US') + (item.item_id === 'SC' ? ' Slayer Coins' : ' × Bank Slot Token');
	for (const [label, expected] of [['purchased', 'Purchased: 25 × Bank Slot Token'], ['paid', 'Paid: 70,700 Slayer Coins'],
		['sold', 'Sold: 25 × Bank Slot Token'], ['proceeds', 'Proceeds: 70,700 Slayer Coins']]) {
		const exchange = { label, item_id: ['paid', 'proceeds'].includes(label) ? 'SC' : 'Token', qty: ['paid', 'proceeds'].includes(label) ? 70700 : 25 };
		assert.equal(transfer_history_exchange({ exchange }, key => lang[key], format), expected);
		assert.equal(transfer_history_exchange({ exchange, event_type: 'inbox.claimed' }, key => lang[key], format), '');
	}
	for (const exchange of [undefined, {}, { label: 'unknown', item_id: 'SC', qty: 2 }, { label: '__proto__', item_id: 'SC', qty: 2 },
		{ label: 'paid', item_id: '', qty: 2 }, { label: 'paid', item_id: 'SC', qty: 0 },
		{ label: 'paid', item_id: 'SC', qty: -1 }, { label: 'paid', item_id: 'SC', qty: 1.5 },
		{ label: 'paid', item_id: 'SC', qty: Number.MAX_SAFE_INTEGER + 1 }])
		assert.equal(transfer_history_exchange({ exchange }, key => lang[key], format), '');
});

test('all history panes render unsigned exchange context and every locale preserves its value placeholder', async () => {
	const templates = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.equal((templates.match(/class="mp-transfer-history-exchange"/g) ?? []).length, 3);
	assert.equal((templates.match(/v-show="state.get_transfer_history_exchange\(entry\)"/g) ?? []).length, 3);
	const { readdir } = await import('node:fs/promises');
	const directory = new URL('../../mod/data/lang/', import.meta.url);
	for (const locale of (await readdir(directory)).filter(name => name.endsWith('.json'))) {
		const strings = JSON.parse(await readFile(new URL(locale, directory), 'utf8'));
		for (const key of ['PURCHASED', 'PAID', 'SOLD', 'PROCEEDS']) {
			const value = strings['MOD_MP_TRANSFER_HISTORY_EXCHANGE_' + key];
			assert.ok(typeof value === 'string' && value.trim(), `${locale}: ${key}`);
			assert.equal(value.split('%s').length, 2, `${locale}: ${key}`);
		}
	}
});
