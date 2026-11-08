import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tutorial_guide, tutorial_name, tutorial_access, install_tutorial_review_actions } from '../../mod/combat-tutorial.mjs';

test('guide bindings can evaluate before hidden panels unmount after graduation', () => {
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const bindings = [...template.matchAll(/{{\s*(state\.combat_tutorial_guide\(\)[^}]+)\s*}}/g)];
	assert.equal(bindings.length, 2);
	for (const [, expression] of bindings) {
		const evaluate = new Function('state', `return ${expression}`);
		assert.equal(evaluate({ combat_tutorial_guide: () => null }), undefined);
		assert.equal(evaluate({ combat_tutorial_guide: () => ({ text: 'Ready!' }) }), 'Ready!');
	}
});

test('guidance follows real purchases, projects, native work and equipping without granting items', () => {
	const trial = { id:'tutorial_3', name:'Armoured Squire', slot:'Weapon', tier:1, item:'melvorD:Bronze_Sword', reward:2 };
	const tutorial = { complete:false, victories:2, ready:false, trial };
	const model = { slots:[],unlocked:[],project:null };
	assert.equal(tutorial_guide(tutorial, model).action,'unlock-slot');
	model.slots.push({slot:'Weapon',tier:0,equipped_item:'multiplayer:Wooden_Sword'});
	assert.equal(tutorial_guide(tutorial, model).action,'unlock-tier');
	model.slots[0].tier=1;
	assert.equal(tutorial_guide(tutorial, model).action,'start-project');
	model.project={item_id:trial.item};
	assert.equal(tutorial_guide(tutorial, model).action,'work');
	assert.match(tutorial_guide(tutorial, model).text,/automatically/);
	model.project=null;model.unlocked.push(trial.item);
	assert.equal(tutorial_guide(tutorial, model).action,'equip');
	model.slots[0].equipped_item=trial.item;
	assert.equal(tutorial_guide({...tutorial,ready:true},model).action,'battle');
	assert.equal(tutorial_guide({...tutorial,complete:true},model),null);
	assert.equal(tutorial_name('tutorial_7_2'),'Final Assessment');
	assert.equal(tutorial_name('golbin'),null);
	assert.match(tutorial_guide({ ...tutorial, trial: { slot: 'Shield', tier: 0, item: 'multiplayer:Wooden_Shield' } }, { slots: [] }).text, /Equipment → Shield/);
	assert.equal(tutorial_guide({ ...tutorial, trial: { slot: 'Helmet', tier: 1, item: 'melvorD:Bronze_Helmet' } }, { slots: [] }).text, 'Open Equipment → Helmet and unlock the slot.');
});

test('tutorial strings use stable localized IDs, named placeholders, and refresh with the current language', () => {
	const trial = { id:'tutorial_1', name:'Training Partner', slot:'Weapon', tier:0, item:'multiplayer:Wooden_Sword' };
	const localized = id => ({
		MOD_MP_COMBAT_TUTORIAL_NAME_1:'Partenaire',
		MOD_MP_COMBAT_TUTORIAL_EQUIPMENT:'Matériel',
		MOD_MP_COMBAT_TUTORIAL_UNLOCK_SLOT:'Débloquer {path};{bonus}',
		MOD_MP_COMBAT_TUTORIAL_UNLOCK_SLOT_BONUS:'obtiens {item}'
	}[id] ?? id);
	assert.equal(tutorial_name('tutorial_1', localized), 'Partenaire');
	assert.equal(tutorial_guide({ complete:false, trial }, { slots:[] }, localized).text, 'Débloquer Matériel → Weapon; obtiens Wooden Sword');
	const state = { chat_is_admin:true };
	let current = 'First';
	install_tutorial_review_actions(state, id => id === 'MOD_MP_COMBAT_TUTORIAL_NAME_1' ? current : id);
	assert.match(state.combat_tutorial_review_steps()[1].title, /First/);
	current = 'Deuxième';
	assert.match(state.combat_tutorial_review_steps()[1].title, /Deuxième/);
});

