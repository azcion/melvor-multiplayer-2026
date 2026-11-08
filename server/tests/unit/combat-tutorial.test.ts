import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { combat_character, prepare_combat, purchase_combat_levels } from '../../combat-progression';
import { skip_tutorial, tutorial_state, tutorial_victory, TUTORIAL_TRIALS } from '../../combat-tutorial';
import { change_equipment } from '../../equipment-projects';
import { reserve_combat, update_combat } from '../../combat-inventory';
import { create_run, step_run, run_command } from '../../combat/runs';
import type { Encounter } from '../../combat/engine';

function fixture() {
	const db = create_test_database();
	db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'tutorial','key','111-222-333','Tutorial','melvorD:Plant')");
	prepare_combat(db, 101);
	return db;
}
test('preparation grants one allowance; mandatory gates cannot be bypassed', () => {
	const db = fixture();
	try {
		prepare_combat(db,101);
		expect(db.query('SELECT points_micros FROM expedition_ep_balances').get()).toEqual({ points_micros: 1_000_000 });
		expect(tutorial_state(db,101)).toMatchObject({ victories:0, ready:false, next:'unlock-slot' });
		expect(reserve_combat(db,101,'owner','fight','golbin')).toBeNull();
		expect(purchase_combat_levels(db,101,'level',{attack:1},0)).toMatchObject({ success:false,error:'tutorial_required' });
		const revision = () => combat_character(db,101)!.revision;
		expect(change_equipment(db,101,'slot','unlock-slot',{slot:'Weapon',revision:revision()})).toMatchObject({success:true});
		expect(tutorial_state(db,101).next).toBe('equip');
		expect(change_equipment(db,101,'equip','equip',{slot:'Weapon',item_id:'multiplayer:Wooden_Sword',revision:revision()})).toMatchObject({success:true});
		expect(combat_character(db,101)!.gear).toEqual({Weapon:'multiplayer:Wooden_Sword'});
		expect(reserve_combat(db,101,'owner','repeat','tutorial_1','repeat')).toBeNull();
		expect(reserve_combat(db,101,'owner','skip','tutorial_2')).toBeNull();
		expect(reserve_combat(db,101,'owner','fight','tutorial_1')).not.toBeNull();
		expect(update_combat(db,'other','fight',0,'victory')).toBe(false);
		expect(update_combat(db,'owner','fight',0,'victory')).toBe(true);
		expect(update_combat(db,'owner','fight',0,'victory')).toBe(true);
		expect(tutorial_state(db,101)).toMatchObject({victories:1,next:'unlock-slot'});
		expect(db.query('SELECT points_micros FROM expedition_ep_balances').get()).toEqual({points_micros:1_000_000});
	} finally { db.close(); }
});
test('all seven victories award exactly nine EP in total; failure and interruption award nothing', () => {
	const db = fixture();
	try {
		for (const [index, trial] of TUTORIAL_TRIALS.entries()) {
			const table = trial.slot === 'Food' ? 'combat_food_access' : 'combat_equipment_slots';
			db.query(`INSERT INTO ${table}(client_id,slot,tier,equipped_item) VALUES(101,?,?,?) ON CONFLICT(client_id,slot) DO UPDATE SET tier=excluded.tier,equipped_item=excluded.equipped_item`).run(trial.slot,trial.tier,trial.item);
			db.query("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(101,?,'{}',0,1)").run(trial.item);
			expect(tutorial_state(db,101).ready).toBe(true);
			for (const status of ['defeat','fled','interrupted']) {
				const id = `${index}-${status}`;
				expect(reserve_combat(db,101,'owner',id,trial.id)).not.toBeNull();
				update_combat(db,'owner',id,0,status);
				expect(tutorial_state(db,101).victories).toBe(index);
			}
			const id = String(index);
			expect(reserve_combat(db,101,'owner',id,trial.id)).not.toBeNull();
			update_combat(db,'owner',id,0,'victory');
		}
		expect(tutorial_state(db,101).complete).toBe(true);
		expect(db.query('SELECT points_micros FROM expedition_ep_balances').get()).toEqual({points_micros:9_000_000});
		expect(reserve_combat(db,101,'owner','old','tutorial_1')).toBeNull();
		expect(reserve_combat(db,101,'owner','regular','golbin')).not.toBeNull();
	} finally { db.close(); }
});
test('seeded level-one tutorial balance targets meaningful battle duration', () => {
	const gear: Record<string,string> = {};
	for (const [index, trial] of TUTORIAL_TRIALS.entries()) {
		if (trial.slot !== 'Food') gear[trial.slot] = trial.item;
		for (const stance of ['accurate','aggressive','defensive']) {
		const times: number[] = [];
		let wins = 0;
		for (let seed = 1; seed <= 300; seed++) {
			let state = seed;
			const random = () => { state = (Math.imul(state,1664525)+1013904223) >>> 0; return state/4294967296; };
			const arena = create_run({levels:{attack:1,strength:1,defence:1,hitpoints:1},gear}, {heal:index >= 4 ? 30 : 0}, 'balance',trial.id as Encounter,'once');
			run_command(arena,'stance',stance);
			let ticks = 0;
			let reaction_at = -1;
			for (; ticks < 6000 && arena.status === 'active'; ticks++) {
				// Observe once per second and deliver a manual command 500 ms later.
				if (ticks % 10 === 0 && arena.player.hp <= arena.player.max_hp * .65 && reaction_at < 0) reaction_at = ticks + 5;
				if (ticks === reaction_at) { run_command(arena,'eat',null); reaction_at = -1; }
				step_run(arena,random);
			}
			if (arena.status === 'victory') wins++;
			times.push(ticks/10);
		}
		times.sort((a,b)=>a-b);
		console.log(trial.name, stance, { wins, p10:times[30], median:times[150], p90:times[270] });
		expect(wins).toBeGreaterThanOrEqual(285);
		expect(times[150]).toBeGreaterThanOrEqual(20);
		expect(times[150]).toBeLessThanOrEqual(index === 6 ? 100 : 50);
		}
	}
});

