import { expect, test } from 'bun:test';
import { get_json_with_session, get_with_session, post, post_json, register_client } from '../support/http';
import { make_guildmates } from '../support/fixtures';
import { db_all, db_run } from '../support/persistence';

test('admin details respect conversation access, include readers and reactors, and moderate own Private messages', async () => {
	const admin = await register_client('Chat Details Admin', undefined, '1.6.8');
	const reader = await register_client('Chat Details Reader', undefined, '1.6.8');
	const outsider = await register_client('Chat Details Outsider', undefined, '1.6.8');
	await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?', ['TEST-ADMIN-CHAT-DETAILS', admin.client_id]);
	const started = await post_json<any>('/api/chat/conversations/start', { client_id: reader.client_id }, admin.session_token);
	const draft_id = started.json.conversation.conversation_id;
	const key = crypto.randomUUID();
	const sent = await post_json<any>('/api/chat/messages/send', { conversation_id: draft_id, client_id: reader.client_id, idempotency_key: key, content: 'Own admin Message' }, admin.session_token);
	const message_id = sent.json.message.message_id;
	const conversation_id = sent.json.message.conversation_id;
	const body = { conversation_kind: 'private', conversation_id, message_id };
	const endpoint = `/api/chat/messages/details?conversation_kind=private&conversation_id=${conversation_id}&message_id=${message_id}`;
	const initial = await get_json_with_session<any>(endpoint, admin.session_token);
	expect(initial.json).toEqual({ reactions: [], seen: [] });
	await get_json_with_session(`/api/chat/messages?conversation_id=${conversation_id}`, reader.session_token);
	await post_json('/api/chat/messages/reaction', { ...body, reaction: '👍', reacted: true }, reader.session_token);
	const details = await get_json_with_session<any>(endpoint, admin.session_token);
	expect(details.json.reactions).toEqual([expect.objectContaining({ reaction: '👍', client_id: reader.client_id, display_name: reader.display_name })]);
	expect(details.json.seen).toEqual([expect.objectContaining({ client_id: reader.client_id })]);
	expect((await get_with_session(endpoint, outsider.session_token)).status).toBe(403);
	expect((await post('/api/chat/messages/delete-for-all', body, reader.session_token)).status).toBe(403);
	const other = await post_json<any>('/api/chat/conversations/start', { client_id: reader.client_id }, outsider.session_token);
	const other_sent = await post_json<any>('/api/chat/messages/send', { conversation_id: other.json.conversation.conversation_id, client_id: reader.client_id,
		idempotency_key: crypto.randomUUID(), content: 'Outside admin access' }, outsider.session_token);
	const outside = { conversation_kind: 'private', conversation_id: other_sent.json.message.conversation_id, message_id: other_sent.json.message.message_id };
	expect((await get_with_session(`/api/chat/messages/details?conversation_kind=private&conversation_id=${outside.conversation_id}&message_id=${outside.message_id}`, admin.session_token)).status).toBe(404);
	expect((await post('/api/chat/messages/delete-for-all', outside, admin.session_token)).status).toBe(404);
	for (let attempt = 0; attempt < 2; attempt++)
		expect((await post_json<any>('/api/chat/messages/delete-for-all', body, admin.session_token)).json.success).toBe(true);
	for (const client of [admin, reader])
		expect((await get_json_with_session<any>(`/api/chat/messages?conversation_id=${conversation_id}`, client.session_token)).json).toMatchObject({ messages: [], moderation_count: 1 });
	const replay = await post_json<any>('/api/chat/messages/send', { conversation_id, idempotency_key: key, content: 'Own admin Message' }, admin.session_token);
	expect(replay.json.message.message_id).toBe(message_id);
	expect(await db_all('SELECT id FROM chat_messages WHERE id = ?', [message_id])).toHaveLength(1);
	const profile = await get_json_with_session<any>(`/api/chat/profile?client_id=${reader.client_id}`, admin.session_token);
	expect(profile.json.last_active_at).toBeGreaterThan(0);
	expect((await get_json_with_session<any>(`/api/chat/profile?client_id=${reader.client_id}`, outsider.session_token)).json).not.toHaveProperty('last_active_at');
});

test('admin Poll responses retain character ballot attribution and moderate Poll Discussion', async () => {
	const admin = await register_client('Poll Details Admin', undefined, '1.6.8');
	const voter = await register_client('Poll Details Voter', undefined, '1.6.8');
	await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?', ['TEST-ADMIN-POLL-DETAILS', admin.client_id]);
	const created = await post_json<any>('/api/polls/create?capabilities=polls-v1', {
		idempotency_key: crypto.randomUUID(), content: 'Admin details?', options: ['Yes', 'No'], choice_mode: 'multi'
	}, admin.session_token);
	const poll_id = created.json.poll.poll_id;
	await post_json('/api/polls/vote?capabilities=polls-v1', { poll_id, option_id: created.json.poll.options[0].option_id, selected: true }, voter.session_token);
	const endpoint = `/api/polls/responses?capabilities=polls-v1&poll_id=${poll_id}`;
	expect((await get_with_session(endpoint, voter.session_token)).status).toBe(403);
	const responses = await get_json_with_session<any>(endpoint, admin.session_token);
	expect(responses.json.options[0].characters.map((client: any) => client.client_id)).toEqual([voter.client_id]);
	expect(responses.json.options[1].characters).toEqual([]);
	const message = await post_json<any>('/api/chat/messages/send?capabilities=polls-v1', {
		conversation_kind: 'poll-discussion', conversation_id: poll_id, idempotency_key: crypto.randomUUID(), content: 'Own discussion Message'
	}, admin.session_token);
	const message_id = message.json.message.message_id;
	await get_json_with_session(`/api/chat/messages?capabilities=polls-v1&conversation_kind=poll-discussion&conversation_id=${poll_id}`, voter.session_token);
	const details = await get_json_with_session<any>(`/api/chat/messages/details?conversation_kind=poll-discussion&conversation_id=${poll_id}&message_id=${message_id}`, admin.session_token);
	expect(details.json.seen).toContainEqual(expect.objectContaining({ client_id: voter.client_id }));
	for (let attempt = 0; attempt < 2; attempt++) expect((await post_json<any>('/api/chat/messages/delete-for-all', {
		conversation_kind: 'poll-discussion', conversation_id: poll_id, message_id
	}, admin.session_token)).json.success).toBe(true);
	expect((await get_json_with_session<any>(`/api/chat/messages?capabilities=polls-v1&conversation_kind=poll-discussion&conversation_id=${poll_id}`, voter.session_token)).json.messages).toEqual([]);
	const state = await get_json_with_session<any>('/api/polls?capabilities=polls-v1', voter.session_token);
	expect(state.json.discussion_unread_counts[poll_id] ?? 0).toBe(0);
	await post_json('/api/polls/delete?capabilities=polls-v1', { poll_id }, admin.session_token);
});