test('starter item helpers install without pre-existing state actions and preserve native lookup', async () => {
 const { install_common_actions } = await import('../../mod/client-actions-common.mjs');
 const actions = install_common_actions({ state: {}, ctx: { getResourceUrl: path => 'mod:' + path }, game: {
  currencies: { getObjectByID: () => undefined }, items: { getObjectByID: id => id === 'native' ? { name: 'Native', media: 'native.png' } : undefined }
 } });
 assert.equal(actions.get_item_name('multiplayer:Wooden_Sword'), 'Wooden Sword');
 assert.equal(actions.get_item_icon('multiplayer:Wooden_Shield'), 'mod:assets/wooden-shield.svg');
 assert.equal(actions.get_item_name('native'), 'Native');
 assert.equal(actions.get_item_icon('native'), 'native.png');
});


test('tutorial navigation and spending open only as preparation progresses', () => {
	const view = { character: null, arena: null, tutorial: { complete: false, victories: 0, ready: false, next: 'unlock-slot', trial: { slot: 'Weapon', item: 'multiplayer:Wooden_Sword' } } };
	assert.equal(tutorial_access(view, 'page', 'character'), true);
	assert.equal(tutorial_access(view, 'page', 'test_combat'), false);
	assert.equal(tutorial_access(view, 'tab', 'equipment'), false);
	view.character = {};
	assert.equal(tutorial_access(view, 'page', 'test_combat'), false);
	assert.equal(tutorial_access(view, 'tab', 'equipment'), true);
	assert.equal(tutorial_access(view, 'tab', 'consumables'), false);
	assert.equal(tutorial_access(view, 'slot', 'Weapon'), true);
	assert.equal(tutorial_access(view, 'slot', 'Shield'), false);
	assert.equal(tutorial_access(view, 'purchase', 'Weapon'), true);
	view.tutorial.next = 'equip';
	assert.equal(tutorial_access(view, 'purchase', 'Weapon'), false);
	view.tutorial.ready = true;
	assert.equal(tutorial_access(view, 'page', 'test_combat'), false);
	view.tutorial.victories = 1; view.tutorial.ready = false;
	assert.equal(tutorial_access(view, 'page', 'test_combat'), false);
	assert.equal(tutorial_access(view, 'slot', 'Shield'), true);
	assert.equal(tutorial_access(view, 'slot', 'Helmet'), false);
	view.tutorial.victories = 4;
	assert.equal(tutorial_access(view, 'tab', 'consumables'), true);
	assert.equal(tutorial_access(view, 'slot', 'Food'), true);
	assert.equal(tutorial_access(view, 'slot', 'Food2'), false);
	assert.equal(tutorial_access(view, 'slot', 'Platebody'), false);
	view.tutorial.complete = true;
	assert.equal(tutorial_access(view, 'page', 'test_combat'), false);
	assert.equal(tutorial_access(view, 'slot', 'Platebody'), true);
	assert.equal(tutorial_access(view, 'page', 'pvp'), false);
	view.arena = { status: 'active' };
	assert.equal(tutorial_access(view, 'page', 'character'), false);
});

test('admin review covers every trial and never changes live progress', async () => {
	const { tutorial_review_steps, install_tutorial_review_actions, tutorial_lessons } = await import('../../mod/combat-tutorial.mjs');
	const steps = tutorial_review_steps();
	for (let trial = 1; trial <= 7; trial++) {
		assert.ok(steps.some(step => step.title.startsWith(`${trial} ·`) && step.title.endsWith('Equip')));
		assert.ok(steps.some(step => step.title.startsWith(`${trial} ·`) && step.text === tutorial_lessons[trial - 1]));
	}
	assert.ok(steps.every(step => typeof step.text === 'string' && step.text.length > 0));
	assert.ok(!steps.some(step => step.title.startsWith('5 ·') && step.title.endsWith('Unlock slot')));
	assert.ok(steps.some(step => step.text === 'Open Consumables → Food and upgrade to Shrimp.'));
	const combat = { tutorial: { complete: true }, ep_micros: 123, character: { attack: 10 } };
	const state = { chat_is_admin: false, combat };
	install_tutorial_review_actions(state);
	state.combat_tutorial_review_move(1);
	assert.equal(state.combat_tutorial_review_index, 0);
	assert.deepEqual(state.combat_tutorial_review_steps(), []);
	assert.equal(state.combat_tutorial_review_current(), null);
	state.chat_is_admin = true;
	state.combat_tutorial_review_move(1);
	assert.equal(state.combat_tutorial_review_current().title, steps[1].title);
	state.combat_tutorial_review_select(steps.length - 1);
	state.combat_tutorial_review_move(1);
	assert.equal(state.combat_tutorial_review_index, steps.length - 1);
	state.combat_tutorial_review_select(-1);
	state.combat_tutorial_review_select('invalid');
	assert.equal(state.combat_tutorial_review_index, steps.length - 1);
	state.combat_tutorial_review_select(0);
	assert.equal(state.combat_tutorial_review_current().title, steps[0].title);
	assert.deepEqual(combat, { tutorial: { complete: true }, ep_micros: 123, character: { attack: 10 } });
});

