import { settle_departing_crucible_wish } from '../../crucible-council';
import { expect, test } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { create_test_database } from '../support/database';
import { record_character_save_load } from '../../character-save-loads';
import { record_economy_operation, record_load_clock } from '../../save-rollback';
import { run_with_audit_context, make_audit_context } from '../../audit-context';
import { create_custody_source, custody_at, move_custody, move_custody_fifo, move_location, inbox_custody_location, create_gloop_custody,
	allocate_wish_funding, wish_funding, retire_wish_funding, record_dependency } from '../../economy-custody';
import { correct_custody_operation } from '../../economy-correction';
import { reconcile_crucible, distribute_crucible_value } from '../../crucible-service';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const device='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
function fixture(filename?:string) {
	const db=create_test_database(filename);
	for(const id of [101,102]) {
		db.query('INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(?,?,?,0)').run(id,'test',`custody-${id}`);
		db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id,melvor_account_id) VALUES(?,?,?,?,?,?,?)')
			.run(id,`custody-${id}`,'key',`111-222-${id}`,'Custody','melvorD:Plant',id);
	}
	db.query('UPDATE crucible_guilds SET processed_minute=0 WHERE guild_id=1').run();
	const old=record_character_save_load(db,101,{load_id:crypto.randomUUID(),save_timestamp:500,client_loaded_at:900,capture_source:'decode'},1000,device)!;
	record_load_clock(db,101,old,{server_admitted_at:1000,client_sent_at:990,client_received_at:1010,elapsed_ms:20},1020);
	const command=crypto.randomUUID();
	const operation=run_with_audit_context(make_audit_context({event_type:'test',actor_kind:'client',actor_client_id:101,actor_display_name:null,save_load_id:old}),()=>
		record_economy_operation(db,{source_key:`receipt:${command}`,client_id:101,kind:'crucible-cast',local_effect:'outgoing',committed_at:2000,evidence:{qty:10}}));
	const restored=record_character_save_load(db,101,{load_id:crypto.randomUUID(),save_timestamp:1500,client_loaded_at:2900,capture_source:'decode'},3000,device)!;
	record_load_clock(db,101,restored,{server_admitted_at:3000,client_sent_at:2990,client_received_at:3010,elapsed_ms:20},3020);
	const incident=db.query<{id:number},[]>('SELECT id FROM economy_incidents ORDER BY id DESC LIMIT 1').get()!.id;
	db.query("INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at) VALUES(?,'confirmed','test-approved',3100)").run(incident);
	return {db,command,operation,incident,activation:{enabled:true,first_operation_id:operation,policy_version:1}};
}
function offering(db:Database,qty=10,item='test:Ore',unit=100) {
	return db.query<{id:number},[string,number,number]>('INSERT INTO crucible_offerings(guild_id,item_id,qty,value_currency_id,value_per_item,created_at,refreshed_at) VALUES(1,?,?,\'melvorD:GP\',?,2000,2000) RETURNING id').get(item,qty,unit)!.id;
}
function principal(f:ReturnType<typeof fixture>,offering_id:number,qty=10,client=101,key='root') {
	const id=f.db.query<{id:number},[number,number,number,string]>('INSERT INTO crucible_contribution_lots(offering_id,client_id,qty,contributed_at,source_kind,source_id) VALUES(?,?,?,2000,\'cast\',?) RETURNING id').get(offering_id,client,qty,key)!.id;
	create_custody_source(f.db,{root_key:key,operation_key:client===101?`receipt:${f.command}`:'independent',client_id:client,object_id:'test:Ore',quantity:qty,created_at:2000,snapshot:{offering_id,lot_id:id,qty}},`crucible-lot:${id}`);
	return id;
}
function wish(db:Database,owner=101,required=500) {
	return db.query<{id:number},[number,number,number]>('INSERT INTO crucible_wishes(guild_id,owner_client_id,melvor_account_id,item_id,qty,required_gp,formation_points,created_at) VALUES(1,?,?,\'test:Reward\',1,?,10080,2000) RETURNING id').get(owner,owner,required)!.id;
}
function correct(f:ReturnType<typeof fixture>,now=70000) {return correct_custody_operation(f.db,f.incident,f.operation,f.activation,now);}

test('correction is off by default and requires latest calibrated assessment plus prospective approved boundary',()=>{
	const f=fixture();try {
		principal(f,offering(f.db));
		expect(correct_custody_operation(f.db,f.incident,f.operation)).toEqual({applied:false,reason:'disabled'});
		expect(correct_custody_operation(f.db,f.incident,f.operation,{...f.activation,first_operation_id:f.operation+1}).applied).toBe(false);
		f.db.query("INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at) VALUES(?,'dismissed','test',4000)").run(f.incident);
		expect(correct(f).reason).toBe('not_approved_and_calibrated');
		expect(f.db.query('SELECT qty FROM crucible_offerings').get()).toEqual({qty:10});
	}finally{f.db.close();}
});

test('partial Reclaim protects issued entitlement and correction retains original principal and mixed contributors',()=>{
	const f=fixture();try {
		const id=offering(f.db,17);const lot=principal(f,id);principal(f,id,7,102,'other');
		f.db.transaction(()=>{
			move_custody(f.db,'root',`crucible-lot:${lot}`,'protected:reclaim:102',4,4000,'issued-inbox');
			f.db.query('UPDATE crucible_contribution_lots SET qty=6 WHERE id=?').run(lot);
			f.db.query('UPDATE crucible_offerings SET qty=13 WHERE id=?').run(id);
		}).immediate();
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT qty FROM crucible_offerings').get()).toEqual({qty:7});
		expect(f.db.query('SELECT quantity FROM economy_custody_sources WHERE root_key=\'root\'').get()).toEqual({quantity:10});
		expect(f.db.query('SELECT quantity,disposition FROM economy_corrections WHERE object_id=\'test:Ore\' ORDER BY quantity').all()).toEqual([{quantity:4,disposition:'protected'},{quantity:6,disposition:'invalidated'}]);
		expect(correct(f).reason).toBe('already_disposed');
		expect(()=>f.db.query('DELETE FROM economy_custody_sources').run()).toThrow();
		expect(f.db.query("SELECT json_extract(snapshot_json,'$.qty') AS qty FROM economy_terminal_snapshots WHERE table_name='crucible_contribution_lots' AND row_id=? AND phase='source'").get(lot)).toEqual({qty:10});
	}finally{f.db.close();}
});

test('Meld retains exact funding across contributors; correction removes all undelivered invalid funding and resets deadlines only',()=>{
	const f=fixture();try {
		const id=offering(f.db);principal(f,id);const own=wish(f.db);const other=wish(f.db,102);
		f.db.query('UPDATE crucible_offerings SET meld_points=10080 WHERE id=?').run(id);
		f.db.transaction(()=>reconcile_crucible(1,60000,f.db)).immediate();
		expect(wish_funding(f.db,own,500)).toEqual([{root_key:'root',origin_kind:'principal',amount_gp:500}]);
		expect(wish_funding(f.db,other,500)).toEqual([{root_key:'root',origin_kind:'principal',amount_gp:500}]);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT progress_gp,formation_points,melded_at,auto_deliver_at FROM crucible_wishes ORDER BY id').all()).toEqual([
			{progress_gp:0,formation_points:10080,melded_at:null,auto_deliver_at:null},
			{progress_gp:0,formation_points:10080,melded_at:null,auto_deliver_at:null}]);
		f.db.transaction(()=>distribute_crucible_value(1,1000,120000,new Set(),f.db)).immediate();
		expect(f.db.query('SELECT auto_deliver_at FROM crucible_wishes WHERE id=?').get(own)).toEqual({auto_deliver_at:120000+20*60*60000});
		expect(f.db.query("SELECT quantity,disposition FROM economy_corrections WHERE lot_key LIKE '%wish:%'").all()).toEqual([{quantity:500,disposition:'invalidated'},{quantity:500,disposition:'invalidated'}]);
	}finally{f.db.close();}
});

