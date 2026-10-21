import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import * as rollback from '../../mod/save-rollback.mjs';
import { create_economy_command_journal } from '../../mod/economy-command-journal.mjs';
import { create_pending_economy_actions } from '../../mod/pending-economy-actions.mjs';
import * as receipts from '../../mod/economy-receipts.mjs';
const load = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const command = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
const notice = 'cccccccc-1111-4111-8111-cccccccccccc';
const status = (admission='ready', extra={}) => ({protocol:'save-rollback-v1',admission,economy_review_pending:['waiting','review'].includes(admission),upgrade_required:false,notice:null,retired_command_ids:[],...extra});
const timing = {origin:'https://one.test',generation:1,load_id:load,client_sent_at:100,client_received_at:110,elapsed_ms:10};
const bootstrap = (state=status(), original_handshake=true) => ({rollback:state,rollback_clock_sample:{server_admitted_at:105,load_id:load,original_handshake}});
function harness({ supported=true, storage=new Map(), origin='https://one.test', client_id=1, load_id=load }={}) {
 let active=true,ready=false,remote=status(),ack_ok=false,closed=0;
 const calls=[],queued=[],retired=[];
 const h={storage,calls,queued,retired,
  ready:()=>{ready=true;}, stale:()=>{active=false;}, remote:value=>{remote=value;}, ack:()=>{ack_ok=true;}, closed:()=>closed};
 h.options={supported,origin,client_id,load_id,handshake_generation:1,current:()=>active,
  read:key=>storage.get(origin+':'+key),write:(key,value)=>storage.set(origin+':'+key,structuredClone(value)),
  keys:()=>[...storage.keys()].filter(key=>key.startsWith(origin+':')).map(key=>key.slice(origin.length+1)),
  remove:key=>storage.delete(origin+':'+key),
  post:async(endpoint,payload)=>{calls.push({endpoint,payload});if(endpoint===null) return remote;
   return {response:{status:endpoint.includes('acknowledge')&&!ack_ok?503:200},json:endpoint.includes('clock')?{rollback:remote}:{success:ack_ok}};},
  retire:id=>retired.push(id),ui_ready:()=>ready,queue:options=>queued.push(options),close:()=>{closed++;},text:key=>key};
 h.client=rollback.create_rollback_client(h.options);return h;
}
const settle=async()=>{for(let i=0;i<8;i++) await Promise.resolve();};

test('clock cleanup enumerates only the selected namespace across native and Toolkit storage',async()=>{
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('function get_instance_storage_keys('),main.indexOf('\nfunction finish_pending_crucible_wish_action'));
 const context={IS_DEV_MODE:false,ctx:{characterStorage:{keys:['instance:release:current','instance:public-test:other']}},
  server_instance_storage_prefix:'instance:release:',LEGACY_LOCAL_MOD_CHARACTER_STORAGE_PREFIX:'old:',
  is_creator_toolkit_local_mod:()=>true,get_local_character_storage_key:(key,prefix='new:')=>prefix+'slot1:'+key,
  localStorage:{'new:slot1:instance:release:local':1,'old:slot1:instance:release:legacy':1,
   'new:slot2:instance:release:other-character':1,'new:slot1:instance:public-test:other-server':1}};
 runInNewContext(source,context);
 assert.deepEqual([...context.get_instance_storage_keys()],['current','local','legacy']);
 context.IS_DEV_MODE=true;context.DEV_CHARACTER_STORAGE={'instance:release:dev':true,'instance:public-test:other':true};
 assert.deepEqual([...context.get_instance_storage_keys()],['dev']);
});

