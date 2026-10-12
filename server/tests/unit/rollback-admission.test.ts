import { expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_test_database } from '../support/database';
import { record_character_save_load } from '../../character-save-loads';
import { record_load_clock,record_economy_operation } from '../../save-rollback';
import { make_audit_context,run_with_audit_context,instrument_audited_database,install_database_write_guard } from '../../audit-context';
import { create_custody_source } from '../../economy-custody';
import { rollback_admission_revision,rollback_policy,set_rollback_policy,set_rollback_hold,rollback_held,rollback_player_status,acknowledge_rollback_notice } from '../../rollback-policy';
import { admit_rollback_load,evaluate_rollback_admission,decide_rollback_incident } from '../../rollback-admission';
import { guard_rollback_write,related_rollback_gate,rollback_request_clients } from '../../rollback-gate';
import { release_rollback_benefit } from '../../rollback-benefits';
const device='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
function fixture(filename?:string) {
 const db=create_test_database(filename);
 for(const id of [101,102]) {
  db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)').run(id,`admission-${id}`,'key',`111-222-${id}`,'Admission Test','melvorD:Plant');
  db.query('INSERT INTO client_sessions(session_token,client_id,rollback_capable) VALUES(?,?,1)').run(`session-${id}`,id);
 }
 return db;
}
function load(db:Database,save:number,time:number) {return record_character_save_load(db,101,{load_id:crypto.randomUUID(),save_timestamp:save,client_loaded_at:time-20,capture_source:'decode'},time,device)!;}
function clock(db:Database,id:number,time:number) {expect(record_load_clock(db,101,id,{server_admitted_at:time,client_sent_at:time-10,client_received_at:time+10,elapsed_ms:20},time+20)).toBe(true);}
function enable(db:Database) {return set_rollback_policy(db,crypto.randomUUID(),0,{enabled:true,first_operation_id:1,policy_version:1,client_ids:[101]},'Isolated fixture opt-in',true);}
function outgoing(db:Database,old:number,key='outgoing') {
 return run_with_audit_context(make_audit_context({event_type:'test',actor_kind:'client',actor_client_id:101,actor_display_name:null,save_load_id:old}),()=>record_economy_operation(db,{source_key:key,client_id:101,kind:'test',committed_at:200,local_effect:'outgoing',evidence:{}}));
}

test('policy defaults off, activation is prospective and explicit, commands guard revision and identity',()=>{
 const db=fixture();try {
  expect(rollback_policy(db).config.enabled).toBe(false);
  const old=load(db,10,100);admit_rollback_load(db,101,old,true,100);expect(rollback_held(db,101)).toBe(false);
  const config={enabled:true,first_operation_id:1,policy_version:1,client_ids:[101]};
  expect(()=>set_rollback_policy(db,crypto.randomUUID(),0,config,'No implicit activation')).toThrow('Explicit activation');
  db.query('UPDATE client_sessions SET rollback_capable=0 WHERE client_id=101').run();
  expect(()=>enable(db)).toThrow('capable');db.query('UPDATE client_sessions SET rollback_capable=1 WHERE client_id=101').run();
  const id=crypto.randomUUID();const result=set_rollback_policy(db,id,0,config,'Fixture activation',true);
  expect(set_rollback_policy(db,id,0,config,'Fixture activation',true)).toEqual(result);
  expect(()=>set_rollback_policy(db,id,0,config,'Different reason',true)).toThrow('reused');
  expect(()=>set_rollback_policy(db,crypto.randomUUID(),0,{...config,enabled:false},'Stale')).toThrow('revision');
  outgoing(db,old);expect(()=>set_rollback_policy(db,crypto.randomUUID(),result.revision,config,'Retrospective activation',true)).toThrow('prospective');
 } finally {db.close();}
});

