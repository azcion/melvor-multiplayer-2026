import { expect, test } from 'bun:test';
import { allow_alliance_preview as allow_preview, make_guildmates, register_guild_client as register_versioned_guild } from '../support/fixtures';
import { post,post_json,get_json_with_session,request } from '../support/http';
import { db_all,db_run } from '../support/persistence';
const headers={};
const register_guild_client = async (name:string,guild:string,version='1.6.2')=> {
	const client=await register_versioned_guild(name,guild,version);
	await allow_preview(client.client_id);
	return client;
};
async function propose(client: {session_token:string},body:object) {
	return (await post_json<{success?:boolean;petition_id:number;process_id:number;error?:string}>('/api/alliances/propose',body,client.session_token,headers)).json;
}
async function vote(client:{session_token:string},id:number,choice='aye') {
	return (await post_json<{success?:boolean;error_lang?:string}>('/api/guilds/petitions/vote',{petition_id:id,choice},client.session_token,headers)).json;
}
async function view(client:{session_token:string}) {
	return (await get_json_with_session<any>('/api/alliances',client.session_token)).json;
}
async function found(a:any,b:any) {
	const p=await propose(a,{kind:'found',name:'Test Alliance',target_id:b.guild_id});
	expect(p.success).toBe(true); expect((await vote(a,p.petition_id)).success).toBe(true);
	const considered=(await post_json<{petition_id:number}>('/api/alliances/consider',{process_id:p.process_id},b.session_token,headers)).json;
	expect({considered,records:await db_all('SELECT * FROM alliance_processes WHERE id=?',[p.process_id]),petition:await db_all('SELECT lifecycle,execution_state,execution_failure_message FROM guild_petitions WHERE id=?',[p.petition_id])}).toMatchObject({considered:{success:true}});
	expect((await vote(b,considered.petition_id)).success).toBe(true);
	return (await view(a)).alliance;
}
async function next_ballot(client:any,process_id:number) {
	const rows=await db_all<{id:number}>(`SELECT p.id FROM guild_petitions p JOIN alliance_process_petitions l ON l.petition_id=p.id
		WHERE p.guild_id=? AND l.process_id=? AND l.role='ballot'`,[client.guild_id,process_id]);
	return rows[0].id;
}
test('founding is local-first, incoming proposals do not occupy slots, and membership dissolves on departure',async()=> {
	const a=await register_guild_client('Founder A','Founder Guild A'); const b=await register_guild_client('Founder B','Founder Guild B');
	const p=await propose(a,{kind:'found',name:'Test Alliance',target_id:b.guild_id});
	expect((await view(a)).alliance).toBeNull();
	expect((await propose(a,{kind:'found',name:'Another',target_id:b.guild_id})).error).toBeDefined();
	await vote(a,p.petition_id);
	expect(await db_all('SELECT * FROM alliance_pending_slots WHERE guild_id=?',[b.guild_id])).toEqual([]);
	const accepted=(await post_json<any>('/api/alliances/consider',{process_id:p.process_id},b.session_token,headers)).json;
	expect({accepted,records:await db_all('SELECT * FROM alliance_processes WHERE id=?',[p.process_id]),petition:await db_all('SELECT lifecycle,execution_state,execution_failure_message FROM guild_petitions WHERE id=?',[p.petition_id])}).toMatchObject({accepted:{success:true}});
	await vote(b,accepted.petition_id);
	const aview=await view(a); expect(aview.alliance.member_guilds.length).toBe(2); expect(aview.alliance.shared_marketplace).toBe(0);
	const leave=await propose(a,{kind:'leave'}); await vote(a,leave.petition_id);
	expect((await view(b)).alliance).toBeNull();
});
test('strict majority carries member consent and admits applicants without counting applicant as a ballot',async()=> {
	const a=await register_guild_client('Majority A','Majority Guild A');const b=await register_guild_client('Majority B','Majority Guild B');
	const c=await register_guild_client('Majority C','Majority Guild C');
	const alliance=await found(a,b);
	const policy=await propose(a,{kind:'market_enable'}); await vote(a,policy.petition_id);
	expect((await view(a)).alliance.shared_marketplace).toBe(0);
	const pv=(await view(b)).processes.find((p:any)=>p.process_id===policy.process_id);
	expect(pv.tally).toEqual({eligible:2,aye:1,nay:0}); expect(pv).not.toHaveProperty('initiator_guild_id');
	await vote(b,await next_ballot(b,policy.process_id)); expect((await view(a)).alliance.shared_marketplace).toBe(1);
	const join=await propose(c,{kind:'join',target_id:alliance.id});await vote(c,join.petition_id);
	await vote(a,await next_ballot(a,join.process_id));expect((await view(c)).alliance).toBeNull();
	await vote(b,await next_ballot(b,join.process_id));expect((await view(c)).alliance.member_guilds.length).toBe(3);
	const disable=await propose(a,{kind:'market_disable'});await vote(a,disable.petition_id);
	await vote(c,await next_ballot(c,disable.process_id));expect((await view(a)).alliance.shared_marketplace).toBe(0);
});
test('legacy clients cannot read or vote on Alliance processes',async()=> {
	const a=await register_guild_client('Gated A','Gated Guild A');const b=await register_guild_client('Gated B','Gated Guild B');
	const p=await propose(a,{kind:'found',name:'Gated Alliance',target_id:b.guild_id});
	const old=await register_versioned_guild('Old Client','Old Client Guild','1.6.1');
	expect((await request('/api/alliances',{headers:{'X-Session-Token':old.session_token}})).status).toBe(404);
	const oldvote=await post_json<any>('/api/guilds/petitions/vote',{petition_id:p.petition_id,choice:'aye'},old.session_token);
	expect(oldvote.json.success).toBeUndefined();
});

