import { describe, expect, test } from 'bun:test';
import { get_json_with_session, get_with_session, post, post_json, register_client } from '../support/http';

describe('legacy client compatibility gate', () => {
	test('serves an unread refresh message to pre-1.5.1 clients while blocking other API calls', async () => {
		const client = await register_client('Compatibility Gate', undefined, '1.4.5');
		const authenticated = await post_json<{
			session_token: string;
			chat: { client_id: number; messaging_enabled: boolean; guild_chat_enabled: boolean; budget_enabled: boolean };
		}>('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: client.client_key,
			client_runtime: { mod_version: '1.4.5', active_mods: [] }
		});
		expect(authenticated.response.status).toBe(200);
		expect(authenticated.json.chat).toEqual({
			client_id: client.client_id,
			messaging_enabled: false,
			guild_chat_enabled: false,
			budget_enabled: false
		});

		const session_token = authenticated.json.session_token;
		const events = await get_json_with_session<{ chat_unread: number; friend_requests: unknown[]; gifts: unknown[] }>(
			'/api/events', session_token
		);
		expect(events.json).toMatchObject({ chat_unread: 1, friend_requests: [], gifts: [] });
		const state = await get_json_with_session<{ client_id: number; messaging_enabled: boolean; guild_chat_enabled: boolean; budget_enabled: boolean }>(
			'/api/chat/state', session_token
		);
		expect(state.json).toEqual({
			client_id: client.client_id,
			messaging_enabled: false,
			guild_chat_enabled: false,
			budget_enabled: false
		});

		const conversations = await get_json_with_session<{ conversations: Array<{
			conversation_kind: string;
			conversation_id: number;
			support_team_id: number;
			participant: { client_id: number | null; display_name: string; icon_id: string };
			latest_message: { content: string; message_id: number; sender_id: number | null };
			unread_count: number;
		}> }>('/api/chat/conversations', session_token);
		expect(conversations.json.conversations).toHaveLength(1);
		expect(conversations.json.conversations[0]).toMatchObject({
			conversation_kind: 'support',
			conversation_id: 0,
			support_team_id: 0,
			participant: { client_id: null, display_name: 'System', icon_id: 'multiplayer' },
			latest_message: {
				message_id: 0,
				sender_id: null,
				content: 'Refresh page to continue using Multiplayer.'
			},
			unread_count: 1
		});

		const messages = await get_json_with_session<{ messages: Array<{
			message_id: number;
			sender_id: number | null;
			content: string;
		}>; has_more: boolean }>(
			'/api/chat/messages?conversation_kind=support&conversation_id=0&support_team_id=0', session_token
		);
		expect(messages.json).toMatchObject({
			messages: [{
				message_id: 0,
				sender_id: null,
				content: 'Refresh page to continue using Multiplayer.'
			}],
			has_more: false
		});

		const refreshed = await get_json_with_session<{ conversations: Array<{ unread_count: number }> }>(
			'/api/chat/conversations', session_token
		);
		expect(refreshed.json.conversations[0]?.unread_count).toBe(1);

		for (const path of ['/api/guilds/state', '/api/friends/get'])
			expect((await get_with_session(path, session_token)).status).toBe(403);
		expect((await post('/api/client/set_display_name', { display_name: 'Should Not Change' }, session_token)).status).toBe(403);
	});

	test('does not gate the current or newer clients', async () => {
		for (const [name, mod_version] of [['Current Compatibility Client', '1.5.1'], ['Upcoming Compatibility Client', '1.5.2']]) {
			const client = await register_client(name, undefined, mod_version);
			expect((await get_json_with_session('/api/events', client.session_token)).response.status).toBe(200);
		}
	});
});
