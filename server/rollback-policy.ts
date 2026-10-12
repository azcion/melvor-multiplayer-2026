import type { Database } from 'bun:sqlite';

export type RollbackPolicy = { enabled:boolean; first_operation_id:number|null; policy_version:number; client_ids:number[] };
export const DEFAULT_ROLLBACK_POLICY: RollbackPolicy = {enabled:false,first_operation_id:null,policy_version:1,client_ids:[]};
export function rollback_policy(database:Database): {revision:number;config:RollbackPolicy} {
 const row=database.query<{id:number;config_json:string},[]>('SELECT id,config_json FROM economy_policy_changes ORDER BY id DESC LIMIT 1').get();
 return row ? {revision:row.id,config:JSON.parse(row.config_json)} : {revision:0,config:{...DEFAULT_ROLLBACK_POLICY,client_ids:[]}};
}
// Only explicit holds and unfinished calibration suspend character-wide economy actions.
export function rollback_held(database:Database,client:number): boolean {
 const manual=database.query<{held:number},[number]>('SELECT held FROM economy_client_holds WHERE client_id=? ORDER BY id DESC LIMIT 1').get(client);
 return manual?.held===1 || database.query(`SELECT 1 FROM economy_admissions a JOIN economy_load_observations l ON l.id=a.save_load_id
  WHERE l.client_id=? AND (a.state='waiting' OR (a.state='review' AND NOT EXISTS(SELECT 1 FROM economy_clock_evidence e WHERE e.save_load_id=a.save_load_id)))
  AND NOT EXISTS(SELECT 1 FROM economy_admissions newer WHERE newer.save_load_id=a.save_load_id AND newer.id>a.id) LIMIT 1`).get(client)!==null;
}
export function rollback_affected(database:Database,client:number):boolean {
 // Review evidence still requires a capable recovery client, but is not an economy hold.
 return rollback_held(database,client) || database.query(`SELECT 1 FROM economy_admissions a JOIN economy_load_observations l ON l.id=a.save_load_id
  WHERE l.client_id=? AND a.state='review' AND NOT EXISTS(SELECT 1 FROM economy_admissions newer WHERE newer.save_load_id=a.save_load_id AND newer.id>a.id) LIMIT 1`).get(client)!==null || database.query(`SELECT 1 FROM economy_corrections c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=? LIMIT 1`).get(client)!==null;
}
export function rollback_admission_state(database:Database,client:number,load:number|null):string {
 const state=load===null?null:database.query<{state:string},[number]>('SELECT state FROM economy_admissions WHERE save_load_id=? ORDER BY id DESC LIMIT 1').get(load)?.state;
 if(state==='waiting') return 'waiting';
 if(rollback_held(database,client)) return 'review';
 // The wire admission controls recovery in existing clients. Private review findings
 // remain in the append-only ledger; they must not suspend ordinary economy actions.
 return state==='review'?'ready':state??'ready';
}
export function pending_rollback_notice(database:Database,client:number) {
 const row=database.query<{notice_id:string},[number]>(`SELECT n.notice_id FROM economy_player_notices n WHERE n.client_id=?
  AND NOT EXISTS(SELECT 1 FROM economy_notice_acknowledgements a WHERE a.notice_id=n.notice_id) ORDER BY n.created_at,n.notice_id LIMIT 1`).get(client);
 return row ? {notice_id:row.notice_id,kind:'older_save' as const} : null;
}
export function acknowledge_rollback_notice(database:Database,client:number,id:unknown,now=Date.now()):boolean {
 if(typeof id!=='string') return false;
 return database.transaction(()=>{
  if(!database.query('SELECT 1 FROM economy_player_notices WHERE notice_id=? AND client_id=?').get(id,client)) return false;
  const acknowledged=database.query('INSERT INTO economy_notice_acknowledgements VALUES(?,?,?) ON CONFLICT DO NOTHING').run(id,client,now);
  if(acknowledged.changes>0) database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
  return true;
 }).immediate();
}
export function rollback_player_status(database:Database,client:number,load:number|null,capable:boolean) {
 return {protocol:'save-rollback-v1',admission:rollback_admission_state(database,client,load),
  economy_review_pending:rollback_held(database,client),upgrade_required:!capable&&rollback_affected(database,client),
  notice:capable?pending_rollback_notice(database,client):null,
  retired_command_ids:capable?database.query<{id:string},[number]>(`SELECT DISTINCT substr(o.source_key,9) id FROM economy_operations o JOIN economy_corrections c ON c.operation_id=o.id
   WHERE o.client_id=? AND o.local_effect='outgoing' AND o.source_key LIKE 'receipt:%' ORDER BY o.id DESC LIMIT 64`).all(client).map(row=>row.id):[]};
}

