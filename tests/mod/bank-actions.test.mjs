import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('replaces inline bank multiplayer panels with the single actions entry', async () => {
	const [main, templates, styles] = await Promise.all([
		read_client_source(root),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8')
	]);

	assert.match(templates, /template-mp-bank-actions-container/);
	assert.match(templates, /MOD_MP_BANK_ACTIONS_TITLE/);
	assert.match(templates, /@click="state\.show_bank_actions_modal\(\)"/);
	assert.match(templates, /template-mp-bank-actions-modal/);
	assert.match(templates, /MOD_MP_BANK_ACTION_TRANSFER/);
	assert.match(templates, /MOD_MP_BANK_ACTION_MARKET/);
	assert.match(templates, /MOD_MP_BANK_ACTION_CRUCIBLE/);
	assert.match(templates, /class="btn mp-actions-outbox"[\s\S]*MOD_MP_BANK_ACTION_TRANSFER/);
	assert.match(templates, /class="btn mp-actions-marketplace"[\s\S]*MOD_MP_BANK_ACTION_MARKET/);
	assert.match(templates, /class="btn mp-actions-crucible"[\s\S]*MOD_MP_BANK_ACTION_CRUCIBLE">Cast into Crucible<\/lang-string>/);
	assert.match(templates, /mp-item-slider/);
	assert.match(templates, /MOD_MP_ITEM_OWNED/);
	assert.match(templates, /MOD_MP_BANK_ACTION_ITEM_VALUE/);
	assert.match(templates, /@click="state\.set_bank_action_mode\(''\)"/);
	assert.doesNotMatch(templates, /template-mp-bank-market-container|template-mp-bank-container/);

	assert.match(main, /function patch_bank_actions\(\)/);
	assert.match(main, /patch_bank_actions\(\);/);
	assert.match(main, /game\.bank\.selectedBankItem\?\.item/);
	assert.match(main, /insertBefore\(\$actions_panel, \$sell_panel\)/);
	assert.match(main, /run_pending_economy_action\('bank_crucible_cast:/);
	assert.match(main, /items: \[\{ id: item\.id, qty, \.\.\.get_charity_item_valuation\(item\.id\) \}\],\n\s+source: 'bank'/);
	assert.match(main, /api_post\('\/api\/market\/sell'/);
	assert.match(main, /add_item_to_transfer_inventory\(item, qty\)/);
	assert.match(styles, /\.mp-bank-actions-entry \{/);
	assert.match(styles, /\.mp-bank-actions-entry > img \{[\s\S]*width: 32px;[\s\S]*height: 32px;/);
	assert.match(styles, /\.mp-bank-actions-entry \{[\s\S]*margin-bottom: 6px;/);
	assert.doesNotMatch(styles, /\.mp-bank-actions-modal-popup \{[\s\S]*width: min\(732px/);
	assert.doesNotMatch(styles, /\.mp-bank-actions-modal-popup \{[\s\S]*padding: 20px 26px 28px/);
	assert.match(styles, /\.mp-bank-actions-choices \{[\s\S]*flex-direction: column/);
	assert.match(styles, /\.mp-actions-crucible \{[\s\S]*background: #b42b00;[\s\S]*color: white;/);
	assert.match(styles, /\.mp-actions-marketplace \{[\s\S]*background: #b96349;[\s\S]*color: white;/);
	assert.match(styles, /\.mp-actions-outbox \{[\s\S]*background: #1892ca;[\s\S]*color: white;/);
});

test('preserves the selected quantity when a bank stack updates', async () => {
	const main = await read_client_source(root);
	const quantity_hook = main.slice(
		main.indexOf('const orig_update_item_quantity'),
		main.indexOf('const orig_set_item')
	);
	const selection_hook = main.slice(
		main.indexOf('const orig_set_item'),
		main.indexOf('// detect data page open')
	);
	const bank_actions = main.slice(
		main.indexOf('function patch_bank_actions'),
		main.indexOf('// detect data page open')
	);

	assert.doesNotMatch(quantity_hook, /state\.item_slider_value\s*=\s*1/);
	assert.match(selection_hook, /reset_bank_action_item\.call\(this, orig_set_item, \.\.\.args\)/);
	assert.match(bank_actions, /function reset_bank_action_item[\s\S]*state\.item_slider_value\s*=\s*1/);
});