test('admin presets prepare every real tutorial phase without changing shared EP or another fighter', async () => {
	const { debug_tutorial, tutorial_debug_targets } = await import('../../combat-tutorial');
	const { equipment_project_state } = await import('../../equipment-projects');
	const db = fixture();
	try {
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(102,'other-tutorial','key','222-333-444','Other','melvorD:Plant')");
		prepare_combat(db,102);
		const other = combat_character(db,102);
		const balance = () => db.query('SELECT * FROM expedition_ep_balances ORDER BY client_id').all();
		const before = balance();
		const revision = () => combat_character(db,101)?.revision ?? null;
		for (const target of tutorial_debug_targets()) {
			const result = db.transaction(() => debug_tutorial(db,101,crypto.randomUUID(),{ target:target.id,revision:revision() }))();
			expect(result).toEqual({success:true});
			expect(balance()).toEqual(before);
			expect(combat_character(db,102)).toEqual(other);
			if (target.id === 'start') {
				expect(combat_character(db,101)).toBeNull();
				prepare_combat(db,101);
				expect(balance()).toEqual(before); // Reset cannot replay the first EP allowance.
			} else if (target.id === 'complete') expect(tutorial_state(db,101).complete).toBe(true);
			else {
				expect(tutorial_state(db,101)).toMatchObject({victories:target.victories,next:target.phase,ready:target.phase==='battle'});
				if (target.phase === 'work') expect(equipment_project_state(db,101).project?.stage).toBe(target.stage);
				if (target.phase === 'battle') {
					expect(reserve_combat(db,101,'debug','trial-'+target.victories,TUTORIAL_TRIALS[target.victories].id)).not.toBeNull();
					expect(debug_tutorial(db,101,'active',{target:'start',revision:revision()})).toMatchObject({success:false,error:'active'});
					update_combat(db,'debug','trial-'+target.victories,0,'fled');
				}
			}
		}
		const current = combat_character(db,101);
		expect(debug_tutorial(db,101,'invalid',{target:'anything',revision:revision()})).toMatchObject({success:false});
		expect(debug_tutorial(db,101,'stale',{target:'start',revision:0})).toMatchObject({success:false,error:'quote_changed'});
		expect(combat_character(db,101)).toEqual(current);
	} finally { db.close(); }
});

