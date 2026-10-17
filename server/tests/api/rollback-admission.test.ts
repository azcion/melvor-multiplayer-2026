import {expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {make_guildmates,register_guild_client} from '../support/fixtures';
import {post,post_json,get_json_with_session,get_with_session} from '../support/http';
import {db_all,db_run} from '../support/persistence';
import {rollback_policy,set_rollback_policy,set_rollback_hold} from '../../rollback-policy';
function controls<T>(work:(db:Database)=>T):T {const db=new Database(process.env.TEST_DB_PATH!,{strict:true});db.run('PRAGMA busy_timeout=5000');try{return work(db);}finally{db.close();}}
function policy(client:number,enabled:boolean) {return controls(db=>{
 const previous=rollback_policy(db);const frontier=db.query<{id:number},[]>('SELECT COALESCE(MAX(id),0)+1 id FROM economy_operations').get()!.id;
 return set_rollback_policy(db,crypto.randomUUID(),previous.revision,{enabled,first_operation_id:frontier,policy_version:1,client_ids:[client]},'Isolated API fixture',enabled);
});}
const report=()=>({load_id:crypto.randomUUID(),save_timestamp:Date.now()-60000,client_loaded_at:Date.now()-1,capture_source:'decode'});
async function authenticate(player:any,loaded_save:any,device:string,capable=true) {
 const sent=Date.now(),start=performance.now();
 const response=await post_json<any>('/api/authenticate',{client_identifier:player.client_identifier,client_key:player.client_key,
  client_runtime:{mod_version:'1.6.14',active_mods:[],loaded_save,device:{installation_id:device},...(capable?{capabilities:['save-rollback-v1']}:{})}});
 return {response,sample:{...response.json.rollback_clock_sample,client_sent_at:sent,client_received_at:Date.now(),elapsed_ms:Math.round(performance.now()-start)}};
}

test('prospective admission withholds outgoing replay, corrects once, clears Gift caches and retains private notice',async()=>{
 const pair=await make_guildmates('Admission Actor','Admission Peer','Admission Guild',{first:'1.6.14',second:'1.6.14'});
 const actor=pair.first;const device=crypto.randomUUID();const original_report=report();
 const first=await authenticate(actor,original_report,device);expect(first.response.response.status).toBe(200);
 const original_token=first.response.json.session_token;
 expect((await post('/api/save-load/clock',first.sample,original_token)).status).toBe(200);
 expect((await post('/api/installations/enroll',{installation_id:device,installation_key:crypto.randomUUID()},original_token)).status).toBe(200);
 policy(actor.client_id,true);
 try {
  const command=crypto.randomUUID();const body={command_id:command,source:'bank',items:[{id:'melvorD:Logs',qty:4,value_currency_id:'melvorD:GP',value_per_item:1}]};
  const cast=await post_json<any>('/api/crucible/cast',body,original_token);expect(cast.json.success).toBe(true);
  const gift=await post_json<any>('/api/gift/send',{command_id:crypto.randomUUID(),recipient_id:pair.second_id,items:[{id:'melvorD:Logs',qty:2}]},original_token);
  expect(gift.json.success).toBe(true);
  const before=(await get_json_with_session<any>('/api/events',pair.second.session_token)).json.gifts;expect(before.length).toBe(1);
  // A pre-existing issued incoming claim remains recoverable during admission.
  await db_run("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty,created_at,updated_at) VALUES(?,'gift','Protected delivery','melvorD:Coal_Ore',1,?,?)",[actor.client_id,Date.now(),Date.now()]);
  const issued=await post_json<any>('/api/inbox/claim',{existing_item_ids:['melvorD:Coal_Ore'],available_slots:1},original_token);
  expect(issued.json.claim.claim_id).toBeString();
  const restored=await authenticate(actor,{...original_report,load_id:crypto.randomUUID()},device);const token=restored.response.json.session_token;
  expect(restored.response.json.rollback.admission).toBe('waiting');
  const waiting=(await get_json_with_session<any>('/api/events',token)).json;expect(waiting.economy_receipts).toEqual([]);
  expect((await post('/api/crucible/cast',body,token)).status).toBe(409);
  expect((await post('/api/gift/accept',{gift_id:before[0]},pair.second.session_token)).status).toBe(409);
  expect((await post('/api/crucible/cast',{...body,command_id:crypto.randomUUID()},original_token)).status).toBe(409);
  const recovered=await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:0},token);expect(recovered.json.claim).toEqual(issued.json.claim);
  expect((await post('/api/inbox/acknowledge',{claim_id:issued.json.claim.claim_id},token)).status).toBe(200);
  const calibrated=await post_json<any>('/api/save-load/clock',restored.sample,token);expect(calibrated.response.status).toBe(200);
  expect(calibrated.json.rollback.admission).toBe('ready');expect(calibrated.json.rollback.notice.kind).toBe('older_save');
  expect(await db_all('SELECT qty FROM crucible_offerings WHERE guild_id=? AND item_id=?',[pair.guild_id,'melvorD:Logs'])).toEqual([]);
  expect((await get_json_with_session<any>('/api/events',pair.second.session_token)).json.gifts).toEqual([]);
  const retired=await post_json<any>('/api/crucible/cast',body,token);
  expect(retired.json).toEqual({success:false,error:'economy_command_retired',retired_command_id:command,receipt:null});
  const notice=calibrated.json.rollback.notice.notice_id;
  expect((await post('/api/save-rollback/notice/acknowledge',{notice_id:notice},pair.second.session_token)).status).toBe(404);
  const reconnect=await authenticate(actor,{...original_report,load_id:restored.response.json.rollback_clock_sample.load_id},device);
  expect(reconnect.response.json.rollback.notice.notice_id).toBe(notice);
  const public_status=(await get_json_with_session<any>('/api/save-rollback/status',reconnect.response.json.session_token)).json;
  for(const private_word of ['quantity','item_id','operation_id','incident','correction']) expect(JSON.stringify(public_status)).not.toContain(private_word);
  expect((await post('/api/save-rollback/notice/acknowledge',{notice_id:notice},reconnect.response.json.session_token)).status).toBe(200);
  expect((await get_json_with_session<any>('/api/save-rollback/status',reconnect.response.json.session_token)).json.notice).toBeNull();
  // Disabling and downgrading cannot resurrect the outgoing command or lose the notice ack.
  policy(actor.client_id,false);
  const downgraded=await authenticate(actor,undefined,device,false);const old=await post_json<any>('/api/crucible/cast',body,downgraded.response.json.session_token);
  expect(old.response.status).toBe(426);expect(old.json.required_capability).toBe('save-rollback-v1');
  expect((await get_with_session('/api/events',downgraded.response.json.session_token)).status).toBe(200);
  expect((await post('/api/economy/receipts/acknowledge',{receipt_id:command},downgraded.response.json.session_token)).status).toBe(200);
  expect(await db_all('SELECT state FROM economy_incident_decisions d JOIN economy_incidents i ON i.id=d.incident_id JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.client_id=? ORDER BY d.id',[actor.client_id]))
   .toEqual([{state:'suspected'},{state:'confirmed'}]);
 } finally {policy(actor.client_id,false);}
});

