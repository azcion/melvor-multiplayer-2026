import { expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_run, db_all } from '../support/persistence';

test('item parts survive sends, retries, history and inboxes across every Chat kind', async () => {
	const { first, second, guild_id } = await make_guildmates(
		'Tag Sender', 'Tag Reader', 'Tag Test Guild', { first: '1.5.14', second: '1.5.14' }
	);
	try {
		const inbox = await get_json_with_session<{ conversations: any[] }>('/api/chat/conversations', first.session_token);
		const support = inbox.json.conversations.find(conversation => conversation.conversation_kind === 'support');
		await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?', ['11111111-1111-4111-8111-111111111111', first.client_id]);
		const poll = await post_json<{ poll: { poll_id: number } }>('/api/polls/create?capabilities=polls-v1', {
			idempotency_key: crypto.randomUUID(), content: 'Tagged discussion', options: ['Yes']
		}, first.session_token);
		for (const kind of ['private', 'guild', 'global', 'support', 'poll-discussion']) {
			const parts = [{ type: 'text', text: 'Use ' }, { type: 'item', item_id: 'melvorD:Bronze_Sword' },
				{ type: 'text', text: ' and ' }, { type: 'item', item_id: 'melvorTotH:Golden_Stardust' }];
			const capability = kind === 'global' ? 'global-chat-v1' : kind === 'poll-discussion' ? 'polls-v1' : 'guild-chat-v1';
			const endpoint = '/api/chat/messages/send?capabilities=' + capability;
			const payload = { conversation_kind: kind, conversation_id: kind === 'guild' ? guild_id : kind === 'global' ? 1 :
				kind === 'poll-discussion' ? poll.json.poll.poll_id : null, client_id: second.client_id,
				support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(), content: 'ignored fallback', parts };
			const sent = await post_json<{ success: boolean; message: any }>(endpoint, payload, first.session_token);
			expect(sent.response.status).toBe(200);
			expect(sent.json.success).toBe(true);
			expect(sent.json.message.parts).toEqual(parts);
			expect(sent.json.message.content).toBe('Use [Bronze Sword] and [Golden Stardust]');
			const retry = await post_json<{ message: any }>(endpoint, payload, first.session_token);
			expect(retry.json.message.message_id).toBe(sent.json.message.message_id);
			const changed = [...parts]; changed[1] = { type: 'item', item_id: 'melvorF:Bronze_Sword' };
			expect((await post(endpoint, { ...payload, parts: changed }, first.session_token)).status).toBe(400);
			expect((await post(endpoint, { ...payload, parts: undefined, content: sent.json.message.content }, first.session_token)).status).toBe(400);
			const history = await get_json_with_session<{ messages: any[] }>(`/api/chat/messages?conversation_kind=${kind}&conversation_id=${sent.json.message.conversation_id}&support_team_id=${support.support_team_id}&capabilities=${capability}`, first.session_token);
			expect(history.json.messages.find(message => message.message_id === sent.json.message.message_id).parts).toEqual(parts);
			const people = await get_json_with_session<any>(`/api/chat/messages?conversation_kind=${kind}&conversation_id=${sent.json.message.conversation_id}&support_team_id=${support.support_team_id}&capabilities=${capability}&people=1`, first.session_token);
			expect(people.response.status).toBe(200);
			expect(people.json.people.some((person: any) => person.client_id === second.client_id)).toBe(true);
			if (kind !== 'poll-discussion') {
				const updated = await get_json_with_session<{ conversations: any[] }>('/api/chat/conversations?capabilities=global-chat-v1,guild-chat-v1', first.session_token);
				expect(updated.json.conversations.find(conversation => (conversation.conversation_kind ?? 'private') === kind)?.latest_message.parts).toEqual(parts);
			}
			if (kind === 'support') {
				await db_run('UPDATE support_messages SET content = ? WHERE id = ?', ['Corrected plain text', sent.json.message.message_id]);
				const corrected = await get_json_with_session<{ messages: any[] }>(`/api/chat/messages?conversation_kind=support&conversation_id=${sent.json.message.conversation_id}&support_team_id=${support.support_team_id}`, first.session_token);
				const message = corrected.json.messages.find(message => message.message_id === sent.json.message.message_id);
				expect(message.content).toBe('Corrected plain text');
				expect(message.parts).toBeUndefined();
				expect(message.translations).toEqual({});
			}
			for (const bad of [[{ type: 'item', item_id: 'someMod:Item' }], [{ type: 'text', text: 'a'.repeat(1001) }], Array(21).fill(parts[1])])
				expect((await post(endpoint, { ...payload, idempotency_key: crypto.randomUUID(), parts: bad }, first.session_token)).status).toBe(400);
		}
	} finally {
		// These three domains are shared by later API fixtures in the same server process.
		await db_run('DELETE FROM global_chat_messages WHERE sender_id = ?', [first.client_id]);
		await db_run('DELETE FROM support_conversations WHERE player_client_id = ?', [first.client_id]);
		await db_run('DELETE FROM polls WHERE creator_id = ?', [first.client_id]);
		await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?', [first.client_identifier, first.client_id]);
	}
});

