import { expect, test } from 'bun:test';
import { create_run, step_run, run_command } from '../../combat/runs';
import { parse_registration, type Registration } from '../../combat/catalog';
const balance_test = test.skipIf(process.env.MELVOR_COMBAT_BALANCE_TESTS !== '1');
function loadout(endpoint: number, weapon = 'Sword', weak = false): Registration {
	const level = weak ? 1 : [1,3,6][endpoint-1], material = !weak && endpoint===3 ? 'Iron' : 'Bronze';
	const slots = weak ? ['Weapon','Shield','Helmet','Platebody','Platelegs'] : endpoint===1 ? ['Weapon','Shield','Helmet','Platebody','Platelegs'] : ['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'];
	const gear = Object.fromEntries(slots.map(slot=>[slot,`melvorD:${material}_${slot==='Weapon'?weapon:slot}`]));
	const registration = parse_registration({levels:{attack:level,strength:level,defence:level,hitpoints:!weak&&endpoint===3?6:3},gear});
	if (!registration) throw new Error('Invalid balance loadout');
	return registration;
}
function simulate(registration: Registration, endpoint: number, stance: string, delay: number, seed: number, eating = true) {
	let state=seed, reaction=-1, tick=0;
	const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
	const arena=create_run(registration,{heal:30},'balance','golbins','raid',endpoint);
	run_command(arena,'stance',stance);
	for(;tick<18000&&arena.status==='active';tick++) {
		if (eating && tick%10===0 && arena.player.hp<=arena.player.max_hp*.65 && reaction<0) reaction=tick+delay;
		if(tick===reaction) {run_command(arena,'eat',null);reaction=-1;}
		step_run(arena,random);
	}
	return {win:arena.status==='victory',seconds:tick/10,eats:arena.food_used};
}
balance_test('authored raids support all melee stances, native weapon variants and delayed manual input', () => {
	for(const endpoint of [1,2,3]) for(const stance of ['accurate','aggressive','defensive']) for(const weapon of ['Sword','Dagger','Scimitar']) for(const delay of [5,10,15]) {
		const results=Array.from({length:100},(_,seed)=>simulate(loadout(endpoint,weapon),endpoint,stance,delay,seed+1));
		const wins=results.filter(row=>row.win), times=wins.map(row=>row.seconds).sort((a,b)=>a-b);
		console.log('raid balance',{endpoint,stance,weapon,reaction_ms:delay*100,wins:wins.length,median:times[Math.floor(times.length/2)]});
		expect(wins.length).toBeGreaterThanOrEqual(95);
		expect(wins.reduce((n,row)=>n+row.eats,0)).toBeGreaterThan(0);
	}
}, 120000);
balance_test('preparation meaningfully improves later full-run times; no-eating is unreliable', () => {
	for(const endpoint of [1,2,3]) for(const stance of ['accurate','aggressive','defensive']) {
		const intended=Array.from({length:100},(_,i)=>simulate(loadout(endpoint),endpoint,stance,10,i+1));
		const weaker=Array.from({length:100},(_,i)=>simulate(loadout(endpoint,'Sword',true),endpoint,stance,10,i+1));
		const no_eat=Array.from({length:100},(_,i)=>simulate(loadout(endpoint),endpoint,stance,10,i+1,false));
		const median=(rows:typeof intended)=>rows.filter(row=>row.win).map(row=>row.seconds).sort((a,b)=>a-b)[Math.floor(rows.filter(row=>row.win).length/2)]??1800;
		console.log('raid preparation',{endpoint,stance,intended:median(intended),weaker:median(weaker),weak_wins:weaker.filter(row=>row.win).length,no_eat_wins:no_eat.filter(row=>row.win).length});
		if(endpoint>1) expect(median(intended)).toBeLessThan(median(weaker)*.90);
		expect(no_eat.filter(row=>row.win).length).toBeLessThan(60);
	}
}, 60000);
