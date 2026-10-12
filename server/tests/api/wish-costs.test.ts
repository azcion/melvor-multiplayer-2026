import { expect, test } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, post } from '../support/http';
import { db_all, db_run } from '../support/persistence';

async function account(ids: number[]) {
	const key=crypto.randomUUID();
	await db_run('INSERT INTO melvor_accounts(cloud_username,playfab_id,created_at) VALUES(?,?,?)',[key,key,Date.now()]);
	const row=(await db_all<{id:number}>('SELECT id FROM melvor_accounts WHERE playfab_id=?',[key]))[0]!;
	for(const id of ids) {
		await db_run('UPDATE clients SET melvor_account_id=? WHERE id=?',[row.id,id]);
		await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,1000000000)',[id]);
	}
}
const body=(qty=1,ep_micros=10000)=>({command_id:crypto.randomUUID(),item_id:'melvorAoD:Torn_Parchment',qty,ep_micros,gp:qty*250,gp_balance:100000000});
const balance=async(id:number)=>(await db_all<{points_micros:number}>('SELECT points_micros FROM expedition_ep_balances WHERE client_id=?',[id]))[0]!.points_micros;

test('paid Wish atomically charges once, preserves funding and locks sibling GP across merges',async()=>{
	const pair=await make_guildmates('Paid Wish','Paid Sibling','Paid Wish Guild',{first:'1.6.11',second:'1.6.11'});
	await account([pair.first_id,pair.second_id]);
	await db_run('UPDATE guild_memberships SET crucible_reclaim_available_at=0 WHERE guild_id=?',[pair.guild_id]);
	const input=body(101,1020000);
	const make=()=>post_json<any>('/api/crucible/wish/make',input,pair.first.session_token);
	const [a,b]=await Promise.all([make(),make()]);
	expect(a.json.success).toBe(true);expect(b.json).toEqual(a.json);
	expect(a.json.receipt.effects).toEqual([{storage:'gp',qty:-25250}]);
	expect(await balance(pair.first_id)).toBe(998980000);
	expect(await db_all('SELECT qty,required_gp,progress_gp,formation_points FROM crucible_wishes WHERE id=?',[a.json.wish_id]))
		.toEqual([{qty:101,required_gp:50500,progress_gp:0,formation_points:0}]);
	await post_json<any>('/api/crucible/cast',{source:'bank',items:[{id:'melvorD:GP',qty:10,value_currency_id:'melvorD:GP',value_per_item:1}]},pair.second.session_token);
	expect(await db_all('SELECT qty,meld_points FROM crucible_offerings WHERE guild_id=? AND item_id=?',[pair.guild_id,'melvorD:GP']))
		.toEqual([{qty:25260,meld_points:0}]);
	const state=(await get_json_with_session<any>('/api/crucible/contents',pair.second.session_token)).json;
	expect(state.offerings.find((x:any)=>x.item_id==='melvorD:GP').blocked_until).toBeGreaterThan(Date.now()+3.9*3600000);
	expect((await post_json<any>('/api/crucible/reclaim',{item_id:'melvorD:GP',qty:1},pair.second.session_token)).json.success).toBe(false);
	await db_run('UPDATE crucible_currency_locks SET locked_until=? WHERE guild_id=?',[Date.now()-1,pair.guild_id]);
	expect((await post_json<any>('/api/crucible/reclaim',{item_id:'melvorD:GP',qty:1},pair.second.session_token)).json.success).toBe(true);
	expect((await post_json<any>('/api/crucible/wish/cancel',{},pair.first.session_token)).json.success).toBe(true);
	expect(await balance(pair.first_id)).toBe(998980000);
	// Even after membership loss, the already accepted operation replays its original receipt.
	await db_run('DELETE FROM guild_memberships WHERE client_id=?',[pair.first_id]);
	expect((await make()).json).toEqual(a.json);
	expect(await balance(pair.first_id)).toBe(998980000);
});

