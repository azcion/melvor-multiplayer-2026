import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { combat_state, reserve_combat, update_combat, interrupt_combats } from '../../combat-inventory';
import { combat_unlocks } from '../../combat-unlocks';
import { PRACTICE_DEFINITIONS, PRACTICE_TIERS, PRACTICE_ROLES, practice_selection, practice_wave } from '../../combat/practice';
import { create_run, run_command, step_run, valid_run } from '../../combat/runs';
import { apply_effect } from '../../combat/effects';
import { step } from '../../combat/engine';
const registration = { levels: { attack:1,strength:1,defence:1,hitpoints:3 },gear:{Weapon:'melvorD:Bronze_Sword',Shield:'melvorD:Iron_Shield',Helmet:'melvorD:Bronze_Helmet'} };
function fixture() {
	const db=create_test_database();
	db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'practice-test','key','111-222-333','Fighter','melvorD:Plant')");
	prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7');
	return db;
}
test('Practice catalog exposes fixed, independently replayable bands and explicit enemy-only effects',()=>{
	const db=fixture(); try {
		const state=combat_state(db,101);
		expect(state.practice.length).toBe(11);
		for(const entry of state.practice) {
			expect(entry.tiers.filter(tier=>tier.available).map(tier=>tier.tier)).toEqual([1]);
			expect(entry.tiers[0].waves.flat().every(actor=>!actor.effect)).toBe(true);
		}
		expect(state.practice.find(entry=>entry.id==='hammer')!.tiers[1].waves[0][0].effect_info).toContain('Eating remains available');
		db.run(`INSERT INTO combat_unlocks(client_id,skill_caps_json) VALUES(101,'{"attack":9,"strength":9,"defence":9,"hitpoints":9}')`);
		expect(combat_state(db,101).practice[0].tiers.filter(tier=>tier.available).map(tier=>tier.tier)).toEqual([1,2,3,4]);
		expect(combat_state(db,101).character!.levels.attack).toBe(1);
	} finally { db.close(); }
});
test('authority rejects locked tiers, wrong modes and malformed Practice selections; graduation remains mandatory',()=>{
	const db=fixture();try {
		for(const selection of ['practice_recruit_2','practice_recruit_0','practice_recruit_13','practice_recruit_01','practice_unknown_1'])
			expect(reserve_combat(db,101,'owner','bad',selection)).toBeNull();
		for(const mode of ['repeat','playlist','raid']) expect(reserve_combat(db,101,'owner','mode','practice_recruit_1',mode)).toBeNull();
		db.run('UPDATE combat_tutorial SET victories=0');
		expect(combat_state(db,101).practice).toEqual([]);
		expect(reserve_combat(db,101,'owner','early','practice_recruit_1')).toBeNull();
		db.run('UPDATE combat_tutorial SET victories=7');
		expect(reserve_combat(db,101,'owner','ok','practice_recruit_1')).not.toBeNull();
		expect(reserve_combat(db,101,'owner','concurrent','practice_recruit_1')).toBeNull();
	} finally { db.close(); }
});
test('completion is identity-owned, atomic, repeat-safe, tier-specific and reward-free',()=>{
	const db=fixture();try {
		const before=combat_state(db,101),caps=combat_unlocks(db,101);
		expect(reserve_combat(db,101,'owner','duel','practice_recruit_1')).not.toBeNull();
		expect(update_combat(db,'other','duel',0,'victory',1)).toBe(false);
		expect(update_combat(db,'owner','duel',0,'victory',0)).toBe(false);
		expect(update_combat(db,'owner','duel',0,'victory',1)).toBe(true);
		expect(update_combat(db,'owner','duel',0,'victory',1)).toBe(true);
		expect(combat_state(db,101).practice[0].tiers[0].complete).toBe(true);
		expect(combat_state(db,101).practice[0].tiers[1].complete).toBe(false);
		expect(combat_state(db,101).practice[1].tiers[0].complete).toBe(false);
		expect(combat_state(db,101).ep_micros).toBe(before.ep_micros);
		expect(combat_unlocks(db,101)).toEqual(caps);
		expect(db.query('SELECT * FROM combat_raid_records').all()).toEqual([]);
		expect(db.query('SELECT * FROM combat_practice_completions').all()).toHaveLength(1);
		expect(reserve_combat(db,101,'owner','replay','practice_recruit_1')).not.toBeNull();
		expect(update_combat(db,'owner','replay',0,'victory',1)).toBe(true);
		expect(db.query('SELECT * FROM combat_practice_completions').all()).toHaveLength(1);
	} finally { db.close(); }
});
test('circuit requires all four bouts; interruption and all other nonvictories never grant a completion',()=>{
	const db=fixture();try {
		for(const status of ['defeat','draw','fled','expired','interrupted']) {
			expect(reserve_combat(db,101,'owner',status,'practice_circuit_1')).not.toBeNull();
			expect(update_combat(db,'owner',status,0,'victory',4)).toBe(false);
			expect(update_combat(db,'owner',status,0,'active',1)).toBe(true);
			expect(update_combat(db,'owner',status,0,status,1)).toBe(status!=='interrupted');
		}
		expect(db.query('SELECT * FROM combat_practice_completions').all()).toHaveLength(0);
		expect(reserve_combat(db,101,'owner','full','practice_circuit_1')).not.toBeNull();
		for(let completed=1;completed<=4;completed++) expect(update_combat(db,'owner','full',0,completed===4?'victory':'active',completed)).toBe(true);
		expect(db.query('SELECT * FROM combat_practice_completions').all()).toHaveLength(1);
		expect(reserve_combat(db,101,'owner','restart','practice_circuit_1')).not.toBeNull();interrupt_combats(db);
		expect(db.query("SELECT status FROM combat_encounters WHERE id='restart'").get()).toEqual({status:'interrupted'});
		expect(db.query('SELECT * FROM combat_practice_completions').all()).toHaveLength(1);
	} finally { db.close(); }
});
test('finite Practice composition and carried state follow circuit rules without changing tutorial waves',()=>{
	const arena=create_run(registration,{heal:30},'circuit','practice_circuit_1','once');
	expect(arena.run!.stages).toBe(4);expect(arena.enemies[0].id).toBe('human_recruit_1');
	arena.run!.phase='fighting';arena.player.hp=17;arena.food_used=2;arena.next_eat=9;
	run_command(arena,'stance','defensive');apply_effect(arena.player,'slow','test',0,100);
	for(const actor of arena.enemies)actor.hp=0;
	step_run(arena,()=>.99);
	expect(arena.run!.stage).toBe(1);expect(String(arena.run!.phase)).toBe('respawning');
	expect(arena.player.hp).toBe(17);expect(arena.food_used).toBe(2);expect(arena.next_eat).toBe(8);
	expect(arena.stance).toBe('defensive');expect(arena.player.effects).toEqual([]);
	expect(arena.enemies[0].id).toBe('human_veteran_1');
	const tutorial=create_run(registration,{heal:30},'tutorial','tutorial_7','once');expect(tutorial.run!.stages).toBe(2);
});
test('specialist effects apply only on successful enemy hits, do not stack, preserve manual eating and clean up',()=>{
	for(const [role,effect] of [['serrated','bleed'],['venom','poison'],['hammer','slow']] as const) {
		const arena=create_run({...registration,levels:{attack:3,strength:3,defence:3,hitpoints:3}},{heal:30},'effects',`practice_${role}_2`,'once');
		expect(arena.player.possible_effects).toEqual([effect]);expect(arena.enemies[0].possible_effects).toEqual([]);
		arena.player.next_attack=999999;arena.enemies[0].next_attack=0;
		step(arena,()=>.999);expect(arena.player.effects).toEqual([]);
		arena.enemies[0].next_attack=0;step(arena,()=>0);
		expect(arena.player.effects.map(e=>e.id)).toEqual([effect]);
		expect(run_command(arena,'eat',null)).toBe(true);
		arena.enemies[0].next_attack=0;step(arena,()=>0);expect(arena.player.effects).toHaveLength(1);
		expect(arena.enemies[0].effects).toEqual([]);
		run_command(arena,'flee',null);expect(arena.player.effects).toEqual([]);
	}
});
test('every authored selection admits only finite once mode and profiles remain independent of player stats',()=>{
	for(const definition of PRACTICE_DEFINITIONS)for(const tier of PRACTICE_TIERS){
		const id=`practice_${definition.id}_${tier.tier}`;
		expect(valid_run(id,'once')).toBe(true);expect(valid_run(id,'repeat')).toBe(false);
		const selection=practice_selection(id)!;
		for(let stage=0;stage<definition.waves.length;stage++){
			const wave=practice_wave(selection,stage);expect(new Set(wave.map(actor=>actor.id)).size).toBe(wave.length);
			for(const actor of wave)expect(actor.hp>0&&actor.max_hit>0&&actor.interval>=2000).toBe(true);
		}
	}
	expect(Object.keys(PRACTICE_ROLES)).toHaveLength(10);
});
