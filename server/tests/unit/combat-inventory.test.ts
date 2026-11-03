import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';
import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { prepare_combat } from '../../combat-progression';
import { combat_state, reserve_combat, update_combat, interrupt_combats } from '../../combat-inventory';
import { start_combat_authority } from '../../combat-authority';
import { connect_authority } from '../../combat/authority-client';
import { start_combat_service } from '../../combat/service';
import { issue_ticket, COMBAT_PROTOCOL } from '../../combat/tickets';
const item = 'melvorD:Shrimp';
function fixture() {
	const db = create_test_database();
	db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,?,?,?,?,?)').run(crypto.randomUUID(),'key','111-222-333','Food Test','melvorD:Plant');
	prepare_combat(db,101); db.run('UPDATE combat_tutorial SET victories=7 WHERE client_id=101'); db.run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=101');
	db.query('UPDATE combat_characters SET hitpoints=99,defence=1 WHERE client_id=101').run();
	db.query('INSERT INTO combat_food_access(client_id,tier,equipped_item) VALUES(101,1,?)').run(item);
	db.query("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(101,?,'{}',0,1)").run(item);
	return db;
}
test('admission freezes server food, counts unlimited eating, and enforces encounter ownership and terminal state', () => {
	const db=fixture(); try {
		const admission=reserve_combat(db,101,'owner','fight')!;
		expect(admission).toMatchObject({food_id:item,heal:30});
		expect(reserve_combat(db,101,'second','duplicate')).toBeNull();
		expect(update_combat(db,'other','fight',1,'active')).toBe(false);
		expect(update_combat(db,'owner','fight',5000,'active')).toBe(true);
		expect(update_combat(db,'owner','fight',4999,'active')).toBe(false);
		expect(update_combat(db,'owner','fight',5001,'victory')).toBe(true);
		expect(update_combat(db,'owner','fight',5001,'victory')).toBe(true);
		expect(update_combat(db,'owner','fight',5002,'active')).toBe(false);
		expect(combat_state(db,101).foods).toEqual([{id:item,name:'Shrimp',heal:30,tier:1}]);
		expect(combat_state(db,101).history[0].used).toBe(5001);
		expect(db.query('SELECT * FROM economy_custody_sources').all()).toEqual([]);
	} finally {db.close();}
});
test('locked or incomplete selection cannot enter; selecting no food permits combat', () => {
	const db=fixture(); try {
		db.query('UPDATE combat_food_access SET equipped_item=?').run('melvorD:Carp');
		expect(reserve_combat(db,101,'owner','locked')).toBeNull();
		db.query('UPDATE combat_food_access SET equipped_item=NULL').run();
		expect(reserve_combat(db,101,'owner','empty')).toMatchObject({food_id:'',heal:0});
		expect(update_combat(db,'owner','empty',1,'active')).toBe(false);
		interrupt_combats(db); interrupt_combats(db);
		expect(combat_state(db,101).history[0].status).toBe('interrupted');
	} finally {db.close();}
});
test('private authority and public socket freeze food and commit eating before publication', async () => {
	const db=fixture(), key='a'.repeat(64);
	const authority=start_combat_authority({database:db,key,port:0,hostname:'127.0.0.1',admitted:client=>client===101});
	const control=connect_authority(`ws://127.0.0.1:${authority.server.port}/authority`,key,()=>{});
	const service=start_combat_service({key,port:0,hostname:'127.0.0.1',authority_url:`ws://127.0.0.1:${authority.server.port}/authority`,random:()=>0});
	let ws: WebSocket | undefined;
	const until=async(check:()=>boolean)=>{const start=Date.now();while(!check()){if(Date.now()-start>10000)throw new Error('Socket timeout');await Bun.sleep(10);}};
	try {
		await Bun.sleep(100);
		expect((await fetch(`http://127.0.0.1:${authority.server.port}/authority`)).status).toBe(403);
		const private_id=crypto.randomUUID();
		expect(await control.reserve(101,private_id)).toMatchObject({food_id:item,heal:30});
		expect(await control.progress(private_id,2000,'fled')).toBe(true);
		ws=new WebSocket(`ws://127.0.0.1:${service.server.port}/combat/socket`,{headers:{Origin:'https://melvoridle.com'}});
		const messages:any[]=[];ws.onmessage=event=>messages.push(JSON.parse(String(event.data)));
		await until(()=>ws!.readyState===WebSocket.OPEN);
		ws.send(JSON.stringify({type:'authenticate',protocol:COMBAT_PROTOCOL,ticket:issue_ticket(101,key)}));
		await until(()=>messages.some(m=>m.type==='ready'));
		// Forged client quantities/healing/food cannot replace the authoritative selection.
		ws.send(JSON.stringify({type:'start',seq:1,food_id:'melvorD:Whale',budget:999999,heal:999999}));
		await until(()=>messages.some(m=>m.arena));
		const arena=messages.find(m=>m.arena).arena;
		expect(arena.food_id).toBe(item);expect(arena.food_policy.heal).toBe(30);
		await until(()=>messages.some(m=>m.arena?.player.hp<m.arena?.player.max_hp));
		ws.send(JSON.stringify({type:'command',seq:2,encounter:arena.id,action:'eat'}));
		await until(()=>messages.some(m=>m.arena?.food_used===1));
		expect(db.query<{used:number},[string]>('SELECT used FROM combat_encounters WHERE id=?').get(arena.id)!.used).toBe(1);
		ws.close();await until(()=>combat_state(db,101).history.some(row=>row.id===arena.id&&row.status==='interrupted'));
	} finally {ws?.close();await service.stop();control.stop();await authority.stop();db.close();}
}, 15000);

