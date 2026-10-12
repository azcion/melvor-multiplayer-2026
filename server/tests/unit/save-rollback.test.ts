import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations } from '../../db/schema';
import { save_rollback_migration } from '../../db/schema/migrations/save-rollback';
import { create_test_database } from '../support/database';
import { record_character_save_load } from '../../character-save-loads';
import { record_economy_operation, record_load_clock, inspect_save_rollback, calibrated_save_cutoff } from '../../save-rollback';
import { make_audit_context, run_with_audit_context } from '../../audit-context';

function fixture(filename?:string) {
	const db=create_test_database(filename);
	for (const id of [101,102]) db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)')
		.run(id,`rollback-${id}`,'key',`111-222-${id}`,'Rollback Test','melvorD:Plant');
	return db;
}
const device='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
function load(db:Database,save:number|null,admitted:number,client=101,source:'decode'|'character_loaded'='decode') {
	return record_character_save_load(db,client,{ load_id:crypto.randomUUID(),save_timestamp:save,
		client_loaded_at:admitted-10,capture_source:source },admitted,device)!;
}
function clock(db:Database,id:number,admitted:number,client=101) {
	expect(record_load_clock(db,client,id,{ server_admitted_at:admitted,client_sent_at:admitted-10,
		client_received_at:admitted+10,elapsed_ms:20 },admitted+20)).toBe(true);
}
function operation(db:Database,id:number|null,now:number,key:string,effect:'outgoing'|'incoming'|'server_only'='outgoing',client=101) {
	return run_with_audit_context(make_audit_context({event_type:'test',actor_kind:'client',actor_client_id:client,
		actor_display_name:null,save_load_id:id}),() => record_economy_operation(db,{source_key:key,client_id:client,
		kind:'test',committed_at:now,local_effect:effect,evidence:{item_id:'melvorD:Logs',qty:10}}));
}

test('calibrated bounds preserve uncertainty and refuse fallback, unknown, future, unsafe, and stepped clocks',()=>{
	const base={id:1,client_id:101,save_timestamp:100,client_loaded_at:190,admitted_at:300,
		capture_source:'decode',installation_id:device,operation_highwater:0};
	expect(calibrated_save_cutoff(base,200,220,20)).toEqual({lower:180,upper:200,quality:'calibrated',reason:'handshake_interval'});
	for (const changed of [{capture_source:'character_loaded'},{save_timestamp:null},{installation_id:null},
		{save_timestamp:201},{save_timestamp:1,admitted_at:10}])
		expect(calibrated_save_cutoff({...base,...changed},200,220,20).quality).toBe('review_only');
	expect(calibrated_save_cutoff(base,200,500,20).quality).toBe('review_only');
	expect(calibrated_save_cutoff({...base,admitted_at:Number.MAX_SAFE_INTEGER+1},200,220,20).quality).toBe('review_only');
});

test('new loads compare only prior outflows, reconnect and late calibration exclude current operations',()=>{
	const db=fixture();try {
		const original=load(db,50,100);clock(db,original,100);
		const prior=operation(db,original,200,'principal');
		operation(db,original,201,'incoming','incoming');operation(db,original,202,'wish','server_only');
		operation(db,null,203,'sibling','outgoing',102);
		const restored=load(db,150,300);
		operation(db,restored,301,'current');
		clock(db,restored,300);
		const summary=inspect_save_rollback(db,101);
		expect(summary.incidents).toHaveLength(1);
		expect(summary.candidates).toHaveLength(1);
		expect(summary.assessments).toEqual([{incident_id:summary.incidents[0]!.id,operation_id:prior,evidence_id:2,classification:'after_cutoff'}]);
		const observation=db.query<{load_id:string},[number]>('SELECT load_id FROM economy_load_observations WHERE id=?').get(restored)!;
		record_character_save_load(db,101,{load_id:observation.load_id,save_timestamp:1,client_loaded_at:1,capture_source:'decode'},400);
		expect(inspect_save_rollback(db,101).candidates).toHaveLength(1);
		expect(record_load_clock(db,102,restored,{server_admitted_at:300,client_sent_at:290,client_received_at:310,elapsed_ms:20})).toBe(false);
	} finally {db.close();}
});

