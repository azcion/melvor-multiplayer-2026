import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('wires Crucible Wish phases, owner actions, and instance-scoped replay', async () => {
 const [main, actions, templates, english] = await Promise.all([
  readFile(new URL('mod/main.mjs', root), 'utf8'),
  readFile(new URL('mod/client-crucible.mjs', root), 'utf8'),
  readFile(new URL('mod/ui/templates.html', root), 'utf8'),
  readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse)
 ]);
 const page = templates.slice(templates.indexOf('<template id="template-mp-crucible-page">'), templates.indexOf('<template id="template-mp-transfer-page">'));
 assert.match(main, /pending_crucible_wish:\$\{kind\}/);
 assert.match(main, /recover_pending_crucible_wish_actions\(\)/);
 assert.match(actions, /run_pending_crucible_wish_action\(kind, `\/api\/crucible\/wish\/\$\{kind\}`/);
 for (const action of ['make', 'cancel', 'claim']) assert.ok(actions.includes(`wish_action('${action}'`));
 for (const phase of ['FORMING', 'MELDING', 'MELDED']) assert.equal(typeof english[`MOD_MP_CRUCIBLE_${phase}`], 'string');
 assert.match(actions, /wish\.formation_points/);
 assert.match(page, /wish\.progress_gp/);
 assert.match(page, /wish\.owned && wish\.phase === 'melded'/);
 assert.match(page, /state\.show_crucible_wish_modal\(\)/);
 const modal = templates.slice(templates.indexOf('<template id="template-mp-crucible-wish-modal">'), templates.indexOf('<template id="template-mp-crucible-clear-modal">'));
 assert.match(modal, /state\.filtered_crucible_wish_items/);
 assert.match(modal, /state\.crucible_make_wish\(\$event\)/);
});

test('hides Charitree offerings, wishes, and Wish choices from unowned official DLC', async () => {
	const [main, actions] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-market-charity.mjs', root), 'utf8')
	]);
	const request = main.slice(
		main.indexOf('async function request_charity_tree_contents'),
		main.indexOf('\nfunction update_charity_clock')
	);

	assert.match(request, /filter_local_available_items\(res\.items, item => item\.id\)/);
	assert.match(request, /state\.charity_wishes = item_visibility\.filter_items_for_owned_dlc\([\s\S]*wish => wish\.item_id[\s\S]*owned_dlc_namespaces/);
	assert.match(request, /state\.charity_wish_catalog = item_visibility\.filter_items_for_owned_dlc\([\s\S]*item => item\.id[\s\S]*owned_dlc_namespaces/);
	assert.match(actions, /async resolve_charity_wish\(event, action, confirmed = false\)[\s\S]*!is_local_item_available\(wish\?\.item_id\)/);
	assert.match(actions, /async make_charity_wish\(event\)[\s\S]*!is_local_item_available\(state\.charity_wish_item_id\)/);
	assert.match(actions, /async charity_take_item\(event\)[\s\S]*!is_local_item_available\(item\.id\)/);
});
