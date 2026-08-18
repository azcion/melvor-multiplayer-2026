import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { apply_gift_content_state } from '../../mod/gift-contents.mjs';

test('represents unsupported returned Gifts without exposing unavailable items', () => {
	const ordinary = { id: 1, data: null };
	const returned = { id: 2, data: null };
	const supported = { id: 3, data: null };
	const ordinary_data = { flags: 0, items: [{ item_id: 'missing:item', qty: 1 }] };
	const returned_data = { flags: 1, items: [{ item_id: 'missing:item', qty: 2 }] };
	const supported_data = { flags: 1, items: [{ item_id: 'melvorD:Coal_Ore', qty: 3 }] };

	assert.equal(apply_gift_content_state(ordinary, ordinary_data, true), 'return');
	assert.equal(ordinary.data, null);
	assert.equal(ordinary.unresolved, false);
	assert.equal(apply_gift_content_state(returned, returned_data, true), 'discard');
	assert.equal(returned.data, returned_data);
	assert.equal(returned.unresolved, true);
	assert.equal(apply_gift_content_state(supported, supported_data, false), 'ready');
	assert.equal(supported.data, supported_data);
	assert.equal(supported.unresolved, false);
});

test('wires unsupported returned Gifts to a confirmed replay-safe discard action', async () => {
	const [main, templates] = await Promise.all([
		readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8')
	]);
	const action = main.slice(
		main.indexOf('show_discard_returned_gift_confirmation'),
		main.indexOf('async gift_friend')
	);

	assert.match(action, /unsupported_returned_gift_command_id = crypto\.randomUUID\(\)/);
	assert.match(action, /api_post\('\/api\/gift\/discard', \{ gift_id, command_id \}\)/);
	assert.match(action, /reconcile_economy_receipts\(\[res\.receipt\]\)/);
	assert.match(templates, /template-mp-discard-returned-gift-modal/);
	assert.match(templates, /v-if="gift\.unresolved"/);
	assert.match(templates, /show_discard_returned_gift_confirmation\(gift\.id\)/);
});

test('renders failed Gift sends in the confirm modal', async () => {
	const [main, templates] = await Promise.all([
		readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8'),
		readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8')
	]);
	const confirm_action = main.slice(
		main.indexOf('async confirm_gift'),
		main.indexOf('// #endregion', main.indexOf('async confirm_gift'))
	);
	const confirm_template_start = templates.indexOf('<template id="template-mp-confirm-gift-recipient-modal">');
	const confirm_template = templates.slice(
		confirm_template_start,
		templates.indexOf('</template>', confirm_template_start)
	);

	assert.match(confirm_action, /if \(res\.error_lang\)/);
	assert.match(confirm_action, /show_modal_error\(getLangString\(e\.message\)\)/);
	assert.match(confirm_template, /id="mp-modal-error"/);
});
