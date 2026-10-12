import {record_character_save_load} from '../../character-save-loads';
import { expect, test } from 'bun:test';
import { register_guild_client as register_base_client, make_guildmates as make_base_pair } from '../support/fixtures';
import { post_json, get_json_with_session } from '../support/http';
import { db_all,db_run } from '../support/persistence';

async function capable<T extends {client_id:number;client_identifier:string;client_key:string;session_token:string}>(client:T):Promise<T> {
 const version=(await db_all<{mod_version:string|null}>('SELECT mod_version FROM client_sessions WHERE session_token=?',[client.session_token]))[0]?.mod_version??'1.6.9';
 const session=await post_json<any>('/api/authenticate',{client_identifier:client.client_identifier,client_key:client.client_key,
  client_runtime:{mod_version:version,active_mods:[],capabilities:['save-rollback-v1']}});
 return {...client,session_token:session.json.session_token};
}
async function register_guild_client(...args:Parameters<typeof register_base_client>) {return capable(await register_base_client(...args));}
async function make_guildmates(...args:Parameters<typeof make_base_pair>) {
 const pair=await make_base_pair(...args);return {...pair,first:await capable(pair.first),second:await capable(pair.second)};
}

test('restored same command retires stably without replacing its receipt; unrelated incoming recovery remains available',async()=>{
	const player=await register_guild_client('Retired Custody','Custody Guild','1.6.9');
	const supported=await post_json<any>('/api/authenticate',{client_identifier:player.client_identifier,client_key:player.client_key,client_runtime:{mod_version:'1.6.9',active_mods:[],capabilities:['save-rollback-v1']}});
	player.session_token=supported.json.session_token;
	const command=crypto.randomUUID();const item=`test:Custody_${command.replaceAll('-','')}`;
	const body={command_id:command,source:'bank',items:[{id:item,qty:3,value_currency_id:'melvorD:GP',value_per_item:1}]};
	const original=(await post_json<any>('/api/crucible/cast',body,player.session_token)).json;
	expect(original.success).toBe(true);
	const load=crypto.randomUUID();const now=Date.now();
	const fixture_db=new Database(process.env.TEST_DB_PATH!,{strict:true});
	try {record_character_save_load(fixture_db,player.client_id,{load_id:load,save_timestamp:null,client_loaded_at:now,capture_source:'decode'},now);} finally {fixture_db.close();}
	const observation=(await db_all<{id:number}>('SELECT id FROM economy_load_observations WHERE load_id=?',[load]))[0]!;
	await db_run('INSERT INTO economy_incidents(save_load_id,created_at,policy_version) VALUES(?,?,1)',[observation.id,now]);
	const incident=(await db_all<{id:number}>('SELECT id FROM economy_incidents WHERE save_load_id=?',[observation.id]))[0]!;
	const operation=(await db_all<{id:number}>('SELECT id FROM economy_operations WHERE source_key=?',[`receipt:${command}`]))[0]!;
	await db_run("INSERT INTO economy_corrections(incident_id,operation_id,lot_key,object_id,quantity,disposition,reason,decided_at,policy_version) VALUES(?,?,?,?,3,'invalidated','isolated-protocol-test',?,1)",[incident.id,operation.id,'test-retired',item,now]);
	await db_run("INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty,created_at,updated_at) VALUES(?,'gift','Accepted Gift','test:Incoming',5,?,?)",[player.client_id,now,now]);
	const replies=await Promise.all([post_json<any>('/api/crucible/cast',body,player.session_token),post_json<any>('/api/crucible/cast',{command_id:command,source:'invalid'},player.session_token)]);
	for(const response of replies) expect(response.json).toEqual({success:false,error:'economy_command_retired',retired_command_id:command,receipt:null});
	const pending=(await get_json_with_session<any>('/api/events',player.session_token)).json;
	expect(pending.economy_receipts).not.toContainEqual(original.receipt);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[player.client_id,'test:Incoming'])).toEqual([{qty:5}]);
	const retained=(await db_all<{response_json:string}>('SELECT response_json FROM economy_receipts WHERE id=?',[command]))[0]!;
	expect(JSON.parse(retained.response_json)).toEqual(original);
});

test('manual claim racing due automatic delivery issues only one protected Wish entitlement and keeps terminal funding',async()=>{
	const player=await register_guild_client('Wish Delivery Race','Wish Race Guild','1.6.11');
	const account=crypto.randomUUID();const now=Date.now();
	await db_run('INSERT INTO melvor_accounts(cloud_username,playfab_id,created_at) VALUES(?,?,?)',['race',account,now]);
	const owner=(await db_all<{id:number}>('SELECT id FROM melvor_accounts WHERE playfab_id=?',[account]))[0]!;
	await db_run('UPDATE clients SET melvor_account_id=? WHERE id=?',[owner.id,player.client_id]);
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,1000000)',[player.client_id]);
	const made=(await post_json<any>('/api/crucible/wish/make',{command_id:crypto.randomUUID(),item_id:'melvorAoD:Torn_Parchment',qty:1,ep_micros:10000,gp:250,gp_balance:1000000},player.session_token)).json;
	expect(made.success).toBe(true);
	await db_run('UPDATE crucible_wishes SET formation_points=10080,progress_gp=required_gp,melded_at=?,auto_deliver_at=? WHERE id=?',[now-100000,now-1,made.wish_id]);
	await Promise.all([post_json<any>('/api/crucible/wish/claim',{command_id:crypto.randomUUID()},player.session_token),get_json_with_session<any>('/api/crucible/contents',player.session_token)]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND source_name=?',[player.client_id,'Wish Granted'])).toEqual([{qty:1}]);
	expect(await db_all('SELECT quantity FROM economy_dependency_evidence WHERE kind=? AND json_extract(snapshot_json,\'$.wish_id\')=?',['wish-delivered',made.wish_id])).toEqual([{quantity:1}]);
	expect(await db_all('SELECT phase FROM economy_terminal_snapshots WHERE table_name=? AND row_id=? ORDER BY id',['crucible_wishes',made.wish_id])).toEqual([{phase:'source'},{phase:'terminal'}]);
});