test('feature tags stay structured for 1.6.0 and readable for 1.5.16', async () => {
	const { first, second } = await make_guildmates(
		'Feature Sender', 'Legacy Reader', 'Feature Tag Guild', { first: '1.6.0', second: '1.5.16' }
	);
	const parts = [{ type: 'text', text: 'Try ' }, { type: 'feature', feature_id: 'multiplayer:Guild_Raid' },
		{ type: 'text', text: ' and ' }, { type: 'feature', feature_id: 'melvorD:Cooking' }];
	const payload = { conversation_kind: 'private', conversation_id: null, client_id: second.client_id,
		idempotency_key: crypto.randomUUID(), content: 'ignored', parts };
	const sent = await post_json<{ message: any }>('/api/chat/messages/send', payload, first.session_token);
	expect(sent.response.status).toBe(200);
	expect(sent.json.message.parts).toEqual(parts);
	expect(sent.json.message.content).toBe('Try $Raid and $Cooking');
	const conversation_id = sent.json.message.conversation_id;
	const new_history = await get_json_with_session<{ messages: any[] }>(
		`/api/chat/messages?conversation_id=${conversation_id}`, first.session_token);
	expect(new_history.json.messages[0].parts).toEqual(parts);
	const old_history = await get_json_with_session<{ messages: any[] }>(
		`/api/chat/messages?conversation_id=${conversation_id}`, second.session_token);
	expect(old_history.json.messages[0].content).toBe('Try $Raid and $Cooking');
	expect(old_history.json.messages[0].parts).toBeUndefined();
	const inbox = await get_json_with_session<{ conversations: any[] }>('/api/chat/conversations', second.session_token);
	expect(inbox.json.conversations.find(conversation => conversation.conversation_id === conversation_id)
		?.latest_message.parts).toBeUndefined();
	expect((await post('/api/chat/messages/send', { ...payload, idempotency_key: crypto.randomUUID(),
		client_id: first.client_id, conversation_id }, second.session_token)).status).toBe(400);
});

