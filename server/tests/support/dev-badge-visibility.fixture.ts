// Run only through the isolated server/database wrapper in unit/dev-badge-visibility.test.ts.
import { expect, test } from 'bun:test';
import { make_guildmates } from './fixtures';
import { get_json_with_session, post, post_json, register_client } from './http';
import { db_all, db_run } from './persistence';

test('lets only tagged accounts hide Dev badges per character', async () => {
	const pair = await make_guildmates('Tagged Character', 'Other Character');
	await db_run(
		"INSERT INTO `melvor_accounts` (`id`, `cloud_username`, `playfab_id`, `created_at`) VALUES (15, 'dev-test-account', 'dev-test-playfab', 1)"
	);
	await db_run('UPDATE `clients` SET `melvor_account_id` = 15 WHERE `id` = ?', [pair.first_id]);
	const other_character = await register_client('Tagged Sibling');
	const other_id = (await db_all<{ id: number }>('SELECT `id` FROM `clients` WHERE `client_identifier` = ?',
		[other_character.client_identifier]))[0].id;
	await db_run('UPDATE `clients` SET `melvor_account_id` = 15 WHERE `id` = ?', [other_id]);
	const before = await get_json_with_session<{ members: Array<{ client_id: number; dev_badge: boolean }> }>(
		'/api/guilds/state', pair.second.session_token);
	const rejected = await post('/api/client/dev-tag/visibility', { visible: false }, pair.second.session_token);
	const malformed = await post('/api/client/dev-tag/visibility', { visible: 'false' }, pair.first.session_token);
	const hidden = await post_json<{ success: boolean; visible: boolean }>(
		'/api/client/dev-tag/visibility', { visible: false }, pair.first.session_token);
	const after = await get_json_with_session<{ members: Array<{ client_id: number; dev_badge: boolean }> }>(
		'/api/guilds/state', pair.second.session_token);
	const sibling = await post_json<{ dev_tag: { eligible: boolean; visible: boolean } }>(
		'/api/authenticate', { client_runtime: { mod_version: '1.6.14', active_mods: [] }, client_identifier: other_character.client_identifier, client_key: other_character.client_key, cloud_username: 'dev-test-account', playfab_id: 'dev-test-playfab' });
	const owner = await post_json<{ session_token: string; dev_tag: { eligible: boolean; visible: boolean } }>(
		'/api/authenticate', { client_runtime: { mod_version: '1.6.14', active_mods: [] }, client_identifier: pair.first.client_identifier, client_key: pair.first.client_key, cloud_username: 'dev-test-account', playfab_id: 'dev-test-playfab' });
	expect(before.json.members.find(member => member.client_id === pair.first_id)?.dev_badge).toBe(true);
	expect(rejected.status).toBe(403);
	expect(malformed.status).toBe(400);
	expect(hidden.json).toEqual({ success: true, visible: false });
	expect(after.json.members.find(member => member.client_id === pair.first_id)?.dev_badge).toBe(false);
	expect(owner.response.status).toBe(200);
	expect(sibling.response.status).toBe(200);
	expect(owner.json.dev_tag).toEqual({ eligible: true, visible: false });
	expect(sibling.json.dev_tag).toEqual({ eligible: true, visible: true });
	await db_run(
		"INSERT INTO `melvor_accounts` (`id`, `cloud_username`, `playfab_id`, `created_at`) VALUES (12, 'sae-test-account', 'sae-test-playfab', 1)"
	);
	await db_run('UPDATE `clients` SET `melvor_account_id` = 12 WHERE `id` = ?', [pair.second_id]);
	const sae_before = await get_json_with_session<{ members: Array<{ client_id: number; sae_dev_badge: boolean }> }>(
		'/api/guilds/state', owner.json.session_token);
	const sae_hidden = await post_json<{ success: boolean; visible: boolean }>(
		'/api/client/dev-tag/visibility', { visible: false }, pair.second.session_token);
	const sae_after = await get_json_with_session<{ members: Array<{ client_id: number; sae_dev_badge: boolean }> }>(
		'/api/guilds/state', owner.json.session_token);
	expect(sae_before.json.members.find(member => member.client_id === pair.second_id)?.sae_dev_badge).toBe(true);
	expect(sae_hidden.json).toEqual({ success: true, visible: false });
	expect(sae_after.json.members.find(member => member.client_id === pair.second_id)?.sae_dev_badge).toBe(false);
	await db_run(
		"INSERT INTO `melvor_accounts` (`id`, `cloud_username`, `playfab_id`, `created_at`) VALUES (819, 'osrs-test-account', 'osrs-test-playfab', 1)"
	);
	await db_run('UPDATE `clients` SET `melvor_account_id` = 819 WHERE `id` IN (?, ?)', [pair.first_id, pair.second_id]);
	await post('/api/client/dev-tag/visibility', { visible: true }, owner.json.session_token);
	await db_run("INSERT INTO service_settings (key, value) VALUES ('dev-badge-label:osrs_overhaul_dev', 'Overhaul Dev') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
	const osrs_before = await get_json_with_session<{
		members: Array<{ client_id: number; dev_badge: boolean; sae_dev_badge: boolean; osrs_overhaul_dev_badge: boolean; dev_badge_label: string | null }>;
	}>('/api/guilds/state', owner.json.session_token);
	expect(osrs_before.json.members.find(member => member.client_id === pair.first_id)).toMatchObject({
		dev_badge: false, sae_dev_badge: false, osrs_overhaul_dev_badge: true, dev_badge_label: 'Overhaul Dev'
	});
	expect(osrs_before.json.members.find(member => member.client_id === pair.second_id)?.osrs_overhaul_dev_badge).toBe(false);
	const osrs_visible = await post_json<{ success: boolean; visible: boolean }>(
		'/api/client/dev-tag/visibility', { visible: true }, pair.second.session_token);
	expect(osrs_visible.json).toEqual({ success: true, visible: true });
	await post('/api/client/dev-tag/visibility', { visible: false }, owner.json.session_token);
	const osrs_after = await get_json_with_session<{ members: Array<{ client_id: number; osrs_overhaul_dev_badge: boolean }> }>(
		'/api/guilds/state', owner.json.session_token);
	expect(osrs_after.json.members.find(member => member.client_id === pair.first_id)?.osrs_overhaul_dev_badge).toBe(false);
	expect(osrs_after.json.members.find(member => member.client_id === pair.second_id)?.osrs_overhaul_dev_badge).toBe(true);
	const events = await get_json_with_session<{ dev_badge_labels: Record<string, string> }>('/api/events', owner.json.session_token);
	expect(events.json.dev_badge_labels['multiplayer:Badge_OSRS_Overhaul_Dev']).toBe('Overhaul Dev');
	await db_run("DELETE FROM service_settings WHERE key='dev-badge-label:osrs_overhaul_dev'");
});

test('authorizes hidden Dev accounts, persists per-message colors and retains 1.6.15 ordinary sends', async () => {
	const pair = await make_guildmates('Highlight Dev', 'Highlight Reader', 'Highlight Guild', { first: '1.6.16', second: '1.6.15' });
	const inbox = await get_json_with_session<any>('/api/chat/conversations', pair.first.session_token);
	const support = inbox.json.conversations.find((c: any) => c.conversation_kind === 'support');
	const base = { conversation_kind: 'private', conversation_id: null, client_id: pair.second_id,
		content: 'Colored message', idempotency_key: crypto.randomUUID(), highlight_color: '#aBc123' };
	expect((await post('/api/chat/messages/send', base, pair.second.session_token)).status).toBe(403);
	for (const id of [15, 12, 819]) {
		await db_run('UPDATE clients SET melvor_account_id = ?, dev_tag_visible = 0 WHERE id = ?', [id, pair.first_id]);
		const state = await get_json_with_session<any>('/api/chat/state', pair.first.session_token);
		expect(state.json.can_highlight).toBe(true);
		const sent = await post_json<any>('/api/chat/messages/send', { ...base, idempotency_key: crypto.randomUUID() }, pair.first.session_token);
		expect(sent.json.message.highlight_color).toBe('#ABC123');
	}
	await db_run('UPDATE clients SET client_identifier = ? WHERE id = ?', ['11111111-1111-4111-8111-111111111111', pair.first_id]);
	const poll = await post_json<any>('/api/polls/create?capabilities=polls-v1', {
		idempotency_key: crypto.randomUUID(), content: 'Highlighted discussion', options: ['Yes']
	}, pair.first.session_token);
	await db_run('INSERT INTO alliances(name,created_at) VALUES(?,?)', ['Highlight Alliance', Date.now()]);
	const [alliance] = await db_all<{ id: number }>('SELECT id FROM alliances WHERE name = ?', ['Highlight Alliance']);
	await db_run('INSERT INTO alliance_memberships(guild_id,alliance_id,joined_at) VALUES(?,?,?)', [pair.guild_id, alliance!.id, Date.now()]);
	const [other_guild] = await db_all<{ id: number }>('SELECT id FROM guilds WHERE id <> ? LIMIT 1', [pair.guild_id]);
	await db_run('INSERT INTO alliance_memberships(guild_id,alliance_id,joined_at) VALUES(?,?,?)', [other_guild!.id, alliance!.id, Date.now()]);
	const petition = await post_json<any>('/api/guilds/petitions/raise', { type: 'appellation', name: 'Highlight Renamed' }, pair.first.session_token);
	for (const kind of ['private', 'guild', 'alliance', 'global', 'testers', 'support', 'poll-discussion', 'petition-discussion']) {
		const capability = kind === 'global' ? 'global-chat-v1' : kind === 'poll-discussion' ? 'polls-v1' : 'guild-chat-v1';
		const endpoint = '/api/chat/messages/send?capabilities=' + capability;
		const payload = { ...base, conversation_kind: kind, idempotency_key: crypto.randomUUID(),
			conversation_id: kind === 'guild' ? pair.guild_id : ['global', 'testers'].includes(kind) ? 1 :
				kind === 'poll-discussion' ? poll.json.poll.poll_id : kind === 'alliance' ? alliance!.id :
				kind === 'petition-discussion' ? petition.json.petition_id : null, support_team_id: support.support_team_id };
		const sent = await post_json<any>(endpoint, payload, pair.first.session_token);
		expect({ kind, status: sent.response.status, success: sent.json.success, error: sent.json.error_lang }).toEqual({ kind, status: 200, success: true, error: undefined });
		expect(sent.json.message.highlight_color).toBe('#ABC123');
		const replay = await post_json<any>(endpoint, { ...payload, highlight_color: '#ABC123' }, pair.first.session_token);
		expect(replay.json.message.message_id).toBe(sent.json.message.message_id);
		for (const highlight_color of ['#FFFFFF', undefined])
			expect((await post(endpoint, { ...payload, highlight_color }, pair.first.session_token)).status).toBe(400);
		const history = await get_json_with_session<any>(`/api/chat/messages?conversation_kind=${kind}&conversation_id=${sent.json.message.conversation_id}&support_team_id=${support.support_team_id}&capabilities=${capability}`, pair.first.session_token);
		expect(history.json.messages.find((m: any) => m.message_id === sent.json.message.message_id).highlight_color).toBe('#ABC123');
		const plain = await post_json<any>(endpoint, { ...payload, highlight_color: undefined, idempotency_key: crypto.randomUUID() }, pair.first.session_token);
		expect(plain.json.success).toBe(true); expect(plain.json.message.highlight_color).toBeUndefined();
	}
	for (const color of ['#123', '#12345678', 'rgb(1,2,3)', 'red', '#zzzzzz', 123456, '#123456; color:red'])
		expect((await post('/api/chat/messages/send', { ...base, idempotency_key: crypto.randomUUID(), highlight_color: color }, pair.first.session_token)).status).toBe(400);
	const old_send = await post_json<any>('/api/chat/messages/send', {
		conversation_kind: 'private', conversation_id: null, client_id: pair.first_id,
		idempotency_key: crypto.randomUUID(), content: 'Normal 1.6.15 message'
	}, pair.second.session_token);
	expect(old_send.json.success).toBe(true); expect(old_send.json.message.highlight_color).toBeUndefined();
	const old_history = await get_json_with_session<any>(`/api/chat/messages?conversation_kind=private&conversation_id=${old_send.json.message.conversation_id}`, pair.second.session_token);
	expect(old_history.json.messages.some((m: any) => m.highlight_color === '#ABC123')).toBe(true);
});
