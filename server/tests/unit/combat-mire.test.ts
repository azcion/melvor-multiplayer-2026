import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { reserve_combat, update_combat, combat_state } from '../../combat-inventory';
import { grant_raid_tier, combat_unlocks } from '../../combat-unlocks';
import { create_run, step_run, run_command, valid_run } from '../../combat/runs';
import { parse_registration, type Registration } from '../../combat/catalog';
import { refresh_stance, step, type Arena } from '../../combat/engine';
import { apply_effect } from '../../combat/effects';
import { create_snapshot_stream } from '../../combat/snapshots';
import { mire_waves, MIRE_RULESET } from '../../combat/raids';

function loadout(level = 15, weapon = 'Sword', weapon_material = 'Iron', armor = 'Iron'): Registration {
	return parse_registration({levels:{attack:level,strength:level,defence:level,hitpoints:level},
		gear:Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'].filter(slot => slot !== 'Shield' || weapon !== '2H_Sword').map(slot =>
			[slot,`melvorD:${slot === 'Weapon' ? weapon_material : armor}_${slot === 'Weapon' ? weapon : slot}`]))})!;
}
function spawn(arena: Arena) {
	while (arena.run!.phase === 'respawning') step_run(arena);
}
function advance(arena: Arena) {
	spawn(arena);
	for (const enemy of arena.enemies) enemy.hp = 0;
	step_run(arena);
}

test('Mire requires Tidal completion, grants only 17/19/21 caps and preserves boundary rewards and records', () => {
	const db = create_test_database();
	try {
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'mire','key','mire','Runner','melvorD:Plant')");
		prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7');
		for (const tier of [1,2,3]) grant_raid_tier(db,101,tier);
		expect(reserve_combat(db,101,'owner','locked','mire','raid')).toBeNull();
		grant_raid_tier(db,101,1,'tidal');
		expect(combat_state(db,101).dungeons.find(d => d.id === 'mire')!.available).toBe(false);
		grant_raid_tier(db,101,2,'tidal');
		expect(reserve_combat(db,101,'owner','wrong-mode','mire','once')).toBeNull();
		for (const endpoint of [1,2,3]) {
			const id = 'mire-' + endpoint, waves = endpoint * 2;
			expect(reserve_combat(db,101,'owner',id,'mire','raid')?.raid_endpoint).toBe(endpoint);
			for (let i=1; i<=waves; i++) expect(update_combat(db,'owner',id,0,i === waves ? 'victory' : 'active',i,Date.now()+2000)).toBe(true);
			expect(update_combat(db,'owner',id,0,'victory',waves)).toBe(true);
			expect(combat_unlocks(db,101)).toMatchObject({skill_caps:{attack:15+endpoint*2,strength:15+endpoint*2,defence:15+endpoint*2,hitpoints:15+endpoint*2,ranged:1,magic:1},food_cap:2,material_caps:{Weapon:2,Shield:2},auto_eat:false});
			expect(combat_state(db,101).dungeons.find(d=>d.id==='mire')!.leaderboard.total).toBe(endpoint === 3 ? 1 : 0);
			if (endpoint < 3) {
				const fail = id + '-failed';
				reserve_combat(db,101,'owner',fail,'mire','raid');
				for (let i=1; i<=waves; i++) expect(update_combat(db,'owner',fail,0,'active',i)).toBe(true);
				expect(update_combat(db,'owner',fail,0,'defeat',waves)).toBe(true);
				expect(combat_unlocks(db,101).skill_caps.attack).toBe(15+endpoint*2);
			}
		}
		expect(db.query("SELECT wins FROM combat_raid_progress WHERE raid='mire' ORDER BY tier").all()).toEqual([{wins:1},{wins:1},{wins:1}]);
		expect(combat_state(db,101).dungeons.find(d=>d.id==='tidal')!.tiers.every(t=>t.complete)).toBe(true);
	} finally { db.close(); }
});