test('switching tutorial phases rejects an actively tracked project', async () => {
	const { debug_tutorial } = await import('../../combat-tutorial');
	const db = fixture();
	try {
		db.transaction(() => debug_tutorial(db,101,'work',{target:'2:work:0',revision:0}))();
		const project = db.query<{id:number}, []>('SELECT id FROM combat_equipment_projects WHERE completed_at IS NULL').get()!;
		db.query("INSERT INTO combat_project_tracking(client_id,project_id,task_id,started_at,start_clock_offset_ms,epoch,counter_ms,statistics_json) VALUES(101,?,'task',0,0,'epoch',0,'{}')").run(project.id);
		expect(debug_tutorial(db,101,'tracking',{target:'start',revision:combat_character(db,101)!.revision})).toMatchObject({success:false,error:'tracking_busy'});
		expect(tutorial_state(db,101).next).toBe('work');
	} finally { db.close(); }
});

test('skip before preparation creates an unequipped fighter with the full nine EP', () => {
	const db = fixture();
	try {
		db.run('DELETE FROM combat_characters WHERE client_id=101');
		db.run('DELETE FROM combat_tutorial WHERE client_id=101');
		db.run('DELETE FROM expedition_ep_balances WHERE client_id=101');
		expect(tutorial_state(db,101)).toMatchObject({ skip_ep_micros:9_000_000 });
		expect(skip_tutorial(db,101,9_000_000)).toEqual({ success:true });
		expect(combat_character(db,101)?.gear).toEqual({});
		expect(tutorial_state(db,101)).toMatchObject({ complete:true });
		expect(reserve_combat(db,101,'owner','practice','practice_recruit_1')).toBeNull();
		expect(reserve_combat(db,101,'owner','dungeon','golbins','raid')).not.toBeNull();
		expect(skip_tutorial(db,101,9_000_000)).toMatchObject({ success:false });
		expect(db.query('SELECT points_micros FROM expedition_ep_balances').get()).toEqual({ points_micros:9_000_000 });
	} finally { db.close(); }
});

test('skip awards only unsettled tutorial rewards and ends the current trial', () => {
	const db = fixture();
	try {
		const revision = () => combat_character(db,101)!.revision;
		change_equipment(db,101,'slot','unlock-slot',{slot:'Weapon',revision:revision()});
		change_equipment(db,101,'equip','equip',{slot:'Weapon',item_id:'multiplayer:Wooden_Sword',revision:revision()});
		expect(reserve_combat(db,101,'owner','first','tutorial_1')).not.toBeNull();
		expect(update_combat(db,'owner','first',0,'victory')).toBe(true);
		expect(skip_tutorial(db,101,8_000_000)).toMatchObject({ success:false,error:'quote_changed' });
		change_equipment(db,101,'shield-slot','unlock-slot',{slot:'Shield',revision:revision()});
		change_equipment(db,101,'shield-equip','equip',{slot:'Shield',item_id:'multiplayer:Wooden_Shield',revision:revision()});
		expect(reserve_combat(db,101,'owner','second','tutorial_2')).not.toBeNull();
		expect(tutorial_state(db,101)).toMatchObject({ skip_ep_micros:7_000_000 });
		expect(skip_tutorial(db,101,7_000_000)).toEqual({ success:true });
		expect(update_combat(db,'owner','second',0,'victory')).toBe(false);
		expect(db.query('SELECT points_micros FROM expedition_ep_balances').get()).toEqual({ points_micros:7_000_000 });
	} finally { db.close(); }
});

test('the final trial can be skipped with zero EP remaining', () => {
	const db = fixture();
	try {
		for (let index = 0; index < 6; index++) expect(tutorial_victory(db,101,index)).toBe(true);
		expect(tutorial_state(db,101)).toMatchObject({ skip_ep_micros:0 });
		expect(skip_tutorial(db,101,0)).toEqual({ success:true });
		expect(tutorial_state(db,101)).toMatchObject({ complete:true });
		expect(db.query('SELECT points_micros FROM expedition_ep_balances').get()).toEqual({ points_micros:9_000_000 });
	} finally { db.close(); }
});
