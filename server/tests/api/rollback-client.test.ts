import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {create_rollback_client,create_handshake_timer} from '../../../mod/save-rollback.mjs';
import {create_economy_command_journal} from '../../../mod/economy-command-journal.mjs';
import {apply_inbox_claim} from '../../../mod/inbox-delivery.mjs';
import {register_guild_client} from '../support/fixtures';
import {post_json,get_json_with_session,post} from '../support/http';
import {rollback_policy,set_rollback_policy} from '../../rollback-policy';

test('real API and client modules calibrate opt-in restores, retire exact commands, deliver generic notices and preserve incoming recovery',async()=>{
 const actor=await register_guild_client('Client Integration','Client Integration','1.6.10');
 const device=crypto.randomUUID(),storage=new Map<string,any>();
 let bank=20,retired=0;
 const loaded=()=>({load_id:crypto.randomUUID(),save_timestamp:Date.now()-60000,client_loaded_at:Date.now()-1,capture_source:'decode'});
 const authenticate=async(report:any)=>{
  // Same timer module used at actual fetch dispatch by main, independent of connection preparation.
  const timer=create_handshake_timer((url:any,options:any)=>fetch(url,options));
  const response=await timer.fetch(`${process.env.TEST_SERVER_URL}/api/v2/authenticate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
   client_identifier:actor.client_identifier,client_key:actor.client_key,cloud_username:`rollback-${device}`,playfab_id:device,
   client_runtime:{mod_version:'1.6.10',capabilities:['save-rollback-v1'],active_mods:[],device:{installation_id:device},loaded_save:report}})});
  expect(response.status).toBe(200);return {response:await response.json() as any,timing:{...timer.snapshot(),origin:'fixture',generation:1,load_id:report.load_id}};
 };
 const create=(auth:any,notice_queue:any[])=>{
  let client:any;
  client=create_rollback_client({supported:true,origin:'fixture',client_id:actor.client_id,load_id:auth.response.rollback_clock_sample.load_id,handshake_generation:1,current:()=>true,
   read:(key:any)=>storage.get(key),write:(key:any,value:any)=>storage.set(key,structuredClone(value)),
   post:async(endpoint:any,payload:any)=>endpoint===null?(await get_json_with_session<any>('/api/save-rollback/status',auth.response.session_token)).json:post_json<any>(endpoint,payload,auth.response.session_token),
   retire:()=>{retired++;},ui_ready:()=>true,queue:(options:any)=>notice_queue.push(options),close:()=>{},text:(key:any)=>key});return client;
 };
 const original=await authenticate(loaded());expect(original.response.rollback_clock_sample.original_handshake).toBe(true);
 const initial=create(original,[]);await initial.bootstrap(original.response,original.timing);
 const db=new Database(process.env.TEST_DB_PATH!,{strict:true});db.run('PRAGMA busy_timeout=5000');
 const configure=(enabled:boolean)=>{const previous=rollback_policy(db);const frontier=db.query<{id:number},[]>('SELECT COALESCE(MAX(id),0)+1 id FROM economy_operations').get()!.id;
  set_rollback_policy(db,crypto.randomUUID(),previous.revision,{enabled,first_operation_id:frontier,policy_version:1,client_ids:[actor.client_id]},'Client integration fixture',enabled);};
 configure(true);
 try {
  const command=crypto.randomUUID(),payload={command_id:command,source:'bank',items:[{id:'melvorD:Logs',qty:4}]};
  const outgoing=await post_json<any>('/api/crucible/cast',payload,original.response.session_token);expect(outgoing.json.success).toBe(true);
  storage.set('journal',{endpoint:'/api/crucible/cast',payload,major:2}); // Restored local Bank never applied this response.
  // Clear correction retains currency-lock evidence for review. It must not suspend the player.
  const clear_payload={command_id:crypto.randomUUID(),currency_id:'melvorD:GP',balance:1000000};
  expect((await post_json<any>('/api/crucible/clear',clear_payload,original.response.session_token)).json.success).toBe(true);
  const restored=await authenticate(loaded());expect(restored.response.rollback.admission).toBe('waiting');
  const queued:any[]=[];const client=create(restored,queued);let sends=0;
  const journal=create_economy_command_journal({read:()=>storage.get('journal'),write:(value:any)=>storage.set('journal',value),remove:()=>storage.delete('journal'),
   current:()=>true,can_submit:()=>client.admitted(),can_recover:()=>client.admitted(),is_retired:(id:any)=>client.is_retired(id),
   send:async(endpoint:any,body:any)=>{sends++;return post_json<any>(endpoint,body,restored.response.session_token);},reconcile:async()=>{throw Error('Retirement cannot reconcile value');}});
  expect(await journal.recover()).toBe(false);expect(sends).toBe(0);
  await client.bootstrap(restored.response,restored.timing);expect(client.admitted()).toBe(true);expect(retired).toBeGreaterThan(0);
  expect(db.query('SELECT state FROM economy_admissions a JOIN economy_load_observations l ON l.id=a.save_load_id WHERE l.client_id=? ORDER BY a.id DESC LIMIT 1').get(actor.client_id)).toEqual({state:'review'});
  const correction_count=db.query<{n:number},[number]>('SELECT COUNT(*) n FROM economy_corrections c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=?').get(actor.client_id)!.n;
  expect(correction_count).toBeGreaterThan(0);
  const old_clear=await post_json<any>('/api/crucible/clear',clear_payload,restored.response.session_token);
  expect(old_clear.json.error).toBe('economy_command_retired');expect(old_clear.json.receipt).toBeNull();
  const fresh_clear=await post_json<any>('/api/crucible/clear',{...clear_payload,command_id:crypto.randomUUID()},restored.response.session_token);
  expect(fresh_clear.response.status).toBe(200);expect(fresh_clear.json.success).toBe(true);
  expect((await post('/api/economy/receipts/acknowledge',{receipt_id:fresh_clear.json.receipt.id},restored.response.session_token)).status).toBe(200);
  expect(db.query<{n:number},[number]>('SELECT COUNT(*) n FROM economy_corrections c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=?').get(actor.client_id)!.n).toBe(correction_count);
  expect(await journal.recover()).toBe(true);expect(storage.has('journal')).toBe(false);expect(bank).toBe(20);expect(sends).toBe(0);
  const replay=await post_json<any>('/api/crucible/cast',payload,restored.response.session_token);expect(replay.json.error).toBe('economy_command_retired');expect(replay.json.receipt).toBeNull();
  expect(queued).toHaveLength(1);expect(queued[0].icon).toBe('info');expect(queued[0].timer).toBe(0);expect(queued[0].showConfirmButton).toBe(true);
  expect(JSON.stringify(queued[0])).not.toContain('Logs');expect(JSON.stringify(queued[0])).not.toContain('quantity');
  // Real incoming receipt survives correction and can be applied exactly once.
  const lot=await post_json<any>('/api/market/sell',{item_id:'melvorD:Coal_Ore',item_qty:1,item_sell_price:1},restored.response.session_token);
  const listing=db.query<{id:number},[number]>('SELECT id FROM market_items WHERE client_id=? AND item_id=\'melvorD:Coal_Ore\'').get(actor.client_id)!.id;
  const incoming=await post_json<any>('/api/market/cancel',{id:listing},restored.response.session_token);
  expect(incoming.json.success).toBe(true);
  const claim=(await post_json<any>('/api/inbox/claim',{existing_item_ids:['melvorD:Coal_Ore'],available_slots:0},restored.response.session_token)).json.claim;
  const replayed=(await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:0},restored.response.session_token)).json.claim;
  expect(replayed).toEqual(claim);
  const adapter={is_known_item:()=>true,has_bank_item:()=>true,get_bank_free_slots:()=>0};
  const delivery=apply_inbox_claim({version:1,processed_claim_ids:[]},claim,adapter);
  expect(delivery.status).toBe('applied');
  for(const item of claim.items) bank+=item.qty;
  expect(bank).toBe(21);
  expect(apply_inbox_claim(delivery.state,replayed,adapter).status).toBe('already-applied');
  expect((await post('/api/inbox/acknowledge',{claim_id:claim.claim_id},restored.response.session_token)).status).toBe(200);
  queued[0].didOpen();
  for(let attempt=0;attempt<30;attempt++) {const status=(await get_json_with_session<any>('/api/save-rollback/status',restored.response.session_token)).json;if(status.notice===null) break;await Bun.sleep(10);}
  expect((await get_json_with_session<any>('/api/save-rollback/status',restored.response.session_token)).json.notice).toBeNull();
  const reconnect=await authenticate({...loaded(),load_id:restored.response.rollback_clock_sample.load_id});expect(reconnect.response.rollback_clock_sample.original_handshake).toBe(false);
  const next=create(reconnect,[]);await next.bootstrap(reconnect.response,{...reconnect.timing,client_sent_at:1,client_received_at:2});
  expect(next.is_retired(command)).toBe(true);expect(next.admitted()).toBe(true);expect(bank).toBe(21);
  expect(lot.json.success).toBe(true);
 } finally {configure(false);db.close();}
});
