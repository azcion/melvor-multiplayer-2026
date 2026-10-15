import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { make_guild_group, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

const read = (client: {session_token:string}, id:number) => get_json_with_session<any>(
	`/api/chat/messages?conversation_kind=petition-discussion&conversation_id=${id}`,client.session_token);
const send = (client: {session_token:string}, id:number, content='Shared reply', parts?:unknown[]) => post_json<any>(
	'/api/chat/messages/send',{conversation_kind:'petition-discussion',conversation_id:id,idempotency_key:crypto.randomUUID(),content,parts},client.session_token);
const notifications = async (client: {session_token:string}, id:number) =>
	(await get_json_with_session<any>('/api/events',client.session_token)).json.petition_discussions.find((d:any)=>d.discussion_id===id);

test('1.6.11 aliases share messages, personal vote disclosure, tags and live membership while preserving the electorate and closed audience',async()=> {
	const a=await make_guild_group(['Shared A1','Shared A2','Shared A3'],'Shared Guild A','1.6.11');
	const b=await make_guild_group(['Shared B1','Shared B2','Shared B3'],'Shared Guild B','1.6.11');
	const c=await register_guild_client('Shared Applicant','Shared Guild C','1.6.11');
	await db_run('INSERT INTO alliances(name,created_at) VALUES(?,?)',['Shared Alliance',Date.now()]);
	const alliance=(await db_all<{id:number}>('SELECT id FROM alliances WHERE name=?',['Shared Alliance']))[0].id;
	for(const guild of [a[0],b[0]]) await db_run('INSERT INTO alliance_memberships VALUES(?,?,?)',[guild.guild_id,alliance,Date.now()]);
	const proposed=(await post_json<any>('/api/alliances/propose',{kind:'join',target_id:alliance},c.session_token)).json;
	expect(proposed.success).toBe(true);
	const id=proposed.petition_id;
	// The applicant and all existing Guild members can talk before any Council completes.
	expect((await notifications(b[2],id)).discussion_unread_count).toBe(1);
	expect((await read(b[2],id)).json.messages.map((m:any)=>m.petition_event)).toEqual(['proposal']);
	await send(b[0],id);
	expect((await read(c,id)).json.messages).toHaveLength(2);
	expect((await post_json<any>('/api/guilds/petitions/vote',{petition_id:id,choice:'aye'},c.session_token)).json.success).toBe(true);
	const links=await db_all<{id:number;guild_id:number}>(`SELECT p.id,p.guild_id FROM guild_petitions p JOIN alliance_process_petitions l ON l.petition_id=p.id WHERE l.process_id=? AND l.role='ballot'`,[proposed.process_id]);
	const aid=links.find(p=>p.guild_id===a[0].guild_id)!.id;
	const bid=links.find(p=>p.guild_id===b[0].guild_id)!.id;
	expect((await read(a[2],aid)).json.petition_votes_visible).toBe(false);
	expect((await read(a[2],aid)).json.messages.some((m:any)=>m.petition_event==='aye')).toBe(false);
	const reply=await send(b[0],bid,'Cross alias reply');
	const aliasRead=(await read(a[2],aid)).json;
	expect(aliasRead.messages.at(-1).message_id).toBe(reply.json.message.message_id);
	expect(aliasRead.messages.at(-1).conversation_id).toBe(aid);
	expect(reply.json.message.conversation_id).toBe(bid);
	const react=await post_json<any>('/api/chat/messages/reaction',{conversation_kind:'petition-discussion',conversation_id:aid,message_id:reply.json.message.message_id,reaction:'👍',reacted:true},a[2].session_token);
	expect(react.response.status).toBe(200);
	await post_json('/api/guilds/petitions/vote',{petition_id:aid,choice:'aye'},a[0].session_token);
	expect((await read(a[0],aid)).json.messages.filter((m:any)=>m.petition_event==='aye')).toHaveLength(2);
	expect((await notifications(a[2],id)).discussion_unread_count).toBe(0); // automated votes never notify
	await post_json('/api/guilds/petitions/vote',{petition_id:aid,choice:'aye'},a[1].session_token);
	await db_run('UPDATE guild_petitions SET expires_at=? WHERE id=?',[Date.now()-1,aid]);
	await get_json_with_session('/api/alliances',a[0].session_token);
	expect((await db_all<{lifecycle:string}>('SELECT lifecycle FROM guild_petitions WHERE id=?',[aid]))[0].lifecycle).toBe('granted');
	expect((await read(a[2],aid)).json.petition_votes_visible).toBe(false); // local Council closed, overall process open
	expect((await read(b[2],bid)).json.petition_votes_visible).toBe(false);
	const tagged=await send(b[0],bid,'ignored',[{type:'person',client_id:a[2].client_id}]);
	expect(tagged.response.status).toBe(200);
	expect(await notifications(a[2],id)).toMatchObject({discussion_unread_count:1,discussion_has_unread_tag:true,council:true,alliance:true});
	await read(a[2],aid);
	expect(await notifications(a[2],id)).toMatchObject({discussion_unread_count:0,discussion_has_unread_tag:false});
	const late=await register_guild_client('Shared Late Guild','Shared Guild D','1.6.11');
	await db_run('INSERT INTO alliance_memberships VALUES(?,?,?)',[late.guild_id,alliance,Date.now()]);
	expect((await notifications(late,id)).discussion_unread_count).toBeGreaterThan(0);
	expect((await read(late,id)).json.petition_votes_visible).toBe(false);
	expect(await db_all('SELECT 1 FROM alliance_process_petitions l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.process_id=? AND p.guild_id=?',[proposed.process_id,late.guild_id])).toEqual([]);
	await db_run('DELETE FROM alliance_memberships WHERE guild_id=?',[late.guild_id]);
	expect((await read(late,id)).json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	const newcomer=await register_client('Shared Late Member',undefined,'1.6.11');
	await db_run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(?,?)',[newcomer.client_id,b[0].guild_id]);
	expect((await notifications(newcomer,id)).discussion_unread_count).toBeGreaterThan(0);
	await read(newcomer,bid);
	await db_run('DELETE FROM guild_memberships WHERE client_id=?',[newcomer.client_id]);
	expect((await read(newcomer,bid)).json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	// Resolve the overall process: all remaining participants see votes, then its Guild roster freezes.
	await post_json('/api/guilds/petitions/vote',{petition_id:bid,choice:'aye'},b[0].session_token);
	await post_json('/api/guilds/petitions/vote',{petition_id:bid,choice:'aye'},b[1].session_token);
	await db_run('UPDATE guild_petitions SET expires_at=? WHERE id=?',[Date.now()-1,bid]);
	await get_json_with_session('/api/alliances',b[0].session_token);
	expect(await notifications(a[2],id)).toMatchObject({discussion_unread_count:0,discussion_has_unread_tag:false});
	expect((await read(b[2],bid)).json.petition_votes_visible).toBe(true);
	await db_run('DELETE FROM alliance_memberships WHERE guild_id=?',[b[0].guild_id]);
	expect((await read(b[2],bid)).response.status).toBe(200);
	await db_run('INSERT INTO alliance_memberships VALUES(?,?,?)',[late.guild_id,alliance,Date.now()]);
	expect((await read(late,id)).json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	await db_run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(?,?)',[newcomer.client_id,b[0].guild_id]);
	expect((await notifications(newcomer,id)).discussion_unread_count).toBe(0);
	expect((await read(newcomer,bid)).json.messages.length).toBeGreaterThan(0);
	await send(a[0],aid,'Reply after closure');
	expect(await notifications(newcomer,id)).toMatchObject({discussion_unread_count:0,discussion_has_unread_tag:false});
	// Deleting the original petition cannot destroy the other Guilds' retained discussion.
	const database=new Database(process.env.TEST_DB_PATH!);
	try { database.run('PRAGMA foreign_keys=ON'); database.run('PRAGMA busy_timeout=5000'); database.transaction(() => { database.query('DELETE FROM alliance_process_petitions WHERE petition_id=?').run(id); database.query('DELETE FROM guild_petitions WHERE id=?').run(id); }).immediate(); } finally { database.close(); }
	expect((await read(b[2],bid)).json.messages.at(-1).content).toBe('Reply after closure');
	// Other API fixtures intentionally delete unrelated data without FK enforcement.
	expect(await db_all('PRAGMA foreign_key_check(petition_discussions)')).toEqual([]);
	expect(await db_all('PRAGMA foreign_key_check(petition_discussion_links)')).toEqual([]);
});