test('clock migration frees quota before writing and retains only the active identity/load in its origin',async()=>{
 const first=harness();await first.client.bootstrap(bootstrap(),timing);
 const original=structuredClone(first.calls[0].payload);
 const storage=first.storage,oldKey='https://one.test:rollback_clock:1:'+load;
 storage.set('https://two.test:rollback_clock:1:'+load,{...original,origin:'https://two.test'});
 storage.set('https://one.test:rollback_clock:2:'+load,{...original,client_id:2});
 storage.set('https://one.test:pending_economy_command:1',{payload:{command_id:command}});
 storage.set('https://one.test:rollback_clock:1:unknown',{unrecognized:true});
 const next=harness({storage,load_id:notice});
 const write=next.options.write;
 next.options.write=(key,value)=>{assert.equal(storage.has(oldKey),false,'old sample must be pruned before new allocation');write(key,value);};
 next.client=rollback.create_rollback_client(next.options);
 await next.client.bootstrap({...bootstrap(),rollback_clock_sample:{server_admitted_at:105,load_id:notice,original_handshake:true}},{...timing,load_id:notice});
 assert.equal(storage.size,5);
 assert.equal(next.calls[0].payload.load_id,notice);
 assert.equal(storage.has('https://one.test:pending_economy_command:1'),true);
 const reconnect=harness({storage,load_id:notice});
 await reconnect.client.bootstrap({...bootstrap(),rollback_clock_sample:{server_admitted_at:105,load_id:notice,original_handshake:false}},{...timing,load_id:notice,client_sent_at:500});
 assert.deepEqual(reconnect.calls[0].payload,next.calls[0].payload);
 for(let i=0;i<50;i++) {
  const id=`aaaaaaaa-1111-4111-8111-${String(i).padStart(12,'0')}`;
  const h=harness({storage,load_id:id});
  await h.client.bootstrap({...bootstrap(),rollback_clock_sample:{server_admitted_at:105,load_id:id,original_handshake:true}},{...timing,load_id:id});
  assert.equal(storage.size,5,'repeated loads must not grow storage');
 }
});

test('invalid or stale handshakes cannot prune original clock recovery records',async()=>{
 const first=harness();await first.client.bootstrap(bootstrap(),timing);
 for(const stale of [false,true]) {
  const next=harness({storage:first.storage,load_id:notice});
  if(stale) next.stale();
  await next.client.bootstrap({...bootstrap(),rollback_clock_sample:{server_admitted_at:105,load_id:notice,original_handshake:stale}},{...timing,load_id:notice});
  assert.equal(first.storage.size,1);assert.equal(next.calls.length,0);
 }
});

test('main scheduler measures actual fetch dispatch/response, excluding queue and response consumption',async()=>{
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('async function coordinated_request'),main.indexOf('async function api_get(endpoint,'));
 let wall=0,mono=0,dispatch,calls=0;
 const context={session_generation:1,server_host:'https://one.test',DOMException,
  fetch:async()=>{calls++;wall+=7;mono+=7;return Response.json({success:true});},
  request_scheduler:{run(_priority,run){return new Promise(resolve=>{dispatch=()=>resolve(run());});},observe(){}},
  rollback_module:{...rollback,create_handshake_timer:fetch=>rollback.create_handshake_timer(fetch,{now:()=>wall,monotonic:()=>mono})},
  polling:{fetch_with_timeout:async(fetch,url,options,request)=>request.consume(await fetch(url,options))}};
 context.service_fetch = context.polling.fetch_with_timeout;
 runInNewContext(source,context);
 const pending=context.coordinated_request('https://one.test/api/v2/authenticate',{method:'POST',body:JSON.stringify({client_runtime:{loaded_save:{load_id:load}}})},
  {consume:async response=>{wall+=20;mono+=20;return {json:await response.json()};}});
 wall=100;mono=100;assert.equal(calls,0);dispatch();
 const result=await pending;
 assert.equal(result.timing.client_sent_at,100);assert.equal(result.timing.client_received_at,107);assert.equal(result.timing.elapsed_ms,7);
 assert.equal(result.timing.generation,1);assert.equal(result.timing.load_id,load);assert.equal(result.timing.origin,'https://one.test');
 const stale=context.coordinated_request('https://one.test/api/v2/register',{method:'POST',body:'{}'},{consume:()=>({})});
 context.session_generation=2;dispatch();await assert.rejects(stale,{name:'AbortError'});assert.equal(calls,1);
});

test('old servers use existing recovery; explicitly supporting malformed/missing status stays closed',async()=>{
 const old=harness({supported:false});await old.client.bootstrap({},timing);
 assert.equal(old.calls.length,0);assert.equal(old.client.admitted(),true);assert.equal(old.client.complete_snapshot(true),true);
 const modern=harness();await modern.client.bootstrap({},timing);assert.equal(modern.client.admitted(),false);
 modern.client.consume({...status(),notice:{kind:'older_save',notice_id:'invalid'}});assert.equal(modern.client.admitted(),false);
 modern.client.consume(status());assert.equal(modern.client.needs_full(),true);assert.equal(modern.client.complete_snapshot(true),true);
 modern.client.consume(undefined);assert.equal(modern.client.admitted(),false);
});

