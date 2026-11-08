import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { create_combat_view, combat_roman } from '../../mod/combat-arena.mjs';
import { tutorial_access } from '../../mod/combat-tutorial.mjs';
import { create_combat_inventory } from '../../mod/combat-inventory.mjs';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('desktop and mobile share three main tabs with no Practice or Battles parent', () => {
	const html=read('mod/ui/templates.html'), css=read('mod/ui/style.css');
	const nav=html.slice(html.indexOf('<nav class="mp-combat-page-tabs mp-combat-main-tabs"'),html.indexOf('<section class="mp-combat-panel" v-show="state.combat.recovery'));
	assert.match(nav, /\['character', 'pvp', 'raid'\]/);
	assert.doesNotMatch(nav, /test_combat|battles|desktop-tabs|mobile-tabs/);
	assert.match(css, /\.mp-combat-main-tabs\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/);
	assert.doesNotMatch(html, /combat_practice|mp-combat-practice|test_combat/);
	assert.doesNotMatch(read('mod/main.mjs'), /practice_module|combat_practice/);
	assert.doesNotMatch(css, /mp-combat-practice/);
	assert.equal(combat_roman(12),'XII');
});
test('Fighter hosts the ready tutorial and active arena while Dungeons stays locked until graduation', () => {
	const view=create_combat_view();
	view.character={}; view.tutorial={complete:false,ready:false};
	assert.equal(tutorial_access(view,'page','character'),true);
	assert.equal(tutorial_access(view,'page','raid'),false);
	assert.equal(tutorial_access(view,'page','test_combat'),false);
	view.tutorial.ready=true; view.arena={status:'active'}; view.combat_tab='character';
	assert.equal(tutorial_access(view,'page','character'),true);
	assert.equal(tutorial_access(view,'page','raid'),false);
	assert.equal(tutorial_access(view,'page','pvp'),false);
	view.arena=null; view.tutorial.complete=true;
	assert.equal(tutorial_access(view,'page','raid'),true);
	const html=read('mod/ui/templates.html');
	assert.match(html, /v-show="state.combat.page_tab === 'character' && !state.combat.tutorial\?\.complete/);
});
test('inventory ignores retired catalogs, clears legacy navigation and keeps tutorial selection server-owned', async () => {
	const view=create_combat_view(); view.page_tab='test_combat'; view.encounter='practice_recruit_1';
	let tutorial={complete:true}; const paths=[];
	const inventory=create_combat_inventory({view,scope:()=> 'test',access:tutorial_access,request:async path=>{
		paths.push(path);return {foods:[],practice:[{tiers:[{}]}],tutorial};
	}});
	assert.equal(await inventory.refresh(),true);
	assert.equal(view.page_tab,'character'); assert.equal(view.encounter,'');
	assert.equal(view.practice,undefined); assert.ok(paths.every(path=>!path.includes('practice_catalog')));
	tutorial={complete:false,ready:true,trial:{id:'tutorial_7'}};
	await inventory.refresh(); assert.equal(view.encounter,'tutorial_7'); assert.equal(view.mode,'once');
});
test('every shipped locale matches the remaining Colosseum keys and removes retired navigation', () => {
	const en=JSON.parse(read('mod/data/lang/en.json'));
	for(const file of readdirSync(new URL('../../mod/data/lang/',import.meta.url))) {
		const locale=JSON.parse(read('mod/data/lang/'+file));
		assert.deepEqual(Object.keys(locale).filter(key=>key.startsWith('MOD_MP_COMBAT_')).sort(),Object.keys(en).filter(key=>key.startsWith('MOD_MP_COMBAT_')).sort(),file);
		assert.equal(locale.MOD_MP_COMBAT_TAB_TEST_COMBAT,undefined,file);
		assert.equal(locale.MOD_MP_COMBAT_TAB_BATTLES,undefined,file);
		assert.ok(!Object.keys(locale).some(key=>key.startsWith('MOD_MP_COMBAT_PRACTICE_')),file);
		for(const key of ['MOD_MP_GUIDE_COMBAT_HOW_TO','MOD_MP_COMBAT_CAP_LOCKED','MOD_MP_COMBAT_TAB_CHARACTER','MOD_MP_COMBAT_TAB_PVP','MOD_MP_COMBAT_TAB_RAID']) assert.ok(locale[key],file+': '+key);
	}
});
