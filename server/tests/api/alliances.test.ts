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
for (const kind of ['found', 'join', 'recipient'] as const) test(`crowded Alliance views retain the Guild's pending ${kind} process`, async()=> {
	const a=await register_guild_client('Crowded '+kind+' A','Crowded '+kind+' A');
	const b=await register_guild_client('Crowded '+kind+' B','Crowded '+kind+' B');
	let own: { process_id:number; petition_id:number };
	if (kind === 'join') {
		const c=await register_guild_client('Crowded Join C','Crowded Join C');
		const alliance=await found(b,c);
		own=await propose(a,{kind:'join',target_id:alliance.id});
		await vote(a,own.petition_id);
	} else if (kind === 'recipient') {
		own=await propose(b,{kind:'found',name:'Crowded Alliance',target_id:a.guild_id});
		const considered=(await post_json<{petition_id:number}>('/api/alliances/consider',{process_id:own.process_id},a.session_token)).json;
		own.petition_id=considered.petition_id;
	} else {
		own=await propose(a,{kind:'found',name:'Crowded Alliance',target_id:b.guild_id});
		await vote(a,own.petition_id);
	}
	// Seed distinct newer incoming founders without enrolling 60 unrelated player identities.
	const prefix='Crowd '+crypto.randomUUID().slice(0,8)+' ',now=Date.now();
	await db_run(`WITH RECURSIVE entries(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM entries WHERE n<60)
		INSERT INTO guilds(name,icon_id,created_at) SELECT ? || n,'melvorD:Farmlands',? FROM entries`,[prefix,now]);
	await db_run(`INSERT INTO alliance_processes(kind,initiator_guild_id,target_guild_id,name,subject,stage,created_at,expires_at,governance_version)
		SELECT 'found',id,?,'Incoming Alliance','found:' || id,'waiting',?,?,2 FROM guilds WHERE name LIKE ?`,
		[a.guild_id,now,now+86400000,prefix+'%']);
	await db_run(`INSERT INTO alliance_pending_slots(guild_id,process_id)
		SELECT initiator_guild_id,id FROM alliance_processes WHERE target_guild_id=? AND created_at=? AND name='Incoming Alliance'`,[a.guild_id,now]);
	const crowded=await view(a);
	expect(crowded.affiliation_pending).toBe(true);
	expect(crowded.processes).toHaveLength(60);
	expect(crowded.processes[0].process_id).toBe(own.process_id);
	expect(new Set(crowded.processes.map((p:any)=>p.process_id)).size).toBe(60);
	if (kind === 'recipient') {
		expect(crowded.processes[0].own_council).toBe('active');
		expect((await vote(a,own.petition_id,'nay')).success).toBe(true);
	} else {
		expect(crowded.processes[0].own_council).toBe('granted');
		expect(crowded.processes[0].can_withdraw).toBe(true);
		const withdrawal=(await post_json<{success:boolean;petition_id:number}>('/api/alliances/withdraw',{process_id:own.process_id},a.session_token)).json;
		expect(withdrawal.success).toBe(true);
		expect((await vote(a,withdrawal.petition_id)).success).toBe(true);
	}
	expect((await view(a)).affiliation_pending).toBe(false);
	await db_run('DELETE FROM guilds WHERE name LIKE ?',[prefix+'%']);
});
test('activity-sorted discovery excludes own and Shadowed Guilds and completes founding',async()=> {
	const older: Awaited<ReturnType<typeof register_guild_client>>[]=[];
	for(let i=0;i<21;i++) older.push(await register_guild_client('Older '+i,'Older Guild '+i));
	const a=await register_guild_client('Discovery Bob','Discovery GA');
	const b=await register_guild_client('Discovery Cob','Discovery GB');
	const latest=(await db_all<{latest:number}>('SELECT MAX(last_multiplayer_active_at) latest FROM clients'))[0].latest;
	for(const client of [a,b]) await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[latest+1000,client.client_id]);
	for(const [viewer,other] of [[a,b],[b,a]]) {
		const result=(await get_json_with_session<any>('/api/alliances/discover?mode=found',viewer.session_token)).json;
		expect(result.entries[0].guild_id).toBe(other.guild_id);
		expect(result.has_more).toBe(true);
		const next=(await get_json_with_session<any>('/api/alliances/discover?mode=found&page=1',viewer.session_token)).json;
		expect(next.entries.some((entry:any)=>entry.guild_id===viewer.guild_id)).toBe(false);
		expect(next.entries.some((entry:any)=>result.entries.some((first:any)=>first.guild_id===entry.guild_id))).toBe(false);
		expect(result.entries.some((entry:any)=>entry.guild_id===viewer.guild_id)).toBe(false);
	}
	const now=Date.now();
	for(const client of older) await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[now-120000,client.client_id]);
	await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[now-8*86400000,older[0].client_id]);
	await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[latest+2000,older[1].client_id]);
	await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[now-60000,b.client_id]);
	const sorted=(await get_json_with_session<any>('/api/alliances/discover?mode=found',a.session_token)).json;
	expect(sorted.entries[0].guild_id).toBe(older[1].guild_id);
	expect(sorted.entries.some((g:any)=>g.guild_id===older[0].guild_id)).toBe(false);
	for(const client of [a,b,...older.slice(1)]) await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[now,client.client_id]);
	const alliance=await found(a,b);
	expect(alliance.member_guilds.map((g:any)=>g.guild_id).sort()).toEqual([a.guild_id,b.guild_id].sort());
	for(const viewer of [a,b]) {
		const entries=(await get_json_with_session<any>('/api/alliances/discover?mode=found',viewer.session_token)).json.entries;
		expect(entries.some((g:any)=>g.guild_id===a.guild_id || g.guild_id===b.guild_id)).toBe(false);
		expect((await view(viewer)).alliance.id).toBe(alliance.id);
	}
	const leave=await propose(a,{kind:'leave'}); await vote(a,leave.petition_id);
});
test('founding needs both Councils, incoming proposals do not occupy slots, and membership dissolves on departure',async()=> {
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
test('strict majority counts concurrent Council consent and admits applicants without counting applicant as a ballot',async()=> {
	const a=await register_guild_client('Majority A','Majority Guild A');const b=await register_guild_client('Majority B','Majority Guild B');
	const c=await register_guild_client('Majority C','Majority Guild C');
	const alliance=await found(a,b);
	const policy=await propose(a,{kind:'market_enable'}); await vote(a,policy.petition_id);
	expect((await view(a)).alliance.shared_marketplace).toBe(0);
	const pv=(await view(b)).processes.find((p:any)=>p.process_id===policy.process_id);
	expect(pv.tally).toEqual({eligible:2,required_aye:2,aye:1,nay:0}); expect(pv).not.toHaveProperty('initiator_guild_id');
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

test('individual ballots extend a shared deadline without changing locked thresholds; empty Councils need a ballot',async()=> {
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
	expect(deadline).toBeGreaterThanOrEqual(before+96*3600000);
	expect(deadline).toBeLessThanOrEqual(Date.now()+96*3600000);
	const council_deadline=(await db_all<{expires_at:number}>('SELECT expires_at FROM guild_petitions WHERE id=?',[ballot]))[0].expires_at;
	expect(council_deadline).toBeGreaterThanOrEqual(before+24*3600000);
	expect(council_deadline).toBeLessThanOrEqual(Date.now()+24*3600000);
	expect((await db_all('SELECT client_id FROM guild_petition_voters WHERE petition_id=?',[ballot])).length).toBe(2);
	const empty=await register_guild_client('Empty Council','Empty Council Guild');
	await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?',[Date.now()-5*86400000,empty.client_id]);
	const proposal=await propose(empty,{kind:'found',target_id:witness.guild_id,name:'Empty Proposal'});
	expect(await db_all('SELECT * FROM guild_petition_voters WHERE petition_id=?',[proposal.petition_id])).toEqual([]);
	expect((await view(empty)).processes.find((p:any)=>p.process_id===proposal.process_id).own_council).toBe('active');
	expect((await vote(empty,proposal.petition_id)).success).toBe(true);
	expect((await view(empty)).processes.find((p:any)=>p.process_id===proposal.process_id).stage).toBe('waiting');
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


test('Guild previews add Shadowed-aware active counts without changing member totals', async () => {
	const pair = await make_guildmates('Alliance Count Owner', 'Alliance Count Mate', 'Alliance Count Guild', {first: '1.6.3', second: '1.6.3'});
	await allow_preview(pair.first_id);
	await db_run('UPDATE clients SET last_multiplayer_active_at=0 WHERE id=?', [pair.second_id]);
	const response = await get_json_with_session<any>('/api/alliances/guild-preview?guild_id=' + pair.guild_id, pair.first.session_token);
	expect(response.json.guild).toMatchObject({guild_id: pair.guild_id, member_count: 2, active_member_count: 1});
});

test('founding Councils vote concurrently; recipient approval alone cannot create an Alliance', async()=> {
	const a=await register_guild_client('Parallel A','Parallel Guild A'),b=await register_guild_client('Parallel B','Parallel Guild B');
	const p=await propose(a,{kind:'found',name:'Parallel Pair',target_id:b.guild_id});
	const incoming=(await view(b)).processes.find((row:any)=>row.process_id===p.process_id);
	expect(incoming).toMatchObject({stage:'waiting',governance_version:2,can_consider:true,consider_blocked_reason:null});
	expect((await view(b)).affiliation_pending).toBe(false);
	const considered=(await post_json<any>('/api/alliances/consider',{process_id:p.process_id},b.session_token)).json;
	expect(considered.success).toBe(true);
	expect((await propose(b,{kind:'found',name:'Other',target_id:a.guild_id})).error).toBeDefined();
	await vote(b,considered.petition_id);
	expect((await view(b)).alliance).toBeNull();
	expect((await view(b)).processes.find((row:any)=>row.process_id===p.process_id).own_council).toBe('granted');
	await vote(a,p.petition_id);
	expect((await view(a)).alliance.name).toBe('Parallel Pair');
	expect(await db_all('SELECT * FROM alliance_pending_slots WHERE process_id=?',[p.process_id])).toEqual([]);
});

test('competing founding proposals reserve only participants deliberating and cancel incompatible formation with a reason',async()=> {
	const a=await register_guild_client('Race A','Race Guild A'),b=await register_guild_client('Race B','Race Guild B'),c=await register_guild_client('Race C','Race Guild C');
	const ab=await propose(a,{kind:'found',name:'GAB',target_id:b.guild_id});
	expect((await view(c)).processes.some((p:any)=>p.process_id===ab.process_id)).toBe(false);
	const bc=await propose(b,{kind:'found',name:'GBC',target_id:c.guild_id});
	await vote(a,ab.petition_id);
	expect((await view(b)).processes.find((p:any)=>p.process_id===ab.process_id).consider_blocked_reason).toBe('affiliation_pending');
	expect((await post_json<any>('/api/alliances/consider',{process_id:ab.process_id},b.session_token)).json.error).toBeDefined();
	const considered=(await post_json<any>('/api/alliances/consider',{process_id:bc.process_id},c.session_token)).json;
	await vote(c,considered.petition_id); await vote(b,bc.petition_id);
	expect((await view(b)).alliance.name).toBe('GBC');
	expect((await view(a)).processes.find((p:any)=>p.process_id===ab.process_id)).toMatchObject({stage:'cancelled',resolution_reason:'affiliated_elsewhere',resolution_guild_name:'Race Guild B'});
	expect((await view(a)).affiliation_pending).toBe(false);
});

test('recipient rejection ends founding before the proposer finishes and releases both slots',async()=> {
	const a=await register_guild_client('Reject A','Reject Guild A'),b=await register_guild_client('Reject B','Reject Guild B');
	const p=await propose(a,{kind:'found',name:'Rejected Pair',target_id:b.guild_id});
	const considered=(await post_json<any>('/api/alliances/consider',{process_id:p.process_id},b.session_token)).json;
	await vote(b,considered.petition_id,'nay');
	expect((await view(a)).processes.find((row:any)=>row.process_id===p.process_id).stage).toBe('denied');
	expect((await vote(a,p.petition_id)).success).toBeUndefined();
	expect(await db_all('SELECT * FROM alliance_pending_slots WHERE process_id=?',[p.process_id])).toEqual([]);
});

test('policy voting starts everywhere immediately and the proposing Guild has no veto or automatic Aye',async()=> {
	const a=await register_guild_client('No Veto A','No Veto Guild A'),b=await register_guild_client('No Veto B','No Veto Guild B'),c=await register_guild_client('No Veto C','No Veto Guild C');
	const alliance=await found(a,b);
	const join=await propose(c,{kind:'join',target_id:alliance.id});
	await vote(c,join.petition_id); await vote(a,await next_ballot(a,join.process_id)); await vote(b,await next_ballot(b,join.process_id));
	const policy=await propose(a,{kind:'market_enable'});
	expect((await view(b)).processes.find((p:any)=>p.process_id===policy.process_id)).toMatchObject({stage:'collective',tally:{eligible:3,required_aye:2,aye:0,nay:0}});
	expect((await view(c)).market_proposal_pending).toBe(true);
	expect((await propose(b,{kind:'market_enable'})).error).toBeDefined();
	const council=(await get_json_with_session<any>('/api/guilds/council',a.session_token)).json;
	expect(council.petitions.find((p:any)=>p.petition_id===policy.petition_id).can_withdraw).toBe(false);
	expect((await post_json<any>('/api/guilds/petitions/withdraw',{petition_id:policy.petition_id},a.session_token)).json.success).toBeUndefined();
	await vote(a,policy.petition_id,'nay');
	expect((await view(b)).alliance.shared_marketplace).toBe(0);
	await vote(b,await next_ballot(b,policy.process_id)); await vote(c,await next_ballot(c,policy.process_id));
	expect((await view(a)).alliance.shared_marketplace).toBe(1);
	expect((await view(a)).processes.find((p:any)=>p.process_id===policy.process_id)).toMatchObject({stage:'accepted',own_ballot:'nay'});
	expect((await view(a)).market_proposal_pending).toBe(false);
});

test('parallel admission waits for applicant consent even after the Alliance majority approves',async()=> {
	const a=await register_guild_client('Admission A','Admission Guild A'),b=await register_guild_client('Admission B','Admission Guild B'),c=await register_guild_client('Admission C','Admission Guild C');
	const alliance=await found(a,b);
	const join=await propose(c,{kind:'join',target_id:alliance.id});
	expect((await view(c)).processes.find((p:any)=>p.process_id===join.process_id)).toMatchObject({display_kind:'apply',name:alliance.name,applicant_consent:'active'});
	await vote(a,await next_ballot(a,join.process_id)); await vote(b,await next_ballot(b,join.process_id));
	expect((await view(c)).alliance).toBeNull();
	expect((await view(c)).processes.find((p:any)=>p.process_id===join.process_id)).toMatchObject({stage:'collective',tally:{aye:2,eligible:2}});
	await vote(c,join.petition_id);
	expect((await view(c)).alliance.member_guilds.length).toBe(3);
	const d=await register_guild_client('Admission D','Admission Guild D');
	const rejected=await propose(d,{kind:'join',target_id:alliance.id});
	await vote(a,await next_ballot(a,rejected.process_id)); await vote(b,await next_ballot(b,rejected.process_id));
	await vote(d,rejected.petition_id,'nay');
	expect((await view(d)).alliance).toBeNull();
	expect((await view(d)).processes.find((p:any)=>p.process_id===rejected.process_id).stage).toBe('denied');
});

test('roster changes cancel parallel decisions with a durable reason while keeping current policy',async()=> {
	const a=await register_guild_client('Roster A','Roster Guild A'),b=await register_guild_client('Roster B','Roster Guild B'),c=await register_guild_client('Roster C','Roster Guild C');
	const alliance=await found(a,b);
	const policy=await propose(a,{kind:'market_enable'});
	const join=await propose(c,{kind:'join',target_id:alliance.id});
	await vote(c,join.petition_id); await vote(a,await next_ballot(a,join.process_id)); await vote(b,await next_ballot(b,join.process_id));
	expect((await view(a)).processes.find((p:any)=>p.process_id===policy.process_id)).toMatchObject({stage:'cancelled',resolution_reason:'roster_changed'});
	expect((await view(a)).alliance.shared_marketplace).toBe(0);
	expect((await vote(a,policy.petition_id)).success).toBeUndefined();
});

test('existing sequential founding retains its approval gate after the parallel cutover',async()=> {
	const a=await register_guild_client('Legacy Flow A','Legacy Flow Guild A'),b=await register_guild_client('Legacy Flow B','Legacy Flow Guild B');
	const p=await propose(a,{kind:'found',name:'Legacy Pair',target_id:b.guild_id});
	// Represent a process persisted by the previous backend, with its untouched local electorate.
	await db_run("UPDATE alliance_processes SET governance_version=1,stage='local' WHERE id=?",[p.process_id]);
	expect((await view(b)).processes.find((row:any)=>row.process_id===p.process_id).can_consider).toBe(false);
	expect((await post_json<any>('/api/alliances/consider',{process_id:p.process_id},b.session_token)).json.success).toBeUndefined();
	await vote(a,p.petition_id);
	const considered=(await post_json<any>('/api/alliances/consider',{process_id:p.process_id},b.session_token)).json;
	await vote(b,considered.petition_id);
	expect((await view(a)).alliance.name).toBe('Legacy Pair');
});

test('simultaneous consideration of competing incoming proposals occupies only one recipient slot',async()=> {
	const a=await register_guild_client('Slot A','Slot Guild A'),b=await register_guild_client('Slot B','Slot Guild B'),c=await register_guild_client('Slot C','Slot Guild C');
	const ab=await propose(a,{kind:'found',name:'Slot AB',target_id:b.guild_id});
	const cb=await propose(c,{kind:'found',name:'Slot CB',target_id:b.guild_id});
	const responses=await Promise.all([ab,cb].map(p=>post_json<any>('/api/alliances/consider',{process_id:p.process_id},b.session_token)));
	expect(responses.filter(r=>r.json.success)).toHaveLength(1);
	expect(await db_all('SELECT * FROM alliance_pending_slots WHERE guild_id=?',[b.guild_id])).toHaveLength(1);
	const winner=responses.findIndex(r=>r.json.success),loser=winner===0?1:0;
	await vote(b,responses[winner].json.petition_id,'nay');
	const later=(await post_json<any>('/api/alliances/consider',{process_id:[ab,cb][loser].process_id},b.session_token)).json;
	expect(later.success).toBe(true);
});

test('legacy policy processes still carry initiating approval after local deliberation',async()=> {
	const a=await register_guild_client('Legacy Policy A','Legacy Policy A'),b=await register_guild_client('Legacy Policy B','Legacy Policy B');
	const alliance=await found(a,b),now=Date.now(),deadline=now+86400000;
	const subject=`alliance:${alliance.id}:market`;
	await db_run(`INSERT INTO alliance_processes(kind,initiator_guild_id,alliance_id,subject,created_at,expires_at)
		VALUES('market_enable',?,?,?,?,?)`,[a.guild_id,alliance.id,subject,now,deadline]);
	const p=(await db_all<{id:number}>('SELECT id FROM alliance_processes WHERE subject=?',[subject]))[0];
	const conflict=`alliance:${p.id}:local`;
	await db_run(`INSERT INTO guild_petitions(guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,rule_version)
		VALUES(?,?,'alliance_market_enable',?,?,?,?,2)`,[a.guild_id,'Legacy Policy A',conflict,a.client_id,now,deadline]);
	const petition=(await db_all<{id:number}>('SELECT id FROM guild_petitions WHERE conflict_subject=?',[conflict]))[0];
	await db_run('INSERT INTO guild_petition_voters VALUES(?,?)',[petition.id,a.client_id]);
	await db_run("INSERT INTO alliance_process_petitions VALUES(?,?,'local')",[petition.id,p.id]);
	expect((await view(b)).processes.find((row:any)=>row.process_id===p.id)).toMatchObject({stage:'local',governance_version:1,tally:{eligible:0,aye:0}});
	await vote(a,petition.id);
	expect((await view(b)).processes.find((row:any)=>row.process_id===p.id)).toMatchObject({stage:'collective',tally:{eligible:2,aye:1}});
	await vote(b,await next_ballot(b,p.id));
	expect((await view(a)).alliance.shared_marketplace).toBe(1);
});
