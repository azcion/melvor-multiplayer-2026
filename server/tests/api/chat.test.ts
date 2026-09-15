import { beforeEach, describe, expect, test } from 'bun:test';
import { attach_to_free_fellowship, get_events, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { clear_global_chat_throttle, db_count, db_run } from '../support/persistence';

type Conversation = {
	conversation_kind?: 'private' | 'global' | 'guild' | 'support';
	conversation_id: number | null;
	participant: { client_id: number | null; display_name: string; icon_id: string };
	latest_message?: Message | null;
	unread_count?: number;
	moderation_count?: number;
	can_moderate?: boolean;
	blocked?: boolean;
};

type Message = {
	message_id: number;
	conversation_id: number;
	sender_id: number;
	sender: { display_name: string; icon_id: string };
	content: string;
	created_at: number;
	reactions: Array<{ reaction: string; count: number; reacted: boolean }>;
	translations: Partial<Record<string, string>>;
	translation_status: 'queued' | 'processing' | 'complete' | 'dead' | 'original' | 'unavailable';
	translation_enqueued_at: number | null;
};

type MessageResponse = {
	messages: Message[];
	has_more: boolean;
	reaction_revision: number;
	reaction_updates: Array<{
		message_id: number;
		reaction_revision: number;
		reactions: Message['reactions'];
	}>;
};

async function set_reaction(session_token: string, conversation_id: number, message_id: number,
	reaction: string, reacted: boolean) {
	return post_json<{ success?: boolean; reactions?: Message['reactions']; error_lang?: string }>(
		'/api/chat/messages/reaction',
		{ conversation_kind: 'private', conversation_id, message_id, reaction, reacted },
		session_token
	);
}

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
	return get_json_with_session<MessageResponse>(
		`/api/chat/messages?conversation_id=${conversation_id}${cursor}`,
		session_token
	);
}

const GUILD_CHAT_CAPABILITY = 'capabilities=guild-chat-v1';
const GLOBAL_CHAT_CAPABILITY = 'capabilities=global-chat-v1';

async function global_inbox(session_token: string) {
	return get_json_with_session<{
		conversations: Conversation[];
		global_chat: { enabled: boolean };
	}>(`/api/chat/conversations?${GLOBAL_CHAT_CAPABILITY}`, session_token);
}

async function global_events(session_token: string) {
	return get_json_with_session<{ chat_unread: number }>(`/api/events?${GLOBAL_CHAT_CAPABILITY}`, session_token);
}

async function global_messages(session_token: string, cursor = '') {
	return get_json_with_session<{ messages: Message[]; has_more: boolean }>(
		`/api/chat/messages?conversation_kind=global&conversation_id=1&${GLOBAL_CHAT_CAPABILITY}${cursor}`,
		session_token
	);
}

async function send_global_message(
	session_token: string,
	content: string,
	idempotency_key = crypto.randomUUID()
) {
	return post_json<{
		success?: boolean;
		message?: Message;
		retry_after_ms?: number;
		error_lang?: string;
	}>(`/api/chat/messages/send?${GLOBAL_CHAT_CAPABILITY}`, {
		conversation_kind: 'global',
		conversation_id: 1,
		idempotency_key,
		content
	}, session_token);
}

async function guild_inbox(session_token: string) {
	return get_json_with_session<{
		conversations: Conversation[];
		guild_chat: { affiliated: boolean; enabled: boolean };
	}>(`/api/chat/conversations?${GUILD_CHAT_CAPABILITY}`, session_token);
}

async function guild_events(session_token: string) {
	return get_json_with_session<{ chat_unread: number }>(`/api/events?${GUILD_CHAT_CAPABILITY}`, session_token);
}

async function guild_messages(session_token: string, guild_id: number, cursor = '') {
	return get_json_with_session<{ messages: Message[]; has_more: boolean }>(
		`/api/chat/messages?conversation_kind=guild&conversation_id=${guild_id}${cursor}`,
		session_token
	);
}

async function send_guild_message(
	session_token: string,
	guild_id: number,
	content: string,
	idempotency_key = crypto.randomUUID()
) {
	return post_json<{ success?: boolean; message?: Message; error_lang?: string }>('/api/chat/messages/send', {
		conversation_kind: 'guild',
		conversation_id: guild_id,
		idempotency_key,
		content
	}, session_token);
}