test('new admission gates every session until frozen calibrated classification; whole incident rolls back on failure',()=>{
 const db=fixture();try {
  enable(db);const old=load(db,10,100);clock(db,old,100);const operation=outgoing(db,old);
  create_custody_source(db,{root_key:'root',operation_key:'outgoing',client_id:101,object_id:'melvorD:Logs',quantity:4,created_at:200,snapshot:{}},'consumed:valid');
  const restored=load(db,150,300);admit_rollback_load(db,101,restored,true,300);
  expect(rollback_held(db,101)).toBe(true);expect(rollback_held(db,102)).toBe(false);
  outgoing(db,restored,'later-own-load');clock(db,restored,300);
  db.run("CREATE TRIGGER fail_correction BEFORE INSERT ON economy_corrections BEGIN SELECT RAISE(ABORT,'Injected crash'); END");
  expect(()=>evaluate_rollback_admission(db,101,restored,true,330)).toThrow('Injected crash');
  expect(db.query("SELECT 1 FROM economy_incident_decisions WHERE state='confirmed'").all()).toEqual([]);
  expect(db.query('SELECT * FROM economy_player_notices').all()).toEqual([]);
  db.run('DROP TRIGGER fail_correction');expect(evaluate_rollback_admission(db,101,restored,true,340)).toEqual(['outgoing']);
  expect(rollback_held(db,101)).toBe(false);expect(evaluate_rollback_admission(db,101,restored,true,350)).toEqual([]);
  expect(db.query('SELECT operation_id FROM economy_corrections').all()).toEqual([{operation_id:operation}]);
  const status=rollback_player_status(db,101,restored,true);expect(status.notice?.kind).toBe('older_save');
  expect(JSON.stringify(status)).not.toContain('Logs');expect(JSON.stringify(status)).not.toContain('quantity');
  expect(acknowledge_rollback_notice(db,102,status.notice!.notice_id)).toBe(false);
  expect(acknowledge_rollback_notice(db,101,status.notice!.notice_id)).toBe(true);
  expect(acknowledge_rollback_notice(db,101,status.notice!.notice_id)).toBe(true);
  expect(rollback_player_status(db,101,restored,true).notice).toBeNull();
  expect(db.query("SELECT state FROM economy_incident_decisions ORDER BY id DESC LIMIT 1").get()).toEqual({state:'confirmed'});
 } finally {db.close();}
});

test('manual holds survive disable/restart and write guard closes asynchronous preflight race',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'rollback-hold-'));const filename=join(directory,'db.sqlite');let db=fixture(filename);
 try {
  db.run('PRAGMA journal_mode=WAL');install_database_write_guard(guard_rollback_write);const guarded=instrument_audited_database(db);
  const context=make_audit_context({event_type:'test',actor_kind:'client',actor_client_id:101,actor_display_name:null,details:{path:'/api/market/sell',method:'POST',rollback_capable:true}});
  await run_with_audit_context(context,async()=>{
   expect(rollback_held(db,101)).toBe(false);await Promise.resolve();
   const other=new Database(filename,{strict:true});set_rollback_hold(other,crypto.randomUUID(),101,0,true,'Concurrent operator hold');other.close();
   expect(()=>guarded.query('UPDATE clients SET display_name=display_name WHERE id=101').run()).toThrow('Economy review pending');
  });
  db.close();db=new Database(filename,{strict:true});expect(rollback_held(db,101)).toBe(true);
  const held=db.query<{id:number},[]>('SELECT id FROM economy_client_holds ORDER BY id DESC LIMIT 1').get()!;
  set_rollback_hold(db,crypto.randomUUID(),101,held.id,false,'Reviewed release',0);expect(rollback_held(db,101)).toBe(false);
  for(const table of ['economy_client_holds','economy_operator_commands']) expect(()=>db.run(`DELETE FROM ${table}`)).toThrow('immutable');
 } finally {install_database_write_guard(undefined);db.close();rmSync(directory,{recursive:true,force:true});}
});

test('unsupported admissions retain review evidence and require capability without a review hold',()=>{
 const db=fixture();try {
  enable(db);const old=load(db,10,100);outgoing(db,old);
  const restored=load(db,150,300);admit_rollback_load(db,101,restored,false,300);
  expect(rollback_held(db,101)).toBe(true); // Missing original calibration is still a recovery gate.
  clock(db,restored,300);
  expect(evaluate_rollback_admission(db,101,restored,false,330)).toEqual([]);expect(rollback_held(db,101)).toBe(false);
  expect(rollback_player_status(db,101,restored,false).upgrade_required).toBe(true);
  const incident=db.query<{incident_id:number;id:number},[]>('SELECT id,incident_id FROM economy_incident_decisions ORDER BY id DESC LIMIT 1').get()!;
  decide_rollback_incident(db,crypto.randomUUID(),incident.incident_id,incident.id,'dismissed','Insufficient evidence');
  expect(rollback_held(db,101)).toBe(false);expect(db.query('SELECT * FROM economy_corrections').all()).toEqual([]);
 } finally {db.close();}
});

