import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

import { open_transfer_page } from '../../mod/transfer-page.mjs';

const root = new URL('../../', import.meta.url);

test('prepares the transfer page before navigating to it', async () => {
	const events = [];
	let release_events;
	let release_guild;
	const events_ready = new Promise(resolve => release_events = resolve);
	const guild_ready = new Promise(resolve => release_guild = resolve);

	const opening = open_transfer_page({
		refresh_events: async () => {
			events.push('refresh events');
			await events_ready;
			events.push('events ready');
		},
		refresh_guild: async () => {
			events.push('refresh guild');
			await guild_ready;
			events.push('guild ready');
		},
		update_contents: async () => events.push('update contents'),
		navigate: () => events.push('navigate')
	});

	await Promise.resolve();
	assert.deepEqual(events, ['refresh events', 'refresh guild']);

	release_events();
	await Promise.resolve();
	assert.deepEqual(events, ['refresh events', 'refresh guild', 'events ready']);

	release_guild();
	await opening;
	assert.deepEqual(events, [
		'refresh events',
		'refresh guild',
		'events ready',
		'guild ready',
		'update contents',
		'navigate'
	]);
});

test('still navigates when transfer-page preparation fails', async () => {
	let navigated = false;

	await assert.rejects(
		open_transfer_page({
			refresh_events: async () => {
				throw new Error('offline');
			},
			refresh_guild: async () => {},
			update_contents: async () => assert.fail('contents should not update'),
			navigate: () => navigated = true
		}),
		/offline/
	);

	assert.equal(navigated, true);
});