/** Host-only idempotency, reason and optimistic-state checks share each mutation's transaction. */
export function rollback_operator_command<T>(database:Database,id:string,request:unknown,reason:string,work:()=>T):T {
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || typeof reason!=='string' || !reason.trim() || reason.length>1000)
  throw new Error('A UUID command ID and nonempty reason (maximum 1000 characters) are required');
 const fingerprint=JSON.stringify({request,reason});
 return database.transaction(()=>{
  const old=database.query<{request_json:string;result_json:string},[string]>('SELECT request_json,result_json FROM economy_operator_commands WHERE command_id=?').get(id);
  if(old) {if(old.request_json!==fingerprint) throw new Error('Operator command ID reused');return JSON.parse(old.result_json) as T;}
  const result=work();
  database.query('INSERT INTO economy_operator_commands VALUES(?,?,?,?)').run(id,fingerprint,JSON.stringify(result),Date.now());
  return result;
 }).immediate();
}
export function preview_rollback_policy(database:Database,config:RollbackPolicy) {
 if(typeof config.enabled!=='boolean' || config.policy_version!==1 || !Array.isArray(config.client_ids) || config.client_ids.length>512 ||
  config.client_ids.some(id=>!Number.isSafeInteger(id)||id<1) || new Set(config.client_ids).size!==config.client_ids.length ||
  (config.first_operation_id!==null&&(!Number.isSafeInteger(config.first_operation_id)||config.first_operation_id<1))) throw new Error('Invalid rollback policy');
 const next=database.query<{id:number},[]>('SELECT COALESCE(MAX(id),0)+1 id FROM economy_operations').get()!.id;
 const clients=config.client_ids.map(id=>({client_id:id,ready:database.query(`SELECT 1 FROM clients c WHERE c.id=? AND c.disabled=0 AND c.deleted_at IS NULL
  AND EXISTS(SELECT 1 FROM client_sessions s WHERE s.client_id=c.id AND s.rollback_capable=1)
  AND NOT EXISTS(SELECT 1 FROM client_sessions s WHERE s.client_id=c.id AND s.rollback_capable=0)`).get(id)!==null}));
 return {next_operation_id:next,clients,activation_ready:config.client_ids.length>0 && clients.every(c=>c.ready)&&config.first_operation_id!==null&&config.first_operation_id>=next};
}
export function set_rollback_policy(database:Database,id:string,expected:number,config:RollbackPolicy,reason:string,activate=false) {
 return rollback_operator_command(database,id,{kind:'policy',expected,config,activate},reason,()=>{
  if(rollback_policy(database).revision!==expected) throw new Error('Policy revision changed');
  const preview=preview_rollback_policy(database,config);
  if(config.enabled&&(!activate||!preview.activation_ready)) throw new Error('Explicit activation requires a prospective frontier and capable opted-in Clients');
  if(activate&&!config.enabled) throw new Error('Activation requires enabled policy');
  const row=database.query<{id:number},[string,string,number]>('INSERT INTO economy_policy_changes(config_json,reason,created_at) VALUES(?,?,?) RETURNING id').get(JSON.stringify(config),reason,Date.now())!;
  return {revision:row.id,config};
 });
}
export function rollback_admission_revision(database:Database,client:number):number {
 return database.query<{id:number},[number]>(`SELECT COALESCE(MAX(a.id),0) id FROM economy_admissions a
  JOIN economy_load_observations l ON l.id=a.save_load_id WHERE l.client_id=?`).get(client)!.id;
}
export function set_rollback_hold(database:Database,id:string,client:number,expected:number,held:boolean,reason:string,expected_admission?:number) {
 return rollback_operator_command(database,id,{kind:'hold',client,expected,held,expected_admission},reason,()=>{
  if(!Number.isSafeInteger(client)||client<1) throw new Error('Invalid Client');
  if(!database.query(`SELECT 1 FROM clients WHERE id=? UNION ALL SELECT 1 FROM economy_load_observations WHERE client_id=?
   UNION ALL SELECT 1 FROM economy_operations WHERE client_id=?
   UNION ALL SELECT 1 FROM economy_client_holds WHERE client_id=? LIMIT 1`).get(client,client,client,client)) throw new Error('Known live or retained Client required');
  if(!held && (!Number.isSafeInteger(expected_admission)||expected_admission!==rollback_admission_revision(database,client)))
   throw new Error('Admission revision changed or missing');
  const current=database.query<{id:number},[number]>('SELECT id FROM economy_client_holds WHERE client_id=? ORDER BY id DESC LIMIT 1').get(client)?.id??0;
  if(current!==expected) throw new Error('Hold revision changed');
  const row=database.query<{id:number},[number,number,string,number]>('INSERT INTO economy_client_holds(client_id,held,reason,created_at) VALUES(?,?,?,?) RETURNING id').get(client,Number(held),reason,Date.now())!;
  if(!held) for(const admission of database.query<{save_load_id:number;policy_id:number},[number]>(`SELECT a.* FROM economy_admissions a JOIN economy_load_observations l ON l.id=a.save_load_id
   WHERE l.client_id=? AND a.state IN ('waiting','review') AND NOT EXISTS(SELECT 1 FROM economy_admissions n WHERE n.save_load_id=a.save_load_id AND n.id>a.id)`).all(client))
   database.query('INSERT INTO economy_admissions(save_load_id,policy_id,state,reason,created_at) VALUES(?,?,\'released\',?,?)').run(admission.save_load_id,admission.policy_id,reason,Date.now());
  database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
  return {revision:row.id,held};
 });
}
