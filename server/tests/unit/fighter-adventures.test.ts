import { expect, test } from 'bun:test';
import {Database} from 'bun:sqlite';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { sample_binomial } from '../../fighter-adventures-loot';
import { adventure_action, adventure_state, read_adventure, accrue_adventure, refresh_adventure_efficiency, adventure_multiplier } from '../../fighter-adventures';
import { ADVENTURE_HOUR as H, ADVENTURE_CATALOG, adventure_items } from '../../fighter-adventures-catalog';
function fixture() {
	const db=create_test_database();
	db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'adventures','key','111-222-333','Fighter','melvorD:Plant')");
	prepare_combat(db,101); db.run('INSERT INTO combat_tutorial(client_id,victories) VALUES(101,7) ON CONFLICT(client_id) DO UPDATE SET victories=7'); db.run("UPDATE combat_characters SET hitpoints=3 WHERE client_id=101"); db.run("INSERT INTO combat_food_access(client_id,slot,tier,equipped_item) VALUES(101,'Food',1,'melvorD:Shrimp')"); return db;
}
const eligibility={discovered:['melvorD:Bones'],owned_dlc:[]};
const start={area_id:'melvorD:Goblin_Village',monster_ids:['melvorD:Golbin'],eligibility};
const act=(db: ReturnType<typeof fixture>,action:string,input:Record<string,unknown>,now:number)=>db.transaction(()=>adventure_action(db,101,action,{revision:read_adventure(db,101)?.revision??0,...input},now))();
const total=(db: ReturnType<typeof fixture>)=>db.query<{qty:number},[]>("SELECT SUM(qty) AS qty FROM inbox_items WHERE item_id='melvorD:Bones'").get()?.qty??0;
test('shared area multiplier follows the intended progression and caps at 25 fighters',()=>{
 const expected=[1,1.24,1.47,1.69,1.90,2.10,2.29,2.47,2.64,2.80,2.95,3.09,3.22,3.34,3.45,3.55,3.64,3.72,3.79,3.85,3.90,3.94,3.97,3.99,4];
 expected.forEach((value,others)=>expect(adventure_multiplier(others)).toBeCloseTo(value,10));
 expect(adventure_multiplier(-1)).toBe(1);
 expect(adventure_multiplier(25)).toBe(4);
});
test('elapsed time caps at one hour, survives saved snapshots, and login alone marks unread',()=>{
	const db=fixture(); try {
	expect(act(db,'start',start,H).success).toBe(true);
	const efficiency=read_adventure(db,101)!.efficiency;
	expect(act(db,'check-in',{eligibility:{discovered:[],owned_dlc:[]},reason:'login'},4*H).success).toBe(true);
	expect(total(db)).toBe(Math.floor(3600*efficiency));
	expect(adventure_state(db,101).unread).toBe(true);
	const haul=read_adventure(db,101)!.haul_revision;
	act(db,'seen',{haul_revision:haul},4*H);
	expect(adventure_state(db,101).unread).toBe(false);
	act(db,'check-in',{eligibility,reason:'online'},5*H);
	expect(total(db)).toBe(Math.floor(3600*efficiency));
	act(db,'check-in',{eligibility,reason:'online'},6*H);
	expect(total(db)).toBeGreaterThan(3600*efficiency);
	expect(adventure_state(db,101).unread).toBe(false);
	} finally {db.close();}
});
test('a failed payout transaction leaves the same revision available for retry',()=>{
	const db=fixture();try {
		act(db,'start',start,H);
		const before=read_adventure(db,101)!;
		const check={eligibility,reason:'login',revision:before.revision};
		db.run(`CREATE TRIGGER fail_adventure_settlement BEFORE UPDATE OF haul_revision ON fighter_adventures
			BEGIN SELECT RAISE(ABORT,'test settlement failure'); END`);
		expect(()=>act(db,'check-in',check,2*H)).toThrow('test settlement failure');
		expect(read_adventure(db,101)).toEqual(before);
		expect(total(db)).toBe(0);
		db.run('DROP TRIGGER fail_adventure_settlement');
		expect(act(db,'check-in',check,2*H).success).toBe(true);
		expect(total(db)).toBe(Math.floor(3600*before.efficiency));
		expect(act(db,'check-in',check,2*H).success).toBe(false);
		expect(total(db)).toBe(Math.floor(3600*before.efficiency));
	}finally{db.close();}
});
test('starting after a stopped interval never earns retroactively; frequent efficiency boundaries preserve cadence',()=>{
	const db=fixture(); try {
	act(db,'start',start,H); act(db,'stop',{},2*H); const before=total(db);
	act(db,'start',start,10*H); act(db,'check-in',{eligibility,reason:'login'},10*H);
	expect(total(db)).toBe(before);
	accrue_adventure(db,101,10*H+299000);
	expect(act(db,'check-in',{eligibility,reason:'online'},10*H+300000)).not.toHaveProperty('too_soon');
	expect(total(db)).toBeGreaterThan(before);
	} finally {db.close();}
});
test('Social Only requires explicit opt-in and stopping pays accumulated gains',()=>{
	const db=fixture(); try {
	db.run("UPDATE clients SET social_mode='social' WHERE id=101");
	expect(act(db,'start',start,H)).toEqual({success:false,error:'opt_in_required'});
	act(db,'opt-in',{enabled:true},H); act(db,'start',start,H);
	act(db,'opt-in',{enabled:false},2*H);
	expect(total(db)).toBeGreaterThan(0); expect(read_adventure(db,101)!.area_id).toBeNull();
	} finally {db.close();}
});
test('capacity prices, stale quotes, separate reset and fractional refunds',()=>{
	const db=fixture(); try {
	db.run('UPDATE expedition_ep_balances SET points_micros=1000000000 WHERE client_id=101');
	expect(act(db,'capacity',{target:99,revision:0},H).success).toBe(true);
	expect(read_adventure(db,101)!.invested_micros).toBe(548000000);
	expect(adventure_state(db,101).capacity).toBe(99);
	expect(act(db,'reset-capacity',{revision:0},H).success).toBe(false);
	expect(act(db,'reset-capacity',{revision:1},H).success).toBe(true);
	expect(adventure_state(db,101).capacity).toBe(1);
	expect(adventure_state(db,101).ep_micros).toBe(945200000);
	} finally {db.close();}
});
test('catalog exposes native loot and excludes authored permanent/desired pools',()=>{
 const area=ADVENTURE_CATALOG.areas[0];
 expect(adventure_items(area)).toContain('melvorD:Bones');
 expect(area).not.toHaveProperty('permanent');
 expect(ADVENTURE_CATALOG).not.toHaveProperty('rotations');
});
test('all base-game combat areas are listed and unmodeled opponents cannot start',()=>{
	const db=fixture();try {
		const state=adventure_state(db,101);
		expect(state.areas).toHaveLength(12);
		expect(ADVENTURE_CATALOG.areas.flatMap(area=>area.monsters)).toHaveLength(42);
		const dragon=state.areas.find(area=>area.id==='melvorD:Dragon_Valley')!;
		expect(dragon.monsters.every(monster=>!monster.eligible && monster.reason==='Not available yet')).toBe(true);
		expect(act(db,'start',{area_id:dragon.id,monster_ids:[dragon.monsters[0].id],eligibility},H)).toEqual({success:false,error:'fighter_not_ready'});
		const farmlands=state.areas.find(area=>area.id==='melvorD:Farmlands')!;
		expect(farmlands.monsters.find(monster=>monster.id==='melvorD:Plant')!.eligible).toBe(true);
		expect(act(db,'start',{area_id:farmlands.id,monster_ids:['melvorD:Plant'],eligibility},H).success).toBe(true);
	}finally{db.close();}
});
test('Adventure assignment and capacity spending require completed combat tutorial',()=>{
	const db=fixture(); try {
		db.run('UPDATE combat_tutorial SET victories=0 WHERE client_id=101');
		expect(adventure_state(db,101).tutorial_complete).toBe(false);
		expect(act(db,'start',start,H)).toEqual({success:false,error:'tutorial_required'});
		expect(act(db,'capacity',{target:2,revision:0},H)).toEqual({success:false,error:'tutorial_required'});
		db.run('UPDATE combat_tutorial SET victories=7 WHERE client_id=101');
		expect(adventure_state(db,101).tutorial_complete).toBe(true);
		expect(act(db,'start',start,H).success).toBe(true);
	} finally {db.close();}
});
test('whole kill credits and fractional carry are independent of payout partitioning',()=>{
 const one=fixture(),many=fixture();try {
 for(const db of [one,many])act(db,'start',start,H);
 act(one,'check-in',{reason:'login',eligibility},2*H);
 for(let i=1;i<=12;i++)act(many,'check-in',{reason:'online',eligibility},H+i*H/12);
 expect(total(one)).toBe(total(many));
 expect(JSON.parse(read_adventure(one,101)!.progress_json)['melvorD:Golbin'].fraction).toBeCloseTo(JSON.parse(read_adventure(many,101)!.progress_json)['melvorD:Golbin'].fraction,8);
 }finally{one.close();many.close();}
});
test('banked resets fully refund only Adventure capacity and consume the shared reset balance',()=>{
	const db=fixture();try {
	db.run('UPDATE expedition_ep_balances SET points_micros=10000000 WHERE client_id=101');
	act(db,'capacity',{target:2,revision:0},H);
	db.run('INSERT INTO combat_reset_balances(client_id,resets) VALUES(101,1)');
	const before=db.query('SELECT * FROM combat_characters WHERE client_id=101').get();
	expect(adventure_state(db,101).reset_refund_micros).toBe(1000000);
	expect(act(db,'reset-capacity',{revision:1},2*H).success).toBe(true);
	expect(adventure_state(db,101).ep_micros).toBe(10000000);
	expect(adventure_state(db,101).free_reset).toBe(false);
	expect(db.query('SELECT * FROM combat_characters WHERE client_id=101').get()).toEqual(before);
	}finally{db.close();}
});

