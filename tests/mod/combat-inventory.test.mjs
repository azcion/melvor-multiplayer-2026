import test from 'node:test';
import assert from 'node:assert/strict';
import { create_combat_inventory, combat_food_choices } from '../../mod/combat-inventory.mjs';
import { create_combat_view } from '../../mod/combat-arena.mjs';
function harness(overrides={}) {
	const view=create_combat_view();const calls=[];let receipts=0;
	const controller=create_combat_inventory({view,scope:()=> 'a',can_mutate:()=>true,
		request:async(path,payload)=>{calls.push({path,payload});return payload?{success:true,receipt:{id:payload.command_id}}:{foods:[{id:view.food_id,heal:30}],food_id:view.food_id,character:null,ep_micros:0,history:[],admin_history:[]};},
		reconcile:async()=>{receipts++;return true;},...overrides});
	return {view,calls,controller,receipts:()=>receipts};
}
test('Dungeon selection follows available unfinished progression on load and after a run', async()=>{
	const dungeon=(id,available,complete)=>({id,available,tiers:complete.map(value=>({complete:value}))});
	let dungeons=[dungeon('golbins',true,[true,true]),dungeon('tidal',true,[true,false]),dungeon('mire',false,[false])];
	const h=harness({request:async()=>({foods:[],history:[],dungeons})});
	h.view.mode='raid';
	await h.controller.refresh();
	assert.equal(h.view.raid_selection,'tidal'); assert.equal(h.view.encounter,'tidal');
	h.view.raid_selection='golbins'; h.view.encounter='golbins';
	await h.controller.refresh(); assert.equal(h.view.raid_selection,'golbins');
	dungeons=[dungeon('golbins',true,[true,true]),dungeon('tidal',true,[true,true]),dungeon('mire',true,[false])];
	await h.controller.settle({id:'fight',status:'victory',run:{mode:'raid',selection:'tidal'}});
	assert.equal(h.view.raid_selection,'mire'); assert.equal(h.view.encounter,'mire');
	dungeons=[dungeon('golbins',true,[true,true]),dungeon('tidal',true,[true,true]),dungeon('mire',true,[true])];
	await h.controller.settle({id:'last',status:'victory',run:{mode:'raid',selection:'mire'}});
	assert.equal(h.view.raid_selection,'mire');
});

test('Dungeon selection skips locked and empty dungeons and clears retired Practice selections', async()=>{
	const h=harness({request:async()=>({foods:[],history:[],dungeons:[
		{id:'golbins',available:true,tiers:[{complete:true}]},
		{id:'tidal',available:false,tiers:[{complete:false}]},
		{id:'mire',available:true,tiers:[]},
		{id:'quarry',available:true,tiers:[{complete:false}]}
	]})});
	h.view.encounter='practice_recruit_1'; await h.controller.refresh();
	assert.equal(h.view.raid_selection,'quarry'); assert.equal(h.view.encounter,'');
});

test('Dungeon inventory requests activity only while viewing Dungeons', async()=>{
	const h=harness();
	await h.controller.refresh();
	assert.equal(new URL(h.calls[0].path, 'https://example.test').searchParams.has('dungeon_activity'),false);
	h.view.page_tab='raid';
	await h.controller.refresh();
	assert.equal(new URL(h.calls[1].path, 'https://example.test').searchParams.get('dungeon_activity'),'1');
});