test('exact held actor benefit releases once to canonical Inbox; synthetic units stay gated',()=>{
 const db=fixture();try {
  for(const [root,kind,item] of [['benefit','trade','melvorD:Logs'],['ep','ep','multiplayer:ExpeditionPointsMicros']])
   create_custody_source(db,{root_key:root!,operation_key:'source',client_id:101,object_id:item!,quantity:3,created_at:100,snapshot:{benefit_kind:kind,parent_roots:['parent']}},'held');
  const id=crypto.randomUUID();const released=release_rollback_benefit(db,id,'benefit',3,'Exact entitlement reviewed');
  expect(release_rollback_benefit(db,id,'benefit',3,'Exact entitlement reviewed')).toEqual(released);
  expect(()=>release_rollback_benefit(db,crypto.randomUUID(),'benefit',3,'Duplicate')).toThrow('already released');
  expect(db.query('SELECT item_id,qty FROM inbox_items WHERE client_id=101').all()).toEqual([{item_id:'melvorD:Logs',qty:3}]);
  expect(()=>release_rollback_benefit(db,crypto.randomUUID(),'ep',3,'Unsupported')).toThrow('Domain-specific release gate');
  expect(db.query("SELECT quantity FROM economy_custody_balances WHERE root_key='ep' AND location='held'").get()).toEqual({quantity:3});
 } finally {db.close();}
});

test('capability remains session-specific through cache eviction and fresh runtime processes',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'rollback-capability-'));const filename=join(directory,'db.sqlite');const db=fixture(filename);db.close();
 try {
  const code=`const r=await import('./app-runtime');const d=await import('./db');
   const first=await r.get_client_session('session-101');r.client_session_cache.delete('session-101');
   const reloaded=await r.get_client_session('session-101');
   console.log(JSON.stringify([first?.rollback_capable,reloaded?.rollback_capable]));d.db.close();process.exit(0);`;
  for(let run=0;run<2;run++) {
   const child=Bun.spawn({cmd:[process.execPath,'-e',code],cwd:join(import.meta.dir,'../..'),env:{...Bun.env,DB_PATH:filename},stdout:'pipe',stderr:'pipe'});
   const [exit,stdout,stderr]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
   expect(exit,stderr).toBe(0);expect(JSON.parse(stdout.trim().split('\n').at(-1)!)).toEqual([true,true]);
  }
 } finally {rmSync(directory,{recursive:true,force:true});}
});

test('unacknowledged notices, control history and correction evidence survive identity deletion and database reopen',()=>{
 const directory=mkdtempSync(join(tmpdir(),'rollback-notice-'));const filename=join(directory,'db.sqlite');let db=fixture(filename);
 try {
  enable(db);const old=load(db,10,100);clock(db,old,100);outgoing(db,old);
  create_custody_source(db,{root_key:'root',operation_key:'outgoing',client_id:101,object_id:'melvorD:Logs',quantity:1,created_at:200,snapshot:{}},'protected:accepted');
  const restored=load(db,150,300);admit_rollback_load(db,101,restored,true,300);clock(db,restored,300);evaluate_rollback_admission(db,101,restored,true,330);
  const notice=rollback_player_status(db,101,restored,true).notice;expect(notice).not.toBeNull();
  db.query('DELETE FROM clients WHERE id=101').run();db.close();db=new Database(filename,{strict:true});
  expect(rollback_player_status(db,101,null,true).notice).toEqual(notice);
  expect(db.query('SELECT disposition FROM economy_corrections').all()).toEqual([{disposition:'protected'}]);
  expect(db.query('SELECT COUNT(*) n FROM economy_policy_changes').get()).toEqual({n:1});
  expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  expect(acknowledge_rollback_notice(db,101,notice!.notice_id)).toBe(true);
  db.close();db=new Database(filename,{strict:true});expect(rollback_player_status(db,101,null,true).notice).toBeNull();
 } finally {db.close();rmSync(directory,{recursive:true,force:true});}
});