test('effective enforced Social Only still permits deliberate Adventure opt-in',()=>{
	const db=fixture();try {
		db.run("UPDATE clients SET social_mode_enforced=1 WHERE id=101");
		expect(act(db,'start',start,H).success).toBe(false);
		act(db,'opt-in',{enabled:true},H);expect(act(db,'start',start,H).success).toBe(true);
		act(db,'stop',{},2*H);act(db,'opt-in',{enabled:false},2*H);
		db.run("UPDATE clients SET social_mode_enforced=0,cheats_detected_at=? WHERE id=101",[2*H]);
		db.run("INSERT INTO guilds(id,name,icon_id,created_at,cheat_restriction_enabled) VALUES(2,'Adventure policy','melvorD:Plant',0,1)");
		db.run('INSERT INTO guild_memberships(client_id,guild_id,joined_at) VALUES(101,2,0)');
		expect(act(db,'start',start,2*H).success).toBe(false);
		act(db,'opt-in',{enabled:true},2*H);expect(act(db,'start',start,2*H).success).toBe(true);
	}finally{db.close();}
});
test('view acknowledgement cannot erase a newer return haul',()=>{
	const db=fixture();try {
		act(db,'start',start,H);
		act(db,'check-in',{reason:'login',eligibility},2*H);
		act(db,'check-in',{reason:'login',eligibility},3*H);
		act(db,'seen',{haul_revision:1},3*H);
		expect(adventure_state(db,101).unread).toBe(true);
		act(db,'seen',{haul_revision:2},3*H);expect(adventure_state(db,101).unread).toBe(false);
	}finally{db.close();}
});
test('level changes improve only future time without releasing used capacity',()=>{
	const db=fixture();try {
		act(db,'start',start,H);
		const before=read_adventure(db,101)!.efficiency;
		accrue_adventure(db,101,H+H/2);
		db.run('UPDATE combat_characters SET attack=50,strength=50,defence=50,hitpoints=50 WHERE client_id=101');
		refresh_adventure_efficiency(db,101,H+H/2);
		const after=read_adventure(db,101)!.efficiency;
		expect(after).toBeGreaterThan(before);expect(read_adventure(db,101)!.used_ms).toBe(H/2);
		act(db,'check-in',{reason:'login',eligibility},3*H);
		expect(total(db)).toBe(Math.floor(3600*(before+after)/2));
	}finally{db.close();}
});