test('Archery remains locked for nonadmins after training and Magic stays locked for everyone', async () => {
	const { equipment_set_available } = await import('../../mod/combat-tutorial.mjs');
	for (const complete of [false, true]) for (const admin of [false, true]) {
		const view = { tutorial: { complete } };
		assert.equal(equipment_set_available(view, 'melee', admin), true);
		assert.equal(equipment_set_available(view, 'ranged', admin), admin && complete);
		assert.equal(equipment_set_available(view, 'magic', admin), false);
	}
});

test('tutorial portraits use seven distinct base-game Thieving targets and retain bout portraits', async () => {
	const { tutorial_portrait } = await import('../../mod/combat-tutorial.mjs');
	const ids = [];
	const targets = { getObjectByID(id) { ids.push(id); return { media: id + '.png' }; } };
	for (let battle = 1; battle <= 7; battle++) {
		const portrait = tutorial_portrait(`tutorial_${battle}`, targets);
		assert.equal(tutorial_portrait(`tutorial_${battle}_2`, targets), portrait);
	}
	assert.equal(new Set(ids).size, 7);
	assert.ok(ids.every(id => id.startsWith('melvorF:')));
	assert.equal(tutorial_portrait('golbin', targets), null);
	assert.equal(tutorial_portrait('tutorial_1', undefined), null);
});

test('slot action glow excludes equip tasks while slot navigation remains highlighted', () => {
	const source = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const body = source.split('state.combat_tutorial_highlight = (kind, id = null) => {')[1].split('\n\t};')[0];
	let action = 'equip';
	const state = { combat_tutorial_guide: () => ({ action, trial: { slot: 'Weapon', item: 'bronze' } }) };
	const highlight = new Function('state', 'kind', 'id', body);
	assert.equal(highlight(state, 'slot', 'Weapon'), true);
	assert.equal(highlight(state, 'slot-action', 'Weapon'), false);
	assert.equal(highlight(state, 'item', 'bronze'), true);
	for (action of ['unlock-slot', 'unlock-tier']) {
		assert.equal(highlight(state, 'slot-action', 'Weapon'), true);
		assert.equal(highlight(state, 'slot-action', 'Shield'), false);
	}
});

test('tutorial project locks disable list selection and guard the modal entry point', () => {
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.match(template, /class="mp-equipment-project-icon" :disabled="!state.combat_tutorial_access\('project', project.item_id\)"/);
	const source = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const body = source.split('state.equipment_select = (kind, type, id, tiers = false) => {')[1].split('\n\t};')[0];
	const select = new Function('state', 'kind', 'type', 'id', body);
	select({ combat_tutorial_access: () => false }, 'project', 'project', 'dagger');
	const expression = template.match(/{{ getLangString\((!state.equipment_slot\(state.equipment_modal_slot\)[^}]+)\) }}/)[1];
	const label = new Function('state', `return ${expression}`);
	const confirmExpression = template.match(/{{ getLangString\((!state.equipment_slot\(action.slot\)[^}]+)\) }}/)[1];
	const confirmLabel = new Function('state', 'action', `return ${confirmExpression}`);
	for (const slot of ['Weapon', 'Food']) {
		const state = { equipment_modal_slot: slot, equipment_slot: () => null, equipment_modal_slot_actions: () => [{ can_confirm: true }] };
		assert.equal(label(state), 'MOD_MP_EQUIPMENT_UNLOCK_SLOT');
		assert.equal(confirmLabel(state, {slot}), 'MOD_MP_EQUIPMENT_UNLOCK_SLOT');
		state.equipment_slot = () => ({ tier: 0 });
		assert.equal(label(state), 'MOD_MP_EQUIPMENT_UPGRADE_SLOT');
		assert.equal(confirmLabel(state, {slot}), 'MOD_MP_EQUIPMENT_UPGRADE_SLOT');
		state.equipment_modal_slot_actions = () => [{ can_confirm: false }];
		assert.equal(label(state), 'MOD_MP_EQUIPMENT_VIEW_SLOT');
	}
});

