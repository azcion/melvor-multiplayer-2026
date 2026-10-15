import { expect, test } from 'bun:test';
import { make_guild_group } from '../support/fixtures';
import { get_json_with_session, post_json, register_client, request } from '../support/http';
import { db_all, db_run } from '../support/persistence';

type Message = { message_id: number; sender_id: number; petition_event?: string; content: string; parts?: unknown[] };
const messages = (session: string, id: number, cursor = '') => get_json_with_session<{ messages: Message[]; has_more: boolean; petition_votes_visible: boolean; discussion_unread_count: number; error_lang?: string }>(
	`/api/chat/messages?conversation_kind=petition-discussion&conversation_id=${id}${cursor}`, session);
const send = (session: string, id: number, key: string, content = 'A normal reply') => post_json<{ message: Message; error_lang?: string }>(
	'/api/chat/messages/send', { conversation_kind: 'petition-discussion', conversation_id: id, idempotency_key: key, content }, session);
const council = (session: string) => get_json_with_session<{ petitions: { petition_id: number; discussion_unread_count: number }[] }>('/api/guilds/council', session);

test('closed petitions suppress unread alerts without marking retained messages read', async () => {
	const members = await make_guild_group(['Closed Author', 'Closed Reader'], 'Closed Alerts', '1.6.12');
	for (const lifecycle of ['granted', 'denied', 'lapsed', 'withdrawn']) {
		const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
			{ type: 'appellation', name: 'Closed ' + lifecycle }, members[0].session_token)).json.petition_id;
		const event = async () => (await get_json_with_session<{ petition_discussions: {
			discussion_id: number; discussion_unread_count: number; discussion_has_unread_tag: boolean;
		}[] }>('/api/events', members[1].session_token)).json.petition_discussions.find(d => d.discussion_id === id);
		expect((await event())?.discussion_unread_count).toBe(1);
		const read_state = await db_all('SELECT * FROM petition_discussion_read_state WHERE petition_id=? AND client_id=?',
			[id, members[1].client_id]);
		await db_run('UPDATE guild_petitions SET lifecycle=?,resolved_at=created_at,subject_locked=0 WHERE id=?', [lifecycle, id]);
		expect(await event()).toMatchObject({ discussion_unread_count: 0, discussion_has_unread_tag: false });
		expect((await council(members[1].session_token)).json.petitions.find(p => p.petition_id === id)?.discussion_unread_count).toBe(0);
		await send(members[0].session_token, id, 'closed-' + lifecycle);
		expect(await event()).toMatchObject({ discussion_unread_count: 0, discussion_has_unread_tag: false });
		expect(await db_all('SELECT * FROM petition_discussion_read_state WHERE petition_id=? AND client_id=?',
			[id, members[1].client_id])).toEqual(read_state);
		const history = await messages(members[1].session_token, id);
		expect(history.json.messages).toHaveLength(2);
		expect(history.json.discussion_unread_count).toBe(0);
	}
});

