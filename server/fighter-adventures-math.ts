import { registration_stats, type Registration } from './combat/catalog';
import { food_access, FOOD_DEFINITIONS } from './combat-food';
import { apply_player_incoming_damage, apply_player_outgoing_damage, hit_chance, standard_evasion, standard_melee_max_hit, standard_stat } from './combat/melee-math';
import type { AdventureCatalog, AdventureMonster } from './fighter-adventures-catalog';
import type { Database } from 'bun:sqlite';

// Exact finite-HP expectation, including misses, floored triangle damage and overkill.
export function expected_attacks(hp:number,max:number,chance:number,transform:(damage:number)=>number):number {
	const probabilities=new Map<number,number>();
	for(let d=1;d<=max;d++) { const hit=transform(d);probabilities.set(hit,(probabilities.get(hit)??0)+chance/max); }
	const positive=1-(1-chance+(probabilities.get(0)??0));
	if(positive<=0)return Infinity;
	const expected=new Float64Array(hp+1);
	for(let h=1;h<=hp;h++) {let sum=1;for(const [d,p]of probabilities)if(d>0)sum+=p*expected[Math.max(0,h-d)];expected[h]=sum/positive;}
	return expected[hp];
}
export function adventure_heal(database:Database,client:number):number {
	const selected=food_access(database,client)?.equipped_item;
	return FOOD_DEFINITIONS.find(f=>f.item_id===selected)?.heal??0;
}
function compute_estimate(loadout:Registration|null,heal:number,m:AdventureMonster,catalog:AdventureCatalog) {
	if(m.unmodeled_mechanics || m.attackType==='magic')return {eligible:false,reason:'Not available yet',seconds:0,max_hit:0,incoming_dps:0};
	if(!loadout)return {eligible:false,reason:'Prepare your Fighter first.',seconds:0,max_hit:0,incoming_dps:0};
	const player=registration_stats(loadout);
	const stats=Object.fromEntries(m.equipmentStats.map(s=>[s.key,s.value]));
	const ranged=m.attackType==='ranged';
	const max=standard_melee_max_hit(m.levels[ranged?'Ranged':'Strength'],stats[ranged?'rangedStrengthBonus':'meleeStrengthBonus']??0);
	const incomingMax=apply_player_incoming_damage(max,'melee',m.attackType,player.resistance);
	let average=0;for(let d=1;d<=max;d++)average+=apply_player_incoming_damage(d,'melee',m.attackType,player.resistance)/max;
	const chance=hit_chance(standard_stat(m.levels[ranged?'Ranged':'Attack'],stats[ranged?'rangedAttackBonus':'stabAttackBonus']??0),player.evasion[m.attackType]);
	const dps=chance*average/(Math.max(250,stats.attackSpeed??4000)/1000);
	const reason=loadout.levels.hitpoints*10<=incomingMax?'More Hitpoints required.':dps>0&&!heal?'Select food in your first food slot.':dps>=heal&&dps>0?'Selected food cannot keep up with incoming damage.':'';
	const attacks=expected_attacks(m.levels.Hitpoints*10,player.max_hit,hit_chance(player.accuracy,standard_evasion(m.levels.Defence,stats.meleeDefenceBonus??0)),d=>apply_player_outgoing_damage(d,'melee',m.attackType,0));
	const fight=attacks*player.interval/1000;
	const seconds=(catalog.spawn_ms/1000+fight+(dps>0&&heal>dps?fight*dps/(heal-dps):0))/catalog.pace;
	return {eligible:!reason&&Number.isFinite(seconds),reason,seconds,max_hit:incomingMax,incoming_dps:dps};
}

// Bounded shared cache: state reads and repeated checks reuse the expensive HP expectation.
const estimate_cache=new Map<string,ReturnType<typeof compute_estimate>>();
export function estimate_monster(loadout:Registration|null,heal:number,m:AdventureMonster,catalog:AdventureCatalog) {
 const key=JSON.stringify([loadout,heal,m,catalog.pace,catalog.spawn_ms]);
 const cached=estimate_cache.get(key);if(cached)return cached;
 const value=compute_estimate(loadout,heal,m,catalog);
 if(estimate_cache.size>=128)estimate_cache.delete(estimate_cache.keys().next().value!);
 estimate_cache.set(key,value);return value;
}