test('tutorial opponents are human and empty on-hit status lines stay hidden', async () => {
	const { tutorial_names, tutorial_portrait, tutorial_lessons } = await import('../../mod/combat-tutorial.mjs');
	assert.ok(tutorial_names.every(name => !/dummy/i.test(name)));
	assert.ok(tutorial_lessons.every(text => !/dummy/i.test(text)));
	const humanTargets = new Set(['MAN', 'WOMAN', 'SQUIRE', 'BANDIT_THUG', 'CHEF', 'MARAUDER', 'KNIGHT'].map(id => 'melvorF:' + id));
	const targets = { getObjectByID(id) { assert.ok(humanTargets.has(id)); return {media: id}; } };
	for (let battle = 1; battle <= 7; battle++) assert.ok(tutorial_portrait(`tutorial_${battle}`, targets));
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const expression = template.match(/class="mp-combat-proc" v-show="([^"]+)"/)[1];
	const visible = new Function('state', 'enemy', `return ${expression}`);
	assert.equal(visible({combat_role_effects: () => []}, {id:'tutorial_1'}), false);
	assert.equal(visible({combat_role_effects: () => ['poison']}, {id:'vine'}), true);
	const server = readFileSync(new URL('../../server/combat-tutorial.ts', import.meta.url), 'utf8');
	for (const name of tutorial_names) assert.ok(server.includes(`name: '${name}'`));
});


test('Fighter launches only ready tutorial trials and rechecks graduation before admission', async () => {
	const source = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const choices = source.match(/state.combat_choices = (\(\) => [^\n]+);/)[1];
	const state = { combat: { page_tab: 'character', character: {}, tutorial: null, encounter: 'golbin' }, is_connected: true };
	const tutorial_module = await import('../../mod/combat-tutorial.mjs');
	const getLangString = id => id;
	const combat_localized_text = (id, fallback, values = {}) => fallback.replace(/\{([a-z_]+)\}/gi, (_, key) => String(values[key] ?? `{${key}}`));
	state.combat_choices = new Function('state', 'tutorial_module', 'getLangString', 'combat_localized_text', `return ${choices}`)(state, tutorial_module, getLangString, combat_localized_text);
	assert.deepEqual(state.combat_choices(), []);
	state.combat.tutorial = { complete: false, ready: true, victories: 0, trial: { id: 'tutorial_1', name: 'Training Partner' } };
	assert.deepEqual(state.combat_choices().map(choice => choice.id), ['tutorial_1']);
	const start = source.split('state.start_combat = async () => {')[1].split('\n\t};')[0];
	let connections = 0, refreshes = 0;
	const combat_inventory = { refresh: async () => { refreshes++; return true; } };
	const launch = new Function('state', 'combat_inventory', 'combat_arena', 'server_host', 'session_generation', `return async () => {${start}}`)(
		state, combat_inventory, { connect: async () => { connections++; } }, 'test', 1);
	await launch(); // A stale legacy selection cannot start even during the tutorial.
	assert.equal(refreshes, 0);
	state.combat.encounter = 'tutorial_1';
	state.combat.tutorial.ready = false; await launch();
	assert.equal(connections, 0); assert.equal(refreshes, 0);
	state.combat.tutorial.ready = true;
	await launch();
	assert.equal(connections, 1);
	state.combat.tutorial.complete = true;
	assert.deepEqual(state.combat_choices(), []);
	await launch();
	assert.equal(connections, 1);
	state.combat.page_tab = 'raid';
	await launch();
	assert.equal(connections, 2);
	const select = source.split('state.combat_select_page = tab => {')[1].split('\n\t};')[0];
	state.combat_tutorial_access = () => true;
	state.combat.mode = 'raid'; state.combat.encounter = 'golbins';
	new Function('state', 'tab', 'getLangString', 'combat_localized_text', select)(state, 'character', getLangString, combat_localized_text);
	assert.equal(state.combat.mode, 'raid');
	assert.equal(state.combat.encounter, 'golbins');
	state.combat.page_tab = 'character';
	state.combat.encounter = 'tutorial_1'; state.combat.tutorial.complete = false;
	combat_inventory.refresh = async () => { state.combat.tutorial.complete = true; return true; };
	await launch(); // Graduation during refresh cancels tutorial admission.
	assert.equal(connections, 2);
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	assert.doesNotMatch(template, /combat_run_modes|combat_select_mode/);
});