test('food selection captures server revision, blocks concurrent submission and reconciles the command',async()=>{
	let release;const h=harness({reconcile:()=>new Promise(resolve=>release=resolve)});
	h.view.character={revision:4};
	const pending=h.controller.equipment('equip',{slot:'Food',item_id:'melvorD:Shrimp'});await Promise.resolve();
	assert.equal(await h.controller.equipment('equip',{slot:'Food',item_id:'melvorD:Herring'}),false);
	release(true);assert.equal(await pending,true);
	assert.equal(h.calls[0].payload.item_id,'melvorD:Shrimp');assert.equal(h.calls[0].payload.revision,4);
	assert.equal(h.calls[1].path,'/api/combat/inventory?recovery=1');
});
test('scope reset suppresses stale refreshes and receipt application',async()=>{
	let finish;const h=harness({request:()=>new Promise(resolve=>finish=resolve)});
	const pending=h.controller.equipment('unlock-tier',{slot:'Food'});h.controller.reset();finish({success:true,receipt:{id:'old'}});
	assert.equal(await pending,false);assert.equal(h.receipts(),0);assert.equal(h.view.inventory_busy,false);
	const refresh=h.controller.refresh();h.controller.reset();finish({foods:[{id:'old'}]});await refresh;
	assert.deepEqual(h.view.foods,[]);
});
test('unlocked food choices are sorted best first without quantities',()=>{
	const foods=[{id:'shrimp',heal:30},{id:'carp',heal:180},{id:'trout',heal:70}];
	assert.deepEqual(combat_food_choices(foods,id=>id).map(food=>food.id),['carp','trout','shrimp']);
	assert.equal(foods[0].name,undefined);
});

test('settlement waits out an older inventory read and fetches the settled balance once',async()=>{
	const reads=[];
	const h=harness({request:()=>new Promise(resolve=>reads.push(resolve))});
	const old=h.controller.refresh();
	assert.equal(h.controller.settle({id:'fight',status:'active'}),undefined);
	const terminal={id:'fight',status:'fled'};
	const settled=h.controller.settle(terminal);
	assert.equal(h.controller.settle(terminal),settled);
	reads[0]({foods:[{qty:10}],history:[]});
	await old;await Promise.resolve();
	assert.equal(reads.length,2);
	reads[1]({foods:[{qty:5}],history:[{id:'fight',status:'fled'}]});
	assert.equal(await settled,true);
	assert.equal(h.view.foods[0].qty,5);
	assert.equal(h.view.history[0].id,'fight');
	await h.controller.settle(terminal);
	assert.equal(reads.length,2);
});

test('settlement retries a failed read and clears its error on recovery',async()=>{
	let reads=0;const delays=[];
	const h=harness({wait:async ms=>delays.push(ms),request:async()=>{
		if(++reads===1)throw new Error('temporary failure');
		return {foods:[{qty:5}],history:[]};
	}});
	assert.equal(await h.controller.settle({id:'fight',status:'victory'}),true);
	assert.equal(reads,2);assert.deepEqual(delays,[500]);
	assert.equal(h.view.inventory_error,'');assert.equal(h.view.foods[0].qty,5);
});

test('repeated terminal snapshots cannot create unlimited retries',async()=>{
	let reads=0;
	const h=harness({wait:async()=>{},request:async()=>{reads++;return null;}});
	const terminal={id:'fight',status:'defeat'};
	assert.equal(await h.controller.settle(terminal),false);
	for(let i=0;i<50;i++)await h.controller.settle(terminal);
	assert.equal(reads,3);assert.equal(h.view.inventory_error,'rejected');
	// Manual refresh remains available after the bounded automatic attempts.
	await h.controller.refresh();assert.equal(reads,4);
});

test('reset cancels settlement retries before they can read another session',async()=>{
	let release,reads=0;
	const h=harness({wait:()=>new Promise(resolve=>release=resolve),request:async()=>{reads++;return null;}});
	const settled=h.controller.settle({id:'fight',status:'fled'});
	while(!release)await Promise.resolve();
	h.controller.reset();release();
	assert.equal(await settled,false);assert.equal(reads,1);assert.deepEqual(h.view.foods,[]);
});

test('hydration uses the authoritative selected food and never infers it from a quantity',async()=>{
	const h=harness({request:async()=>({foods:[{id:'melvorD:Shrimp',heal:30}],food_id:'melvorD:Shrimp',history:[]})});
	await h.controller.refresh();assert.equal(h.view.food_id,'melvorD:Shrimp');
	assert.equal(h.controller.deposit,undefined);assert.equal(h.controller.withdraw,undefined);
});

