import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat, reset_combat_levels } from '../../combat-progression';
import { combat_state, reserve_combat, update_combat, interrupt_combats } from '../../combat-inventory';
import { create_run, step_run, run_command } from '../../combat/runs';
import { GOLBIN_RULESET, GOLBIN_TIERS, golbin_boundaries, golbin_waves } from '../../combat/raids';
import { combat_unlocks, raid_endpoint } from '../../combat-unlocks';
import { create_registered_arena, resolve_player_damage } from '../../combat/engine';
import { combat_leaderboard } from '../../combat-leaderboard';
function fixture() {
	const db = create_test_database();
	db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'raid-test','key','111-222-333','Runner','melvorD:Plant')");
	prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7');
	return db;
}
function finish(db: ReturnType<typeof fixture>, id: string, endpoint: number, elapsed = 60000) {
	const created = db.query<{created_at:number},[string]>('SELECT created_at FROM combat_encounters WHERE id=?').get(id)!.created_at;
	for (let i=1;i<=golbin_boundaries[endpoint-1];i++) expect(update_combat(db,'owner',id,0,i===golbin_boundaries[endpoint-1]?'victory':'active',i,created+elapsed)).toBe(true);
}
test('fixed endpoints, repeat-safe tier grants, failure retry and all-tier-only best records', () => {
	const db=fixture(); try {
		for (const endpoint of [1,2,3]) {
			expect(raid_endpoint(db,101)).toBe(endpoint);
			expect(reserve_combat(db,101,'owner','run'+endpoint,'golbins','raid')?.raid_endpoint).toBe(endpoint);
			expect(update_combat(db,'owner','run'+endpoint,0,'victory',1)).toBe(false);
			finish(db,'run'+endpoint,endpoint);
			expect(combat_unlocks(db,101).skill_caps).toEqual({attack:GOLBIN_TIERS[endpoint-1].cap,strength:GOLBIN_TIERS[endpoint-1].cap,defence:GOLBIN_TIERS[endpoint-1].cap,hitpoints:GOLBIN_TIERS[endpoint-1].cap,ranged:1,magic:1});
			expect(combat_leaderboard(db).total).toBe(endpoint===3?1:0);
			expect(update_combat(db,'owner','run'+endpoint,0,'victory',golbin_boundaries[endpoint-1])).toBe(true);
		}
		const record=db.query('SELECT * FROM combat_raid_records').get();
		reserve_combat(db,101,'owner','slow','golbins','raid'); finish(db,'slow',3,70000);
		expect(db.query('SELECT * FROM combat_raid_records').get()).toEqual(record);
		reserve_combat(db,101,'owner','tie','golbins','raid'); finish(db,'tie',3,60000);
		expect(db.query('SELECT * FROM combat_raid_records').get()).toEqual(record);
		reserve_combat(db,101,'owner','fast','golbins','raid'); finish(db,'fast',3,50000);
		expect(db.query<{elapsed_ms:number},[]>('SELECT * FROM combat_raid_records').get()!.elapsed_ms).toBe(50000);
		expect(db.query('SELECT attack,strength,defence,hitpoints FROM combat_characters').get()).toEqual({attack:1,strength:1,defence:1,hitpoints:1});
		db.run('UPDATE clients SET disabled=1'); expect(combat_leaderboard(db).total).toBe(0);
	} finally { db.close(); }
});
test('non-victory outcomes never grant; earned earlier tiers survive failure, disconnect and resets', () => {
	for (const status of ['defeat','draw','fled','expired','interrupted']) {
		const db=fixture(); try {
			reserve_combat(db,101,'owner','failed','golbins','raid');
			expect(update_combat(db,'owner','failed',0,status,0)).toBe(status!=='interrupted');
			expect(raid_endpoint(db,101)).toBe(1);
			reserve_combat(db,101,'owner','one','golbins','raid'); finish(db,'one',1);
			reserve_combat(db,101,'owner','two','golbins','raid');
			for(let i=1;i<=4;i++) expect(update_combat(db,'owner','two',0,'active',i)).toBe(true);
			expect(update_combat(db,'owner','two',0,'defeat',8)).toBe(false);
			interrupt_combats(db);
			expect(raid_endpoint(db,101)).toBe(2); expect(combat_unlocks(db,101).skill_caps.attack).toBe(3);
			db.run('UPDATE combat_characters SET attack=3,invested_micros=2000000');
			const revision=combat_state(db,101).character!.revision;
			expect(reset_combat_levels(db,101,'reset',revision).success).toBe(true);
			expect(combat_unlocks(db,101).skill_caps.attack).toBe(3);
		} finally { db.close(); }
	}
});
test('raid engine uses authored waves, carries HP and cooldown, and terminates exactly at fixed endpoint', () => {
	for(const endpoint of [1,2,3]) {
		const arena=create_run({levels:{attack:1,strength:1,defence:1,hitpoints:3},gear:{}},{heal:30},'raid','golbins','raid',endpoint);
		arena.player.hp=23; arena.next_eat=10;
		for(const [i,wave] of golbin_waves(endpoint).entries()) {
			expect(arena.enemies.length).toBe(wave.counts.reduce<number>((a,b)=>a+b,0));
			expect(arena.run!.tier).toBe(wave.tier);
			for (const enemy of arena.enemies) {
				const offset = { melee: -200, ranged: 0, magic: 200 }[enemy.stats.attack_type];
				expect(enemy.interval).toBe(wave.profile.interval + offset);
				expect(enemy.base_interval_ticks * arena.step_ms).toBe(enemy.interval);
				expect(enemy.possible_effects).toEqual([]);
			}
			expect(arena.player.possible_effects).toEqual([]);
			while(arena.run!.phase==='respawning')step_run(arena);
			for(const enemy of arena.enemies) enemy.hp=0;
			step_run(arena);
			expect(arena.run!.completed).toBe(i+1); expect(arena.player.hp).toBe(23);
			expect(arena.food_policy.auto_eat_percent).toBe(0);
			expect(arena.status).toBe(i===golbin_boundaries[endpoint-1]-1?'victory':'active');
		}
		expect(arena.run!.total_ms).toBe(golbin_boundaries[endpoint-1]*3100);
	}
});
test('registered combat including every tutorial has no automatic food without explicit authority capability', () => {
	for(const encounter of ['tutorial_1','tutorial_2','tutorial_3','tutorial_4','tutorial_5','tutorial_6','tutorial_7','golbin'] as const) {
		const arena=create_registered_arena({levels:{attack:1,strength:1,defence:1,hitpoints:1},gear:{}},{heal:30},'manual',encounter);
		arena.player.hp=3; resolve_player_damage(arena,[]);
		expect(arena.player.hp).toBe(3); expect(arena.food_used).toBe(0);
		expect(run_command(arena,'eat',null)).toBe(true); expect(arena.player.hp).toBe(10);
	}
});

