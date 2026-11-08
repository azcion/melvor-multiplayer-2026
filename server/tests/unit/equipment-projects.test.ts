import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat, combat_character, grant_combat_resets, combat_loadout, reset_combat_levels, purchase_combat_levels } from '../../combat-progression';
import { debug_equipment_project, reset_equipment, change_equipment, change_equipment_work, equipment_project_state, equipment_task_key, EQUIPMENT_PROJECTS, parse_action_statistics } from '../../equipment-projects';
import { ep_balance } from '../../wish-capacity';
function fixture(path = ':memory:') {
	const db = create_test_database(path);
	for (const id of [101, 102]) {
		db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)').run(id,`project-${id}`,'key',`111-222-${id}`,'Project','melvorD:Plant');
		db.query('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)').run(id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6]))));
		prepare_combat(db,id); db.query('UPDATE combat_tutorial SET victories=7 WHERE client_id=?').run(id); db.query('UPDATE expedition_ep_balances SET points_micros=10000000 WHERE client_id=?').run(id);
	}
	return db;
}
function unlock(db: ReturnType<typeof fixture>, action: string, extras = {}) {
	return db.transaction(() => change_equipment(db,101,crypto.randomUUID(),action,{slot:'Weapon',revision:combat_character(db,101)!.revision,...extras})).immediate();
}
function start(db: ReturnType<typeof fixture>) {
	unlock(db,'unlock-slot'); unlock(db,'unlock-tier'); unlock(db,'start-project',{item_id:'melvorD:Bronze_Dagger',discovered:true});
	return equipment_project_state(db,101).project!;
}

test('slot and Bronze gates cost EP exactly once; discovery optional; only one personal project', () => {
	const db=fixture();try {
		expect(unlock(db,'unlock-tier').success).toBe(false);
		expect(unlock(db,'unlock-slot').success).toBe(true);
		expect(unlock(db,'unlock-slot').success).toBe(false);
		expect(unlock(db,'start-project',{item_id:'melvorD:Bronze_Dagger',discovered:true}).success).toBe(false);
		expect(unlock(db,'unlock-tier').success).toBe(true);
		expect(unlock(db,'start-project',{item_id:'missing:Item'}).error).toBe('project_unavailable');
		expect(unlock(db,'start-project',{item_id:'melvorD:Bronze_Dagger'}).success).toBe(true);
		expect(unlock(db,'start-project',{item_id:'melvorD:Bronze_Dagger',discovered:true}).success).toBe(false);
		expect(ep_balance(db,101)).toBe(8000000);
		expect(equipment_project_state(db,102).project).toBeNull();
		expect(unlock(db,'equip',{item_id:'melvorD:Bronze_Dagger'}).success).toBe(false);
	}finally{db.close();}
});

test('permanent unlock and tier access cannot bypass current Online equip levels', () => {
	for (const [slot, skill, bronze, steel] of [
		['Weapon', 'attack', 'melvorD:Bronze_Sword', 'melvorD:Steel_Sword'],
		['Helmet', 'defence', 'melvorD:Bronze_Helmet', 'melvorD:Steel_Helmet']
	] as const) {
		const db = fixture(); try {
			db.query('INSERT INTO combat_equipment_slots(client_id,slot,tier,equipped_item) VALUES(101,?,3,?)').run(slot, bronze);
			for (const item of [bronze, steel]) db.query('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(101,?,\'{}\',0,1)').run(item);
			expect(purchase_combat_levels(db,101,crypto.randomUUID(),{[skill]:3},combat_character(db,101)!.revision).success).toBe(true);
			const before = combat_character(db,101)!;
			const balance = ep_balance(db,101);
			expect(unlock(db,'equip',{slot,item_id:steel})).toEqual({success:false,error:'requirements_unmet'});
			expect(combat_character(db,101)).toEqual(before);
			expect(ep_balance(db,101)).toBe(balance);
			expect(equipment_project_state(db,101).unlocked).toContain(steel);
			expect(purchase_combat_levels(db,101,crypto.randomUUID(),{[skill]:1},before.revision).success).toBe(true);
			const after_purchase = ep_balance(db,101);
			expect(unlock(db,'equip',{slot,item_id:steel})).toEqual({success:true});
			expect(combat_loadout(db,101)!.gear[slot]).toBe(steel);
			expect(ep_balance(db,101)).toBe(after_purchase);
		} finally { db.close(); }
	}
});

test('higher tier projects require the completed same-family predecessor while Bronze has none', () => {
	const db=fixture();try {
		// Iron Dagger cannot be started by unlocking its slot tier alone.
		db.query("INSERT INTO combat_equipment_slots(client_id,slot,tier) VALUES(102,'Weapon',2)").run();
		const start_iron = () => db.transaction(() => change_equipment(db,102,crypto.randomUUID(),'start-project',
			{item_id:'melvorD:Iron_Dagger',discovered:true,revision:combat_character(db,102)!.revision})).immediate();
		expect(start_iron()).toEqual({success:false,error:'project_unavailable'});
		db.query('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,?,?,?)')
			.run(102,'melvorD:Bronze_Dagger','{}',1,2);
		expect(start_iron().success).toBe(true);
		expect(equipment_project_state(db,102).project?.item_id).toBe('melvorD:Iron_Dagger');

		// The first tier is startable without a predecessor project.
		expect(unlock(db,'unlock-slot').success).toBe(true);
		expect(unlock(db,'unlock-tier').success).toBe(true);
		expect(unlock(db,'start-project',{item_id:'melvorD:Bronze_Dagger',discovered:true}).success).toBe(true);
	}finally{db.close();}
});

function equip_current_material(db: ReturnType<typeof fixture>, client: number, slot: string, tier: number) {
	const item = EQUIPMENT_PROJECTS.find(item => item.slot === slot && item.tier === tier && !item.unlock_only)!;
	db.query("INSERT OR IGNORE INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,'{}',0,1)").run(client,item.item_id);
	db.query('UPDATE combat_equipment_slots SET equipped_item=? WHERE client_id=? AND slot=?').run(item.item_id,client,slot);
	return item;
}