test('petition discussion records proposal and immutable votes, supports chat and retains history after resolution', async () => {
	const members = await make_guild_group(['Petition Bob', 'Petition Alice', 'Petition Eve'], 'Petition Discussion', '1.6.10');
	const raised = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Petition Renamed' }, members[0].session_token);
	const id = raised.json.petition_id;
	const initial = await messages(members[1].session_token, id);
	expect(initial.json.messages.map(m => [m.sender_id, m.petition_event])).toEqual([[members[0].client_id, 'proposal']]);
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'aye' }, members[0].session_token);
	// A rejected duplicate ballot cannot append another automatic Message.
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'nay' }, members[0].session_token);
	expect((await council(members[1].session_token)).json.petitions.find(p => p.petition_id === id)?.discussion_unread_count).toBe(0);
	const voted = await messages(members[1].session_token, id);
	expect(voted.json.messages.map(m => [m.sender_id, m.petition_event])).toEqual([
		[members[0].client_id, 'proposal']]);
	expect((await council(members[1].session_token)).json.petitions.find(p => p.petition_id === id)?.discussion_unread_count).toBe(0);
	const reply = await send(members[1].session_token, id, 'ordinary-reply');
	expect((await send(members[1].session_token, id, 'ordinary-reply')).json.message.message_id).toBe(reply.json.message.message_id);
	expect(reply.json.message.petition_event).toBeUndefined();
	expect((await request('/api/chat/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': members[1].session_token }, body: JSON.stringify({ conversation_kind: 'petition-discussion', conversation_id: id, idempotency_key: 'proposal:forged', content: 'Fake' }) })).status).toBe(400);
	expect((await request('/api/chat/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': members[1].session_token }, body: JSON.stringify({ conversation_kind: 'petition-discussion', conversation_id: id, idempotency_key: 'alliance-reason:forged', content: 'Fake' }) })).status).toBe(400);
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'aye' }, members[1].session_token);
	await db_run("UPDATE guild_petitions SET lifecycle='denied',resolved_at=created_at,subject_locked=0 WHERE id=?", [id]);
	expect((await messages(members[2].session_token, id)).json.messages).toHaveLength(4);
	expect((await send(members[2].session_token, id, 'after-resolution')).response.status).toBe(200);
	const outsider = await register_client('Petition Outsider', undefined, '1.6.10');
	expect((await messages(outsider.session_token, id)).json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	expect((await send(outsider.session_token, id, 'outsider')).json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	const old = await register_client('Old Petition Client', undefined, '1.6.9');
	expect((await request(`/api/chat/messages?conversation_kind=petition-discussion&conversation_id=${id}`, { headers: { 'X-Session-Token': old.session_token } })).status).toBe(404);
	const inbox = await get_json_with_session<{ conversations: { conversation_kind: string }[] }>('/api/chat/conversations', members[2].session_token);
	expect(inbox.json.conversations.some(c => c.conversation_kind === 'petition-discussion')).toBe(false);
});

test('creator suppression hides only proposal identity, including from reactions and person picker', async () => {
	const members = await make_guild_group(['Hidden Creator', 'Named Voter', 'Discussion Viewer'], 'Hidden Petition', '1.6.10');
	const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Hidden Renamed' }, members[0].session_token)).json.petition_id;
	const proposal = (await messages(members[1].session_token, id)).json.messages[0]!;
	await db_run('UPDATE guild_petitions SET show_creator=0 WHERE id=?', [id]);
	expect((await messages(members[1].session_token, id)).json.messages).toEqual([]);
	expect((await council(members[2].session_token)).json.petitions.find(p => p.petition_id === id)?.discussion_unread_count).toBe(0);
	const reaction = await post_json<{ error_lang?: string }>('/api/chat/messages/reaction', { conversation_kind: 'petition-discussion', conversation_id: id,
		message_id: proposal.message_id, reaction: '👍', reacted: true }, members[1].session_token);
	expect(reaction.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'nay' }, members[0].session_token);
	expect((await messages(members[2].session_token, id)).json.messages).toEqual([]);
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'aye' }, members[2].session_token);
	await send(members[0].session_token, id, 'creator-reply');
	const visible = (await messages(members[2].session_token, id)).json.messages;
	expect(visible).toHaveLength(3);
	const reacted = await post_json('/api/chat/messages/reaction', { conversation_kind: 'petition-discussion', conversation_id: id,
		message_id: visible[0]!.message_id, reaction: '👍', reacted: true }, members[1].session_token);
	expect(reacted.response.status).toBe(200);
	// Reading older history must leave a newly sent reply unread.
	await send(members[0].session_token, id, 'newer-reply');
	await messages(members[2].session_token, id, `&before=${visible[2]!.message_id}`);
	expect((await council(members[2].session_token)).json.petitions.find(p => p.petition_id === id)?.discussion_unread_count).toBe(1);
	await db_run('DELETE FROM guild_memberships WHERE client_id=?', [members[2].client_id]);
	expect((await messages(members[2].session_token, id)).json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
});


