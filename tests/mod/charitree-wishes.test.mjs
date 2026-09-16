import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('wires Wish creation, presentation, owner actions, and Inbox naming', async () => {
	const [main, actions, templates, style, english, chinese] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-market-campaign-charity.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/lang/zh-CN.json', root), 'utf8').then(JSON.parse)
	]);
	assert.match(main, /pending_charity_wish:\$\{kind\}/);
	assert.match(main, /function is_charity_wish_endpoint\(endpoint\)[\s\S]*charity\/wish\/make[\s\S]*charity\/wish\/forsake[\s\S]*charity\/wish\/pick/);
	assert.match(main, /run_pending_charity_wish_action\(kind, endpoint, payload = \{\}\)[\s\S]*api_post_without_economy_journal\(pending\.endpoint, pending\.payload\)/);
	assert.match(main, /async function api_post_without_economy_journal\(endpoint, payload, major = selected_api_major\)[\s\S]*api_post_response_raw\(endpoint, payload, session_token, major\)/);
	assert.match(main, /const pending_economy_command = get_instance_storage_item\(storage_key\);[\s\S]*is_charity_wish_endpoint\(pending_economy_command\?\.endpoint\)[\s\S]*remove_instance_storage_item\(storage_key\)/);
	assert.match(main, /charity_wish_progress_percentage\(wish\)/);
	assert.match(main, /charity_filter_wishes: false/);
	assert.match(main, /get charity_tree_entries\(\) \{[\s\S]*const wishes = this\.charity_filter_wishes[\s\S]*this\.charity_wishes\.filter\(wish => wish\.owned === true\)[\s\S]*wishes\.map\(wish/);
	assert.match(actions, /\/api\/charity\/wish\/make/);
	assert.match(actions, /\/api\/charity\/wish\/\$\{action\}/);
	assert.match(actions, /toggle_charity_wish_filter\(\) \{[\s\S]*state\.charity_filter_wishes = !state\.charity_filter_wishes[\s\S]*wish\.owned === true/);
	assert.match(actions, /async resolve_charity_wish\(event, action, confirmed = false\)[\s\S]*action === 'forsake' && !confirmed[\s\S]*show_charity_wish_forsake_confirmation/);
	assert.match(actions, /confirm_charity_wish_forsake\(event\)[\s\S]*resolve_charity_wish\(event, 'forsake', true\)/);
	assert.match(templates, /template-mp-charity-wish-modal/);
	assert.match(templates, /template-mp-charity-wish-forsake-confirm-modal/);
	assert.match(templates, /state\.confirm_charity_wish_forsake\(\$event\)/);
	assert.match(templates, /class="mp-charity-wish-grid/);
	assert.match(templates, /class="mp-charity-wish-grid[^"]*"[^>]*@touchmove="state\.stop_icon_scroll_propagation\(\$event\)"/);
	assert.match(templates, /state\.filtered_charity_wish_items/);
	assert.match(templates, /:placeholder="getLangString\('MOD_MP_CHARITY_WISH_SEARCH'\)"/);
	assert.match(templates, /state\.adjust_charity_wish_qty\(-1\)/);
	assert.match(templates, /state\.adjust_charity_wish_qty\(1\)/);
	assert.doesNotMatch(templates, /for="mp-charity-wish-item"/);
	assert.match(templates, /MOD_MP_CHARITY_WISH_ELIGIBLE_ITEMS/);
	assert.match(templates, /MOD_MP_CHARITY_WISH_MAKE[\s\S]*MOD_MP_CHARITY_WISH_FILTER/);
	assert.match(templates, /:aria-pressed="state\.charity_filter_wishes" @click="state\.toggle_charity_wish_filter\(\)"[^>]*><lang-string lang-id="MOD_MP_CHARITY_WISH_FILTER"><\/lang-string>/);
	assert.match(templates, /<p class="mp-charity-wish-intro"><lang-string lang-id="MOD_MP_CHARITY_WISH_INTRO"><\/lang-string><\/p>/);
	assert.doesNotMatch(templates, /MOD_MP_CHARITY_WISH_SHUFFLE_PENALTY/);
	assert.match(templates, /id="mp-charity-wish-qty-label" for="mp-charity-wish-qty"/);
	assert.match(templates, /mp-charitree-wisher-label[\s\S]*MOD_MP_CHARITY_WISH_WISHER[\s\S]*mp-charitree-wisher-value/);
	assert.match(templates, /mp-charitree-take-label[\s\S]*MOD_MP_CHARITY_TAKE_AMOUNT[\s\S]*mp-charitree-take-value/);
	assert.match(templates, /mp-charitree-wish-progress-text/);
	assert.doesNotMatch(templates, /MOD_MP_CHARITY_WISH_OPENABLE|Openable|openable/);
	assert.match(templates, /state\.charity_wish_item_name/);
	assert.match(templates, /class="mp-charity-wish-requirement"/);
	assert.match(templates, /draggable="false"/);
	assert.match(templates, /item\.phase === 'ripening'/);
	assert.match(templates, /item\.phase === 'ripe'/);
	assert.match(templates, /state\.selected_charity_wish\?\.wisher/);
	assert.match(templates, /state\.selected_charity_wish\?\.owned/);
	assert.match(templates, /state\.selected_charity_wish\?\.phase !== undefined/);
	assert.equal((templates.match(/class="mp-charitree-avatars"/g) ?? []).length, 4);
	assert.match(templates, /item\.contributors\?\.length[\s\S]*state\.get_avatar_icon\(contributor\.icon_id\)[\s\S]*class="mp-charitree-avatar"/);
	assert.match(templates, /formatNumber\(state\.selected_charity_wish\?\.progress_gp \?\? 0\)/);
	assert.match(templates, /formatNumber\(state\.selected_charity_wish\?\.required_gp \?\? 0\)/);
	assert.match(templates, /role="status"[\s\S]*MOD_MP_CHARITY_WISH_FORSAKE/);
	assert.match(templates, /role="status"[\s\S]*MOD_MP_CHARITY_WISH_PICK/);
	assert.match(main, /!wish \|\| wish\.phase === 'ripe'/);
	assert.match(style, /\.mp-charitree-wish-ripe/);
	assert.match(style, /#mp-charity-wish-search\s*\{[\s\S]*outline: 1px solid;/);
	assert.match(style, /\.mp-charity-wish-grid\s*\{[\s\S]*max-height: min\(420px, 30vh\);[\s\S]*border: 1px solid #fff5;[\s\S]*border-radius: \.25rem;/);
	assert.match(style, /\.mp-charity-wish-grid\s*\{[\s\S]*overflow-y: scroll;[\s\S]*-webkit-overflow-scrolling: touch;[\s\S]*touch-action: pan-y;[\s\S]*overscroll-behavior-y: contain;/);
	assert.match(style, /\.mp-charity-wish-requirement\s*\{[\s\S]*margin-bottom: 0;/);
	assert.match(style, /\.mp-charity-wish-intro\s*\{[\s\S]*margin-bottom: 0;/);
	assert.match(style, /\.mp-charity-wish-quantity\s*\{[\s\S]*grid-template-columns: 36px minmax\(0, 1fr\) 36px;[\s\S]*height: 50px;[\s\S]*width: 180px;[\s\S]*margin: 0 auto;/);
	assert.match(style, /\.mp-charity-wish-quantity-button\s*\{[\s\S]*font-size: 1\.5rem;/);
	assert.match(style, /\.mp-charitree-wish\s*\{[\s\S]*border-radius: 6\.5px;[\s\S]*outline: 2px solid rgb\(252, 231, 152\);[\s\S]*box-shadow: 0 0 8px 2px rgb\(252 231 152 \/ 75%\);/);
	assert.match(style, /\.mp-charitree-item \.mp-charitree-avatars\s*\{[\s\S]*all: unset;[\s\S]*right: -2px;[\s\S]*top: -2px;[\s\S]*flex-direction: column;/);
	assert.match(style, /\.mp-charitree-avatar\s*\{[\s\S]*width: 20px;[\s\S]*height: 20px;[\s\S]*border-radius: 4px;/);
	assert.match(style, /\.mp-charitree-avatar:nth-child\(2\)[\s\S]*width: 17px;[\s\S]*height: 17px;/);
	assert.match(style, /\.mp-charitree-avatar:nth-child\(3\)[\s\S]*width: 14px;[\s\S]*height: 14px;/);
	assert.match(style, /\.mp-charitree-take-label[\s\S]*color: #adb5bd;/);
	assert.match(style, /\.mp-charitree-take-value[\s\S]*color: #fff;/);
	assert.doesNotMatch(style, /\.mp-charitree-take-amount\s*\{[\s\S]*font-size: 0\.9rem/);
	assert.match(style, /\.mp-charity-wish-quantity-input::-webkit-inner-spin-button/);
	assert.equal(english.MOD_MP_INBOX_SOURCE_WISH_GRANTED, 'Wish Granted');
	assert.equal(english.MOD_MP_SIDEBAR_CHARITY_WISH, 'wish');
	assert.equal(english.MOD_MP_SIDEBAR_CHARITY_PICK, 'pick');
	assert.equal(english.MOD_MP_CHARITY_WISH_INTRO, 'Place a Wish upon the Charitree. It matures for four days, then ripens by absorbing the value of decayed offerings.');
	assert.equal(english.MOD_MP_CHARITY_WISH_SEARCH, 'Search');
	assert.equal(english.MOD_MP_CHARITY_WISH_QUANTITY, 'Quantity (up to 100)');
	assert.equal(english.MOD_MP_CHARITY_WISH_INVALID, 'Choose an eligible item and a quantity from 1 to 100.');
	assert.equal(english.MOD_MP_CHARITY_WISH_MATURES_IN, '%s');
	assert.equal(english.MOD_MP_CHARITY_TAKE_AMOUNT, 'Claiming:');
	assert.equal(english.MOD_MP_CHARITY_WISH_WISHER, 'Wished for by');
	assert.equal(english.MOD_MP_CHARITY_WISH_FORSAKE_CONFIRM, 'Are you sure you want to forsake this Wish? It will be destroyed and cannot be recovered.');
	assert.equal(english.MOD_MP_CHARITY_WISH_PICK, 'Claim Wish');
	assert.equal(english.MOD_MP_CHARITY_INFO_WISHES_PENALTY, 'Shuffle Bonus by 10');
	assert.equal(typeof chinese.MOD_MP_CHARITY_WISH_MAKE, 'string');
});

test('hides Charitree offerings, wishes, and Wish choices from unowned official DLC', async () => {
	const [main, actions] = await Promise.all([
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/client-actions-market-campaign-charity.mjs', root), 'utf8')
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