test('failed quotes and insufficient balances leave EP, Offerings and Wishes unchanged',async()=>{
	const player=await register_guild_client('Wish Failures','Wish Failures','1.6.11');await account([player.client_id]);
	for(const input of [{...body(),gp:249},{...body(),ep_micros:9999},{...body(),gp_balance:249}]) {
		const response=await post_json<any>('/api/crucible/wish/make',input,player.session_token);
		expect(response.json.success).not.toBe(true);
	}
	expect((await post('/api/crucible/wish/make',body(1001,55000000),player.session_token)).status).toBe(400);
	await db_run('UPDATE expedition_ep_balances SET points_micros=9999 WHERE client_id=?',[player.client_id]);
	expect((await post_json<any>('/api/crucible/wish/make',body(),player.session_token)).json).toMatchObject({success:false,error:'insufficient_ep'});
	expect(await balance(player.client_id)).toBe(9999);
	expect(await db_all('SELECT id FROM crucible_wishes WHERE guild_id=?',[player.guild_id])).toEqual([]);
	expect(await db_all('SELECT id FROM crucible_offerings WHERE guild_id=?',[player.guild_id])).toEqual([]);
});

test('capacity API purchases, upgrades, expiry quotes and renewal commands are replay safe and character owned',async()=>{
	const pair=await make_guildmates('Capacity Buyer','Capacity Sibling','Capacity API',{first:'1.6.11',second:'1.6.11'});await account([pair.first_id,pair.second_id]);
	const input={command_id:crypto.randomUUID(),base:300,ep_micros:30000000,auto_renew:true};
	const first=(await post_json<any>('/api/crucible/wish/capacity',input,pair.first.session_token)).json;
	expect(first).toMatchObject({success:true,capacity:{base:300,auto_renew:true,renewal_micros:30000000}});
	expect((await post_json<any>('/api/crucible/wish/capacity',input,pair.first.session_token)).json).toEqual(first);
	const upgrade=(await post_json<any>('/api/crucible/wish/capacity',{base:500,ep_micros:70000000,auto_renew:true},pair.first.session_token)).json;
	expect(upgrade).toMatchObject({success:true,capacity:{base:500,renewal_micros:100000000}});
	expect(upgrade.capacity.expires_at).toBeGreaterThanOrEqual(first.capacity.expires_at);
	for (const base of [200,300,400,500]) {
		const refused=(await post_json<any>('/api/crucible/wish/capacity',
			{base,ep_micros:100000000,auto_renew:false},pair.first.session_token)).json;
		expect(refused).toMatchObject({success:false,error:'invalid_capacity_tier'});
	}
	const unchanged=(await get_json_with_session<any>('/api/crucible/contents',pair.first.session_token)).json.capacity;
	expect(unchanged).toMatchObject({base:500,expires_at:upgrade.capacity.expires_at,auto_renew:true});
	expect(await balance(pair.first_id)).toBe(900000000);
	expect((await get_json_with_session<any>('/api/crucible/contents',pair.second.session_token)).json.capacity.base).toBe(100);
	const wish=(await post_json<any>('/api/crucible/wish/make',body(1000,21000000),pair.first.session_token)).json;
	expect(wish.success).toBe(true);
	const toggle={command_id:crypto.randomUUID(),auto_renew:false,ep_micros:100000000};
	const disabled=(await post_json<any>('/api/crucible/wish/renewal',toggle,pair.first.session_token)).json;
	expect(disabled.capacity.auto_renew).toBe(false);
	expect(disabled.capacity.expires_at).toBe(upgrade.capacity.expires_at);
	expect(await balance(pair.first_id)).toBe(879000000);
	await db_run('UPDATE wish_capacities SET expires_at=? WHERE client_id=?',[Date.now()-1,pair.first_id]);
	expect((await post_json<any>('/api/crucible/wish/renewal',toggle,pair.first.session_token)).json).toEqual(disabled);
	expect((await get_json_with_session<any>('/api/crucible/contents',pair.first.session_token)).json.capacity.base).toBe(100);
	expect(await db_all('SELECT qty FROM crucible_wishes WHERE id=?',[wish.wish_id])).toEqual([{qty:1000}]);
	expect((await post_json<any>('/api/crucible/wish/capacity',{base:500,ep_micros:40000000,auto_renew:false},pair.first.session_token)).json.error).toBe('wish_quote_changed');
	expect(await balance(pair.first_id)).toBe(879000000);
});