test('person tags allow outsiders, reject self and missing targets, and prioritize full visible history', async () => {
	const { first, second, guild_id } = await make_guildmates('Mention Sender', 'Lucy Mention', 'Mention Guild', { first: '1.6.9', second: '1.6.8' });
	const { first: outsider } = await make_guildmates('Albert Mention', 'Bob Mention', 'Other Mention Guild', { first: '1.6.9', second: '1.6.9' });
	const endpoint = '/api/chat/messages/send?capabilities=guild-chat-v1,global-chat-v1';
	const send = (sender: typeof first, parts: unknown[], conversation_kind = 'guild', conversation_id: number | null = guild_id) =>
		post_json<any>(endpoint, { conversation_kind, conversation_id, client_id: second.client_id,
			idempotency_key: crypto.randomUUID(), content: 'ignored', parts }, sender.session_token);
	const person = { type: 'person', client_id: outsider.client_id, display_name: 'Spoof', icon_id: 'Spoof' };
	await send(second, [{ type: 'text', text: 'hello' }]);
	const sent = await send(first, [{ type: 'text', text: 'Hi ' }, person]);
	expect(sent.json.success).toBe(true);
	expect(sent.json.message.parts[1]).toMatchObject({ type: 'person', client_id: outsider.client_id, display_name: 'Albert Mention' });
	expect(sent.json.message.content).toBe('Hi @Albert Mention');
	for (const id of [first.client_id, 0, -1, Number.MAX_SAFE_INTEGER, 1.5])
		expect((await post(endpoint, { conversation_kind: 'guild', conversation_id: guild_id, idempotency_key: crypto.randomUUID(), content: 'ignored', parts: [{ ...person, client_id: id }] }, first.session_token)).status).toBe(400);
	expect((await post(endpoint, { conversation_kind: 'guild', conversation_id: guild_id, idempotency_key: crypto.randomUUID(), content: 'ignored', parts: [person] }, second.session_token)).status).toBe(400);
	const url = `/api/chat/messages?conversation_kind=guild&conversation_id=${guild_id}&capabilities=guild-chat-v1`;
	const legacy = await get_json_with_session<any>(url, second.session_token);
	expect(legacy.json.messages.at(-1).parts).toBeUndefined();
	expect(legacy.json.messages.at(-1).content).toBe('Hi @Albert Mention');
	// The speaker must still be prioritized after their Message falls outside the initial history page.
	for (let index = 0; index < 60; index++)
		await db_run('INSERT INTO guild_chat_messages (guild_id, sender_id, idempotency_key, content, created_at, shadow_hidden) VALUES (?, ?, ?, ?, ?, 0)', [guild_id, first.client_id, crypto.randomUUID(), 'Later message', Date.now()]);
	const directory = await get_json_with_session<any>(url + '&people=1', first.session_token);
	expect(directory.json.people[0].client_id).toBe(second.client_id);
	expect(directory.json.people.some((p: any) => p.client_id === first.client_id)).toBe(false);
	expect(directory.json.people.some((p: any) => p.client_id === outsider.client_id)).toBe(true);
	const remainder = directory.json.people.slice(1);
	expect(remainder).toEqual([...remainder].sort((a: any, b: any) => a.display_name.localeCompare(b.display_name) || a.client_id - b.client_id));
	const denied = await get_json_with_session<any>(url + '&people=1', outsider.session_token);
	expect(denied.json.people).toBeUndefined();
	const private_sent = await send(first, [person], 'private', null);
	expect(private_sent.json.success).toBe(true);
	const private_people = await get_json_with_session<any>(`/api/chat/messages?conversation_kind=private&conversation_id=${private_sent.json.message.conversation_id}&people=1`, first.session_token);
	expect(private_people.response.status).toBe(200);
	const global = await send(first, [person], 'global', 1);
	expect(global.json.success).toBe(true);
	await db_run('DELETE FROM global_chat_messages WHERE sender_id = ?', [first.client_id]);
});


test('person picker orders speakers, active Guild members, then outsiders and excludes Shadowed people', async () => {
	const { first, second, guild_id } = await make_guildmates('Picker Viewer', 'Z Picker Speaker', 'Picker Order Guild', { first: '1.6.9', second: '1.6.9' });
	const newer = await register_client('Z Picker Newer');
	const older = await register_client('A Picker Older');
	const shadowed = await register_client('Picker Shadowed');
	const outsider = await register_client('A Picker Outsider');
	await db_run('UPDATE clients SET last_multiplayer_active_at = ? WHERE id = ?', [Date.now(), outsider.client_id]);
	for (const member of [newer, older, shadowed])
		await db_run('INSERT INTO guild_memberships (guild_id, client_id, joined_at) VALUES (?, ?, ?)', [guild_id, member.client_id, Date.now()]);
	await db_run('UPDATE clients SET last_multiplayer_active_at = ? WHERE id = ?', [Date.now() - 1000, newer.client_id]);
	await db_run('UPDATE clients SET last_multiplayer_active_at = ? WHERE id = ?', [Date.now() - 60000, older.client_id]);
	await db_run('UPDATE clients SET last_multiplayer_active_at = 0 WHERE id = ?', [shadowed.client_id]);
	for (const speaker of [second, shadowed])
		await db_run('INSERT INTO guild_chat_messages (guild_id, sender_id, idempotency_key, content, created_at) VALUES (?, ?, ?, ?, ?)', [guild_id, speaker.client_id, crypto.randomUUID(), 'hello', Date.now()]);
	const result = await get_json_with_session<any>(`/api/chat/messages?conversation_kind=guild&conversation_id=${guild_id}&capabilities=guild-chat-v1&people=1`, first.session_token);
	const ids = result.json.people.map((person: any) => person.client_id);
	expect(ids.slice(0, 3)).toEqual([second.client_id, newer.client_id, older.client_id]);
	expect(ids.indexOf(outsider.client_id)).toBeGreaterThan(2);
	expect(ids.includes(shadowed.client_id)).toBe(false);
	expect(new Set(ids).size).toBe(ids.length);
});