test('selection changes pay earned whole credits and discard fractions; invalid selections leave state intact',()=>{
 const db=fixture();try {
 act(db,'start',start,H);accrue_adventure(db,101,H+123456);const pending=JSON.parse(read_adventure(db,101)!.pending_json)['melvorD:Bones'];
 const before=read_adventure(db,101);
 for(const ids of [[],['unknown'],['melvorD:Golbin','melvorD:Golbin']])expect(act(db,'start',{...start,monster_ids:ids},H+123456).success).toBe(false);
 expect(read_adventure(db,101)).toEqual(before);
 expect(act(db,'start',{...start,monster_ids:['melvorD:RangedGolbin']},H+123456).success).toBe(true);
 expect(total(db)).toBe(pending);expect(read_adventure(db,101)!.progress_json).toBe('{}');
 }finally{db.close();}
});
test('food loss settles the old rate, ends the assignment and preserves delivered items',()=>{
 const db=fixture();try {
 act(db,'start',start,H);const rate=read_adventure(db,101)!.efficiency;
 accrue_adventure(db,101,2*H);db.run("UPDATE combat_food_access SET equipped_item=NULL WHERE client_id=101");
 refresh_adventure_efficiency(db,101,2*H);
 expect(read_adventure(db,101)!.area_id).toBeNull();expect(total(db)).toBe(Math.floor(rate*3600));
 expect(read_adventure(db,101)!.progress_json).toBe('{}');
 }finally{db.close();}
});
test('catalog replacement settles the saved distribution before ending the assignment',()=>{
 const db=fixture();try {
 act(db,'start',start,H);const rate=read_adventure(db,101)!.efficiency;
 const replacement={...ADVENTURE_CATALOG,version:ADVENTURE_CATALOG.version+1};
 db.transaction(()=>adventure_action(db,101,'check-in',{reason:'login',eligibility,revision:read_adventure(db,101)!.revision},2*H,replacement))();
 expect(total(db)).toBe(Math.floor(rate*3600));expect(read_adventure(db,101)!.area_id).toBeNull();
 expect(adventure_state(db,101).unread).toBe(true);
 }finally{db.close();}
});
test('capacity upgrades preserve used time and never recover time lost at the old limit',()=>{
 const db=fixture();try {
 act(db,'start',start,H);const rate=read_adventure(db,101)!.efficiency;
 db.run('UPDATE expedition_ep_balances SET points_micros=10000000 WHERE client_id=101');
 act(db,'capacity',{target:2,revision:read_adventure(db,101)!.revision},11*H);
 expect(read_adventure(db,101)!.used_ms).toBe(H);
 act(db,'check-in',{reason:'login',eligibility},12*H);
 expect(total(db)).toBe(Math.floor(7200*rate));
 }finally{db.close();}
});