test('release guards every admission append and replays only an identical successful command; unknown holds are refused',()=>{
 const db=fixture();try {
  enable(db);
  expect(()=>set_rollback_hold(db,crypto.randomUUID(),999,0,true,'Unknown future identity')).toThrow('Known');
  const retained=set_rollback_hold(db,crypto.randomUUID(),102,0,true,'Known identity review');
  db.run('DELETE FROM clients WHERE id=102');
  expect(set_rollback_hold(db,crypto.randomUUID(),102,retained.revision,false,'Retained review release',0).held).toBe(false);
  const first=load(db,10,100);admit_rollback_load(db,101,first,true,100);
  const revision=rollback_admission_revision(db,101);
  const next=load(db,10,200);admit_rollback_load(db,101,next,true,200);
  const before=db.query('SELECT * FROM economy_client_holds').all();
  expect(()=>set_rollback_hold(db,crypto.randomUUID(),101,0,false,'Stale inspected admission',revision)).toThrow('Admission revision');
  expect(db.query('SELECT * FROM economy_client_holds').all()).toEqual(before);
  const inspected=rollback_admission_revision(db,101);
  clock(db,next,200);evaluate_rollback_admission(db,101,next,true,240);
  expect(()=>set_rollback_hold(db,crypto.randomUUID(),101,0,false,'Stale reevaluation',inspected)).toThrow('Admission revision');
  const id=crypto.randomUUID(),latest=rollback_admission_revision(db,101);
  const released=set_rollback_hold(db,id,101,0,false,'Reviewed all admissions',latest);
  const new_load=load(db,10,300);admit_rollback_load(db,101,new_load,true,300);
  expect(set_rollback_hold(db,id,101,0,false,'Reviewed all admissions',latest)).toEqual(released);
  expect(rollback_held(db,101)).toBe(true);
 } finally {db.close();}
});

test('Wish and Clear holds consult only account siblings sharing the current Guild',()=>{
 const db=fixture();try {
  db.run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(901,'Scope','scope',1)");
  db.run('UPDATE clients SET melvor_account_id=901 WHERE id IN (101,102)');
  db.run("INSERT INTO guilds(id,name,icon_id) VALUES(901,'Same Guild','melvorD:Plant'),(902,'Other Guild','melvorD:Plant')");
  db.run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(101,901),(102,902)');
  set_rollback_hold(db,crypto.randomUUID(),102,0,true,'Other character review');
  for(const path of ['/api/crucible/wish/make','/api/crucible/clear']) {
   expect(related_rollback_gate(db,rollback_request_clients(db,path,{},101),101,true)).toBeNull();
   db.run('UPDATE guild_memberships SET guild_id=901 WHERE client_id=102');
   expect(related_rollback_gate(db,rollback_request_clients(db,path,{},101),101,true)?.message).toBe('Economy review pending');
   db.run('UPDATE guild_memberships SET guild_id=902 WHERE client_id=102');
  }
 } finally {db.close();}
});

test('unresolved correction review permits new actions on the same and later loads without releasing marked value',()=>{
 const db=fixture();try {
  enable(db);const old=load(db,10,100);clock(db,old,100);
  const command=crypto.randomUUID(),key=`receipt:${command}`;outgoing(db,old,key);
  create_custody_source(db,{root_key:'review-root',operation_key:key,client_id:101,object_id:'melvorD:Logs',quantity:4,created_at:200,snapshot:{}},'unresolved:fixture');
  const restored=load(db,150,300);admit_rollback_load(db,101,restored,true,300);
  expect(related_rollback_gate(db,[101],101,true)).not.toBeNull();
  clock(db,restored,300);evaluate_rollback_admission(db,101,restored,true,330);
  const evidence=db.query('SELECT * FROM economy_corrections').all();
  expect(evidence.length).toBe(1);
  expect(db.query('SELECT state FROM economy_admissions WHERE save_load_id=? ORDER BY id DESC LIMIT 1').get(restored)).toEqual({state:'review'});
  for(const current of [restored,load(db,350,400)]) {
   if(current!==restored) {admit_rollback_load(db,101,current,true,400);clock(db,current,400);evaluate_rollback_admission(db,101,current,true,430);}
   const status=rollback_player_status(db,101,current,true);
   expect(status.admission).toBe('ready');expect(status.economy_review_pending).toBe(false);
   expect(status.retired_command_ids).toContain(command);
   expect(related_rollback_gate(db,[101],101,true)).toBeNull();
   expect(related_rollback_gate(db,[102,101],102,true)).toBeNull();
   guard_rollback_write(db,make_audit_context({event_type:'test',actor_kind:'client',actor_client_id:101,actor_display_name:null,details:{path:'/api/crucible/clear',method:'POST',rollback_capable:true}}));
  }
  expect(db.query('SELECT * FROM economy_corrections').all()).toEqual(evidence);
  expect(db.query("SELECT location,quantity FROM economy_custody_balances WHERE root_key='review-root'").all()).toEqual([{location:'unresolved:fixture',quantity:4}]);
  expect(rollback_player_status(db,101,restored,false).upgrade_required).toBe(true);
  set_rollback_hold(db,crypto.randomUUID(),101,0,true,'Explicit hold still applies');
  expect(rollback_player_status(db,101,restored,true).economy_review_pending).toBe(true);
  expect(related_rollback_gate(db,[101],101,true)).not.toBeNull();
 } finally {db.close();}
});