test('reconnect retries only saved original timing; absent, foreign and stepped samples are never fabricated',async()=>{
 const first=harness();await first.client.bootstrap(bootstrap(status('waiting')),timing);
 assert.equal(first.calls[0].endpoint,'/api/save-load/clock');assert.equal(first.calls[0].payload.client_sent_at,100);
 const reconnect=harness({storage:first.storage});await reconnect.client.bootstrap(bootstrap(status('waiting'),false),{...timing,client_sent_at:500,client_received_at:510});
 assert.equal(reconnect.calls[0].payload.client_sent_at,100);
 const missing=harness();await missing.client.bootstrap(bootstrap(status('waiting'),false),timing);
 assert.equal(missing.calls.length,0);assert.equal(missing.client.admitted(),false);
 for(const [options,bad] of [[{origin:'https://two.test'},timing],[{client_id:2},{...timing,generation:2}],[{load_id:notice},timing]]) {
  const h=harness({...options,storage:first.storage});await h.client.bootstrap(bootstrap(status('waiting'),false),bad);assert.equal(h.calls.length,0);
 }
 const stepped=harness();await stepped.client.bootstrap(bootstrap(status('waiting')),{...timing,elapsed_ms:1000});assert.equal(stepped.calls.length,0);
 const stale=harness();await stale.client.bootstrap(bootstrap(status('waiting')),{...timing,generation:2});assert.equal(stale.calls.length,0);
});

test('unchanged status release requires a full event snapshot, including no-candidate ready without a revision bump',async()=>{
 const h=harness();h.remote(status('review'));await h.client.bootstrap(bootstrap(status('review')),timing);
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('async function get_client_events_request('),main.indexOf('\nfunction start_client_event_polling('));
 let event={unchanged:true,revision:7,rollback:status()},recoveries=0;
 const context={crucible_page_hydrating:false,server_host:'https://one.test',guild_revision_scope:null,last_guild_revision:null,economy_receipt_reviews: null, rollback_client:h.client,session_generation:1,client_events_hydrated:true,client_event_trailing:false,client_event_revision:7,CHAT_CAPABILITIES:'',
  state:{listing_filters:[],refresh_crucible:async()=>{},chat_notification_preferences:{},events:{},inbox_items:[],get_chat_notification_tagged:()=>false},
  api_get:async endpoint=>{assert.ok(!endpoint.includes('revision='));return event;},
  enter_unsupported_multiplayer:()=>false,check_released_mod_version(){},apply_dev_badge_labels(){},maybe_auto_check_in_expedition(){},
  economy_command_journal:{recover(){recoveries++;}},read_cache:{invalidate(){}},invalidate_guild_state(){},chat_page_visible:false,
  polling:{has_pending_events:()=>false},event_snapshots:{reconcile_event_transfers(){}},social_mode:{SOCIAL_MODE_FULL:'full',SOCIAL_MODE_SOCIAL:'social'},
  update_chat_nav(){},reconcile_guild_member_social_modes(){},update_transfer_inventory_nav(){},update_multiplayer_nav(){},leave_social_only_disabled_page(){},
  reconcile_economy_receipts:async()=>true,economy_receipts:receipts,ECONOMY_RECEIPT_PAGE_SIZE:64,remove_instance_storage_item(){},
  guild_page_visible:false,prepare_page_snapshot:async()=>{},refresh_guild_state:async()=>{},
  legacy_market_payout_migration_started:true,show_pending_banishment_notice(){},update_guild_nav(){}};
 runInNewContext(source,context);await context.get_client_events_request(false,1);
 assert.equal(context.client_event_trailing,true);assert.equal(context.client_events_hydrated,false);assert.equal(recoveries,0);
 event={revision:7,rollback:status(),economy_receipts:[],gifts:[],trades:[],resolved_trades:[]};
 await context.get_client_events_request(false,1);assert.equal(context.economy_commands_ready,true);assert.equal(h.client.needs_full(),false);
 h.client.consume(status());assert.equal(h.client.needs_full(),false);
 h.client.consume(status('review'));assert.equal(h.client.admitted(),false);
 h.client.consume(status('released'));assert.equal(h.client.needs_full(),true);
});