test('admission checks only selected opponents and never substitutes food from the second slot',()=>{
 const db=fixture();try {
 db.run('UPDATE combat_characters SET hitpoints=5 WHERE client_id=101');
 const area=ADVENTURE_CATALOG.areas[1];
 expect(act(db,'start',{area_id:area.id,monster_ids:[area.monsters[0].id],eligibility},H).success).toBe(true);
 expect(act(db,'start',{area_id:area.id,monster_ids:area.monsters.map(m=>m.id),eligibility},H).success).toBe(false);
 db.run("UPDATE combat_food_access SET equipped_item=NULL WHERE client_id=101");
 db.run("INSERT INTO combat_food_access(client_id,slot,tier,equipped_item) VALUES(101,'Food2',8,'melvorD:Carp')");
 expect(act(db,'start',start,H).success).toBe(false);
 }finally{db.close();}
});
test('eligible food changes preserve fractional kill credit and charge only subsequent time at the new rate',()=>{
 const db=fixture();try {
 act(db,'start',start,H);accrue_adventure(db,101,H+123456);
 const fraction=read_adventure(db,101)!.progress_json,rate=read_adventure(db,101)!.efficiency;
 db.run("UPDATE combat_food_access SET tier=2,equipped_item='melvorD:Herring' WHERE client_id=101");
 refresh_adventure_efficiency(db,101,H+123456);
 expect(read_adventure(db,101)!.progress_json).toBe(fraction);expect(read_adventure(db,101)!.efficiency).toBeGreaterThan(rate);
 expect(read_adventure(db,101)!.used_ms).toBe(123456);
 }finally{db.close();}
});

