// Fixed Dev-account eligibility requires the dedicated unit/announcements.test.ts server.
import { expect, test } from 'bun:test';
import { register_client, post, post_json, get_json_with_session, get_with_session } from './http';
import { db_all, db_run } from './persistence';
import { make_guildmates } from './fixtures';
const feed = '/api/chat/messages?conversation_kind=announcements&conversation_id=1';
const send = '/api/chat/messages/send?capabilities=global-chat-v1,guild-chat-v1,polls-v1';
const del = '/api/chat/messages/delete';

test('gates the mandatory feed by version, shares Highlight eligibility and preserves announcements and discussion', async () => {
 const author = await register_client('Announcement author',undefined,'1.7.0');
 const sibling = await register_client('Author sibling',undefined,'1.7.0');
 const reader = await register_client('Announcement reader',undefined,'1.7.0');
 const legacy = await register_client('Legacy reader',undefined,'1.6.14');
 const admin = await register_client('Announcement admin',undefined,'1.7.0');
 await db_run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(15,'announcement-dev','announcement-dev',1)");
 await db_run('UPDATE clients SET melvor_account_id=15,dev_tag_visible=0 WHERE id IN (?,?)',[author.client_id,sibling.client_id]);
 await db_run("UPDATE clients SET client_identifier='ANNOUNCEMENT-ADMIN' WHERE id=?",[admin.client_id]);
 for (const [client,visible] of [[reader,true],[legacy,false]] as const) {
  const inbox = await get_json_with_session<any>('/api/chat/conversations',client.session_token);
  expect(inbox.json.conversations.some((c:any)=>c.conversation_kind==='announcements')).toBe(visible);
 }
 expect((await get_with_session(feed,legacy.session_token)).status).toBe(404);
 const body={conversation_kind:'announcements',conversation_id:1,content:'Immutable announcement',parts:[{type:'text',text:'News '},{type:'item',item_id:'melvorD:Bronze_Sword'},{type:'feature',feature_id:'multiplayer:Chat'},{type:'person',client_id:reader.client_id}],highlight_color:'#12ab34',idempotency_key:crypto.randomUUID()};
 expect((await post(send,{...body,parts:undefined,highlight_color:undefined},reader.session_token)).status).toBe(403);
 expect((await post(send,body,legacy.session_token)).status).toBe(404);
 const sent=await post_json<any>(send,body,author.session_token);
 expect(sent.response.status).toBe(200);
 const id=sent.json.message.message_id;
 expect((await post_json<any>(send,body,author.session_token)).json.message.message_id).toBe(id);
 expect(sent.json.message.highlight_color).toBe('#12AB34');
 expect(sent.json.message.parts.map((p:any)=>p.type)).toEqual(['text','item','feature','person']);
 expect((await post(send,{...body,highlight_color:'#FFFFFF'},author.session_token)).status).toBe(400);
 expect((await post(send,{...body,parts:[{type:'text',text:'Changed'}]},author.session_token)).status).toBe(400);
 const inbox=await get_json_with_session<any>('/api/chat/conversations',reader.session_token);
 expect(inbox.json.conversations.find((c:any)=>c.conversation_kind==='announcements')).toMatchObject({unread_count:1,unread_tagged:true,can_send:false,contributes_unread:true});
 const baseline=await get_json_with_session<any>('/api/events',reader.session_token);
 expect(baseline.json.chat_unread).toBeGreaterThan(0);
 expect((await get_json_with_session<any>(feed,reader.session_token)).json.messages[0]).toMatchObject({message_id:id,can_delete:false,deleted:false,highlight_color:'#12AB34',parts:sent.json.message.parts});
 const reaction={conversation_kind:'announcements',conversation_id:1,message_id:id,reaction:'👍',reacted:true};
 expect((await post('/api/chat/messages/reaction',reaction,reader.session_token)).status).toBe(200);
 expect((await get_json_with_session<any>(feed+'&reaction_after=0&after='+id,reader.session_token)).json.reaction_updates).toContainEqual(expect.objectContaining({message_id:id}));
 const reply={conversation_kind:'announcement-discussion',conversation_id:id,content:'Discussion reply',idempotency_key:crypto.randomUUID()};
 const response=await post_json<any>(send,reply,author.session_token);
 expect(response.response.status).toBe(200);
 const updated=await get_json_with_session<any>(feed+'&after='+id,reader.session_token);
 expect(updated.json.discussion_unread_counts[id]).toBe(1);
 const events=await get_json_with_session<any>('/api/events',reader.session_token);
 expect(events.json.chat_unread).toBe(baseline.json.chat_unread-1);
 const polls=await get_json_with_session<any>('/api/polls?capabilities=polls-v1',reader.session_token);
 expect(polls.json.polls.some((p:any)=>p.poll_id===id)).toBe(false);
 expect((await post('/api/polls/vote?capabilities=polls-v1',{poll_id:id,option_id:1,selected:true},reader.session_token)).status).not.toBe(200);
 expect((await get_json_with_session<any>('/api/chat/messages?capabilities=polls-v1&conversation_kind=poll-discussion&conversation_id='+id,reader.session_token)).json.messages).toBeUndefined();
 expect((await post(del,{conversation_kind:'announcements',conversation_id:1,message_id:id},reader.session_token)).status).toBe(403);
 expect((await post(del,{conversation_kind:'announcements',conversation_id:1,message_id:id},sibling.session_token)).status).toBe(200);
 expect((await get_json_with_session<any>(feed,reader.session_token)).json.messages).toEqual([]);
 expect((await get_json_with_session<any>(feed,admin.session_token)).json.messages).toContainEqual(expect.objectContaining({message_id:id,deleted:true,can_delete:false,content:sent.json.message.content}));
 expect((await post_json<any>('/api/chat/messages/reaction',reaction,admin.session_token)).json.success).not.toBe(true);
 expect((await post_json<any>(send,{...reply,idempotency_key:crypto.randomUUID()},admin.session_token)).json.success).not.toBe(true);
 expect((await db_all('SELECT id FROM polls WHERE id=? AND deleted_at IS NOT NULL',[id])).length).toBe(1);
 expect((await db_all('SELECT message_id FROM announcement_reactions WHERE message_id=?',[id])).length).toBe(1);
 expect((await db_all('SELECT id FROM poll_discussion_messages WHERE poll_id=?',[id])).length).toBe(1);
});

