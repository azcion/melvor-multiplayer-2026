// Isolated synthetic benchmark. Run with DB_PATH=:memory: for transitive db initialization.
// The timed fixture is separate and never reads player data.
import {create_test_database} from '../support/database';
import {prepare_combat} from '../../combat-progression';
import {adventure_action,adventure_state,read_adventure} from '../../fighter-adventures';
import {ADVENTURE_CATALOG,ADVENTURE_HOUR,adventure_items} from '../../fighter-adventures-catalog';
import {sample_loot,sample_binomial} from '../../fighter-adventures-loot';
import type {Registration} from '../../combat/catalog';
import {estimate_monster} from '../../fighter-adventures-math';

function measure(name:string,iterations:number,fn:()=>void) {
 const samples=[];for(let i=0;i<iterations;i++){const start=performance.now();fn();samples.push(performance.now()-start);}
 samples.sort((a,b)=>a-b);
 console.log(JSON.stringify({name,iterations,p50_ms:samples[Math.floor(iterations*.5)],p95_ms:samples[Math.min(iterations-1,Math.floor(iterations*.95))],max_ms:samples.at(-1)}));
}
console.log(JSON.stringify({runtime:Bun.version,arch:process.arch,capacity_hours:99,pace:ADVENTURE_CATALOG.pace}));
const db=create_test_database();
try {
 db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'benchmark','synthetic','111-222-333','Benchmark','melvorD:Plant')");
 prepare_combat(db,101);
 db.run('UPDATE combat_characters SET attack=99,strength=99,defence=99,hitpoints=99 WHERE client_id=101');
 db.run("INSERT INTO combat_food_access(client_id,slot,tier,equipped_item) VALUES(101,'Food',8,'melvorD:Carp')");
 const area=ADVENTURE_CATALOG.areas[1],eligibility={discovered:adventure_items(area),owned_dlc:[]};
 let now=ADVENTURE_HOUR;
 const start=db.transaction(()=>adventure_action(db,101,'start',{revision:0,area_id:area.id,monster_ids:area.monsters.map(m=>m.id),eligibility},now))();
 if(!start.success)throw Error('Benchmark assignment rejected');
 db.run('UPDATE fighter_adventures SET capacity=99 WHERE client_id=101');
 measure('realistic 99h Wet Forest settlement with SQLite Inbox delivery',20,()=>{
  now+=99*ADVENTURE_HOUR;
  const result=db.transaction(()=>adventure_action(db,101,'check-in',{revision:read_adventure(db,101)!.revision,reason:'login',eligibility},now))();
  if(!result.success)throw Error('Benchmark settlement rejected');
 });
 measure('cached state and hourly estimates',20,()=>{adventure_state(db,101,now);});
}finally{db.close();}
const worst={...ADVENTURE_CATALOG.areas[0].monsters[0],lootTable:Array.from({length:256},(_,i)=>({itemID:`melvorD:Benchmark_${i}`,minQuantity:1,maxQuantity:101,weight:1})),currencyDrops:[{currencyID:'melvorD:GP',min:1,max:101}]};
measure('bounded worst-case sampler: 1188000 kills, 256 rows, 101 quantities',20,()=>{sample_loot(worst,1_188_000,new Set(worst.lootTable.map(r=>r.itemID)));});
measure('binomial adversarial tail quantile at maximum kill count',20,()=>{sample_binomial(1_188_000,.5,()=>1-Number.EPSILON);});
const builds:Array<{name:string;heal:number;loadout:Registration}>=[
 {name:'starter: Attack/Strength/Defence 1, HP 3, no gear, Shrimp',heal:30,loadout:{levels:{attack:1,strength:1,defence:1,hitpoints:3},gear:{}}},
 {name:'level 20 melee and HP, Bronze Sword and Shield, Shrimp',heal:30,loadout:{levels:{attack:20,strength:20,defence:20,hitpoints:20},gear:{Weapon:'melvorD:Bronze_Sword',Shield:'melvorD:Bronze_Shield'}}},
 {name:'level 99 melee and HP, Rune Scimitar, Carp',heal:180,loadout:{levels:{attack:99,strength:99,defence:99,hitpoints:99},gear:{Weapon:'melvorD:Rune_Scimitar'}}}
];
for(const build of builds)for(const area of ADVENTURE_CATALOG.areas) {
 const estimates=area.monsters.map(m=>estimate_monster(build.loadout,build.heal,m,ADVENTURE_CATALOG));
 const eligible=estimates.every(e=>e.eligible),kills=eligible?3600/estimates.reduce((n,e)=>n+e.seconds,0):0;
 const gp=kills*area.monsters.reduce((sum,m)=>sum+m.currencyDrops.reduce((n,c)=>n+(c.min+c.max)/2,0),0);
 console.log(JSON.stringify({area:area.name,build:build.name,eligible,kills_per_monster_hour:kills,gp_per_hour:gp,bones_per_hour:kills*area.monsters.reduce((sum,m)=>sum+(m.bones?.quantity??0),0)}));
}
