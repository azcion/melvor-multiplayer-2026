import {expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {register_guild_client} from './fixtures';
import {post_json,get_json_with_session} from './http';
import {db_all} from './persistence';
import {rollback_policy,set_rollback_policy} from '../../rollback-policy';
export type RollbackRestartState={client_id:number;session_token:string;command_id:string;notice_id:string;claim: {claim_id:string;items:unknown[]}};
export async function setup_rollback_restart():Promise<RollbackRestartState> {
 const actor=await register_guild_client('Restart Rollback','Restart Rollback','1.6.14');
 const device=crypto.randomUUID();
 const authenticate=async()=>{
  const sent=Date.now(),started=performance.now();
  const result=await post_json<any>('/api/authenticate',{client_identifier:actor.client_identifier,client_key:actor.client_key,
   client_runtime:{mod_version:'1.6.14',active_mods:[],capabilities:['save-rollback-v1'],device:{installation_id:device},
    loaded_save:{load_id:crypto.randomUUID(),save_timestamp:Date.now()-60000,client_loaded_at:Date.now()-1,capture_source:'decode'}}});
  expect(result.response.status).toBe(200);
  return {token:result.json.session_token,sample:{...result.json.rollback_clock_sample,client_sent_at:sent,client_received_at:Date.now(),elapsed_ms:Math.round(performance.now()-started)}};
 };
 const first=await authenticate();expect((await post_json('/api/save-load/clock',first.sample,first.token)).response.status).toBe(200);
 const db=new Database(process.env.TEST_DB_PATH!,{strict:true});db.run('PRAGMA busy_timeout=5000');
 const policy=(enabled:boolean)=>{const previous=rollback_policy(db);
  const frontier=db.query<{id:number},[]>('SELECT COALESCE(MAX(id),0)+1 id FROM economy_operations').get()!.id;
  set_rollback_policy(db,crypto.randomUUID(),previous.revision,{enabled,first_operation_id:frontier,policy_version:1,client_ids:[actor.client_id]},'Isolated restart fixture',enabled);};
 policy(true);
 try {
  const command_id=crypto.randomUUID();
  expect((await post_json<any>('/api/crucible/cast',{command_id,source:'bank',items:[{id:'melvorD:Logs',qty:4}]},first.token)).json.success).toBe(true);
  db.run("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty,created_at,updated_at) VALUES(?,'gift','Restart protected delivery','melvorD:Coal_Ore',1,?,?)",[actor.client_id,Date.now(),Date.now()]);
  const claim=(await post_json<any>('/api/inbox/claim',{existing_item_ids:['melvorD:Coal_Ore'],available_slots:0},first.token)).json.claim;
  const restored=await authenticate();
  const calibrated=await post_json<any>('/api/save-load/clock',restored.sample,restored.token);
  expect(calibrated.json.rollback.admission).toBe('ready');expect(calibrated.json.rollback.retired_command_ids).toContain(command_id);
  return {client_id:actor.client_id,session_token:restored.token,command_id,notice_id:calibrated.json.rollback.notice.notice_id,claim};
 } finally {policy(false);db.close();}
}
export async function verify_rollback_restart(state:RollbackRestartState) {
 const db=new Database(process.env.TEST_DB_PATH!,{readonly:true,strict:true});
 try {
  expect(db.query<{rollback_capable:number},[string]>('SELECT rollback_capable FROM client_sessions WHERE session_token=?').get(state.session_token)?.rollback_capable).toBe(1);
 } finally {db.close();}
 const status=(await get_json_with_session<any>('/api/save-rollback/status',state.session_token)).json;
 expect(status.admission).toBe('ready');expect(status.upgrade_required).toBe(false);expect(status.retired_command_ids).toContain(state.command_id);expect(status.notice.notice_id).toBe(state.notice_id);
 const replay=await post_json<any>('/api/crucible/cast',{command_id:state.command_id,source:'bank',items:[{id:'melvorD:Logs',qty:4}]},state.session_token);
 expect(replay.json.error).toBe('economy_command_retired');expect(replay.json.receipt).toBeNull();
 const claim=await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:0},state.session_token);expect(claim.json.claim).toEqual(state.claim);
 expect((await post_json<any>('/api/inbox/acknowledge',{claim_id:state.claim.claim_id},state.session_token)).json.success).toBe(true);
 const decisions=()=>db_all('SELECT d.* FROM economy_incident_decisions d JOIN economy_incidents i ON i.id=d.incident_id JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.client_id=? ORDER BY d.id',[state.client_id]);
 const before_ack=await decisions();expect(before_ack.some(row=>row.state==='confirmed')).toBe(true);
 for(let retry=0;retry<2;retry++) expect((await post_json<any>('/api/save-rollback/notice/acknowledge',{notice_id:state.notice_id},state.session_token)).json.success).toBe(true);
 expect((await get_json_with_session<any>('/api/save-rollback/status',state.session_token)).json.notice).toBeNull();
 expect(await decisions()).toEqual(before_ack);
}