test('pending journal and action snapshots survive transient holds; exact retirement changes no value and stale responses cannot replace state',async()=>{
 let saved={endpoint:'/api/crucible/cast',payload:{command_id:command,items:[{id:'melvorD:Logs',qty:4}]},major:2},admitted=false,mutations=0;
 const original=structuredClone(saved),calls=[];
 let result={response:{status:409},json:{success:false,error:'economy_review_pending'}};
 const journal=create_economy_command_journal({read:()=>saved,write:value=>{saved=structuredClone(value);},remove:()=>{saved=undefined;},current:()=>true,
  can_submit:()=>admitted,can_recover:()=>admitted,send:async(...args)=>{calls.push(args);return result;},reconcile:async()=>{mutations++;return true;}});
 assert.equal(await journal.recover(),false);await journal.run(original.endpoint,original.payload,2);assert.equal(calls.length,0);assert.deepEqual(saved,original);
 admitted=true;assert.equal(await journal.recover(),false);assert.deepEqual(saved,original);
 result={response:{status:426},json:{success:false,error:'economy_upgrade_required'}};await journal.recover();assert.deepEqual(saved,original);
 result={response:{status:200},json:{success:false,error:'economy_command_retired',retired_command_id:notice,receipt:null}};
 await journal.recover();assert.deepEqual(saved,original);
 result.json.retired_command_id=command;assert.equal(await journal.recover(),true);assert.equal(saved,undefined);assert.equal(mutations,0);
 const actions_storage=new Map();let action_result={success:false,error:'economy_review_pending'};
 const actions=create_pending_economy_actions({read:key=>actions_storage.get(key),write:(key,value)=>actions_storage.set(key,value),remove:key=>actions_storage.delete(key),
  post:async()=>action_result,reconcile:async()=>{mutations++;return true;},uuid:()=>command});
 await actions.run('1:cast','/api/crucible/cast',{items:['original']});
 action_result={success:false,error:'economy_upgrade_required'};await actions.run('1:cast','/api/crucible/cast',{items:['changed']});
 assert.deepEqual(actions_storage.get('pending_economy_action:1:cast').payload.items,['original']);
 action_result=result.json;await actions.run('1:cast','/api/crucible/cast',{});assert.equal(actions_storage.size,0);assert.equal(mutations,0);
});

test('native notices wait for UI and actual delivery, retry owner ack, queue successive notices and cancel stale callbacks',async()=>{
 const h=harness();h.remote(status('review',{notice:{notice_id:notice,kind:'older_save'}}));
 await h.client.bootstrap(bootstrap(status('review')),timing);assert.equal(h.queued.length,0);
 h.ready();await h.client.pump_notice();assert.equal(h.queued.length,1);assert.equal(h.calls.filter(c=>c.endpoint?.includes('acknowledge')).length,0);
 // The queued native modal must stay open until the player confirms it.
 assert.equal(h.queued[0].timer,0);assert.equal(h.queued[0].timerProgressBar,false);
 assert.equal(h.queued[0].showConfirmButton,true);assert.equal(h.queued[0].showCloseButton,false);
 assert.equal(h.queued[0].allowOutsideClick,false);assert.equal(h.queued[0].allowEscapeKey,false);
 h.queued[0].didOpen();await settle();assert.equal(h.calls.filter(c=>c.endpoint?.includes('acknowledge')).length,1);
 const reconnect=harness({storage:h.storage});reconnect.ready();reconnect.remote(status('review',{notice:{notice_id:notice,kind:'older_save'}}));
 await reconnect.client.bootstrap(bootstrap(status('review')),timing);await settle();assert.equal(reconnect.queued.length,0);
 h.ack();h.remote(status('review',{notice:{notice_id:command,kind:'older_save'}}));await h.client.pump_notice();await settle();
 assert.equal(h.queued.length,1);h.queued[0].didClose();await settle();assert.equal(h.queued.length,2);
 h.stale();h.queued[1].willOpen();h.queued[1].didOpen();await settle();assert.ok(h.closed()>0);
 assert.equal(h.storage.has('https://one.test:rollback_notice_delivered:1:'+command),false);
 const other=harness({origin:'https://two.test',storage:h.storage});other.ready();other.remote(status('review',{notice:{notice_id:notice,kind:'older_save'}}));
 await other.client.bootstrap(bootstrap(status('review',{notice:{notice_id:notice,kind:'older_save'}})),timing);assert.equal(other.queued.length,1);
});

