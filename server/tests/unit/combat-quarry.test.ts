import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { combat_state, reserve_combat, update_combat } from '../../combat-inventory';
import { combat_unlocks, grant_raid_tier } from '../../combat-unlocks';
import { create_run, step_run, run_command, valid_run } from '../../combat/runs';
import { parse_registration, type Registration } from '../../combat/catalog';
import { apply_effect, trigger_effects, remove_effect_source } from '../../combat/effects';
import { apply_chamber_effects, chamber_effect_matches } from '../../combat/chambers';
import { DUNGEONS, IRON_HEAT, quarry_boundaries } from '../../combat/raids';
import type { Arena } from '../../combat/engine';

function loadout(level = 21, weapon = 'Sword', weapon_material = 'Steel', armor = 'Steel'): Registration {
	return parse_registration({ levels: { attack:level, strength:level, defence:level, hitpoints:level },
		gear:Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'].filter(slot=>slot!=='Shield'||weapon!=='2H_Sword').map(slot=>
			[slot,`melvorD:${slot==='Weapon'?weapon_material:armor}_${slot==='Weapon'?weapon:slot}`])) })!;
}
function spawn(arena: Arena) { while(arena.run!.phase==='respawning') step_run(arena); }
function advance(arena: Arena) { spawn(arena); arena.enemies.forEach(enemy=>enemy.hp=0); step_run(arena); }

test('quarry progression requires all Mire tiers and permanently grants Steel, caps23 and caps25 at 2/5/8', () => {
	const db=create_test_database(); try {
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'quarry','key','quarry','Runner','melvorD:Plant')");
		prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7');
		for(const t of [1,2]) grant_raid_tier(db,101,t,'mire');
		expect(reserve_combat(db,101,'owner','locked','quarry','raid')).toBeNull();
		grant_raid_tier(db,101,3,'mire');
		expect(combat_unlocks(db,101).material_caps.Weapon).toBe(2);
		for(const mode of ['once','repeat','playlist']) expect(valid_run('quarry',mode)).toBe(false);
		expect(valid_run('quarry','raid')).toBe(true);
		for(const endpoint of [1,2,3]) {
			const id='quarry-'+endpoint, boundary=quarry_boundaries[endpoint-1];
			expect(reserve_combat(db,101,'owner',id,'quarry','raid')?.raid_endpoint).toBe(endpoint);
			for(let i=1;i<=boundary;i++) expect(update_combat(db,'owner',id,0,i===boundary?'victory':'active',i,Date.now()+5000)).toBe(true);
			expect(update_combat(db,'owner',id,0,'victory',boundary)).toBe(true);
			expect(combat_unlocks(db,101)).toMatchObject({skill_caps:{attack:[21,23,25][endpoint-1],ranged:1,magic:1},material_caps:{Weapon:3,Shield:3,Helmet:3,Platebody:3,Quiver:0},food_cap:1,auto_eat:false});
			expect(combat_state(db,101).dungeons.find(d=>d.id==='quarry')!.leaderboard.total).toBe(endpoint===3?1:0);
		}
		expect(db.query("SELECT wins FROM combat_raid_progress WHERE raid='quarry' ORDER BY tier").all()).toEqual([{wins:1},{wins:1},{wins:1}]);
		reserve_combat(db,101,'owner','fail','quarry','raid'); update_combat(db,'owner','fail',0,'defeat',0);
		expect(combat_unlocks(db,101).material_caps.Weapon).toBe(3);
	} finally {db.close();}
});

test('chamber matching is exact-material and slot-specific; neither weapons nor weaker materials qualify', () => {
	for(const material of ['Iron','Steel','Bronze']) {
		const reg=loadout(21,'Sword','Iron',material);
		expect(chamber_effect_matches(IRON_HEAT,reg)).toBe(material==='Iron');
	}
	for(const slot of IRON_HEAT.equipment!.slots) {
		const reg=loadout(); reg.gear[slot]='melvorD:Iron_'+slot;
		expect(chamber_effect_matches(IRON_HEAT,reg)).toBe(true);
	}
	expect(chamber_effect_matches(IRON_HEAT,{...loadout(),gear:{Weapon:'melvorD:Iron_Sword'}})).toBe(false);
	expect(chamber_effect_matches({id:'unconditional',effect:'slow'},loadout())).toBe(true);
});

