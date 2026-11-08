import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capacity_cost,adventure_inbox_count,create_adventure_view,create_adventures} from '../../mod/fighter-adventures.mjs';
test('capacity staircase and quiet online haul count',()=>{
	assert.equal(capacity_cost(1,99),548);assert.equal(capacity_cost(9,10),2);assert.equal(capacity_cost(99,100),0);
	const groups=[{source_type:'fighter_adventures',items:[{item_id:'a'}]},{source_type:'gift',items:[{item_id:'b'}]}];
	assert.equal(adventure_inbox_count(groups,false),1);assert.equal(adventure_inbox_count(groups,true),2);
});
test('a lost capacity response refreshes the committed server quote without replaying the write',async()=>{
	const view=create_adventure_view(),calls=[];
	const data={supported:true,areas:[],capacity:1,revision:4};
	const controller=create_adventures({view,scope:()=> 'one',supported:()=>true,ready:()=>true,
		discovered:()=>true,owned_dlc:()=>[],changed:()=>{},
		request:async(path,payload)=>{
			if(!payload)return structuredClone(data);
			calls.push({path,payload});
			Object.assign(data,{capacity:2,revision:5});
			return null;
		}});
	await controller.refresh();
	view.target=2;view.editing_limit=true;
	assert.equal(await controller.upgrade(),false);
	assert.deepEqual(calls,[{path:'/api/adventures/capacity',payload:{target:2,revision:4}}]);
	assert.equal(view.capacity,2);assert.equal(view.revision,5);
	assert.equal(view.editing_limit,false);
});
test('login settles old tracking once, subsequent check-in online; discovery uses native client state',async()=>{
	const view=create_adventure_view(),calls=[];let clock=1;
	const api={supported:true,character_ready:true,active_area:'area',capacity:1,revision:9,areas:[{items:[{item_id:'known',dlc:null},{item_id:'unknown',dlc:null}]}]};
	const c=create_adventures({view,scope:()=> 'one',supported:()=>true,ready:()=>true,discovered:id=>id==='known',owned_dlc:()=>[],now:()=>clock,changed:()=>{},request:async(path,payload)=>{if(!payload)return structuredClone(api);calls.push(payload);return {success:true};}});
	await c.tick();assert.deepEqual(calls[0],{reason:'login',revision:9,eligibility:{discovered:['known'],owned_dlc:[]}});
	assert.equal(view.areas[0].items[0].eligible,true);
	await c.tick();assert.equal(calls.length,1);clock+=300000;await c.tick();assert.equal(calls[1].reason,'online');
});
test('late responses from another server cannot populate the current view',async()=>{
	const view=create_adventure_view();let server='first',resolve;
	const c=create_adventures({view,scope:()=>server,supported:()=>true,ready:()=>true,discovered:()=>true,owned_dlc:()=>[],changed:()=>{},request:()=>new Promise(r=>resolve=r)});
	const pending=c.refresh();server='second';resolve({supported:true,areas:[],active_area:'old'});assert.equal(await pending,false);assert.equal(view.active_area,null);
});
test('native Transfers badge transitions through quiet online haul, login unread and viewed',async()=>{
	const {readFile}=await import('node:fs/promises');
	const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
	const start=main.indexOf('function update_transfer_inventory_nav()');
	const source=main.slice(start,main.indexOf('\n}\n',start)+2);
	const aside={hidden:true,textContent:'',classList:{toggle(){}}};
	const state={num_transfer_offers:0,transfer_inventory:[],inbox_items:[{item_id:'a'}],inbox_groups:[{source_type:'fighter_adventures',items:[{item_id:'a'}]}],adventures:{unread:false}};
	const run=new Function('document','state','set_nav_ready','update_multiplayer_nav','adventures_module','adventures_supported','TRANSFER_INVENTORY_MAX_LIMIT',`${source};return update_transfer_inventory_nav;`)({querySelector:()=>aside},state,()=>{},()=>{},{adventure_inbox_count},true,6);
	run();assert.equal(aside.hidden,true);assert.equal(aside.textContent,'');
	state.adventures.unread=true;run();assert.equal(aside.hidden,false);assert.equal(aside.textContent,'1');
	state.adventures.unread=false;run();assert.equal(aside.hidden,true);
});
test('lifecycle reset clears the view without issuing a capacity refund',()=>{
	const view=create_adventure_view();let calls=0;
	const c=create_adventures({view,scope:()=> 'one',supported:()=>true,ready:()=>true,discovered:()=>true,owned_dlc:()=>[],changed:()=>{},request:async()=>{calls++;}});
	view.active_area='old';view.unread=true;c.reset();
	assert.equal(view.active_area,null);assert.equal(view.unread,false);assert.equal(calls,0);
	assert.equal(typeof c.reset_capacity,'function');
});
test('an older refresh cannot overwrite a newer area or capacity quote',async()=>{
	const view=create_adventure_view(),pending=[];
	const c=create_adventures({view,scope:()=> 'one',supported:()=>true,ready:()=>true,discovered:()=>true,owned_dlc:()=>[],changed:()=>{},request:()=>new Promise(resolve=>pending.push(resolve))});
	const older=c.refresh(),newer=c.refresh();
	pending[1]({supported:true,areas:[],capacity:9});assert.equal(await newer,true);
	pending[0]({supported:true,areas:[],capacity:1});assert.equal(await older,false);assert.equal(view.capacity,9);
});
test('monster selection previews equal kill credit and marks undiscovered loot while retaining GP',async()=>{
 const {update_area_estimate}=await import('../../mod/fighter-adventures.mjs');
 const area={items:[{item_id:'known',eligible:true},{item_id:'unknown',eligible:false}],selected_ids:['a','b'],monsters:[
  {id:'a',eligible:true,seconds:10,rewards:[{item_id:'known',per_kill:2},{item_id:'unknown',per_kill:100},{item_id:'melvorD:GP',per_kill:5}]},
  {id:'b',eligible:true,seconds:20,rewards:[{item_id:'known',per_kill:1}]}]};
 update_area_estimate(area);assert.equal(area.kills_per_hour,240);assert.deepEqual(area.expected_items,[{item_id:'known',per_hour:360,eligible:true},{item_id:'unknown',per_hour:12000,eligible:false},{item_id:'melvorD:GP',per_hour:600,eligible:true}]);
 area.selected_ids=['a'];update_area_estimate(area);assert.equal(area.kills_per_hour,360);
 area.selected_ids=[];update_area_estimate(area);assert.equal(area.ready,false);assert.deepEqual(area.expected_items,[]);
 area.selected_ids=['a'];area.monsters[0].eligible=false;update_area_estimate(area);assert.equal(area.ready,false);assert.equal(area.kills_per_hour,0);
});
test('selection drafts survive refresh and submit only the selected monster IDs',async()=>{
 const view=create_adventure_view(),calls=[];
 const data={supported:true,active_area:'area',active_monsters:['a'],areas:[{id:'area',items:[],monsters:[{id:'a',eligible:true,seconds:10},{id:'b',eligible:true,seconds:20}]}]};
 const c=create_adventures({view,scope:()=> 'one',supported:()=>true,ready:()=>true,discovered:()=>true,owned_dlc:()=>[],changed:()=>{},request:async(path,payload)=>{if(!payload)return structuredClone(data);calls.push(payload);return {success:true};}});
 await c.refresh();assert.deepEqual(view.areas[0].selected_ids,[]);
 c.select('area','a',true);
 c.select('area','a',false);await c.refresh();assert.deepEqual(view.areas[0].selected_ids,[]);
 assert.equal(await c.start('area'),false);assert.equal(calls.length,0);
 c.select('area','b',true);assert.equal(await c.start('area'),true);assert.deepEqual(calls[0].monster_ids,['b']);
});
test('switching servers cannot submit a selection captured from the previous instance',async()=>{
 const view=create_adventure_view();let server='first',writes=0;
 const c=create_adventures({view,scope:()=>server,supported:()=>true,ready:()=>true,discovered:()=>true,owned_dlc:()=>[],changed:()=>{},request:async(path,payload)=>{if(payload){writes++;return {success:true};}return {supported:true,areas:[{id:'area',items:[],monsters:[{id:'a',eligible:true,seconds:10}]}]};}});
 await c.refresh();assert.equal(view.areas[0].ready,false);c.select('area','a',true);assert.equal(view.areas[0].ready,true);
 server='second';assert.equal(await c.seen(),false);assert.equal(await c.start('area'),false);assert.equal(writes,0);assert.deepEqual(view.areas,[]);
});