test('six Mire waves have unique selectable targets, poison capability and carried health/cooldowns', () => {
	for (const mode of ['once','repeat','playlist']) expect(valid_run('mire',mode)).toBe(false);
	expect(valid_run('mire','raid')).toBe(true);
	expect(mire_waves(3)).toHaveLength(6);
	const arena = create_run(loadout(),{heal:50},'mire','mire','raid',3);
	const stream = create_snapshot_stream();
	for (const [i,count] of [3,3,4,4,3,4].entries()) {
		expect(arena.ruleset).toBe(MIRE_RULESET);
		expect(arena.run!.tier).toBe(Math.floor(i/2)+1);
		expect(arena.enemies).toHaveLength(count);
		expect(new Set(arena.enemies.map(e=>e.id)).size).toBe(count);
		expect((stream.next(arena,i*10000) as any).arena.enemies).toHaveLength(count);
		expect(arena.player.possible_effects).toEqual(i === 0 || i === 2 ? [] : ['poison']);
		spawn(arena);
		const blobs = arena.enemies.filter(e=>e.id.startsWith('blob_'));
		expect(new Set(blobs.map(e=>e.next_attack)).size).toBe(blobs.length);
		for (const enemy of arena.enemies) expect(run_command(arena,'target',enemy.id)).toBe(true);
		arena.player.hp = 90;
		arena.next_eat = arena.elapsed_ms / 100 + 10;
		if (i === 1) apply_effect(arena.player,'poison','bittertoad_1',arena.elapsed_ms/100,100);
		for (const enemy of arena.enemies) enemy.hp = 0;
		step_run(arena);
		expect(arena.player.hp).toBe(90);
		expect(arena.player.effects).toEqual([]);
		if (i < 5) expect(arena.next_eat).toBe(9);
	}
	expect(arena.status).toBe('victory');
});

test('Bronze corrosion caps actual and displayed hits at one without turning misses into damage', () => {
	for (const material of ['Bronze','Iron']) {
		const arena = create_run(loadout(15,'Sword',material),{heal:50},material,'mire','raid');
		arena.run!.phase = 'fighting';
		for (const enemy of arena.enemies) enemy.next_attack = 99999;
		expect(arena.enemies[0].player_max_hit).toBe(material === 'Bronze' ? 1 : arena.player.base_damage!.max_hit);
		expect(arena.player.stats.max_hit).toBe(arena.enemies[0].player_max_hit!);
		arena.player.next_attack = 100;
		step(arena,()=>.25);
		expect(arena.log.at(-1)!.amount).toBe(material === 'Bronze' ? 1 : 1+Math.floor(arena.player.base_damage!.max_hit*.25));
		arena.player.next_attack = arena.elapsed_ms + 100;
		step(arena,()=>.999999);
		expect(arena.log.at(-1)!.amount).toBe(0);
		advance(arena);
		spawn(arena);
		run_command(arena,'target','bittertoad_1');
		expect(arena.player.stats.max_hit).toBe(arena.player.base_damage!.max_hit);
		run_command(arena,'target','blob_1');
		expect(arena.player.stats.max_hit).toBe(material === 'Bronze' ? 1 : arena.player.base_damage!.max_hit);
	}
	const wooden = loadout(); wooden.gear.Weapon = 'multiplayer:Wooden_Sword';
	const arena = create_run(wooden,{heal:50},'wooden','mire','raid');
	expect(arena.player.stats.max_hit).toBeGreaterThan(1);
});

test('Blob ignores only Bronze armor evasion, preserving Iron, Wooden shields, levels, stance and damage per hit', () => {
	const bronze = create_run(loadout(15,'Sword','Iron','Bronze'),{heal:50},'bronze','mire','raid');
	const bare = create_run({...loadout(),gear:{Weapon:'melvorD:Iron_Sword'}},{heal:50},'bare','mire','raid');
	const iron = create_run(loadout(),{heal:50},'iron','mire','raid');
	expect(bronze.enemies[0].stats).toEqual(bare.enemies[0].stats);
	expect(iron.enemies[0].stats.hit_chance).toBeLessThan(bronze.enemies[0].stats.hit_chance);
	expect(iron.enemies[0].stats.max_hit).toBe(bronze.enemies[0].stats.max_hit);
	bronze.registration!.gear.Shield = 'melvorD:Iron_Shield'; refresh_stance(bronze);
	expect(bronze.enemies[0].stats.hit_chance).toBeLessThan(bare.enemies[0].stats.hit_chance);
	const chance = bronze.enemies[0].stats.hit_chance;
	run_command(bronze,'stance','defensive');
	expect(bronze.enemies[0].stats.hit_chance).toBeLessThan(chance);
	bronze.registration!.gear.Shield = 'multiplayer:Wooden_Shield'; refresh_stance(bronze);
	const wooden_chance = bronze.enemies[0].stats.hit_chance;
	delete bronze.registration!.gear.Shield; refresh_stance(bronze);
	expect(wooden_chance).toBeLessThan(bronze.enemies[0].stats.hit_chance);
	advance(bronze); advance(bare);
	expect(bronze.enemies.find(e=>e.id==='bittertoad_1')!.stats.hit_chance).toBeLessThan(bare.enemies.find(e=>e.id==='bittertoad_1')!.stats.hit_chance);
});