test('manual hold blocks only unsafe economy while unaffected older sessions and safe reads keep working',async()=>{
 const player=await register_guild_client('Held Old Protocol','Held Protocol Guild','1.6.14');
 const other=await register_guild_client('Unaffected Protocol','Ordinary Protocol','1.6.14');
 controls(db=>set_rollback_hold(db,crypto.randomUUID(),player.client_id,0,true,'Isolated manual review'));
 const cast={source:'bank',items:[{id:'melvorD:GP',qty:1000}]};
 expect((await post('/api/crucible/cast',cast,player.session_token)).status).toBe(426);
 expect((await get_with_session('/api/crucible/contents',player.session_token)).status).toBe(200);
 expect((await post('/api/client/set_display_name',{display_name:'Held Safe Profile'},player.session_token)).status).toBe(200);
 expect((await post_json<any>('/api/crucible/cast',cast,other.session_token)).json.success).toBe(true);
 const status=(await get_json_with_session<any>('/api/save-rollback/status',player.session_token)).json;
 expect(status.upgrade_required).toBe(true);expect(status.notice).toBeNull();
 controls(db=>{const revision=db.query<{id:number},[number]>('SELECT id FROM economy_client_holds WHERE client_id=? ORDER BY id DESC LIMIT 1').get(player.client_id)!.id;
  set_rollback_hold(db,crypto.randomUUID(),player.client_id,revision,false,'Isolated release',0);});
 expect((await post_json<any>('/api/crucible/cast',cast,player.session_token)).json.success).toBe(true);
});

