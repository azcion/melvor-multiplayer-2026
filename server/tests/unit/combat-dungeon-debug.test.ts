import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { debug_dungeon, dungeon_debug_options } from '../../combat-dungeon-debug';
import { combat_character, prepare_combat, reset_combat_levels } from '../../combat-progression';
import { combat_state, reserve_combat, update_combat } from '../../combat-inventory';
import { debug_tutorial } from '../../combat-tutorial';
import { reset_equipment } from '../../equipment-projects';
import { chamber_effect_matches } from '../../combat/chambers';
import { DUNGEONS } from '../../combat/raids';

function fixture() {
	const db = create_test_database();
	for (const id of [101,102]) {
		db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)').run(id,String(id),'key',String(id),'Test','melvorD:Plant');
		prepare_combat(db,id);
	}
	return db;
}
function payload(target='quarry:2',level=21,material='Steel') {
	return {target,confirm:true,revision:0,levels:{attack:level,strength:level,defence:level,hitpoints:level},gear:{Weapon:`melvorD:${material}_Sword`,Helmet:`melvorD:${material}_Helmet`},food:'melvorD:Herring'};
}
test('every tier prepares legal admission without EP, other-player changes, refunds or synthetic records', () => {
	const db = fixture();
	try {
		const before = combat_state(db,102);
		for (const target of dungeon_debug_options().targets) {
			const input = {...payload(target.id,target.level,target.level>=5?'Iron':'Bronze'),revision:combat_character(db,101)!.revision};
			if (target.id==='golbins:1') { input.levels.hitpoints=3; input.food='melvorD:Shrimp'; }
			if (target.food_tier===1) input.food='melvorD:Shrimp';
			expect(db.transaction(() => debug_dungeon(db,101,crypto.randomUUID(),input))()).toEqual({success:true});
			const state = combat_state(db,101);
			expect(state.dungeons.find(dungeon => dungeon.id===target.dungeon)).toMatchObject({available:true,endpoint:target.tier});
			expect(state.dungeons.find(dungeon => dungeon.id===target.dungeon)!.tiers[target.tier-1].complete).toBe(false);
			expect(state.ep_micros).toBe(1_000_000);
			expect(state.equipment_projects.resets.equipment.refund_micros).toBe(0);
			expect(reset_equipment(db,101,'refund',state.character!.revision)).toMatchObject({success:false});
			expect(reset_combat_levels(db,101,'refund',state.character!.revision)).toMatchObject({success:false});
			const id = crypto.randomUUID();
			const admission = reserve_combat(db,101,'controller',id,target.dungeon,'raid');
			expect(admission?.raid_endpoint).toBe(target.tier);
			expect(debug_dungeon(db,101,'active',{...input,revision:combat_character(db,101)!.revision})).toMatchObject({error:'active'});
			for (let completed=1;completed<=DUNGEONS[target.dungeon].boundaries[target.tier-1];completed++)
				expect(update_combat(db,'controller',id,0,completed===DUNGEONS[target.dungeon].boundaries[target.tier-1]?'victory':'active',completed,Date.now()+10_000)).toBe(true);
			expect(db.query('SELECT 1 FROM combat_raid_records WHERE client_id=101').get()).toBeNull();
		}
		expect(combat_state(db,102)).toEqual(before);
		const revision = combat_character(db,101)!.revision;
		expect(debug_tutorial(db,101,'reset',{target:'start',revision})).toEqual({success:true});
		expect(db.query('SELECT 1 FROM combat_test_profiles WHERE client_id=101').get()).toBeNull();
		expect(db.query('SELECT 1 FROM combat_raid_progress WHERE client_id=101').get()).toBeNull();
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});
test('rejects stale, unsupported, over-cap and unconfirmed setups before changing state; material condition remains real', () => {
	const db=fixture();
	try {
		const before=combat_state(db,101);
		for (const change of [{confirm:false},{revision:1},{target:'unknown'},{levels:{attack:99,strength:21,defence:21,hitpoints:21}},{target:'tidal:1'},{food:'melvorD:Carp'},{gear:{Weapon:'melvorD:Rune_Sword'}}]) {
			expect(debug_dungeon(db,101,'bad',{...payload(),...change}).success).toBe(false);
			expect(combat_state(db,101)).toEqual(before);
		}
		for (const material of ['Iron','Steel']) {
			expect(db.transaction(() => debug_dungeon(db,101,crypto.randomUUID(),{...payload('quarry:2',21,material),revision:combat_character(db,101)!.revision}))().success).toBe(true);
			const loadout=reserve_combat(db,101,'condition',material,'quarry','raid')!;
			expect(chamber_effect_matches(DUNGEONS.quarry.tiers[1].chamber_effects![0],loadout.registration)).toBe(material==='Iron');
			expect(chamber_effect_matches(DUNGEONS.quarry.tiers[1].chamber_effects![0],{...loadout.registration,gear:{Weapon:'melvorD:Iron_Sword'}})).toBe(false);
			update_combat(db,'condition',material,0,'fled',0);
		}
	} finally { db.close(); }
});


test('tracked project preparation is rejected without losing the current project', () => {
	const db=fixture();
	try {
		db.transaction(() => debug_tutorial(db,101,'work',{target:'2:work:0',revision:0}))();
		const project=db.query<{id:number},[]>('SELECT id FROM combat_equipment_projects WHERE completed_at IS NULL').get()!;
		db.query("INSERT INTO combat_project_tracking(client_id,project_id,task_id,started_at,start_clock_offset_ms,epoch,counter_ms,statistics_json) VALUES(101,?,'task',0,0,'epoch',0,'{}')").run(project.id);
		const before=combat_state(db,101);
		expect(debug_dungeon(db,101,'tracked',{...payload(),revision:combat_character(db,101)!.revision})).toMatchObject({success:false,error:'tracking_busy'});
		expect(combat_state(db,101)).toEqual(before);
	} finally {db.close();}
});