test('Alliance Chat is retained, independent, membership-scoped and capability-gated',async()=> {
	const a=await register_guild_client('Chat A','Chat Guild A'),b=await register_guild_client('Chat B','Chat Guild B');
	const alliance=await found(a,b);
	const inbox=await get_json_with_session<any>('/api/chat/conversations',b.session_token);
	expect(inbox.json.conversations.find((c:any)=>c.conversation_kind==='alliance').conversation_id).toBe(alliance.id);
	const payload={conversation_kind:'alliance',conversation_id:alliance.id,idempotency_key:crypto.randomUUID(),content:'Alliance hello',parts:[{type:'text',text:'Alliance hello'}]};
	const sent=await post_json<any>('/api/chat/messages/send',payload,a.session_token);expect(sent.json.success).toBe(true);
	const retry=await post_json<any>('/api/chat/messages/send',payload,a.session_token);expect(retry.json.message.message_id).toBe(sent.json.message.message_id);
	const messages=await get_json_with_session<any>(`/api/chat/messages?conversation_kind=alliance&conversation_id=${alliance.id}`,b.session_token);
	expect(messages.json.messages[0].content).toBe('Alliance hello');
	await post_json('/api/chat/alliance-participation',{enabled:false},b.session_token);
	expect((await get_json_with_session<any>('/api/chat/conversations',b.session_token)).json.alliance_chat.enabled).toBe(false);
	await post_json('/api/chat/alliance-participation',{enabled:true},b.session_token);
	const leave=await propose(a,{kind:'leave'});await vote(a,leave.petition_id);
	expect((await get_json_with_session<any>('/api/chat/conversations',b.session_token)).json.conversations.some((c:any)=>c.conversation_kind==='alliance')).toBe(false);
	expect(await db_all('SELECT id FROM alliance_chat_messages WHERE alliance_id=?',[alliance.id])).toEqual([]);
});