test('level and reset bindings survive a missing character before conditional teardown', () => {
	const template = readFileSync(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const panel = template.slice(template.indexOf('id="mp-combat-preparation-levels"'), template.indexOf('id="mp-combat-preparation-equipment"'));
	const expressions = [
		...Array.from(panel.matchAll(/{{(.*?)}}/g), match => match[1]),
		...Array.from(panel.matchAll(/:[\w-]+="([^"]+)"/g), match => match[1]),
		panel.match(/v-for="\(level, skill\) in ([^"]+)"/)[1],
	].filter(expression => expression.includes('state.combat.character'));
	assert.ok(expressions.length >= 10);
	const state = { combat: { character: null, tutorial: { complete: true }, reset_confirm: true }, combat_name: value => value, format_ep: value => {
		assert.ok(Number.isFinite(value)); return String(value);
	} };
	for (const character of [null, { levels: { hitpoints: 3 }, max_hp: 30, banked_resets: 1, invested_micros: 1000000, reset_refund_micros: 1000000 }]) {
		state.combat.character = character;
		for (const expression of expressions) {
			assert.doesNotThrow(() => new Function('state', `return (${expression});`)(state), expression);
		}
	}
	assert.doesNotMatch(panel, /state\.combat\.character\./);
});

test('Dungeons glows after graduation until an allowed visit, surviving reload and isolating servers', () => {
	const source = readFileSync(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const highlight_body = source.split('state.combat_tutorial_highlight = (kind, id = null) => {')[1].split('\n\t};')[0];
	const select_body = source.split('state.combat_select_page = tab => {')[1].split('\n\t};')[0];
	const storage = new Map();
	let server = 'first';
	const read = key => storage.get(`${server}:${key}`);
	const write = (key, value) => storage.set(`${server}:${key}`, value);
	const state = { combat: { tutorial: null, page_tab: 'character' }, combat_tutorial_guide: () => null };
	state.combat_tutorial_access = (kind, id) => tutorial_access(state.combat, kind, id);
	state.combat_tutorial_highlight = (kind, id = null) => new Function('state', 'kind', 'id', highlight_body)(state, kind, id);
	const select = tab => new Function('state', 'tab', 'combat_inventory', 'set_instance_storage_item', select_body)(state, tab, { refresh() {} }, write);
	const reload_flag = () => {
		const assignment = source.match(/state\.combat_dungeons_visited = get_instance_storage_item\('combat_dungeons_visited'\) === true;/)[0];
		new Function('state', 'get_instance_storage_item', assignment)(state, read);
	};
	reload_flag();
	assert.equal(state.combat_tutorial_highlight('page', 'raid'), false);
	state.combat.character = {};
	state.combat.tutorial = { complete: false };
	select('raid');
	assert.equal(read('combat_dungeons_visited'), undefined);
	assert.equal(state.combat.page_tab, 'character');
	state.combat.tutorial.complete = true; // Both graduation and skipping use this status.
	assert.equal(state.combat_tutorial_highlight('page', 'raid'), true);
	select('character');
	select('pvp'); // A disabled tab does not dismiss the Dungeon highlight.
	assert.equal(state.combat_tutorial_highlight('page', 'raid'), true);
	select('raid');
	assert.equal(state.combat.page_tab, 'raid');
	assert.equal(read('combat_dungeons_visited'), true);
	assert.equal(state.combat_tutorial_highlight('page', 'raid'), false);
	reload_flag();
	assert.equal(state.combat_tutorial_highlight('page', 'raid'), false);
	server = 'second'; reload_flag();
	assert.equal(state.combat_tutorial_highlight('page', 'raid'), true);
	server = 'first'; reload_flag();
	assert.equal(state.combat_tutorial_highlight('page', 'raid'), false);
});