test('food migration discards test encounters and retires only combat custody while preserving other value', async () => {
	const { Database } = await import('bun:sqlite');
	const { migrations } = await import('../../db/schema');
	const { create_custody_source } = await import('../../economy-custody');
	const db = new Database(':memory:', { strict: true });
	try {
		for (const migration of migrations.filter(row => row.version <= 202)) {
			if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.transaction(() => db.run(migration.sql)).immediate(); db.run('PRAGMA foreign_keys=ON');
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'food-migration','key','123-456-789','Fixture','melvorD:Plant')");
		db.run('INSERT INTO combat_characters(client_id) VALUES(101)');
		for (const [root_key, location] of [['food-online', 'combat-online:101:melvorD:Shrimp'], ['food-reserved', 'combat-reserved:old-fight'], ['other-value', 'inbox:101']])
			create_custody_source(db, { root_key, operation_key: root_key, client_id: 101, object_id: item, quantity: 50, created_at: 1, snapshot: {} }, location);
		db.run("INSERT INTO combat_encounters VALUES('old-fight',101,'controller','melvorD:Shrimp',50,0,'active','{}',1,NULL,NULL,NULL)");
		const before = db.query('SELECT * FROM combat_characters').all();
		db.transaction(() => db.run(migrations.find(row => row.version === 203)!.sql)).immediate();
		expect(db.query('SELECT * FROM combat_characters').all()).toEqual(before);
		expect(db.query('SELECT * FROM combat_encounters').all()).toEqual([]);
		expect(db.query("SELECT root_key,quantity FROM economy_custody_balances WHERE location='inbox:101'").all()).toEqual([{ root_key: 'other-value', quantity: 50 }]);
		expect(db.query("SELECT SUM(quantity) AS quantity FROM economy_custody_balances WHERE location='consumed:combat-food-retired'").get()).toEqual({ quantity: 100 });
		expect(db.query("SELECT * FROM economy_custody_balances WHERE location LIKE 'combat-%'").all()).toEqual([]);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});


test('combat admission continues using only the first food slot', () => {
	const db=fixture();try {
		db.run("INSERT INTO combat_food_access(client_id,slot,tier,equipped_item) VALUES(101,'Food2',8,'melvorD:Carp')");
		db.run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(101,'melvorD:Carp','{}',0,1)");
		expect(reserve_combat(db,101,'owner','first')).toMatchObject({food_id:item,heal:30});
		interrupt_combats(db);
		db.run("DELETE FROM combat_food_access WHERE slot='Food'");
		expect(reserve_combat(db,101,'owner','empty-first')).toMatchObject({food_id:'',heal:0});
	}finally{db.close();}
});

test('second food slot migration preserves existing access, equipment and project unlocks', async () => {
	const { Database }=await import('bun:sqlite');const { migrations }=await import('../../db/schema');
	const db=new Database(':memory:',{strict:true});try {
		for(const migration of migrations.filter(row=>row.version<=203)) {
			if(migration.foreign_keys_disabled)db.run('PRAGMA foreign_keys=OFF');
			db.transaction(()=>db.run(migration.sql)).immediate();db.run('PRAGMA foreign_keys=ON');
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'slots-migration','key','123-456-789','Fixture','melvorD:Plant')");
		db.run('INSERT INTO combat_characters(client_id) VALUES(101)');
		db.run("INSERT INTO combat_food_access VALUES(101,3,'melvorD:Trout')");
		db.run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(101,'melvorD:Trout','{}',0,1)");
		const projects=db.query('SELECT * FROM combat_equipment_projects').all();
		db.transaction(()=>db.run(migrations.find(row=>row.version===204)!.sql)).immediate();
		expect(db.query('SELECT * FROM combat_food_access').all()).toEqual([{client_id:101,slot:'Food',tier:3,equipped_item:'melvorD:Trout'}]);
		expect(db.query('SELECT * FROM combat_equipment_projects').all()).toEqual(projects);
		db.run("INSERT INTO combat_food_access VALUES(101,'Food2',1,NULL)");
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
		db.run('DELETE FROM clients WHERE id=101');
		expect(db.query('SELECT * FROM combat_food_access').all()).toEqual([]);
	}finally{db.close();}
});

test('draw is an idempotent terminal outcome and never grants a tutorial victory', () => {
	const db = fixture();
	try {
		expect(reserve_combat(db, 101, 'owner', 'draw')).not.toBeNull();
		db.run("UPDATE combat_tutorial SET victories=0 WHERE client_id=101");
		db.run("UPDATE combat_encounters SET tutorial_trial=0 WHERE id='draw'");
		expect(update_combat(db, 'owner', 'draw', 0, 'draw')).toBe(true);
		expect(update_combat(db, 'owner', 'draw', 0, 'draw')).toBe(true);
		expect(update_combat(db, 'owner', 'draw', 0, 'victory')).toBe(false);
		expect(db.query('SELECT victories FROM combat_tutorial WHERE client_id=101').get()).toEqual({ victories: 0 });
		expect(combat_state(db, 101).history[0].status).toBe('draw');
	} finally { db.close(); }
});

test('draw migration preserves existing encounters, constraints and tutorial markers', () => {
	const db = new Database(':memory:');
	try {
		db.run('PRAGMA foreign_keys=ON');
		// Use the historical encounter shape without replaying unrelated migrations.
		db.run('CREATE TABLE clients(id INTEGER PRIMARY KEY)');
		db.run('INSERT INTO clients VALUES(1)');
		db.run(migrations.find(entry => entry.version === 203)!.sql.split('DROP TABLE combat_encounters;')[1]);
		db.run('ALTER TABLE combat_encounters ADD COLUMN tutorial_trial INTEGER');
		for (const status of ['active', 'victory', 'defeat', 'fled', 'expired', 'interrupted']) {
			db.query('INSERT INTO combat_encounters VALUES(?,1,?,?,?,?,?,?,?)').run(status, 'owner', 'food', 3, status, '{}', 123, 2);
		}
		const before = db.query('SELECT * FROM combat_encounters ORDER BY id').all();
		db.transaction(() => db.run(migrations.find(entry => entry.version === 208)!.sql))();
		expect(db.query('SELECT * FROM combat_encounters ORDER BY id').all()).toEqual(before);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
		db.run("UPDATE combat_encounters SET status='draw' WHERE id='defeat'");
		expect(() => db.run("UPDATE combat_encounters SET status='invalid' WHERE id='defeat'")).toThrow();
		expect(() => db.run("UPDATE combat_encounters SET status='active' WHERE id='defeat'")).toThrow();
	} finally { db.close(); }
});

test('combat read indexes preserve history and serve ordered history and ranking without temporary sorts', () => {
	const db = fixture();
	try {
		db.run('DROP INDEX combat_encounters_history; DROP INDEX combat_raid_ranking;');
		const id = crypto.randomUUID();
		expect(reserve_combat(db,101,'owner',id)).not.toBeNull();
		expect(update_combat(db,'owner',id,0,'fled')).toBe(true);
		const before = combat_state(db,101).history;
		db.run(migrations.find(row => row.version === 215)!.sql);
		expect(combat_state(db,101).history).toEqual(before);
		const explain = (sql: string) => db.query<{detail:string}, []>('EXPLAIN QUERY PLAN ' + sql).all().map(row => row.detail).join('\n');
		const history = explain('SELECT * FROM combat_encounters WHERE client_id=101 ORDER BY created_at DESC LIMIT 30');
		expect(history).toContain('combat_encounters_history');
		expect(history).not.toContain('TEMP B-TREE');
		const ranking = explain(`SELECT r.client_id,c.display_name,r.elapsed_ms FROM combat_raid_records r JOIN clients c ON c.id=r.client_id
			WHERE r.raid='golbins' AND r.ruleset='test' AND c.deleted_at IS NULL AND c.disabled=0
			ORDER BY r.elapsed_ms,r.achieved_at,r.client_id LIMIT 10 OFFSET 10`);
		expect(ranking).toContain('combat_raid_ranking');
		expect(ranking).not.toContain('TEMP B-TREE');
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});
