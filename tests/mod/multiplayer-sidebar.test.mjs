import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { load_sidebar_function, read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

function load_nav_updater(main) {
	return load_sidebar_function(main, 'update_multiplayer_nav',
		['sidebar', 'state', 'update_charitree_nav', 'getLangString', 'document', 'update_expedition_nav = () => {}']);
}

function make_sidebar() {
	const items = new Map();
	const make_aside = () => ({ textContent: '', classList: {
		toggle(class_name, enabled) {
			this[class_name] = enabled;
		},
		contains(class_name) {
			return this[class_name] === true;
		}
	} });
	const guild_aside = make_aside();
	const charity_aside = make_aside();
	const category = {
		item(page_id) {
			if (!items.has(page_id)) {
				const classes = new Set();
				items.set(page_id, {
					rootEl: { classList: {
						toggle(class_name, hidden) {
							if (hidden)
								classes.add(class_name);
							else
								classes.delete(class_name);
						},
						contains: class_name => classes.has(class_name)
					} }
				});
			}
			return items.get(page_id);
		}
	};
	return {
		sidebar: { category: () => category },
		document: { querySelector: selector => selector === '.mp-guild-nav' ? guild_aside
			: selector === '.mp-crucible-nav' ? charity_aside : null },
		guild_aside,
		charity_aside,
		toggle: expanded => {
			for (const item of items.values())
				item.rootEl.classList.toggle('d-none', !expanded);
		},
		is_hidden: page_id => ['d-none', 'mp-nav-unavailable'].some(name =>
			items.get(page_id)?.rootEl.classList.contains(name))
	};
}

test('updates guild-dependent Multiplayer sidebar entries without rebuilding the sidebar', async () => {
	const main = await read_client_source(root);
	const load = load_nav_updater(main);
	const sidebar = make_sidebar();
	let charitree_updates = 0;
	const update_multiplayer_nav = load(
		sidebar.sidebar,
		{ is_guild_member: false, guild_state_loaded: true, has_transfer_access: false },
		() => charitree_updates++,
		() => 'start here',
		sidebar.document
	);

	update_multiplayer_nav();
	assert.equal(sidebar.guild_aside.textContent, 'start here');
	for (const page_id of ['Multiplayer_Market', 'Expedition', 'Guild_Raid', 'Transfer_Items'])
		assert.equal(sidebar.is_hidden('multiplayer:' + page_id), true);
	assert.equal(charitree_updates, 1);

	const member_sidebar = make_sidebar();
	const member_update = load(
		member_sidebar.sidebar,
		{ is_guild_member: true, guild_state_loaded: true, is_social_only: false, has_transfer_access: true,
			account_tags: ['expedition-tester'] },
		() => {},
		() => 'start here',
		member_sidebar.document
	);
	member_update();
	assert.equal(member_sidebar.guild_aside.textContent, '');
	for (const page_id of ['Multiplayer_Market', 'Expedition', 'Guild_Raid', 'Transfer_Items'])
		assert.equal(member_sidebar.is_hidden('multiplayer:' + page_id), false);
});

test('keeps Expedition and Raid visible but hides exchange sections in Social Only mode', async () => {
	const sidebar = make_sidebar();
	const update_multiplayer_nav = load_nav_updater(await read_client_source(root))(
		sidebar.sidebar,
		{ is_guild_member: true, is_social_only: true, has_transfer_access: false,
			account_tags: [] },
		() => {},
		() => 'start here',
		sidebar.document
	);

	update_multiplayer_nav();
	assert.equal(sidebar.is_hidden('multiplayer:Multiplayer_Market'), true);
	assert.equal(sidebar.is_hidden('multiplayer:Expedition'), false);
	assert.equal(sidebar.is_hidden('multiplayer:Guild_Raid'), false);
	assert.equal(sidebar.is_hidden('multiplayer:Transfer_Items'), true);
});

test('opens the 1.6.2 Expedition preview regardless of tester tags while preserving Guild and support gates', async () => {
	const sidebar = make_sidebar();
	const state = { is_guild_member: true, is_social_only: false, has_transfer_access: true, account_tags: [] };
	const update = load_nav_updater(await read_client_source(root))(
		sidebar.sidebar, state, () => {}, () => 'start here', sidebar.document);
	update();
	assert.equal(sidebar.is_hidden('multiplayer:Expedition'), false);
	assert.equal(sidebar.is_hidden('multiplayer:Guild_Raid'), false);
	state.account_tags = ['expedition-tester'];
	update();
	assert.equal(sidebar.is_hidden('multiplayer:Expedition'), false);
	state.account_tags = [];
	update();
	assert.equal(sidebar.is_hidden('multiplayer:Expedition'), false);
	state.is_guild_member = false;
	update();
	assert.equal(sidebar.is_hidden('multiplayer:Expedition'), true);
	state.is_guild_member = true;
	state.multiplayer_unsupported = true;
	update();
	assert.equal(sidebar.is_hidden('multiplayer:Expedition'), true);
});

test('preserves feature gates across native expansion and collapse across state refreshes', async () => {
	const main = await read_client_source(root);
	const sidebar = make_sidebar();
	const state = { is_guild_member: true, is_social_only: true, has_transfer_access: false,
		is_charitree_enabled: false, account_tags: ['expedition-tester'] };
	const update_charitree_nav = load_sidebar_function(main, 'update_charitree_nav',
		['sidebar', 'state', 'document', 'getLangString'])(
			sidebar.sidebar, state, sidebar.document, value => value);
	const update = load_nav_updater(main)(sidebar.sidebar, state, update_charitree_nav, value => value, sidebar.document);
	const gated = ['Multiplayer_Market', 'Crucible', 'Transfer_Items'];
	update();
	sidebar.toggle(true);
	for (const page of gated)
		assert.equal(sidebar.is_hidden('multiplayer:' + page), true, page);
	assert.equal(sidebar.is_hidden('multiplayer:Guild_Raid'), false);
	sidebar.toggle(false);
	Object.assign(state, { is_social_only: false, has_transfer_access: true, is_charitree_enabled: true });
	update();
	for (const page of [...gated, 'Guild_Raid'])
		assert.equal(sidebar.is_hidden('multiplayer:' + page), true, page);
	sidebar.toggle(true);
	for (const page of [...gated, 'Guild_Raid'])
		assert.equal(sidebar.is_hidden('multiplayer:' + page), false, page);
	const style = await readFile(new URL('mod/ui/style.css', root), 'utf8');
	assert.match(style, /\.nav-main-item\.mp-nav-unavailable\s*\{\s*display: none !important;/);
});

test('prioritizes a Melded Crucible Wish over Reclaim readiness', async () => {
 const main = await read_client_source(root);
 const sidebar = make_sidebar();
 const state = { guild_state_loaded: true, is_guild_member: true, is_social_only: false,
  crucible: { is_open: true, next_reclaim_at: 0, wishes: [{ phase: 'melded', owned: true }] } };
 const update = load_sidebar_function(main, 'update_charitree_nav',
  ['sidebar', 'state', 'document', 'getLangString'])(
   sidebar.sidebar, state, sidebar.document, value => value);
 update();
 assert.equal(sidebar.charity_aside.textContent, 'MOD_MP_CRUCIBLE_WISH_READY');
 assert.equal(sidebar.charity_aside.classList.contains('mp-nav-ready'), true);
 state.crucible.wishes = [];
 update();
 assert.equal(sidebar.charity_aside.textContent, 'MOD_MP_CRUCIBLE_RECLAIM');
 state.crucible.next_reclaim_at = Date.now() + 60_000;
 update();
 assert.equal(sidebar.charity_aside.textContent, '');
});

test('shows Transfers for Social Only only when the settled Inbox has content', async () => {
	const sidebar = make_sidebar();
	const update_multiplayer_nav = load_nav_updater(await read_client_source(root))(
		sidebar.sidebar,
		{ is_guild_member: true, is_social_only: true, has_transfer_access: true },
		() => {},
		() => 'start here',
		sidebar.document
	);

	update_multiplayer_nav();
	assert.equal(sidebar.is_hidden('multiplayer:Transfer_Items'), false);
});

test('shows a localized Guild onboarding badge only while Guildless', async () => {
	const [main, style, data_text, english, chinese] = await Promise.all([
		read_client_source(root),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data.json', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/lang/zh-CN.json', root), 'utf8').then(JSON.parse)
	]);
	const guild_page = JSON.parse(data_text).data.pages.find(page => page.id === 'Guild');

	assert.equal(guild_page.sidebarItem.asideClass, 'badge mp-guild-nav');
	assert.equal(guild_page.sidebarItem.aside, 'start here');
	assert.equal(guild_page.sidebarItem.asideLangID, 'MOD_MP_SIDEBAR_GUILD_START');
	assert.equal(english.MOD_MP_SIDEBAR_GUILD_START, 'start here');
	assert.equal(chinese.MOD_MP_SIDEBAR_GUILD_START, '从这里开始');
	assert.match(main, /const guild_aside = document\.querySelector\('\.mp-guild-nav'\);[\s\S]*const ready = state\.guild_state_loaded;[\s\S]*set_nav_ready\(guild_aside, ready\);[\s\S]*MOD_MP_SIDEBAR_GUILD_START/);
	assert.match(style, /\.mp-guild-nav \{[\s\S]*background: #179cd8;/);
	assert.match(style, /\.mp-guild-nav:empty \{[\s\S]*display: none;/);
	assert.match(style, /\.mp-guild-nav:not\(\.mp-nav-ready\),[\s\S]*\.mp-updates-nav:not\(\.mp-nav-ready\) \{[\s\S]*display: none;/);
});

test('retains native content bottom padding on every Multiplayer page', async () => {
	const [data, style, templates] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8')
	]);
	const multiplayer_pages = data.data.pages.filter(page => page.containerID?.startsWith('mp-'));

	assert.equal(multiplayer_pages.length, 8);
	for (const page of multiplayer_pages) {
		const page_id = page.containerID;
		assert.match(templates, new RegExp(`<div class="content d-none" id="${page_id}">`));
		assert.doesNotMatch(style, new RegExp(`#${page_id}[\\s\\S]*?\\{\\n\\tpadding-bottom: 0 !important;\\n\\}`));
	}
});

test('places the guild-only Expedition entry between Charitree and Raid', async () => {
	const data = await readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse);
	const pages = data.data.pages.filter(page => page.sidebarItem?.categoryID === 'Multiplayer');
	const page_ids = pages.map(page => page.id);
	const expedition = pages.find(page => page.id === 'Expedition');

	assert.equal(page_ids.indexOf('Expedition'), page_ids.indexOf('Crucible') + 1);
	assert.equal(page_ids.indexOf('Guild_Raid'), page_ids.indexOf('Expedition') + 1);
	assert.equal(expedition.media, 'assets/expedition-nav.png');
	assert.equal(expedition.sidebarItem.icon, 'assets/expedition-nav.png');
});

test('keeps Transfer Items visible for guildless unresolved exchange state', async () => {
	const main = await read_client_source(root);
	const sidebar = make_sidebar();
	const update_multiplayer_nav = load_nav_updater(main)(
		sidebar.sidebar,
		{ is_guild_member: false, has_transfer_access: true },
		() => {},
		() => 'start here',
		sidebar.document
	);

	update_multiplayer_nav();
	assert.equal(sidebar.is_hidden('multiplayer:Transfer_Items'), false);
	assert.equal(sidebar.is_hidden('multiplayer:Multiplayer_Market'), true);
	assert.match(main, /this\.trades\.length > 0 \\|\\| this\.resolved_trades\.length > 0/);
});

test('refreshes sidebar visibility after guild and exchange state changes', async () => {
	const main = await read_client_source(root);
	const events_request = main.slice(
		main.indexOf('async function get_client_events_request'),
		main.indexOf('function start_client_event_polling')
	);
	assert.match(main, /state\.events\.guild_applicants = state\.guild_applicants;\s*update_multiplayer_nav\(\);/);
	assert.match(events_request, /event_snapshots\.reconcile_event_transfers\(state, res\);/);
	assert.match(events_request, /reconcile_guild_member_social_modes\(res\.guild_member_social_modes\);/);
	assert.match(events_request, /update_transfer_inventory_nav\(\);/);
	assert.match(events_request, /update_multiplayer_nav\(\);/);
	assert.match(main, /update_chat_nav\(\);\s*update_transfer_inventory_nav\(\);\s*update_multiplayer_nav\(\);/);
});
