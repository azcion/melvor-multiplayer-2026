import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

type Conversation = {
	conversation_id: number | null;
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

async function send_chat(
	session_token: string,
	conversation_id: number | null,
	content: string,
	key: string = crypto.randomUUID(),
	client_id?: number
) {
	return post_json<{
		success?: boolean;
		message?: Message;
		budget_enabled?: boolean;
		budget?: { credits: number; maximum: number; refill_interval: number; next_refill_at: number };
		error_lang?: string;
	}>('/api/chat/messages/send', { conversation_id, client_id, idempotency_key: key, content }, session_token);
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
		expect(started.json.conversation?.conversation_id).toBeNull();
		expect(duplicate.json.conversation?.conversation_id).toBe(started.json.conversation?.conversation_id);
		const conversation_count = () => db_count(
			'SELECT COUNT(*) AS count FROM `chat_conversations` ' +
			'WHERE `participant_low_id` = ? AND `participant_high_id` = ?',
			[Math.min(pair.first_id, pair.second_id), Math.max(pair.first_id, pair.second_id)]
		);
		expect(await conversation_count()).toBe(0);
		expect((await post_json<{ success?: boolean }>('/api/chat/block', {
			client_id: pair.second_id,
			blocked: true
		}, pair.first.session_token)).json.success).toBe(true);
		expect(await conversation_count()).toBe(0);
		expect((await post_json<{ success?: boolean }>('/api/chat/block', {
			client_id: pair.second_id,
			blocked: false
		}, pair.first.session_token)).json.success).toBe(true);
		expect(outside.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
		expect(self.status).toBe(400);
	});

	test('sends trimmed immutable plain text idempotently and renders current names', async () => {
		const pair = await make_guildmates('Chat Writer', 'Chat Reader');
		const started = await start_chat(pair.first.session_token, pair.second_id);
		const draft_id = started.json.conversation?.conversation_id ?? null;
		const key = crypto.randomUUID();
		const sent = await send_chat(pair.first.session_token, draft_id, '  Hello <b>plain</b>  ', key, pair.second_id);
		const conversation_id = sent.json.message?.conversation_id as number;
		const duplicate = await send_chat(pair.first.session_token, draft_id, 'Hello <b>plain</b>', key, pair.second_id);
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
		const support_welcome = (await conversations(pair.second.session_token)).json.conversations.find(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind === 'support'
		) as Conversation & { support_team_id: number };
		await get_json_with_session(
			`/api/chat/messages?conversation_kind=support&support_team_id=${support_welcome.support_team_id}`,
			pair.second.session_token
		);
		await start_chat(pair.first.session_token, pair.second_id);
		const first = await send_chat(pair.first.session_token, null, 'Message 1', undefined, pair.second_id);
		const conversation_id = first.json.message?.conversation_id as number;
		for (let index = 2; index <= 6; index++) {
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
		await start_chat(pair.first.session_token, pair.second_id);
		const original = await send_chat(pair.first.session_token, null, 'Original', undefined, pair.second_id);
		const conversation_id = original.json.message?.conversation_id as number;
		await post_json('/api/chat/messages/delete', {
			message_id: original.json.message?.message_id
		}, pair.first.session_token);
		expect((await messages(pair.first.session_token, conversation_id)).json.messages).toEqual([]);
		expect((await messages(pair.second.session_token, conversation_id)).json.messages).toHaveLength(1);

		await post_json('/api/chat/conversations/delete', { conversation_id }, pair.first.session_token);
		expect((await conversations(pair.first.session_token)).json.conversations.filter(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind !== 'support'
		)).toEqual([]);
		expect((await conversations(pair.second.session_token)).json.conversations.filter(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind !== 'support'
		)).toHaveLength(1);
		await send_chat(pair.second.session_token, conversation_id, 'Later');
		const reopened = await conversations(pair.first.session_token);
		expect(reopened.json.conversations[0].latest_message?.content).toBe('Later');
		expect((await messages(pair.first.session_token, conversation_id)).json.messages.map(message => message.content))
			.toEqual(['Later']);
	});

	test('keeps established history across Guild changes and applies generic persistent privacy locks', async () => {
		const pair = await make_guildmates('Chat Privacy First', 'Chat Privacy Second');
		await start_chat(pair.first.session_token, pair.second_id);
		const first = await send_chat(pair.first.session_token, null, 'Before leaving', undefined, pair.second_id);
		const conversation_id = first.json.message?.conversation_id as number;
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

	test('disables Message capacity without charging persisted credits or double-creating retries', async () => {
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
			budget_enabled: boolean;
			budget: { credits: number; maximum: number; refill_interval: number; next_refill_at: number };
		}>('/api/chat/state', pair.first.session_token);
		expect(state.json.budget_enabled).toBe(false);
		expect(state.json.budget).toMatchObject({ credits: 7, maximum: 7, refill_interval: 56_000, next_refill_at: 0 });
		await db_run(
			'UPDATE `clients` SET `messaging_credits` = 0, `messaging_refill_at` = 1 WHERE `id` = ?',
			[pair.first_id]
		);

		const started = await start_chat(pair.first.session_token, pair.second_id);
		let conversation_id = started.json.conversation?.conversation_id ?? null;
		let last_key = '';
		let last_message_id = 0;
		for (let index = 0; index < 8; index++) {
			last_key = crypto.randomUUID();
			const sent = await send_chat(
				pair.first.session_token, conversation_id, `Unrestricted ${index}`, last_key, pair.second_id
			);
			expect(sent.json.success).toBe(true);
			expect(sent.json.budget_enabled).toBe(false);
			expect(sent.json.budget?.credits).toBe(7);
			conversation_id = sent.json.message?.conversation_id as number;
			last_message_id = sent.json.message?.message_id as number;
		}
		const retry = await send_chat(pair.first.session_token, conversation_id, 'Unrestricted 7', last_key);
		expect(retry.json.message?.message_id).toBe(last_message_id);
		expect(retry.json.budget?.credits).toBe(7);
		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `clients` WHERE `id` = ? AND `messaging_credits` = 0 ' +
			'AND `messaging_refill_at` = 1',
			[pair.first_id]
		)).toBe(1);
	});
});