test('older clients cannot start paid Wishes; legacy committed commands still replay without charging',async()=>{
	const player=await register_guild_client('Legacy Wish','Legacy Wish','1.6.9');await account([player.client_id]);
	expect((await post('/api/crucible/wish/make',body(),player.session_token)).status).toBe(400);
	const command_id=crypto.randomUUID();const response={success:true,wish_id:123};
	await db_run("INSERT INTO crucible_commands(id,client_id,kind,response_json,created_at) VALUES(?,?,'make',?,?)",[command_id,player.client_id,JSON.stringify(response),Date.now()]);
	expect((await post_json<any>('/api/crucible/wish/make',{command_id},player.session_token)).json).toEqual(response);
	expect(await balance(player.client_id)).toBe(1000000000);
});

test('released 1.6.10 Wishes retain server-only creation and replay without EP or GP charges', async () => {
	const player = await register_guild_client('Released Wish', 'Released Wish', '1.6.10');
	await account([player.client_id]);
	const input = { command_id: crypto.randomUUID(), item_id: 'melvorAoD:Torn_Parchment', qty: 100 };
	const make = () => post_json<any>('/api/crucible/wish/make', input, player.session_token);
	const [first, repeated] = await Promise.all([make(), make()]);
	expect(first.json.success).toBe(true);
	expect(first.json.receipt).toBeUndefined();
	expect(repeated.json).toEqual(first.json);
	expect(await balance(player.client_id)).toBe(1000000000);
	expect(await db_all('SELECT qty,required_gp,progress_gp,formation_points FROM crucible_wishes WHERE id=?', [first.json.wish_id]))
		.toEqual([{ qty: 100, required_gp: 50000, progress_gp: 0, formation_points: 0 }]);
	expect(await db_all('SELECT id FROM crucible_offerings WHERE guild_id=?', [player.guild_id])).toEqual([]);
	expect(await db_all('SELECT id FROM wish_ep_spends WHERE client_id=?', [player.client_id])).toEqual([]);
	expect(await db_all('SELECT currency_id FROM crucible_currency_locks WHERE guild_id=?', [player.guild_id])).toEqual([]);
	expect((await post_json<any>('/api/crucible/wish/cancel', {}, player.session_token)).json.success).toBe(true);
	// Replay a lost response after cancellation without recreating or charging for the Wish.
	expect((await make()).json).toEqual(first.json);
	expect(await db_all('SELECT id FROM crucible_wishes WHERE guild_id=?', [player.guild_id])).toEqual([]);
	expect((await post('/api/crucible/wish/make', { ...input, command_id: crypto.randomUUID(), qty: 101 }, player.session_token)).status).toBe(400);
	expect((await post('/api/crucible/wish/make', body(), player.session_token)).status).toBe(400);
	for (const kind of ['capacity', 'renewal'])
		expect((await post_json<any>(`/api/crucible/wish/${kind}`, { base: 200, ep_micros: 10000000, auto_renew: true }, player.session_token)).json)
			.toMatchObject({ success: false, error_lang: 'MOD_MP_UNSUPPORTED_VERSION_MESSAGE' });
	expect(await balance(player.client_id)).toBe(1000000000);
});