test('main receipt reconciliation preserves incoming during review and ignores retired late responses without Bank/GP/Transfer mutations',async()=>{
 const h=harness();h.remote(status('review',{retired_command_ids:[command]}));await h.client.bootstrap(bootstrap(status('review')),timing);
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('function reconcile_economy_receipts('),main.indexOf('\nfunction show_pending_banishment_notice'));
 let bank=10;const storage=new Map(),acks=[];
 const context={server_host:'https://one.test',guild_revision_scope:null,last_guild_revision:null,economy_receipt_reviews: null, rollback_client:h.client,session_generation:1,server_host:'https://one.test',economy_receipts:receipts,
  economy_receipt_reconciliation:Promise.resolve(),get_instance_storage_item:key=>storage.get(key),set_instance_storage_item:(key,value)=>storage.set(key,value),remove_instance_storage_item:key=>storage.delete(key),
  acknowledged_economy_receipt_ids:[],economy_command_journal:{retire(){},acknowledge(){}},TRANSFER_INVENTORY_MAX_LIMIT:6,
  transfer_currency_support:null,game:{items:{getObjectByID:()=>({})},bank:{getQty:()=>bank,removeItemQuantity:(_item,qty)=>{bank-=qty;}},gp:{amount:0,add(){throw Error('GP mutation');},remove(){throw Error('GP mutation');}}},
  state:{transfer_inventory:[],is_crucible_item_discovered:()=>true},add_bank_item:(_item,qty)=>{bank+=qty;},api_post:async(_endpoint,payload)=>{acks.push(payload.receipt_id);return {success:true};},
  queue_market_fulfillment_notice(){},error(){throw Error('invalid receipt');}};
 runInNewContext(source,context);
 const outgoing={id:notice,kind:'market-sell',effects:[{storage:'bank',item_id:'melvorD:Logs',qty:-2}]};
 const retired={...outgoing,id:command};const incoming={id:load,kind:'market-payout',effects:[{storage:'bank',item_id:'melvorD:Logs',qty:3}]};
 assert.equal(await context.reconcile_economy_receipts([retired,outgoing,incoming]),false);assert.equal(bank,13);assert.deepEqual(acks,[load]);
 assert.equal(await context.reconcile_economy_receipts([retired]),true);assert.equal(bank,13);
});

test('all locales provide native persistent older-save notice copy',async()=>{
 for(const locale of ['en','de','es','fr','it','pt','pt-br','ru','ja','ko','tr','zh-CN','zh-TW']) {
  const strings=JSON.parse(await readFile(new URL(`../../mod/data/lang/${locale}.json`,import.meta.url),'utf8'));
  assert.ok(strings.MOD_MP_OLDER_SAVE_TITLE);assert.ok(strings.MOD_MP_OLDER_SAVE_MESSAGE);assert.ok(strings.MOD_MP_WISH_RECOVERY_REVIEW);
  if(locale==='en') {
   assert.equal(strings.MOD_MP_OLDER_SAVE_TITLE,'Older save detected');
   assert.equal(strings.MOD_MP_OLDER_SAVE_MESSAGE,'An older save seems to have been loaded. If you think this is an error, please message Multiplayer Support.');
   const h=harness();h.options.text=key=>strings[key];h.client=rollback.create_rollback_client(h.options);h.ready();
   await h.client.bootstrap(bootstrap(status('review',{notice:{notice_id:notice,kind:'older_save'}})),timing);
   assert.equal(h.queued[0].title,strings.MOD_MP_OLDER_SAVE_TITLE);assert.equal(h.queued[0].text,strings.MOD_MP_OLDER_SAVE_MESSAGE);
   assert.equal(h.queued[0].icon,'info');assert.equal(h.queued[0].timer,0);assert.equal(h.queued[0].timerProgressBar,false);assert.equal(h.queued[0].showConfirmButton,true);
  }
 }
});

test('legacy Wish records preserve uncertain ownership and migrate only explicit owners without overwriting commands',()=>{
 const uncertain={endpoint:'/api/crucible/wish/make',payload:{command_id:command}};
 const storage=new Map([['pending_crucible_wish:make',uncertain]]);
 const options={origin:'https://one.test',read:key=>storage.get(key),write:(key,value)=>storage.set(key,value),remove:key=>storage.delete(key)};
 assert.equal(rollback.retain_legacy_wish_commands(options),true);assert.equal(storage.size,1);assert.equal(storage.get('pending_crucible_wish:make'),uncertain);
 const known={...uncertain,client_id:2,origin:options.origin};storage.set('pending_crucible_wish:make',known);
 assert.equal(rollback.retain_legacy_wish_commands(options),false);assert.equal(storage.get('pending_crucible_wish:2:make'),known);assert.equal(storage.has('pending_crucible_wish:1:make'),false);
 storage.set('pending_crucible_wish:make',{...known,origin:'https://two.test'});assert.equal(rollback.retain_legacy_wish_commands(options),true);
 storage.set('pending_crucible_wish:make',{...known,payload:{command_id:notice}});assert.equal(rollback.retain_legacy_wish_commands(options),true);assert.equal(storage.get('pending_crucible_wish:2:make'),known);
});