test('Gift acceptance protects each root before acknowledgement; declined roots follow merged Inbox and claim boundary',async()=>{
	const pair=await make_guildmates('Gift Custody Sender','Gift Custody Recipient');
	const item=`test:GiftCustody_${crypto.randomUUID().replaceAll('-','')}`;
	const command=crypto.randomUUID();
	const sent=(await post_json<any>('/api/gift/send',{command_id:command,recipient_id:pair.second_id,items:[{id:item,qty:2},{id:item,qty:3}]},pair.first.session_token)).json;
	expect(sent.success).toBe(true);
	const rows=await db_all<{gift_id:number}>('SELECT gift_id FROM gifts WHERE sender_id=?',[pair.first_id]);
	const id=rows[0]!.gift_id;
	expect(await db_all('SELECT quantity FROM economy_custody_sources WHERE operation_key=?',[`receipt:${command}`])).toEqual([{quantity:5}]);
	await post_json('/api/gift/accept',{command_id:crypto.randomUUID(),gift_id:id},pair.second.session_token);
	expect((await db_all<{location:string;quantity:number}>('SELECT location,quantity FROM economy_custody_balances WHERE root_key=?',[`gift:${id}:${item}`]))[0]!.location.startsWith('protected:')).toBe(true);
	const command2=crypto.randomUUID();
	await post_json('/api/gift/send',{command_id:command2,recipient_id:pair.second_id,items:[{id:item,qty:3}]},pair.first.session_token);
	const returned=(await db_all<{gift_id:number}>('SELECT gift_id FROM gifts WHERE sender_id=?',[pair.first_id]))[0]!.gift_id;
	await post_json('/api/gift/decline',{command_id:crypto.randomUUID(),gift_id:returned},pair.second.session_token);
	expect((await db_all<{location:string}>('SELECT location FROM economy_custody_balances WHERE root_key=?',[`gift:${returned}:${item}`]))[0]!.location.startsWith('inbox:')).toBe(true);
	const claimed=(await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.first.session_token)).json;
	expect(claimed.claim).toBeTruthy();
	expect((await db_all<{location:string}>('SELECT location FROM economy_custody_balances WHERE root_key=?',[`gift:${returned}:${item}`]))[0]!.location.startsWith('protected:inbox-claim:')).toBe(true);
});

test('Social Only Gift cleanup moves duplicate item roots into the sender return before deleting escrow',async()=>{
	const pair=await make_guildmates('Social Custody Sender','Social Custody Peer');
	const item=`test:SocialCustody_${crypto.randomUUID().replaceAll('-','')}`;
	await post_json('/api/gift/send',{command_id:crypto.randomUUID(),recipient_id:pair.second_id,items:[{id:item,qty:2},{id:item,qty:3}]},pair.first.session_token);
	const gift=(await db_all<{gift_id:number}>('SELECT gift_id FROM gifts WHERE sender_id=?',[pair.first_id]))[0]!.gift_id;
	const changed=(await post_json<any>('/api/social-mode/set',{mode:'social',command_id:crypto.randomUUID()},pair.second.session_token)).json;
	expect(changed.success).toBe(true);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.first_id,item])).toEqual([{qty:5}]);
	expect(await db_all('SELECT location,quantity FROM economy_custody_balances WHERE root_key=?',[`gift:${gift}:${item}`])).toEqual([
		{location:'inbox:'+JSON.stringify([pair.first_id,'gift_returned','',item]),quantity:5}]);
});

test('Marketplace merged deposits retain separate immutable commands and settled purchases/fills protect counterparty principal',async()=>{
	const pair=await make_guildmates('Market Custody Seller','Market Custody Buyer');
	const item=`test:MarketCustody_${crypto.randomUUID().replaceAll('-','')}`;
	const commands=[crypto.randomUUID(),crypto.randomUUID()];
	for(const command_id of commands) {
		const result=(await post_json<any>('/api/market/sell',{command_id,item_id:item,item_qty:4,item_sell_price:10},pair.first.session_token)).json;
		expect(result.success).toBe(true);
	}
	const lot=(await db_all<{id:number}>('SELECT id FROM market_items WHERE client_id=? AND item_id=?',[pair.first_id,item]))[0]!;
	for(const command_id of commands) expect(await db_all('SELECT quantity FROM economy_custody_sources WHERE operation_key=?',[`receipt:${command_id}`])).toEqual([{quantity:4}]);
	const payment=crypto.randomUUID();
	const bought=(await post_json<any>('/api/market/buy',{command_id:payment,id:lot.id,qty:3},pair.second.session_token)).json;
	expect(bought.success).toBe(true);
	await post_json('/api/market/buy',{command_id:payment,id:lot.id,qty:3},pair.second.session_token);
	expect(await db_all('SELECT quantity,location FROM economy_custody_balances WHERE root_key=?',[`market-payment:${payment}`])).toEqual([{quantity:30,location:`protected:market-payment:${payment}`}]);
	const escrow=crypto.randomUUID();
	await post_json('/api/market/buy-order',{command_id:escrow,item_id:item,item_qty:5,item_buy_price:7},pair.second.session_token);
	const order=(await db_all<{id:number}>('SELECT id FROM market_items WHERE client_id=? AND item_id=? AND direction=\'buy\'',[pair.second_id,item]))[0]!;
	const fill=crypto.randomUUID();
	expect((await post_json<any>('/api/market/fulfill',{command_id:fill,id:order.id,qty:2},pair.first.session_token)).json.success).toBe(true);
	expect(await db_all('SELECT quantity,location FROM economy_custody_balances WHERE root_key=?',[`market-fill:${fill}`])).toEqual([{quantity:2,location:`protected:market-fill:${fill}`}]);
	expect(await db_all('SELECT quantity FROM economy_custody_sources WHERE root_key=?',[`market-escrow:${escrow}`])).toEqual([{quantity:35}]);
	expect((await db_all<{phase:string}>('SELECT phase FROM economy_terminal_snapshots WHERE table_name=\'market_items\' AND row_id=? ORDER BY id',[lot.id])).map(row=>row.phase)).toEqual(['source','terminal','terminal']);
});