test('receipt recovery filters before pagination and uses each session capability after release and disable',async()=>{
 const player=await register_guild_client('Recovery Pagination','Recovery Guild','1.6.14');
 const device=crypto.randomUUID();const supported=await authenticate(player,report(),device);
 const capable_token=supported.response.json.session_token;
 expect((await post('/api/installations/enroll',{installation_id:device,installation_key:crypto.randomUUID()},capable_token)).status).toBe(200);
 policy(player.client_id,true);policy(player.client_id,false);
 const unsupported=await authenticate(player,undefined,device,false);const legacy_token=unsupported.response.json.session_token;
 const outgoing:string[]=[],incoming:string[]=[];
 controls(db=>{
  // Original journal payloads use the same receipt envelope as committed API commands.
  for(let i=0;i<67;i++) {
   const id=crypto.randomUUID(),qty=i<65?-1:1; (qty<0?outgoing:incoming).push(id);
   const receipt={id,kind:qty<0?'market-sell':'market-payout',effects:[{storage:'bank',item_id:'melvorD:Logs',qty}]};
   db.query('INSERT INTO economy_receipts(id,client_id,kind,response_json,created_at) VALUES(?,?,?,?,?)').run(id,player.client_id,receipt.kind,JSON.stringify({success:true,receipt}),1000+i);
  }
 });
 const receipts=async(token:string)=>(await get_json_with_session<any>('/api/events',token)).json.economy_receipts;
 expect((await receipts(legacy_token)).map((r:any)=>r.id)).toEqual(outgoing.slice(0,64));
 const hold=controls(db=>set_rollback_hold(db,crypto.randomUUID(),player.client_id,0,true,'Receipt fixture review'));
 expect((await receipts(capable_token)).map((r:any)=>r.id)).toEqual(incoming);
 expect((await receipts(legacy_token)).map((r:any)=>r.id)).toEqual(incoming);
 // A retained correction makes a later unsupported session affected even without a current hold.
 controls(db=>{
  const load=db.query<{id:number},[number]>('SELECT id FROM economy_load_observations WHERE client_id=? ORDER BY id DESC LIMIT 1').get(player.client_id)!.id;
  const incident=db.query<{id:number},[number]>('INSERT INTO economy_incidents(save_load_id,created_at,policy_version) VALUES(?,1,1) RETURNING id').get(load)!.id;
  const operation=db.query<{id:number},[string,number]>("INSERT INTO economy_operations(source_key,client_id,kind,committed_at,local_effect,evidence_json) VALUES(?,?,'market-sell',1,'outgoing','{}') RETURNING id").get(`receipt:${outgoing[0]}`,player.client_id)!.id;
  db.query("INSERT INTO economy_corrections(incident_id,operation_id,lot_key,object_id,quantity,disposition,reason,decided_at,policy_version) VALUES(?,?,'pagination','melvorD:Logs',1,'invalidated','fixture',1,1)").run(incident,operation);
  set_rollback_hold(db,crypto.randomUUID(),player.client_id,hold.revision,false,'Reviewed receipt fixture',0);
 });
 expect((await receipts(unsupported.response.json.session_token)).map((r:any)=>r.id)).toEqual(incoming);
 // Latest runtime is unsupported, but the enrolled capable session retains its own promise.
 expect((await receipts(capable_token)).map((r:any)=>r.id)).toEqual(outgoing.slice(1));
 const ordinary=await register_guild_client('Ordinary Recovery','Ordinary Guild','1.6.14');
 const cast=await post_json<any>('/api/crucible/cast',{source:'bank',items:[{id:'melvorD:Logs',qty:1}]},ordinary.session_token);
 expect((await receipts(ordinary.session_token)).map((r:any)=>r.id)).toContain(cast.json.receipt.id);
});