test('actual activation wires scoped admission into existing journal recovery and preserves protected claims',async()=>{
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('function activate_multiplayer_identity('),main.indexOf('// #endregion',main.indexOf('function activate_multiplayer_identity(')));
 const storage=new Map([['pending_economy_command:1',{endpoint:'/api/crucible/cast',payload:{command_id:command},major:2}]]);
 let sends=0,events=0;
 const context={session_generation:1,server_host:'https://one.test',rollback_server_supported:true,loaded_save_tracker:{report:()=>({load_id:load})},
  state:{is_connected:true,refresh_crucible:async()=>{}},rollback_module:rollback,economy_receipt_review_module:{create_economy_receipt_reviews:()=>null},economy_command_module:{create_economy_command_journal},economy_command_journal:null,
  enter_unsupported_multiplayer:()=>false,set_session_token(){context.session_generation++;},
  get_instance_storage_item:key=>storage.get(key),set_instance_storage_item:(key,value)=>storage.set(key,value),remove_instance_storage_item:key=>storage.delete(key),get_instance_storage_keys:()=>[...storage.keys()],
  api_get_request:async()=>status('review'),api_post_response_raw:async()=>{sends++;return {response:{status:409},json:{error:'economy_review_pending'}};},reconcile_economy_receipts:async()=>true,
  interface_ready:false,addModalToQueue(){},Swal:{close(){}},getLangString:key=>key,client_event_request:null,get_client_events:async()=>{events++;},
  guild_state_refresh_id:0,social_mode:{normalize_social_mode:()=> 'full'},invalidate_status_icon_collection(){},check_released_mod_version(){},apply_dev_badge_labels(){},queue_identity_notice(){},queue_default_avatar_notice(){},
  update_multiplayer_nav(){},start_gp_sampling(){},start_status_observer(){},start_client_event_polling(){},chat_page_visible:false,
  refresh_initial_guild_state:async()=>{},raid_combat:null,refresh_raid_state:async()=>{},refresh_identities:async()=>{},schedule_equipment_sync(){},schedule_status_sync(){}};
 runInNewContext(source,context);
 context.activate_multiplayer_identity({...bootstrap(status('review'),false),session_token:'fixture',chat:{client_id:1}},timing);
 await settle();assert.equal(events,1);assert.equal(context.economy_commands_ready,false);
 assert.equal(await context.economy_command_journal.recover(),false);assert.equal(sends,0);assert.equal(storage.has('pending_economy_command:1'),true);
 storage.set('pending_economy_command:1',{endpoint:'/api/market/haggle/claim',payload:{command_id:notice},major:2});
 await context.economy_command_journal.recover();assert.equal(sends,1);assert.equal(storage.has('pending_economy_command:1'),true);
 context.server_host='https://two.test';await context.economy_command_journal.recover();assert.equal(sends,1);
});

test('actual raw request gate permits recovery and affected-only 426 keeps ordinary multiplayer connected',async()=>{
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('async function api_post_response_raw('),main.indexOf('async function api_post_binary_response('));
 let sends=0,blocks=0;const floors=[];
 const context={state:{multiplayer_unsupported:false},session_token:'fixture',selected_api_major:2,session_generation:1,server_host:'https://one.test',
  economy_receipt_reviews: null, rollback_client:{admitted:()=>false,block(){blocks++;}},rollback_module:rollback,resolve_api_endpoint:path=>path,transport_diagnostics:null,
  coordinated_request:async(_url,_options,request)=>{sends++;return request.consume(Response.json({error:'economy_upgrade_required'},{status:426}));},
  handle_session_response(){},enter_unsupported_multiplayer:floor=>{floors.push(floor);return false;},error(){throw Error('transport');}};
 runInNewContext(source,context);
 assert.equal((await context.api_post_response_raw('/api/crucible/cast',{})).json.error,'economy_review_pending');assert.equal(sends,0);
 await context.api_post_response_raw('/api/market/haggle/claim',{});assert.equal(sends,1);assert.equal(blocks,1);assert.deepEqual(floors,[undefined]);assert.equal(context.state.multiplayer_unsupported,false);
 await context.api_post_response_raw('/api/chat/send',{});assert.equal(sends,2);
});