describe('Support Chat API', () => {
	test('presents a restart-safe virtual welcome and atomically materializes the first reply', async () => {
		const player = await register_client('Guildless Support Player');
		const inbox = await conversations(player.session_token);
		const support = inbox.json.conversations.find(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind === 'support'
		) as Conversation & { conversation_kind: 'support'; support_team_id: number };

		expect(support.conversation_id).toBeNull();
		expect(support.participant.display_name).toBe('Multiplayer Mod Team');
		expect(support.unread_count).toBe(1);
		expect((await get_events(player)).chat_unread).toBe(1);

		const welcome = await get_json_with_session<{ messages: Message[] }>(
			`/api/chat/messages?conversation_kind=support&support_team_id=${support.support_team_id}`,
			player.session_token
		);
		expect(welcome.json.messages[0].content).toContain('Welcome to Melvor Multiplayer!');
		expect((await get_events(player)).chat_unread).toBe(0);
		await db_run('UPDATE `support_teams` SET `welcome_content` = ? WHERE `id` = ?',
			['Updated welcome before materialization', support.support_team_id]);
		const updated_virtual = (await conversations(player.session_token)).json.conversations.find(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind === 'support'
		) as Conversation;
		expect(updated_virtual.latest_message?.content).toBe('Updated welcome before materialization');
		expect(updated_virtual.unread_count).toBe(0);

		const key = crypto.randomUUID();
		const [first, retry] = await Promise.all([
			post_json<{ success: boolean; message: Message }>(
				'/api/chat/messages/send', { conversation_kind: 'support', conversation_id: null,
					support_team_id: support.support_team_id, idempotency_key: key, content: '  Please help  ' },
				player.session_token
			),
			post_json<{ success: boolean; message: Message }>(
				'/api/chat/messages/send', { conversation_kind: 'support', conversation_id: null,
					support_team_id: support.support_team_id, idempotency_key: key, content: 'Please help' },
				player.session_token
			)
		]);
		expect(first.json.message.content).toBe('Please help');
		expect(retry.json.message.message_id).toBe(first.json.message.message_id);
		expect(await db_count('SELECT COUNT(*) AS count FROM `support_conversations` WHERE `player_client_id` = ?',
			[player.client_id])).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS count FROM `support_messages` WHERE `conversation_id` = ?',
			[first.json.message.conversation_id])).toBe(2);
		const materialized = (await conversations(player.session_token)).json.conversations.find(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind === 'support'
		) as Conversation;
		expect(materialized.unread_count).toBe(0);
		expect((await get_events(player)).chat_unread).toBe(0);
		await db_run('UPDATE `support_teams` SET `welcome_content` = ? WHERE `id` = ?',
			['Changed after materialization', support.support_team_id]);
		const durable = await get_json_with_session<{ messages: Message[] }>(
			`/api/chat/messages?conversation_kind=support&conversation_id=${first.json.message.conversation_id}`,
			player.session_token
		);
		expect(durable.json.messages[0].content).toBe('Updated welcome before materialization');
		await db_run('UPDATE `support_teams` SET `welcome_content` = ? WHERE `id` = ?', [
			"Welcome to Melvor Multiplayer!\n\nThis is an automated message. If you run into any problems or have a suggestion, just reply here. We'd love to hear from you!",
			support.support_team_id
		]);
	});

	test('shares team history and read state by account while bypassing private Chat controls', async () => {
		const player = await register_client('Support Lucy');
		const team = await register_client('Team Character', { cloud_username: 'TeamCloud', playfab_id: 'TEAM-CHAT-ID' });
		const team_sibling = await register_client('Team Sibling', {
			cloud_username: 'LaterTeamCloud', playfab_id: 'TEAM-CHAT-ID'
		});
		const support = (await conversations(player.session_token)).json.conversations.find(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind === 'support'
		) as Conversation & { support_team_id: number };
		const sent = await post_json<{ message: Message }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: null, support_team_id: support.support_team_id,
			idempotency_key: crypto.randomUUID(), content: 'Player report'
		}, player.session_token);
		const account = (await db_all<{ id: number }>(
			'SELECT `id` FROM `melvor_accounts` WHERE `playfab_id` = ?', ['TEAM-CHAT-ID']
		))[0];
		await db_run(
			'INSERT INTO `support_team_memberships` (`team_id`, `melvor_account_id`, `created_at`) VALUES(?, ?, ?)',
			[support.support_team_id, account.id, Date.now()]
		);

		const team_inbox = await conversations(team.session_token);
		const team_conversation = team_inbox.json.conversations.find(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind === 'support'
		) as Conversation & { support_team_id: number; viewer_side: string };
		expect(team_conversation.participant.display_name).toBe('Support Lucy @mp');
		expect(team_conversation.unread_count).toBe(1);
		expect(team_conversation.viewer_side).toBe('team');
		for (const entry of team_inbox.json.conversations.filter(entry => Number(entry.unread_count) > 0))
			await get_json_with_session(
				`/api/chat/messages?conversation_kind=support&conversation_id=${entry.conversation_id}`,
				team.session_token
			);
		expect(await db_count('SELECT COUNT(*) AS count FROM `support_member_message_reads`')).toBeGreaterThan(0);
		expect((await get_events(team)).chat_unread).toBe(0);
		expect((await get_events(team_sibling)).chat_unread).toBe(0);
		expect((await conversations(team_sibling.session_token)).json.conversations.some(entry =>
			(entry as Conversation & { viewer_side?: string }).viewer_side === 'player'
		)).toBe(false);
		expect((await post_json<{ success?: boolean }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: null, support_team_id: support.support_team_id,
			idempotency_key: crypto.randomUUID(), content: 'Cannot contact own team'
		}, team_sibling.session_token)).json.success).not.toBe(true);

		const reply = await post_json<{ success: boolean; message: Message & { sender: { display_name: string } } }>(
			'/api/chat/messages/send', { conversation_kind: 'support', conversation_id: sent.json.message.conversation_id,
				support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(), content: 'Team reply' },
			team_sibling.session_token
		);
		expect(reply.json.success).toBe(true);
		expect(reply.json.message.sender.display_name).toBe('TeamCloud');
		expect((await get_events(player)).chat_unread).toBe(2);

		await post_json('/api/chat/privacy', { messaging_enabled: false }, player.session_token);
		const followup = await post_json<{ success: boolean }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: sent.json.message.conversation_id,
			support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(), content: 'Still available'
		}, player.session_token);
		expect(followup.json.success).toBe(true);
	});
});
