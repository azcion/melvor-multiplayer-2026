import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function load_page_toggle(initially_hidden) {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const function_start = main.indexOf('function on_page_toggle');
	const function_source = main.slice(function_start, main.indexOf('\n// #endregion', function_start));
	const element = {
		classList: {
			contains: class_name => class_name === 'd-none' && initially_hidden.value
		}
	};
	let mutation_callback;
	let observed_element;
	let observed_options;
	class FakeMutationObserver {
		constructor(callback) {
			mutation_callback = callback;
		}

		observe(target, options) {
			observed_element = target;
			observed_options = options;
		}
	}
	const on_page_toggle = new Function('$', 'MutationObserver', `
		${function_source}
		return on_page_toggle;
	`)(() => element, FakeMutationObserver);

	return {
		on_page_toggle,
		trigger_mutation: () => mutation_callback(),
		observation: () => ({ element: observed_element, options: observed_options }),
		element
	};
}

test('runs a two-way page callback once per actual visibility transition', async () => {
	const initially_hidden = { value: true };
	const harness = await load_page_toggle(initially_hidden);
	const visibility_changes = [];
	harness.on_page_toggle('page', is_visible => visibility_changes.push(is_visible), false);

	harness.trigger_mutation();
	initially_hidden.value = false;
	harness.trigger_mutation();
	harness.trigger_mutation();
	initially_hidden.value = true;
	harness.trigger_mutation();
	harness.trigger_mutation();

	assert.deepEqual(visibility_changes, [true, false]);
	assert.equal(harness.observation().element, harness.element);
	assert.deepEqual(harness.observation().options, {
		attributes: true,
		attributeFilter: ['class']
	});
});

test('runs a visible-only page callback once when the page opens', async () => {
	const initially_hidden = { value: true };
	const harness = await load_page_toggle(initially_hidden);
	const visibility_changes = [];
	harness.on_page_toggle('page', is_visible => visibility_changes.push(is_visible), true);

	initially_hidden.value = false;
	harness.trigger_mutation();
	harness.trigger_mutation();
	initially_hidden.value = true;
	harness.trigger_mutation();
	harness.trigger_mutation();

	assert.deepEqual(visibility_changes, [true]);
});

test('keeps reactive Guild state off Melvor page visibility containers', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');

	for (const page of ['market', 'campaign', 'charity']) {
		const page_root = new RegExp(
			`<div class="content d-none" id="mp-${page}-page">\\s*` +
			`<div :class="\\{ 'mp-guild-locked': !state\\.is_guild_member \\}">`
		);

		assert.match(templates, page_root);
	}
});

test('mounts each Multiplayer page in one isolated Petite Vue scope', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const scoped_mount = main.slice(main.indexOf('function make_scoped_template'), main.indexOf('function mount_modal_template'));
	const interface_setup = main.slice(main.indexOf('ctx.onInterfaceReady'), main.indexOf("on_page_toggle('mp-guild-page'"));

	assert.match(scoped_mount, /document\.createElement\('div'\)/);
	assert.match(scoped_mount, /data-mp-template-scope/);
	assert.match(scoped_mount, /make_template\(id, host\)/);
	assert.match(interface_setup, /make_scoped_template\(page \+ '-page', \$main_container\)/);
	assert.doesNotMatch(interface_setup, /make_template\(page \+ '-page', \$main_container\)/);
});

test('keeps returned assets accessible from Transfer while Guildless', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const transfer_page = templates.slice(
		templates.indexOf('<template id="template-mp-transfer-page">')
	);

	assert.match(transfer_page, /id="mp-transfer-page">\s*<div>/);
	assert.doesNotMatch(transfer_page, /mp-guild-locked/);
	assert.match(transfer_page, /MOD_MP_TRANSFER_GUILDLESS_INFO/);
	assert.match(transfer_page, /v-show="state\.is_guild_member && !state\.has_destroyable_transfer_items" @click="state\.create_trade\(\)"/);
	assert.match(transfer_page, /@click="state\.transfer_return_selected\(\)"/);
	assert.match(transfer_page, /@click="state\.transfer_return_all\(\)"/);
});

test('keeps unresolved owned listings visible only as destroyable placeholders', async () => {
	const main = await readFile(new URL('mod/main.mjs', root), 'utf8');
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const market_page = templates.slice(
		templates.indexOf('<template id="template-mp-market-page">'),
		templates.indexOf('<template id="template-mp-charity-page">')
	);

	assert.match(main, /unresolved: !is_local_item_resolved\(item\.item_id\)/);
	assert.match(market_page, /v-if="item\.unresolved"/);
	assert.match(market_page, /resolve_market_listing\(\$event, item, 'destroy'\)/);
	assert.match(templates, /state\.selected_transfer_item_is_destroyable/);
	assert.match(templates, /state\.transfer_destroy_selected\(\)/);
});

test('adds non-draggable item tooltips to resolved Marketplace icons', async () => {
	const [main, templates, style] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8')
	]);
	const market_page = templates.slice(
		templates.indexOf('<template id="template-mp-market-page">'),
		templates.indexOf('<template id="template-mp-charity-page">')
	);
	const item_tooltip = main.slice(
		main.indexOf('class MPItemIcon'),
		main.indexOf('class MPEquipmentItem')
	);

	assert.equal((market_page.match(/<mp-item-icon/g) ?? []).length, 4);
	assert.equal((market_page.match(/draggable="false"/g) ?? []).length, 5);
	assert.match(market_page, /mp-item-icon v-if="!item\.unresolved"/);
	assert.match(market_page, /<img v-else class="mp-market-item-icon/);
	assert.match(item_tooltip, /touch: 'hold'/);
	assert.match(item_tooltip, /createItemInformationTooltip\(this\.item\)/);
	assert.match(item_tooltip, /disconnectedCallback\(\) \{\s*this\.tooltip\?\.destroy\(\);/);
	assert.match(style, /#mp-market-page mp-item-icon img,[\s\S]*-webkit-user-drag: none;[\s\S]*user-select: none;/);
});