test('saved monster/rate/eligibility and fractional credits survive a database reopen',()=>{
 const db=fixture();let restored:Database|undefined;try {
 act(db,'start',start,H);accrue_adventure(db,101,H+123456);
 const before=read_adventure(db,101)!;
 restored=Database.deserialize(db.serialize(),{strict:true});restored.run('PRAGMA foreign_keys=ON');
 expect(read_adventure(restored,101)).toEqual(before);
 act(restored,'check-in',{reason:'login',eligibility},2*H);
 expect(total(restored)).toBe(Math.floor(before.efficiency*3600));
 expect(JSON.parse(read_adventure(restored,101)!.progress_json)['melvorD:Golbin'].fraction).toBeGreaterThan(0);
 }finally{restored?.close();db.close();}
});

test('area companions apply prospectively across hourly offline segments',()=>{
 const db=fixture();try {
 act(db,'start',start,H);
 db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(102,'companion','key','444-555-666','Companion','melvorD:Plant')");
 db.run('INSERT INTO fighter_adventures(client_id,last_at) VALUES(102,?)',[H+H/2]);
 db.run('UPDATE fighter_adventures SET area_id=? WHERE client_id=102',[start.area_id]);
 const rate=read_adventure(db,101)!.efficiency;
 act(db,'check-in',{reason:'login',eligibility},2*H);
 expect(total(db)).toBe(Math.floor(3600*rate*1.12));
 expect(adventure_state(db,101,2*H).areas[0].kill_multiplier).toBe(1.24);
 db.run('UPDATE fighter_adventures SET area_id=NULL,last_at=? WHERE client_id=102',[2*H]);
 expect(adventure_state(db,101,2*H).areas[0].kill_multiplier).toBe(1);
 }finally{db.close();}
});


test('companion bonuses stop at capacity and resume only at check-in, preserving historical gaps',()=>{
 const db=fixture();try {
 db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(102,'companion','key','444-555-666','Companion','melvorD:Plant')");
 prepare_combat(db,102);db.run('INSERT INTO combat_tutorial(client_id,victories) VALUES(102,7) ON CONFLICT(client_id) DO UPDATE SET victories=7');db.run('UPDATE combat_characters SET hitpoints=3 WHERE client_id=102');
 db.run("INSERT INTO combat_food_access(client_id,slot,tier,equipped_item) VALUES(102,'Food',1,'melvorD:Shrimp')");
 const companion=(action:string,input:Record<string,unknown>,now:number)=>db.transaction(()=>adventure_action(db,102,action,{revision:read_adventure(db,102)?.revision??0,...input},now))();
 db.run('UPDATE expedition_ep_balances SET points_micros=10000000 WHERE client_id=101');
 act(db,'capacity',{target:4,revision:0},H);act(db,'start',start,H);
 expect(companion('start',start,H).success).toBe(true);
 expect(adventure_state(db,101,H+H/2).areas[0].fighter_count).toBe(2);
 const together=adventure_state(db,101,H+H/2).areas[0];
 expect(together.fighters.map(player=>player.client_id)).toEqual([101,102]);
 expect(together.group_multiplier).toBe(1.24);
 expect(adventure_state(db,102,H+H/2).areas[0].fighters.map(player=>player.client_id)).toEqual([102,101]);
 expect(adventure_state(db,101,2*H).areas[0].fighter_count).toBe(1);
 expect(adventure_state(db,101,2*H).areas[0].fighters.map(player=>player.client_id)).toEqual([101]);
 expect(adventure_state(db,101,2*H).areas[0].group_multiplier).toBe(1);
 expect(companion('check-in',{reason:'login',eligibility},3*H).success).toBe(true);
 expect(adventure_state(db,101,3*H).areas[0].fighter_count).toBe(2);
 const rate=read_adventure(db,101)!.efficiency;
 act(db,'check-in',{reason:'login',eligibility},5*H);
 expect(JSON.parse(read_adventure(db,101)!.progress_json)['melvorD:Golbin'].serial).toBe(Math.floor(rate*3600*4.48));
 }finally{db.close();}
});
test('identity deletion ends an active contribution at deletion and retains earlier history',()=>{
 const db=fixture();try {
 act(db,'start',start,H);
 db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(102,'companion','key','444-555-666','Companion','melvorD:Plant')");
 db.run('INSERT INTO fighter_adventures(client_id,last_at) VALUES(102,?)',[H]);
 db.run('UPDATE fighter_adventures SET area_id=? WHERE client_id=102',[start.area_id]);
 db.run('UPDATE clients SET deleted_at=? WHERE id=102',[H+H/2]);
 const rate=read_adventure(db,101)!.efficiency;
 act(db,'check-in',{reason:'login',eligibility},2*H);
 expect(total(db)).toBe(Math.floor(rate*3600*1.12));
 expect(adventure_state(db,101,2*H).areas[0].fighter_count).toBe(1);
 }finally{db.close();}
});