test('level and reset requests capture only skill and server revision, never native levels or gear',async()=>{
	const h=harness();h.view.character={revision:7};h.view.ep_micros=100000000;h.view.level_quantities.attack=3;
	await h.controller.level('attack');
	assert.equal(h.calls[0].path,'/api/combat/level');
	assert.deepEqual(Object.keys(h.calls[0].payload).sort(),['command_id','revision','upgrades']);
	assert.equal(h.calls[0].payload.revision,7);
	h.view.character={revision:8};h.view.reset_confirm=true;
	await h.controller.reset_levels();assert.equal(h.calls[2].path,'/api/combat/reset-levels');
	assert.equal(h.calls[2].payload.revision,8);assert.equal(h.view.reset_confirm,false);
});

test('rejected stale level quotes refresh the authoritative character and preserve the reason',async()=>{
	const h=harness({request:async(path,payload)=>payload?{success:false,error:'quote_changed'}:{foods:[],character:{revision:9},ep_micros:1000000}});
	h.view.character={revision:7};h.view.ep_micros=100000000;h.view.level_quantities.attack=3;assert.equal(await h.controller.level('attack'),false);
	assert.equal(h.view.character.revision,9);assert.equal(h.view.inventory_error,'quote_changed');
});

test('changing character during level recovery cannot refresh or clear confirmation in the new scope',async()=>{
	let release;
	const h=harness({reconcile:()=>new Promise(resolve=>release=resolve)});
	h.view.character={revision:1};h.view.reset_confirm=true;
	const pending=h.controller.reset_levels();await Promise.resolve();
	h.controller.reset();h.view.reset_confirm=true;release(true);
	assert.equal(await pending,false);assert.equal(h.calls.length,1);
	assert.equal(h.view.reset_confirm,true);assert.equal(h.view.character,null);
});

test('a stale rejected purchase cannot write its error after the character changes during refresh',async()=>{
	let release;
	const h=harness({request:async(path,payload)=>payload?{success:false,error:'quote_changed'}:new Promise(resolve=>release=resolve)});
	h.view.character={revision:1};h.view.level_quantities.attack=1;h.view.ep_micros=1000000;const pending=h.controller.level('attack');
	while(!release)await Promise.resolve();
	h.controller.reset();h.view.inventory_error='';release({foods:[],character:{revision:9}});
	assert.equal(await pending,false);assert.equal(h.view.inventory_error,'');assert.equal(h.view.character,null);
});

test('level stepper quotes sum crossed price bands locally and submit one captured batch',async()=>{
	const {combat_level_quote}=await import('../../mod/combat-inventory.mjs');
	assert.deepEqual(combat_level_quote({levels:{attack:1}},'attack',19),{count:19,target:20,cost:31000000});
	assert.deepEqual(combat_level_quote({levels:{attack:98}},'attack',999),{count:1,target:99,cost:10000000});
	assert.equal(combat_level_quote(null,'attack',-5).count,0);
	const h=harness();h.view.character={revision:4,levels:{attack:1}};h.view.ep_micros=100000000;h.view.level_quantities.attack=19;
	await h.controller.level('attack');
	assert.equal(h.calls.filter(call=>call.path==='/api/combat/level').length,1);
	assert.equal(h.calls[0].payload.upgrades.attack,19);assert.equal(h.calls[0].payload.revision,4);
	h.view.character={revision:5,levels:{ranged:1}};h.view.level_quantities.ranged=1;
	assert.equal(await h.controller.level('ranged'),false);
});

test('Confirm all combines pending skills in one purchase and checks the complete EP cost',async()=>{
	const {combat_levels_quote}=await import('../../mod/combat-inventory.mjs');
	const h=harness();h.view.character={revision:3,levels:{attack:10,strength:1,hitpoints:1}};
	h.view.level_quantities={attack:3,strength:2,hitpoints:9,ranged:5};
	assert.deepEqual(combat_levels_quote(h.view.character,h.view.level_quantities),{upgrades:{attack:3,strength:2,hitpoints:9},count:14,cost:18000000});
	h.view.ep_micros=17000000;assert.equal(await h.controller.level(),false);assert.equal(h.calls.length,0);
	h.view.ep_micros=18000000;assert.equal(await h.controller.level(),true);
	assert.deepEqual(h.calls[0].payload.upgrades,{attack:3,strength:2,hitpoints:9});
	assert.equal(h.calls[0].payload.revision,3);
	assert.equal(h.calls.filter(call=>call.path==='/api/combat/level').length,1);
});

