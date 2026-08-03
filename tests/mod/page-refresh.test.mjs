import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

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

test('keeps returned assets accessible from Transfer while Guildless', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const transfer_page = templates.slice(
		templates.indexOf('<template id="template-mp-transfer-page">')
	);

	assert.match(transfer_page, /id="mp-transfer-page">\s*<div>/);
	assert.doesNotMatch(transfer_page, /mp-guild-locked/);
	assert.match(transfer_page, /MOD_MP_TRANSFER_GUILDLESS_INFO/);
	assert.match(transfer_page, /v-if="state\.is_guild_member && !state\.has_destroyable_transfer_items" @click="state\.create_trade\(\)"/);
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
