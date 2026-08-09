import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_run } from '../support/persistence';

type Conversation = {
	conversation_id: number;
	participant: { client_id: number; display_name: string; icon_id: string };
	latest_message?: Message | null;
	unread_count?: number;
	blocked?: boolean;
};

type Message = {
	message_id: number;
	conversation_id: number;
	sender_id: number;
	sender: { display_name: string; icon_id: string };
	content: string;
	created_at: number;
};

async function start_chat(session_token: string, client_id: number) {
	return post_json<{ success?: boolean; conversation?: Conversation; error_lang?: string }>(
		'/api/chat/conversations/start',
		{ client_id },
		session_token
	);
}

async function send_chat(session_token: string, conversation_id: number, content: string, key: string = crypto.randomUUID()) {
	return post_json<{
		success?: boolean;
		message?: Message;
		budget?: { credits: number; maximum: number; refill_interval: number; next_refill_at: number };
		error_lang?: string;
	}>('/api/chat/messages/send', { conversation_id, idempotency_key: key, content }, session_token);
}

async function conversations(session_token: string) {
	return get_json_with_session<{ conversations: Conversation[] }>('/api/chat/conversations', session_token);
}

async function messages(session_token: string, conversation_id: number, cursor = '') {
	return get_json_with_session<{ messages: Message[]; has_more: boolean }>(
		`/api/chat/messages?conversation_id=${conversation_id}${cursor}`,
		session_token
	);
}

