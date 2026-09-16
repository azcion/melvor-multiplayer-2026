import { expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_run } from '../support/persistence';

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