test('same-millisecond admission frontier excludes later operations and immutable samples resist retries',()=>{
	const db=fixture();try {
		const old=load(db,10,100);operation(db,old,200,'old');
		const restored=load(db,50,200);operation(db,old,200,'late-old-session');
		clock(db,restored,200);clock(db,restored,200);
		expect(inspect_save_rollback(db,101).candidates).toHaveLength(1);
		expect(db.query('SELECT id FROM economy_clock_evidence').all()).toHaveLength(1);
	} finally {db.close();}
});

test('missing provenance and changed clocks/devices remain review-only; incoming rewards do not create incidents',()=>{
	const db=fixture();try {
		const old=load(db,10,100);clock(db,old,100);
		operation(db,old,200,'reward','incoming');
		const normal=load(db,50,250);clock(db,normal,250);
		expect(inspect_save_rollback(db,101).incidents).toHaveLength(0);
		operation(db,null,260,'unknown-origin');
		const restored=record_character_save_load(db,101,{load_id:crypto.randomUUID(),save_timestamp:50,
			client_loaded_at:280,capture_source:'decode'},300,'bbbbbbbb-1111-4111-8111-aaaaaaaaaaaa')!;
		clock(db,restored,300);
		expect(inspect_save_rollback(db,101).assessments).toEqual([expect.objectContaining({classification:'review_only'})]);
	} finally {db.close();}
});

test('confirmed counts deduplicate repeated restores and multiple events; appended dismissals change counts',()=>{
	const db=fixture();try {
		const old=load(db,10,100);clock(db,old,100);operation(db,old,200,'principal');operation(db,old,201,'principal2');
		clock(db,load(db,50,300),300);clock(db,load(db,50,400),400);
		let summary=inspect_save_rollback(db,101);
		for (const incident of summary.incidents) db.query('INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at) VALUES(?,?,?,?)')
			.run(incident.id,'confirmed','Operator test decision',500);
		expect(inspect_save_rollback(db,101).counts).toEqual([expect.objectContaining({state:'confirmed',occurrences:1})]);
		operation(db,old,501,'new-principal');clock(db,load(db,50,600),600);
		summary=inspect_save_rollback(db,101);
		db.query('INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at) VALUES(?,?,?,?)')
			.run(summary.incidents[0]!.id,'confirmed','New operation',601);
		expect(inspect_save_rollback(db,101).counts).toEqual([expect.objectContaining({state:'confirmed',occurrences:2})]);
		db.query('INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at) VALUES(?,?,?,?)')
			.run(summary.incidents[0]!.id,'dismissed','Review dismissal',602);
		expect(inspect_save_rollback(db,101).counts).toEqual([expect.objectContaining({state:'confirmed',occurrences:1}),expect.objectContaining({state:'dismissed',occurrences:1})]);
	} finally {db.close();}
});