test('automatic delivery before correction protects issued Wish even without an Inbox acknowledgement',()=>{
	const f=fixture();try {
		const id=offering(f.db);principal(f,id);wish(f.db,101,1000);
		f.db.query('UPDATE crucible_offerings SET meld_points=10080 WHERE id=?').run(id);
		f.db.transaction(()=>reconcile_crucible(1,60000,f.db)).immediate();
		f.db.transaction(()=>reconcile_crucible(1,20*60*60000+60000,f.db)).immediate();
		expect(f.db.query('SELECT qty FROM inbox_items WHERE client_id=101').get()).toEqual({qty:1});
		correct(f,20*60*60000+70000);
		expect(f.db.query('SELECT qty FROM inbox_items WHERE client_id=101').get()).toEqual({qty:1});
		expect(f.db.query("SELECT disposition FROM economy_corrections WHERE lot_key LIKE '%wish:%'").get()).toEqual({disposition:'protected'});
	}finally{f.db.close();}
});

test('correction before due delivery prevents automatic issue and preserves clean allocations',()=>{
	const f=fixture();try {
		const id=offering(f.db,20);principal(f,id);principal(f,id,10,102,'clean');const w=wish(f.db,101,2000);
		f.db.query('UPDATE crucible_offerings SET meld_points=10080 WHERE id=?').run(id);
		f.db.transaction(()=>reconcile_crucible(1,60000,f.db)).immediate();correct(f);
		f.db.transaction(()=>reconcile_crucible(1,20*60*60000+60000,f.db)).immediate();
		expect(f.db.query('SELECT * FROM inbox_items WHERE client_id=101').all()).toEqual([]);
		expect(f.db.query('SELECT progress_gp FROM crucible_wishes WHERE id=?').get(w)).toEqual({progress_gp:1000});
		expect(wish_funding(f.db,w,1000)).toEqual([{root_key:'clean',origin_kind:'principal',amount_gp:1000}]);
	}finally{f.db.close();}
});

test('cancellation redistribution keeps origins and cannot re-fund held Reclaim bonus',()=>{
	const f=fixture();try {
		principal(f,offering(f.db));const w=wish(f.db,101,1000);
		const origins=[{root_key:'root',amount_gp:300,origin_kind:'derived' as const}];
		allocate_wish_funding(f.db,w,300,origins,4000,'reclaim-bonus');f.db.query('UPDATE crucible_wishes SET progress_gp=300 WHERE id=?').run(w);
		correct(f);expect(f.db.query("SELECT quantity,disposition FROM economy_corrections WHERE lot_key LIKE '%wish:%'").get()).toEqual({quantity:300,disposition:'held'});
		const remaining=wish_funding(f.db,w,0);retire_wish_funding(f.db,w,remaining,80000,'cancel');f.db.query('DELETE FROM crucible_wishes WHERE id=?').run(w);
		const other=wish(f.db,102,1000);expect(distribute_crucible_value(1,0,80000,new Set(),f.db,remaining)).toBe(0);
		expect(f.db.query('SELECT progress_gp FROM crucible_wishes WHERE id=?').get(other)).toEqual({progress_gp:0});
	}finally{f.db.close();}
});