test('shared Marketplace conserves Haggle escrow on policy loss and rejects legacy direct-ID access',async()=> {
	const a=await register_guild_client('Market A','Alliance Market A'),b=await register_guild_client('Market B','Alliance Market B');
	await found(a,b);
	const listed=await post_json<any>('/api/market/sell',{item_id:'melvorD:Logs',item_qty:10,item_sell_price:20},a.session_token);
	expect(listed.json.success).toBe(true);
	const listing=(await get_json_with_session<any>('/api/market/listings',a.session_token)).json.items[0];
	const search=()=>post_json<any>('/api/market/search',{item_id:'melvorD:Logs'},b.session_token);
	expect((await search()).json.items).toEqual([]);
	const enable=await propose(a,{kind:'market_enable'});await vote(a,enable.petition_id);await vote(b,await next_ballot(b,enable.process_id));
	expect((await search()).json.items[0].id).toBe(listing.id);
	const purchased=await post_json<any>('/api/market/buy',{id:listing.id,qty:2,item_discovered:true},b.session_token);expect(purchased.json.success).toBe(true);
	const haggle=await post_json<any>('/api/market/haggle',{id:listing.id,qty:3,price:10,item_discovered:true},b.session_token);expect(haggle.json.success).toBe(true);
	const disable=await propose(a,{kind:'market_disable'});await vote(a,disable.petition_id);await vote(b,await next_ballot(b,disable.process_id));
	expect((await db_all('SELECT available,reserved FROM market_items WHERE id=?',[listing.id]))[0]).toEqual({available:8,reserved:0});
	expect((await db_all('SELECT status FROM market_haggles WHERE id=?',[haggle.json.haggle_id]))[0].status).toBe('cancelled');
	expect((await db_all('SELECT gp FROM market_haggle_claims WHERE haggle_id=?',[haggle.json.haggle_id]))[0].gp).toBe(30);
	const again=await propose(a,{kind:'market_enable'});await vote(a,again.petition_id);await vote(b,await next_ballot(b,again.process_id));
	await db_run('UPDATE client_runtime_snapshots SET mod_version=? WHERE client_id=?',['1.6.1',a.client_id]);
	expect((await search()).json.items).toEqual([]);
	expect((await post_json<any>('/api/market/buy',{id:listing.id,qty:1,item_discovered:true},b.session_token)).json.success).toBeUndefined();
});

test('four Guilds need three Ayes; target retains removal ballot; roster changes cancel voting',async()=> {
	const members=[];for(let i=0;i<4;i++) members.push(await register_guild_client(`Four ${i}`,`Four Guild ${i}`));
	const [a,b,c,d]=members;const alliance=await found(a,b);
	for(const applicant of [c,d]) {
		const join=await propose(applicant,{kind:'join',target_id:alliance.id});await vote(applicant,join.petition_id);
		await vote(a,await next_ballot(a,join.process_id));await vote(b,await next_ballot(b,join.process_id));
	}
	const policy=await propose(a,{kind:'market_enable'});await vote(a,policy.petition_id);
	await vote(b,await next_ballot(b,policy.process_id));expect((await view(a)).alliance.shared_marketplace).toBe(0);
	await vote(c,await next_ballot(c,policy.process_id));expect((await view(a)).alliance.shared_marketplace).toBe(1);
	const removal=await propose(a,{kind:'remove',target_id:d.guild_id});await vote(a,removal.petition_id);
	expect((await view(d)).processes.find((p:any)=>p.process_id===removal.process_id).tally.eligible).toBe(4);
	await vote(d,await next_ballot(d,removal.process_id),'nay');await vote(b,await next_ballot(b,removal.process_id));
	expect((await view(d)).alliance).not.toBeNull();await vote(c,await next_ballot(c,removal.process_id));expect((await view(d)).alliance).toBeNull();
	const disable=await propose(a,{kind:'market_disable'});await vote(a,disable.petition_id);
	const leave=await propose(c,{kind:'leave'});await vote(c,leave.petition_id);
	expect((await view(a)).processes.find((p:any)=>p.process_id===disable.process_id).stage).toBe('cancelled');
	expect((await view(a)).alliance.shared_marketplace).toBe(1);
});
test('submitted consent needs a Council withdrawal, and late activity cannot revive an expired process',async()=> {
	const a=await register_guild_client('Withdraw A','Withdraw Guild A'),b=await register_guild_client('Withdraw B','Withdraw Guild B');
	const p=await propose(a,{kind:'found',name:'Withdrawal',target_id:b.guild_id});await vote(a,p.petition_id);
	const withdrawal=(await post_json<any>('/api/alliances/withdraw',{process_id:p.process_id},a.session_token)).json;
	expect((await view(a)).processes.find((q:any)=>q.process_id===p.process_id).stage).toBe('waiting');
	await vote(a,withdrawal.petition_id);
	expect((await view(a)).processes.find((q:any)=>q.process_id===p.process_id).stage).toBe('withdrawn');
	const next=await propose(a,{kind:'found',name:'Expired',target_id:b.guild_id});
	await db_run('UPDATE alliance_processes SET expires_at=? WHERE id=?',[Date.now()-1,next.process_id]);
	expect((await vote(a,next.petition_id)).success).toBeUndefined();
	expect((await view(a)).processes.find((q:any)=>q.process_id===next.process_id).stage).toBe('lapsed');
	expect(await db_all('SELECT * FROM alliance_pending_slots WHERE process_id=?',[next.process_id])).toEqual([]);
});
test('either Guild Interdict prevents a recognized cheater crossing Guilds while own dealings remain',async()=> {
	const a=await register_guild_client('Interdict A','Interdict Guild A'),b=await register_guild_client('Interdict B','Interdict Guild B');
	await found(a,b);const enable=await propose(a,{kind:'market_enable'});await vote(a,enable.petition_id);await vote(b,await next_ballot(b,enable.process_id));
	await post_json('/api/market/sell',{item_id:'melvorD:Oak_Logs',item_qty:8,item_sell_price:10},b.session_token);
	const listing=(await get_json_with_session<any>('/api/market/listings',b.session_token)).json.items[0];
	await db_run('UPDATE clients SET cheats_detected_at=? WHERE id=?',[Date.now(),b.client_id]);
	await db_run('UPDATE guilds SET cheat_restriction_enabled=1 WHERE id=?',[a.guild_id]);
	expect((await post_json<any>('/api/market/search',{item_id:'melvorD:Oak_Logs'},a.session_token)).json.items).toEqual([]);
	expect((await post_json<any>('/api/market/buy',{id:listing.id,qty:1,item_discovered:true},a.session_token)).json.success).toBeUndefined();
	expect((await get_json_with_session<any>('/api/market/listings',b.session_token)).json.items[0].id).toBe(listing.id);
	await db_run('UPDATE clients SET cheats_detected_at=? WHERE id=?',[Date.now()-7*86400000-1000,b.client_id]);
	expect((await post_json<any>('/api/market/buy',{id:listing.id,qty:1,item_discovered:true},a.session_token)).json.success).toBe(true);
});