test('refresh retains other desired levels and removes upgrades that the server has committed',async()=>{
	const h=harness({request:async()=>({foods:[],character:{revision:2,levels:{attack:13,strength:1}},ep_micros:100000000})});
	h.view.character={revision:1,levels:{attack:10,strength:1}};h.view.level_quantities={attack:3,strength:4};
	await h.controller.refresh();assert.deepEqual(h.view.level_quantities,{attack:0,strength:4});
});

test('equipment test controls require server admin flag and preserve the confirmed revision', async () => {
	const h = harness();
	const preview = {project_id:14, task_id:null, revision:3};
	assert.equal(await h.controller.debug_equipment(preview),false);
	assert.equal(h.calls.length,0);
	h.view.debug_enabled=true; h.view.character={revision:7};
	assert.equal(await h.controller.debug_equipment(preview),true);
	assert.equal(h.calls[0].path,'/api/combat/debug-project');
	assert.equal(h.calls[0].payload.revision,3);
	assert.equal(h.calls[0].payload.project_id,14);
});

test('equipment reset requires confirmation, uses the current revision and refreshes only after reconciliation', async () => {
	const h=harness();
	h.view.character={revision:7}; h.view.equipment_projects={resets:{equipment:{invested_micros:2000000}}};
	assert.equal(await h.controller.reset_equipment(),false);
	assert.equal(h.calls.length,0);
	h.view.equipment_reset_confirm=true;
	assert.equal(await h.controller.reset_equipment(),true);
	assert.equal(h.calls[0].path,'/api/combat/reset-equipment');
	assert.equal(h.calls[0].payload.revision,7);
	assert.equal(h.receipts(),1);
	assert.equal(h.view.equipment_reset_confirm,false);
	h.view.equipment_set='ranged';h.view.equipment_reset_confirm=true;
	h.controller.reset();
	assert.equal(h.view.equipment_set,'melee');assert.equal(h.view.equipment_reset_confirm,false);
});

test('food picker blocks slot 2 and rechecks character scope after closing', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const equipment_module = await import('../../mod/equipment-projects.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	let release; const calls = [];
	const item = {item_id:'melvorD:Shrimp',slot:'Food',tier:1,requirements:[]};
	const model = {catalog:[item],slots:[{slot:'Food',tier:1,equipped_item:null},{slot:'Food2',tier:1,equipped_item:item.item_id}]};
	const state = {combat:{ep_micros:0}, equipment_model:()=>model, equipment_slot:slot=>model.slots.find(entry=>entry.slot===slot),
		combat_tutorial_access:()=>true, equipment_can_mutate:()=>true, equipment_slot_name:String, equipment_project_name:()=> 'Shrimp', equipment_requirement_text:()=>''};
	const context = {state,equipment_module,server_host:'server-a',session_generation:1,getLangString:String, queue_modal:()=>{},
		close_modal_and_wait:()=>new Promise(resolve=>{release=resolve;}), refresh_expedition_state:async()=>{},
		combat_inventory:{equipment:async(...args)=>{calls.push(args);return true;}}};
	runInNewContext(main.slice(main.indexOf('\tstate.equipment_item_slot ='),main.indexOf('\tstate.equipment_project_can_start =')),context);
	runInNewContext(main.slice(main.indexOf('\tstate.equipment_selected ='),main.indexOf('\tstate.equipment_cancel_ready =')),context);
	state.equipment_select('combat','slot','Food2');
	assert.equal(state.equipment_modal_slot,null);
	assert.equal(state.equipment_selected.combat,null);
	state.equipment_select('combat','slot','Food'); state.equipment_modal_choose(item);
	assert.equal(state.equipment_is_equipped(item),false);
	const pending=state.equipment_confirm('combat');context.session_generation++;release();await pending;
	assert.equal(calls.length,0);
	state.equipment_select('combat','slot','Food');state.equipment_modal_choose(item);
	const current=state.equipment_confirm('combat');release();await current;
	assert.equal(calls[0][0],'equip');assert.equal(calls[0][1].slot,'Food');assert.equal(calls[0][1].item_id,item.item_id);
});