import { Database } from 'bun:sqlite';
import { correct_custody_operation } from '../../economy-correction';

/** Isolated service approval fixture; detection/calibration algorithms have separate unit coverage. */
function approved_market_correction(client:number,command:string) {
	const db=new Database(process.env.TEST_DB_PATH!,{strict:true});
	db.run('PRAGMA busy_timeout=5000');db.run('PRAGMA foreign_keys=ON');
	try {return db.transaction(()=>{
		const now=Date.now();
		const operation=db.query<{id:number},[string]>('SELECT id FROM economy_operations WHERE source_key=?').get(`receipt:${command}`)!.id;
		const load=record_character_save_load(db,client,{load_id:crypto.randomUUID(),save_timestamp:null,client_loaded_at:0,capture_source:'decode'},now)!;
		const evidence=db.query<{id:number},[number,number]>("INSERT INTO economy_clock_evidence(save_load_id,recorded_at,client_sent_at,client_received_at,elapsed_ms,cutoff_lower,cutoff_upper,quality,reason) VALUES(?,?,0,0,0,0,0,'calibrated','isolated-approval-fixture') RETURNING id").get(load,now)!.id;
		const incident=db.query<{id:number},[number,number]>('INSERT INTO economy_incidents(save_load_id,created_at,policy_version) VALUES(?,?,1) RETURNING id').get(load,now)!.id;
		db.query("INSERT INTO economy_incident_candidates VALUES(?,?,?,'after_cutoff')").run(incident,operation,evidence);
		db.query("INSERT INTO economy_candidate_assessments VALUES(?,?,?,'after_cutoff')").run(incident,operation,evidence);
		db.query("INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at) VALUES(?,'confirmed','isolated-approved',?)").run(incident,now);
		return {incident,operation,activation:{enabled:true,first_operation_id:operation,policy_version:1}};
	}).immediate();}finally{db.close();}
}
function apply_market_correction(input:ReturnType<typeof approved_market_correction>) {
	const db=new Database(process.env.TEST_DB_PATH!,{strict:true});db.run('PRAGMA busy_timeout=5000');db.run('PRAGMA foreign_keys=ON');
	try{return correct_custody_operation(db,input.incident,input.operation,input.activation);}finally{db.close();}
}
async function market_pair() {
	const pair=await make_guildmates('Rollback Market Seller','Rollback Market Buyer','Rollback Market',{first:'1.6.9',second:'1.6.9'});
	const item=`test:Market_${crypto.randomUUID().replaceAll('-','')}`;const command=crypto.randomUUID();
	expect((await post_json<any>('/api/market/sell',{command_id:command,item_id:item,item_qty:10,item_sell_price:7,purchase_limit:10},pair.first.session_token)).json.success).toBe(true);
	const lot=(await db_all<{id:number}>('SELECT id FROM market_items WHERE client_id=? AND item_id=?',[pair.first_id,item]))[0]!.id;
	return {pair,item,command,lot};
}

