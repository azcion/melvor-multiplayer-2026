import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { create_combat_view, combat_result_details } from '../../mod/combat-arena.mjs';
import { create_combat_inventory } from '../../mod/combat-inventory.mjs';
import * as practice_module from '../../mod/combat-practice.mjs';
import { practice_sync, practice_selected, practice_select, practice_choices, practice_actor, practice_title, practice_copy, localize_practice_entry, roman } from '../../mod/combat-practice.mjs';
function fixture() {
	const view=create_combat_view();view.tutorial={complete:true};
	view.practice=[['recruit','duels'],['partners','groups'],['circuit','circuits']].map(([id,category])=>({id,name:id,category,tiers:[1,2].map(tier=>({tier,available:tier===1,encounter:`practice_${id}_${tier}`,waves:[[{id:'human_recruit_1',name:'Guard Recruit',portrait:'SQUIRE'}]]}))}));
	return view;
}
test('selection, category and tier changes synchronise one finite server-authored encounter',()=>{
	const view=fixture();practice_sync(view);assert.equal(view.encounter,'practice_recruit_1');
	practice_select(view,'category','groups');assert.equal(practice_selected(view).id,'partners');assert.equal(view.encounter,'practice_partners_1');
	practice_select(view,'tier',2);assert.equal(view.encounter,'practice_partners_2');
	practice_select(view,'tier',99);assert.equal(view.practice_tier,2);
	practice_select(view,'encounter','circuit');assert.equal(view.practice_tab,'selected');assert.equal(view.practice_category,'circuits');
	assert.equal(practice_choices(view)[0].id,'practice_circuit_2');assert.equal(view.mode,'once');
	view.starting=true;practice_select(view,'tier',1);assert.equal(view.practice_tier,2);
	assert.equal(practice_actor(view,'human_recruit_1').name,'Guard Recruit');assert.equal(practice_actor(view,'golbin'),null);
	assert.equal(practice_title(view,{encounter:'practice_circuit_2'}),'circuit · Tier II');assert.equal(roman(12),'XII');
});
test('Practice catalog text resolves stable IDs and falls back to server English when a locale key is absent',()=>{
	const view=fixture(), entry=view.practice[0];
	const lookup=id=>({MOD_MP_COMBAT_PRACTICE_NAME_RECRUIT:'Garde recrue',MOD_MP_COMBAT_PRACTICE_FOCUS_RECRUIT:'Texte localisé',MOD_MP_COMBAT_PRACTICE_ACTOR_RECRUIT:'Garde recrue'}[id]??id);
	assert.equal(practice_copy('categories',lookup),'Practice categories');
	assert.equal(practice_copy('categories',id=>id),'Practice categories');
	assert.equal(practice_choices(view,lookup)[0].name,'Garde recrue');
	assert.equal(localize_practice_entry(entry,lookup).focus,'Texte localisé');
	assert.equal(localize_practice_entry(entry,lookup).tiers[0].waves[0][0].name,'Garde recrue');
	assert.equal(practice_actor(view,'human_recruit_1',lookup).name,'Garde recrue');
});
test('tutorial and Dungeon selections survive refresh; no stale encounter when catalog is absent',()=>{
	const view=fixture();view.tutorial.complete=false;view.encounter='tutorial_3';practice_sync(view);assert.equal(view.encounter,'tutorial_3');
	view.tutorial.complete=true;view.mode='raid';view.encounter='tidal';practice_sync(view);assert.equal(view.encounter,'tidal');
	view.mode='once';view.practice=[];practice_sync(view);assert.equal(view.encounter,'');
});
test('Practice results omit times and never infer progression rewards',()=>{
	assert.deepEqual(combat_result_details({encounter:'practice_recruit_1',status:'victory',elapsed_ms:12000}, {}, {}),{time:null,unlocks:[]});
});
test('inventory refresh initialises graduated Practice through the context-loaded dependency',async()=>{
	const view=create_combat_view(), catalog=fixture().practice;
	const inventory=create_combat_inventory({view,scope:()=> 'test',request:async()=>({foods:[],practice:catalog,tutorial:{complete:true},equipment_projects:{}}),reconcile:async()=>true,can_mutate:()=>true,practice_sync});
	assert.equal(await inventory.refresh(),true);
	assert.equal(view.encounter,'practice_recruit_1');
	assert.equal(view.practice_selection,'recruit');
});
test('picker uses equal desktop columns, left-side categories and established two-panel mobile layout',async()=>{
	const html=await readFile(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
	const css=await readFile(new URL('../../mod/ui/style.css',import.meta.url),'utf8');
	const picker=html.slice(html.indexOf('<div class="mp-combat-practice"'),html.indexOf('<div class="mp-combat-raids"'));
	assert.ok(picker.includes('mp-practice-tab-picker'));assert.ok(picker.includes('mp-practice-tab-selected'));
	assert.ok(picker.indexOf('mp-combat-practice-categories')<picker.indexOf('id="mp-practice-selected"'));
	assert.ok(!picker.includes('leaderboard'));assert.ok(!picker.includes('type="range"'));
	assert.match(css,/\.mp-combat-practice-columns\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
	assert.match(css,/\.mp-combat-practice-mobile-hidden\s*\{ display: none;/);
});

test('Practice preview cache preserves fresh flags, isolates scope/reset and accepts legacy full responses', async () => {
	let scope = 'server-a:1', revision = 'catalog-a', compact = false, complete = false;
	const paths = [];
	const view = {level_quantities:{},page_tab:'character',preparation_tab:'levels'};
	const inventory = create_combat_inventory({view, scope:()=>scope, can_mutate:()=>true, reconcile:async()=>true,
		request:async path => {
			paths.push(path);
			return {foods:[],practice_catalog_revision:revision, practice:[{id:'recruit',tiers:[{
				encounter:'practice_recruit_1',tier:1,available:true,complete,...(compact ? {} : {waves:[[{name:revision}]]})
			}]}]};
		}});
	assert.equal(await inventory.refresh(),true);
	assert.equal(paths.at(-1),'/api/combat/inventory');
	// A reactive renderer must never be the cache's source of truth.
	view.practice[0].tiers[0].waves[0][0].name = 'changed by view';
	compact = true; complete = true; view.raid_page = 2;
	assert.equal(await inventory.refresh(),true);
	assert.match(paths.at(-1),/raid_page=2&practice_catalog=catalog-a/);
	assert.equal(view.practice[0].tiers[0].complete,true);
	assert.equal(view.practice[0].tiers[0].waves[0][0].name,'catalog-a');
	revision = 'catalog-b'; compact = false;
	assert.equal(await inventory.refresh(),true);
	assert.equal(view.practice[0].tiers[0].waves[0][0].name,'catalog-b');
	scope = 'server-b:2';
	assert.equal(await inventory.refresh(),true);
	assert.ok(!paths.at(-1).includes('practice_catalog'));
	inventory.reset();
	assert.equal(await inventory.refresh(),true);
	assert.ok(!paths.at(-1).includes('practice_catalog'));
	// An older server has no revision and continues returning complete definitions.
	revision = undefined;
	assert.equal(await inventory.refresh(),true);
	assert.equal(view.practice[0].tiers[0].waves.length,1);
});

test('an unexpected compact Practice response fails without replacing confirmed inventory', async () => {
	const view = {level_quantities:{},foods:['confirmed'],practice:['confirmed']};
	const inventory = create_combat_inventory({view,scope:()=> 'server',can_mutate:()=>true,reconcile:async()=>true,
		request:async()=>({foods:[],practice_catalog_revision:'unknown',practice:[{tiers:[{encounter:'practice_recruit_1'}]}]})});
	assert.equal(await inventory.refresh(),false);
	assert.deepEqual(view.foods,['confirmed']);
	assert.deepEqual(view.practice,['confirmed']);
});


test('hidden Practice roster never receives tutorial choices during login or tutorial refresh', async () => {
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	const html = await readFile(new URL('../../mod/ui/templates.html', import.meta.url), 'utf8');
	const state = { combat: fixture() };
	const start = main.indexOf('\tstate.combat_practice_choices =');
	const end = main.indexOf('\tstate.combat_practice_categories =', start);
	new Function('state', 'practice_module', 'getLangString', main.slice(start, end))(state, practice_module, key => key);
	const loop = html.match(/v-for="choice in ([^"]+)" :key="choice.selection"/)[1];
	const choices = () => new Function('state', `return ${loop}`)(state);
	for (const tutorial of [null, { complete: false, trial: { id: 'tutorial_1' }, victories: 0 }]) {
		state.combat.tutorial = tutorial;
		assert.deepEqual(choices(), []);
	}
	state.combat.tutorial = { complete: true };
	state.combat.practice[0].tiers[0].complete = true;
	assert.equal(choices().length, 1);
	assert.equal(state.combat_practice_cleared(choices()[0]), 1);
	assert.equal(choices()[0].tiers.length, 2);
	state.combat.practice = [];
	assert.deepEqual(choices(), []);
});