test('unread person tags survive later untagged replies and clear after reading across ordinary chats', async () => {
	const { first, second, guild_id } = await make_guildmates('Badge Sender', 'Badge Reader', 'Badge Guild', { first: '1.6.9', second: '1.6.9' });
	const outsider = await register_client('Badge Outsider', undefined, '1.6.9');
	const capabilities = 'global-chat-v1,guild-chat-v1';
	const inbox = (client: typeof first) => get_json_with_session<any>('/api/chat/conversations?capabilities=' + capabilities, client.session_token);
	try {
		for (const kind of ['private', 'guild', 'global', 'testers']) {
			// Initialize join-time read boundaries before any tagged Message is sent.
			await inbox(second);
			const send = (parts: unknown[]) => post_json<any>('/api/chat/messages/send?capabilities=' + capabilities, {
				conversation_kind: kind, conversation_id: kind === 'private' ? null : kind === 'guild' ? guild_id : 1,
				client_id: second.client_id, idempotency_key: crypto.randomUUID(), content: 'ignored', parts
			}, first.session_token);
			const tagged = await send([{ type: 'person', client_id: second.client_id }]);
			expect(tagged.json.success).toBe(true);
			const conversation_id = tagged.json.message.conversation_id;
			await send([{ type: 'text', text: 'Later untagged reply' }]);
			const conversation = (await inbox(second)).json.conversations.find((c: any) => c.conversation_kind === kind && c.conversation_id === conversation_id);
			expect(conversation.unread_tagged).toBe(true);
			expect(conversation.latest_message.parts).toBeUndefined();
			const sender = (await inbox(first)).json.conversations.find((c: any) => c.conversation_kind === kind && c.conversation_id === conversation_id);
			expect(sender.unread_tagged).toBe(false);
			if (kind === 'guild' || kind === 'private')
				expect((await inbox(outsider)).json.conversations.some((c: any) => c.conversation_kind === kind && c.conversation_id === conversation_id)).toBe(false);
			await get_json_with_session<any>(`/api/chat/messages?conversation_kind=${kind}&conversation_id=${conversation_id}&capabilities=${capabilities}`, second.session_token);
			expect((await inbox(second)).json.conversations.find((c: any) => c.conversation_kind === kind && c.conversation_id === conversation_id).unread_tagged).toBe(false);
		}
	} finally {
		await db_run('DELETE FROM global_chat_messages WHERE sender_id = ?', [first.client_id]);
	}
});


test('Alliance person tags use the current Alliance read boundary and visibility', async () => {
	const { first, second, guild_id } = await make_guildmates('Alliance Tag Sender', 'Alliance Tag Reader', 'Alliance Tag Guild', { first: '1.6.9', second: '1.6.9' });
	await db_run('INSERT INTO alliances(name,shared_marketplace,created_at) VALUES(?,1,?)', ['Tag Alliance', Date.now()]);
	const [alliance] = await db_all<{ id: number }>('SELECT id FROM alliances WHERE name = ?', ['Tag Alliance']);
	await db_run('INSERT INTO alliance_memberships(guild_id,alliance_id,joined_at) VALUES(?,?,?)', [guild_id, alliance!.id, Date.now()]);
	const inbox = () => get_json_with_session<any>('/api/chat/conversations', second.session_token);
	await inbox();
	const sent = await post_json<any>('/api/chat/messages/send', { conversation_kind: 'alliance', conversation_id: alliance!.id,
		idempotency_key: crypto.randomUUID(), content: 'ignored', parts: [{ type: 'person', client_id: second.client_id }] }, first.session_token);
	expect(sent.json.success).toBe(true);
	expect((await inbox()).json.conversations.find((c: any) => c.conversation_kind === 'alliance').unread_tagged).toBe(true);
	await db_run('UPDATE alliance_chat_messages SET shadow_hidden = 1 WHERE id = ?', [sent.json.message.message_id]);
	expect((await inbox()).json.conversations.find((c: any) => c.conversation_kind === 'alliance').unread_tagged).toBe(false);
	await db_run('UPDATE alliance_chat_messages SET shadow_hidden = 0 WHERE id = ?', [sent.json.message.message_id]);
	await get_json_with_session(`/api/chat/messages?conversation_kind=alliance&conversation_id=${alliance!.id}`, second.session_token);
	expect((await inbox()).json.conversations.find((c: any) => c.conversation_kind === 'alliance').unread_tagged).toBe(false);
});