describe('Private Chat API', () => {
	test('aggregates unrestricted reactions and tracks each viewer independently', async () => {
		const pair = await make_guildmates('Reaction Writer', 'Reaction Reader');
		const outsider = await register_client('Reaction Outsider');
		const sent = await send_chat(pair.first.session_token, null, 'React to this', undefined, pair.second_id);
		const conversation_id = sent.json.message?.conversation_id as number;
		const message_id = sent.json.message?.message_id as number;

		expect((await set_reaction(pair.first.session_token, conversation_id, message_id, 'custom reaction', true)).response.status).toBe(200);
		expect((await set_reaction(pair.first.session_token, conversation_id, message_id, '🔥', true)).response.status).toBe(200);
		const reader_reaction = await set_reaction(pair.second.session_token, conversation_id, message_id, '🔥', true);
		expect(reader_reaction.json.reactions).toEqual([
			{ reaction: 'custom reaction', count: 1, reacted: false },
			{ reaction: '🔥', count: 2, reacted: true }
		]);

		const writer_view = await messages(pair.first.session_token, conversation_id);
		expect(writer_view.json.messages[0].reactions).toEqual([
			{ reaction: 'custom reaction', count: 1, reacted: true },
			{ reaction: '🔥', count: 2, reacted: true }
		]);
		expect((await set_reaction(pair.first.session_token, conversation_id, message_id, '🔥', false)).json.reactions).toEqual([
			{ reaction: 'custom reaction', count: 1, reacted: true },
			{ reaction: '🔥', count: 1, reacted: false }
		]);
		expect((await set_reaction(pair.first.session_token, conversation_id, message_id, '🔥', false)).response.status).toBe(200);
		expect((await set_reaction(outsider.session_token, conversation_id, message_id, '🔥', true)).json.error_lang)
			.toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
	});

	test('returns only reaction summaries changed after the conversation revision cursor', async () => {
		const pair = await make_guildmates('Reaction Poll Writer', 'Reaction Poll Reader');
		const sent = await send_chat(pair.first.session_token, null, 'Watch reactions', undefined, pair.second_id);
		const conversation_id = sent.json.message?.conversation_id as number;
		const message_id = sent.json.message?.message_id as number;
		const initial = await messages(pair.first.session_token, conversation_id);

		expect(initial.json.reaction_updates).toEqual([]);
		await set_reaction(pair.second.session_token, conversation_id, message_id, '👀', true);
		const added = await messages(pair.first.session_token, conversation_id,
			`&after=${message_id}&reaction_after=${initial.json.reaction_revision}`);
		expect(added.json.messages).toEqual([]);
		expect(added.json.reaction_updates).toEqual([{
			message_id,
			reaction_revision: added.json.reaction_revision,
			reactions: [{ reaction: '👀', count: 1, reacted: false }]
		}]);

		await set_reaction(pair.second.session_token, conversation_id, message_id, '👀', false);
		const removed = await messages(pair.first.session_token, conversation_id,
			`&after=${message_id}&reaction_after=${added.json.reaction_revision}`);
		expect(removed.json.reaction_revision).toBeGreaterThan(added.json.reaction_revision);
		expect(removed.json.reaction_updates).toEqual([{
			message_id,
			reaction_revision: removed.json.reaction_revision,
			reactions: []
		}]);

		const unchanged = await messages(pair.first.session_token, conversation_id,
			`&after=${message_id}&reaction_after=${removed.json.reaction_revision}`);
		expect(unchanged.json.reaction_revision).toBe(removed.json.reaction_revision);
		expect(unchanged.json.reaction_updates).toEqual([]);
	});

	test('starts one canonical conversation across Guilds when privacy allows it', async () => {
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
		expect(outside.json.success).toBe(true);
		expect(self.status).toBe(400);
	});

	test('shares privacy-filtered chat profiles across Guilds without current activity', async () => {
		const pair = await make_guildmates('Profile Subject', 'Profile Guildmate', 'Visible Guild');
		const outsider = await register_client('Profile Outsider');
		await post_json('/api/client/equipment/sync', {
			slots: [{ slot_id: 'melvorD:Weapon', item_id: 'melvorD:Bronze_Sword' }]
		}, pair.first.session_token);
		await post_json('/api/client/status/sync', {
			skills: [{ skill_id: 'melvorD:Attack', level: 42 }],
			activity: { type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Oak' },
			account_creation_date: Date.now() - 60_000,
			total_skill_level: 123
		}, pair.first.session_token);
		await db_run(
			'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `game_mode_id`, `language`, `reported_at`) VALUES(?, ?, ?, ?, ?, ?)',
			[pair.first_id, '1.5.10', JSON.stringify(['Multiplayer']), 'melvorD:Standard', 'en', Date.now()]
		);

		const profile = await get_json_with_session<any>(
			`/api/chat/profile?client_id=${pair.first_id}`, outsider.session_token
		);
		const equipment = await get_json_with_session<any>(
			`/api/chat/equipment?client_id=${pair.first_id}`, outsider.session_token
		);
		const status = await get_json_with_session<any>(
			`/api/chat/status?client_id=${pair.first_id}`, outsider.session_token
		);
		const mods = await get_json_with_session<any>(
			`/api/chat/active-mods?client_id=${pair.first_id}`, outsider.session_token
		);

		expect(profile.json).toMatchObject({
			client_id: pair.first_id,
			can_start_chat: true,
			equipment_visible: true,
			equipment_available: true,
			skills_visible: true,
			skills_available: true,
			total_skill_level: 123,
			game_mode_visible: true,
			game_mode_id: 'melvorD:Standard',
			active_mods_visible: true,
			active_mods_available: true,
			language: 'en',
			guild_name: 'Visible Guild'
		});
		expect(profile.json).not.toHaveProperty('status_activity');
		expect(profile.json.account_age).toBeGreaterThanOrEqual(60_000);
		expect(equipment.json.slots).toEqual([
			{ slot_id: 'melvorD:Weapon', item_id: 'melvorD:Bronze_Sword' }
		]);
		expect(status.json.skills).toEqual([{ skill_id: 'melvorD:Attack', level: 42 }]);
		expect(status.json).not.toHaveProperty('activity');
		expect(status.json).not.toHaveProperty('activities');
		expect(mods.json.active_mods).toEqual(['Multiplayer']);
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

	test('queues each new Message once and exposes only persisted translations to other viewers', async () => {
		const pair = await make_guildmates('Translation Writer', 'Translation Reader');
		const key = crypto.randomUUID();
		const sent = await send_chat(pair.first.session_token, null, 'Hello', key, pair.second_id);
		const conversation_id = sent.json.message?.conversation_id as number;
		const message_id = sent.json.message?.message_id as number;
		await send_chat(pair.first.session_token, null, 'Hello', key, pair.second_id);

		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `chat_translation_jobs` WHERE `source_kind` = ? AND `message_id` = ?',
			['private', message_id]
		)).toBe(1);
		const queued = await messages(pair.second.session_token, conversation_id);
		expect(queued.json.messages[0]).toMatchObject({
			content: 'Hello', translations: {}, translation_status: 'queued'
		});
		await db_run(
			'INSERT INTO `chat_message_translations` (`job_id`, `language`, `content`, `translated_at`) ' +
			'SELECT `id`, ?, ?, ? FROM `chat_translation_jobs` WHERE `source_kind` = ? AND `message_id` = ?',
			['zh-CN', '你好', Date.now(), 'private', message_id]
		);
		await db_run(
			"UPDATE `chat_translation_jobs` SET `state` = 'complete', `detected_language` = 'en', `completed_at` = ? " +
			'WHERE `source_kind` = ? AND `message_id` = ?',
			[Date.now(), 'private', message_id]
		);

		expect((await messages(pair.second.session_token, conversation_id)).json.messages[0]).toMatchObject({
			translations: { 'zh-CN': '你好' }, translation_status: 'complete'
		});
		expect((await messages(pair.first.session_token, conversation_id)).json.messages[0]).toMatchObject({
			translations: {}, translation_status: 'original'
		});
	});

	test('loads twenty newest messages, paginates older history, and acknowledges only returned messages', async () => {
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
		for (let index = 2; index <= 21; index++) {
			if (index === 21)
				await db_run(
					'UPDATE `clients` SET `messaging_refill_at` = ? WHERE `id` = ?',
					[Date.now() - 1, pair.first_id]
				);
			await send_chat(pair.first.session_token, conversation_id, `Message ${index}`);
		}

		expect((await get_events(pair.second)).chat_unread).toBe(21);
		const newest = await messages(pair.second.session_token, conversation_id);
		expect(newest.json.messages).toHaveLength(20);
		expect(newest.json.messages.map(message => message.content)).toEqual(
		Array.from({ length: 20 }, (_, index) => `Message ${index + 2}`)
	);
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

describe('Global Chat API', () => {
	test('capability-gates one server-wide conversation for Guildless clients', async () => {
		const sender = await register_client('Global Sender');
		const reader = await register_client('Global Reader');
		const legacy = await conversations(reader.session_token);
		const capable = await global_inbox(reader.session_token);
		const global = capable.json.conversations.find(entry => entry.conversation_kind === 'global');

		expect(legacy.json.conversations.some(entry => entry.conversation_kind === 'global')).toBe(false);
		expect(capable.json.global_chat).toEqual({ enabled: true });
		expect(global).toMatchObject({
			conversation_kind: 'global',
			conversation_id: 1,
			participant: { client_id: null, display_name: 'Global' },
			unread_count: 0,
			moderation_count: 0,
			latest_message: null
		});

		const key = crypto.randomUUID();
		const sent = await send_global_message(sender.session_token, '  Hello, server  ', key);
		const retry = await send_global_message(sender.session_token, 'Hello, server', key);
		expect(sent.json.message?.content).toBe('Hello, server');
		expect(sent.json.message?.sender).toEqual({ display_name: 'Global Sender', icon_id: 'melvorD:Plant' });
		expect(retry.json.message?.message_id).toBe(sent.json.message?.message_id);
		expect((await global_inbox(reader.session_token)).json.conversations.find(
			entry => entry.conversation_kind === 'global'
		)?.unread_count).toBe(1);
		const reader_messages = (await global_messages(reader.session_token)).json.messages;
		expect(reader_messages.map(message => message.content)).toEqual(['Hello, server']);
		expect(reader_messages[0]?.sender).toEqual({ display_name: 'Global Sender', icon_id: 'melvorD:Plant' });
		expect((await post_json<{ reactions: Message['reactions'] }>(
			`/api/chat/messages/reaction?${GLOBAL_CHAT_CAPABILITY}`,
			{ conversation_kind: 'global', conversation_id: 1, message_id: reader_messages[0].message_id,
				reaction: '👀', reacted: true }, reader.session_token
		)).json.reactions).toEqual([{ reaction: '👀', count: 1, reacted: true }]);
		expect((await global_messages(sender.session_token)).json.messages[0].reactions)
			.toEqual([{ reaction: '👀', count: 1, reacted: false }]);
		expect((await global_events(reader.session_token)).json.chat_unread).toBe(1);

		const later = await register_client('Later Global Reader');
		expect((await global_inbox(later.session_token)).json.conversations.find(
			entry => entry.conversation_kind === 'global'
		)?.unread_count).toBe(0);
		expect((await global_messages(later.session_token)).json.messages.map(message => message.content))
			.toEqual(['Hello, server']);
	});

	test('suspends unread state while opted out and baselines on re-enable', async () => {
		const sender = await register_client('Global Opt-out Sender');
		const reader = await register_client('Global Opt-out Reader');
		await send_global_message(sender.session_token, 'Before opt-out');
		expect((await global_inbox(reader.session_token)).json.conversations.find(
			entry => entry.conversation_kind === 'global'
		)?.unread_count).toBe(1);

		await post_json(`/api/chat/global-participation?${GLOBAL_CHAT_CAPABILITY}`, { enabled: false }, reader.session_token);
		const opted_out = await global_inbox(reader.session_token);
		expect(opted_out.json.global_chat).toEqual({ enabled: false });
		expect(opted_out.json.conversations.some(entry => entry.conversation_kind === 'global')).toBe(false);
		expect((await send_global_message(reader.session_token, 'Not allowed')).json.error_lang)
			.toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
		await send_global_message(sender.session_token, 'While opted out');
		await post_json(`/api/chat/global-participation?${GLOBAL_CHAT_CAPABILITY}`, { enabled: true }, reader.session_token);
		expect((await global_inbox(reader.session_token)).json.conversations.find(
			entry => entry.conversation_kind === 'global'
		)?.unread_count).toBe(0);
		expect((await global_messages(reader.session_token)).json.messages.at(-1)?.content).toBe('While opted out');
	});

	test('enforces persistent client and server rolling-window throttles without rejecting retries', async () => {
		const limited = await register_client('Globally Limited');
		const other = await register_client('Server Limited');
		await db_run(
			'INSERT INTO `global_chat_client_throttles` (`client_id`, `max_messages`, `window_seconds`) VALUES(?, 2, 10)',
			[limited.client_id]
		);
		const first_key = crypto.randomUUID();
		const first = await send_global_message(limited.session_token, 'Client one', first_key);
		const second = await send_global_message(limited.session_token, 'Client two');
		const third = await send_global_message(limited.session_token, 'Client three');
		expect(first.json.success).toBe(true);
		expect(second.json.success).toBe(true);
		expect(second.json.retry_after_ms).toBeGreaterThan(0);
		expect(third.json).toMatchObject({ success: false });
		expect(third.json.retry_after_ms).toBeGreaterThan(0);
		expect((await send_global_message(limited.session_token, 'Client one', first_key)).json.message?.message_id)
			.toBe(first.json.message?.message_id);

		await db_run(
			'INSERT INTO `global_chat_server_throttle` (`id`, `max_messages`, `window_seconds`) VALUES(1, 1, 10)',
			[]
		);
		const server_limited = await send_global_message(other.session_token, 'Server blocked');
		expect(server_limited.json).toMatchObject({ success: false });
		expect(server_limited.json.retry_after_ms).toBeGreaterThan(0);
	});
});

describe('Guild Chat API', () => {
	test('capability-gates one canonical Guild conversation and admits later members with read history', async () => {
		const owner = await register_guild_client('Guild Chat Owner', 'Canonical Chat Guild');
		const old_inbox = await conversations(owner.session_token);
		const capable_inbox = await guild_inbox(owner.session_token);
		const guild = capable_inbox.json.conversations.find(entry => entry.conversation_kind === 'guild');

		expect(old_inbox.json.conversations.some(entry => entry.conversation_kind === 'guild')).toBe(false);
		expect(capable_inbox.json.guild_chat).toEqual({ affiliated: true, enabled: true });
		expect(guild).toMatchObject({
			conversation_kind: 'guild',
			conversation_id: owner.guild_id,
			participant: { client_id: null, display_name: 'Canonical Chat Guild' },
			unread_count: 0,
			moderation_count: 0,
			latest_message: null
		});

		const key = crypto.randomUUID();
		const [sent, retry] = await Promise.all([
			send_guild_message(owner.session_token, owner.guild_id, '  Durable Guild history  ', key),
			send_guild_message(owner.session_token, owner.guild_id, 'Durable Guild history', key)
		]);
		expect(sent.json.message?.content).toBe('Durable Guild history');
		expect(retry.json.message?.message_id).toBe(sent.json.message?.message_id);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guild_chat_messages` WHERE `guild_id` = ?',
			[owner.guild_id])).toBe(1);
		expect((await post_json<{ reactions: Message['reactions'] }>('/api/chat/messages/reaction', {
			conversation_kind: 'guild', conversation_id: owner.guild_id, message_id: sent.json.message?.message_id,
			reaction: '🎉', reacted: true
		}, owner.session_token)).json.reactions).toEqual([{ reaction: '🎉', count: 1, reacted: true }]);

		const later = await register_client('Later Guild Chat Member');
		await post_json('/api/guilds/apply', { guild_id: owner.guild_id }, later.session_token);
		const guild_state = await get_json_with_session<{
			applicants: Array<{ application_id: number }>;
		}>('/api/guilds/state', owner.session_token);
		await post_json('/api/guilds/application/decide', {
			application_id: guild_state.json.applicants[0].application_id,
			approve: true
		}, owner.session_token);

		const later_inbox = await guild_inbox(later.session_token);
		expect(later_inbox.json.conversations.find(entry => entry.conversation_kind === 'guild')?.latest_message?.content)
			.toBe('Durable Guild history');
		expect((await guild_events(later.session_token)).json.chat_unread).toBe(1);
		await send_guild_message(owner.session_token, owner.guild_id, 'New for active members');
		expect((await get_events(later)).chat_unread).toBe(1);
		expect((await guild_events(later.session_token)).json.chat_unread).toBe(2);
		const read = await guild_messages(later.session_token, owner.guild_id);
		expect(read.json.messages.map(message => message.content)).toEqual([
			'Durable Guild history',
			'New for active members'
		]);
		expect((await guild_events(later.session_token)).json.chat_unread).toBe(1);
	});

	test('reports moderation changes and omits globally hidden Guild Messages', async () => {
		const pair = await make_guildmates('Moderated Guild Sender', 'Moderated Guild Reader', 'Moderated Guild Chat');
		const first = await send_guild_message(pair.first.session_token, pair.guild_id, 'Hide this Guild Message');
		await send_guild_message(pair.first.session_token, pair.guild_id, 'Keep this Guild Message');
		const hidden_message_id = first.json.message?.message_id;
		if (typeof hidden_message_id !== 'number')
			throw new Error('Guild Message was not created');

		expect((await guild_inbox(pair.second.session_token)).json.conversations.find(
			entry => entry.conversation_kind === 'guild'
		)?.moderation_count).toBe(0);
		await db_run(
			'INSERT INTO `guild_chat_message_moderation` (`message_id`, `deleted_at`) VALUES(?, ?)',
			[hidden_message_id, Date.now()]
		);
		const moderated = await guild_inbox(pair.second.session_token);
		expect(moderated.json.conversations.find(entry => entry.conversation_kind === 'guild')?.moderation_count).toBe(1);
		expect((await guild_messages(pair.second.session_token, pair.guild_id)).json.messages.map(message => message.content))
			.toEqual(['Keep this Guild Message']);
	});

	test('uses a newest-page high-water mark and suspends unread state while opted out', async () => {
		const pair = await make_guildmates('Guild Chat Sender', 'Guild Chat Reader', 'Unread Guild Chat');
		for (let index = 1; index <= 21; index++)
			await send_guild_message(pair.first.session_token, pair.guild_id, `Guild Message ${index}`);

		expect((await guild_events(pair.second.session_token)).json.chat_unread).toBe(22);
		const newest = await guild_messages(pair.second.session_token, pair.guild_id);
		expect(newest.json.messages).toHaveLength(20);
		expect(newest.json.messages.map(message => message.content)).toEqual(
		Array.from({ length: 20 }, (_, index) => `Guild Message ${index + 2}`)
	);
		expect(newest.json.has_more).toBe(true);
		expect((await guild_events(pair.second.session_token)).json.chat_unread).toBe(1);
		const older = await guild_messages(
			pair.second.session_token,
			pair.guild_id,
			`&before=${newest.json.messages[0].message_id}`
		);
		expect(older.json.messages.map(message => message.content)).toEqual(['Guild Message 1']);
		expect((await guild_events(pair.second.session_token)).json.chat_unread).toBe(1);

		await post_json('/api/chat/guild-participation', { enabled: false }, pair.second.session_token);
		const opted_out = await guild_inbox(pair.second.session_token);
		expect(opted_out.json.guild_chat).toEqual({ affiliated: true, enabled: false });
		expect(opted_out.json.conversations.some(entry => entry.conversation_kind === 'guild')).toBe(false);
		expect((await guild_events(pair.second.session_token)).json.chat_unread).toBe(1);
		expect((await send_guild_message(pair.second.session_token, pair.guild_id, 'Not allowed')).json.error_lang)
			.toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
		await send_guild_message(pair.first.session_token, pair.guild_id, 'While opted out');
		await post_json('/api/chat/guild-participation', { enabled: true }, pair.second.session_token);
		expect((await guild_events(pair.second.session_token)).json.chat_unread).toBe(1);
		expect((await guild_messages(pair.second.session_token, pair.guild_id)).json.messages.at(-1)?.content)
			.toBe('While opted out');
	});

	test('retains Free Fellowship history while empty and cascades an ordinary dissolved Guild', async () => {
		const fellowship_member = await attach_to_free_fellowship(await register_client('Fellowship Chat First'));
		await send_guild_message(fellowship_member.session_token, fellowship_member.guild_id, 'Fellowship history');
		await post_json('/api/guilds/leave', {}, fellowship_member.session_token);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guild_chat_messages` WHERE `guild_id` = ?',
			[fellowship_member.guild_id])).toBe(1);
		const later_fellowship = await attach_to_free_fellowship(await register_client('Fellowship Chat Later'));
		expect((await guild_inbox(later_fellowship.session_token)).json.conversations.find(
			entry => entry.conversation_kind === 'guild'
		)?.latest_message?.content).toBe('Fellowship history');
		expect((await guild_events(later_fellowship.session_token)).json.chat_unread).toBe(1);

		const ordinary = await register_guild_client('Dissolving Chat Owner', 'Dissolving Chat');
		await send_guild_message(ordinary.session_token, ordinary.guild_id, 'Delete with Guild');
		await post_json('/api/guilds/leave', {}, ordinary.session_token);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guild_chat_messages` WHERE `guild_id` = ?',
			[ordinary.guild_id])).toBe(0);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guild_chat_read_state` WHERE `guild_id` = ?',
			[ordinary.guild_id])).toBe(0);
	});
});

describe('Chat moderation API', () => {
	beforeEach(clear_global_chat_throttle);

	test('allows configured identities to delete visible Global and Guild messages for everyone only', async () => {
		const global_moderator = await register_client('Configured Chat Moderator');
		const global_sender = await register_client('Configured Chat Sender');
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['RESTART-CHAT-MODERATOR', global_moderator.client_id]);

		const global_message = await send_global_message(global_sender.session_token, 'Moderate this Global Message');
		const global_message_id = global_message.json.message?.message_id;
		if (typeof global_message_id !== 'number')
			throw new Error('Global Message was not created');
		const moderator_global_inbox = await global_inbox(global_moderator.session_token);
		const non_moderator_global_inbox = await global_inbox(global_sender.session_token);
		expect(moderator_global_inbox.json.conversations.find(entry => entry.conversation_kind === 'global')?.can_moderate)
			.toBe(true);
		expect(non_moderator_global_inbox.json.conversations.find(entry => entry.conversation_kind === 'global')?.can_moderate)
			.toBe(false);
		const deleted_global = await post_json<{ success?: boolean; error_lang?: string }>(
			'/api/chat/messages/delete-for-all',
			{ conversation_kind: 'global', message_id: global_message_id }, global_moderator.session_token
		);
		expect(deleted_global.json.success).toBe(true);
		expect((await global_messages(global_sender.session_token)).json.messages.some(
			message => message.message_id === global_message_id
		)).toBe(false);

		const guild_pair = await make_guildmates('Configured Guild Moderator', 'Guild Message Author', 'Moderated Guild');
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['RESTART-CHAT-MODERATOR-2', guild_pair.first_id]);
		const guild_message = await send_guild_message(
			guild_pair.second.session_token, guild_pair.guild_id, 'Moderate this Guild Message'
		);
		const guild_message_id = guild_message.json.message?.message_id;
		if (typeof guild_message_id !== 'number')
			throw new Error('Guild Message was not created');
		const moderator_guild_inbox = await guild_inbox(guild_pair.first.session_token);
		expect(moderator_guild_inbox.json.conversations.find(entry => entry.conversation_kind === 'guild')?.can_moderate)
			.toBe(true);
		const deleted_guild = await post_json<{ success?: boolean; error_lang?: string }>(
			'/api/chat/messages/delete-for-all',
			{ conversation_kind: 'guild', message_id: guild_message_id }, guild_pair.first.session_token
		);
		expect(deleted_guild.json.success).toBe(true);
		expect((await guild_messages(guild_pair.second.session_token, guild_pair.guild_id)).json.messages).toEqual([]);

		const other_guild = await register_guild_client('Other Guild Author', 'Other Guild');
		const other_message = await send_guild_message(
			other_guild.session_token, other_guild.guild_id, 'Not visible to the moderator'
		);
		const other_message_id = other_message.json.message?.message_id;
		if (typeof other_message_id !== 'number')
			throw new Error('Other Guild Message was not created');
		const denied = await post_json<{ success?: boolean; error_lang?: string }>(
			'/api/chat/messages/delete-for-all',
			{ conversation_kind: 'guild', message_id: other_message_id }, guild_pair.first.session_token
		);
		expect(denied.json).toEqual({ error_lang: 'MOD_MP_CHAT_CONVERSATION_MISSING' });
		expect((await guild_messages(other_guild.session_token, other_guild.guild_id)).json.messages.map(message => message.content))
			.toEqual(['Not visible to the moderator']);
	});
});