test('graduation opens H3 only; skill, material and food ceilings guard spending independently', async () => {
	const { purchase_combat_levels } = await import('../../combat-progression');
	const { change_equipment } = await import('../../equipment-projects');
	const db=fixture(); try {
		db.run('UPDATE expedition_ep_balances SET points_micros=100000000');
		const before=combat_state(db,101);
		expect(before.character!.caps).toEqual({attack:1,strength:1,defence:1,hitpoints:3,ranged:1,magic:1});
		expect(purchase_combat_levels(db,101,'locked',{attack:1},before.character!.revision)).toMatchObject({success:false,error:'cap_locked'});
		expect(purchase_combat_levels(db,101,'mixed',{hitpoints:1,strength:1},before.character!.revision)).toMatchObject({success:false,error:'cap_locked'});
		expect(combat_state(db,101).ep_micros).toBe(before.ep_micros);
		expect(purchase_combat_levels(db,101,'hp',{hitpoints:2},before.character!.revision).success).toBe(true);
		const revision=combat_state(db,101).character!.revision;
		expect(purchase_combat_levels(db,101,'hp4',{hitpoints:1},revision)).toMatchObject({success:false,error:'cap_locked'});
		for(const skill of ['ranged','magic']) expect(purchase_combat_levels(db,101,'future',{[skill]:1},revision).success).toBe(false);
		db.run("INSERT INTO combat_equipment_slots(client_id,slot,tier,equipped_item) VALUES(101,'Weapon',2,'melvorD:Iron_Sword')");
		db.run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(101,'melvorD:Iron_Sword','{}',0,1)");
		expect(change_equipment(db,101,'steel','unlock-tier',{slot:'Weapon',revision})).toMatchObject({success:false,error:'cap_locked'});
		expect(change_equipment(db,101,'steel-project','start-project',{item_id:'melvorD:Steel_Sword',discovered:true,revision})).toMatchObject({success:false,error:'cap_locked'});
		db.run("INSERT INTO combat_food_access(client_id,tier) VALUES(101,1)");
		expect(change_equipment(db,101,'herring','unlock-tier',{slot:'Food',revision})).toMatchObject({success:false,error:'cap_locked'});
		expect(combat_state(db,101).character!.levels.hitpoints).toBe(3);
	} finally { db.close(); }
});

