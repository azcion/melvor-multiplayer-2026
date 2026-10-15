import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { install_transfer_actions } from '../../mod/client-actions-transfer.mjs';

test('ordered full category labels, scoped private details and old-server fallback', () => {
	const calls = [];
	const state = { format_member_account_age: ms => String(ms) };
	Object.assign(state, install_transfer_actions({ state, queue_modal: (...args) => calls.push(args) }));
	const now = Date.now();
	const member = { active_mods_visible: false, using_cheats: false, cheat_categories: ['loot_rng','time','resources'].map(id => ({
		id, detected_at: now - 1000, expires_at: now + 100000, mods: [{ id: 1, name: id, explanation: 'Capability', detected_at: now - 1000, expires_at: now + 100000 }]
	})) };
	assert.deepEqual(state.member_cheat_categories(member).map(c => c.id), ['time','resources','loot_rng']);
	let stopped = false;
	state.view_member_cheat_mods(member, { stopPropagation() { stopped = true; } }, 'resources');
	assert.equal(stopped, true);
	assert.equal(calls[0][0], 'MOD_MP_CHEAT_CATEGORY_RESOURCES');
	assert.deepEqual(state.viewed_category_mods.map(m => m.name), ['resources']);
	assert.equal(state.viewed_cheats_unavailable, false);
	assert.deepEqual(state.member_cheat_categories({ using_cheats: true, cheats_detected_at: now }).map(c => c.id), ['items']);
	assert.deepEqual(state.member_cheat_categories({ using_cheats: true, cheat_categories: [] }), []);
	member.cheat_categories[0].expires_at = now - 1;
	assert.deepEqual(state.member_cheat_categories(member).map(c => c.id), ['time','resources']);
});

test('legacy reports retain names and report timing without overriding category metadata', () => {
	const calls = [];
	const state = { format_member_account_age: ms => String(ms) };
	Object.assign(state, install_transfer_actions({ state, queue_modal: (...args) => calls.push(args) }));
	const member = { using_cheats: true, cheats_detected_at: Date.now() - 1000, cheat_mods: ['Add Items', 'God Mode'] };
	const event = { stopPropagation() {} };
	state.view_member_cheat_mods(member, event);
	assert.deepEqual(state.viewed_cheat_mods, member.cheat_mods);
	assert.deepEqual(state.viewed_category_mods, []);
	assert.equal(state.viewed_cheats_unavailable, false);
	assert.ok(state.viewed_cheats_elapsed);
	assert.ok(state.viewed_cheats_remaining);
	calls[0][3].didClose();
	assert.deepEqual(state.viewed_cheat_mods, []);

	for (const cheat_mods of [undefined, []]) {
		state.view_member_cheat_mods({ ...member, cheat_mods }, event);
		assert.deepEqual(state.viewed_cheat_mods, []);
		assert.equal(state.viewed_cheats_unavailable, true);
	}
	const before = calls.length;
	state.view_member_cheat_mods({ ...member, cheat_categories: [] }, event);
	assert.equal(calls.length, before);
	state.view_member_cheat_mods(member, event);
	state.view_member_cheat_mods({ ...member, cheat_categories: [{ id: 'items', detected_at: member.cheats_detected_at,
		expires_at: Date.now() + 100000, details_unavailable: true, mods: [] }] }, event);
	assert.deepEqual(state.viewed_cheat_mods, []);
	assert.equal(state.viewed_cheats_unavailable, true);

	const html = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const modal = html.split('<template id="template-mp-cheat-mods-modal">')[1].split('</template>')[0];
	assert.match(modal, /v-for="mod_name in state.viewed_cheat_mods"[^>]*><strong>\{\{ mod_name \}\}<\/strong>/);
	for (const key of ['LAST_DETECTED', 'EXPIRES']) {
		assert.match(modal, new RegExp(`v-if="state.viewed_cheats_unavailable \\|\\| state.viewed_cheat_mods.length"><mp-lang-string-f lang-id="MOD_MP_(?:GUILD_CHEATS|CHEAT)_${key}"`));
	}
});

