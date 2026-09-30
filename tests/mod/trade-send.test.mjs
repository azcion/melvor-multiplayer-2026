import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

test('renders failed Trade sends in the recipient modal', async () => {
	const [main, templates] = await Promise.all([
		read_client_source(),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8')
	]);
	const select_action = main.slice(
		main.indexOf('async select_trade_recipient'),
		main.indexOf('get_trade_items_value')
	);
	const create_template_start = templates.indexOf('<template id="template-mp-create-trade-modal">');
	const create_template = templates.slice(
		create_template_start,
		templates.indexOf('</template>', create_template_start)
	);

	assert.match(select_action, /show_modal_error\(getLangString\(res\?\.error_lang \?\? 'MOD_MP_GENERIC_ERR'\)\)/);
	assert.match(select_action, /is_button_spinning\(\$button\)/);
	assert.match(select_action, /show_button_spinner\(\$button\)/);
	assert.match(select_action, /this\.close_modal\(\)/);
	assert.match(create_template, /id="mp-modal-error"/);
	assert.match(create_template, /state\.select_trade_recipient\(\$event, recipient\)/);
});

test('journals modern Trade cancellation and decline before refreshing Inbox state', async () => {
	const main = await read_client_source();
	const actions = main.slice(main.indexOf('async decline_trade'), main.indexOf('// #endregion', main.indexOf('async cancel_trade')));

	assert.match(actions, /api_post\('\/api\/trade\/decline', \{ trade_id, command_id: crypto\.randomUUID\(\) \}\)/);
	assert.match(actions, /api_post\('\/api\/trade\/cancel', \{ trade_id, command_id: crypto\.randomUUID\(\) \}\)/);
	assert.equal((actions.match(/res\.receipt === undefined \|\| await reconcile_economy_receipts/g) ?? []).length, 2);
});