test('1.6.11 cannot omit payment quotes to create a free Wish', async () => {
	const player = await register_guild_client('Missing Quote', 'Missing Quote', '1.6.11');
	await account([player.client_id]);
	expect((await post('/api/crucible/wish/make', { item_id: 'melvorAoD:Torn_Parchment', qty: 1 }, player.session_token)).status).toBe(400);
	expect(await db_all('SELECT id FROM crucible_wishes WHERE guild_id=?', [player.guild_id])).toEqual([]);
	expect(await balance(player.client_id)).toBe(1000000000);
});

test('EP arriving after an unaffordable renewal does not silently revive it',async()=>{
	const player=await register_guild_client('Late EP','Late EP Guild','1.6.11');await account([player.client_id]);
	const registered=(await post_json<any>('/api/expedition/register',{operation_id:crypto.randomUUID()},player.session_token)).json;
	await db_run('UPDATE expedition_ep_balances SET points_micros=0 WHERE client_id=?',[player.client_id]);
	await db_run('INSERT INTO wish_capacities(client_id,base,expires_at,auto_renew) VALUES(?,200,?,1)',[player.client_id,Date.now()-1]);
	const earned=(await post_json<any>('/api/expedition/supply/donate',{command_id:crypto.randomUUID(),expedition_id:registered.expedition_id,
		item_id:'melvorD:Shrimp',qty:100000,source:'bank',value_currency_id:'melvorD:GP',value_per_item:2},player.session_token)).json;
	expect(earned.success).toBe(true);expect(earned.delta_micros).toBeGreaterThan(10000000);
	const state=(await get_json_with_session<any>('/api/crucible/contents',player.session_token)).json;
	expect(state.capacity).toMatchObject({base:100,auto_renew:false,renewal_paused:true,points_micros:earned.delta_micros});
	expect(await db_all('SELECT id FROM wish_ep_spends WHERE client_id=?',[player.client_id])).toEqual([]);
});

test('an Offering numeric overflow rolls back the EP debit and Wish creation',async()=>{
	const player=await register_guild_client('Wish Overflow','Wish Overflow','1.6.11');await account([player.client_id]);
	await post_json<any>('/api/crucible/cast',{source:'bank',items:[{id:'melvorD:GP',qty:1,value_currency_id:'melvorD:GP',value_per_item:1}]},player.session_token);
	await db_run('UPDATE crucible_offerings SET qty=? WHERE guild_id=? AND item_id=?',[Number.MAX_SAFE_INTEGER,player.guild_id,'melvorD:GP']);
	expect((await post('/api/crucible/wish/make',body(),player.session_token)).status).toBe(400);
	expect(await balance(player.client_id)).toBe(1000000000);
	expect(await db_all('SELECT id FROM crucible_wishes WHERE guild_id=?',[player.guild_id])).toEqual([]);
	expect(await db_all('SELECT id FROM wish_ep_spends WHERE client_id=?',[player.client_id])).toEqual([]);
});