test('authors delete ordinary messages globally while retaining rows and historical personal hides',async()=>{
 const pair=await make_guildmates('Deleting admin','Deleting author','Deletion Guild',{first:'1.7.0',second:'1.7.0'});
 const outsider=await register_client('Deletion outsider',undefined,'1.7.0');
 // Release the earlier fixture's configured identifier before assigning it to this participant.
 await db_run("UPDATE clients SET client_identifier='ANNOUNCEMENT-ADMIN-PREVIOUS' WHERE client_identifier='ANNOUNCEMENT-ADMIN'");
 await db_run("UPDATE clients SET client_identifier='ANNOUNCEMENT-ADMIN' WHERE id=?",[pair.first_id]);
 const inbox=await get_json_with_session<any>('/api/chat/conversations',pair.second.session_token);
 const support=inbox.json.conversations.find((c:any)=>c.conversation_kind==='support');
 await db_run('INSERT INTO alliances(name,created_at) VALUES(?,?)',['Deletion alliance',Date.now()]);
 const [alliance]=await db_all<{id:number}>('SELECT id FROM alliances WHERE name=?',['Deletion alliance']);
 await db_run('INSERT INTO alliance_memberships(guild_id,alliance_id,joined_at) VALUES(?,?,?)',[pair.guild_id,alliance.id,Date.now()]);
 const other=await make_guildmates('Other member','Other reader','Other Guild');
 await db_run('INSERT INTO alliance_memberships(guild_id,alliance_id,joined_at) VALUES(?,?,?)',[other.guild_id,alliance.id,Date.now()]);
 await db_run('INSERT INTO polls(creator_id,idempotency_key,content,created_at,revision) VALUES(?,?,?,?,?)',[pair.first_id,crypto.randomUUID(),'Deletion discussion',Date.now(),1]);
 const [poll]=await db_all<{id:number}>('SELECT MAX(id) AS id FROM polls');
 const petition=await post_json<any>('/api/guilds/petitions/raise',{type:'appellation',name:'Deletion renamed'},pair.first.session_token);
 for(const kind of ['private','guild','global','support','alliance','poll-discussion','petition-discussion']){
  const body={conversation_kind:kind,conversation_id:kind==='guild'?pair.guild_id:kind==='global'?1:kind==='alliance'?alliance.id:kind==='poll-discussion'?poll.id:kind==='petition-discussion'?petition.json.petition_id:null,
   client_id:pair.first_id,...(kind==='support'?{support_team_id:support.support_team_id}:{}),content:'Delete '+kind,idempotency_key:crypto.randomUUID()};
  const sent=await post_json<any>(send,body,pair.second.session_token);
  expect({kind,status:sent.response.status,success:sent.json.success,error:sent.json.error_lang}).toEqual({kind,status:200,success:true,error:undefined});
  const message_id=sent.json.message.message_id,conversation_id=sent.json.message.conversation_id;
  const mutation={conversation_kind:kind,conversation_id,message_id};
  expect((await post(del,mutation,outsider.session_token)).status).not.toBe(200);
  for(let retry=0;retry<2;retry++)expect((await post(del,mutation,pair.second.session_token)).status).toBe(200);
  const url=`/api/chat/messages?capabilities=guild-chat-v1,global-chat-v1,polls-v1&conversation_kind=${kind}&conversation_id=${conversation_id}`;
  expect((await get_json_with_session<any>(url,pair.second.session_token)).json.messages.some((m:any)=>m.message_id===message_id)).toBe(false);
  if(kind!=='support')expect((await get_json_with_session<any>(url,pair.first.session_token)).json.messages).toContainEqual(expect.objectContaining({message_id,deleted:true,can_delete:false,content:body.content}));
 }
});

test('pages incremental announcements without skipping an intervening batch', async () => {
 const author = await register_client('Pagination author', undefined, '1.7.0');
 const reader = await register_client('Pagination reader', undefined, '1.7.0');
 await db_run('UPDATE clients SET melvor_account_id=15 WHERE id=?',[author.client_id]);
 const ids: number[] = [];
 for (let index=0;index<25;index++) {
  const sent = await post_json<any>(send,{conversation_kind:'announcements',conversation_id:1,
   content:'Page '+index,idempotency_key:crypto.randomUUID()},author.session_token);
  ids.push(sent.json.message.message_id);
 }
 const first = await get_json_with_session<any>(feed+'&after='+(ids[0]-1),reader.session_token);
 expect(first.json.messages.map((message:any)=>message.message_id)).toEqual(ids.slice(0,20));
 expect(first.json.has_more).toBe(true);
 const next = await get_json_with_session<any>(feed+'&after='+ids[19],reader.session_token);
 expect(next.json.messages.map((message:any)=>message.message_id)).toEqual(ids.slice(20));
 expect(next.json.has_more).toBe(false);
});