test('large boosted loot samples retain their exact binomial partition',()=>{
 expect(sample_binomial(2_400_001,1)).toBe(2_400_001);
 let draws=0;const result=sample_binomial(2_400_001,0.5,()=>{draws++;return 0.5;});
 expect(result).toBeGreaterThan(1_190_000);expect(result).toBeLessThan(1_210_000);expect(draws).toBe(3);
});

test('migration caps existing participation and preserves deleted identity history',async()=>{
 const {migrations}=await import('../../db/schema');
 const db=new Database(':memory:');try {
 for(const migration of migrations.filter(m=>m.version<225)) db.run(migration.sql);
 for(const [id,deleted] of [[101,null],[102,2*H]] as const) {
  db.run('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id,deleted_at) VALUES(?,?,?,?,?,?,?)',[id,`migration-${id}`,'key',`code-${id}`,'Fighter','melvorD:Plant',deleted]);
  db.run('INSERT INTO fighter_adventures(client_id,last_at,area_id,capacity,used_ms) VALUES(?,?,?,?,?)',[id,H,start.area_id,4,H]);
  db.run('INSERT INTO adventure_participation(client_id,area_id,started_at,ended_at) VALUES(?,?,?,NULL)',[id,start.area_id,H]);
 }
 db.run(migrations.find(m=>m.version===225)!.sql);
 expect(db.query('SELECT client_id,started_at,ended_at FROM adventure_participation ORDER BY client_id').all()).toEqual([
  {client_id:101,started_at:H,ended_at:4*H},{client_id:102,started_at:H,ended_at:2*H}
 ]);
 }finally{db.close();}
});

test('large boosted 99-hour haul settles and can stop',()=>{
 const db=fixture();try {
 db.run('UPDATE expedition_ep_balances SET points_micros=1000000000 WHERE client_id=101');
 act(db,'capacity',{target:99,revision:0},H);act(db,'start',start,H);
 db.run('UPDATE fighter_adventures SET efficiency=5 WHERE client_id=101');
 for(let id=200;id<215;id++) db.run('INSERT INTO adventure_participation VALUES(?,?,?,?)',[id,start.area_id,H,100*H]);
 expect(act(db,'stop',{},100*H).success).toBe(true);
 expect(read_adventure(db,101)!.area_id).toBeNull();
 expect(total(db)).toBe(Math.floor(99*3600*5*3.55));
 }finally{db.close();}
});

test('continuous online check-ins reuse participation history',()=>{
 const db=fixture();try {
 act(db,'start',start,H);
 for(let i=1;i<=12;i++)act(db,'check-in',{reason:'online',eligibility},H+i*H/12);
 expect(db.query<{n:number},[]>('SELECT COUNT(*) n FROM adventure_participation WHERE client_id=101').get()!.n).toBe(1);
 }finally{db.close();}
});