test('individual ballots extend a shared deadline without changing frozen electorates; empty Councils never approve',async()=> {
	const a=await register_guild_client('Deadline A','Deadline Guild A'),b=await register_guild_client('Deadline B','Deadline Guild B');
	await found(a,b);
	const policy=await propose(a,{kind:'market_enable'});await vote(a,policy.petition_id);
	const ballot=await next_ballot(b,policy.process_id);
	// Add a second frozen elector to prevent the first Aye resolving this Council.
	const witness=await register_guild_client('Deadline Witness','Deadline Witness');
	await db_run('INSERT INTO guild_petition_voters(petition_id,client_id) VALUES(?,?)',[ballot,witness.client_id]);
	await db_run('UPDATE alliance_processes SET expires_at=? WHERE id=?',[Date.now()+10000,policy.process_id]);
	await db_run('UPDATE guild_petitions SET expires_at=? WHERE id=?',[Date.now()+10000,ballot]);
	const before=Date.now();expect((await vote(b,ballot)).success).toBe(true);
	const deadline=(await db_all<{expires_at:number}>('SELECT expires_at FROM alliance_processes WHERE id=?',[policy.process_id]))[0].expires_at;
	expect(deadline).toBeGreaterThanOrEqual(before+86400000);
	expect((await db_all<{expires_at:number}>('SELECT expires_at FROM guild_petitions WHERE id=?',[ballot]))[0].expires_at).toBe(deadline);
	expect((await db_all('SELECT client_id FROM guild_petition_voters WHERE petition_id=?',[ballot])).length).toBe(2);
	const empty=await register_guild_client('Empty Council','Empty Council Guild');
	await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[Date.now()-5*86400000,empty.client_id]);
	const proposal=await propose(empty,{kind:'found',target_id:witness.guild_id,name:'Empty Proposal'});
	expect(await db_all('SELECT * FROM guild_petition_voters WHERE petition_id=?',[proposal.petition_id])).toEqual([]);
	expect((await vote(empty,proposal.petition_id)).success).toBeUndefined();
	expect((await view(empty)).processes.find((p:any)=>p.process_id===proposal.process_id).stage).toBe('local');
});