test('consumable reset requires its own confirmation and sends only its card scope', async () => {
	const h=harness();
	h.view.character={revision:7};h.view.equipment_projects={resets:{equipment:{invested_micros:2e6},consumables:{invested_micros:1e6}}};
	h.view.equipment_reset_confirm=true;
	assert.equal(await h.controller.reset_equipment('consumables'),false);
	h.view.consumables_reset_confirm=true;
	assert.equal(await h.controller.reset_equipment('consumables'),true);
	assert.equal(h.calls[0].payload.group,'consumables');
	assert.equal(h.calls[0].payload.revision,7);
	assert.equal(h.view.consumables_reset_confirm,false);
});


test('fresh tutorial state returns stale navigation to the unlocked preparation step', async () => {
	const { tutorial_access } = await import('../../mod/combat-tutorial.mjs');
	const h = harness({ access: tutorial_access });
	h.view.page_tab = 'character'; h.view.preparation_tab = 'consumables';
	await h.controller.refresh();
	assert.equal(h.view.page_tab, 'character');
	assert.equal(h.view.preparation_tab, 'levels');
});

test('real tutorial controls require server targets, capture the revision and honor active fights',async()=>{
	const h=harness();
	assert.equal(await h.controller.debug_tutorial({target:'start'}),false);
	h.view.tutorial_debug_targets=[{id:'start'}];h.view.character={revision:8};
	h.view.arena={status:'active'};
	assert.equal(await h.controller.debug_tutorial({target:'start'}),false);
	h.view.arena=null;
	assert.equal(await h.controller.debug_tutorial({target:'start'}),true);
	assert.equal(h.calls[0].path,'/api/combat/debug-tutorial');
	assert.equal(h.calls[0].payload.revision,8);
	h.controller.reset();
	assert.deepEqual(h.view.tutorial_debug_targets,[]);
	assert.equal(h.view.tutorial_debug_confirm,false);
});

test('level previews clamp independently to server caps, including locked styles', async () => {
	const {combat_level_quote}=await import('../../mod/combat-inventory.mjs');
	const character={levels:{attack:1,hitpoints:1,ranged:1},caps:{attack:1,hitpoints:3,ranged:1}};
	assert.deepEqual(combat_level_quote(character,'attack',10),{count:0,target:1,cost:0});
	assert.deepEqual(combat_level_quote(character,'hitpoints',10),{count:2,target:3,cost:2000000});
	assert.deepEqual(combat_level_quote(character,'ranged',1),{count:0,target:1,cost:0});
});


test('graduation clears the last tutorial target without selecting a legacy Practice battle', async () => {
	const h = harness({ request: async () => ({ foods: [], tutorial: { complete: true }, character: {} }) });
	h.view.mode = 'once'; h.view.encounter = 'tutorial_7';
	await h.controller.refresh();
	assert.equal(h.view.encounter, '');
	assert.equal(h.view.mode, 'once');
});

test('project controls offer Start without requiring native-save discovery', async () => {
	const { readFile } = await import('node:fs/promises');
	const { runInNewContext } = await import('node:vm');
	const equipment_module = await import('../../mod/equipment-projects.mjs');
	const main = await readFile(new URL('../../mod/main.mjs', import.meta.url), 'utf8');
	let discovered = false;
	const state = { combat_tutorial_access: () => true, equipment_can_mutate: () => true,
		equipment_model: () => ({slots:[{slot:'Weapon',tier:1},{slot:'Food',tier:1}]}), equipment_project_completed: () => false, equipment_project_started: () => false,
		equipment_discovered: () => discovered, equipment_project_name: () => 'Item' };
	runInNewContext(main.slice(main.indexOf('\tstate.equipment_project_can_start ='), main.indexOf('\tstate.equipment_grid =')),
		{ state, equipment_module, getLangString: String });
	for (const slot of ['Weapon', 'Food']) {
		const item = { slot, item_id: 'item', tier:1 };
		discovered = false;
		assert.equal(state.equipment_project_can_start(item), true);
		assert.match(state.equipment_project_title(item), /EQUIPMENT_BEGIN/);
		discovered = true;
		assert.equal(state.equipment_project_can_start(item), true);
		assert.match(state.equipment_project_title(item), /EQUIPMENT_BEGIN/);
	}
});


