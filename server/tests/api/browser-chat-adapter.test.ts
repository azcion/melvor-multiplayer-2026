import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { browser_csrf, issue_browser_code, pair_browser } from '../../browser-chat-auth';
import { request, post_json, register_client, get_json_with_session } from '../support/http';
import { make_guildmates } from '../support/fixtures';
import { db_all, db_run } from '../support/persistence';

// Support teams are shared across test files; hide only this file's synthetic history afterwards.
const support_players: number[] = [];
afterEach(async () => {
	for (const client_id of support_players.splice(0)) {
		await db_run(
			'INSERT OR IGNORE INTO support_message_moderation(message_id,deleted_at) SELECT message.id,? FROM support_messages message JOIN support_conversations conversation ON conversation.id=message.conversation_id WHERE conversation.player_client_id=?',
			[Date.now(), client_id]
		);
	}
});

function linked(client_id: number, browser_token?: string) {
	const db = new Database(process.env.TEST_DB_PATH!, { strict: true });
	try {
		db.run('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');
		const pair = pair_browser(db, issue_browser_code(db, client_id).code, undefined, browser_token)!;
		const headers = {
			Origin: 'https://melvor.azcn.io',
			Cookie: `__Secure-mp-chat=${pair.token}`,
			'X-Chat-CSRF': browser_csrf(pair.token),
			'X-Chat-Link-ID': String(pair.id)
		};
		return {
			token: pair.token,
			headers,
			get: (path: string) => request('/chat/api/' + path, { headers }),
			post: (path: string, body: unknown) =>
				request('/chat/api/' + path, {
					method: 'POST',
					headers: { ...headers, 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				})
		};
	} finally {
		db.close();
	}
}
const json = async (response: Response) => {
	expect(response.status).toBe(200);
	return (await response.json()) as any;
};

test('browser and game share canonical private messages, reads, reactions, parts, privacy and participant deletion', async () => {
	const a = await register_client('Browser sender');
	const b = await register_client('Game receiver');
	const c = await register_client('Unrelated browser');
	const web = linked(a.client_id),
		other = linked(c.client_id, web.token);
	const before = await db_all('SELECT * FROM clients WHERE id=?', [a.client_id]);
	const runtime = await db_all('SELECT * FROM client_runtime_snapshots WHERE client_id=?', [a.client_id]);
	const sessions = await db_all('SELECT * FROM client_sessions WHERE client_id=?', [a.client_id]);
	const untouched_tables = [
		'economy_load_observations',
		'economy_operations',
		'economy_receipts',
		'expedition_work_sessions',
		'gp_snapshots',
		'status_snapshots'
	];
	const untouched = await Promise.all(
		untouched_tables.map((table) => db_all(`SELECT * FROM ${table} WHERE client_id=?`, [a.client_id]))
	);

	const start = await json(await web.post('conversations/start', { client_id: b.client_id }));
	expect(start.conversation.conversation_id).toBeNull();
	const payload = {
		conversation_kind: 'private',
		conversation_id: null,
		client_id: b.client_id,
		content: 'Tagged browser message',
		parts: [
			{ type: 'text', text: 'Use ' },
			{ type: 'item', item_id: 'melvorD:Bronze_Sword' },
			{ type: 'person', client_id: b.client_id }
		],
		idempotency_key: crypto.randomUUID()
	};
	const sent = await json(await web.post('messages/send', payload));
	expect(sent.success).toBe(true);
	const id = sent.message.conversation_id,
		message = sent.message.message_id;
	expect((await json(await web.post('messages/send', payload))).message.message_id).toBe(message);
	const read = (await get_json_with_session<any>(`/api/chat/messages?conversation_id=${id}`, b.session_token))
		.json;
	expect(read.messages.find((m: any) => m.message_id === message).parts).toMatchObject(payload.parts);
	const reply = (
		await post_json<any>(
			'/api/chat/messages/send',
			{ conversation_id: id, content: 'From game', idempotency_key: crypto.randomUUID() },
			b.session_token
		)
	).json;
	const history = await json(await web.get(`messages?conversation_id=${id}`));
	expect(history.messages.some((m: any) => m.message_id === reply.message.message_id)).toBe(true);
	expect(history.messages[0]).toHaveProperty('translation_status');
	const reaction = { conversation_id: id, message_id: message, reaction: '👍', reacted: true };
	expect((await json(await web.post('messages/reaction', reaction))).success).toBe(true);
	const details = await json(await web.get(`messages/details?conversation_id=${id}&message_id=${message}`));
	expect(details.reactions.some((r: any) => r.client_id === a.client_id)).toBe(true);
	expect(details.seen.some((r: any) => r.client_id === b.client_id)).toBe(true);
	expect((await json(await other.get(`messages?conversation_id=${id}`))).messages).toBeUndefined();
	expect((await other.get(`messages/details?conversation_id=${id}&message_id=${message}`)).status).toBe(404);
	expect((await json(await other.post('messages/reaction', reaction))).success).toBeUndefined();
	for (const kind of [
		'guild',
		'global',
		'alliance',
		'testers',
		'support',
		'poll-discussion',
		'petition-discussion',
		'unknown'
	]) {
		expect((await web.post('messages/delete', { conversation_kind: kind, message_id: message })).status).toBe(
			400
		);
		expect(
			(await web.post('conversations/delete', { conversation_kind: kind, conversation_id: id })).status
		).toBe(400);
	}
	expect((await json(await web.post('messages/delete', { message_id: message }))).success).toBe(true);
	expect(
		(await json(await web.get(`messages?conversation_id=${id}`))).messages.some(
			(m: any) => m.message_id === message
		)
	).toBe(false);
	expect((await json(await web.post('conversations/delete', { conversation_id: id }))).success).toBe(true);
	expect((await json(await web.post('block', { client_id: b.client_id, blocked: true }))).success).toBe(true);
	expect(
		(
			await json(
				await web.post('messages/send', {
					conversation_id: id,
					content: 'Blocked',
					idempotency_key: crypto.randomUUID()
				})
			)
		).error_lang
	).toBe('MOD_MP_CHAT_RECIPIENT_UNAVAILABLE');
	await web.post('block', { client_id: b.client_id, blocked: false });
	await web.post('privacy', { messaging_enabled: false });
	expect(
		(
			await json(
				await web.post('messages/send', {
					conversation_id: id,
					content: 'Opted out',
					idempotency_key: crypto.randomUUID()
				})
			)
		).error_lang
	).toBe('MOD_MP_CHAT_RECIPIENT_UNAVAILABLE');
	await web.post('privacy', { messaging_enabled: true });
	// Chat preference/read triggers legitimately advance the event revision.
	const after = await db_all('SELECT * FROM clients WHERE id=?', [a.client_id]);
	expect(after.map(({ event_revision, ...client }) => client)).toEqual(
		before.map(({ event_revision, ...client }) => client)
	);
	expect(await db_all('SELECT * FROM client_runtime_snapshots WHERE client_id=?', [a.client_id])).toEqual(
		runtime
	);
	expect(await db_all('SELECT * FROM client_sessions WHERE client_id=?', [a.client_id])).toEqual(sessions);
	expect(
		await Promise.all(
			untouched_tables.map((table) => db_all(`SELECT * FROM ${table} WHERE client_id=?`, [a.client_id]))
		)
	).toEqual(untouched);
});

test('exact browser allowlist, selected identity, deferred kinds and ordinary linked admin profiles', async () => {
	const a = await register_client('Linked admin');
	const b = await register_client('Hidden profile');
	// Dedicated configured admin identifier avoids collisions with other API fixtures.
	await db_run('UPDATE clients SET client_identifier=? WHERE id=?', ['TEST-BROWSER-CHAT-ADMIN', a.client_id]);
	await db_run('UPDATE clients SET active_mods_visible=0 WHERE id=?', [b.client_id]);
	await db_run('UPDATE client_runtime_snapshots SET active_mods=? WHERE client_id=?', [
		'["private-mod"]',
		b.client_id
	]);
	const web = linked(a.client_id);
	expect((await get_json_with_session<any>('/api/chat/state', a.session_token)).json.is_admin).toBe(true);
	expect(await json(await web.get('state'))).not.toHaveProperty('is_admin');
	const profile = await json(await web.get(`profile?client_id=${b.client_id}`));
	expect(profile.active_mods_visible).toBe(false);
	expect(profile.active_mods_available).toBe(false);
	expect(profile).not.toHaveProperty('account_name');
	expect(profile).not.toHaveProperty('last_active_at');
	const inbox = await json(await web.get('conversations?capabilities=polls-v1'));
	expect(inbox).not.toHaveProperty('polls_summary');
	for (const conversation of inbox.conversations) expect(conversation).not.toHaveProperty('can_moderate');
	expect(inbox.conversations.some((c: any) => c.conversation_kind === 'global')).toBe(true);
	expect((await web.get('profile?people=1')).status).toBe(200);
	for (const kind of ['poll-discussion', 'petition-discussion', 'unknown']) {
		for (const path of [
			'state',
			'profile?people=1',
			'conversations',
			'messages?people=1&conversation_id=1',
			'messages/details?conversation_id=1&message_id=1'
		]) {
			expect(
				(
					await web.get(
						path + (path.includes('?') ? '&' : '?') + `conversation_kind=${kind}&capabilities=polls-v1`
					)
				).status
			).toBe(400);
		}
		for (const path of ['messages/send', 'messages/reaction'])
			expect((await web.post(path, { conversation_kind: kind })).status).toBe(400);
	}
	for (const path of [
		'messages/delete-for-all',
		'events',
		'client/status/sync',
		'runtime',
		'polls',
		'identity',
		'economy'
	])
		expect((await web.post(path, {})).status).toBe(404);
	expect(
		(await request('/chat/api/state', { headers: { ...web.headers, 'X-Chat-Link-ID': '999999999' } })).status
	).toBe(401);
	expect(
		(await request('/chat/api/state', { headers: { ...web.headers, 'X-Chat-CSRF': 'forged' } })).status
	).toBe(403);
	expect((await request('/chat/api/state')).status).toBe(400);
	expect((await web.post('state', {})).status).toBe(405);
});

test('browser Global, Guild, Support, testers and Alliance use existing membership and participation boundaries', async () => {
	const pair = await make_guildmates('Web guild', 'Game guild', 'Browser adapters');
	const a = pair.first,
		b = pair.second;
	support_players.push(a.client_id);
	const outsider = await register_client('Outside guild');
	const web = linked(a.client_id),
		other = linked(outsider.client_id);
	const inbox = await json(await web.get('conversations'));
	for (const kind of ['global', 'guild', 'testers', 'support']) {
		const conversation = inbox.conversations.find((c: any) => c.conversation_kind === kind);
		expect(conversation).toBeDefined();
		const query =
			`conversation_kind=${kind}&conversation_id=${conversation.conversation_id ?? ''}` +
			(kind === 'support' ? `&support_team_id=${conversation.support_team_id}` : '');
		expect((await web.get('messages?' + query)).status).toBe(200);
		const sent = await json(
			await web.post('messages/send', {
				conversation_kind: kind,
				conversation_id: conversation.conversation_id,
				...(kind === 'support' ? { support_team_id: conversation.support_team_id } : {}),
				content: `Browser ${kind}`,
				idempotency_key: crypto.randomUUID()
			})
		);
		expect(sent.success).toBe(true);
		const id = sent.message.conversation_id;
		if (kind !== 'support') {
			const game = (
				await get_json_with_session<any>(
					`/api/chat/messages?conversation_kind=${kind}&conversation_id=${id}&capabilities=global-chat-v1,guild-chat-v1`,
					b.session_token
				)
			).json;
			expect(game.messages.some((m: any) => m.message_id === sent.message.message_id)).toBe(true);
		}
		expect(
			(
				await json(
					await web.post('messages/reaction', {
						conversation_kind: kind,
						conversation_id: id,
						message_id: sent.message.message_id,
						reaction: '👍',
						reacted: true
					})
				)
			).success
		).toBe(true);
		if (kind === 'global' || kind === 'testers')
			await db_run('DELETE FROM global_chat_messages WHERE id=?', [sent.message.message_id]);
		if (kind === 'guild') {
			expect((await json(await other.get('messages?' + query))).messages).toBeUndefined();
			await web.post('guild-participation', { enabled: false });
			expect((await json(await web.get('messages?' + query))).messages).toBeUndefined();
			await web.post('guild-participation', { enabled: true });
			await db_run('DELETE FROM guild_memberships WHERE client_id=?', [a.client_id]);
			expect((await json(await web.get('messages?' + query))).messages).toBeUndefined();
		}
	}
	const global = inbox.conversations.find((c: any) => c.conversation_kind === 'global');
	await web.post('global-participation', { enabled: false });
	expect(
		(await json(await web.get(`messages?conversation_kind=global&conversation_id=${global.conversation_id}`)))
			.messages
	).toBeUndefined();
	expect(
		(await json(await web.get('messages?conversation_kind=alliance&conversation_id=1'))).messages
	).toBeUndefined();
});

test('browser Alliance membership, shadow visibility, tags and Support exact-client memberships remain canonical', async () => {
	const { first, second, guild_id } = await make_guildmates(
		'Web alliance',
		'Game alliance',
		'Web alliance guild'
	);
	support_players.push(first.client_id);
	const account = {
		cloud_username: 'WebSupport' + crypto.randomUUID().slice(0, 8),
		playfab_id: crypto.randomUUID()
	};
	await db_run('INSERT INTO melvor_accounts(cloud_username,playfab_id,created_at) VALUES(?,?,?)', [
		account.cloud_username,
		account.playfab_id,
		Date.now()
	]);
	const [owner] = await db_all<{ id: number }>('SELECT id FROM melvor_accounts WHERE playfab_id=?', [
		account.playfab_id
	]);
	await db_run('UPDATE clients SET melvor_account_id=? WHERE id=?', [owner!.id, second.client_id]);
	const sibling = await register_client('Unpaired Support sibling', account);
	const sibling_web = linked(sibling.client_id);
	const outsider = await register_client('Outside alliance');
	const web = linked(first.client_id),
		peer = linked(second.client_id),
		other = linked(outsider.client_id);
	expect(
		(
			await request('/chat/api/state', {
				headers: { ...peer.headers, 'X-Chat-Link-ID': sibling_web.headers['X-Chat-Link-ID'] }
			})
		).status
	).toBe(401);
	const name = 'Web ' + crypto.randomUUID().slice(0, 8);
	await db_run('INSERT INTO alliances(name,created_at) VALUES(?,?)', [name, Date.now()]);
	const [alliance] = await db_all<{ id: number }>('SELECT id FROM alliances WHERE name=?', [name]);
	await db_run('INSERT INTO alliance_memberships(guild_id,alliance_id,joined_at) VALUES(?,?,?)', [
		guild_id,
		alliance!.id,
		Date.now()
	]);
	const query = `conversation_kind=alliance&conversation_id=${alliance!.id}`;
	const payload = {
		conversation_kind: 'alliance',
		conversation_id: alliance!.id,
		content: 'ignored',
		parts: [{ type: 'person', client_id: second.client_id }],
		idempotency_key: crypto.randomUUID()
	};
	const sent = await json(await web.post('messages/send', payload));
	expect(sent.success).toBe(true);
	expect((await json(await web.post('messages/send', payload))).message.message_id).toBe(
		sent.message.message_id
	);
	expect(
		(await json(await peer.get('conversations'))).conversations.find(
			(c: any) => c.conversation_kind === 'alliance'
		).unread_tagged
	).toBe(true);
	expect(
		(await json(await peer.get('messages?' + query))).messages.some(
			(m: any) => m.message_id === sent.message.message_id
		)
	).toBe(true);
	const game_alliance = (
		await get_json_with_session<any>('/api/chat/messages?' + query, second.session_token)
	).json;
	expect(
		game_alliance.messages.find((m: any) => m.message_id === sent.message.message_id).parts
	).toMatchObject(payload.parts);
	const game_reply = (
		await post_json<any>(
			'/api/chat/messages/send',
			{
				conversation_kind: 'alliance',
				conversation_id: alliance!.id,
				content: 'Game alliance reply',
				idempotency_key: crypto.randomUUID()
			},
			second.session_token
		)
	).json;
	expect(
		(await json(await web.get('messages?' + query))).messages.some(
			(m: any) => m.message_id === game_reply.message.message_id
		)
	).toBe(true);
	expect((await json(await other.get('messages?' + query))).messages).toBeUndefined();
	expect((await other.get(`messages/details?${query}&message_id=${sent.message.message_id}`)).status).toBe(
		404
	);
	await db_run('UPDATE alliance_chat_messages SET shadow_hidden=1 WHERE id=?', [sent.message.message_id]);
	expect(
		(await json(await peer.get('messages?' + query))).messages.some(
			(m: any) => m.message_id === sent.message.message_id
		)
	).toBe(false);
	expect((await peer.get(`messages/details?${query}&message_id=${sent.message.message_id}`)).status).toBe(
		404
	);
	expect((await json(await web.post('alliance-participation', { enabled: false }))).success).toBe(true);
	expect((await json(await web.get('messages?' + query))).messages).toBeUndefined();
	await web.post('alliance-participation', { enabled: true });
	await db_run('DELETE FROM alliance_memberships WHERE guild_id=?', [guild_id]);
	expect((await json(await web.get('messages?' + query))).messages).toBeUndefined();
	const support = (await json(await web.get('conversations'))).conversations.find(
		(c: any) => c.conversation_kind === 'support'
	);
	const reply = await json(
		await web.post('messages/send', {
			conversation_kind: 'support',
			conversation_id: null,
			support_team_id: support.support_team_id,
			content: 'Help from browser',
			idempotency_key: crypto.randomUUID()
		})
	);
	const support_query = `conversation_kind=support&conversation_id=${reply.message.conversation_id}&support_team_id=${support.support_team_id}`;
	expect((await json(await other.get('messages?' + support_query))).messages).toBeUndefined();
	await db_run(
		'INSERT INTO support_team_memberships(team_id,client_id,member_display_name,created_at,active) VALUES(?,?,?,?,1)',
		[support.support_team_id, second.client_id, 'Browser support', Date.now()]
	);
	expect(
		(await json(await peer.get('messages?' + support_query))).messages.some(
			(m: any) => m.message_id === reply.message.message_id
		)
	).toBe(true);
	expect((await json(await sibling_web.get('messages?' + support_query))).messages).toBeUndefined();
	const game_support = (
		await get_json_with_session<any>('/api/chat/messages?' + support_query, second.session_token)
	).json;
	expect(game_support.messages.some((m: any) => m.message_id === reply.message.message_id)).toBe(true);
	const team_reply = (
		await post_json<any>(
			'/api/chat/messages/send',
			{
				conversation_kind: 'support',
				conversation_id: reply.message.conversation_id,
				support_team_id: support.support_team_id,
				content: 'Team game reply',
				idempotency_key: crypto.randomUUID()
			},
			second.session_token
		)
	).json;
	expect(team_reply.success).toBe(true);
	expect(
		(await json(await web.get('messages?' + support_query))).messages.some(
			(m: any) => m.message_id === team_reply.message.message_id
		)
	).toBe(true);
	await db_run('UPDATE support_team_memberships SET active=0 WHERE client_id=? AND team_id=?', [
		second.client_id,
		support.support_team_id
	]);
	expect((await json(await peer.get('messages?' + support_query))).messages).toBeUndefined();
});