test('cross-Guild Buy Orders settle and receipt replay and accepted Haggle claims survive permission loss',async()=> {
	const buyer=await register_guild_client('Order Buyer','Alliance Order Buyer'),seller=await register_guild_client('Order Seller','Alliance Order Sell');
	await found(buyer,seller);
	const enable=await propose(buyer,{kind:'market_enable'});await vote(buyer,enable.petition_id);await vote(seller,await next_ballot(seller,enable.process_id));
	const order=await post_json<any>('/api/market/buy-order',{item_id:'melvorD:Alliance_Order',item_qty:8,item_buy_price:10},buyer.session_token);
	expect(order.json.success).toBe(true);
	const listing=(await get_json_with_session<any>('/api/market/listings',buyer.session_token)).json.items[0];
	const payload={id:listing.id,qty:2,command_id:crypto.randomUUID()};
	const fulfilled=await post_json<any>('/api/market/fulfill',payload,seller.session_token);expect(fulfilled.json.success).toBe(true);
	const haggle=await post_json<any>('/api/market/haggle',{id:listing.id,qty:3,price:12},seller.session_token);expect(haggle.json.success).toBe(true);
	const haggles=await get_json_with_session<any>('/api/market/haggles',buyer.session_token);
	const offer=haggles.json.haggles.find((h:any)=>h.id===haggle.json.haggle_id);
	const accepted=await post_json<any>('/api/market/haggle/accept',{id:offer.id,revision:offer.revision},buyer.session_token);expect(accepted.json.success).toBe(true);
	const leave=await propose(buyer,{kind:'leave'});await vote(buyer,leave.petition_id);
	const replay=await post_json<any>('/api/market/fulfill',payload,seller.session_token);expect(replay.json).toEqual(fulfilled.json);
	expect((await post_json<any>('/api/market/fulfill',{id:listing.id,qty:1},seller.session_token)).json.success).toBeUndefined();
	for(const client of [buyer,seller]) expect((await post_json<any>('/api/market/haggle/claim',{id:offer.id},client.session_token)).json.success).toBe(true);
});

test('1.6.1 members retain ordinary Council and same-Guild Marketplace while Alliance actions stay hidden',async()=> {
	const pair=await make_guildmates('Mixed New','Mixed Old','Mixed Guild',{first:'1.6.2',second:'1.6.1'});
	await allow_preview(pair.first_id);
	const recipient=await register_guild_client('Mixed Recipient','Mixed Recipient');
	const p=await propose(pair.first,{kind:'found',name:'Mixed Alliance',target_id:recipient.guild_id});
	const council=await get_json_with_session<any>('/api/guilds/council',pair.second.session_token);
	expect(council.json.petitions.some((petition:any)=>petition.petition_id===p.petition_id)).toBe(false);
	expect((await vote(pair.second,p.petition_id)).success).toBeUndefined();
	const ordinary=await post_json<any>('/api/guilds/petitions/raise',{type:'appellation',name:'Mixed Renamed'},pair.first.session_token);
	expect(ordinary.json.success).toBe(true);
	expect((await vote(pair.second,ordinary.json.petition_id)).success).toBe(true);
	await post_json('/api/market/sell',{item_id:'melvorD:Mixed_Item',item_qty:3,item_sell_price:2},pair.first.session_token);
	const listing=(await get_json_with_session<any>('/api/market/listings',pair.first.session_token)).json.items[0];
	expect((await post_json<any>('/api/market/search',{item_id:'melvorD:Mixed_Item'},pair.second.session_token)).json.items[0].id).toBe(listing.id);
	expect((await post_json<any>('/api/market/buy',{id:listing.id,qty:1},pair.second.session_token)).json.success).toBe(true);
	expect((await get_json_with_session<any>('/api/chat/conversations',pair.second.session_token)).json.conversations.some((c:any)=>c.conversation_kind==='alliance')).toBe(false);
});


