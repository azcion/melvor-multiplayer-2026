import { expect, test } from 'bun:test';
import { PRACTICE_DEFINITIONS, PRACTICE_TIERS, type PracticeEncounter } from '../../combat/practice';
import { create_run, step_run, run_command } from '../../combat/runs';
import type { Registration } from '../../combat/catalog';
const balance_test=test.skipIf(process.env.MELVOR_COMBAT_BALANCE_TESTS!=='1');
function simulate(id:PracticeEncounter, tier:typeof PRACTICE_TIERS[number], stance:string, seed:number) {
	const level=tier.level;
	const material=tier.material;
	const gear=Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'].map(slot=>[slot,`melvorD:${material}_${slot==='Weapon'?'Sword':slot}`]));
	const registration:Registration={levels:{attack:level,strength:level,defence:level,hitpoints:tier.hitpoints},gear};
	// Sinking Mire opens the level-20 band while Iron/Herring remain the available preparation.
	const arena=create_run(registration,{heal:level>=60?180:level>=30?110:level>=12?50:30},'balance',id,'once');
	run_command(arena,'stance',stance);
	let state=seed,reaction=-1,tick=0;
	const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
	for(;tick<8400&&arena.status==='active';tick++){
		// Human-style delayed manual input; no auto-eat capability.
		if(tick%10===0&&arena.player.hp<=arena.player.max_hp*.65&&reaction<0)reaction=tick+10;
		if(tick===reaction){run_command(arena,'eat',null);reaction=-1;}
		step_run(arena,random);
	}
	return {win:arena.status==='victory',seconds:tick/10,eats:arena.food_used};
}
balance_test('all fixed Practice tiers are survivable with recommended preparation and delayed manual eating',()=>{
	for(const tier of PRACTICE_TIERS){
		const summary=[];
		for(const definition of PRACTICE_DEFINITIONS)for(const stance of ['accurate','aggressive','defensive']){
			const rows=Array.from({length:20},(_,i)=>simulate(`practice_${definition.id}_${tier.tier}`,tier,stance,i+1));
			const wins=rows.filter(row=>row.win),times=wins.map(row=>row.seconds).sort((a,b)=>a-b);
			summary.push({encounter:definition.id,stance,wins:wins.length,median:times[Math.floor(times.length/2)]});
			expect(wins.length,JSON.stringify({tier:tier.tier,encounter:definition.id,stance,rows})).toBeGreaterThanOrEqual(19);
			expect(Math.max(...times)).toBeLessThan(840);
		}
		console.log('Practice balance',tier.tier,JSON.stringify(summary));
	}
},120000);
