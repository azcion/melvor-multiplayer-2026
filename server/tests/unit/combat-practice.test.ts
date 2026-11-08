import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { combat_state, reserve_combat, update_combat } from '../../combat-inventory';
import { create_run, valid_run } from '../../combat/runs';
import { is_encounter, SUPPORTED_ENCOUNTERS } from '../../combat/engine';
import { save_recovery, pause_recovery, read_recovery, resume_recovery, abandon_recovery } from '../../combat-recovery';
const registration = { levels: { attack:1,strength:1,defence:1,hitpoints:3 },gear:{Weapon:'melvorD:Bronze_Sword',Shield:'melvorD:Iron_Shield',Helmet:'melvorD:Bronze_Helmet'} };
function fixture() {
	const db=create_test_database();
	db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'retired-practice','key','111-222-333','Fighter','melvorD:Plant')");
	prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7');
	return db;
}
test('retired Practice has no catalog or valid engine, run or authority admission', () => {
	const db=fixture(); try {
		expect(combat_state(db,101)).not.toHaveProperty('practice');
		expect(combat_state(db,101)).not.toHaveProperty('practice_catalog_revision');
		expect(SUPPORTED_ENCOUNTERS.some(id=>id.startsWith('practice_'))).toBe(false);
		for (const id of ['practice_recruit_1','practice_circuit_12','practice_unknown_1']) for (const mode of ['once','repeat','playlist','raid']) {
			expect(is_encounter(id)).toBe(false);
			expect(valid_run(id,mode)).toBe(false);
			expect(reserve_combat(db,101,'owner','rejected',id,mode)).toBeNull();
		}
		expect(db.query('SELECT * FROM combat_encounters').all()).toEqual([]);
		for(let trial=1;trial<=7;trial++) {
			const id=`tutorial_${trial}` as 'tutorial_1';
			expect(valid_run(id,'once')).toBe(true);
			expect(create_run(registration,{heal:3},'trial',id,'once').run!.stages).toBe(trial===7?2:1);
		}
	} finally { db.close(); }
});
test('historical Practice recovery terminates without rewards, preserves records and releases admission', () => {
	const db=fixture(); try {
		const before=combat_state(db,101);
		expect(reserve_combat(db,101,'owner','old','golbin')).not.toBeNull();
		const arena=create_run(registration,{heal:0},'old','golbin','once');
		expect(save_recovery(db,'owner',arena,0,true)).toBe(1);
		pause_recovery(db,'owner');
		db.run("UPDATE combat_encounters SET practice_id='recruit',practice_tier=1,raid_ruleset='practice-1' WHERE id='old'");
		db.run("INSERT INTO combat_practice_completions VALUES(101,'recruit',1,'practice-1')");
		const saved=read_recovery(db,101)!;
		expect(saved.state).toBe('terminal'); expect(saved.arena.status).toBe('expired');
		expect(resume_recovery(db,101,'new','old')).toBeNull();
		expect(update_combat(db,'owner','old',0,'victory',1)).toBe(false);
		expect(db.query("SELECT status FROM combat_encounters WHERE id='old'").get()).toEqual({status:'interrupted'});
		expect(db.query('SELECT * FROM combat_practice_completions').all()).toHaveLength(1);
		expect(combat_state(db,101).ep_micros).toBe(before.ep_micros);
		expect(abandon_recovery(db,101,'old')).toBe(true);
		expect(reserve_combat(db,101,'owner','dungeon','golbins','raid')).not.toBeNull();
	} finally { db.close(); }
});
