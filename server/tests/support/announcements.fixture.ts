// Fixed Dev-account eligibility requires the dedicated unit/announcements.test.ts server.
import { expect, test } from 'bun:test';
import { register_client, post, post_json, get_json_with_session, get_with_session } from './http';
import { db_all, db_run } from './persistence';
import { make_guildmates } from './fixtures';
const feed = '/api/chat/messages?conversation_kind=announcements&conversation_id=1';
const send = '/api/chat/messages/send?capabilities=global-chat-v1,guild-chat-v1,polls-v1';
const del = '/api/chat/messages/delete';

test('serves the mandatory feed to supported clients, shares Highlight eligibility and preserves announcements and discussion', async () => {
 const author = await register_client('Announcement author',undefined,'1.7.9');
 const sibling = await register_client('Author sibling',undefined,'1.7.9');
 const reader = await register_client('Announcement reader',undefined,'1.7.9');
 const admin = await register_client('Announcement admin',undefined,'1.7.9');
 await db_run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(15,'announcement-dev','announcement-dev',1)");
 await db_run('UPDATE clients SET melvor_account_id=15,dev_tag_visible=0 WHERE id IN (?,?)',[author.client_id,sibling.client_id]);
 await db_run("UPDATE clients SET client_identifier='ANNOUNCEMENT-ADMIN' WHERE id=?",[admin.client_id]);
 const initial = await get_json_with_session<any>('/api/chat/conversations',reader.session_token);
 expect(initial.json.conversations.some((c:any)=>c.conversation_kind==='announcements')).toBe(true);
 const body={conversation_kind:'announcements',conversation_id:1,content:'Immutable announcement',parts:[{type:'text',text:'News '},{type:'item',item_id:'melvorD:Bronze_Sword'},{type:'feature',feature_id:'multiplayer:Chat'},{type:'person',client_id:reader.client_id}],highlight_color:'#12ab34',idempotency_key:crypto.randomUUID()};
 expect((await post(send,{...body,parts:undefined,highlight_color:undefined},reader.session_token)).status).toBe(403);
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
 const pair=await make_guildmates('Deleting admin','Deleting author','Deletion Guild',{first:'1.7.9',second:'1.7.9'});
 const outsider=await register_client('Deletion outsider',undefined,'1.7.9');
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
 const author = await register_client('Pagination author', undefined, '1.7.9');
 const reader = await register_client('Pagination reader', undefined, '1.7.9');
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

test('limits SAE-only announcements, discussion and unread state to SAE users and admins', async () => {
 const author = await register_client('SAE author', undefined, '1.7.9');
 const sae = await register_client('SAE reader', undefined, '1.7.9');
 const reader = await register_client('Ordinary reader', undefined, '1.7.9');
 const admin = await register_client('SAE admin', undefined, '1.7.9');
 await db_run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(12,'sae-dev','sae-dev',1)");
 await db_run('UPDATE clients SET melvor_account_id=12 WHERE id=?',[author.client_id]);
 await db_run("UPDATE clients SET client_identifier='ANNOUNCEMENT-ADMIN-OLDER' WHERE client_identifier='ANNOUNCEMENT-ADMIN'");
 await db_run("UPDATE clients SET client_identifier='ANNOUNCEMENT-ADMIN' WHERE id=?",[admin.client_id]);
 await db_run("INSERT INTO client_runtime_snapshots(client_id,mod_version,active_mods,reported_at) VALUES(?,'1.7.9',?,1) ON CONFLICT(client_id) DO UPDATE SET active_mods=excluded.active_mods",[sae.client_id,JSON.stringify(['Super Awesome Expansion!'])]);
 const author_inbox = await get_json_with_session<any>('/api/chat/conversations',author.session_token);
 const reader_inbox = await get_json_with_session<any>('/api/chat/conversations',reader.session_token);
 const sae_before = await get_json_with_session<any>('/api/chat/conversations',sae.session_token);
 expect(author_inbox.json.conversations.find((c:any)=>c.conversation_kind==='announcements').announcement_audiences).toContain('sae');
 expect(reader_inbox.json.conversations.find((c:any)=>c.conversation_kind==='announcements').announcement_audiences).not.toContain('sae');
 const body={conversation_kind:'announcements',conversation_id:1,content:'SAE news',audience:'sae',idempotency_key:crypto.randomUUID()};
 expect((await post(send,body,reader.session_token)).status).toBe(403);
 const posted=await post_json<any>(send,body,author.session_token);
 expect(posted.response.status).toBe(200);
 const id=posted.json.message.message_id;
 expect(posted.json.message.audience).toBe('sae');
 const hidden_inbox = await get_json_with_session<any>('/api/chat/conversations',reader.session_token);
 const sae_inbox = await get_json_with_session<any>('/api/chat/conversations',sae.session_token);
 const announcement = (result:any) => result.json.conversations.find((c:any)=>c.conversation_kind==='announcements');
 expect(announcement(hidden_inbox).unread_count).toBe(announcement(reader_inbox).unread_count);
 expect(announcement(hidden_inbox).latest_message?.message_id).not.toBe(id);
 expect(announcement(sae_inbox).unread_count).toBe(announcement(sae_before).unread_count+1);
 expect(announcement(sae_inbox).latest_message.message_id).toBe(id);
 expect((await post(send,{...body,audience:''},author.session_token)).status).toBe(400);
 const hidden=await get_json_with_session<any>(feed,reader.session_token);
 expect(hidden.json.messages.some((m:any)=>m.message_id===id)).toBe(false);
 expect(hidden.json.discussion_unread_counts[id]).toBeUndefined();
 for (const viewer of [sae,admin]) {
  const visible=await get_json_with_session<any>(feed,viewer.session_token);
  expect(visible.json.messages).toContainEqual(expect.objectContaining({message_id:id,audience:'sae'}));
 }
 const discussion='/api/chat/messages?conversation_kind=announcement-discussion&conversation_id='+id;
 expect((await get_json_with_session<any>(discussion,reader.session_token)).json.messages).toBeUndefined();
 expect((await post_json<any>('/api/chat/messages/reaction',{conversation_kind:'announcements',conversation_id:1,message_id:id,reaction:'👍',reacted:true},reader.session_token)).json.success).not.toBe(true);
 expect((await post(send,{conversation_kind:'announcement-discussion',conversation_id:id,content:'Reply',idempotency_key:crypto.randomUUID()},reader.session_token)).status).toBe(400);
});

test('keeps targeted announcements unread until the eligible audience is read', async () => {
 const author = await register_client('Audience transition author', undefined, '1.7.9');
 const reader = await register_client('Audience transition reader', undefined, '1.7.9');
 await db_run('UPDATE clients SET melvor_account_id=12 WHERE id=?',[author.client_id]);
 const mods = JSON.stringify(['Super Awesome Expansion!']);
 const set_mods = async (client_id:number, active_mods:string) => db_run(
  "INSERT INTO client_runtime_snapshots(client_id,mod_version,active_mods,reported_at) VALUES(?,'1.7.9',?,1) ON CONFLICT(client_id) DO UPDATE SET active_mods=excluded.active_mods", [client_id, active_mods]);
 await set_mods(author.client_id, mods);
 const targeted = await post_json<any>(send,{conversation_kind:'announcements',conversation_id:1,
  content:'Audience mention',parts:[{type:'text',text:'Hello '},{type:'person',client_id:reader.client_id}],
  audience:'sae',idempotency_key:crypto.randomUUID()},author.session_token);
 const id = targeted.json.message.message_id;
 const public_post = await post_json<any>(send,{conversation_kind:'announcements',conversation_id:1,
  content:'Public news',idempotency_key:crypto.randomUUID()},author.session_token);
 expect(public_post.json.message.message_id).toBeGreaterThan(id);
 for (let index=0;index<20;index++) await post_json<any>(send,{conversation_kind:'announcements',conversation_id:1,
  content:'Newer public news '+index,idempotency_key:crypto.randomUUID()},author.session_token);
 await get_json_with_session<any>(feed,reader.session_token);
 const details = `/api/chat/messages/details?conversation_kind=announcements&conversation_id=1&message_id=${id}`;
 expect((await get_json_with_session<any>(details,author.session_token)).json.seen.some((c:any)=>c.client_id===reader.client_id)).toBe(false);
 await set_mods(reader.client_id, mods);
 const inbox = await get_json_with_session<any>('/api/chat/conversations',reader.session_token);
 const announcements = inbox.json.conversations.find((c:any)=>c.conversation_kind==='announcements');
 expect(announcements.unread_count).toBeGreaterThan(0);
 expect(announcements.unread_tagged).toBe(true);
 const newest = await get_json_with_session<any>(feed,reader.session_token);
 expect(newest.json.messages.some((m:any)=>m.message_id===id)).toBe(false);
 const older = await get_json_with_session<any>(feed+'&before='+newest.json.messages[0].message_id,reader.session_token);
 expect(older.json.messages.some((m:any)=>m.message_id===id)).toBe(true);
 const read_inbox = await get_json_with_session<any>('/api/chat/conversations',reader.session_token);
 expect(read_inbox.json.conversations.find((c:any)=>c.conversation_kind==='announcements').unread_count).toBe(0);
 expect((await get_json_with_session<any>(details,author.session_token)).json.seen.some((c:any)=>c.client_id===reader.client_id)).toBe(true);
 await set_mods(reader.client_id, '[]');
 await set_mods(reader.client_id, mods);
 const reenabled = await get_json_with_session<any>('/api/chat/conversations',reader.session_token);
 expect(reenabled.json.conversations.find((c:any)=>c.conversation_kind==='announcements').unread_count).toBe(0);
});