test('active ballots stay private across history, unread and reactions until the viewer votes or closure', async () => {
	const members = await make_guild_group(['Ballot Author', 'Ballot Voter', 'Ballot Viewer', 'Ballot Other'], 'Ballot Privacy', '1.6.10');
	const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Ballot Renamed' }, members[0].session_token)).json.petition_id;
	await messages(members[2].session_token, id);
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'nay' }, members[1].session_token);
	const vote = (await messages(members[1].session_token, id)).json.messages.find(m => m.petition_event === 'nay')!;
	await send(members[0].session_token, id, 'after-hidden-vote');
	const hidden = await messages(members[2].session_token, id);
	expect(hidden.json.petition_votes_visible).toBe(false);
	expect(hidden.json.messages.some(m => m.petition_event === 'nay')).toBe(false);
	const reacted = await post_json<{ error_lang?: string }>('/api/chat/messages/reaction', {
		conversation_kind: 'petition-discussion', conversation_id: id, message_id: vote.message_id,
		reaction: '👍', reacted: true }, members[2].session_token);
	expect(reacted.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'aye' }, members[2].session_token);
	const revealed = await messages(members[2].session_token, id);
	expect(revealed.json.petition_votes_visible).toBe(true);
	expect(revealed.json.messages.filter(m => m.petition_event === 'aye' || m.petition_event === 'nay')).toHaveLength(2);
	expect((await messages(members[3].session_token, id)).json.petition_votes_visible).toBe(false);
	await db_run("UPDATE guild_petitions SET lifecycle='denied',resolved_at=created_at,subject_locked=0 WHERE id=?", [id]);
	const closed = await messages(members[3].session_token, id);
	expect(closed.json.petition_votes_visible).toBe(true);
	expect(closed.json.messages.filter(m => m.petition_event === 'aye' || m.petition_event === 'nay')).toHaveLength(2);
});

test('incremental petition reads deliver all burst messages and acknowledge only delivered rows', async () => {
	const members = await make_guild_group(['Burst Author', 'Burst Reader'], 'Burst Discussion', '1.6.10');
	const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Burst Renamed' }, members[0].session_token)).json.petition_id;
	const initial = (await messages(members[1].session_token, id)).json.messages.at(-1)!.message_id;
	const sent: number[] = [];
	for (let i = 0; i < 30; i++) sent.push((await send(members[0].session_token, id, 'burst-' + i)).json.message.message_id);
	const first = (await messages(members[1].session_token, id, '&after=' + initial)).json;
	expect(first.messages.map(m => m.message_id)).toEqual(sent.slice(0, 20));
	expect(first.has_more).toBe(true);
	expect(first.discussion_unread_count).toBe(10);
	expect((await council(members[1].session_token)).json.petitions.find(p => p.petition_id === id)?.discussion_unread_count).toBe(10);
	const second = (await messages(members[1].session_token, id, '&after=' + first.messages.at(-1)!.message_id)).json;
	expect(second.messages.map(m => m.message_id)).toEqual(sent.slice(20));
	expect(second.has_more).toBe(false);
	expect((await council(members[1].session_token)).json.petitions.find(p => p.petition_id === id)?.discussion_unread_count).toBe(0);
});

test('development clients can read, send and react in petition discussions', async () => {
	const members = await make_guild_group(['Development Author', 'Development Reader'], 'Development Chat', 'development');
	const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Development Name' }, members[0].session_token)).json.petition_id;
	expect((await messages(members[1].session_token, id)).response.status).toBe(200);
	const reply = await send(members[1].session_token, id, 'development-reply');
	expect(reply.response.status).toBe(200);
	expect((await post_json('/api/chat/messages/reaction', { conversation_kind: 'petition-discussion',
		conversation_id: id, message_id: reply.json.message.message_id, reaction: '👍', reacted: true },
		members[0].session_token)).response.status).toBe(200);
});