describe('Private Chat API', () => {
	test('starts one canonical conversation only for Guildmates', async () => {
		const pair = await make_guildmates('Chat Starter', 'Chat Recipient');
		const outsider = await register_client('Chat Outsider');
		const started = await start_chat(pair.first.session_token, pair.second_id);
		const duplicate = await start_chat(pair.second.session_token, pair.first_id);
		const outside = await start_chat(outsider.session_token, pair.first_id);
		const self = await post(
			'/api/chat/conversations/start',
			{ client_id: pair.first_id },
			pair.first.session_token
		);

		expect(started.json.success).toBe(true);
		expect(started.json.conversation?.participant).toMatchObject({
			client_id: pair.second_id,
			display_name: 'Chat Recipient'
		});
		expect(duplicate.json.conversation?.conversation_id).toBe(started.json.conversation?.conversation_id);
		expect(outside.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
		expect(self.status).toBe(400);
	});

	test('sends trimmed immutable plain text idempotently and renders current names', async () => {
		const pair = await make_guildmates('Chat Writer', 'Chat Reader');
		const started = await start_chat(pair.first.session_token, pair.second_id);
		const conversation_id = started.json.conversation?.conversation_id as number;
		const key = crypto.randomUUID();
		const sent = await send_chat(pair.first.session_token, conversation_id, '  Hello <b>plain</b>  ', key);
		const duplicate = await send_chat(pair.first.session_token, conversation_id, 'Hello <b>plain</b>', key);
		await post_json('/api/client/set_display_name', { display_name: 'Renamed Writer' }, pair.first.session_token);
		const read = await messages(pair.second.session_token, conversation_id);

		expect(sent.json.message?.content).toBe('Hello <b>plain</b>');
		expect(duplicate.json.message?.message_id).toBe(sent.json.message?.message_id);
		expect(duplicate.json.budget?.credits).toBe(sent.json.budget?.credits);
		expect(read.json.messages).toHaveLength(1);
		expect(read.json.messages[0].sender.display_name).toBe('Renamed Writer');
		expect((await post('/api/chat/messages/send', {
			conversation_id,
			idempotency_key: crypto.randomUUID(),
			content: ' '.repeat(4)
		}, pair.first.session_token)).status).toBe(400);
		expect((await post('/api/chat/messages/send', {
			conversation_id,
			idempotency_key: crypto.randomUUID(),
			content: 'x'.repeat(1001)
		}, pair.first.session_token)).status).toBe(400);
	});

	test('loads five newest messages, paginates older history, and acknowledges only returned messages', async () => {
		const pair = await make_guildmates('Chat Pager', 'Chat Page Reader');
		const started = await start_chat(pair.first.session_token, pair.second_id);
		const conversation_id = started.json.conversation?.conversation_id as number;
		for (let index = 1; index <= 6; index++) {
			if (index === 6)
				await db_run(
					'UPDATE `clients` SET `messaging_refill_at` = ? WHERE `id` = ?',
					[Date.now() - 1, pair.first_id]
				);
			await send_chat(pair.first.session_token, conversation_id, `Message ${index}`);
		}

		expect((await get_events(pair.second)).chat_unread).toBe(6);
		const newest = await messages(pair.second.session_token, conversation_id);
		expect(newest.json.messages.map(message => message.content)).toEqual([
			'Message 2', 'Message 3', 'Message 4', 'Message 5', 'Message 6'
		]);
		expect(newest.json.has_more).toBe(true);
		expect((await get_events(pair.second)).chat_unread).toBe(1);
		const older = await messages(
			pair.second.session_token,
			conversation_id,
			`&before=${newest.json.messages[0].message_id}`
		);
		expect(older.json.messages.map(message => message.content)).toEqual(['Message 1']);
		expect(older.json.has_more).toBe(false);
		expect((await get_events(pair.second)).chat_unread).toBe(0);
	});

	test('soft-deletes per participant and reopens only with later Messages', async () => {
		const pair = await make_guildmates('Chat Deleter', 'Chat Keeper');
		const started = await start_chat(pair.first.session_token, pair.second_id);
		const conversation_id = started.json.conversation?.conversation_id as number;
		const original = await send_chat(pair.first.session_token, conversation_id, 'Original');
		await post_json('/api/chat/messages/delete', {
			message_id: original.json.message?.message_id
		}, pair.first.session_token);
		expect((await messages(pair.first.session_token, conversation_id)).json.messages).toEqual([]);
		expect((await messages(pair.second.session_token, conversation_id)).json.messages).toHaveLength(1);

		await post_json('/api/chat/conversations/delete', { conversation_id }, pair.first.session_token);
		expect((await conversations(pair.first.session_token)).json.conversations).toEqual([]);
		expect((await conversations(pair.second.session_token)).json.conversations).toHaveLength(1);
		await send_chat(pair.second.session_token, conversation_id, 'Later');
		const reopened = await conversations(pair.first.session_token);
		expect(reopened.json.conversations[0].latest_message?.content).toBe('Later');
		expect((await messages(pair.first.session_token, conversation_id)).json.messages.map(message => message.content))
			.toEqual(['Later']);
	});

	test('keeps established history across Guild changes and applies generic persistent privacy locks', async () => {
		const pair = await make_guildmates('Chat Privacy First', 'Chat Privacy Second');
		const started = await start_chat(pair.first.session_token, pair.second_id);
		const conversation_id = started.json.conversation?.conversation_id as number;
		await send_chat(pair.first.session_token, conversation_id, 'Before leaving');
		await post_json('/api/guilds/leave', {}, pair.second.session_token);
		expect((await send_chat(pair.second.session_token, conversation_id, 'After leaving')).json.success).toBe(true);

		await post_json('/api/chat/block', { client_id: pair.first_id, blocked: true }, pair.second.session_token);
		expect((await send_chat(pair.first.session_token, conversation_id, 'Blocked')).json.error_lang)
			.toBe('MOD_MP_CHAT_RECIPIENT_UNAVAILABLE');
		expect((await messages(pair.first.session_token, conversation_id)).json.messages).toHaveLength(2);
		await post_json('/api/chat/block', { client_id: pair.first_id, blocked: false }, pair.second.session_token);
		await post_json('/api/chat/privacy', { messaging_enabled: false }, pair.second.session_token);
		expect((await send_chat(pair.first.session_token, conversation_id, 'Opted out')).json.error_lang)
			.toBe('MOD_MP_CHAT_RECIPIENT_UNAVAILABLE');
		await post_json('/api/chat/privacy', { messaging_enabled: true }, pair.second.session_token);
		expect((await send_chat(pair.first.session_token, conversation_id, 'Restored')).json.success).toBe(true);
	});

	test('derives and replenishes one identity-owned budget without double-spending retries', async () => {
		const pair = await make_guildmates('Chat Budget Owner', 'Chat Budget Peer');
		await post_json('/api/client/status/sync', {
			skills: [
				{ skill_id: 'melvorD:Woodcutting', level: 120 },
				{ skill_id: 'melvorAoD:Cartography', level: 120 },
				{ skill_id: 'melvorD:Attack', level: 120 },
				{ skill_id: 'test:Invented', level: 120 }
			],
			activity: { type: 'idle' }
		}, pair.first.session_token);
		const state = await get_json_with_session<{
			messaging_enabled: boolean;
			budget: { credits: number; maximum: number; refill_interval: number; next_refill_at: number };
		}>('/api/chat/state', pair.first.session_token);
		expect(state.json.budget).toMatchObject({ credits: 5, maximum: 7, refill_interval: 56_000 });

		const started = await start_chat(pair.first.session_token, pair.second_id);
		const conversation_id = started.json.conversation?.conversation_id as number;
		let last_key = '';
		let last_message_id = 0;
		for (let index = 0; index < 5; index++) {
			last_key = crypto.randomUUID();
			const sent = await send_chat(pair.first.session_token, conversation_id, `Budget ${index}`, last_key);
			last_message_id = sent.json.message?.message_id as number;
		}
		const retry = await send_chat(pair.first.session_token, conversation_id, 'Budget 4', last_key);
		expect(retry.json.message?.message_id).toBe(last_message_id);
		expect(retry.json.budget?.credits).toBe(0);
		expect((await send_chat(pair.first.session_token, conversation_id, 'No credit')).json.error_lang)
			.toBe('MOD_MP_CHAT_BUDGET_EMPTY');

		await db_run(
			'UPDATE `clients` SET `messaging_credits` = 0, `messaging_refill_at` = ? WHERE `id` = ?',
			[Date.now() - 1, pair.first_id]
		);
		const replenished = await get_json_with_session<{
			budget: { credits: number; maximum: number; refill_interval: number };
		}>('/api/chat/state', pair.first.session_token);
		expect(replenished.json.budget).toMatchObject({ credits: 1, maximum: 7, refill_interval: 56_000 });
	});
});