test('Bittertoad procs poison on a hit, cannot refresh it, and manual eating remains available', () => {
	const arena = create_run(loadout(),{heal:50},'poison','mire','raid',2);
	advance(arena);
	spawn(arena);
	const toad = arena.enemies.find(e=>e.id==='bittertoad_1')!;
	for (const enemy of arena.enemies) enemy.next_attack = 99999;
	arena.player.next_attack = 99999;
	toad.next_attack = arena.elapsed_ms+100;
	step_run(arena,()=>0);
	expect(arena.player.effects.map(e=>e.id)).toEqual(['poison']);
	const expiry = arena.player.effects[0].expires_tick;
	toad.next_attack = arena.elapsed_ms+100; step_run(arena,()=>0);
	expect(arena.player.effects).toHaveLength(1);
	expect(arena.player.effects[0].expires_tick).toBe(expiry);
	arena.player.hp = 90;
	expect(run_command(arena,'eat',null)).toBe(true);
	expect(arena.player.hp).toBe(140);
});

function simulate(registration: Registration, endpoint: number, stance: string, delay: number, seed: number, opening = false, eating = true) {
	let state=seed, reaction=-1, tick=0;
	const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
	const arena=create_run(registration,{heal:50},'balance','mire','raid',endpoint);
	run_command(arena,'stance',stance);
	for (;tick<8800 && arena.status==='active' && !(opening && arena.run!.completed);tick++) {
		if (eating && tick%10===0 && arena.player.hp<=arena.player.max_hp*.65 && reaction<0) reaction=tick+delay;
		if (tick===reaction) {run_command(arena,'eat',null);reaction=-1;}
		step_run(arena,random);
	}
	return {win:opening ? arena.run!.completed>0 : arena.status==='victory',seconds:tick/10,eats:arena.food_used};
}

test.skipIf(process.env.MELVOR_COMBAT_BALANCE_TESTS !== '1')('Mire prepared endpoints and Bronze opening wall use production combat with delayed manual eating', () => {
	for (const endpoint of [1,2,3]) for (const stance of ['accurate','aggressive','defensive']) for (const weapon of ['Sword','Dagger','Scimitar','Battleaxe','2H_Sword']) for (const delay of [5,10,15]) {
		const rows=Array.from({length:20},(_,seed)=>simulate(loadout([15,17,19][endpoint-1],weapon),endpoint,stance,delay,seed+1));
		const times=rows.filter(r=>r.win).map(r=>r.seconds).sort((a,b)=>a-b);
		console.log('mire prepared',{endpoint,stance,weapon,delay:delay*100,wins:times.length,median:times[Math.floor(times.length/2)],max:times.at(-1),eats:rows.map(r=>r.eats).sort((a,b)=>a-b)[10]});
		expect(times.length).toBeGreaterThanOrEqual(18);
	}
	for (const level of [15,21]) for (const stance of ['accurate','aggressive','defensive']) for (const weapon of ['Sword','Dagger','Scimitar','Battleaxe','2H_Sword']) for (const variant of ['Bronze','weapon','armor','Iron']) {
		const rows=Array.from({length:20},(_,seed)=>simulate(loadout(level,weapon,variant==='Bronze'||variant==='weapon'?'Bronze':'Iron',variant==='Bronze'||variant==='armor'?'Bronze':'Iron'),1,stance,10,seed+1,true));
		console.log('mire opening',{level,stance,weapon,variant,wins:rows.filter(r=>r.win).length,median:rows.map(r=>r.seconds).sort((a,b)=>a-b)[10],eats:rows.map(r=>r.eats).sort((a,b)=>a-b)[10]});
		if (variant==='Bronze'||variant==='weapon') expect(rows.filter(r=>r.win).length).toBeLessThanOrEqual(2);
		if (variant==='Iron') expect(rows.filter(r=>r.win).length).toBeGreaterThanOrEqual(18);
	}
	for (const stance of ['accurate','aggressive','defensive']) for (const weapon of ['Sword','Dagger','Scimitar','Battleaxe','2H_Sword']) {
		const rows=Array.from({length:20},(_,seed)=>simulate(loadout(21,weapon),3,stance,10,seed+1));
		const times=rows.filter(r=>r.win).map(r=>r.seconds).sort((a,b)=>a-b);
		console.log('mire maximum preparation',{stance,weapon,wins:times.length,median:times[10],max:times.at(-1)});
		expect(times.length).toBeGreaterThanOrEqual(18);
		expect(times[10]).toBeGreaterThan(180);
		// Slow windups lose more attack progress to eating; 2H also gives up the shield.
		// The roughly-five-minute target uses the prepared one-handed builds, not every loadout.
		expect(times[10]).toBeLessThan(['Battleaxe','2H_Sword'].includes(weapon) ? 660 : 420);
		expect(times.at(-1)!).toBeLessThan(880);
		const without_food=Array.from({length:20},(_,seed)=>simulate(loadout(21,weapon),3,stance,10,seed+1,false,false));
		expect(without_food.filter(r=>r.win).length).toBeLessThanOrEqual(2);
	}
},120000);