test('persistent effects survive attacks, coexist without stacking and remove by source without erasing ordinary effects', () => {
	const arena=create_run(loadout(),{heal:50},'persistent','quarry','raid',3), actor=arena.player;
	const base=actor.interval;
	apply_chamber_effects(actor,[{id:'first',effect:'slow'},{id:'second',effect:'slow'}],arena.registration!,0,100);
	const slowed=actor.interval;
	expect(slowed).toBe(Math.ceil(base/100/.75)*100);
	apply_chamber_effects(actor,[{id:'first',effect:'slow'}],arena.registration!,0,100);
	expect(actor.effects).toHaveLength(2);
	apply_effect(actor,'slow','enemy',0,100);
	expect(actor.interval).toBe(slowed);
	apply_effect(actor,'burn','snake',0,100); expect(actor.interval).toBe(base);
	trigger_effects(actor,1,true,100); trigger_effects(actor,2,true,100);
	expect(actor.effects.every(e=>e.lifetime==='persistent')).toBe(true);
	expect(actor.interval).toBe(slowed);
	apply_effect(actor,'slow','enemy',2,100);
	remove_effect_source(actor,'chamber:first',2,100); remove_effect_source(actor,'chamber:second',2,100);
	expect(actor.effects).toHaveLength(1); expect(actor.effects[0].source).toBe('enemy');
	trigger_effects(actor,3,true,100); trigger_effects(actor,4,true,100); expect(actor.interval).toBe(base);
	for(const effect of ['poison','burn','bleed','freeze'] as const) {
		actor.effects=[];
		apply_chamber_effects(actor,[{id:'future',effect}],arena.registration!,0,100);
		for(let tick=1;tick<=60;tick++) trigger_effects(actor,tick,tick%10===0,100);
		expect(actor.effects[0]?.lifetime).toBe('persistent');
		remove_effect_source(actor,'chamber:future',60,100); expect(actor.effects).toHaveLength(0);
	}
});

test('any dungeon tier can declare persistent chamber effects without a dungeon-specific runtime branch', () => {
	const tier=DUNGEONS.golbins.tiers[0];
	const previous=tier.chamber_effects;
	try {
		tier.chamber_effects=[{id:'reusable',effect:'slow'}];
		const arena=create_run(loadout(),{heal:50},'generic','golbins','raid',1);
		spawn(arena);
		expect(arena.player.effects).toMatchObject([{id:'slow',source:'chamber:reusable',lifetime:'persistent'}]);
	} finally {tier.chamber_effects=previous;}
});

test('eight battles carry health and eating cooldown; Iron Slow starts only in combat in tiers II/III and cleans up', () => {
	const arena=create_run(loadout(21,'Sword','Iron','Iron'),{heal:50},'waves','quarry','raid',3);
	for(const [i,count] of [3,2,4,3,2,4,3,3].entries()) {
		expect(arena.player.effects).toEqual([]);
		expect(arena.enemies).toHaveLength(count);
		expect(new Set(arena.enemies.map(e=>e.id)).size).toBe(count);
		spawn(arena);
		expect(arena.player.effects.some(e=>e.id==='slow'&&e.lifetime==='persistent')).toBe(i>=2);
		const base=arena.player.base_interval_ticks*100;
		expect(arena.player.interval).toBe(i>=2?Math.ceil(base/100/.75)*100:base);
		for(const enemy of arena.enemies) expect(run_command(arena,'target',enemy.id)).toBe(true);
		arena.player.hp=180; arena.next_eat=arena.elapsed_ms/100+10;
		arena.enemies.forEach(e=>e.hp=0); step_run(arena);
		expect(arena.player.hp).toBe(180); expect(arena.player.effects).toEqual([]);
		if(i<7) expect(arena.next_eat).toBe(9);
	}
	expect(arena.status).toBe('victory');
	const fled=create_run(loadout(21,'Sword','Iron','Iron'),{heal:50},'flee','quarry','raid',3);
	advance(fled);advance(fled);spawn(fled);expect(fled.player.effects).toHaveLength(1);
	run_command(fled,'flee',null);expect(fled.player.effects).toEqual([]);
});

test('snake selects Poison OR Burn only on successful hits and never rerolls or refreshes an active result', () => {
	for(const roll of [.1,.25,.8]) {
		const arena=create_run(loadout(),{heal:50},'snake','quarry','raid',1);advance(arena);spawn(arena);
		const snake=arena.enemies.find(e=>e.id.startsWith('embercoil'))!;
		arena.player.next_attack=99999;arena.enemies.forEach(e=>e.next_attack=99999);
		const attack=(hit=true)=>{snake.next_attack=arena.elapsed_ms+100;let n=0;step_run(arena,()=>++n===1?(hit?0:.999999):n===2?0:roll);};
		attack(false);expect(arena.player.effects).toEqual([]);attack();
		expect(arena.player.effects.map(e=>e.id)).toEqual(roll<.2?['poison']:roll<.35?['burn']:[]);
		const effects=structuredClone(arena.player.effects);attack();expect(arena.player.effects).toEqual(effects);
	}
});