test('dungeon setup requires server options, captures a revision and clears authorization on instance reset',async()=>{
	const h=harness();
	assert.equal(await h.controller.debug_dungeon({target:'tidal:2'}),false);
	h.view.dungeon_debug_options={targets:[{id:'tidal:2'}]}; h.view.character={revision:19};
	h.view.arena={status:'active'};
	assert.equal(await h.controller.debug_dungeon({target:'tidal:2'}),false);
	h.view.arena=null;
	assert.equal(await h.controller.debug_dungeon({target:'tidal:2',confirm:true}),true);
	assert.equal(h.calls[0].path,'/api/combat/debug-dungeon');
	assert.equal(h.calls[0].payload.revision,19);
	h.controller.reset();
	assert.equal(h.view.dungeon_debug_options,null);
	assert.equal(h.view.dungeon_debug_confirm,false);
});

test('applying a dungeon setup navigates to the selected real Dungeon without auto-starting combat', async()=>{
	const {readFile}=await import('node:fs/promises');
	const main=await readFile(new URL('../../mod/main.mjs',import.meta.url),'utf8');
	const actions=main.slice(main.indexOf('\tstate.combat_dungeon_debug_select ='),main.indexOf('\tstate.combat_tutorial_debug_ready ='));
	const view=create_combat_view();
	view.dungeon_debug_options={targets:[{id:'quarry:2',dungeon:'quarry',tier:2,level:21,material:3,food_tier:2}]};
	let submitted,closed=0;
	const state={combat:view,chat_is_admin:true,equipment_can_mutate:()=>true,equipment_tracking:()=>false,equipment_selected:{combat:{}}};
	new Function('state','combat_inventory','combat_arena',actions)(state,{debug_dungeon:async payload=>{submitted=payload;return true;}},{close:()=>closed++});
	state.combat_dungeon_debug_select('quarry:2');
	assert.equal(view.dungeon_debug_gear.Helmet,'melvorD:Steel_Helmet');
	assert.equal(await state.combat_dungeon_debug_apply(),false);
	view.dungeon_debug_confirm=true;
	assert.equal(await state.combat_dungeon_debug_apply(),true);
	assert.equal(submitted.target,'quarry:2');assert.equal(submitted.levels.attack,21);
	assert.equal(closed,1);assert.equal(view.page_tab,'raid');assert.equal(view.raid_tab,'details');
	assert.equal(view.encounter,'quarry');assert.equal(view.mode,'raid');
});

test('Dungeon activity appends only one page per cursor and hides Load more at the end', async () => {
	let release;
	let calls = 0;
	const h = harness({ request: async path => {
		calls++;
		assert.equal(path, '/api/combat/dungeon-activity?dungeon=golbins&cursor=100%3Afirst');
		return new Promise(resolve => { release = resolve; });
	} });
	h.view.raid_selection = 'golbins';
	h.view.dungeons = [{ id: 'golbins', activity: [{ occurred_at: 100 }], activity_next_cursor: '100:first' }];
	const pending = h.controller.load_dungeon_activity();
	await h.controller.load_dungeon_activity();
	release({ activity: [{ occurred_at: 90 }], activity_next_cursor: null });
	await pending;
	await h.controller.load_dungeon_activity();
	assert.equal(calls, 1);
	assert.deepEqual(h.view.dungeons[0].activity, [{ occurred_at: 100 }, { occurred_at: 90 }]);
	assert.equal(h.view.dungeons[0].activity_next_cursor, null);
});