test('seller correction holds own exact proceeds, preserves buyer Inbox and limits, and stable replay cannot cancel-refund invalid stock',async()=>{
	const {pair,item,command,lot}=await market_pair();
	const payment=crypto.randomUUID();
	expect((await post_json<any>('/api/market/buy',{command_id:payment,id:lot,qty:4},pair.second.session_token)).json.success).toBe(true);
	const approval=approved_market_correction(pair.first_id,command);
	expect(apply_market_correction(approval).applied).toBe(true);
	expect(await db_all('SELECT qty,available,payout,haggled FROM market_items WHERE id=?',[lot])).toEqual([{qty:10,available:0,payout:28,haggled:6}]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual([{qty:4}]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND source_type=?',[pair.first_id,'market_sold'])).toEqual([]);
	expect(await db_all('SELECT qty FROM market_purchases WHERE listing_id=?',[lot])).toEqual([{qty:4}]);
	const replay=(await post_json<any>('/api/market/sell',{command_id:command,item_id:item,item_qty:10,item_sell_price:7,purchase_limit:10},pair.first.session_token)).json;
	expect(replay.error).toBe('economy_command_retired');
	expect((await post_json<any>('/api/market/cancel',{command_id:crypto.randomUUID(),id:lot},pair.first.session_token)).json).toMatchObject({success:true,item_qty:0,payout:0});
	expect(await db_all('SELECT * FROM inbox_items WHERE client_id=? AND source_type=?',[pair.first_id,'market_cancelled'])).toEqual([]);
	expect(apply_market_correction(approval).applied).toBe(false);
});

test('buyer correction holds only its unissued purchase and protects seller payment before any acknowledgement',async()=>{
	const {pair,item,lot}=await market_pair();const payment=crypto.randomUUID();
	await post_json('/api/market/buy',{command_id:payment,id:lot,qty:4},pair.second.session_token);
	expect(apply_market_correction(approved_market_correction(pair.second_id,payment)).applied).toBe(true);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual([]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND source_type=?',[pair.first_id,'market_sold'])).toEqual([{qty:28}]);
	expect(await db_all('SELECT quantity,location FROM economy_custody_balances WHERE root_key=?',[`market-payment:${payment}`])).toEqual([{quantity:28,location:`protected:market-payment:${payment}`}]);
});

test('issued buyer Inbox claim survives correction with lost reply and preserved claim snapshot',async()=>{
	const {pair,item,lot}=await market_pair();const payment=crypto.randomUUID();
	await post_json('/api/market/buy',{command_id:payment,id:lot,qty:4},pair.second.session_token);
	const claimed=(await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.second.session_token)).json;
	expect(claimed.claim).toBeTruthy();
	expect(apply_market_correction(approved_market_correction(pair.second_id,payment)).applied).toBe(true);
	const replay=(await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.second.session_token)).json;
	expect(replay.claim).toEqual(claimed.claim);
	expect((await db_all<{disposition:string}>('SELECT disposition FROM economy_corrections WHERE object_id=? AND operation_id=(SELECT id FROM economy_operations WHERE source_key=?)',[item,`receipt:${payment}`])).map(r=>r.disposition)).toEqual(['protected']);
});

test('Haggle opening rollback invalidates payer escrow and restores owner stock once; terminal replay cannot re-reserve',async()=>{
	const {pair,lot}=await market_pair();const command=crypto.randomUUID();
	const h=(await post_json<any>('/api/market/haggle',{command_id:command,id:lot,qty:4,price:5},pair.second.session_token)).json;
	expect(h.success).toBe(true);
	expect(apply_market_correction(approved_market_correction(pair.second_id,command)).applied).toBe(true);
	expect(await db_all('SELECT available,reserved FROM market_items WHERE id=?',[lot])).toEqual([{available:10,reserved:0}]);
	expect(await db_all('SELECT * FROM market_haggle_claims WHERE haggle_id=?',[h.haggle_id])).toEqual([]);
	expect((await post_json<any>('/api/market/haggle',{command_id:command,id:lot,qty:4,price:5},pair.second.session_token)).json.error).toBe('economy_command_retired');
	expect(await db_all('SELECT status FROM market_haggles WHERE id=?',[h.haggle_id])).toEqual([{status:'cancelled'}]);
});

test('Haggle revision topups, mixed item boundaries and own surplus remain separately attributable through accepted claims',async()=>{
	const {pair,item,lot}=await market_pair();const opening=crypto.randomUUID();
	const h=(await post_json<any>('/api/market/haggle',{command_id:opening,id:lot,qty:3,price:5},pair.second.session_token)).json;
	await post_json('/api/market/haggle/counter',{command_id:crypto.randomUUID(),id:h.haggle_id,revision:1,price:7},pair.first.session_token);
	const topup=crypto.randomUUID();const accept={command_id:topup,id:h.haggle_id,revision:2};
	expect((await post_json<any>('/api/market/haggle/accept',accept,pair.second.session_token)).json.success).toBe(true);
	await post_json('/api/market/haggle/accept',accept,pair.second.session_token);
	expect(await db_all('SELECT quantity FROM economy_custody_sources WHERE operation_key=?',[`receipt:${topup}`])).toEqual([{quantity:6}]);
	expect(apply_market_correction(approved_market_correction(pair.second_id,opening)).applied).toBe(true);
	expect(await db_all('SELECT item_qty FROM market_haggle_claims WHERE haggle_id=? AND client_id=?',[h.haggle_id,pair.second_id])).toEqual([{item_qty:1}]);
	expect(await db_all('SELECT gp FROM market_haggle_claims WHERE haggle_id=? AND client_id=?',[h.haggle_id,pair.first_id])).toEqual([{gp:21}]);
	expect((await post_json<any>('/api/market/haggle/claim',{command_id:crypto.randomUUID(),id:h.haggle_id},pair.second.session_token)).json.success).toBe(true);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual([{qty:1}]);
	expect(await db_all('SELECT qty FROM market_purchases WHERE listing_id=?',[lot])).toEqual([{qty:3}]);
});

async function race_market_correction(input:ReturnType<typeof approved_market_correction>,request:()=>Promise<unknown>) {
	const script=`import {Database} from 'bun:sqlite';import {correct_custody_operation} from './economy-correction';
		const db=new Database(process.env.TEST_DB_PATH,{strict:true});db.run('PRAGMA busy_timeout=5000');db.run('PRAGMA foreign_keys=ON');
		process.stdout.write('ready\\n');for await(const chunk of process.stdin){if(chunk.length)break;}
		const i=JSON.parse(process.env.MARKET_RACE_INPUT);process.stdout.write(JSON.stringify(correct_custody_operation(db,i.incident,i.operation,i.activation))+'\\n');db.close();`;
	const child=Bun.spawn({cmd:['bun','--eval',script],cwd:process.cwd(),env:{...process.env,MARKET_RACE_INPUT:JSON.stringify(input)},stdin:'pipe',stdout:'pipe',stderr:'pipe'});
	const reader=child.stdout.getReader();let output='';
	while(!output.includes('ready\n')) {const part=await reader.read();if(part.done) throw new Error(await new Response(child.stderr).text());output+=new TextDecoder().decode(part.value);}
	const response=request();child.stdin.write('go\n');child.stdin.end();
	while(true){const part=await reader.read();if(part.done)break;output+=new TextDecoder().decode(part.value);}
	expect(await child.exited,await new Response(child.stderr).text()).toBe(0);
	expect(JSON.parse(output.split('\n')[1]!).applied).toBe(true);
	return response;
}

test('independent Marketplace correction serializes against HTTP purchase and reservation without stock reuse',async()=>{
	for(const path of ['/api/market/buy','/api/market/haggle']) {
		const {pair,item,command,lot}=await market_pair();
		const approval=approved_market_correction(pair.first_id,command);
		const response=await race_market_correction(approval,()=>post_json<any>(path,{command_id:crypto.randomUUID(),id:lot,qty:3,price:5},pair.second.session_token)) as {json:{success?:boolean;haggle_id?:string}};
		const row=(await db_all<{available:number;reserved:number;haggled:number}>('SELECT available,reserved,haggled FROM market_items WHERE id=?',[lot]))[0]!;
		expect(row.available).toBe(0);expect(row.reserved).toBe(0);
		if(path==='/api/market/buy') {
			expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual(response.json.success?[{qty:3}]:[]);
			expect(row.haggled).toBe(response.json.success?7:10);
		} else {
			expect(await db_all('SELECT * FROM market_haggles WHERE listing_ref=? AND status=?',[lot,'active'])).toEqual([]);
			if(response.json.success) expect(await db_all('SELECT gp FROM market_haggle_claims WHERE haggle_id=? AND client_id=?',[response.json.haggle_id!,pair.second_id])).toEqual([{gp:15}]);
		}
		expect(apply_market_correction(approval).applied).toBe(false);
		expect((await db_all<{quantity:number}>('SELECT quantity FROM economy_custody_balances WHERE root_key=?',[`market-stock:${command}`])).reduce((n,r)=>n+r.quantity,0)).toBe(10);
	}
},15000);

test('independent buyer correction serializes against Inbox claim issuance and never revokes an issued snapshot',async()=>{
	const {pair,item,lot}=await market_pair();const payment=crypto.randomUUID();
	await post_json('/api/market/buy',{command_id:payment,id:lot,qty:4},pair.second.session_token);
	const approval=approved_market_correction(pair.second_id,payment);
	const response=await race_market_correction(approval,()=>post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.second.session_token)) as {json:{claim:unknown}};
	const dispositions=await db_all<{disposition:string}>('SELECT disposition FROM economy_corrections WHERE operation_id=? AND object_id=?',[approval.operation,item]);
	expect(dispositions).toEqual([{disposition:response.json.claim?'protected':'held'}]);
	if(response.json.claim) expect((await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.second.session_token)).json.claim).toEqual(response.json.claim);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND source_type=?',[pair.first_id,'market_sold'])).toEqual([{qty:28}]);
},15000);