test('actual Wish wiring preserves unowned legacy work, transient snapshots and mismatched retirement',async()=>{
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('function finish_pending_crucible_wish_action('),main.indexOf('function load_social_mode('));
 const legacy={endpoint:'/api/crucible/wish/make',payload:{command_id:command}};
 const storage=new Map([['pending_crucible_wish:make',legacy]]);let sends=0,result={success:false,error:'economy_review_pending'};
 const context={economy_receipt_reviews: null, rollback_client:{admitted:()=>true},rollback_module:rollback,session_generation:1,server_host:'https://one.test',state:{chat_client_id:1},crypto:{randomUUID:()=>notice},
  get_instance_storage_item:key=>storage.get(key),set_instance_storage_item:(key,value)=>storage.set(key,value),remove_instance_storage_item:key=>storage.delete(key),
  api_post_without_economy_journal:async()=>{sends++;return result;}};
 runInNewContext(source,context);
 assert.equal((await context.run_pending_crucible_wish_action('make',legacy.endpoint,{})).error,'legacy_wish_recovery_review');
 await context.recover_pending_crucible_wish_actions();assert.equal(sends,0);assert.equal(storage.get('pending_crucible_wish:make'),legacy);
 storage.delete('pending_crucible_wish:make');storage.set('pending_crucible_wish:1:make',legacy);
 await context.recover_pending_crucible_wish_actions();assert.equal(sends,1);assert.equal(storage.get('pending_crucible_wish:1:make'),legacy);
 result={success:false,error:'economy_command_retired',retired_command_id:notice,receipt:null};
 await context.recover_pending_crucible_wish_actions();assert.equal(storage.get('pending_crucible_wish:1:make'),legacy);
 result.retired_command_id=command;await context.recover_pending_crucible_wish_actions();assert.equal(storage.has('pending_crucible_wish:1:make'),false);
});

test('existing pending actions remain untouched until admitted, including immutable recovery exceptions',async()=>{
 const storage=new Map([['pending_economy_action:1:cast',{endpoint:'/api/crucible/cast',payload:{command_id:command}}],
 ['pending_economy_action:1:claim',{endpoint:'/api/inbox/claim',payload:{command_id:notice}}]]);let sends=0;
 const actions=create_pending_economy_actions({read:key=>storage.get(key),write:(key,value)=>storage.set(key,value),remove:key=>storage.delete(key),
  can_recover:pending=>rollback.protected_rollback_recovery_route(pending.endpoint),post:async()=>{sends++;return {error:'economy_review_pending'};},reconcile:async()=>true,uuid:()=>load});
 await actions.run('1:cast','/api/crucible/cast',{});assert.equal(sends,0);assert.equal(storage.size,2);
 await actions.run('1:claim','/api/inbox/claim',{});assert.equal(sends,1);assert.equal(storage.size,2);
});

test('lost clock POST retains the original timing for reconnect and notice ack waits for durable delivery',async()=>{
 const first=harness();const post=first.options.post;
 first.options.post=async(endpoint,payload)=>endpoint==='/api/save-load/clock'?{response:{status:503},json:null}:post(endpoint,payload);
 first.client=rollback.create_rollback_client(first.options);
 await first.client.bootstrap(bootstrap(status('waiting')),timing);assert.equal(first.client.admitted(),false);
 const reconnect=harness({storage:first.storage});await reconnect.client.bootstrap(bootstrap(status('waiting'),false),{...timing,client_sent_at:900,client_received_at:910});
 assert.equal(reconnect.calls[0].payload.client_sent_at,100);
 const no_storage=harness();no_storage.ready();no_storage.options.write=(key,value)=>{if(!key.includes('notice_delivered')) no_storage.storage.set('https://one.test:'+key,value);};
 no_storage.client=rollback.create_rollback_client(no_storage.options);
 await no_storage.client.bootstrap(bootstrap(status('review',{notice:{notice_id:notice,kind:'older_save'}})),timing);
 no_storage.queued[0].didOpen();await settle();assert.equal(no_storage.calls.filter(call=>call.endpoint?.includes('acknowledge')).length,0);
});