test('server capability keeps the tab visible before rewards are ready and across reconnects',async()=>{
 const view=create_adventure_view();let supported=true,requests=0;
 const c=create_adventures({view,scope:()=> 'one',supported:()=>supported,ready:()=>false,discovered:()=>true,owned_dlc:()=>[],changed:()=>{},request:async()=>{requests++;throw Error('offline');}});
 await c.tick();assert.equal(view.supported,true);assert.equal(requests,0);
 c.reset();assert.equal(view.supported,true);
 await assert.rejects(c.refresh());assert.equal(view.supported,true);
 supported=false;c.reset();assert.equal(view.supported,false);
});

test('empty defaults and saved per-area choices survive controller recreation and areas rank by population',async()=>{
 let saved={};
 const options={scope:()=> 'one',supported:()=>true,ready:()=>true,discovered:()=>true,owned_dlc:()=>[],changed:()=>{},read_selections:()=>saved,write_selections:value=>{saved=structuredClone(value);},request:async()=>({supported:true,areas:[{id:'quiet',fighter_count:1,items:[],monsters:[{id:'a',eligible:true,seconds:10}]},{id:'busy',fighter_count:4,items:[],monsters:[{id:'b',eligible:true,seconds:10}]}]})};
 const first=create_adventure_view(),controller=create_adventures({...options,view:first});
 await controller.refresh();assert.deepEqual(first.areas.map(a=>a.id),['busy','quiet']);assert.deepEqual(first.areas.map(a=>a.selected_ids),[[],[]]);
 controller.select('quiet','a',true);
 const second=create_adventure_view();await create_adventures({...options,view:second}).refresh();
 assert.deepEqual(second.areas.find(a=>a.id==='quiet').selected_ids,['a']);assert.deepEqual(second.areas.find(a=>a.id==='busy').selected_ids,[]);
});