test('additive raid migration preserves pre-existing characters, spending, projects and encounter rows', async () => {
	const { Database } = await import('bun:sqlite');
	const { migrations } = await import('../../db/schema');
	const db=new Database(':memory:'); try {
		db.run('PRAGMA foreign_keys=ON');
		for(const migration of migrations.filter(row=>row.version<209)) {
			if(migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.transaction(()=>db.run(migration.sql))();
			db.run('PRAGMA foreign_keys=ON');
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'migration','key','111-222-333','Migration','melvorD:Plant')");
		db.run('INSERT INTO combat_characters(client_id,attack,strength,defence,hitpoints,invested_micros) VALUES(101,4,7,2,9,24000000)');
		db.run("INSERT INTO combat_equipment_slots(client_id,slot,tier,equipped_item) VALUES(101,'Weapon',4,'melvorD:Mithril_Sword')");
		db.run("INSERT INTO combat_food_access(client_id,tier,equipped_item) VALUES(101,3,'melvorD:Trout')");
		db.run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at) VALUES(101,'melvorD:Mithril_Sword','{}',0)");
		db.run("INSERT INTO combat_encounters(id,client_id,controller,food_id,used,status,registration_json,created_at) VALUES('legacy',101,'owner','',0,'fled','{}',0)");
		const tables=['clients','combat_characters','combat_equipment_slots','combat_food_access','combat_equipment_projects'];
		const before=tables.map(table=>db.query('SELECT * FROM '+table).all());
		db.transaction(()=>db.run(migrations.find(row=>row.version===209)!.sql))();
		expect(tables.map(table=>db.query('SELECT * FROM '+table).all())).toEqual(before);
		expect(db.query('SELECT id,status,raid_endpoint,raid_completed,raid_ruleset FROM combat_encounters').get()).toEqual({id:'legacy',status:'fled',raid_endpoint:null,raid_completed:0,raid_ruleset:null});
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
		expect(db.query('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
	} finally { db.close(); }
});

test('leaderboard pages use current identities, deterministic ties and valid rulesets', () => {
	const db=fixture(); try {
		for(let i=0;i<12;i++) {
			const id=201+i;
			db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)').run(id,'board-'+i,'key-'+i,'board-code-'+i,'Runner '+i,'melvorD:Plant');
			db.query("INSERT INTO combat_raid_records(client_id,raid,ruleset,elapsed_ms,achieved_at) VALUES(?,'golbins',?,60000,?)").run(id,GOLBIN_RULESET,1000+i);
		}
		db.run("UPDATE clients SET display_name='Renamed' WHERE id=201");
		const first=combat_leaderboard(db,0), last=combat_leaderboard(db,99);
		expect(first.total).toBe(12); expect(first.players).toHaveLength(10);
		expect(first.players[0]).toMatchObject({client_id:201,display_name:'Renamed',elapsed_ms:60000,achieved_at:1000});
		expect(last.page).toBe(1); expect(last.players.map(row=>row.client_id)).toEqual([211,212]);
		db.run("UPDATE combat_raid_records SET ruleset='old' WHERE client_id=201");
		db.run('UPDATE clients SET disabled=1 WHERE id=202');
		expect(combat_leaderboard(db,-1)).toMatchObject({page:0,total:10});
	} finally { db.close(); }
});