test('non-preview accounts cannot see or act on Alliances even with a development client',async()=> {
	const a=await register_guild_client('Preview A','Preview Guild A'),b=await register_guild_client('Preview B','Preview Guild B','development');
	const alliance=await found(a,b);
	expect((await get_json_with_session<any>('/api/events',b.session_token)).json.alliance_access).toBe(true);
	const policy=await propose(a,{kind:'market_enable'});await vote(a,policy.petition_id);await vote(b,await next_ballot(b,policy.process_id));
	const pending=await propose(a,{kind:'market_disable'});
	await post_json('/api/market/sell',{item_id:'melvorD:Preview_Item',item_qty:4,item_sell_price:2},a.session_token);
	const listing=(await get_json_with_session<any>('/api/market/listings',a.session_token)).json.items[0];
	const other_account_key=crypto.randomUUID();
	await db_run('INSERT INTO melvor_accounts(cloud_username,playfab_id,created_at) VALUES(?,?,0)',['azcn',other_account_key]);
	const other_account=(await db_all<{id:number}>('SELECT id FROM melvor_accounts WHERE playfab_id=?',[other_account_key]))[0].id;
	await db_run('UPDATE clients SET melvor_account_id=? WHERE id=?',[other_account,b.client_id]);
	for(const endpoint of ['/api/alliances','/api/alliances/discover?mode=found','/api/alliances/guild-preview?guild_id='+a.guild_id])
		expect((await request(endpoint,{headers:{'x-session-token':b.session_token}})).status).toBe(404);
	for(const endpoint of ['/api/alliances/propose','/api/alliances/consider','/api/alliances/withdraw','/api/chat/alliance-participation'])
		expect((await post(endpoint,{},b.session_token)).status).toBe(404);
	for(const endpoint of ['/api/chat/messages/send','/api/chat/messages/reaction','/api/chat/messages/delete-for-all'])
		expect((await post(endpoint,{conversation_kind:'alliance',message_id:1},b.session_token)).status).toBe(404);
	expect((await request('/api/chat/messages?conversation_kind=alliance&conversation_id='+alliance.id,{headers:{'X-Session-Token':b.session_token}})).status).toBe(404);
	expect((await get_json_with_session<any>('/api/chat/conversations',b.session_token)).json.conversations.some((c:any)=>c.conversation_kind==='alliance')).toBe(false);
	expect((await get_json_with_session<any>('/api/events',b.session_token)).json.alliance_access).toBe(false);
	expect((await get_json_with_session<any>('/api/guilds/council',b.session_token)).json.petitions.some((p:any)=>p.type.startsWith('alliance_'))).toBe(false);
	expect((await vote(b,pending.petition_id)).success).toBeUndefined();
	expect((await post_json<any>('/api/guilds/petitions/withdraw',{petition_id:pending.petition_id},b.session_token)).json.success).toBeUndefined();
	// Inject a historical Alliance activity into the viewer's Guild; it must be filtered before pagination.
	await db_run("INSERT INTO guild_activity_events(guild_id,event_type,metadata,source_key,created_at) VALUES(?,'petition_carried',?,?,?)",
		[b.guild_id,JSON.stringify({petition_type:'alliance_market_enable'}),crypto.randomUUID(),Date.now()]);
	expect((await get_json_with_session<any>('/api/guilds/activity',b.session_token)).json.events.some((event:any)=>event.metadata.petition_type?.startsWith('alliance_'))).toBe(false);
	expect((await post_json<any>('/api/market/search',{item_id:'melvorD:Preview_Item'},b.session_token)).json.items).toEqual([]);
	expect((await post_json<any>('/api/market/buy',{id:listing.id,qty:1},b.session_token)).json.success).toBeUndefined();
	// Both sides must qualify: the preview buyer cannot discover an ineligible seller either.
	await post_json('/api/market/sell',{item_id:'melvorD:Excluded_Seller',item_qty:4,item_sell_price:2},b.session_token);
	expect((await post_json<any>('/api/market/search',{item_id:'melvorD:Excluded_Seller'},a.session_token)).json.items).toEqual([]);
});