test('rounded Gloop captures exact outputs and isolates a mixed unit without confiscating other origins',()=>{
	const f=fixture();try {
		principal(f,offering(f.db));const id=offering(f.db,3,'melvorD:Weird_Gloop',1);
		create_custody_source(f.db,{root_key:'other',operation_key:'other',client_id:102,object_id:'test:Ore',quantity:10,created_at:2000,snapshot:{}},'consumed:meld');
		create_gloop_custody(f.db,id,[{root_key:'root',amount_gp:1500},{root_key:'other',amount_gp:1500}],'mixed',1,4000);
		expect(custody_at(f.db,`crucible-offering:${id}`).map(r=>r.quantity)).toEqual([1,1]);correct(f);
		expect(f.db.query('SELECT qty FROM crucible_offerings WHERE id=?').get(id)).toEqual({qty:2});
		expect(f.db.query("SELECT quantity,disposition FROM economy_corrections WHERE object_id='melvorD:Weird_Gloop' ORDER BY id").all()).toEqual([{quantity:1,disposition:'held'},{quantity:1,disposition:'unresolved'}]);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('safe-integer rounding handles maximum input without precision loss or per-unit allocation',()=>{
	const f=fixture();try {
		principal(f,offering(f.db));const qty=Number((BigInt(Number.MAX_SAFE_INTEGER)+999n)/1000n);const id=offering(f.db,qty,'melvorD:Weird_Gloop',1);
		create_gloop_custody(f.db,id,[{root_key:'root',amount_gp:Number.MAX_SAFE_INTEGER}],'maximum',1,4000);
		expect(custody_at(f.db,`crucible-offering:${id}`)[0]!.quantity).toBe(qty);
		expect(()=>create_custody_source(f.db,{root_key:'bad',operation_key:'x',client_id:101,object_id:'x',quantity:1.5,created_at:0,snapshot:{}},'x')).toThrow();
		expect(()=>move_custody(f.db,'root','missing','x',1,0,'test')).toThrow();
	}finally{f.db.close();}
});

test('Expedition invalidation conserves stash and holds exact nonlinear EP dependency without altering original ledger',()=>{
	const f=fixture();try {
		f.db.query("INSERT INTO expeditions(id,guild_id,status,content_version,content_snapshot,registered_at,registration_ends_at,last_qualifying_activity_at) VALUES(100,1,'registration',1,'{}',0,100000,0)").run();
		f.db.query("INSERT INTO expedition_supplies VALUES(100,'test:Ore',1000,'melvorD:GP',2)").run();
		const lot=f.db.query<{id:number},[]>('INSERT INTO expedition_supply_lots(expedition_id,item_id,client_id,owner_key,qty,contributed_at) VALUES(100,\'test:Ore\',101,\'account:101\',1000,2000) RETURNING id').get()!.id;
		create_custody_source(f.db,{root_key:'supply',operation_key:`receipt:${f.command}`,client_id:101,object_id:'test:Ore',quantity:1000,created_at:2000,snapshot:{lot_id:lot}},`expedition-lot:${lot}`);
		const original=Math.floor(10*Math.log10(3)*1000000);
		record_dependency(f.db,'supply','expedition-supply-score',original,{expedition_id:100,added_value:2000});
		f.db.query('INSERT INTO expedition_supply_scores VALUES(101,100,2000,?)').run(original);
		f.db.query('INSERT INTO expedition_ep_balances VALUES(101,?)').run(original);
		f.db.query("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(101,'supply',?,?,2000,100)").run(lot,original);
		correct(f);expect(f.db.query('SELECT * FROM expedition_supplies').all()).toEqual([]);
		expect(f.db.query('SELECT points_micros FROM expedition_ep_balances WHERE client_id=101').get()).toEqual({points_micros:0});
		expect(f.db.query('SELECT points_micros FROM expedition_ep_ledger WHERE client_id=101').get()).toEqual({points_micros:original});
		expect(f.db.query('SELECT value_gp_equiv,score_micros FROM expedition_supply_scores').get()).toEqual({value_gp_equiv:0,score_micros:0});
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('durable unresolved dispositions can later resolve; failed transaction and restart retain exact source evidence',()=>{
	const directory=mkdtempSync(join(tmpdir(),'custody-test-'));const filename=join(directory,'db.sqlite');const f=fixture(filename);
	try {
		const id=offering(f.db);const lot=principal(f,id);
		f.db.query('DELETE FROM crucible_contribution_lots WHERE id=?').run(lot);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query("SELECT disposition FROM economy_corrections WHERE object_id='test:Ore'").get()).toEqual({disposition:'unresolved'});
		f.db.transaction(()=>move_custody(f.db,'root','unresolved:terminal-cleanup',`crucible-offering:${id}`,10,80000,'exact-recovery')).immediate();
		expect(()=>f.db.transaction(()=>{correct(f);throw new Error('abort');}).immediate()).toThrow();
		expect(f.db.query('SELECT qty FROM crucible_offerings WHERE id=?').get(id)).toEqual({qty:10});
		f.db.close();
		const {Database}=require('bun:sqlite') as typeof import('bun:sqlite');const reopened=new Database(filename);reopened.run('PRAGMA foreign_keys=ON');
		expect(correct_custody_operation(reopened,f.incident,f.operation,f.activation,90000).applied).toBe(true);
		expect(reopened.query('SELECT * FROM crucible_offerings WHERE id=?').get(id)).toBeNull();
		expect(reopened.query("SELECT disposition,remaining_quantity FROM economy_current_corrections WHERE object_id='test:Ore'").all()).toEqual([{disposition:'invalidated',remaining_quantity:10}]);
		expect(reopened.query("SELECT quantity FROM economy_custody_sources WHERE root_key='root'").get()).toEqual({quantity:10});reopened.close();
	}finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
});

test('Clear correction holds only its exact active Slag point, preserving sibling/other funding and restrictive locks',()=>{
	const f=fixture();try {
		principal(f,offering(f.db));
		const point=f.db.query<{id:number},[]>('INSERT INTO crucible_clear_events(guild_id,owner_key,cleared_at,expires_at) VALUES(1,\'account:101\',2000,200000) RETURNING id').get()!.id;
		f.db.query('INSERT INTO crucible_clear_events(guild_id,owner_key,cleared_at,expires_at) VALUES(1,\'account:101\',3000,201000)').run();
		record_dependency(f.db,'root','slag-clear-point',1,{event_id:point,guild_id:1,owner_key:'account:101',cleared_at:2000,expires_at:200000});
		record_dependency(f.db,'root','slag-currency-lock',1,{guild_id:1,owner_key:'account:101',currency_id:'melvorD:GP',locked_until:100000});
		f.db.query('INSERT INTO crucible_currency_locks VALUES(1,\'account:101\',\'melvorD:GP\',100000)').run();
		correct(f);
		expect(f.db.query('SELECT cleared_at FROM crucible_clear_events WHERE owner_key=\'account:101\'').all()).toEqual([{cleared_at:3000}]);
		expect(f.db.query('SELECT locked_until FROM crucible_currency_locks WHERE owner_key=\'account:101\'').get()).toEqual({locked_until:100000});
		expect(f.db.query("SELECT disposition FROM economy_corrections WHERE object_id='multiplayer:SlagClearPoint'").get()).toEqual({disposition:'held'});
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('ambiguous or spent EP balance never debits unrelated work EP and can later resolve from retained dependency',()=>{
	const f=fixture();try {
		principal(f,offering(f.db));
		const supply=1000000;const work=500000;
		f.db.query("INSERT INTO expeditions(id,guild_id,status,content_version,content_snapshot,registered_at,registration_ends_at,last_qualifying_activity_at) VALUES(100,1,'registration',1,'{}',0,100000,0)").run();
		record_dependency(f.db,'root','expedition-supply-score',supply,{expedition_id:100,added_value:2000});
		const points=Math.floor(10*Math.log10(3)*1000000);
		f.db.query('INSERT INTO expedition_supply_scores VALUES(101,100,2000,?)').run(points);
		f.db.query('INSERT INTO expedition_ep_balances VALUES(101,?)').run(work);
		f.db.query("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(101,'supply',1,?,2000,100)").run(points);
		f.db.query("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(101,'work',1,?,2000,100)").run(work);
		correct(f);expect(f.db.query('SELECT points_micros FROM expedition_ep_balances WHERE client_id=101').get()).toEqual({points_micros:work});
		expect(f.db.query("SELECT quantity,disposition FROM economy_corrections WHERE object_id='multiplayer:ExpeditionPointsMicros'").get()).toEqual({quantity:points,disposition:'unresolved'});
		f.db.query('UPDATE expedition_ep_balances SET points_micros=? WHERE client_id=101').run(points+work);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT points_micros FROM expedition_ep_balances WHERE client_id=101').get()).toEqual({points_micros:work});
	}finally{f.db.close();}
});

test('departure redistributes underfunded principal with its original source into new Wish funding',()=>{
	const f=fixture();try {
		const id=offering(f.db);principal(f,id);const first=wish(f.db,101,2000);
		f.db.query('UPDATE crucible_offerings SET meld_points=10080 WHERE id=?').run(id);
		f.db.transaction(()=>reconcile_crucible(1,60000,f.db)).immediate();
		const next=wish(f.db,102,1000);
		f.db.transaction(()=>settle_departing_crucible_wish(101,1,60000,f.db)).immediate();
		expect(f.db.query('SELECT * FROM crucible_wishes WHERE id=?').get(first)).toBeNull();
		expect(wish_funding(f.db,next,1000)).toEqual([{root_key:'root',origin_kind:'principal',amount_gp:1000}]);
		correct(f);
		expect(f.db.query('SELECT progress_gp FROM crucible_wishes WHERE id=?').get(next)).toEqual({progress_gp:0});
		expect(f.db.query('SELECT SUM(amount_gp) AS amount FROM economy_wish_funding WHERE wish_id=?').get(first)).toEqual({amount:0});
	}finally{f.db.close();}
});

test('independent correction and manual claim processes serialize without losing or duplicating a Wish entitlement',async()=>{
	const directory=mkdtempSync(join(tmpdir(),'custody-race-'));
	const filename=join(directory,'db.sqlite');const f=fixture(filename);
	f.db.run('PRAGMA journal_mode = WAL');
	try {
		const id=offering(f.db);principal(f,id);const w=wish(f.db,101,1000);
		f.db.query('UPDATE crucible_offerings SET meld_points=10080 WHERE id=?').run(id);
		f.db.transaction(()=>reconcile_crucible(1,60000,f.db)).immediate();
		const script=`
			import { db } from './db';
			import { correct_custody_operation } from './economy-correction';
			import { run_crucible_wish_command,claim_crucible_wish } from './crucible-actions';
			process.stdout.write('ready\\n');
			for await(const chunk of process.stdin) { if(chunk.length) break; }
			const input=JSON.parse(process.env.CUSTODY_RACE_INPUT);
			const result=process.env.CUSTODY_RACE_ROLE==='correct'
				? correct_custody_operation(db,input.incident,input.operation,input.activation,69000)
				: run_crucible_wish_command(101,input.command,'claim',()=>claim_crucible_wish({client_id:101,guild_id:1,account_id:101,owner_key:'account:101'},69000));
			process.stdout.write(JSON.stringify(result)+'\\n');
			db.close();
		`;
		const children=[] as Bun.Subprocess<'pipe','pipe','pipe'>[];
		const readers=[] as {read():Promise<{done:boolean;value?:Uint8Array}>}[];
		for(const role of ['correct','claim']) {
			const child=Bun.spawn({cmd:['bun','--eval',script],cwd:process.cwd(),
				env:{...process.env,DB_PATH:filename,CUSTODY_RACE_ROLE:role,CUSTODY_RACE_INPUT:JSON.stringify({incident:f.incident,operation:f.operation,activation:f.activation,command:crypto.randomUUID()})},
				stdin:'pipe',stdout:'pipe',stderr:'pipe'});
			children.push(child);const reader=child.stdout.getReader();readers.push(reader);
			let ready='';while(!ready.includes('ready\n')) {const result=await reader.read();if(result.done) throw new Error('Race process exited before readiness: '+await new Response(child.stderr).text());ready+=new TextDecoder().decode(result.value);}
		}
		for(const child of children) {child.stdin.write('go\n');child.stdin.end();}
		const outputs=await Promise.all(children.map(async(child,index)=>{
			let output='';const reader=readers[index]!;while(true) {const part=await reader.read();if(part.done) break;output+=new TextDecoder().decode(part.value);}
			const error=await new Response(child.stderr).text();expect(await child.exited,error).toBe(0);return JSON.parse(output.trim()) as {applied?:boolean;success?:boolean};
		}));
		expect(outputs[0]!.applied).toBe(true);
		const delivered=f.db.query<{qty:number},[]>('SELECT qty FROM inbox_items WHERE client_id=101 AND source_name=\'Wish Granted\'').get()?.qty ?? 0;
		expect(delivered).toBe(outputs[1]!.success?1:0);
		if(delivered===1) {
			expect(f.db.query('SELECT id FROM crucible_wishes WHERE id=?').get(w)).toBeNull();
			expect(f.db.query("SELECT disposition FROM economy_corrections WHERE lot_key LIKE '%wish:%'").get()).toEqual({disposition:'protected'});
		} else {
			expect(f.db.query('SELECT progress_gp,formation_points FROM crucible_wishes WHERE id=?').get(w)).toEqual({progress_gp:0,formation_points:10080});
			expect(f.db.query("SELECT disposition FROM economy_corrections WHERE lot_key LIKE '%wish:%'").get()).toEqual({disposition:'invalidated'});
		}
		expect(f.db.query('SELECT quantity FROM economy_custody_sources WHERE root_key=\'root\'').get()).toEqual({quantity:10});
	}finally{f.db.close();rmSync(directory,{recursive:true,force:true});}
},15000);

function gift_principal(f:ReturnType<typeof fixture>, qty=10, key='gift-root') {
	const id=f.db.query<{gift_id:number},[]>('INSERT INTO gifts(client_id,sender_id,created_at,updated_at) VALUES(102,101,2000,2000) RETURNING gift_id').get()!.gift_id;
	f.db.query('INSERT INTO gift_items(gift_id,item_id,qty) VALUES(?,?,?)').run(id,'test:Ore',qty);
	create_custody_source(f.db,{root_key:key,operation_key:`receipt:${f.command}`,client_id:101,object_id:'test:Ore',quantity:qty,created_at:2000,snapshot:{gift_id:id}},`gift:${id}:test:Ore`);
	return id;
}

test('pending Gift correction removes exact multi-item principal without issuing a return; retains terminal evidence',()=>{
	const f=fixture();try {
		const id=gift_principal(f);
		f.db.query('INSERT INTO gift_items(gift_id,item_id,qty) VALUES(?,?,3)').run(id,'test:Other');
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT item_id,qty FROM gift_items WHERE gift_id=?').all(id)).toEqual([{item_id:'test:Other',qty:3}]);
		expect(f.db.query('SELECT * FROM inbox_items').all()).toEqual([]);
		expect(f.db.query("SELECT phase FROM economy_terminal_snapshots WHERE table_name='gift_items' AND json_extract(snapshot_json,'$.item_id')='test:Ore' ORDER BY id").all()).toEqual([{phase:'source'},{phase:'terminal'}]);
		expect(custody_at(f.db,'invalidated')).toEqual([{root_key:'gift-root',quantity:10}]);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('merged own Inbox returns remain eligible while accepted counterparty value and lost-response claims stay protected',()=>{
	const f=fixture();try {
		const id=gift_principal(f);
		const location='inbox:'+JSON.stringify([101,'gift_returned','','test:Ore']);
		move_custody(f.db,'gift-root',`gift:${id}:test:Ore`,location,6,4000,'own-return');
		move_custody(f.db,'gift-root',`gift:${id}:test:Ore`,'protected:accepted-gift:102',4,4000,'accepted');
		f.db.query('DELETE FROM gifts WHERE gift_id=?').run(id);
		f.db.query("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty) VALUES(101,'gift_returned','','test:Ore',13)").run();
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT qty FROM inbox_items WHERE client_id=101').get()).toEqual({qty:7});
		expect(f.db.query("SELECT disposition,quantity FROM economy_corrections ORDER BY disposition").all()).toEqual([{disposition:'invalidated',quantity:6},{disposition:'protected',quantity:4}]);
	}finally{f.db.close();}
	const claimed=fixture();try {
		const id=gift_principal(claimed);
		move_custody(claimed.db,'gift-root',`gift:${id}:test:Ore`,'protected:inbox-claim:lost-response',10,4000,'claim-created');
		claimed.db.query('DELETE FROM gifts WHERE gift_id=?').run(id);
		expect(correct(claimed).applied).toBe(true);
		expect(claimed.db.query('SELECT disposition,quantity FROM economy_corrections').get()).toEqual({disposition:'protected',quantity:10});
	}finally{claimed.db.close();}
});

test('unmapped Gift cleanup retains unresolved roots and historical Gifts gain no invented source',()=>{
	const f=fixture();try {
		const id=gift_principal(f);
		f.db.query('DELETE FROM gifts WHERE gift_id=?').run(id);
		expect(custody_at(f.db,'unresolved:gift-cleanup')).toEqual([{root_key:'gift-root',quantity:10}]);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT disposition FROM economy_corrections').get()).toEqual({disposition:'unresolved'});
		f.db.query('INSERT INTO gifts(client_id,sender_id) VALUES(102,101)').run();
		expect(f.db.query('SELECT COUNT(*) n FROM economy_custody_sources').get()).toEqual({n:1});
	}finally{f.db.close();}
});


test('bounded FIFO delivery conserves partial mixed roots and leaves an explicit historical prefix unassigned',()=>{
	const f=fixture();try {
		for(const [root,qty,at] of [['first',4,2000],['second',6,2001]] as const)
			create_custody_source(f.db,{root_key:root,operation_key:`receipt:${f.command}`,client_id:101,object_id:'test:Ore',quantity:qty,created_at:at,snapshot:{}},'fifo');
		expect(move_custody_fifo(f.db,'fifo','protected:partial',3,4000,'partial')).toBe(3);
		expect(custody_at(f.db,'fifo')).toEqual([{root_key:'first',quantity:1},{root_key:'second',quantity:6}]);
		expect(move_custody_fifo(f.db,'fifo','protected:next',3,4001,'partial')).toBe(3);
		expect(custody_at(f.db,'fifo')).toEqual([{root_key:'second',quantity:4}]);
		expect(move_custody_fifo(f.db,'fifo','protected:historical',3,4002,'partial',2)).toBe(1);
		expect(custody_at(f.db,'fifo')).toEqual([{root_key:'second',quantity:3}]);
		expect(()=>move_custody_fifo(f.db,'protected:partial','fifo',1,4003,'reactivate')).toThrow();
	}finally{f.db.close();}
});

test('identity deletion moves Gift roots into exact sender-owned returns before cleanup and correction excludes them once',async()=>{
	const {execute_client_deletion}=await import('../../identity_deletion');
	const f=fixture();try {
		gift_principal(f);
		const request=f.db.query<import('../../db/types/db_types').client_deletion_requests,[]>(
			'INSERT INTO client_deletion_requests(target_client_id,requester_client_id,requested_at,execute_at) VALUES(102,101,4000,5000) RETURNING *').get()!;
		f.db.transaction(()=>execute_client_deletion(f.db,request,5000)).immediate();
		const returned=f.db.query<{id:number},[]>('SELECT id FROM client_deletion_returns WHERE client_id=101').get()!.id;
		expect(custody_at(f.db,`deletion-return:${returned}:test:Ore`)).toEqual([{root_key:'gift-root',quantity:10}]);
		expect(f.db.query('SELECT qty FROM client_deletion_return_items WHERE return_id=?').get(returned)).toEqual({qty:10});
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT qty FROM client_deletion_return_items WHERE return_id=?').get(returned)).toBeNull();
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('incomplete historical Marketplace captures remain review-only and cannot retire receipts',()=>{
	const f=fixture();try {
		create_custody_source(f.db,{root_key:'market-stock:test',operation_key:`receipt:${f.command}`,client_id:101,
			object_id:'test:Ore',quantity:10,created_at:2000,snapshot:{coverage:'source-only'}},'unresolved:market-source:1');
		expect(correct(f).applied).toBe(false);
		expect(f.db.query('SELECT * FROM economy_corrections').all()).toEqual([]);
		expect(custody_at(f.db,'unresolved:market-source:1')).toEqual([{root_key:'market-stock:test',quantity:10}]);
	}finally{f.db.close();}
});

import { market_position, haggle_position, haggle_claim_position, move_market_fifo, settle_market_fifo,
	market_benefit, terminate_haggle, market_correction_cache_clients } from '../../market-custody';
import type { market_haggles } from '../../db/types/db_types';
function market_fixture(f:ReturnType<typeof fixture>,direction='sell',qty=10,price=7) {
	return f.db.query<{id:number},[string,number,number,number,number]>(
		'INSERT INTO market_items(guild_id,client_id,direction,item_id,qty,available,price,escrow_gp) VALUES(1,101,?,\'test:Ore\',?,?,?,?) RETURNING id')
		.get(direction,qty,qty,price,direction==='buy'?qty*price:0)!.id;
}
function market_root(f:ReturnType<typeof fixture>,id:number,qty=10,direction='sell',key='market-root',operation=`receipt:${f.command}`) {
	create_custody_source(f.db,{root_key:key,operation_key:operation,client_id:101,object_id:direction==='sell'?'test:Ore':'melvorD:GP',quantity:qty,created_at:2000,snapshot:{listing_id:id}},market_position(id,direction==='sell'?'stock':'gp'));
}
function haggle_fixture(f:ReturnType<typeof fixture>,id:number,direction='sell',qty=4,price=7) {
	const h=crypto.randomUUID();
	f.db.query(`INSERT INTO market_haggles(id,listing_id,listing_ref,guild_id,initiator_id,owner_id,direction,item_id,item_qty,listing_price,offer_price,listing_reserved_gp,payer_escrow_gp,turn_client_id,created_at,updated_at,expires_at)
		VALUES(?,?,?,1,102,101,?,'test:Ore',?,?,?,?,?,101,2000,2000,999999)`).run(h,id,id,direction,qty,price,price,direction==='buy'?qty*price:0,qty*price);
	f.db.query('UPDATE market_items SET available=available-?,reserved=reserved+?,escrow_gp=escrow_gp-? WHERE id=?').run(qty,qty,direction==='buy'?qty*price:0,id);
	return f.db.query<market_haggles,[string]>('SELECT * FROM market_haggles WHERE id=?').get(h)!;
}

test('Marketplace partial FIFO settlement protects buyers, holds only seller unissued proceeds and invalidates remaining stock',()=>{
	const f=fixture();try {
		const id=market_fixture(f);market_root(f,id);
		const location=inbox_custody_location(101,'market_sold','Buyer','melvorD:GP');
		settle_market_fifo(f.db,market_position(id,'stock'),10,4,7,'melvorD:GP',location,'partial',4000);
		f.db.query('UPDATE market_items SET available=6,payout=28 WHERE id=?').run(id);
		f.db.query("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty) VALUES(101,'market_sold','Buyer','melvorD:GP',38)").run();
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT available,qty,payout,haggled FROM market_items WHERE id=?').get(id)).toEqual({available:0,qty:10,payout:28,haggled:6});
		expect(f.db.query('SELECT qty FROM inbox_items WHERE client_id=101').get()).toEqual({qty:10});
		expect(custody_at(f.db,'held')).toEqual([{root_key:'market-benefit:partial:market-root',quantity:28}]);
		expect(f.db.query("SELECT object_id,quantity,disposition FROM economy_corrections ORDER BY id").all()).toContainEqual({object_id:'test:Ore',quantity:4,disposition:'protected'});
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('Marketplace historical FIFO prefix is consumed before prospective stock and missing ancestry stays review-only',()=>{
	const f=fixture();try {
		const id=market_fixture(f,'sell',15);market_root(f,id,10);
		settle_market_fifo(f.db,market_position(id,'stock'),15,7,7,'melvorD:GP','unresolved:test-benefit','prefix',4000);
		f.db.query('UPDATE market_items SET available=8,payout=49 WHERE id=?').run(id);
		expect(custody_at(f.db,market_position(id,'stock'))).toEqual([{root_key:'market-root',quantity:8}]);
		expect(f.db.query("SELECT quantity FROM economy_custody_sources WHERE root_key LIKE 'market-benefit:%'").all()).toEqual([{quantity:14}]);
		expect(f.db.query("SELECT quantity FROM economy_dependency_evidence WHERE kind='market-historical-prefix'").get()).toEqual({quantity:5});
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT available FROM market_items WHERE id=?').get(id)).toEqual({available:0});
	}finally{f.db.close();}
});

test('Buy Order correction preserves completed fill payments and holds exact unissued acquired items in distinct units',()=>{
	const f=fixture();try {
		const id=market_fixture(f,'buy');market_root(f,id,70,'buy');
		const location=inbox_custody_location(101,'market_fulfilled','Seller','test:Ore');
		settle_market_fifo(f.db,market_position(id,'gp'),70,21,1,'test:Ore',location,'fill',4000,7);
		f.db.query('UPDATE market_items SET available=7,escrow_gp=49 WHERE id=?').run(id);
		f.db.query("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty) VALUES(101,'market_fulfilled','Seller','test:Ore',3)").run();
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT available,escrow_gp FROM market_items WHERE id=?').get(id)).toEqual({available:0,escrow_gp:0});
		expect(f.db.query('SELECT * FROM inbox_items WHERE client_id=101').all()).toEqual([]);
		expect(custody_at(f.db,'held')[0]!.quantity).toBe(3);
		expect(custody_at(f.db,'protected:market:fill')[0]!.quantity).toBe(21);
	}finally{f.db.close();}
});

test('invalid Sell reservation cancels once, restores valid own stock and returns valid other-party payment',()=>{
	const f=fixture();try {
		const id=market_fixture(f);market_root(f,id,3);
		market_root(f,id,7,'sell','valid-root','independent');
		const h=haggle_fixture(f,id);
		move_market_fifo(f.db,market_position(id,'stock'),haggle_position(h.id,'stock'),4,10,3000);
		create_custody_source(f.db,{root_key:'other-payment',operation_key:'other',client_id:102,object_id:'melvorD:GP',quantity:28,created_at:3000,snapshot:{}},haggle_position(h.id,'gp'));
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT available,reserved,haggled FROM market_items WHERE id=?').get(id)).toEqual({available:7,reserved:0,haggled:3});
		expect(f.db.query('SELECT gp FROM market_haggle_claims WHERE haggle_id=? AND client_id=102').get(h.id)).toEqual({gp:28});
		expect(custody_at(f.db,haggle_claim_position(h.id,102,'melvorD:GP'))).toEqual([{root_key:'other-payment',quantity:28}]);
		expect(terminate_haggle(f.db,h,'cancelled',5000)).toBe(false);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('invalid Buy Order reservation returns valid seller stock and removes only invalid reserved GP',()=>{
	const f=fixture();try {
		const id=market_fixture(f,'buy');market_root(f,id,70,'buy');
		const h=haggle_fixture(f,id,'buy');
		move_market_fifo(f.db,market_position(id,'gp'),haggle_position(h.id,'reserve'),28,70,3000);
		create_custody_source(f.db,{root_key:'other-stock',operation_key:'other',client_id:102,object_id:'test:Ore',quantity:4,created_at:3000,snapshot:{}},haggle_position(h.id,'stock'));
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT available,reserved,escrow_gp FROM market_items WHERE id=?').get(id)).toEqual({available:0,reserved:0,escrow_gp:0});
		expect(f.db.query('SELECT item_qty FROM market_haggle_claims WHERE haggle_id=? AND client_id=102').get(h.id)).toEqual({item_qty:4});
		expect(f.db.query('SELECT * FROM market_haggle_claims WHERE client_id=101').all()).toEqual([]);
	}finally{f.db.close();}
});

test('mixed GP roots and negotiated price never create fractional benefits or fail legitimate settlement',()=>{
	const f=fixture();try {
		for(const [root,qty] of [['first',5],['second',16]] as const) create_custody_source(f.db,{root_key:root,operation_key:'other',client_id:101,object_id:'melvorD:GP',quantity:qty,created_at:2000,snapshot:{}},'test:payment');
		settle_market_fifo(f.db,'test:payment',21,21,1,'test:Ore','test:benefit','mixed',4000,7);
		expect(f.db.query("SELECT quantity FROM economy_custody_sources WHERE root_key LIKE 'market-benefit:%'").all()).toEqual([{quantity:2}]);
		expect(f.db.query("SELECT SUM(quantity) qty FROM economy_dependency_evidence WHERE kind='market-mixed-benefit'").get()).toEqual({qty:7});
		expect(custody_at(f.db,'protected:market:mixed').reduce((n,r)=>n+r.quantity,0)).toBe(21);
	}finally{f.db.close();}
});

test('issued own market benefits are protected even with a lost reply; unissued claim benefits can be held completely',()=>{
	const f=fixture();try {
		const id=market_fixture(f);market_root(f,id);
		move_location(f.db,market_position(id,'stock'),'protected:other-buyer',4000,'settled');
		market_benefit(f.db,'market-root','issued','melvorD:GP',7,'protected:lost-http-reply',4000);
		const h=haggle_fixture(f,id);
		f.db.query("UPDATE market_haggles SET status='accepted',turn_client_id=NULL,expires_at=NULL,terminal_at=4000 WHERE id=?").run(h.id);
		f.db.query('INSERT INTO market_haggle_claims(haggle_id,client_id,gp) VALUES(?,101,63)').run(h.id);
		market_benefit(f.db,'market-root','unissued','melvorD:GP',63,haggle_claim_position(h.id,101,'melvorD:GP'),4000);
		expect(correct(f).applied).toBe(true);
		expect(custody_at(f.db,'held')[0]!.quantity).toBe(63);
		expect(f.db.query('SELECT * FROM market_haggle_claims WHERE client_id=101').all()).toEqual([]);
		expect(custody_at(f.db,'protected:lost-http-reply')[0]!.quantity).toBe(7);
	}finally{f.db.close();}
});

test('identity deletion preserves Marketplace GP principal and accepted actor benefits for exact unissued correction',async()=>{
	const {execute_client_deletion}=await import('../../identity_deletion');
	const f=fixture();try {
		const id=market_fixture(f,'buy');market_root(f,id,70,'buy');
		const h=haggle_fixture(f,id,'buy');
		move_market_fifo(f.db,market_position(id,'gp'),'protected:filled',28,70,3000);
		f.db.query("UPDATE market_haggles SET status='accepted',turn_client_id=NULL,expires_at=NULL,terminal_at=4000 WHERE id=?").run(h.id);
		f.db.query('UPDATE market_items SET reserved=0,haggled=4 WHERE id=?').run(id);
		f.db.query('INSERT INTO market_haggle_claims(haggle_id,client_id,item_id,item_qty) VALUES(?,101,\'test:Ore\',4)').run(h.id);
		market_benefit(f.db,'market-root','deletion-benefit','test:Ore',4,haggle_claim_position(h.id,101,'test:Ore'),4000);
		const request=f.db.query<import('../../db/types/db_types').client_deletion_requests,[]>(
			'INSERT INTO client_deletion_requests(target_client_id,requester_client_id,requested_at,execute_at) VALUES(101,102,4000,5000) RETURNING *').get()!;
		f.db.transaction(()=>execute_client_deletion(f.db,request,5000)).immediate();
		const returned=f.db.query<{id:number;gp:number},[]>('SELECT id,gp FROM client_deletion_returns WHERE client_id=101').get()!;
		expect(returned.gp).toBe(42);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT gp FROM client_deletion_returns WHERE id=?').get(returned.id)).toEqual({gp:0});
		expect(f.db.query('SELECT * FROM client_deletion_return_items WHERE return_id=?').all(returned.id)).toEqual([]);
		expect(custody_at(f.db,'held')[0]!.quantity).toBe(4);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('invalid Haggle topup preserves valid own earlier topup, listing GP reserve and other-party item refund',()=>{
	const f=fixture();try {
		const id=market_fixture(f,'buy');market_root(f,id,70,'buy','valid-order','independent');
		const h=haggle_fixture(f,id,'buy');
		move_market_fifo(f.db,market_position(id,'gp'),haggle_position(h.id,'reserve'),28,70,3000);
		f.db.query('UPDATE market_haggles SET payer_escrow_gp=42,revision=2 WHERE id=?').run(h.id);
		for(const [root,operation] of [['invalid-topup',`receipt:${f.command}`],['valid-topup','independent']] as const)
			create_custody_source(f.db,{root_key:root,operation_key:operation,client_id:101,object_id:'melvorD:GP',quantity:7,created_at:3000,snapshot:{haggle_id:h.id,revision:2}},haggle_position(h.id,'gp'));
		create_custody_source(f.db,{root_key:'valid-stock',operation_key:'other',client_id:102,object_id:'test:Ore',quantity:4,created_at:3000,snapshot:{}},haggle_position(h.id,'stock'));
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT available,reserved,escrow_gp FROM market_items WHERE id=?').get(id)).toEqual({available:10,reserved:0,escrow_gp:70});
		expect(f.db.query('SELECT gp FROM market_haggle_claims WHERE haggle_id=? AND client_id=101').get(h.id)).toEqual({gp:7});
		expect(f.db.query('SELECT item_qty FROM market_haggle_claims WHERE haggle_id=? AND client_id=102').get(h.id)).toEqual({item_qty:4});
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('safe-integer GP intervals allocate whole item benefits without floating-point division or per-unit work',()=>{
	const f=fixture();try {
		const qty=Number.MAX_SAFE_INTEGER;
		create_custody_source(f.db,{root_key:'maximum',operation_key:'other',client_id:101,object_id:'melvorD:GP',quantity:qty,created_at:2000,snapshot:{}},'maximum');
		settle_market_fifo(f.db,'maximum',qty,qty,1,'test:Ore','max-benefit','maximum',4000,7);
		expect(custody_at(f.db,'max-benefit')[0]!.quantity).toBe(Number(BigInt(qty)/7n));
		expect(f.db.query("SELECT quantity FROM economy_dependency_evidence WHERE kind='market-mixed-benefit'").get()).toEqual({quantity:Number(BigInt(qty)%7n)});
	}finally{f.db.close();}
});

test('exact unpaid Marketplace dependency hold advances payout accounting without issuing or recreating proceeds',()=>{
	const f=fixture();try {
		const id=market_fixture(f);market_root(f,id);
		move_location(f.db,market_position(id,'stock'),'protected:buyer',3000,'settled');
		f.db.query('UPDATE market_items SET available=0 WHERE id=?').run(id);
		market_benefit(f.db,'market-root','unpaid','melvorD:GP',70,market_position(id,'payout'),3000);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT payout FROM market_items WHERE id=?').get(id)).toEqual({payout:70});
		expect(custody_at(f.db,'held')[0]!.quantity).toBe(70);
		expect(f.db.query('SELECT * FROM inbox_items').all()).toEqual([]);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('Marketplace cache handoff includes affected counterparties from retained snapshots after live cleanup',()=>{
	const f=fixture();try {
		expect(market_correction_cache_clients(f.db,'missing')).toEqual([]);
		const id=market_fixture(f);market_root(f,id);const h=haggle_fixture(f,id);
		move_market_fifo(f.db,market_position(id,'stock'),haggle_position(h.id,'stock'),4,10,3000);
		f.db.transaction(()=>terminate_haggle(f.db,h,'cancelled',4000)).immediate();
		f.db.query('DELETE FROM market_items WHERE id=?').run(id);
		expect(market_correction_cache_clients(f.db,`receipt:${f.command}`)).toEqual([101,102]);
	}finally{f.db.close();}
});

import { capture_trade_item, trade_position, trade_receive_position, settle_trade, trade_correction_cache_clients } from '../../trade-custody';
function custody_trade(f:ReturnType<typeof fixture>) {
	const trade=f.db.query<import('../../db/types/db_types').trade_offers,[]>('INSERT INTO trade_offers(sender_id,recipient_id,attending_id,state,created_at,updated_at) VALUES(101,102,101,1,2000,2000) RETURNING *').get()!;
	return trade;
}
function custody_trade_row(f:ReturnType<typeof fixture>,trade:ReturnType<typeof custody_trade>,counter:number,qty:number,command:unknown=f.command,item='test:Ore') {
	const row=f.db.query<import('../../trade-custody').TradeItem,[number,string,number,number]>('INSERT INTO trade_items(trade_id,item_id,qty,counter) VALUES(?,?,?,?) RETURNING id,item_id,qty,counter').get(trade.trade_id,item,qty,counter)!;
	capture_trade_item(f.db,trade,row,command,2000);return row;
}

test('Trade correction invalidates every command row and returns historical, other-party and own unrelated additive escrow once',()=>{
	const f=fixture();try {
		const trade=custody_trade(f);
		custody_trade_row(f,trade,0,2);custody_trade_row(f,trade,0,3);
		custody_trade_row(f,trade,0,7,crypto.randomUUID());custody_trade_row(f,trade,0,11,null);
		custody_trade_row(f,trade,1,13,crypto.randomUUID());
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT client_id,qty FROM inbox_items ORDER BY client_id').all()).toEqual([{client_id:101,qty:18},{client_id:102,qty:13}]);
		expect(f.db.query('SELECT * FROM trade_offers').all()).toEqual([]);
		expect(f.db.query('SELECT * FROM trade_items').all()).toEqual([]);
		expect(custody_at(f.db,'invalidated').reduce((sum,r)=>sum+r.quantity,0)).toBe(5);
		expect(correct(f).applied).toBe(false);
		expect(trade_correction_cache_clients(f.db,`receipt:${f.command}`)).toEqual([101,102]);
		expect(f.db.query("SELECT json_extract(snapshot_json,'$.qty') qty FROM economy_terminal_snapshots WHERE table_name='trade_items' AND phase='source' ORDER BY id").all()).toEqual([2,3,7,11,13].map(qty=>({qty})));
	}finally{f.db.close();}
});

test('settled Trade protects counterparty principal and holds exact own barter benefit in separate item units',()=>{
	const f=fixture();try {
		const trade=custody_trade(f);custody_trade_row(f,trade,0,5);custody_trade_row(f,trade,1,17,crypto.randomUUID(),'test:Reward');
		settle_trade(f.db,trade,4000,false);
		const location=inbox_custody_location(101,'trade_completed','','test:Reward');
		f.db.query("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty) VALUES(101,'trade_completed','','test:Reward',17)").run();
		move_location(f.db,trade_receive_position(trade.trade_id,101,'test:Reward'),location,4000,'issued-inbox');
		f.db.query('DELETE FROM trade_items WHERE trade_id=?').run(trade.trade_id);f.db.query('DELETE FROM trade_offers WHERE trade_id=?').run(trade.trade_id);
		expect(correct(f).applied).toBe(true);
		expect(custody_at(f.db,`protected:trade-settled:${trade.trade_id}`).reduce((sum,r)=>sum+r.quantity,0)).toBe(22);
		expect(custody_at(f.db,'held').map(r=>r.quantity)).toEqual([17]);
		expect(f.db.query('SELECT * FROM inbox_items WHERE client_id=101').all()).toEqual([]);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('legacy accepted Trade keeps other entitlement intact and can hold only unissued actor resolved benefit',()=>{
	const f=fixture();try {
		const trade=custody_trade(f);
		// Correct the recipient's counter command, while the sender offer remains valid.
		f.db.query('UPDATE trade_offers SET sender_id=102,recipient_id=101,attending_id=102 WHERE trade_id=?').run(trade.trade_id);
		const swapped={...trade,sender_id:102,recipient_id:101,attending_id:102};
		custody_trade_row(f,swapped,0,17,crypto.randomUUID(),'test:Reward');custody_trade_row(f,swapped,1,5);
		settle_trade(f.db,swapped,4000,true);
		f.db.query('DELETE FROM trade_items WHERE trade_id=? AND counter=1').run(trade.trade_id);
		f.db.query('DELETE FROM trade_offers WHERE trade_id=?').run(trade.trade_id);
		f.db.query('INSERT INTO resolved_trade_offers(trade_id,client_id,sender_id,declined,created_at) VALUES(?,101,102,0,4000)').run(trade.trade_id);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT * FROM trade_items').all()).toEqual([]);
		expect(custody_at(f.db,'held')[0]!.quantity).toBe(17);
		expect(custody_at(f.db,`protected:trade-receipt:${trade.trade_id}:102`)[0]!.quantity).toBe(5);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('legacy declined Trade return retains source row and historical basket attribution remains unproven',()=>{
	const f=fixture();try {
		const trade=custody_trade(f);custody_trade_row(f,trade,0,5);
		f.db.query('DELETE FROM trade_offers WHERE trade_id=?').run(trade.trade_id);
		f.db.query('INSERT INTO resolved_trade_offers(trade_id,client_id,sender_id,declined,created_at) VALUES(?,101,102,1,4000)').run(trade.trade_id);
		expect(correct(f).applied).toBe(true);expect(f.db.query('SELECT * FROM trade_items').all()).toEqual([]);
		expect(custody_at(f.db,'invalidated')[0]!.quantity).toBe(5);
		const other=custody_trade(f);custody_trade_row(f,other,0,7,null);custody_trade_row(f,other,1,11,crypto.randomUUID());
		settle_trade(f.db,other,4000,false);
		expect(f.db.query("SELECT quantity FROM economy_dependency_evidence WHERE kind='trade-historical-benefit'").all()).toEqual([{quantity:11}]);
		expect(custody_at(f.db,trade_receive_position(other.trade_id,101,'test:Ore'))).toEqual([]);
	}finally{f.db.close();}
});

test('identity deletion retains duplicate Trade item roots in owner return stores and invalidates only unissued actor principal',async()=>{
	const {execute_client_deletion}=await import('../../identity_deletion');
	const f=fixture();try {
		const trade=custody_trade(f);custody_trade_row(f,trade,0,2);custody_trade_row(f,trade,0,3);custody_trade_row(f,trade,1,7,crypto.randomUUID());
		const request=f.db.query<import('../../db/types/db_types').client_deletion_requests,[]>('INSERT INTO client_deletion_requests(target_client_id,requester_client_id,requested_at,execute_at) VALUES(101,102,4000,5000) RETURNING *').get()!;
		f.db.transaction(()=>execute_client_deletion(f.db,request,5000)).immediate();
		expect(correct(f).applied).toBe(true);
		expect(f.db.query('SELECT r.client_id,i.qty FROM client_deletion_returns r JOIN client_deletion_return_items i ON i.return_id=r.id').all()).toEqual([{client_id:102,qty:7}]);
		expect(custody_at(f.db,'invalidated').reduce((n,r)=>n+r.quantity,0)).toBe(5);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('mixed known and historical Trade basket links unresolved benefit units to known roots without guessed holds',()=>{
	const f=fixture();try {
		const trade=custody_trade(f);custody_trade_row(f,trade,0,5);custody_trade_row(f,trade,0,7,null);custody_trade_row(f,trade,1,17,crypto.randomUUID(),'test:Reward');
		settle_trade(f.db,trade,4000,false);
		f.db.query('DELETE FROM trade_items WHERE trade_id=?').run(trade.trade_id);f.db.query('DELETE FROM trade_offers WHERE trade_id=?').run(trade.trade_id);
		expect(correct(f).applied).toBe(true);
		expect(f.db.query("SELECT quantity,disposition,reason FROM economy_corrections WHERE object_id='test:Reward'").all()).toEqual([{quantity:17,disposition:'unresolved',reason:'incomplete-trade-basket-ancestry'}]);
		const evidence=f.db.query<{snapshot_json:string},[]>("SELECT snapshot_json FROM economy_dependency_evidence WHERE kind='trade-unresolved-benefit'").get()!;
		expect(JSON.parse(evidence.snapshot_json).unknown_outgoing).toEqual([{item_row:expect.any(Number),item:'test:Ore',quantity:7}]);
		expect(custody_at(f.db,'held')).toEqual([]);
		expect(correct(f).applied).toBe(false);
	}finally{f.db.close();}
});

test('Trade return safe-integer failure rolls correction back atomically without losing escrow or source evidence',()=>{
	const f=fixture();try {
		const trade=custody_trade(f);const row=custody_trade_row(f,trade,0,5);custody_trade_row(f,trade,1,7,crypto.randomUUID());
		f.db.query("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty) VALUES(102,'trade_cancelled','','test:Ore',?)").run(Number.MAX_SAFE_INTEGER);
		expect(()=>correct(f)).toThrow('Trade return exceeds safe integer');
		expect(f.db.query('SELECT qty FROM trade_items WHERE id=?').get(row.id)).toEqual({qty:5});
		expect(custody_at(f.db,trade_position(row.id))[0]!.quantity).toBe(5);
		expect(custody_at(f.db,'invalidated')).toEqual([]);
		expect(f.db.query('SELECT * FROM economy_corrections').all()).toEqual([]);
	}finally{f.db.close();}
});

test('historical Trade without command custody cannot authorize correction or receipt retirement',()=>{
	const f=fixture();try {
		const trade=custody_trade(f);custody_trade_row(f,trade,0,5,null);custody_trade_row(f,trade,1,7,null);
		expect(correct(f)).toEqual({applied:false,reason:'unproven_custody'});
		expect(f.db.query('SELECT qty FROM trade_items ORDER BY id').all()).toEqual([{qty:5},{qty:7}]);
		expect(f.db.query('SELECT * FROM economy_corrections').all()).toEqual([]);
	}finally{f.db.close();}
});