test('actual mod actions recover a lost API response with exhausted EP and apply the GP receipt once',async()=>{
	const module_root='../../../mod/';
	const {install_crucible_actions}=await import(module_root+'client-crucible.mjs');
	const rules=await import(module_root+'crucible-rules.mjs');
	const {create_pending_economy_actions}=await import(module_root+'pending-economy-actions.mjs');
	const {apply_economy_receipt}=await import(module_root+'economy-receipts.mjs');
	const player=await register_guild_client('Wish Client Flow','Wish Client Flow','1.6.11');await account([player.client_id]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=1020000 WHERE client_id=?',[player.client_id]);
	const game={gp:{amount:100000000}};
	const state:any={is_guild_member:true,is_connected:true,is_social_only:false,crucible_wish_item_id:'melvorAoD:Torn_Parchment',
		crucible_wish_qty:101,eligible_crucible_wish_items:[{id:'melvorAoD:Torn_Parchment'}],crucible_wish_affordable:true,
		crucible_wish_ep_micros:rules.wish_price_micros(101,100),crucible_wish_gp_cost:rules.wish_gp_cost(50500)};
	const storage=new Map(),processed:string[]=[];let lose=true,online=true;const requests:any[]=[];
	const options={read:(key:string)=>storage.get(key),write:(key:string,value:any)=>storage.set(key,structuredClone(value)),remove:(key:string)=>storage.delete(key),uuid:()=>crypto.randomUUID(),
		post:async(endpoint:string,payload:any)=>{
			requests.push(structuredClone(payload));if(!online)return null;
			const result=(await post_json<any>(endpoint,payload,player.session_token)).json;
			if(lose){lose=false;online=false;return null;}return result;
		},
		reconcile:async(receipts:any[])=>receipts.every(receipt=>['applied','already-applied'].includes(apply_economy_receipt(receipt,processed,{
			get_gp:()=>game.gp.amount,remove_gp:(qty:number)=>{game.gp.amount-=qty;},get_transfer_inventory:()=>[],maximum_transfer_entries:6,persist_processed_ids(){}
		})))
	};
	let journal=create_pending_economy_actions(options);
	Object.assign(state,install_crucible_actions({state,game,
		run_pending_economy_action:(key:string,endpoint:string,payload:any)=>journal.run(key,endpoint,payload),
		recover_paid_wish_actions:async()=>{
			const pending=storage.get('pending_economy_action:crucible_wish_make');
			if(pending)await journal.run('crucible_wish_make',pending.endpoint,pending.payload);
		},
		api_get:async(endpoint:string)=>(await get_json_with_session<any>(endpoint,player.session_token)).json,
		filter_local_available_items:(rows:any[])=>rows,is_local_item_available:()=>true,update_crucible_nav(){},notify(){},notify_error(){},close_modal_and_wait:async()=>{}
	},rules));
	await state.refresh_crucible(true);await state.crucible_make_wish();
	expect(await balance(player.client_id)).toBe(0);expect(game.gp.amount).toBe(100000000);expect(storage.size).toBe(1);
	state.crucible_wish_affordable=false;state.crucible_wish_qty=1;online=true;journal=create_pending_economy_actions(options);
	await state.refresh_crucible(true);
	expect(storage.size).toBe(0);expect(game.gp.amount).toBe(99974750);expect(await balance(player.client_id)).toBe(0);
	expect(state.crucible.active_wish).toBe(true);expect(state.crucible.wishes.find((wish:any)=>wish.owned).qty).toBe(101);
	expect(requests[1]).toEqual(requests[0]);
	await state.refresh_crucible(true);expect(game.gp.amount).toBe(99974750);
	expect(await db_all('SELECT points_micros FROM wish_ep_spends WHERE client_id=?',[player.client_id])).toEqual([{points_micros:1020000}]);
});

test('odd funding requirements round GP upward and large payments bypass the ordinary Cast transfer cap',async()=>{
	const player=await register_guild_client('Exact Wish GP','Exact Wish GP','1.6.11');await account([player.client_id]);
	const odd=(await post_json<any>('/api/crucible/wish/make',{...body(),item_id:'melvorD:Frozen_Chest',gp:1723},player.session_token)).json;
	expect(odd).toMatchObject({success:true,paid_gp:1723});
	expect(await db_all('SELECT required_gp,progress_gp FROM crucible_wishes WHERE id=?',[odd.wish_id])).toEqual([{required_gp:3445,progress_gp:0}]);
	await post_json('/api/crucible/wish/cancel',{},player.session_token);
	const large=(await post_json<any>('/api/crucible/wish/make',{...body(70,700000),item_id:'melvorTotH:Cursed_Chest',gp:3500000000,gp_balance:3500000000},player.session_token)).json;
	expect(large).toMatchObject({success:true,paid_gp:3500000000});
	expect(large.receipt.effects).toEqual([{storage:'gp',qty:-3500000000}]);
	expect(await db_all('SELECT required_gp,progress_gp FROM crucible_wishes WHERE id=?',[large.wish_id])).toEqual([{required_gp:7000000000,progress_gp:0}]);
});