test('held players keep Friends and independent Raid/work routes; pending acceptance is gated but terminal Haggle and Trade counterparty claims recover',async()=>{
 const pair=await make_guildmates('Terminal Owner','Terminal Buyer','Terminal Guild',{first:'1.6.14',second:'1.6.14'});
 const sell=await post_json<any>('/api/market/sell',{item_id:'melvorD:Logs',item_qty:10,item_sell_price:10},pair.first.session_token);
 const lot=sell.json.id ?? (await db_all<{id:number}>('SELECT id FROM market_items WHERE client_id=?',[pair.first_id]))[0]!.id;
 const opening=await post_json<any>('/api/market/haggle',{id:lot,qty:2,price:5},pair.second.session_token);
 expect((await post_json<any>('/api/market/haggle/accept',{id:opening.json.haggle_id,revision:1},pair.first.session_token)).json.success).toBe(true);
 const pending=await post_json<any>('/api/market/haggle',{id:lot,qty:1,price:5},pair.second.session_token);
 expect(pending.json.success).toBe(true);
 expect((await post_json<any>('/api/market/haggle/counter',{id:pending.json.haggle_id,revision:1,price:6},pair.first.session_token)).json.success).toBe(true);
 const trade=await post_json<any>('/api/trade/offer',{recipient_id:pair.second_id,items:[{id:'melvorD:Logs',qty:1}]},pair.first.session_token);
 expect((await post_json<any>('/api/trade/counter',{trade_id:trade.json.trade_id,items:[{id:'melvorD:Coal_Ore',qty:1}]},pair.second.session_token)).json.success).toBe(true);
 expect((await post_json<any>('/api/trade/accept',{trade_id:trade.json.trade_id},pair.first.session_token)).json.success).toBe(true);
 const seller_hold=controls(db=>set_rollback_hold(db,crypto.randomUUID(),pair.first_id,0,true,'Settled source owner review'));
 expect((await post('/api/market/haggle/accept',{id:pending.json.haggle_id,revision:2},pair.second.session_token)).status).toBe(409);
 expect((await post_json<any>('/api/market/haggle/claim',{id:opening.json.haggle_id},pair.second.session_token)).json.success).toBe(true);
 // Own unissued benefits remain gated even though another party's terminal entitlement is safe.
 expect((await post('/api/market/haggle/claim',{id:opening.json.haggle_id},pair.first.session_token)).status).toBe(426);
 expect((await post('/api/friends/add',{friend_code:pair.second.friend_code},pair.first.session_token)).status).toBe(200);
 expect((await post('/api/raids/activate',{},pair.first.session_token)).status).toBe(200);
 expect((await post('/api/expedition/task/start',{},pair.first.session_token)).status).toBe(400);
 expect((await post('/api/guilds/leave',{},pair.first.session_token)).status).toBe(426);
 const claim=await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.second.session_token);
 expect(claim.json.claim).not.toBeNull();
 controls(db=>set_rollback_hold(db,crypto.randomUUID(),pair.second_id,0,true,'Recipient now reviewed'));
 expect((await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:0},pair.second.session_token)).json.claim).toEqual(claim.json.claim);
 controls(db=>set_rollback_hold(db,crypto.randomUUID(),pair.first_id,seller_hold.revision,false,'Seller reviewed',0));
 expect((await post_json<any>('/api/market/haggle/claim',{id:opening.json.haggle_id},pair.first.session_token)).json.success).toBe(true);
});
