import {test,expect} from 'bun:test';
import {ADVENTURE_CATALOG,validate_adventure_catalog} from '../../fighter-adventures-catalog';
import {estimate_monster,expected_attacks} from '../../fighter-adventures-math';
import {sample_binomial,sample_loot,sample_quantity} from '../../fighter-adventures-loot';
const monster=ADVENTURE_CATALOG.areas[0].monsters[0];
const loadout={levels:{attack:1,strength:1,defence:1,hitpoints:3},gear:{}};
test('base-game catalog gates magic and special mechanics and pins original data provenance',()=>{
 expect(ADVENTURE_CATALOG.areas).toHaveLength(12);
 const monsters=ADVENTURE_CATALOG.areas.flatMap(a=>a.monsters);
 expect(monsters).toHaveLength(42);
 expect(monsters.filter(m=>m.unmodeled_mechanics)).toHaveLength(13);
 for(const m of monsters.filter(m=>m.unmodeled_mechanics)) expect(estimate_monster(loadout,999,m,ADVENTURE_CATALOG).eligible).toBe(false);
 const wizard=monsters.find(m=>m.attackType==='magic')!;
 expect(()=>validate_adventure_catalog({...ADVENTURE_CATALOG,areas:[{id:'melvorD:Test',name:'Test',monsters:[{...wizard,unmodeled_mechanics:undefined}]}]})).toThrow();
 expect(()=>validate_adventure_catalog({...ADVENTURE_CATALOG,pace:Infinity})).toThrow();
});
test('finite HP expectation includes misses and overkill',()=>{
 expect(expected_attacks(2,1,.5,d=>d)).toBe(4);
 expect(expected_attacks(1,100,1,d=>d)).toBeCloseTo(1);
});
test('admission requires HP and selected food; Defence improves sustained healing and pace',()=>{
 expect(estimate_monster(loadout,0,monster,ADVENTURE_CATALOG).eligible).toBe(false);
 const base=estimate_monster(loadout,30,monster,ADVENTURE_CATALOG);
 expect(base.eligible).toBe(true);
 expect(estimate_monster({...loadout,levels:{...loadout.levels,hitpoints:1}},30,monster,ADVENTURE_CATALOG).eligible).toBe(false);
 const defence=estimate_monster({...loadout,levels:{...loadout.levels,defence:99}},30,monster,ADVENTURE_CATALOG);
 expect(defence.incoming_dps).toBeLessThan(base.incoming_dps);expect(defence.seconds).toBeLessThan(base.seconds);
});
test('binomial endpoints, exact small distributions, large-n stability and bounded work',()=>{
 expect(sample_binomial(10,0)).toBe(0);expect(sample_binomial(10,1)).toBe(10);
 let mean=0,variance=0;const counts=[0,0,0];
 for(let i=0;i<10000;i++)counts[sample_binomial(2,.5,()=> (i+.5)/10000)]++;
 expect(counts).toEqual([2500,5000,2500]);
 for(let i=0;i<10000;i++){const x=sample_binomial(10000,.3,()=> (i+.5)/10000);mean+=x;variance+=(x-3000)**2;}
 expect(mean/10000).toBeCloseTo(3000,-1);expect(variance/10000).toBeGreaterThan(1900);expect(variance/10000).toBeLessThan(2300);
 expect(sample_binomial(1_188_000,.5,()=>.5)).toBeGreaterThan(590000);
});
test('unseen drops are discarded without rerolls; guaranteed bones and GP remain independent',()=>{
 const drops=sample_loot(monster,100,new Set(),()=>.5);
 expect(Object.keys(drops)).toEqual(['melvorD:GP']);
 const eligible=sample_loot(monster,100,new Set(['melvorD:Bones']),()=>.5);
 expect(eligible['melvorD:Bones']).toBe(100);expect(eligible['melvorD:GP']).toBeGreaterThanOrEqual(200);
});
test('wide native GP ranges retain their bounds and expected average',()=>{
 const amount=sample_quantity(10000,100,250,()=>.5);
 expect(amount).toBeGreaterThan(1_700_000);expect(amount).toBeLessThan(1_800_000);
});