test('hides the empty Transfer Inventory sidebar count', async () => {
	const [main, style] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const nav_update = main.slice(
		main.indexOf('function update_transfer_inventory_nav'),
		main.indexOf('\n}\n', main.indexOf('function update_transfer_inventory_nav')) + 2
	);

	assert.match(nav_update, /const has_inbox_items = state\.inbox_items\.length > 0/);
	assert.match(nav_update, /aside\.textContent = has_transfer_offers[\s\S]*has_inbox_items \? String\(state\.inbox_items\.length\)[\s\S]*state\.transfer_inventory\.length \+ ' \/ ' \+ TRANSFER_INVENTORY_MAX_LIMIT/);
	assert.match(nav_update, /aside\.hidden = !has_transfer_offers && !has_inbox_items && !has_items/);
	assert.match(style, /\.mp-guild-member-button \{[\s\S]*min-height: 69px;/);
});

test('keeps three Transfers panels mounted with mobile-only tab visibility', async () => {
	const [main, templates, style] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const page = templates.slice(templates.indexOf('<template id="template-mp-transfer-page">'), templates.indexOf('<template id="template-mp-gift-friend-modal">'));
	assert.match(main, /transfers_mobile_tab: 'inbox'/);
	for (const tab of ['inbox', 'outbox', 'pending']) {
		assert.ok(page.includes(`@click="state.transfers_mobile_tab = '${tab}'"`));
		const panel = page.match(new RegExp(`<section id="mp-transfers-${tab}"[^>]+>`))[0];
		assert.ok(panel.includes(`state.transfers_mobile_tab !== '${tab}'`));
		assert.doesNotMatch(panel, /v-if|v-show/);
	}
	assert.match(page, /MOD_MP_INBOX_TITLE"><\/lang-string><span class="badge badge-secondary mp-transfer-tab-badge mp-transfer-tab-badge-inbox" v-show="state\.inbox_items\.length > 0">\{\{ formatNumber\(state\.inbox_items\.length\) \}\}<\/span>/);
	assert.match(page, /MOD_MP_TRANSFER_OUTBOX"><\/lang-string><span class="badge badge-secondary mp-transfer-tab-badge" v-show="state\.transfer_inventory\.length > 0">\{\{ formatNumber\(state\.transfer_inventory\.length\) \}\}<\/span>/);
	assert.match(page, /MOD_MP_TRANSFER_PENDING"><\/lang-string><span class="badge badge-danger mp-transfer-tab-badge mp-transfer-tab-badge-pending" v-show="state\.num_active_transfers > 0">\{\{ formatNumber\(state\.num_active_transfers\) \}\}<\/span>/);
	assert.match(style, /\.mp-transfers-layout \{[^}]*display: grid;[^}]*grid-template-columns:/);
	assert.match(style, /@media \(max-width: 767\.98px\) \{\s*\.mp-transfers-tabs/);
	assert.match(style, /\.mp-transfer-tab-badge \{[\s\S]*position: absolute !important;[\s\S]*top: unset !important;[\s\S]*background-color: #232a35;[\s\S]*border: 1px solid rgba\(128, 128, 128, \.5\);/);
	assert.match(style, /\.mp-transfer-tab-badge-inbox \{[\s\S]*background-color: orange;[\s\S]*border: 0;/);
	assert.match(style, /\.mp-transfer-tab-badge-pending \{[\s\S]*background-color: #ff4545;[\s\S]*border: 0;/);
	assert.match(style, /\.mp-transfers-inbox \.mp-inbox-claim \.btn \{[\s\S]*flex: 0 0 50%;[\s\S]*margin-left: auto !important;/);
	assert.match(page, /mp-inbox-claim/);
	assert.match(style, /\.mp-transfers-outbox \.mp-transfer-buttons\.mp-transfer-buttons-single \.btn \{[\s\S]*grid-column: 2;/);
	assert.match(page, /class="p-3 mp-transfer-buttons" :class="\{ 'mp-transfer-buttons-single': state\.transfer_inventory\.length === 0 \}/);
	assert.doesNotMatch(style, /\.mp-transfers-inbox \{\s*min-height: 60vh;/);
	assert.match(style, /\.mp-transfers-mobile-hidden \{\s*display: none !important;/);
	assert.match(page, /MOD_MP_TRANSFER_OFFER_OUTBOX/);
	assert.match(page, /MOD_MP_TRANSFER_DECLINE/);
});

test('renders only pending Haggles in the Transfers Pending section', async () => {
	const [main, actions, templates, style] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-transfer.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const market_page = templates.slice(templates.indexOf('<template id="template-mp-market-page">'), templates.indexOf('<template id="template-mp-charity-page">'));
	const transfer_page = templates.slice(templates.indexOf('<template id="template-mp-transfer-page">'), templates.indexOf('<template id="template-mp-gift-friend-modal">'));
	const pending = transfer_page.slice(transfer_page.indexOf('id="mp-transfers-pending"'));

	assert.doesNotMatch(market_page, /market_active_tab == 'haggles'/);
	assert.match(pending, /class="block tabbable w-100 mp-col mp-transfer-haggle" v-for="haggle in state\.market_haggles"/);
	assert.match(pending, /class="pl-3 pt-1 pb-1 bg-dark-bank-info text-center mp-transfer-haggle-header"[\s\S]*class="mp-transfer-haggle-title"/);
	assert.match(pending, /class="mp-transfer-haggle-meta"[\s\S]*mp-transfer-haggle-status/);
	assert.match(pending, /mp-transfer-haggle-value[\s\S]*MOD_MP_TRANSFER_OFFERED/);
	assert.match(pending, /state\.get_avatar_icon\(haggle\.counterparty\.icon_id\)/);
	assert.match(pending, /MOD_MP_TRANSFER_HAGGLE_WITH/);
	assert.doesNotMatch(pending, /MOD_MP_MARKET_HAGGLE_WITH/);
	assert.match(pending, /class="pb-4 row mp-transfer-haggle-items"/);
	assert.doesNotMatch(pending, /mp-market-search-result/);
	assert.match(pending, /state\.respond_market_haggle\(\$event, haggle, 'claim'\)/);
	assert.match(pending, /state\.respond_market_haggle\(\$event, haggle, 'accept'\)/);
	assert.match(style, /\.mp-transfer-haggle-meta \{[\s\S]*justify-content: space-between/);
	assert.match(style, /\.mp-transfer-haggle-claim \{[\s\S]*border-top: 1px solid/);
	assert.match(main, /state\.market_haggles = haggles\.filter\(haggle => haggle\.status === 'active' \|\|/);
	assert.match(main, /state\.market_haggle_pending = state\.market_haggles\.length;\s*update_transfer_inventory_nav\(\);/);
	assert.match(main, /this\.market_haggle_pending > 0/);
	assert.match(main, /this\.market_haggle_pending;[\s\S]*get num_active_transfers\(\)/);
	assert.match(actions, /update_contents: async \(\) => \{[\s\S]*await update_transfer_contents\(\);[\s\S]*await update_market_haggles\(\);/);
});

test('retains the Claim button while the async request is in flight', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const claim = main.slice(main.indexOf('async function claim_inbox'), main.indexOf('async function reconcile_pending_gifts'));

	assert.match(claim, /const \$button = event\.currentTarget;/);
	assert.match(claim, /show_button_spinner\(\$button\)/);
	assert.match(claim, /hide_button_spinner\(\$button\)/);
	assert.doesNotMatch(claim, /(?:show|hide|is_button_spinning)\(event\.currentTarget\)/);
});

test('prevents Outbox item images from hijacking selection clicks as native drags', async () => {
	const [templates, style] = await Promise.all([
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const page = templates.slice(templates.indexOf('<template id="template-mp-transfer-page">'), templates.indexOf('<template id="template-mp-gift-friend-modal">'));
	const outbox = page.slice(page.indexOf('id="mp-transfers-outbox"'), page.indexOf('id="mp-transfers-pending"'));

	assert.match(outbox, /<img class="bank-img p-3" :src="state\.get_item_icon\(item\.id\)" draggable="false"/);
	assert.match(style, /\.mp-transfers-panel \.bank-item > a \{\s*height: 100%;\s*display: inline-block;\s*\}/);
});

test('offers Add Currency independently of the Outbox contents', async () => {
	const [main, templates, english] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse)
	]);
	const page = templates.slice(templates.indexOf('<template id="template-mp-transfer-page">'), templates.indexOf('<template id="template-mp-gift-friend-modal">'));
	const add_currency_modal = templates.slice(templates.indexOf('<template id="template-mp-add-currency-modal">'), templates.indexOf('<template id="template-mp-campaign-contribute-modal">'));
	const outbox = page.slice(page.indexOf('id="mp-transfers-outbox"'), page.indexOf('id="mp-transfers-pending"'));
	const button_tray = outbox.slice(outbox.indexOf('<div class="p-3 mp-transfer-buttons"'), outbox.indexOf('</section>'));

	assert.match(page, /MOD_MP_BUTTON_ADD_CURRENCY/);
	assert.match(page, /state\.show_add_currency_modal\(\)/);
	assert.match(add_currency_modal, /state\.transfer_currencies/);
	assert.match(add_currency_modal, /currency\.currency\.media/);
	assert.match(add_currency_modal, /currency\.lang_id/);
	assert.match(add_currency_modal, /state\.show_add_currency_amount_modal\(currency\.id\)/);
	assert.match(main, /get transfer_currencies\(\)[\s\S]*get_available_transfer_currencies/);
	assert.match(main, /add_currency_to_transfer\(currency_id, amount\)/);
	assert.equal(english.MOD_MP_BUTTON_ADD_CURRENCY, 'Add Currency');
	assert.equal(english.MOD_MP_BUTTON_RETURN_SELECTED, 'Return Selected');
	assert.equal(english.MOD_MP_BUTTON_RETURN_ALL, 'Return All');
	assert.equal(english.MOD_MP_TRANSFER_DONATE, 'Donate All');
	assert.ok(button_tray.indexOf('MOD_MP_BUTTON_ADD_CURRENCY') < button_tray.indexOf('MOD_MP_TRANSFER_START_TRADE'));
	assert.match(button_tray, /MOD_MP_BUTTON_ADD_CURRENCY[\s\S]*state\.transfer_inventory\.length > 0/);
	assert.equal(english.MOD_MP_CURRENCY_ABYSSAL_SLAYER_COINS, 'Abyssal Slayer Coins (ASC)');
});

test('keeps non-GP currencies out of Transfer GP values', async () => {
	const [main, transfer_actions, trading_actions] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-transfer.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-trading.mjs', root), 'utf8')
	]);

	assert.match(main, /!transfer_currency_support\?\.is_transfer_currency\(game, entry\.id\)/);
	assert.match(transfer_actions, /!is_transfer_currency\(entry\.item_id\)/);
	assert.match(trading_actions, /!is_transfer_currency\(entry\.item_id\)/);
});

test('treats supported currencies as locally resolved Charitree items', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const resolution = main.slice(
		main.indexOf('function is_local_item_resolved'),
		main.indexOf('\n}\n', main.indexOf('function is_local_item_resolved')) + 2
	);

	assert.match(resolution, /transfer_currency_support\?\.is_transfer_currency\(game, item_id\) === true/);
	assert.match(resolution, /item_visibility\.is_item_resolved\(item_id/);
});

test('confirms the requested Transfer actions before sending them', async () => {
	const [source, templates, english] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse)
	]);
	const transfer_action = source.slice(source.indexOf('const TRANSFER_CONFIRMATIONS'), source.indexOf('export function install_transfer_actions'));

	assert.match(templates, /template id="template-mp-transfer-confirm-modal"/);
	assert.match(templates, /state\.confirm_transfer_action\(\$event\)/);
	assert.match(templates, /get_transfer_confirmation_info_lang_id\(\)/);
	assert.match(templates, /get_transfer_confirmation_action_lang_id\(\)/);

	for (const [action, info_lang_id, action_lang_id] of [
		['donate', 'MOD_MP_TRANSFER_CONFIRM_DONATE', 'MOD_MP_TRANSFER_CONFIRM_DONATE_ACTION'],
		['counter_trade', 'MOD_MP_TRANSFER_CONFIRM_COUNTER_TRADE', 'MOD_MP_TRANSFER_CONFIRM_COUNTER_TRADE_ACTION'],
		['cancel_trade', 'MOD_MP_TRANSFER_CONFIRM_CANCEL_TRADE', 'MOD_MP_TRANSFER_CONFIRM_CANCEL_TRADE_ACTION'],
		['cancel_haggle', 'MOD_MP_MARKET_HAGGLE_CONFIRM_CANCEL', 'MOD_MP_MARKET_HAGGLE_CONFIRM_CANCEL_ACTION'],
		['decline_gift', 'MOD_MP_TRANSFER_CONFIRM_DECLINE_GIFT', 'MOD_MP_TRANSFER_CONFIRM_DECLINE_GIFT_ACTION'],
		['decline_trade', 'MOD_MP_TRANSFER_CONFIRM_DECLINE_TRADE', 'MOD_MP_TRANSFER_CONFIRM_DECLINE_TRADE_ACTION'],
		['reject_haggle', 'MOD_MP_MARKET_HAGGLE_CONFIRM_REJECT', 'MOD_MP_MARKET_HAGGLE_CONFIRM_REJECT_ACTION']
	]) {
		assert.equal(typeof english[info_lang_id], 'string');
		assert.equal(typeof english[action_lang_id], 'string');
		assert.match(transfer_action, new RegExp(`${action}:\\s*\\{[\\s\\S]*${info_lang_id}[\\s\\S]*${action_lang_id}`));
		if (!action.endsWith('_haggle'))
			assert.match(source, new RegExp(`show_transfer_confirmation\\('${action}'`));
	}

	assert.match(source, /this\.donate_items\(event, true\)/);
	assert.match(source, /this\.counter_trade\(event, confirmation\.transfer_id, true\)/);
	assert.match(source, /this\.cancel_trade\(event, confirmation\.transfer_id, true\)/);
	assert.match(source, /this\.resolve_gift\(event, confirmation\.transfer_id, false, true\)/);
	assert.match(source, /this\.decline_trade\(event, confirmation\.transfer_id, true\)/);
	assert.match(source, /this\.respond_market_haggle\(event, confirmation\.transfer_id, 'terminate', false, true\)/);
	assert.match(source, /async donate_items\(event, confirmed = false\)[\s\S]*if \(!confirmed\)[\s\S]*show_transfer_confirmation\('donate'\)/);
	assert.match(source, /async counter_trade\(event, trade_id, confirmed = false\)[\s\S]*if \(!confirmed\)[\s\S]*show_transfer_confirmation\('counter_trade', trade_id\)/);
	assert.match(source, /async cancel_trade\(event, trade_id, confirmed = false\)[\s\S]*if \(!confirmed\)[\s\S]*show_transfer_confirmation\('cancel_trade', trade_id\)/);
	assert.match(source, /async resolve_gift\(event, gift_id, accept, confirmed = false\)[\s\S]*if \(!accept && !confirmed\)[\s\S]*show_transfer_confirmation\('decline_gift', gift_id\)/);
	assert.match(source, /async decline_trade\(event, trade_id, confirmed = false\)[\s\S]*if \(!confirmed\)[\s\S]*show_transfer_confirmation\('decline_trade', trade_id\)/);
});

test('uses six Transfer Inventory slots while preserving oversized existing inventories', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	assert.match(main, /const TRANSFER_INVENTORY_MAX_LIMIT = 6;/);

	const add_item = main.slice(
		main.indexOf('function add_item_to_transfer_inventory'),
		main.indexOf('\n}\n', main.indexOf('function add_item_to_transfer_inventory')) + 2
	);
	assert.match(add_item, /const existing_entry = state\.transfer_inventory\.find\(e => e\.id === item\.id\);/);
	assert.match(add_item, /if \(state\.transfer_inventory\.length >= TRANSFER_INVENTORY_MAX_LIMIT\)/);

	const load_inventory = main.slice(
		main.indexOf('function load_transfer_inventory'),
		main.indexOf('\n}\n', main.indexOf('function load_transfer_inventory')) + 2
	);
	assert.match(load_inventory, /state\.transfer_inventory = transfer_delivery_state\.inventory\.map/);
	assert.doesNotMatch(load_inventory, /slice\(0,\s*TRANSFER_INVENTORY_MAX_LIMIT\)/);
});

test('prioritizes actionable Transfer / Gift work in the sidebar count', async () => {
	const [main, style] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const nav_update = main.slice(
		main.indexOf('function update_transfer_inventory_nav'),
		main.indexOf('\n}\n', main.indexOf('function update_transfer_inventory_nav')) + 2
	);

	assert.match(nav_update, /const num_transfer_offers = state\.num_transfer_offers/);
	assert.match(nav_update, /const has_transfer_offers = num_transfer_offers > 0/);
	assert.match(nav_update, /const has_inbox_items = state\.inbox_items\.length > 0/);
	assert.match(nav_update, /aside\.textContent = has_transfer_offers[\s\S]*String\(num_transfer_offers\)[\s\S]*has_inbox_items \? String\(state\.inbox_items\.length\)[\s\S]*state\.transfer_inventory\.length \+ ' \/ ' \+ TRANSFER_INVENTORY_MAX_LIMIT/);
	assert.match(nav_update, /aside\.hidden = !has_transfer_offers && !has_inbox_items && !has_items/);
	assert.match(nav_update, /aside\.classList\.toggle\('mp-transfer-action-nav', has_transfer_offers\)/);
	assert.match(nav_update, /aside\.classList\.toggle\('mp-transfer-inbox-nav', !has_transfer_offers && has_inbox_items\)/);
	assert.doesNotMatch(nav_update, /text-danger/);
	assert.match(style, /\.mp-transfer-action-nav \{[\s\S]*background-color: #ff4545;/);
	assert.match(style, /\.mp-transfer-inbox-nav \{[\s\S]*background-color: orange;/);
	assert.match(main, /get num_transfer_offers\(\)[\s\S]*this\.gifts\.length \+ this\.num_attending_trades \+ this\.resolved_trades\.length/);
});

test('refreshes the Transfer / Gift sidebar count when transfer state is loaded', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const inbox_update = main.slice(
		main.indexOf('async function update_inbox'),
		main.indexOf('function reconcile_guild_member_social_modes')
	);
	const events_request = main.slice(
		main.indexOf('async function get_client_events_request'),
		main.indexOf('function start_client_event_polling')
	);
	const interface_ready = main.slice(
		main.indexOf('ctx.onInterfaceReady(() => {'),
		main.indexOf('\n\t});', main.indexOf('ctx.onInterfaceReady(() => {')) + 5
	);

	assert.match(inbox_update, /state\.inbox_items = Array\.isArray\(res\.items\)[\s\S]*update_transfer_inventory_nav\(\);/);
	assert.match(events_request, /event_snapshots\.reconcile_event_transfers\(state, res\);\s*reconcile_guild_member_social_modes\(res\.guild_member_social_modes\);\s*update_transfer_inventory_nav\(\);/);
	assert.match(interface_ready, /setup_mobile_sidebar_unread\(\);\s*update_chat_nav\(\);\s*update_transfer_inventory_nav\(\);/);
});