test('Support person tags follow player and team unread acknowledgements', async () => {
	const player = await register_client('Support Tag Player', undefined, '1.6.9');
	const member = await register_client('Support Tag Member', undefined, '1.6.9');
	const inbox = (client: typeof player) => get_json_with_session<any>('/api/chat/conversations', client.session_token);
	const support = (await inbox(player)).json.conversations.find((c: any) => c.conversation_kind === 'support');
	await db_run('INSERT INTO support_team_memberships(team_id, client_id, member_display_name, created_at) VALUES(?, ?, ?, ?)',
		[support.support_team_id, member.client_id, 'Support Tag Member', Date.now()]);
	try {
		const send = (sender: typeof player, target: typeof player, conversation_id: number | null) => post_json<any>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id, support_team_id: support.support_team_id,
			idempotency_key: crypto.randomUUID(), content: 'ignored', parts: [{ type: 'person', client_id: target.client_id }]
		}, sender.session_token);
		const sent = await send(player, member, null);
		expect(sent.json.success).toBe(true);
		const id = sent.json.message.conversation_id;
		const conversation = (result: any) => result.json.conversations.find((c: any) => c.conversation_kind === 'support' && c.conversation_id === id);
		expect(conversation(await inbox(member)).unread_tagged).toBe(true);
		await get_json_with_session(`/api/chat/messages?conversation_kind=support&conversation_id=${id}`, member.session_token);
		expect(conversation(await inbox(member)).unread_tagged).toBe(false);
		expect((await send(member, player, id)).json.success).toBe(true);
		expect(conversation(await inbox(player)).unread_tagged).toBe(true);
		await get_json_with_session(`/api/chat/messages?conversation_kind=support&conversation_id=${id}`, player.session_token);
		expect(conversation(await inbox(player)).unread_tagged).toBe(false);
	} finally {
		await db_run('DELETE FROM support_conversations WHERE player_client_id = ?', [player.client_id]);
		await db_run('DELETE FROM support_team_memberships WHERE client_id = ?', [member.client_id]);
	}
});


test('badge features retain new-client rendering and old-client text in responses, history and inbox', async () => {
	const { first, second } = await make_guildmates('Badge Sender', 'Badge Reader', 'Badge Guild',
		{ first: '1.6.13', second: '1.6.12' });
	const parts = [{ type: 'text', text: 'Discuss ' }, { type: 'feature', feature_id: 'multiplayer:Badge_Item_Cheats' },
		{ type: 'text', text: ' in ' }, { type: 'feature', feature_id: 'multiplayer:Guild_Raid' }];
	const downgraded = [parts[0], { type: 'text', text: '[Item Cheats]' }, parts[2], parts[3]];
	const sent = await post_json<any>('/api/chat/messages/send', { conversation_kind: 'private',
		client_id: second.client_id, conversation_id: null, idempotency_key: crypto.randomUUID(), content: 'ignored', parts }, first.session_token);
	expect(sent.response.status).toBe(200);
	expect(sent.json.message.parts).toEqual(parts);
	expect(sent.json.message.content).toBe('Discuss [Item Cheats] in $Raid');
	const conversation_id = sent.json.message.conversation_id;
	for (const [client, expected] of [[first, parts], [second, downgraded]] as const) {
		const history = await get_json_with_session<any>(`/api/chat/messages?conversation_id=${conversation_id}`, client.session_token);
		expect(history.json.messages[0].parts).toEqual(expected);
		const inbox = await get_json_with_session<any>('/api/chat/conversations', client.session_token);
		expect(inbox.json.conversations.find((row: any) => row.conversation_id === conversation_id).latest_message.parts).toEqual(expected);
	}
	const old_send = await post_json<any>('/api/chat/messages/send', { conversation_kind: 'private',
		client_id: first.client_id, conversation_id, idempotency_key: crypto.randomUUID(), content: 'ignored', parts }, second.session_token);
	expect(old_send.json.message.parts).toEqual(downgraded);
});
