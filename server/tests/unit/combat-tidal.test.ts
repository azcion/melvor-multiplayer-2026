import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { reserve_combat, update_combat, combat_state } from '../../combat-inventory';
import { grant_raid_tier, combat_unlocks } from '../../combat-unlocks';
import { create_run, step_run, run_command, valid_run } from '../../combat/runs';
import { parse_registration } from '../../combat/catalog';
import { create_snapshot_stream } from '../../combat/snapshots';
import { tidal_waves } from '../../combat/raids';

test('Tidal admission requires original completion; boundary grants survive failure and replay', () => {
	const db=create_test_database(); try {
	db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'tidal','key','tidal','Runner','melvorD:Plant')");
	prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7');
	expect(reserve_combat(db,101,'owner','locked','tidal','raid')).toBeNull();
	for(const tier of [1,2,3]) grant_raid_tier(db,101,tier);
	expect(reserve_combat(db,101,'owner','practice','tidal','once')).toBeNull();
	expect(reserve_combat(db,101,'owner','first','tidal','raid')?.raid_endpoint).toBe(1);
	for(let i=1;i<=3;i++)expect(update_combat(db,'owner','first',0,i===3?'victory':'active',i,Date.now()+1000)).toBe(true);
	expect(update_combat(db,'owner','first',0,'victory',3)).toBe(true);
	expect(combat_unlocks(db,101)).toMatchObject({skill_caps:{attack:12,hitpoints:12},food_cap:2,material_caps:{Weapon:2},auto_eat:false});
	expect(reserve_combat(db,101,'owner','failed','tidal','raid')?.raid_endpoint).toBe(2);
	for(let i=1;i<=3;i++)expect(update_combat(db,'owner','failed',0,'active',i)).toBe(true);
	expect(update_combat(db,'owner','failed',0,'defeat',3)).toBe(true);
	expect(combat_unlocks(db,101).food_cap).toBe(2);
	expect(reserve_combat(db,101,'owner','full','tidal','raid')?.raid_endpoint).toBe(2);
	for(let i=1;i<=6;i++)expect(update_combat(db,'owner','full',0,i===6?'victory':'active',i,Date.now()+2000)).toBe(true);
	const state=combat_state(db,101);
	expect(state.dungeons.find(d=>d.id==='tidal')).toMatchObject({endpoint:2,tiers:[{complete:true},{complete:true}],leaderboard:{total:1}});
	expect(state.dungeons.find(d=>d.id==='golbins')!.tiers.every(t=>t.complete)).toBe(true);
	expect(combat_unlocks(db,101)).toMatchObject({skill_caps:{attack:15,hitpoints:15,ranged:1,magic:1},food_cap:2});
	expect(db.query("SELECT wins FROM combat_raid_progress WHERE raid='tidal' AND tier=1").get()).toEqual({wins:1});
	}finally{db.close();}
});

test('all six waves retain unique selectable IDs and carried health; boss has exactly eight limbs', () => {
	expect(valid_run('tidal','once')).toBe(false); expect(valid_run('tidal','raid')).toBe(true);
	const arena=create_run({levels:{attack:9,strength:9,defence:9,hitpoints:9},gear:{}},{heal:30},'tidal','tidal','raid',2);
	arena.player.hp=80;
	const stream=create_snapshot_stream();
	for(const [i,count] of [8,8,11,12,9,8].entries()) {
	const snapshot=stream.next(arena,i*10000);
	expect(snapshot.type).toBe('state');
	expect((snapshot as any).arena.enemies.length).toBe(count);
	expect(arena.enemies.reduce((sum,enemy)=>sum+enemy.stats.max_hit,0)).toBeLessThan(i < 3 ? 90 : 120);
	expect(arena.enemies.length).toBe(count);expect(new Set(arena.enemies.map(e=>e.id)).size).toBe(count);
	while(arena.run!.phase==='respawning')step_run(arena);
	if(i===5){expect(arena.enemies.every(e=>e.id.startsWith('undertide_tendril_'))).toBe(true);expect(new Set(arena.enemies.map(e=>e.next_attack)).size).toBe(8);}
	for(const enemy of arena.enemies){expect(run_command(arena,'target',enemy.id)).toBe(true);enemy.hp=0;}
	step_run(arena);expect(arena.player.hp).toBe(80);
	}
	expect(arena.status).toBe('victory');expect(tidal_waves(2)).toHaveLength(6);
});

test.skipIf(process.env.MELVOR_COMBAT_BALANCE_TESTS !== '1')('prepared Iron builds remain viable under stronger accuracy and delayed manual eating', () => {
	for(const endpoint of [1,2])for(const stance of ['accurate','aggressive','defensive'])for(const weapon of ['Sword','Dagger','Scimitar'])for(const delay of [5,10,15]){
	const level=endpoint===1?9:12;
	const gear=Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'].map(slot=>[slot,`melvorD:Iron_${slot==='Weapon'?weapon:slot}`]));
	const registration=parse_registration({levels:{attack:level,strength:level,defence:level,hitpoints:level},gear})!;
	const times:number[]=[],foods:number[]=[];
	for(let seed=1;seed<=30;seed++){
	let state=seed,reaction=-1,tick=0;
	const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
	const arena=create_run(registration,{heal:endpoint===1?30:50},'balance','tidal','raid',endpoint);
	run_command(arena,'stance',stance);
	for(;tick<8800&&arena.status==='active';tick++){
	if(tick%10===0&&arena.player.hp<=arena.player.max_hp*.65&&reaction<0)reaction=tick+delay;
	if(tick===reaction){run_command(arena,'eat',null);reaction=-1;}
	step_run(arena,random);
	}
	if(arena.status==='victory'){times.push(tick/10);foods.push(arena.food_used);}
	}
	expect(times.length).toBeGreaterThanOrEqual(delay===15?21:24);
	times.sort((a,b)=>a-b);
	console.log('tidal balance',{endpoint,stance,weapon,delay:delay*100,wins:times.length,median:times[15],max:times.at(-1),food:foods[15]});
	}
},60000);


test('Tidal accuracy threatens full Iron while armour and defensive stance still matter', () => {
	for (const level of [9,12]) {
		const levels={attack:level,strength:level,defence:level,hitpoints:level};
		const iron=Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'].map(slot=>[slot,`melvorD:Iron_${slot==='Weapon'?'Sword':slot}`]));
		const tutorial={Weapon:'melvorD:Bronze_Sword',Helmet:'melvorD:Bronze_Helmet',Shield:'melvorD:Iron_Shield'};
		const prepared=create_run(parse_registration({levels,gear:iron})!,{heal:30},'prepared','tidal','raid',2);
		const weak=create_run(parse_registration({levels,gear:tutorial})!,{heal:30},'weak','tidal','raid',2);
		for(let wave=0;wave<6;wave++) {
			for(const enemy of prepared.enemies) {
				expect(enemy.stats.hit_chance).toBeGreaterThan(.6);
				expect(weak.enemies.find(row=>row.id===enemy.id)!.stats.hit_chance).toBeGreaterThan(enemy.stats.hit_chance);
			}
			const before=prepared.enemies[0].stats.hit_chance;
			run_command(prepared,'stance','defensive');
			expect(prepared.enemies[0].stats.hit_chance).toBeLessThan(before);
			run_command(prepared,'stance','accurate');
			for(const arena of [prepared,weak]) {
				while(arena.run!.phase==='respawning')step_run(arena);
				for(const enemy of arena.enemies)enemy.hp=0;
				step_run(arena);
			}
		}
	}
});