test('Support admin details resolve member readers and delete every author kind without removing send keys', async () => {
	const admin = await register_client('Support Details Admin', undefined, '1.6.8');
	const player = await register_client('Support Details Player', undefined, '1.6.8');
	await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?', ['TEST-ADMIN-SUPPORT-DETAILS', admin.client_id]);
	const inbox = await get_json_with_session<any>('/api/chat/conversations', player.session_token);
	const support = inbox.json.conversations.find((conversation: any) => conversation.conversation_kind === 'support');
	await db_run('INSERT INTO support_team_memberships(team_id, client_id, member_display_name, created_at) VALUES(?, ?, ?, ?)',
		[support.support_team_id, admin.client_id, 'Support Details Admin', Date.now()]);
	const sent = await post_json<any>('/api/chat/messages/send', { conversation_kind: 'support', conversation_id: null,
		support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(), content: 'Support details please' }, player.session_token);
	const conversation_id = sent.json.message.conversation_id;
	const page = `/api/chat/messages?conversation_kind=support&conversation_id=${conversation_id}`;
	await get_json_with_session(page, admin.session_token);
	const details = await get_json_with_session<any>(`/api/chat/messages/details?conversation_kind=support&conversation_id=${conversation_id}&message_id=${sent.json.message.message_id}`, admin.session_token);
	expect(details.json.seen).toContainEqual(expect.objectContaining({ client_id: admin.client_id }));
	const own = await post_json<any>('/api/chat/messages/send', { conversation_kind: 'support', conversation_id, support_team_id: support.support_team_id,
		idempotency_key: crypto.randomUUID(), content: 'Admin reply' }, admin.session_token);
	const messages = (await get_json_with_session<any>(page, player.session_token)).json.messages;
	expect(messages.some((message: any) => message.message_id === own.json.message.message_id)).toBe(true);
	for (const message of messages) {
		for (let attempt = 0; attempt < 2; attempt++) expect((await post_json<any>('/api/chat/messages/delete-for-all', {
			conversation_kind: 'support', conversation_id, message_id: message.message_id
		}, admin.session_token)).json.success).toBe(true);
	}
	expect((await get_json_with_session<any>(page, player.session_token)).json.messages).toEqual([]);
});


test('shared Chat admin details resolve Global, Expedition, and Guild read watermarks', async () => {
	const pair = await make_guildmates('Shared Details Admin', 'Shared Details Reader', 'Shared Details Guild', { first: '1.6.8', second: '1.6.8' });
	await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?', ['TEST-ADMIN-SHARED-DETAILS', pair.first_id]);
	for (const kind of ['global', 'testers', 'guild']) {
		const conversation_id = kind === 'guild' ? pair.guild_id : 1;
		if (kind === 'guild') await db_run('INSERT INTO guild_chat_messages(guild_id, sender_id, idempotency_key, content, created_at) VALUES(?, ?, ?, ?, ?)',
			[conversation_id, pair.first_id, crypto.randomUUID(), 'Shared details', Date.now()]);
		else await db_run('INSERT INTO global_chat_messages(channel, sender_id, idempotency_key, content, created_at) VALUES(?, ?, ?, ?, ?)',
			[kind === 'testers' ? 'testers' : 'global', pair.first_id, crypto.randomUUID(), 'Shared details', Date.now()]);
		const table = kind === 'guild' ? 'guild_chat_messages' : 'global_chat_messages';
		const [{ id: message_id }] = await db_all<{ id: number }>(`SELECT MAX(id) AS id FROM ${table} WHERE sender_id = ?`, [pair.first_id]);
		const read_table = kind === 'testers' ? 'tester_chat_read_state' : kind + '_chat_read_state';
		if (kind === 'guild') await db_run(`INSERT INTO ${read_table}(guild_id, client_id, last_read_message_id) VALUES(?, ?, ?)
			ON CONFLICT(guild_id, client_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id`, [conversation_id, pair.second_id, message_id]);
		else await db_run(`INSERT INTO ${read_table}(client_id, last_read_message_id) VALUES(?, ?)
			ON CONFLICT(client_id) DO UPDATE SET last_read_message_id = excluded.last_read_message_id`, [pair.second_id, message_id]);
		const details = await get_json_with_session<any>(`/api/chat/messages/details?conversation_kind=${kind}&conversation_id=${conversation_id}&message_id=${message_id}`, pair.first.session_token);
		expect(details.json.seen).toContainEqual(expect.objectContaining({ client_id: pair.second_id }));
		expect(details.json.reactions).toEqual([]);
	}
});