test('cancel, destroy, expiry and Social Only returns retain eligible stock roots and correction excludes invalid principal once',async()=>{
	for(const mode of ['cancel','destroy','expiry','social']) {
		const {pair,item,command,lot}=await market_pair();
		if(mode==='expiry') {
			await db_run('UPDATE market_items SET updated_at=? WHERE id=?',[Date.now()-15*24*60*60*1000,lot]);
			await get_json_with_session('/api/market/listings',pair.first.session_token);
		} else if(mode==='social') await post_json('/api/social-mode/set',{mode:'social',command_id:crypto.randomUUID()},pair.first.session_token);
		else await post_json(`/api/market/${mode}`,{id:lot,command_id:crypto.randomUUID()},pair.first.session_token);
		const balances=await db_all<{location:string;quantity:number}>('SELECT location,quantity FROM economy_custody_balances WHERE root_key=?',[`market-stock:${command}`]);
		expect(balances[0]!.location.startsWith('inbox:')).toBe(true);expect(balances[0]!.quantity).toBe(10);
		const approval=approved_market_correction(pair.first_id,command);
		expect(apply_market_correction(approval).applied).toBe(true);
		expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.first_id,item])).toEqual([]);
		expect(apply_market_correction(approval).applied).toBe(false);
	}
});

test('Banishment keeps exact Buy Order GP custody; unissued returns correct once and issued GP claims remain protected',async()=>{
	const {make_guild_group}=await import('../support/fixtures');
	for(const issue of [false,true]) {
		const [petitioner,target,voter,other]=await make_guild_group(['Market Ban Petitioner','Market Ban Target','Market Ban Voter','Market Ban Peer'],'Market Ban Guild','1.6.9');
		const command=crypto.randomUUID();const item=`test:BanishMarket_${command.replaceAll('-','')}`;
		await post_json('/api/market/buy-order',{command_id:command,item_id:item,item_qty:3,item_buy_price:7},target.session_token);
		const petition=(await post_json<any>('/api/guilds/petitions/raise',{type:'banishment',target_client_id:target.client_id},petitioner.session_token)).json;
		for(const player of [petitioner,voter,other]) await post_json('/api/guilds/petitions/vote',{petition_id:petition.petition_id,choice:'aye'},player.session_token);
		await post_json('/api/guilds/petitions/vote',{petition_id:petition.petition_id,choice:'nay'},target.session_token);
		const root=`market-escrow:${command}`;
		expect((await db_all<{location:string}>('SELECT location FROM economy_custody_balances WHERE root_key=?',[root]))[0]!.location.startsWith('banishment-return:')).toBe(true);
		let claim:any;
		if(issue) {
			claim=(await post_json<any>('/api/banishment/returns/claim',{existing_item_ids:['melvorD:GP'],available_slots:0},target.session_token)).json.claim;
			expect(claim.gp).toBe(21);
		}
		const approval=approved_market_correction(target.client_id,command);
		expect(apply_market_correction(approval).applied).toBe(true);
		expect((await db_all<{location:string}>('SELECT location FROM economy_custody_balances WHERE root_key=?',[root]))[0]!.location).toBe(issue?`protected:banishment-claim:${claim.claim_id}`:'invalidated');
		if(issue) expect((await post_json<any>('/api/banishment/returns/claim',{existing_item_ids:[],available_slots:0},target.session_token)).json.claim).toEqual(claim);
		else expect(await db_all('SELECT gp FROM banishment_returns WHERE client_id=?',[target.client_id])).toEqual([{gp:0}]);
		expect(apply_market_correction(approval).applied).toBe(false);
	}
});