test('each slot advances sequentially through all six server-priced tiers and rejects forged prices atomically', () => {
	const db=fixture();try {
		db.query('UPDATE expedition_ep_balances SET points_micros=154000000 WHERE client_id=101').run();
		db.run('UPDATE combat_characters SET attack=99,defence=99');
		for (const slot of ['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves']) {
			let revision=combat_character(db,101)!.revision;
			const forged_slot_quote={slot,revision,cost_micros:0,tier:6};
			expect(change_equipment(db,101,crypto.randomUUID(),'unlock-slot',forged_slot_quote).success).toBe(true);
			for (const tier of [1,2,3,4,5,6]) {
				if (tier > 1) equip_current_material(db,101,slot,tier-1);
				revision=combat_character(db,101)!.revision;
				const forged_tier_quote={slot,revision,cost_micros:0,tier:6};
				expect(change_equipment(db,101,crypto.randomUUID(),'unlock-tier',forged_tier_quote).success).toBe(true);
				expect(db.query<{tier:number},[number,string]>('SELECT tier FROM combat_equipment_slots WHERE client_id=? AND slot=?').get(101,slot)!.tier).toBe(tier);
			}
		}
		expect(ep_balance(db,101)).toBe(0);
		expect(db.query<{amount_micros:number},[number]>('SELECT amount_micros FROM combat_ep_ledger WHERE client_id=? ORDER BY id').all(101).map(row=>row.amount_micros))
			.toEqual(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves'].flatMap(() => [-1000000,-1000000,-2000000,-3000000,-4000000,-5000000,-6000000]));

		let revision=combat_character(db,102)!.revision;
		expect(change_equipment(db,102,crypto.randomUUID(),'unlock-slot',{slot:'Weapon',revision}).success).toBe(true);
		for(const tier of [1,2,3]) {
			if (tier > 1) equip_current_material(db,102,'Weapon',tier-1);
			revision=combat_character(db,102)!.revision;
			expect(change_equipment(db,102,crypto.randomUUID(),'unlock-tier',{slot:'Weapon',revision}).success).toBe(true);
		}
		revision=combat_character(db,102)!.revision;
		equip_current_material(db,102,'Weapon',3);
		const forged_insufficient_quote={slot:'Weapon',revision,cost_micros:0,tier:4};
		const failed=change_equipment(db,102,crypto.randomUUID(),'unlock-tier',forged_insufficient_quote);
		expect(failed).toEqual({success:false,error:'insufficient_ep'});
		expect(db.query<{tier:number},[number,string]>('SELECT tier FROM combat_equipment_slots WHERE client_id=? AND slot=?').get(102,'Weapon')!.tier).toBe(3);
		expect(ep_balance(db,102)).toBe(3000000);
		expect(db.query<{amount_micros:number},[number]>('SELECT amount_micros FROM combat_ep_ledger WHERE client_id=? ORDER BY id').all(102).map(row=>row.amount_micros))
			.toEqual([-1000000,-1000000,-2000000,-3000000]);
	}finally{db.close();}
});

test('only final production actions credit 30 seconds; replay and reusable equipment never award EP', () => {
	const db=fixture();try {
		const project=start(db), task=project.stages[0][0], key=task.task_id, epoch=crypto.randomUUID();
		const request={kind:'start' as const,project_id:project.id,task_id:key,captured_at:1000,
			actions:{epoch,time_ms:{[key]:0}},statistics:{time_ms:{[task.skill_id]:0}},activities:[{type:'skill',skill_id:task.skill_id,action_id:task.action_id}]};
		for (const action of ['melvorD:Copper_Ore','melvorD:Bronze_Bar']) {
			expect(change_equipment_work(db,101,crypto.randomUUID(),{...request,activities:[{type:'skill',skill_id:task.skill_id,action_id:action}]},1000).error).toBe('activity_required');
		}
		expect(change_equipment_work(db,101,crypto.randomUUID(),request,1000).success).toBe(true);
		const stop={...request,kind:'stop' as const,captured_at:61000,actions:{epoch,time_ms:{[key]:60000}},statistics:{time_ms:{[task.skill_id]:60000}}};
		const operation=crypto.randomUUID(), result=change_equipment_work(db,101,operation,stop,61000);
		expect(result.settlement.credited_ms).toBe(30000);
		expect(change_equipment_work(db,101,operation,stop,62000)).toEqual(result);
		expect(change_equipment_work(db,101,operation,{...stop,kind:'check-in'},62000).error).toBe('operation_conflict');
		expect(equipment_project_state(db,101).unlocked).toEqual(['multiplayer:Wooden_Sword', 'melvorD:Bronze_Dagger']);
		expect(equipment_project_state(db,101).project).toBeNull();
		expect(ep_balance(db,101)).toBe(8000000);
		expect(db.query('SELECT * FROM expedition_ep_ledger WHERE client_id=101').all()).toEqual([]);
		expect(unlock(db,'equip',{item_id:'melvorD:Bronze_Dagger'}).success).toBe(true);
		expect(combat_loadout(db,101)!.gear).toEqual({Weapon:'melvorD:Bronze_Dagger'});
		db.transaction(()=>purchase_combat_levels(db,101,crypto.randomUUID(),{attack:1},combat_character(db,101)!.revision)).immediate();
		db.transaction(()=>reset_combat_levels(db,101,crypto.randomUUID(),combat_character(db,101)!.revision)).immediate();
		expect(equipment_project_state(db,101).unlocked).toEqual(['multiplayer:Wooden_Sword', 'melvorD:Bronze_Dagger']);
		expect(ep_balance(db,101)).toBe(7900000);
	}finally{db.close();}
});

test('project work starts and continues during an active encounter without changing its loadout', () => {
	const db = fixture(); try {
		const project = start(db), task = EQUIPMENT_PROJECTS[0].stages[0][0];
		const key = equipment_task_key(task), epoch = crypto.randomUUID();
		db.run("INSERT INTO combat_encounters(id,client_id,controller,status,registration_json,food_id,used,created_at) VALUES('project-active',101,'controller','active','{}','',0,1)");
		const before = combat_character(db,101)!, balance = ep_balance(db,101);
		const report = (kind: 'start'|'check-in'|'stop', elapsed: number) => change_equipment_work(db,101,crypto.randomUUID(),{
			kind, project_id: project.id, task_id: key, captured_at: 1000 + elapsed,
			actions: { epoch, time_ms: { [key]: elapsed } }, statistics: { time_ms: { [task.skill_id]: elapsed } },
			activities: [{ type: 'skill', skill_id: task.skill_id, action_id: task.action_id }]
		},1000 + elapsed);
		expect(report('start',0).success).toBe(true);
		const check_in = report('check-in',10000);
		expect(check_in.settlement.credited_ms).toBe(10000);
		expect(check_in.tracking?.task_id).toBe(key);
		expect(report('stop',20000).settlement.credited_ms).toBe(10000);
		expect(equipment_project_state(db,101).project!.stages[0][0].player_ms).toBe(20000);
		expect(combat_character(db,101)).toEqual(before);
		expect(ep_balance(db,101)).toBe(balance);
		expect(db.query("SELECT status,registration_json FROM combat_encounters WHERE id='project-active'").get()).toEqual({status:'active',registration_json:'{}'});
		// Save-rollback holds still prevent new tracking and work credit.
		expect(report('start',20000).success).toBe(true);
		db.run("INSERT INTO economy_client_holds(client_id,held,reason,created_at) VALUES(101,1,'test',1)");
		const held = report('check-in',30000);
		expect(held.settlement.credited_ms).toBe(0);
		expect(held.tracking).toBeNull();
		expect(report('start',30000).error).toBe('activity_required');
	} finally { db.close(); }
});

test('counter epoch changes, unrelated same-skill work and wall-clock rollback cannot grant work',()=>{
	const db=fixture();try{
		const project=start(db),task=EQUIPMENT_PROJECTS[0].stages[0][0],key=equipment_task_key(task),epoch=crypto.randomUUID();
		const request={kind:'start' as 'start'|'check-in'|'stop',project_id:project.id,task_id:key,captured_at:1000,actions:{epoch,time_ms:{[key]:0}},statistics:{time_ms:{'melvorD:Mining':0}},activities:[{type:'skill',skill_id:task.skill_id,action_id:task.action_id}]};
		expect(change_equipment_work(db,101,crypto.randomUUID(),request,1000).success).toBe(true);
		expect(change_equipment_work(db,101,crypto.randomUUID(),{...request,kind:'stop',captured_at:301000,actions:{epoch:crypto.randomUUID(),time_ms:{[key]:300000}}},301000).settlement.credited_ms).toBe(0);
		expect(change_equipment_work(db,101,crypto.randomUUID(),request,302000).success).toBe(true);
		expect(change_equipment_work(db,101,crypto.randomUUID(),{...request,kind:'stop',captured_at:0,actions:{epoch,time_ms:{[key]:300000}}},602000).settlement.credited_ms).toBe(0);
		expect(parse_action_statistics({epoch,time_ms:{[key]:Infinity}})).toBeNull();
		const full_evidence=Object.fromEntries([...new Set(EQUIPMENT_PROJECTS.flatMap(project=>project.stages.flat().map(equipment_task_key)))].map(action=>[action,0]));
		expect(Object.keys(full_evidence).length).toBeGreaterThan(16);
		expect(parse_action_statistics({epoch,time_ms:full_evidence})).not.toBeNull();
		expect(parse_action_statistics({epoch,time_ms:{...full_evidence,'melvorD:Fake_Skill|melvorD:Fake_Action':0}})).toBeNull();
	}finally{db.close();}
});

test('equipment schema adds only private tables and preserves every populated pre-existing table', async () => {
	const { migrations } = await import('../../db/schema');
	const { Database } = await import('bun:sqlite');
	const db = new Database(':memory:', { strict: true });
	try {
		for (const migration of migrations.filter(row => row.version < 199)) {
			if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.transaction(() => db.run(migration.sql)).immediate(); db.run('PRAGMA foreign_keys=ON');
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'migration-owner','key','123-456-789','Fixture','melvorD:Plant')");
		db.run('INSERT INTO combat_characters(client_id) VALUES(101)');
		db.run('INSERT INTO expedition_ep_balances VALUES(101,7000000)');
		db.run('INSERT INTO combat_reset_balances VALUES(101,2)');
		const names = db.query<{name:string},[]>("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row=>row.name);
		const snapshot = () => Object.fromEntries(names.map(name=>[name,db.query(`SELECT * FROM "${name}"`).all()]));
		const before = snapshot(); db.transaction(()=>db.run(migrations.find(row=>row.version===199)!.sql)).immediate();
		expect(snapshot()).toEqual(before); expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});


test('project progress, active evidence and report replay survive reopening the database', () => {
	const directory = mkdtempSync(join(tmpdir(), 'equipment-project-'));
	const path = join(directory, 'project.sqlite');
	let db = fixture(path);
	try {
		const project = start(db), task = EQUIPMENT_PROJECTS[0].stages[0][0], key = equipment_task_key(task), epoch = crypto.randomUUID();
		const request = { kind: 'start' as 'start'|'stop', project_id: project.id, task_id: key, captured_at: 1000,
			actions: { epoch, time_ms: { [key]: 0 } }, statistics: { time_ms: { [task.skill_id]: 0 } },
			activities: [{ type:'skill', skill_id:task.skill_id, action_id:task.action_id }] };
		expect(change_equipment_work(db,101,crypto.randomUUID(),request,1000).success).toBe(true);
		db.close(); db = new Database(path, { strict:true }); db.run('PRAGMA foreign_keys=ON');
		const operation = crypto.randomUUID();
		const stop = { ...request, kind:'stop' as const, captured_at:11000,
			actions:{epoch,time_ms:{[key]:10000}},statistics:{time_ms:{[task.skill_id]:10000}} };
		const result = change_equipment_work(db,101,operation,stop,11000);
		expect(result.settlement.credited_ms).toBe(10000);
		const stored = db.query<{response:string},[string]>('SELECT response FROM combat_project_reports WHERE operation_id=?').get(operation)!.response;
		expect(stored.length).toBeLessThan(5000);
		expect(JSON.parse(stored).equipment_projects.catalog).toBeUndefined();
		expect(JSON.parse(stored).equipment_projects.access).toBeUndefined();
		expect(result.equipment_projects.catalog.length).toBe(EQUIPMENT_PROJECTS.length + 2);
		db.close(); db = new Database(path, { strict:true });
		expect(change_equipment_work(db,101,operation,stop,302000)).toEqual(result);
		expect(equipment_project_state(db,101).project!.stages[0][0].player_ms).toBe(10000);
		expect(ep_balance(db,101)).toBe(8000000);
	} finally { db.close(); rmSync(directory,{recursive:true,force:true}); }
});

test('admin project completion is scoped, capped, ordered and audited without EP or native effects', () => {
	const db = fixture(); try {
		const project = start(db), before = ep_balance(db,101);
		const run = (extras: Record<string, unknown> = {}) => db.transaction(() => debug_equipment_project(db,101,crypto.randomUUID(),
			{ project_id: project.id, revision: combat_character(db,101)!.revision, task_id: null, ...extras })).immediate();
		expect(run({ project_id: project.id + 999 }).success).toBe(false);
		expect(run({ revision: -1 }).success).toBe(false);
		expect(run({ task_id: 'melvorD:Mining|melvorD:Copper_Ore' }).success).toBe(false);
		expect(debug_equipment_project(db,102,crypto.randomUUID(),{project_id:project.id,revision:0,task_id:null}).success).toBe(false);
		const task = project.stages[0][0];
		expect(run({task_id:task.task_id}).success).toBe(true);
		expect(run({task_id:task.task_id}).success).toBe(false);
		expect(equipment_project_state(db,101).project).toBeNull();
		expect(equipment_project_state(db,101).unlocked).toEqual(['multiplayer:Wooden_Sword', 'melvorD:Bronze_Dagger']);
		expect(run().success).toBe(false);
		expect(ep_balance(db,101)).toBe(before);
		expect(db.query('SELECT COUNT(*) AS n FROM audit_events WHERE event_type=?').get('combat-project-test')).toEqual({n:1});
		expect(equipment_project_state(db,102).unlocked).toEqual([]);
	} finally { db.close(); }
});

test('admin shortcut refuses active tracking and encounters without altering progress', () => {
	const db = fixture(); try {
		const project = start(db), task = project.stages[0][0], now = Date.now();
		const request = {kind:'start' as const,project_id:project.id,task_id:task.task_id,captured_at:now,
			actions:{epoch:crypto.randomUUID(),time_ms:{[task.task_id]:0}},activities:[{type:'skill',skill_id:task.skill_id,action_id:task.action_id}],statistics:{time_ms:{[task.skill_id]:0}}};
		expect(change_equipment_work(db,101,crypto.randomUUID(),request,now).success).toBe(true);
		const input = {project_id:project.id,revision:combat_character(db,101)!.revision,task_id:null};
		expect(debug_equipment_project(db,101,crypto.randomUUID(),input)).toEqual({success:false,error:'tracking_busy'});
		expect(equipment_project_state(db,101).project).toEqual(project);
		db.query('DELETE FROM combat_project_tracking WHERE client_id=101').run();
		db.query("INSERT INTO economy_client_holds(client_id,held,reason,created_at) VALUES(101,1,'test',?)").run(now);
		expect(debug_equipment_project(db,101,crypto.randomUUID(),input)).toEqual({success:false,error:'active'});
		db.query("INSERT INTO economy_client_holds(client_id,held,reason,created_at) VALUES(101,0,'test',?)").run(now);
		db.query("INSERT INTO combat_encounters(id,client_id,controller,status,registration_json,food_id,used,created_at) VALUES('debug-active',101,'controller','active','{}','melvorD:Shrimp',0,?)").run(now);
		expect(debug_equipment_project(db,101,crypto.randomUUID(),input)).toEqual({success:false,error:'active'});
	} finally { db.close(); }
});

test('arrow projects use Quiver gates, staged native work and permanent unlimited unlocks without combat admission', async () => {
	const { parse_registration } = await import('../../combat/catalog');
	const db=fixture();try {
		const bronze = EQUIPMENT_PROJECTS.find(item => item.item_id === 'melvorD:Bronze_Arrows')!;
		expect(unlock(db,'start-project',{item_id:bronze.item_id,discovered:true}).success).toBe(false);
		unlock(db,'unlock-slot',{slot:'Quiver'}); unlock(db,'unlock-tier',{slot:'Quiver'});
		expect(unlock(db,'start-project',{item_id:bronze.item_id,discovered:false}).success).toBe(true);
		const project = equipment_project_state(db,101).project!;
		let now=1000; const epoch=crypto.randomUUID(), counters:Record<string,number>={}, skills:Record<string,number>={};
		const report = (kind:'start'|'stop', task:typeof bronze.stages[number][number], delta=0) => {
			const key=equipment_task_key(task); now+=delta; counters[key]=(counters[key]??0)+delta; skills[task.skill_id]=(skills[task.skill_id]??0)+delta;
			return change_equipment_work(db,101,crypto.randomUUID(),{kind,project_id:project.id,task_id:key,captured_at:now,
				actions:{epoch,time_ms:{...counters}},statistics:{time_ms:{...skills}},activities:[{type:'skill',skill_id:task.skill_id,action_id:task.action_id==='multiplayer:Any_Woodcutting'?'melvorD:Redwood':task.action_id}]},now);
		};
		expect(report('start',{skill_id:'melvorD:Woodcutting',action_id:'multiplayer:Any_Woodcutting',target_ms:30000}).error).toBe('activity_required');
		for (const task of bronze.stages.flat()) {
			expect(report('start',task).success).toBe(true);
			expect(report('stop',task,task.target_ms).settlement.credited_ms).toBe(task.target_ms);
		}
		expect(equipment_project_state(db,101).unlocked).toContain(bronze.item_id);
		expect(ep_balance(db,101)).toBe(8000000);
		expect(unlock(db,'equip',{slot:'Quiver',item_id:bronze.item_id}).error).toBe('project_unavailable');
		expect(parse_registration({levels:{attack:99,strength:99,defence:99,hitpoints:99},gear:{Quiver:bronze.item_id}})).toBeNull();
		expect(unlock(db,'unlock-tier',{slot:'Quiver'}).error).toBe('equip_current_tier');
		// Retained higher access still permits existing arrow work while Ranged equipping is unavailable.
		db.run("UPDATE combat_equipment_slots SET tier=2 WHERE client_id=101 AND slot='Quiver'");
		expect(unlock(db,'start-project',{item_id:'melvorD:Iron_Arrows',discovered:true}).success).toBe(true);
		const iron=equipment_project_state(db,101).project!;
		expect(debug_equipment_project(db,101,crypto.randomUUID(),{revision:combat_character(db,101)!.revision,project_id:iron.id,task_id:null}).success).toBe(true);
		expect(equipment_project_state(db,101).unlocked).toContain('melvorD:Iron_Arrows');
		// Another character with tier access still needs the prior arrow material.
		db.run("INSERT INTO combat_equipment_slots(client_id,slot,tier) VALUES(102,'Quiver',6)");
		expect(change_equipment(db,102,crypto.randomUUID(),'start-project',{revision:combat_character(db,102)!.revision,item_id:'melvorD:Iron_Arrows',discovered:true}).error).toBe('project_unavailable');
	}finally{db.close();}
});

test('Quiver migration preserves slot purchases, equipped items and project evidence', async () => {
	const { migrations } = await import('../../db/schema');
	const db = new Database(':memory:', {strict:true});
	try {
		for(const migration of migrations.filter(row=>row.version<=200)) {
			if(migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.transaction(()=>db.run(migration.sql)).immediate(); db.run('PRAGMA foreign_keys=ON');
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'arrow-migration','key','123-456-789','Fixture','melvorD:Plant')");
		db.run('INSERT INTO combat_characters(client_id) VALUES(101)');
		db.run("INSERT INTO combat_equipment_slots VALUES(101,'Weapon',3,'melvorD:Bronze_Dagger')");
		db.run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at) VALUES(101,'melvorD:Bronze_Helmet','{}',1)");
		db.run("INSERT INTO combat_project_tracking VALUES(101,1,'melvorD:Mining|melvorD:Copper_Ore',1,0,'epoch',0,'{}')");
		const tables=['combat_equipment_slots','combat_equipment_projects','combat_project_tracking','combat_characters'];
		const snapshot=()=>tables.map(table=>db.query(`SELECT * FROM ${table}`).all());
		const before=snapshot();
		db.run('PRAGMA foreign_keys=OFF');
		db.transaction(()=>{db.run(migrations.find(row=>row.version===201)!.sql);expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);}).immediate();
		db.run('PRAGMA foreign_keys=ON');
		expect(snapshot()).toEqual(before);
		db.run("INSERT INTO combat_equipment_slots VALUES(101,'Quiver',1,NULL)");
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	}finally{db.close();}
});

test('slot upgrading requires the current material equipped, permanent unlock and current Online level', () => {
	const db=fixture();try {
		unlock(db,'unlock-slot'); unlock(db,'unlock-tier');
		const before=ep_balance(db,101), revision=combat_character(db,101)!.revision;
		expect(unlock(db,'unlock-tier')).toEqual({success:false,error:'equip_current_tier'});
		expect(ep_balance(db,101)).toBe(before); expect(combat_character(db,101)!.revision).toBe(revision);
		db.run("UPDATE combat_equipment_slots SET equipped_item='melvorD:Bronze_Dagger' WHERE client_id=101");
		expect(unlock(db,'unlock-tier').error).toBe('equip_current_tier');
		equip_current_material(db,101,'Weapon',1);
		expect(unlock(db,'unlock-tier').success).toBe(true);
		// Equipped Bronze cannot buy Steel after Iron access has been purchased.
		expect(unlock(db,'unlock-tier').error).toBe('equip_current_tier');
		equip_current_material(db,101,'Weapon',2);
		expect(unlock(db,'unlock-tier').success).toBe(true);
		equip_current_material(db,101,'Weapon',3);
		expect(unlock(db,'unlock-tier').error).toBe('equip_current_tier');
		db.run('UPDATE combat_characters SET attack=5 WHERE client_id=101');
		db.run('UPDATE expedition_ep_balances SET points_micros=10000000 WHERE client_id=101');
		expect(unlock(db,'unlock-tier').success).toBe(true);
	}finally{db.close();}
});

test('equipment reset refunds access only and preserves completed projects, active work and levels', () => {
	const db=fixture();try {
		const project=start(db);
		const task=project.stages[0][0], epoch=crypto.randomUUID();
		expect(change_equipment_work(db,101,crypto.randomUUID(),{kind:'start',project_id:project.id,task_id:task.task_id,captured_at:1000,
			actions:{epoch,time_ms:{[task.task_id]:0}},statistics:{time_ms:{[task.skill_id]:0}},activities:[{type:'skill',skill_id:task.skill_id,action_id:task.action_id}]},1000).success).toBe(true);
		db.run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(101,'melvorD:Bronze_Sword','{}',0,1)");
		const revision=combat_character(db,101)!.revision, before=combat_character(db,101)!.levels;
		expect(equipment_project_state(db,101).reset).toMatchObject({invested_micros:2000000,fee_micros:200000,refund_micros:1800000});
		expect(db.transaction(()=>reset_equipment(db,101,crypto.randomUUID(),revision)).immediate()).toEqual({success:true,refunded_micros:1800000,fee_micros:200000});
		expect(ep_balance(db,101)).toBe(9800000);
		expect(equipment_project_state(db,101).slots).toEqual([]);
		expect(equipment_project_state(db,101).unlocked).toContain('melvorD:Bronze_Sword');
		expect(equipment_project_state(db,101).project).toEqual(project);
		expect(db.query('SELECT 1 FROM combat_project_tracking WHERE client_id=101').get()).not.toBeNull();
		expect(combat_character(db,101)!.levels).toEqual(before);
		expect(reset_equipment(db,101,crypto.randomUUID(),revision).error).toBe('quote_changed');
		expect(reset_equipment(db,101,crypto.randomUUID(),combat_character(db,101)!.revision).error).toBe('nothing_to_reset');
		expect(unlock(db,'equip',{item_id:'melvorD:Bronze_Sword'}).error).toBe('slot_locked');
		// Work continues even though resetting removed its purchased slot access.
		const stopped=change_equipment_work(db,101,crypto.randomUUID(),{kind:'stop',project_id:project.id,task_id:task.task_id,captured_at:2000,
			actions:{epoch,time_ms:{[task.task_id]:1000}},statistics:{time_ms:{[task.skill_id]:1000}},activities:[]},2000);
		expect(stopped.settlement?.credited_ms).toBe(1000);
	}finally{db.close();}
});

test('equipment and level resets consume the same free-reset balance, once per valid reset', () => {
	const db=fixture();try {
		start(db);
		expect(grant_combat_resets(db,101,1,crypto.randomUUID())).toBe(true);
		const reset=()=>db.transaction(()=>reset_equipment(db,101,crypto.randomUUID(),combat_character(db,101)!.revision)).immediate();
		expect(equipment_project_state(db,101).reset.refund_micros).toBe(2000000);
		expect(reset()).toEqual({success:true,refunded_micros:2000000,fee_micros:0});
		expect(combat_character(db,101)!.banked_resets).toBe(0);
		expect(ep_balance(db,101)).toBe(10000000);
		expect(purchase_combat_levels(db,101,crypto.randomUUID(),{attack:1},combat_character(db,101)!.revision).success).toBe(true);
		expect(reset_combat_levels(db,101,crypto.randomUUID(),combat_character(db,101)!.revision).refunded_micros).toBe(900000);
		expect(reset().error).toBe('nothing_to_reset');
	}finally{db.close();}
});

test('active encounters and rollback holds cannot reset or refund equipment access', () => {
	const db=fixture();try {
		start(db);
		const before=equipment_project_state(db,101), balance=ep_balance(db,101), revision=combat_character(db,101)!.revision;
		const reset=()=>db.transaction(()=>reset_equipment(db,101,crypto.randomUUID(),revision)).immediate();
		db.run("INSERT INTO economy_client_holds(client_id,held,reason,created_at) VALUES(101,1,'test',0)");
		expect(reset()).toEqual({success:false,error:'active'});
		db.run("INSERT INTO economy_client_holds(client_id,held,reason,created_at) VALUES(101,0,'test',1)");
		db.run("INSERT INTO combat_encounters(id,client_id,controller,status,registration_json,food_id,used,created_at) VALUES('reset-active',101,'controller','active','{}','melvorD:Shrimp',0,1)");
		expect(reset()).toEqual({success:false,error:'active'});
		expect(ep_balance(db,101)).toBe(balance); expect(equipment_project_state(db,101)).toEqual(before);
		expect(combat_character(db,101)!.revision).toBe(revision);
	}finally{db.close();}
});

test('cancel discards only the exact active project and tracking, allowing a fresh start', () => {
	const db = fixture(); try {
		const project = start(db);
		const task = project.stages[0][0];
		db.query('UPDATE combat_equipment_projects SET progress_json=? WHERE id=?').run(JSON.stringify({ [task.task_id]: 1234 }), project.id);
		db.query('INSERT INTO combat_project_tracking(client_id,project_id,task_id,started_at,start_clock_offset_ms,epoch,counter_ms,statistics_json) VALUES(?,?,?,?,?,?,?,?)').run(101, project.id, task.task_id, Date.now(), 0, crypto.randomUUID(), 0, '{}');
		const balance = ep_balance(db, 101);
		expect(unlock(db, 'cancel-project', { project_id: project.id + 1 }).success).toBe(false);
		expect(unlock(db, 'cancel-project', { project_id: project.id }).success).toBe(true);
		expect(equipment_project_state(db, 101).project).toBeNull();
		expect(db.query('SELECT * FROM combat_project_tracking WHERE client_id=101').get()).toBeNull();
		expect(ep_balance(db, 101)).toBe(balance);
		expect(unlock(db, 'start-project', { item_id: project.item_id, discovered: true }).success).toBe(true);
		const fresh = equipment_project_state(db, 101).project!;
		expect(fresh.id).not.toBe(project.id);
		expect(fresh.stages.flat().every(task => task.player_ms === 0)).toBe(true);
		expect(unlock(db, 'cancel-project', { project_id: project.id }).success).toBe(false);
	} finally { db.close(); }
});

test('food access costs exactly 1 EP per sequential tier, requires completion, and participates in resets', () => {
	const db=fixture(); try {
		for (const [index,name] of ['Shrimp','Herring','Trout','Salmon','Lobster','Swordfish','Crab','Carp'].entries()) {
			expect(unlock(db,'unlock-tier',{slot:'Food'}).success).toBe(true);
			expect(ep_balance(db,101)).toBe(10000000-(index+1)*1000000);
			expect(unlock(db,'unlock-tier',{slot:'Food'}).success).toBe(false);
			expect(unlock(db,'start-project',{item_id:`melvorD:${name}`,discovered:false}).success).toBe(true);
			const project=equipment_project_state(db,101).project!;
			expect(project.stages).toHaveLength(1);
			expect(project.stages[0][0]).toMatchObject({skill_id:'melvorD:Cooking',action_id:`melvorD:${name}`,target_ms:30000});
			expect(unlock(db,'equip',{slot:'Food',item_id:`melvorD:${name}`}).success).toBe(false);
			expect(debug_equipment_project(db,101,crypto.randomUUID(),{revision:combat_character(db,101)!.revision,project_id:project.id,task_id:null}).success).toBe(true);
			expect(unlock(db,'equip',{slot:'Food',item_id:`melvorD:${name}`}).success).toBe(true);
		}
		expect(equipment_project_state(db,101).reset.invested_micros).toBe(8000000);
		const reset=db.transaction(()=>reset_equipment(db,101,crypto.randomUUID(),combat_character(db,101)!.revision)).immediate();
		expect(reset).toMatchObject({success:true,refunded_micros:7200000,fee_micros:800000});
		expect(equipment_project_state(db,101).unlocked).toHaveLength(8);
		expect(unlock(db,'equip',{slot:'Food',item_id:'melvorD:Carp'}).success).toBe(false);
		for(const name of ['Shrimp','Herring','Trout','Salmon','Lobster','Swordfish','Crab','Carp']) {
			expect(unlock(db,'unlock-tier',{slot:'Food'}).success).toBe(true);
			expect(unlock(db,'equip',{slot:'Food',item_id:`melvorD:${name}`}).success).toBe(true);
		}
		expect(unlock(db,'equip',{slot:'Food',item_id:'melvorD:Carp'}).success).toBe(true);
	} finally {db.close();}
});

test('food work settles exact 30-second Cooking action-time evidence, including offline reports', () => {
	const db=fixture(); try {
		unlock(db,'unlock-tier',{slot:'Food'});unlock(db,'start-project',{item_id:'melvorD:Shrimp',discovered:true});
		const project=equipment_project_state(db,101).project!;
		const epoch=crypto.randomUUID();let clock=1000;
		for (const [index,group] of project.stages.entries()) {
			const task=group[0], key=task.task_id;
			const request={kind:'start' as const,project_id:project.id,task_id:key,captured_at:clock,
				actions:{epoch,time_ms:{[key]:0}},activities:[{type:'skill',skill_id:task.skill_id,action_id:task.action_id}],statistics:{time_ms:{[task.skill_id]:0}}};
			if(index===0) expect(change_equipment_work(db,101,crypto.randomUUID(),{...request,task_id:'melvorD:Mining|melvorD:Copper_Ore'},clock).success).toBe(false);
			expect(change_equipment_work(db,101,crypto.randomUUID(),request,clock).success).toBe(true);
			clock+=30000;
			const operation=crypto.randomUUID();
			const stopped={...request,kind:'stop' as const,captured_at:clock,actions:{epoch,time_ms:{[key]:30000}},statistics:{time_ms:{[task.skill_id]:30000}}};
			const result=change_equipment_work(db,101,operation,stopped,clock);
			expect(result.settlement?.credited_ms).toBe(30000);
			expect(change_equipment_work(db,101,operation,stopped,clock)).toEqual(result);
			clock+=1000;
		}
		expect(equipment_project_state(db,101).unlocked).toContain('melvorD:Shrimp');
		expect(ep_balance(db,101)).toBe(9000000);
	} finally {db.close();}
});


test('second food slot cannot be unlocked or upgraded and rejected requests spend no EP', () => {
	const db = fixture(); try {
		const before = ep_balance(db,101);
		const revision = combat_character(db,101)!.revision;
		for (const action of ['unlock-slot','unlock-tier'])
			expect(unlock(db,action,{slot:'Food2'})).toMatchObject({success:false,error:'slot_locked'});
		expect(equipment_project_state(db,101).slots).toEqual([]);
		db.run("INSERT INTO combat_food_access(client_id,slot,tier) VALUES(101,'Food2',1)");
		expect(unlock(db,'unlock-tier',{slot:'Food2'})).toMatchObject({success:false,error:'slot_locked'});
		expect(ep_balance(db,101)).toBe(before);
		expect(combat_character(db,101)!.revision).toBe(revision);
		expect(unlock(db,'unlock-tier',{slot:'Food'}).success).toBe(true);
	} finally { db.close(); }
});

test('card resets refund only their own slots, preserve projects and share free reset credits', () => {
	for (const group of ['equipment','consumables'] as const) {
		const db=fixture();try {
			unlock(db,'unlock-slot');unlock(db,'unlock-tier');
			unlock(db,'unlock-tier',{slot:'Food'});
			// Previously purchased second-slot access remains refundable while new purchases are locked.
			db.run("INSERT INTO combat_food_access(client_id,slot,tier) VALUES(101,'Food2',1)");
			unlock(db,'start-project',{item_id:'melvorD:Shrimp',discovered:true});
			const project=equipment_project_state(db,101).project;
			expect(equipment_project_state(db,101).resets[group]).toMatchObject({invested_micros:2000000,fee_micros:200000,refund_micros:1800000});
			const revision=combat_character(db,101)!.revision;
			expect(reset_equipment(db,101,crypto.randomUUID(),revision,Date.now(),'invalid')).toMatchObject({success:false,error:'rejected'});
			const reset=db.transaction(()=>reset_equipment(db,101,crypto.randomUUID(),revision,Date.now(),group)).immediate();
			expect(reset).toMatchObject({success:true,refunded_micros:1800000,fee_micros:200000});
			const model=equipment_project_state(db,101);
			expect(model.slots.map(slot=>slot.slot)).toEqual(group==='equipment'?['Food','Food2']:['Weapon']);
			expect(model.project).toEqual(project);
			expect(model.resets[group].invested_micros).toBe(0);
			const remaining=group==='equipment'?'consumables':'equipment';
			expect(model.resets[remaining].invested_micros).toBe(2000000);
			grant_combat_resets(db,101,1,crypto.randomUUID());
			expect(equipment_project_state(db,101).resets[remaining]).toMatchObject({banked_resets:1,fee_micros:0,refund_micros:2000000});
			const free=db.transaction(()=>reset_equipment(db,101,crypto.randomUUID(),combat_character(db,101)!.revision,Date.now(),remaining)).immediate();
			expect(free).toMatchObject({success:true,refunded_micros:2000000,fee_micros:0});
			expect(equipment_project_state(db,101).reset.banked_resets).toBe(0);
			expect(equipment_project_state(db,101).slots).toEqual([]);
			expect(combat_character(db,101)!.levels.attack).toBe(1);
		}finally{db.close();}
	}
});

test('freshness is transport-only; replay retains settlement and forces a current-state read', () => {
	const db = fixture(); try {
		const project = start(db), task = project.stages[0][0], key = task.task_id;
		const operation = crypto.randomUUID();
		const request = { kind:'start' as const, project_id:project.id, task_id:key, captured_at:1000,
			actions:{ epoch:crypto.randomUUID(),time_ms:{[key]:0} }, statistics:{time_ms:{[task.skill_id]:0}},
			activities:[{type:'skill',skill_id:task.skill_id,action_id:task.action_id}] };
		const fresh = change_equipment_work(db,101,operation,request,1000,true);
		expect(fresh.equipment_work_current).toBe(true);
		const replay = change_equipment_work(db,101,operation,request,2000,true);
		expect(replay.equipment_work_current).toBe(false);
		expect({ ...replay,equipment_work_current:true }).toEqual(fresh);
		const legacy = change_equipment_work(db,101,operation,request,3000);
		expect(legacy.equipment_work_current).toBeUndefined();
		expect(legacy.equipment_projects.catalog).toBeArray();
	} finally { db.close(); }
});

test('all equipment projects retain only the final native recipe action at a flat 30 seconds', () => {
	const original = JSON.parse(readFileSync(new URL('../../equipment-recipes-v1.json', import.meta.url), 'utf8')) as {items: (typeof EQUIPMENT_PROJECTS[number])[]};
	for (const item of original.items) {
		const actual = EQUIPMENT_PROJECTS.find(entry => entry.item_id === item.item_id)!;
		expect(actual).toEqual({...item,stages:[item.stages.at(-1)!.map(task=>({...task,target_ms:30000}))]});
	}
});

test('shorter tutorial upgrade completes satisfied saved projects and preserves partial work', async () => {
	const { migrations } = await import('../../db/schema');
	const db = fixture(); try {
		const original = JSON.parse(readFileSync(new URL('../../equipment-recipes-v1.json', import.meta.url), 'utf8')) as {items: (typeof EQUIPMENT_PROJECTS[number])[]};
		const item = original.items.find(item => item.item_id === 'melvorD:Bronze_Shield')!;
		for (const task of item.stages.flat()) task.target_ms = task.target_ms / 300000 * 45000;
		const progress = Object.fromEntries(item.stages.flat().map(task => [equipment_task_key(task), task.target_ms + 1000]));
		const insert = db.query('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at) VALUES(?,?,?,1)');
		insert.run(101,item.item_id,JSON.stringify(progress));
		const partial = { ...progress, [equipment_task_key(item.stages[2][0])]: 1000 };
		insert.run(102,item.item_id,JSON.stringify(partial));
		const before = combat_character(db,101)!.revision;
		db.transaction(() => db.run(migrations.find(row => row.version === 217)!.sql)).immediate();
		expect(equipment_project_state(db,101).unlocked).toContain(item.item_id);
		expect(equipment_project_state(db,101).project).toBeNull();
		expect(combat_character(db,101)!.revision).toBe(before + 1);
		expect(equipment_project_state(db,102).project!.stage).toBe(0);
		expect(equipment_project_state(db,102).project!.stages[0][0].player_ms).toBe(1000);
	} finally { db.close(); }
});


test('final-task migration preserves unlocks and production progress, retires gathering, and completes satisfied projects', async () => {
	const { migrations } = await import('../../db/schema');
	for (const [item, key] of [
		['melvorD:Bronze_Shield','melvorD:Smithing|melvorD:Bronze_Shield'],
		['melvorD:Herring','melvorD:Cooking|melvorD:Herring'],
		['melvorD:Bronze_Arrows','melvorD:Fletching|melvorF:Bronze_Arrows']
	]) for (const progress of [10000,30000,60000]) for (const removed of [false,true]) {
		const db=fixture();try {
			const legacy='melvorD:Mining|melvorD:Copper_Ore';
			db.query("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at) VALUES(101,?,?,1)").run(item,JSON.stringify({[key]:progress,[legacy]:100000}));
			const project=equipment_project_state(db,101).project!;
			db.query("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(102,?,'{}',1,2)").run(item);
			db.query('INSERT INTO combat_project_tracking VALUES(101,?,?,1000,0,?,0,?)').run(project.id,removed?legacy:key,crypto.randomUUID(),'{}');
			const before=combat_character(db,101)!.revision, balance=ep_balance(db,101);
			db.transaction(()=>db.run(migrations.find(row=>row.version===220)!.sql)).immediate();
			const state=equipment_project_state(db,101);
			expect(state.unlocked.includes(item)).toBe(progress>=30000);
			expect(combat_character(db,101)!.revision).toBe(before+(progress>=30000?1:0));
			expect(ep_balance(db,101)).toBe(balance);
			expect(equipment_project_state(db,102).unlocked).toContain(item);
			expect(db.query('SELECT completed_at FROM combat_equipment_projects WHERE client_id=102').get()).toEqual({completed_at:2});
			const tracking=db.query('SELECT task_id FROM combat_project_tracking WHERE client_id=101').get();
			expect(tracking).toEqual(progress<30000&&!removed?{task_id:key}:null);
			if(progress<30000) expect(state.project!.stages[0][0].player_ms).toBe(progress);
			expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
		}finally{db.close();}
	}
});

test('legacy evidence remains parseable and removed tracking settles zero without granting production work', () => {
	const db=fixture();try {
		const project=start(db), key='melvorD:Mining|melvorD:Copper_Ore', epoch=crypto.randomUUID();
		expect(parse_action_statistics({epoch,time_ms:{[key]:30000,'melvorD:Fishing|melvorD:Raw_Herring':30000}})).not.toBeNull();
		db.query('INSERT INTO combat_project_tracking VALUES(101,?,?,1000,0,?,0,?)').run(project.id,key,epoch,'{}');
		const result=change_equipment_work(db,101,crypto.randomUUID(),{kind:'stop',project_id:project.id,task_id:key,captured_at:31000,
			actions:{epoch,time_ms:{[key]:30000}},statistics:{time_ms:{'melvorD:Mining':30000}},activities:[]},31000);
		expect(result.success).toBe(true);
		expect(result.settlement.credited_ms).toBe(0);
		expect(result.tracking).toBeNull();
		expect(result.equipment_projects.project!.stages[0][0].player_ms).toBe(0);
	}finally{db.close();}
});