describe('Support Chat API', () => {
	test('advances event revisions for both Support conversation sides', async () => {
		const player = await register_client('Support Revision Player');
		const member = await register_client('Support Revision Member');
		const support = (await conversations(player.session_token)).json.conversations.find(entry =>
			(entry as Conversation & { conversation_kind?: string }).conversation_kind === 'support'
		) as Conversation & { support_team_id: number };
		await get_json_with_session(
			`/api/chat/messages?conversation_kind=support&support_team_id=${support.support_team_id}`,
			player.session_token
		);
		await db_run(
			'INSERT INTO `support_team_memberships` ' +
			'(`team_id`, `client_id`, `member_display_name`, `created_at`) VALUES(?, ?, ?, ?)',
			[support.support_team_id, member.client_id, 'Support Revision Member', Date.now()]
		);

		const player_before = await get_json_with_session<{ revision: number }>('/api/events', player.session_token);
		const member_before = await get_json_with_session<{ revision: number }>('/api/events', member.session_token);
		const player_message = await post_json<{ message: Message }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: null, support_team_id: support.support_team_id,
			idempotency_key: crypto.randomUUID(), content: 'Revision check from player'
		}, player.session_token);

		const player_after_send = await get_json_with_session<{ revision: number; unchanged?: boolean }>(
			`/api/events?revision=${player_before.json.revision}`, player.session_token
		);
		const member_after_send = await get_json_with_session<{ revision: number; unchanged?: boolean; chat_unread: number }>(
			`/api/events?revision=${member_before.json.revision}`, member.session_token
		);
		expect(player_after_send.json.unchanged).not.toBe(true);
		expect(member_after_send.json.unchanged).not.toBe(true);
		expect(member_after_send.json.chat_unread).toBe(1);

		await get_json_with_session(
			`/api/chat/messages?conversation_kind=support&conversation_id=${player_message.json.message.conversation_id}`,
			member.session_token
		);
		const member_after_read = await get_json_with_session<{ revision: number; unchanged?: boolean; chat_unread: number }>(
			`/api/events?revision=${member_after_send.json.revision}`, member.session_token
		);
		expect(member_after_read.json.unchanged).not.toBe(true);
		expect(member_after_read.json.chat_unread).toBe(0);

		const member_reply = await post_json<{ message: Message }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: player_message.json.message.conversation_id,
			support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(),
			content: 'Revision check from team'
		}, member.session_token);
		const player_after_reply = await get_json_with_session<{ revision: number; unchanged?: boolean; chat_unread: number }>(
			`/api/events?revision=${player_after_send.json.revision}`, player.session_token
		);
		expect(player_after_reply.json.unchanged).not.toBe(true);
		expect(player_after_reply.json.chat_unread).toBe(1);

		await get_json_with_session(
			`/api/chat/messages?conversation_kind=support&conversation_id=${player_message.json.message.conversation_id}`,
			player.session_token
		);
		const player_after_read = await get_json_with_session<{ revision: number; unchanged?: boolean; chat_unread: number }>(
			`/api/events?revision=${player_after_reply.json.revision}`, player.session_token
		);
		expect(player_after_read.json.unchanged).not.toBe(true);
		expect(player_after_read.json.chat_unread).toBe(0);
		const member_before_moderation = await get_json_with_session<{ revision: number }>(
			'/api/events', member.session_token
		);

		await db_run('INSERT INTO `support_message_moderation` (`message_id`, `deleted_at`) VALUES(?, ?)',
			[member_reply.json.message.message_id, Date.now()]);
		const [player_after_moderation, member_after_moderation] = await Promise.all([
			get_json_with_session<{ unchanged?: boolean }>(
				`/api/events?revision=${player_after_read.json.revision}`, player.session_token
			),
			get_json_with_session<{ unchanged?: boolean }>(
				`/api/events?revision=${member_before_moderation.json.revision}`, member.session_token
			)
		]);
		expect(player_after_moderation.json.unchanged).not.toBe(true);
		expect(member_after_moderation.json.unchanged).not.toBe(true);
	});

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
		expect((await post_json<{ reactions: Message['reactions'] }>('/api/chat/messages/reaction', {
			conversation_kind: 'support', conversation_id: first.json.message.conversation_id,
			message_id: first.json.message.message_id, reaction: '🙏', reacted: true
		}, player.session_token)).json.reactions).toEqual([{ reaction: '🙏', count: 1, reacted: true }]);
		expect((await get_json_with_session<{ messages: Message[] }>(
			`/api/chat/messages?conversation_kind=support&conversation_id=${first.json.message.conversation_id}`,
			player.session_token
		)).json.messages.at(-1)?.reactions).toEqual([{ reaction: '🙏', count: 1, reacted: true }]);
		await db_run('UPDATE `support_teams` SET `welcome_content` = ? WHERE `id` = ?', [
			"Welcome to Melvor Multiplayer!\n\nThis is an automated message. If you run into any problems or have a suggestion, just reply here. We'd love to hear from you!",
			support.support_team_id
		]);
	});

	test('localizes automated Support welcomes while retaining English team history', async () => {
		const player = await register_client('Localized Support Player');
		await db_run(
			'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `language`, `reported_at`) ' +
			'VALUES(?, ?, ?, ?, ?)',
			[player.client_id, '1.5.11', '[]', 'zh-TW', Date.now()]
		);
		const support = (await conversations(player.session_token)).json.conversations.find(entry =>
			entry.conversation_kind === 'support'
		) as Conversation & { support_team_id: number };
		expect(support.latest_message?.content).toContain('歡迎來到 Melvor Multiplayer');
		const virtual = await get_json_with_session<{ messages: Message[] }>(
			`/api/chat/messages?conversation_kind=support&support_team_id=${support.support_team_id}`,
			player.session_token
		);
		expect(virtual.json.messages[0].content).toContain('這是一則自動訊息');

		const sent = await post_json<{ success: boolean; message: Message }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: null, support_team_id: support.support_team_id,
			idempotency_key: crypto.randomUUID(), content: '需要協助'
		}, player.session_token);
		const player_history = await get_json_with_session<{ messages: Message[] }>(
			`/api/chat/messages?conversation_kind=support&conversation_id=${sent.json.message.conversation_id}`,
			player.session_token
		);
		expect(player_history.json.messages[0].content).toContain('Welcome to Melvor Multiplayer!');
		expect(player_history.json.messages[0].translations['zh-TW']).toContain('歡迎來到 Melvor Multiplayer');
		expect(player_history.json.messages[0].translation_status).toBe('complete');

		const member = await register_client('Localized Support Member');
		await db_run(
			'INSERT INTO `support_team_memberships` ' +
			'(`team_id`, `client_id`, `member_display_name`, `created_at`) VALUES(?, ?, ?, ?)',
			[support.support_team_id, member.client_id, 'Localized Support Member', Date.now()]
		);
		const team_history = await get_json_with_session<{ messages: Message[] }>(
			`/api/chat/messages?conversation_kind=support&conversation_id=${sent.json.message.conversation_id}`,
			member.session_token
		);
		expect(team_history.json.messages[0].content).toContain('Welcome to Melvor Multiplayer!');
	});

	test('gates data-owned Support Teams by client version and exact active mod while retaining history', async () => {
		const player = await register_client('SAE Eligibility Player');
		const set_runtime = (version: string, active_mods: string[]) => db_run(
			'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `reported_at`) ' +
			'VALUES(?, ?, ?, ?) ON CONFLICT (`client_id`) DO UPDATE SET ' +
			'`mod_version` = excluded.`mod_version`, `active_mods` = excluded.`active_mods`, ' +
			'`reported_at` = excluded.`reported_at`',
			[player.client_id, version, JSON.stringify(active_mods), Date.now()]
		);
		const support_entries = async () => (await conversations(player.session_token)).json.conversations.filter(entry =>
			entry.conversation_kind === 'support'
		) as Array<Conversation & { support_team_id: number }>;

		expect((await support_entries()).map(entry => entry.participant.display_name)).toEqual(['Multiplayer Mod Team']);
		await set_runtime('1.3.3', ['Multiplayer', 'SUPER AWESOME EXPANSION']);
		expect((await support_entries()).map(entry => entry.participant.display_name)).toEqual(['Multiplayer Mod Team']);

		await set_runtime('1.3.4', ['Multiplayer', 'SUPER AWESOME EXPANSION']);
		const eligible = await support_entries();
		expect(eligible.map(entry => entry.participant.display_name).sort()).toEqual([
			'Multiplayer Mod Team', 'SAE Support Team'
		]);
		const sae = eligible.find(entry => entry.participant.display_name === 'SAE Support Team') as
			Conversation & { support_team_id: number };
		expect(sae.participant.icon_id).toBe('sae_support');
		expect(sae.latest_message?.content).toBe(
			'Welcome to SUPER AWESOME EXPANSION!\n\n' +
			'This is an automated message from EdwinNarwhal, beep boop. Do you have a question, concern, or suggestion? ' +
			'This is the place to voice it! Just reply to this message, here. I look forward to hearing from you!'
		);
		const sent = await post_json<{ success: boolean; message: Message }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: null, support_team_id: sae.support_team_id,
			idempotency_key: crypto.randomUUID(), content: 'SAE question'
		}, player.session_token);
		expect(sent.json.success).toBe(true);

		await set_runtime('1.3.4', ['Multiplayer']);
		expect((await support_entries()).map(entry => entry.participant.display_name)).toEqual(['Multiplayer Mod Team']);
		const hidden_history = await get_json_with_session<{ messages?: Message[]; error_lang?: string }>(
			`/api/chat/messages?conversation_kind=support&conversation_id=${sent.json.message.conversation_id}`,
			player.session_token
		);
		expect(hidden_history.json.messages).toBeUndefined();
		expect(hidden_history.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
		const hidden_send = await post_json<{ success?: boolean; error_lang?: string }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: sent.json.message.conversation_id,
			support_team_id: sae.support_team_id, idempotency_key: crypto.randomUUID(), content: 'Bypass attempt'
		}, player.session_token);
		expect(hidden_send.json.success).not.toBe(true);
		expect(hidden_send.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');

		await set_runtime('1.3.4', ['Multiplayer', 'SUPER AWESOME EXPANSION']);
		const restored = (await support_entries()).find(entry => entry.participant.display_name === 'SAE Support Team');
		expect(restored?.conversation_id).toBe(sent.json.message.conversation_id);
		expect(restored?.latest_message?.content).toBe('SAE question');
	});

	test('grants team history only to the operator-selected Client while bypassing private Chat controls', async () => {
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
		await db_run(
			'INSERT INTO `support_team_memberships` ' +
			'(`team_id`, `client_id`, `member_display_name`, `created_at`) VALUES(?, ?, ?, ?)',
			[support.support_team_id, team.client_id, 'Team Character', Date.now()]
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
		expect((await conversations(team_sibling.session_token)).json.conversations.some(entry =>
			(entry as Conversation & { viewer_side?: string }).viewer_side === 'team'
		)).toBe(false);
		const sibling_history = await get_json_with_session<{ messages?: Message[]; error_lang?: string }>(
			`/api/chat/messages?conversation_kind=support&conversation_id=${sent.json.message.conversation_id}`,
			team_sibling.session_token
		);
		expect(sibling_history.json.messages).toBeUndefined();
		expect(sibling_history.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
		const sibling_reply = await post_json<{ success?: boolean; error_lang?: string }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: sent.json.message.conversation_id,
			support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(),
			content: 'Spoofed team reply'
		}, team_sibling.session_token);
		expect(sibling_reply.json.success).not.toBe(true);
		expect(sibling_reply.json.error_lang).toBe('MOD_MP_CHAT_CONVERSATION_MISSING');
		expect((await post_json<{ success?: boolean }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: null, support_team_id: support.support_team_id,
			idempotency_key: crypto.randomUUID(), content: 'Cannot contact own team'
		}, team.session_token)).json.success).not.toBe(true);

		const reply = await post_json<{ success: boolean; message: Message & { sender: { display_name: string } } }>(
			'/api/chat/messages/send', { conversation_kind: 'support', conversation_id: sent.json.message.conversation_id,
				support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(), content: 'Team reply' },
			team.session_token
		);
		expect(reply.json.success).toBe(true);
		expect(reply.json.message.sender.display_name).toBe('Team Character');
		expect((await get_events(player)).chat_unread).toBe(2);

		await post_json('/api/chat/privacy', { messaging_enabled: false }, player.session_token);
		const followup = await post_json<{ success: boolean }>('/api/chat/messages/send', {
			conversation_kind: 'support', conversation_id: sent.json.message.conversation_id,
			support_team_id: support.support_team_id, idempotency_key: crypto.randomUUID(), content: 'Still available'
		}, player.session_token);
		expect(followup.json.success).toBe(true);
	});
});