test('identity-deletion GP claim protects Marketplace roots before acknowledgement and replays its immutable snapshot',async()=>{
	const {pair,command,lot}=await market_pair();
	// Fixture moves an exact listing return into the identity-deletion store; real cleanup is covered at service level.
	const now=Date.now();const request_id=crypto.randomUUID();
	await db_run('INSERT INTO client_deletion_requests(target_client_id,requester_client_id,requested_at,execute_at) VALUES(?,?,?,?)',[pair.first_id,pair.second_id,now,now+100000]);
	const request=(await db_all<{id:number}>('SELECT id FROM client_deletion_requests WHERE target_client_id=?',[pair.first_id]))[0]!.id;
	await db_run('INSERT INTO client_deletion_returns(request_id,client_id,source_display_name,gp,created_at) VALUES(?,?,?,10,?)',[request,pair.first_id,'test',now]);
	const returned=(await db_all<{id:number}>('SELECT id FROM client_deletion_returns WHERE request_id=?',[request]))[0]!.id;
	// Use a separate exact currency source; the listing source continues to test ordinary stock correction.
	const db=new Database(process.env.TEST_DB_PATH!,{strict:true});
	try {
		const {create_custody_source}=await import('../../economy-custody');
		db.transaction(()=>create_custody_source(db,{root_key:`deletion-gp:${request_id}`,operation_key:`receipt:${command}`,client_id:pair.first_id,object_id:'melvorD:GP',quantity:10,created_at:now,snapshot:{fixture:true}},`deletion-return:${returned}:melvorD:GP`)).immediate();
	}finally{db.close();}
	const claim=(await post_json<any>('/api/banishment/returns/claim',{existing_item_ids:['melvorD:GP'],available_slots:0},pair.first.session_token)).json.claim;
	expect(claim.gp).toBe(10);
	expect(apply_market_correction(approved_market_correction(pair.first_id,command)).applied).toBe(true);
	expect(await db_all('SELECT location FROM economy_custody_balances WHERE root_key=?',[`deletion-gp:${request_id}`])).toEqual([{location:`protected:deletion-claim:${claim.claim_id}`}]);
	expect((await post_json<any>('/api/banishment/returns/claim',{existing_item_ids:[],available_slots:0},pair.first.session_token)).json.claim).toEqual(claim);
});

test('independent Haggle correction serializes against acceptance, preserving settlement or restoring valid escrow once',async()=>{
	const {pair,item,lot}=await market_pair();const command=crypto.randomUUID();
	const h=(await post_json<any>('/api/market/haggle',{command_id:command,id:lot,qty:3,price:5},pair.second.session_token)).json;
	const approval=approved_market_correction(pair.second_id,command);
	const response=await race_market_correction(approval,()=>post_json<any>('/api/market/haggle/accept',{command_id:crypto.randomUUID(),id:h.haggle_id,revision:1},pair.first.session_token)) as {json:{success?:boolean}};
	const settled=response.json.success===true;
	expect(await db_all('SELECT status FROM market_haggles WHERE id=?',[h.haggle_id])).toEqual([{status:settled?'accepted':'cancelled'}]);
	expect(await db_all('SELECT available,reserved FROM market_items WHERE id=?',[lot])).toEqual([{available:settled?7:10,reserved:0}]);
	expect(await db_all('SELECT gp FROM market_haggle_claims WHERE haggle_id=? AND client_id=?',[h.haggle_id,pair.first_id])).toEqual(settled?[{gp:15}]:[]);
	expect(await db_all('SELECT item_qty FROM market_haggle_claims WHERE haggle_id=? AND client_id=?',[h.haggle_id,pair.second_id])).toEqual([]);
	expect(apply_market_correction(approval).applied).toBe(false);
},15000);