test('evidence survives live identity deletion and reopening; updates/deletes and duplicate invalidations are refused',()=>{
	const directory=mkdtempSync(join(tmpdir(),'rollback-test-'));const filename=join(directory,'evidence.sqlite');
	let db=fixture(filename);try {
		const old=load(db,10,100);const op=operation(db,old,200,'principal');load(db,50,300);
		const incident=inspect_save_rollback(db,101).incidents[0]!.id;
		const sql="INSERT INTO economy_corrections(incident_id,operation_id,lot_key,object_id,quantity,disposition,reason,decided_at,policy_version) VALUES(?,?,'lot:1','melvorD:Logs',10,'invalidated','Test foundation constraint',400,1)";
		db.query(sql).run(incident,op);expect(()=>db.query(sql).run(incident,op)).toThrow();
		for (const invalid of [1.5,0,Number.MAX_SAFE_INTEGER+1])
			expect(()=>db.query(sql.replace("'lot:1'","'numeric-lot'").replace(",10,'invalidated'",",?,'invalidated'")).run(incident,op,invalid)).toThrow();
		for (const table of ['economy_load_observations','economy_operations','economy_incidents','economy_incident_candidates','economy_incident_decisions','economy_corrections'])
			expect(()=>db.run(`DELETE FROM ${table}`)).toThrow('Economy evidence is immutable');
		expect(()=>db.run('UPDATE economy_operations SET committed_at=0')).toThrow('Economy evidence is immutable');
		db.run('DELETE FROM clients WHERE id=101');db.close();db=new Database(filename,{strict:true});
		expect(inspect_save_rollback(db,101).incidents).toHaveLength(1);
		expect(inspect_save_rollback(db,101).observations).toHaveLength(2);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('request context is isolated across asynchronous requests and receipts cannot escape failed transactions',async()=>{
	const db=fixture();try {
		const first=load(db,10,100),second=load(db,20,110,102);
		await Promise.all([101,102].map(client=>run_with_audit_context(make_audit_context({event_type:'test',actor_kind:'client',
			actor_client_id:client,actor_display_name:null,save_load_id:client===101?first:second}),async()=>{
			await Promise.resolve();record_economy_operation(db,{source_key:`parallel:${client}`,client_id:client,kind:'test',
				local_effect:'outgoing',evidence:{}});
		})));
		expect(db.query('SELECT client_id,save_load_id FROM economy_operations ORDER BY id').all())
			.toEqual([{client_id:101,save_load_id:first},{client_id:102,save_load_id:second}]);
		expect(()=>db.transaction(()=>{operation(db,first,300,'failed');throw new Error('rollback');}).immediate()).toThrow();
		expect(db.query("SELECT id FROM economy_operations WHERE source_key='failed'").all()).toEqual([]);
	} finally {db.close();}
});

test('clock shifts on the same installation remain review-only',()=>{
	const db=fixture();try {
		const old=load(db,10,200);
		expect(record_load_clock(db,101,old,{server_admitted_at:200,client_sent_at:190,client_received_at:210,elapsed_ms:20},220)).toBe(true);
		operation(db,old,300,'shifted');
		const restored=record_character_save_load(db,101,{load_id:crypto.randomUUID(),save_timestamp:100,
			client_loaded_at:190,capture_source:'decode'},400,device)!;
		expect(record_load_clock(db,101,restored,{server_admitted_at:400,client_sent_at:200,client_received_at:220,elapsed_ms:20},420)).toBe(true);
		expect(inspect_save_rollback(db,101).assessments).toEqual([expect.objectContaining({classification:'review_only'})]);
	} finally {db.close();}
});

test('a calibrated uncertainty interval cannot classify a boundary operation as definitely after the save',()=>{
	const db=fixture();try {
		const old=load(db,10,100);clock(db,old,100);operation(db,old,200,'boundary');
		const restored=load(db,200,300);clock(db,restored,300);
		expect(inspect_save_rollback(db,101).assessments).toEqual([expect.objectContaining({classification:'uncertain'})]);
	} finally {db.close();}
});

test('account inspection rolls up characters without using sibling operations as save evidence',()=>{
	const db=fixture();try {
		db.run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(77,'Rollback Test Account','rollback-test-playfab',0)");
		db.run('UPDATE clients SET melvor_account_id=77 WHERE id IN (101,102)');
		const sibling=load(db,10,100,102);operation(db,sibling,200,'sibling-only','outgoing',102);
		load(db,50,300,101);
		expect(inspect_save_rollback(db,101).incidents).toHaveLength(0);
		load(db,50,300,102);
		expect(inspect_save_rollback(db,101).account_rollup).toEqual([{client_id:102,state:'suspected',occurrences:1}]);
	} finally {db.close();}
});

test('migration snapshots historical receipts without inventing a load association or changing their payload',()=>{
	const db=new Database(':memory:',{strict:true});db.run('PRAGMA foreign_keys=ON');
	try {
		for (const migration of migrations.filter(migration=>migration.version<173)) {
			if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
			db.transaction(()=>db.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=ON');
		}
		db.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'migration-rollback','key','111-222-101','Migration Test','melvorD:Plant')");
		const response=JSON.stringify({success:true,receipt:{id:'original',kind:'gift-send',effects:[{storage:'bank',item_id:'melvorD:Logs',qty:-10}]}});
		db.query('INSERT INTO economy_receipts(id,client_id,kind,response_json,created_at) VALUES(?,101,?,?,200)')
			.run('original','gift-send',response);
		db.run(save_rollback_migration.sql);
		expect(db.query('SELECT response_json FROM economy_receipts').get()).toEqual({response_json:response});
		expect(db.query('SELECT save_load_id,historical,local_effect,evidence_json FROM economy_operations').get())
			.toEqual({save_load_id:null,historical:1,local_effect:'outgoing',evidence_json:response});
		const restored=load(db,50,300);clock(db,restored,300);
		expect(inspect_save_rollback(db,101).assessments).toEqual([expect.objectContaining({classification:'review_only'})]);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {db.close();}
});

test('inspector retains typed party snapshots and derived parent links after live cleanup',()=>{
	const db=fixture();try {
		const original=load(db,10,100);
		db.query("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(9,'Inspector',?,1)").run('rollback-inspector');
		db.query('UPDATE clients SET melvor_account_id=9 WHERE id=101').run();
		load(db,20,200);
		const snapshot=(table:string,id:number,value:unknown)=>db.query('INSERT INTO economy_terminal_snapshots(table_name,row_id,snapshot_json) VALUES(?,?,?)').run(table,id,JSON.stringify(value));
		snapshot('gifts',901,{gift_id:901,sender_id:101,client_id:102});
		snapshot('gift_items',909,{gift_id:901,item_id:'melvorD:Logs',qty:3});
		snapshot('client_deletion_return_items',910,{return_id:911,item_id:'melvorD:Logs',qty:3});
		snapshot('client_deletion_return_items',912,{return_id:913,item_id:'melvorD:Logs',qty:3});
		snapshot('market_haggles',902,{owner_id:102,initiator_id:101});
		snapshot('trade_offers',903,{trade_id:903,sender_id:102,recipient_id:101});
		snapshot('trade_items',904,{trade_id:903,item_id:'melvorD:Logs',qty:3});
		snapshot('market_purchases',905,{owner_key:'client:101'});
		snapshot('market_purchases',906,{owner_key:'account:9'});
		snapshot('market_purchases',907,{owner_key:'account:99'});
		snapshot('unrelated',908,{sender_id:101,owner_key:'client:101'});
		operation(db,original,250,'inspector-source');
		for(const [root,owner,parents] of [['parent',101,[]],['child',102,['parent']],['unrelated',102,['other']]] as const)
			db.query('INSERT INTO economy_custody_sources(root_key,operation_key,client_id,object_id,quantity,created_at,snapshot_json) VALUES(?,?,?,?,?,?,?)')
				.run(root,'inspector-source',owner,'melvorD:Logs',3,250,JSON.stringify({parent_roots:parents}));
		db.query("INSERT INTO economy_custody_movements(root_key,to_location,quantity,occurred_at,reason) VALUES('parent','deletion-return:911:melvorD:Logs',3,250,'source')").run();
		db.query('DELETE FROM clients WHERE id=101').run();
		const result=inspect_save_rollback(db,101);
		expect(result.terminal_snapshots.map((row:any)=>row.row_id).sort()).toEqual([901,902,903,904,905,906,909,910]);
		expect(result.derived_sources.map((row:any)=>row.root_key)).toEqual(['child']);
	} finally {db.close();}
});

test('repeat counts exclude newly observed before-cutoff, uncertain and unproven candidates',()=>{
	const db=fixture();try {
		db.query("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(9,'Counts','rollback-counts',1)").run();
		db.query('UPDATE clients SET melvor_account_id=9 WHERE id=101').run();
		const old=load(db,10,100);clock(db,old,100);
		operation(db,old,200,'affected');
		clock(db,load(db,150,300),300);
		// Late observations are frozen out of the earlier incident. Their times are
		// before/inside the next save interval; missing load provenance also stays review-only.
		operation(db,old,155,'before');operation(db,old,170,'uncertain');operation(db,null,210,'unproven');
		const restored=record_character_save_load(db,101,{load_id:crypto.randomUUID(),save_timestamp:150,client_loaded_at:360,capture_source:'decode'},400,device)!;
		expect(record_load_clock(db,101,restored,{server_admitted_at:400,client_sent_at:370,client_received_at:390,elapsed_ms:20},410)).toBe(true);
		for(const incident of inspect_save_rollback(db,101).incidents)
			db.query("INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at) VALUES(?,'confirmed','Reviewed',500)").run(incident.id);
		const summary=inspect_save_rollback(db,101);
		expect(summary.counts).toEqual([expect.objectContaining({state:'confirmed',occurrences:1})]);
		expect(summary.account_rollup).toEqual([{client_id:101,state:'confirmed',occurrences:1}]);
		expect(summary.assessments.map((row:any)=>row.classification).sort()).toEqual(['after_cutoff','after_cutoff','before_cutoff','review_only','uncertain']);
	} finally {db.close();}
});