test('both badge surfaces retain keyboard activation, wrapping and native modal scrolling', () => {
	const html = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const css = readFileSync(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	for (const surface of ['application', 'member']) {
		assert.ok(html.includes(`v-for="category in state.member_cheat_categories(${surface})"`));
		for (const key of ['enter','space']) assert.ok(html.includes(`@keydown.${key}.stop.prevent="state.view_member_cheat_mods(${surface}, $event, category.id)"`));
	}
	assert.match(css, /\.mp-guild-member-tags \{[^}]*flex-wrap: wrap/s);
	assert.match(css, /\.mp-guild-cheats-badge \{[^}]*white-space: nowrap;[^}]*background-color: #8f3030/s);
	assert.match(css, /\.mp-cheat-details \{[^}]*overflow-wrap: anywhere/s);
	assert.doesNotMatch(css, /\.mp-cheat-details[^}]*\b(?:max-height|overflow-y|touch-action|overscroll-behavior-y)\s*:/s);
	const modal = html.split('<template id="template-mp-cheat-mods-modal">')[1].split('</template>')[0];
	assert.match(modal, /class="mp-cheat-details"/);
	assert.doesNotMatch(modal, /@touchmove|mp-cheat-details-scroll/);
	assert.match(modal, /<\/div>\s*<button type="button"/);
	assert.ok(!modal.includes('v-html'));
	const en = JSON.parse(readFileSync(new URL('../../mod/data/lang/en.json', import.meta.url)));
	assert.deepEqual(['TIME','ITEMS','RESOURCES','MULTITASKING','SHOPS','LOOT_RNG'].map(id => en['MOD_MP_CHEAT_CATEGORY_'+id]), ['Time Cheats','Item Cheats','Resource Cheats','Multitasking','Shop Cheats','Loot Cheats']);
});

test('missing descriptions keep the named mod, report age and expiry without unavailable details', () => {
	const state = { format_member_account_age: ms => String(ms) };
	Object.assign(state, install_transfer_actions({ state, queue_modal() {} }));
	const now = Date.now();
	for (const explanation of ['', '  ']) {
		state.view_member_cheat_mods({ cheat_categories: [{ id: 'items', detected_at: now - 1000,
			expires_at: now + 100000, details_unavailable: false, mods: [{ id: 5377900,
				name: '[Creative Mode] God mode w/ Loot + XP Multipliers', explanation,
				detected_at: now - 1000, expires_at: now + 100000 }] }] }, { stopPropagation() {} });
		assert.equal(state.viewed_category_mods.length, 1);
		assert.equal(state.viewed_category_mods[0].name, '[Creative Mode] God mode w/ Loot + XP Multipliers');
		assert.equal(state.viewed_category_mods[0].explanation, explanation);
		assert.ok(state.viewed_category_mods[0].age);
		assert.ok(state.viewed_category_mods[0].remaining);
		assert.equal(state.viewed_cheats_unavailable, false);
	}
	const html = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const modal = html.split('<template id="template-mp-cheat-mods-modal">')[1].split('</template>')[0];
	const condition = modal.match(/<p v-if="([^"]+)">\{\{ mod.explanation \}\}<\/p>/)[1];
	const visible = new Function('mod', `return Boolean(${condition});`);
	for (const explanation of ['', '  ', undefined]) assert.equal(visible({ explanation }), false);
	assert.equal(visible({ explanation: 'Adds resources.' }), true);
});


test('general category descriptions are absent from the modal and every packaged locale', () => {
	const html = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const modal = html.split('<template id="template-mp-cheat-mods-modal">')[1].split('</template>')[0];
	assert.ok(!modal.includes('MOD_MP_CHEAT_CAPABILITY_'));
	const root = new URL('../../mod/data/lang/', import.meta.url);
	for (const filename of readdirSync(root).filter(name => name.endsWith('.json'))) {
		const lang = JSON.parse(readFileSync(new URL(filename, root)));
		assert.ok(!Object.keys(lang).some(key => key.startsWith('MOD_MP_CHEAT_CAPABILITY_')), filename);
	}
});