test('independent Buy Order correction serializes against fill and cannot refund invalid prepaid GP',async()=>{
	const {pair,item}=await market_pair();const command=crypto.randomUUID();
	await post_json('/api/market/buy-order',{command_id:command,item_id:item,item_qty:5,item_buy_price:7},pair.second.session_token);
	const lot=(await db_all<{id:number}>('SELECT id FROM market_items WHERE client_id=? AND direction=?',[pair.second_id,'buy']))[0]!.id;
	const approval=approved_market_correction(pair.second_id,command);
	const response=await race_market_correction(approval,()=>post_json<any>('/api/market/fulfill',{command_id:crypto.randomUUID(),id:lot,qty:2},pair.first.session_token)) as {json:{success?:boolean}};
	expect(await db_all('SELECT available,escrow_gp FROM market_items WHERE id=?',[lot])).toEqual([{available:0,escrow_gp:0}]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND source_type=?',[pair.first_id,'market_sold'])).toEqual(response.json.success?[{qty:14}]:[]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual([]);
	expect((await post_json<any>('/api/market/cancel',{command_id:crypto.randomUUID(),id:lot},pair.second.session_token)).json.gp_refund).toBe(0);
	expect(apply_market_correction(approval).applied).toBe(false);
},15000);

async function trade_pair(legacy=false) {
	const pair=await make_guildmates('Rollback Trade Sender','Rollback Trade Counter','Rollback Trade',{first:'1.6.9',second:'1.6.9'});
	const item=`test:Trade_${crypto.randomUUID().replaceAll('-','')}`;
	const command=crypto.randomUUID();
	const body={command_id:command,recipient_id:pair.second_id,items:[{id:item,qty:2},{id:item,qty:3}]};
	const offered=(await post_json<any>('/api/trade/offer',body,pair.first.session_token)).json;
	expect(offered.success).toBe(true);
	if(legacy) await db_run('INSERT INTO client_runtime_snapshots(client_id,mod_version,active_mods,reported_at) VALUES(?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET mod_version=excluded.mod_version',[pair.first_id,'1.4.5','[]',Date.now()]);
	return {pair,item,command,body,trade:offered.trade_id as number,original:offered};
}

test('Trade additive counter commands retain separate roots; correcting one returns every unrelated row once',async()=>{
	const {pair,item,trade,command,body,original}=await trade_pair();
	const counters=[crypto.randomUUID(),crypto.randomUUID()];
	for(const command_id of counters) expect((await post_json<any>('/api/trade/counter',{command_id,trade_id:trade,items:[{id:item,qty:7}]},pair.second.session_token)).json.success).toBe(true);
	expect(await db_all('SELECT qty FROM trade_items WHERE trade_id=? AND counter=1',[trade])).toEqual([{qty:7},{qty:7}]);
	const approval=approved_market_correction(pair.second_id,counters[1]!);
	expect(apply_market_correction(approval).applied).toBe(true);
	expect(await db_all('SELECT client_id,qty FROM inbox_items WHERE item_id=? ORDER BY client_id',[item])).toEqual([{client_id:pair.first_id,qty:5},{client_id:pair.second_id,qty:7}]);
	expect((await post_json<any>('/api/trade/counter',{command_id:counters[1],trade_id:trade,items:[]},pair.second.session_token)).json.error).toBe('economy_command_retired');
	expect((await post_json<any>('/api/trade/offer',body,pair.first.session_token)).json).toEqual(original);
	expect(await db_all('SELECT quantity FROM economy_custody_sources WHERE operation_key=?',[`receipt:${command}`])).toEqual([{quantity:2},{quantity:3}]);
	expect(apply_market_correction(approval).applied).toBe(false);
});

test('modern accepted Trade protects counterparty delivery and holds only exact actor unissued benefit; incoming recovery remains valid',async()=>{
	const {pair,item,trade,command,body,original}=await trade_pair();const counter=crypto.randomUUID();const reward=item+'Reward';
	await post_json('/api/trade/counter',{command_id:counter,trade_id:trade,items:[{id:reward,qty:17}]},pair.second.session_token);
	await post_json('/api/trade/accept',{command_id:crypto.randomUUID(),trade_id:trade},pair.first.session_token);
	const approval=approved_market_correction(pair.first_id,command);
	expect(apply_market_correction(approval).applied).toBe(true);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual([{qty:5}]);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.first_id,reward])).toEqual([]);
	expect(await db_all("SELECT quantity FROM economy_custody_balances WHERE location='held' AND root_key LIKE ?",[`trade-benefit:${trade}:${pair.first_id}:%`])).toEqual([{quantity:17}]);
	expect((await post_json<any>('/api/trade/offer',body,pair.first.session_token)).json.error).toBe('economy_command_retired');
	expect(JSON.parse((await db_all<{response_json:string}>('SELECT response_json FROM economy_receipts WHERE id=?',[command]))[0]!.response_json)).toEqual(original);
	const claim=(await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.second.session_token)).json.claim;
	expect(claim.items).toEqual([{id:item,qty:5}]);
	expect(apply_market_correction(approval).applied).toBe(false);
});

test('Trade valid cancellation and Social Only duplicate returns preserve custody through lost-response Inbox claim',async()=>{
	for(const mode of ['cancel','decline','social']) {
		const {pair,item,trade,command}=await trade_pair();
		if(mode==='social') await post_json('/api/social-mode/set',{mode:'social',command_id:crypto.randomUUID()},pair.second.session_token);
		else await post_json(`/api/trade/${mode}`,{trade_id:trade,command_id:crypto.randomUUID()},mode==='cancel'?pair.first.session_token:pair.second.session_token);
		const claimed=(await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.first.session_token)).json.claim;
		expect(claimed.items).toEqual([{id:item,qty:5}]);
		expect(apply_market_correction(approved_market_correction(pair.first_id,command)).applied).toBe(true);
		expect((await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.first.session_token)).json.claim).toEqual(claimed);
		expect((await db_all<{location:string}>('SELECT b.location FROM economy_custody_balances b JOIN economy_custody_sources s ON s.root_key=b.root_key WHERE s.operation_key=?',[`receipt:${command}`])).every(r=>r.location.startsWith('protected:'))).toBe(true);
	}
});

test('independent Trade correction serializes against accept, cancel and decline without invalid principal refunds',async()=>{
	for(const action of ['accept','cancel','decline']) {
		const {pair,item,trade,command}=await trade_pair();const reward=item+'Counter';
		await post_json('/api/trade/counter',{command_id:crypto.randomUUID(),trade_id:trade,items:[{id:reward,qty:11}]},pair.second.session_token);
		const approval=approved_market_correction(pair.first_id,command);
		const reply=await race_market_correction(approval,()=>post_json<any>(`/api/trade/${action}`,{trade_id:trade,command_id:crypto.randomUUID()},action==='cancel'?pair.second.session_token:pair.first.session_token)) as {json:{success?:boolean}};
		const settled=action==='accept' && reply.json.success===true;
		expect(await db_all('SELECT * FROM trade_offers WHERE trade_id=?',[trade])).toEqual([]);
		expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.first_id,item])).toEqual([]);
		expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.first_id,reward])).toEqual([]);
		expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual(settled?[{qty:5}]:[]);
		expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,reward])).toEqual(settled?[]:[{qty:11}]);
		expect(apply_market_correction(approval).applied).toBe(false);
	}
},15000);