test('actual receipt wiring notifies only reconciled fulfillment value, excluding retired and deferred receipts',async()=>{
 const h=harness();h.remote(status('review',{retired_command_ids:[command]}));await h.client.bootstrap(bootstrap(status('review')),timing);
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const source=main.slice(main.indexOf('function reconcile_economy_receipts('),main.indexOf('\nfunction show_pending_banishment_notice'));
 let bank=10,gp=0;const storage=new Map(),notices=[],acks=[];
 const context={server_host:'https://one.test',guild_revision_scope:null,last_guild_revision:null,economy_receipt_reviews: null, rollback_client:h.client,session_generation:1,server_host:'https://one.test',economy_receipts:receipts,
  economy_receipt_reconciliation:Promise.resolve(),get_instance_storage_item:key=>storage.get(key),set_instance_storage_item:(key,value)=>storage.set(key,value),remove_instance_storage_item:key=>storage.delete(key),
  acknowledged_economy_receipt_ids:[],economy_command_journal:{retire(){},acknowledge(){}},TRANSFER_INVENTORY_MAX_LIMIT:6,transfer_currency_support:null,
  game:{items:{getObjectByID:()=>({})},bank:{getQty:()=>bank,removeItemQuantity:(_item,qty)=>{bank-=qty;}},gp:{get amount(){return gp;},add(qty){gp+=qty;},remove(){throw Error('GP debit');}}},
  state:{transfer_inventory:[],is_crucible_item_discovered:()=>true},add_bank_item:(_item,qty)=>{bank+=qty;},api_post:async(_endpoint,payload)=>{acks.push(payload.receipt_id);return {success:true};},
  queue_market_fulfillment_notice:eligible=>notices.push(receipts.summarize_market_fulfillment_receipts(eligible)),error(){throw Error('invalid receipt');}};
 runInNewContext(source,context);
 const outgoing={id:notice,kind:'market-fulfill',effects:[{storage:'bank',item_id:'melvorD:Logs',qty:-2},{storage:'bank',item_id:'melvorD:GP',qty:99}]};
 const valid={id:load,kind:'market-fulfill',effects:[{storage:'bank',item_id:'melvorD:Coal_Ore',qty:3}]};
 assert.equal(await context.reconcile_economy_receipts([{...outgoing,id:command},outgoing,valid]),false);
 assert.equal(bank,13);assert.equal(gp,0);assert.deepEqual(acks,[load]);
 assert.deepEqual(notices,[{order_count:1,items:[{item_id:'melvorD:Coal_Ore',qty:3}]}]);
});

test('failed notice storage shows once per controller, retries durable delivery without redisplay and respects stale scope',async()=>{
 const h=harness();let storage_ok=false;
 const write=h.options.write;h.options.write=(key,value)=>{if(storage_ok||!key.includes('notice_delivered')) write(key,value);};
 h.client=rollback.create_rollback_client(h.options);h.ready();h.remote(status('review',{notice:{notice_id:notice,kind:'older_save'}}));
 await h.client.bootstrap(bootstrap(status('review')),timing);assert.equal(h.queued.length,1);
 h.queued[0].didOpen();h.queued[0].didClose();await settle();
 for(let retry=0;retry<3;retry++) {h.client.consume(status('review',{notice:{notice_id:notice,kind:'older_save'}}));await h.client.pump_notice();}
 assert.equal(h.queued.length,1);assert.equal(h.calls.filter(call=>call.endpoint?.includes('acknowledge')).length,0);
 storage_ok=true;h.ack();h.remote(status('review',{notice:{notice_id:command,kind:'older_save'}}));
 await h.client.pump_notice();await settle();assert.equal(h.storage.get('https://one.test:rollback_notice_delivered:1:'+notice),true);
 assert.equal(h.calls.filter(call=>call.endpoint?.includes('acknowledge')).length,1);assert.equal(h.queued.length,2);
 h.stale();h.queued[1].didOpen();h.queued[1].didClose();await h.client.pump_notice();assert.equal(h.queued.length,2);
 assert.equal(h.storage.has('https://one.test:rollback_notice_delivered:1:'+command),false);
 const reconnect=harness();reconnect.ready();reconnect.remote(status('review',{notice:{notice_id:notice,kind:'older_save'}}));
 await reconnect.client.bootstrap(bootstrap(status('review')),timing);assert.equal(reconnect.queued.length,1);
});
