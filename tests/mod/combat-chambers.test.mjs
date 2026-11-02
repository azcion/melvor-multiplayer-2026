import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { combat_raid_tiers, combat_effect_remaining, combat_material_gains, combat_choices, combat_actor_image_style } from '../../mod/combat-arena.mjs';
const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
const html=await readFile(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
const en=JSON.parse(await readFile(new URL('../../mod/data/lang/en.json',import.meta.url),'utf8'));

test('quarry rewards distinguish material access from cap rewards and announce only confirmed new access',()=>{
	const tiers=combat_raid_tiers(null,2,{tiers:[{cap:21,material_cap:3,complete:true},{cap:23,chamber_effects:[{id:'heat',effect:'slow'}]},{cap:25}]});
	assert.deepEqual(tiers[0].gains,[]);assert.equal(tiers[0].material_cap,3);
	assert.equal(tiers[1].gains.length,4);assert.equal(tiers[1].chamber_effects[0].effect,'slow');
	const before={material_caps:{Weapon:2,Shield:2,Quiver:0}},after={material_caps:{Weapon:3,Shield:3,Quiver:0}};
	assert.deepEqual(combat_material_gains(before,after),[{tier:3,slots:['Weapon','Shield']}]);
	for(const [a,b] of [[null,after],[before,null],[after,after]]) assert.deepEqual(combat_material_gains(a,b),[]);
	assert.ok(html.includes('state.combat_material_access(tier.material_cap)'));
	assert.ok(html.includes('state.combat.result.materials?.length'));
});

test('persistent effect labels and descriptions never claim an attack countdown; chamber conditions name exact material and slots',()=>{
	const state={combat_name:id=>en['MOD_MP_COMBAT_'+id.toUpperCase()],equipment_slot_name:String,equipment_tier_name:()=> 'Steel'};
	const start=main.indexOf('\tstate.combat_effect_info =');
	const end=main.indexOf('\tstate.combat_effect_icon =',start);
	new Function('state','getLangString',main.slice(start,end))(state,key=>key.endsWith('_IRON')?'Iron':key);
	const effect={id:'slow',source:'chamber:heat',lifetime:'persistent',remaining_attacks:null,expires_tick:null};
	assert.equal(combat_effect_remaining(effect,{elapsed_ms:9000}),null);
	assert.equal(state.combat_effect_label(effect),'Chamber');
	assert.match(state.combat_effect_info(effect),/−25%.*throughout/);
	assert.doesNotMatch(state.combat_effect_info(effect),/2 attacks/);
	const text=state.combat_chamber_description({effect:'slow',equipment:{material:'Iron',slots:['Helmet','Shield']}});
	assert.match(text,/Iron/);assert.match(text,/Helmet, Shield/);assert.doesNotMatch(text,/Bronze|Steel|Weapon/);
	assert.equal(state.combat_chamber_description({effect:'burn'}),'Burn throughout each battle.');
	assert.match(html,/state\.combat\.arena\?\.chamber_effects/);
	assert.doesNotMatch(html,/tier\.chamber_effects/);
});

test('quarry portraits use native assets with intended filters and numbered actors resolve to their base identities',()=>{
	const state={combat:{},get_item_name:String};
	const start=main.indexOf('\tstate.combat_actor_image =');
	const end=main.indexOf('\tstate.combat_gear =',start);
	new Function('state','practice_module','assets',main.slice(start,end))(state,{practice_actor:()=>null},{getURI:path=>'resolved:'+path});
	for(const [id,path] of Object.entries({cinder_snail:'pets/harry.png',kiln_wisp:'monsters/fire_spirit.png',embercoil:'monsters/burning_snake.png',slagheart:'monsters/Lava_Golem.png'})) {
		assert.equal(state.combat_actor_image(id+'_1'),'resolved:assets/media/'+path);
		const filter = { kiln_wisp: 'hue-rotate(-10deg)', embercoil: 'hue-rotate(-20deg)' }[id];
		const expected_style = filter ? { '--mp-combat-image-filter': filter } : {};
		for (const actor of [id, id+'_1', id+'_2']) assert.deepEqual(combat_actor_image_style(actor), expected_style);
	}
	assert.deepEqual(combat_choices('raid').at(-1).actors,['cinder_snail','kiln_wisp','embercoil','slagheart']);
});

test('all locales include quarry identities and persistent chamber copy with intact substitution fields',async()=>{
	const keys=Object.keys(en).filter(key=>/MOD_MP_COMBAT_(QUARRY|CINDER_SNAIL|KILN_WISP|EMBERCOIL|SLAGHEART|CHAMBER|SLOW_PERSISTENT|PERSISTENT_INFO|MATERIAL_ACCESS)/.test(key));
	for(const file of await readdir(new URL('../../mod/data/lang/',import.meta.url))) {
		const locale=JSON.parse(await readFile(new URL('../../mod/data/lang/'+file,import.meta.url),'utf8'));
		for(const key of keys) {
			assert.ok(locale[key]?.length,`${file}: ${key}`);
			assert.deepEqual([...locale[key].matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(),[...en[key].matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(),`${file}: ${key}`);
		}
	}
});

test('battle start snapshots reactive cap maps and results use only settled inventory rewards', async () => {
	const combat_module = await import('../../mod/combat-arena.mjs');
	const { create_combat_inventory } = await import('../../mod/combat-inventory.mjs');
	const reactive = value => new Proxy(value, { get: (target, key) => target[key] && typeof target[key] === 'object' ? reactive(target[key]) : target[key] });
	const raw = { skill_caps: { attack: 21, strength: 21, defence: 21, hitpoints: 21 }, material_caps: { Weapon: 2, Shield: 2 } };
	const view = combat_module.create_combat_view();
	view.arena = { id: 'fight', status: 'victory', elapsed_ms: 120000 };
	view.unlocks = reactive(raw);
	assert.throws(() => structuredClone(view.unlocks), { name: 'DataCloneError' });
	let resolve_inventory;
	const combat_inventory = create_combat_inventory({ view, scope: () => 'server:1', can_mutate: () => true,
		request: () => new Promise(resolve => { resolve_inventory = resolve; }), reconcile: async () => true, wait: async () => {} });
	const start = main.match(/on_start: (\(\) => \{[\s\S]*?\n\t\t\}),\n\t\ton_state:/)[1];
	const result = main.match(/on_result: (async arena => \{[\s\S]*?\n\t\t\}),\n\t\ton_start:/)[1];
	const calls = [];
	const callbacks = new Function('state', 'combat_module', 'combat_inventory', 'queue_modal', 'getLangString', `
		let combat_start_caps = null, combat_start_unlocks = null;
		const server_host = 'server', session_generation = 1, combat_page_visible = false;
		return { start: ${start}, result: ${result}, snapshot: () => [combat_start_caps, combat_start_unlocks] };
	`)({ combat: view }, combat_module, combat_inventory, (...args) => calls.push(args), key => key);
	callbacks.start();
	raw.skill_caps.attack = 23; raw.material_caps.Weapon = 3;
	assert.equal(callbacks.snapshot()[0].attack, 21);
	assert.equal(callbacks.snapshot()[1].material_caps.Weapon, 2);
	assert.doesNotThrow(() => structuredClone(callbacks.snapshot()));
	const work = callbacks.result(view.arena);
	assert.equal(calls.length, 0);
	resolve_inventory({ foods: [], history: [{ id: 'fight', status: 'victory' }], unlocks: {
		skill_caps: { attack: 23, strength: 21, defence: 21, hitpoints: 21 }, material_caps: { Weapon: 3, Shield: 3 }
	} });
	await work;
	assert.deepEqual(view.result.unlocks, [{ skill: 'attack', cap: 23 }]);
	assert.deepEqual(view.result.materials, [{ tier: 3, slots: ['Weapon', 'Shield'] }]);
	// A replay with the now-confirmed baseline announces no new rewards.
	callbacks.start(); await callbacks.result(view.arena);
	assert.deepEqual(view.result.unlocks, []); assert.deepEqual(view.result.materials, []);
	// Even increased cached caps cannot be announced when settlement fails.
	const failed = new Function('state', 'combat_module', 'combat_inventory', 'queue_modal', 'getLangString', `
		const server_host = 'server', session_generation = 1;
		const combat_start_caps = { attack: 1 }, combat_start_unlocks = { material_caps: { Weapon: 1 } };
		return (${result});
	`)({ combat: view }, combat_module, { settle: async () => false }, () => {}, key => key);
	await failed(view.arena);
	assert.deepEqual(view.result.unlocks, []); assert.deepEqual(view.result.materials, []);
});

test('effect damage feedback uses accessible effect icons and signed amounts in both actor views', () => {
	const feedback = [...html.matchAll(/<div class="mp-combat-feedback"[^>]*>(.*?)<\/div>/g)].map(match => match[1]);
	assert.equal(feedback.length, 2);
	for (const block of feedback) {
		assert.match(block, /v-if="state.combat_effect_ids.includes\(event.kind\)" :src="state.combat_effect_image\(event.kind\)" :alt="state.combat_event_name\(event.kind\)" :title="state.combat_event_name\(event.kind\)"/);
		const expression = block.match(/{{ (.*?) }}/)[1].replaceAll('&amp;', '&');
		const render = new Function('event', 'state', `return ${expression}`);
		for (const kind of ['poison', 'bleed', 'burn']) assert.equal(render({ kind, amount: 2 }), '−2');
		assert.equal(render({ kind: 'heal', amount: 50 }), '+50');
		assert.equal(render({ kind: 'attack', amount: 0 }, { combat_name: () => 'Miss' }), 'Miss');
	}
});

test('enemy cards fill desktop rows and keep a lone opponent right without narrowing mobile cards', async () => {
	const css = await readFile(new URL('../../mod/ui/style.css', import.meta.url), 'utf8');
	assert.match(css, /\.mp-combat-enemies \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); grid-auto-flow: row; align-items: start; gap: .75rem; \}/);
	assert.match(css, /@media \(min-width: 768px\) \{\s*\.mp-combat-enemies > .mp-combat-actor:only-child \{ grid-column: 2; \}\s*\}/);
	assert.match(css, /@media \(max-width: 479.98px\) \{ .mp-combat-enemies \{ grid-template-columns: minmax\(0, 1fr\); \}/);
	assert.doesNotMatch(css, /\.mp-combat-enemies[^{}]*\{[^}]*(?:^|[;\s])columns:/);
	assert.match(css, /\.mp-combat-field \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 2fr\)/);
});

test('battle labels and dungeon previews hide application odds in every locale', async () => {
	assert.equal(en.MOD_MP_COMBAT_ON_HIT, 'Chance to apply');
	assert.match(html, /state.combat_name\('on_hit'\)/);
	assert.doesNotMatch(html, /state.combat_name\('quarry_effects'\)/);
	for (const file of await readdir(new URL('../../mod/data/lang/', import.meta.url))) {
		const locale = JSON.parse(await readFile(new URL('../../mod/data/lang/' + file, import.meta.url), 'utf8'));
		for (const key of ['ON_HIT', 'VINE_ROLE', 'TENDRIL_ROLE', 'ROOT_ROLE']) {
			assert.doesNotMatch(locale['MOD_MP_COMBAT_' + key], /%/, `${file}: ${key}`);
		}
	}
});