test('independent actor Trade correction serializes against issued incoming claim without revoking lost-response snapshot',async()=>{
	const {pair,item,trade,command}=await trade_pair();const reward=item+'Reward';
	await post_json('/api/trade/counter',{command_id:crypto.randomUUID(),trade_id:trade,items:[{id:reward,qty:17}]},pair.second.session_token);
	await post_json('/api/trade/accept',{command_id:crypto.randomUUID(),trade_id:trade},pair.first.session_token);
	const approval=approved_market_correction(pair.first_id,command);
	const reply=await race_market_correction(approval,()=>post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.first.session_token)) as {json:{claim:unknown}};
	expect(await db_all('SELECT disposition,quantity FROM economy_corrections WHERE operation_id=? AND object_id=?',[approval.operation,reward])).toEqual([{disposition:reply.json.claim?'protected':'held',quantity:17}]);
	if(reply.json.claim) expect((await post_json<any>('/api/inbox/claim',{existing_item_ids:[],available_slots:10},pair.first.session_token)).json.claim).toEqual(reply.json.claim);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual([{qty:5}]);
},15000);

test('legacy Trade correction serializes against resolve and preserves issued effects or holds exact unissued benefit',async()=>{
	const {pair,item,trade}=await trade_pair(true);const counter=crypto.randomUUID();const reward=item+'Counter';
	await post_json('/api/trade/counter',{command_id:counter,trade_id:trade,items:[{id:reward,qty:11}]},pair.second.session_token);
	await post_json('/api/trade/accept',{command_id:crypto.randomUUID(),trade_id:trade},pair.first.session_token);
	const approval=approved_market_correction(pair.second_id,counter);
	const reply=await race_market_correction(approval,()=>post_json<any>('/api/trade/resolve',{command_id:crypto.randomUUID(),trade_id:trade},pair.second.session_token)) as {json:{success?:boolean;receipt?:{effects:Array<{amount:number}>}}};
	const issued=reply.json.receipt?.effects.length!==undefined && reply.json.receipt.effects.length>0;
	expect(await db_all('SELECT disposition,SUM(quantity) quantity FROM economy_corrections WHERE operation_id=? AND object_id=? GROUP BY disposition',[approval.operation,item])).toEqual([{disposition:issued?'protected':'held',quantity:5}]);
	expect(await db_all('SELECT * FROM trade_items WHERE trade_id=?',[trade])).toEqual([]);
},15000);

test('Banishment Trade returns retain each duplicate root and preserve valid other escrow through correction and claim issuance',async()=>{
	const {make_guild_group}=await import('../support/fixtures');
	for(const issued of [false,true]) {
		const [petitioner,target,voter,peer]=await make_guild_group(['Trade Ban Petitioner','Trade Ban Target','Trade Ban Voter','Trade Ban Peer'],'Trade Ban Guild','1.6.9');
		const command=crypto.randomUUID(),item=`test:TradeBan_${command.replaceAll('-','')}`;
		const trade=(await post_json<any>('/api/trade/offer',{command_id:command,recipient_id:peer.client_id,items:[{id:item,qty:2},{id:item,qty:3}]},target.session_token)).json.trade_id;
		await post_json('/api/trade/counter',{command_id:crypto.randomUUID(),trade_id:trade,items:[{id:item,qty:7}]},peer.session_token);
		const petition=(await post_json<any>('/api/guilds/petitions/raise',{type:'banishment',target_client_id:target.client_id},petitioner.session_token)).json.petition_id;
		for(const player of [petitioner,voter,peer]) await post_json('/api/guilds/petitions/vote',{petition_id:petition,choice:'aye'},player.session_token);
		await post_json('/api/guilds/petitions/vote',{petition_id:petition,choice:'nay'},target.session_token);
		let claim:any;
		if(issued) claim=(await post_json<any>('/api/banishment/returns/claim',{existing_item_ids:[],available_slots:10},target.session_token)).json.claim;
		const approval=approved_market_correction(target.client_id,command);
		expect(apply_market_correction(approval).applied).toBe(true);
		expect(await db_all('SELECT i.qty FROM banishment_return_items i JOIN banishment_returns r ON r.id=i.return_id WHERE r.client_id=? AND i.item_id=?',[peer.client_id,item])).toEqual([{qty:7}]);
		expect((await db_all<{location:string}>('SELECT b.location FROM economy_custody_balances b JOIN economy_custody_sources s ON s.root_key=b.root_key WHERE s.operation_key=?',[`receipt:${command}`])).map(r=>r.location)).toEqual(issued?[`protected:banishment-claim:${claim.claim_id}`,`protected:banishment-claim:${claim.claim_id}`]:['invalidated','invalidated']);
		if(issued) expect((await post_json<any>('/api/banishment/returns/claim',{existing_item_ids:[],available_slots:0},target.session_token)).json.claim).toEqual(claim);
		expect(apply_market_correction(approval).applied).toBe(false);
	}
});

test('legacy counter cancellation returns every additive counter row instead of destroying valid escrow',async()=>{
	const {pair,item,trade}=await trade_pair(true);
	for(const qty of [7,11]) await post_json('/api/trade/counter',{command_id:crypto.randomUUID(),trade_id:trade,items:[{id:item,qty}]},pair.second.session_token);
	expect((await post_json<any>('/api/trade/cancel',{trade_id:trade},pair.second.session_token)).json.success).toBe(true);
	expect(await db_all('SELECT qty FROM inbox_items WHERE client_id=? AND item_id=?',[pair.second_id,item])).toEqual([{qty:18}]);
	expect(await db_all('SELECT qty FROM trade_items WHERE trade_id=? ORDER BY id',[trade])).toEqual([{qty:2},{qty:3}]);
	const resolved=(await post_json<any>('/api/trade/resolve',{trade_id:trade,command_id:crypto.randomUUID()},pair.first.session_token)).json;
	expect(resolved.success).toBe(true);
	expect(await db_all('SELECT * FROM trade_items WHERE trade_id=?',[trade])).toEqual([]);
});