test('Adventure native names and eligibility reasons follow the selected language', async () => {
 const {readFile}=await import('node:fs/promises');
 const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
 const names=['get_adventure_area_name','get_adventure_monster_name','adventure_reason'];
 const source=names.map(name=>{
  const line=main.split('\n').find(value=>value.trimStart().startsWith(`state.${name} =`));
  assert.ok(line, `${name} binding is present`); return line;
 }).join('\n');
 let language='en';
 const state={};
 const area={id:'area',name:'Server area'},monster={id:'monster',name:'Server monster'};
 const game={combatAreas:{getObjectByID:id=>id==='area'?{name:language==='en'?'Native area':'Zone native'}:undefined},
  monsters:{getObjectByID:id=>id==='monster'?{name:language==='en'?'Native monster':'Monstre natif'}:undefined}};
 new Function('state','game','getLangString',source)(state,game,key=>`${language}:${key}`);
 assert.equal(state.get_adventure_area_name(area),'Native area');
 assert.equal(state.get_adventure_monster_name(monster),'Native monster');
 language='fr';
 assert.equal(state.get_adventure_area_name(area),'Zone native');
 assert.equal(state.get_adventure_monster_name(monster),'Monstre natif');
 assert.equal(state.get_adventure_area_name({id:'missing',name:'Fallback area'}),'Fallback area');
 assert.equal(state.get_adventure_monster_name({id:'missing',name:'Fallback monster'}),'Fallback monster');
 for(const [reason,key] of Object.entries({
  'Not available yet':'NOT_AVAILABLE', 'Prepare your Fighter first.':'PREPARE',
  'More Hitpoints required.':'HP_REQUIRED', 'Select food in your first food slot.':'SELECT_FOOD',
  'Selected food cannot keep up with incoming damage.':'FOOD_INSUFFICIENT'
 })) assert.equal(state.adventure_reason(reason),`fr:MOD_MP_ADVENTURE_${key}`);
 assert.equal(state.adventure_reason('Unknown server reason'),'Unknown server reason');
});

test('Adventure action failures retain language keys for display', async () => {
 const make=(ready,request)=>{
  const view=create_adventure_view();
  const controller=create_adventures({view,scope:()=> 'one',supported:()=>true,ready,request,
   discovered:()=>true,owned_dlc:()=>[],changed:()=>{}});
  controller.reset();
  return {view,controller};
 };
 const syncing=make(()=>false,async()=>null);
 await syncing.controller.stop();
 assert.equal(syncing.view.error,'MOD_MP_ADVENTURE_SYNC_ERROR');
 const rejected=make(()=>true,async(path,payload)=>payload?null:{supported:true,areas:[]});
 await rejected.controller.stop();
 assert.equal(rejected.view.error,'MOD_MP_ADVENTURE_CONFIRM_ERROR');
 const offline=make(()=>true,async()=>{throw Error('offline');});
 await offline.controller.stop();
 assert.equal(offline.view.error,'MOD_MP_ADVENTURE_REOPEN_ERROR');
 const {readFile}=await import('node:fs/promises');
 const templates=await readFile(new URL('../../mod/ui/templates.html',import.meta.url),'utf8');
 assert.match(templates, /getLangString\(state\.adventures\.error\)/);
});