function simulate(registration:Registration,endpoint:number,stance:string,delay:number,seed:number,eating=true) {
	let state=seed,reaction=-1,tick=0;
	const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
	const arena=create_run(registration,{heal:50},'balance','quarry','raid',endpoint);
	run_command(arena,'stance',stance);
	for(;tick<14000&&arena.status==='active';tick++) {
		if(arena.run!.phase==='fighting') {
			const target=arena.enemies.filter(e=>e.hp>0).sort((a,b)=>{
				const priority=(id:string)=>id.startsWith('kiln_wisp')?0:id.startsWith('embercoil')?1:id.startsWith('cinder_snail')?2:3;
				return priority(a.id)-priority(b.id);
			})[0];
			if(target&&target.id!==arena.target) run_command(arena,'target',target.id);
		}
		if(eating&&tick%10===0&&arena.player.hp<=arena.player.max_hp*.65&&reaction<0) reaction=tick+delay;
		if(tick===reaction) {run_command(arena,'eat',null);reaction=-1;}
		step_run(arena,random);
	}
	return {win:arena.status==='victory',seconds:tick/10,completed:arena.run!.completed,eats:arena.food_used};
}

test.skipIf(process.env.MELVOR_COMBAT_BALANCE_TESTS!=='1')('quarry production-engine preparation and matched material balance',()=>{
	const failures: unknown[]=[];
	for(const endpoint of [1,2,3]) for(const stance of ['accurate','aggressive','defensive']) for(const weapon of ['Sword','Dagger','Scimitar','Battleaxe','2H_Sword']) for(const delay of [5,10,15]) {
		const rows=Array.from({length:20},(_,s)=>simulate(loadout(endpoint===3?23:21,weapon,endpoint===1?'Iron':'Steel',endpoint===1?'Iron':'Steel'),endpoint,stance,delay,s+1));
		const times=rows.filter(r=>r.win).map(r=>r.seconds).sort((a,b)=>a-b);
		console.log('quarry prepared',{endpoint,stance,weapon,delay,wins:times.length,median:times[Math.floor(times.length/2)],max:times.at(-1)});
		if(times.length<18) failures.push({endpoint,stance,weapon,delay,wins:times.length});
	}
	console.log("quarry preparation failures",failures);
	const material_medians=new Map<string,number>();
	for(const level of [21,23,25]) for(const variant of ['Steel','Iron','weapon','armor','Bronze','naked','one-piece','shield']) {
		const reg=loadout(level,'Sword',variant==='Iron'||variant==='weapon'?'Iron':'Steel',variant==='Iron'||variant==='armor'?'Iron':variant==='Bronze'?'Bronze':'Steel');
		if(variant==='naked') reg.gear={Weapon:reg.gear.Weapon};
		if(variant==='one-piece') reg.gear.Boots='melvorD:Iron_Boots';
		if(variant==='shield') reg.gear.Shield='melvorD:Iron_Shield';
		const rows=Array.from({length:40},(_,s)=>simulate(reg,3,'accurate',10,s+1));
		console.log('quarry material',{level,variant,wins:rows.filter(r=>r.win).length,median:rows.filter(r=>r.win).map(r=>r.seconds).sort((a,b)=>a-b)[20],completed:rows.map(r=>r.completed).sort((a,b)=>a-b)[20]});
		material_medians.set(level+':'+variant,rows.filter(r=>r.win).map(r=>r.seconds).sort((a,b)=>a-b)[20]);
	}
	for(const level of [21,23,25]) {
		const steel=material_medians.get(level+':Steel')!;
		for(const variant of ['Iron','armor','one-piece','shield']) expect(material_medians.get(level+':'+variant)!).toBeGreaterThan(steel*1.25);
		expect(material_medians.get(level+':weapon')!).toBeLessThan(steel*1.25);
	}
	for(const stance of ['accurate','aggressive','defensive']) for(const weapon of ['Sword','Dagger','Scimitar','Battleaxe','2H_Sword']) {
		const rows=Array.from({length:20},(_,s)=>simulate(loadout(25,weapon),3,stance,10,s+1));
		const times=rows.filter(r=>r.win).map(r=>r.seconds).sort((a,b)=>a-b);
		console.log('quarry maximum',{stance,weapon,wins:times.length,median:times[10],max:times.at(-1)});
		expect(times.length).toBeGreaterThanOrEqual(18);
		if(!['Battleaxe','2H_Sword'].includes(weapon)) {expect(times[10]).toBeGreaterThanOrEqual(300);expect(times[10]).toBeLessThanOrEqual(480);}
		const no_food=Array.from({length:20},(_,s)=>simulate(loadout(25,weapon),3,stance,10,s+1,false));
		expect(no_food.filter(r=>r.win).length).toBeLessThanOrEqual(2);
	}
	expect(failures).toEqual([]);
},120000);
