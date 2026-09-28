import { describe, expect, test } from 'bun:test';
import { get_json_with_session, get_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

const capability = 'capabilities=polls-v1';

describe('Polls Chat', () => {
	test('restricts Poll administration to configured identities', async () => {
		const supported = await register_client('Poll Reader', undefined, '1.5.16');
		const visible = await get_json_with_session<{ polls: unknown[]; can_create: boolean }>(
			'/api/polls?' + capability, supported.session_token);
		expect(visible.json).toMatchObject({ polls: [], can_create: false });
		expect((await post('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Still nope?', options: ['No']
		}, supported.session_token)).status).toBe(403);
		const admin = await register_client('Poll Admin', undefined, '1.5.17');
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['RESTART-ADMIN-POLL', admin.client_id]);
		const admin_view = await get_json_with_session<{ can_create: boolean }>(
			'/api/polls?' + capability, admin.session_token);
		expect(admin_view.json.can_create).toBe(true);
	});

	test('supports multi-select aggregates, append-only options, and discussion', async () => {
		const creator = await register_client('Briar Test', {
			cloud_username: 'PollObserver', playfab_id: 'POLL-OBSERVER'
		}, '1.5.16');
		const voter = await register_client('Poll Voter', {
			cloud_username: 'PollShadowSender', playfab_id: 'POLL-SHADOW-SENDER'
		}, '1.5.16');
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['11111111-1111-4111-8111-111111111111', creator.client_id]);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['22222222-2222-4222-8222-222222222222', voter.client_id]);
		const created = await post_json<{ success: boolean; poll: any }>('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Choose any that apply', options: ['One', 'Two'], choice_mode: 'multi'
		}, creator.session_token);
		expect(created.response.status).toBe(200);
		expect(created.json.poll).toMatchObject({
			choice_mode: 'multi', open: true, can_edit: true, can_delete: true, can_manage: true
		});
		expect(created.json.poll.options).toHaveLength(2);
		const poll_id = created.json.poll.poll_id;
		const option_ids = created.json.poll.options.map((option: any) => option.option_id);
		const translation_jobs = await db_all<{ id: number; source_kind: string; content_id: number }>(
			'SELECT `id`, `source_kind`, `content_id` FROM `poll_translation_jobs` ' +
			'WHERE (`source_kind` = ? AND `content_id` = ?) OR (`source_kind` = ? AND `content_id` IN (?, ?)) ORDER BY `id`',
			['poll', poll_id, 'poll-option', option_ids[0], option_ids[1]]);
		expect(translation_jobs.map(job => job.source_kind)).toEqual(['poll', 'poll-option', 'poll-option']);
		for (const job of translation_jobs) {
			const content = job.source_kind === 'poll' ? '选择所有适用项' : job.content_id === option_ids[0] ? '一' : '二';
			await db_run('INSERT INTO `poll_translations` (`job_id`, `language`, `content`, `translated_at`) VALUES (?, ?, ?, ?)',
				[job.id, 'zh-CN', content, Date.now()]);
			await db_run("UPDATE `poll_translation_jobs` SET `state` = 'complete' WHERE `id` = ?", [job.id]);
		}
		const translated = await get_json_with_session<{ polls: any[] }>('/api/polls?' + capability, voter.session_token);
		expect(translated.json.polls[0].translations['zh-CN']).toBe('选择所有适用项');
		expect(translated.json.polls[0].options.map((option: any) => option.translations['zh-CN'])).toEqual(['一', '二']);
		for (const option of created.json.poll.options) {
			const vote = await post_json<{ success: boolean; poll: any }>('/api/polls/vote?' + capability, {
				poll_id, option_id: option.option_id, selected: true
			}, voter.session_token);
			expect(vote.json.success).toBe(true);
			await Bun.sleep(360);
		}
		const aggregate = await get_json_with_session<{ polls: any[] }>('/api/polls?' + capability, creator.session_token);
		expect(aggregate.json.polls[0].options.map((option: any) => option.vote_count)).toEqual([1, 1]);
		expect(aggregate.json.polls[0].options.every((option: any) => option.selected === false)).toBe(true);
		expect(aggregate.json.polls[0].interacted).toBe(false);
		await Bun.sleep(360);
		const retracted = await post_json<{ success: boolean; poll: any }>('/api/polls/vote?' + capability, {
			poll_id, option_id: created.json.poll.options[0].option_id, selected: false
		}, voter.session_token);
		expect(retracted.json.poll.interacted).toBe(true);
		expect(retracted.json.poll.options[0].selected).toBe(false);
		const voter_view = await get_json_with_session<{ polls: any[] }>('/api/polls?' + capability, voter.session_token);
		expect(voter_view.json.polls[0].interacted).toBe(true);
		await db_run('UPDATE `polls` SET `creator_id` = ? WHERE `id` = ?', [voter.client_id, poll_id]);
		const appended = await post_json<{ success: boolean; poll: any }>('/api/polls/options?' + capability,
			{ poll_id, options: ['Three'] }, creator.session_token);
		expect(appended.json.poll.options.map((option: any) => option.content)).toEqual(['One', 'Two', 'Three']);
		await db_run(
			'UPDATE `melvor_accounts` SET `chat_shadowbanned` = 1 WHERE `id` = ' +
			'(SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?)', [voter.client_id]
		);
		const sent = await post_json<{ success: boolean; message: any }>('/api/chat/messages/send?' + capability, {
			conversation_kind: 'poll-discussion', conversation_id: poll_id,
			idempotency_key: crypto.randomUUID(), content: 'Why I voted this way'
		}, voter.session_token);
		expect(sent.json.success).toBe(true);
		const discussion = await get_json_with_session<{ messages: any[] }>(
			`/api/chat/messages?conversation_kind=poll-discussion&conversation_id=${poll_id}&${capability}`,
			creator.session_token);
		expect(discussion.json.messages).toEqual([]);
		await db_run(
			'INSERT INTO `chat_shadow_observers` (`observer_account_id`, `granted_at`) ' +
			'SELECT `melvor_account_id`, ? FROM `clients` WHERE `id` = ?', [Date.now(), creator.client_id]
		);
		const observed_discussion = await get_json_with_session<{ messages: any[] }>(
			`/api/chat/messages?conversation_kind=poll-discussion&conversation_id=${poll_id}&${capability}`,
			creator.session_token);
		expect(observed_discussion.json.messages[0].content).toBe('Why I voted this way');
		const discussion_message_id = observed_discussion.json.messages[0].message_id;
		const compatible_reaction = await post_json<{ success: boolean; reactions: any[] }>(
			'/api/chat/messages/reaction', {
				conversation_kind: 'poll-discussion', conversation_id: poll_id,
				message_id: discussion_message_id, reaction: '💯', reacted: true
			}, voter.session_token);
		expect(compatible_reaction.response.status).toBe(200);
		expect(compatible_reaction.json).toMatchObject({
			success: true, reactions: [{ reaction: '💯', count: 1, reacted: true }]
		});
		const reader = await register_client('Poll Reader Two', undefined, '1.5.16');
		const visible = await get_json_with_session<{ polls: unknown[] }>('/api/polls?' + capability, reader.session_token);
		expect(visible.json.polls).toHaveLength(1);
		expect((await post('/api/polls/reaction?' + capability, {
			poll_id, reaction: '👍', reacted: true
		}, voter.session_token)).status).toBe(404);
		expect((await get_with_session(
			`/api/chat/messages?conversation_kind=poll-discussion&conversation_id=${poll_id}&${capability}`,
			reader.session_token
		)).status).toBe(200);
	});

	test('supports single-choice voting and administrator-controlled voting status without closing discussion', async () => {
		const creator = await register_client('Single Poll Creator', undefined, '1.5.16');
		const voter = await register_client('Single Poll Voter', undefined, '1.5.16');
		await db_run("UPDATE `clients` SET `client_identifier` = 'retired-' || `id` WHERE `client_identifier` IN (?, ?)",
			['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['11111111-1111-4111-8111-111111111111', creator.client_id]);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['22222222-2222-4222-8222-222222222222', voter.client_id]);
		const created = await post_json<{ success: boolean; poll: any }>('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Choose one', options: ['One', 'Two'], choice_mode: 'single'
		}, creator.session_token);
		const poll_id = created.json.poll.poll_id;
		const [first, second] = created.json.poll.options;
		expect(created.json.poll.choice_mode).toBe('single');
		expect((await post_json<any>('/api/polls/vote?' + capability,
			{ poll_id, option_id: first.option_id, selected: true }, voter.session_token)).json.success).toBe(true);
		await Bun.sleep(360);
		const switched = await post_json<{ poll: any }>('/api/polls/vote?' + capability,
			{ poll_id, option_id: second.option_id, selected: true }, voter.session_token);
		expect(switched.json.poll.options.map((option: any) => option.selected)).toEqual([false, true]);

		expect((await post('/api/polls/status?' + capability, { poll_id, open: false }, voter.session_token)).status).toBe(403);
		const closed = await post_json<{ poll: any }>('/api/polls/status?' + capability,
			{ poll_id, open: false }, creator.session_token);
		expect(closed.json.poll).toMatchObject({ open: false, can_manage: true, choice_mode: 'single' });
		await Bun.sleep(360);
		expect((await post('/api/polls/vote?' + capability,
			{ poll_id, option_id: first.option_id, selected: true }, voter.session_token)).status).toBe(403);
		const sent = await post_json<{ success: boolean }>('/api/chat/messages/send?' + capability, {
			conversation_kind: 'poll-discussion', conversation_id: poll_id,
			idempotency_key: crypto.randomUUID(), content: 'Discussion stays open'
		}, voter.session_token);
		expect(sent.json.success).toBe(true);
		const reopened = await post_json<{ poll: any }>('/api/polls/status?' + capability,
			{ poll_id, open: true }, creator.session_token);
		expect(reopened.json.poll.open).toBe(true);
	});

	test('shares selections, interaction state, and throttling across linked sibling characters', async () => {
		const creator = await register_client('Account Poll Creator', undefined, '1.5.16');
		const account = { cloud_username: 'Poll Account', playfab_id: crypto.randomUUID() };
		const first_sibling = await register_client('Account Poll One', account, '1.5.16');
		const second_sibling = await register_client('Account Poll Two', account, '1.5.16');
		await db_run("UPDATE `clients` SET `client_identifier` = 'retired-' || `id` WHERE `client_identifier` = ?",
			['11111111-1111-4111-8111-111111111111']);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['11111111-1111-4111-8111-111111111111', creator.client_id]);
		const created = await post_json<{ poll: any }>('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'One vote per account?', options: ['One', 'Two'], choice_mode: 'single'
		}, creator.session_token);
		const poll_id = created.json.poll.poll_id;
		const [first, second] = created.json.poll.options;

		const initial = await post_json<{ success: boolean; poll: any }>('/api/polls/vote?' + capability,
			{ poll_id, option_id: first.option_id, selected: true }, first_sibling.session_token);
		expect(initial.json.success).toBe(true);
		const sibling_view = await get_json_with_session<{ polls: any[] }>('/api/polls?' + capability, second_sibling.session_token);
		expect(sibling_view.json.polls.find(poll => poll.poll_id === poll_id)).toMatchObject({
			interacted: true,
			options: [
				{ option_id: first.option_id, vote_count: 1, selected: true },
				{ option_id: second.option_id, vote_count: 0, selected: false }
			]
		});

		const throttled = await post_json<{ success: boolean; retry_after_ms: number }>('/api/polls/vote?' + capability,
			{ poll_id, option_id: second.option_id, selected: true }, second_sibling.session_token);
		expect(throttled.json.success).toBe(false);
		expect(throttled.json.retry_after_ms).toBeGreaterThan(0);
		await Bun.sleep(360);
		const switched = await post_json<{ success: boolean; poll: any }>('/api/polls/vote?' + capability,
			{ poll_id, option_id: second.option_id, selected: true }, second_sibling.session_token);
		expect(switched.json.poll.options.map((option: any) => [option.vote_count, option.selected]))
			.toEqual([[0, false], [1, true]]);

		const account_id = (await db_all<{ id: number }>(
			'SELECT `id` FROM `melvor_accounts` WHERE `playfab_id` = ?', [account.playfab_id]
		))[0].id;
		expect(await db_all<{ owner_key: string; client_id: number }>(
			'SELECT `owner_key`, `client_id` FROM `poll_votes` WHERE `poll_id` = ?', [poll_id]
		)).toEqual([{ owner_key: `account:${account_id}`, client_id: second_sibling.client_id }]);
		expect((await db_all<{ count: number }>(
			'SELECT COUNT(*) AS `count` FROM `poll_interactions` WHERE `poll_id` = ?', [poll_id]
		))[0].count).toBe(1);
		expect((await db_all<{ count: number }>(
			'SELECT COUNT(*) AS `count` FROM `poll_vote_throttles` WHERE `poll_id` = ?', [poll_id]
		))[0].count).toBe(1);
	});

	test('moves a legacy character Poll state into its account when the character becomes linked', async () => {
		const creator = await register_client('Legacy Poll Creator', undefined, '1.5.16');
		const legacy = await register_client('Legacy Poll Voter', undefined, '1.5.16');
		const account = { cloud_username: 'Legacy Poll Account', playfab_id: crypto.randomUUID() };
		const sibling = await register_client('Linked Poll Sibling', account, '1.5.16');
		await db_run("UPDATE `clients` SET `client_identifier` = 'retired-' || `id` WHERE `client_identifier` = ?",
			['11111111-1111-4111-8111-111111111111']);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['11111111-1111-4111-8111-111111111111', creator.client_id]);
		const created = await post_json<{ poll: any }>('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Merge legacy choices?', options: ['One', 'Two'], choice_mode: 'multi'
		}, creator.session_token);
		const poll_id = created.json.poll.poll_id;
		const [first, second] = created.json.poll.options;
		await post_json('/api/polls/vote?' + capability,
			{ poll_id, option_id: first.option_id, selected: true }, legacy.session_token);
		await post_json('/api/polls/vote?' + capability,
			{ poll_id, option_id: second.option_id, selected: true }, sibling.session_token);

		const associated = await post_json<{ session_token?: string }>('/api/authenticate', {
			client_identifier: legacy.client_identifier,
			client_key: legacy.client_key,
			...account
		});
		expect(associated.response.status).toBe(200);
		const merged = await get_json_with_session<{ polls: any[] }>('/api/polls?' + capability, sibling.session_token);
		expect(merged.json.polls.find(poll => poll.poll_id === poll_id)).toMatchObject({
			interacted: true,
			options: [
				{ option_id: first.option_id, vote_count: 1, selected: true },
				{ option_id: second.option_id, vote_count: 1, selected: true }
			]
		});
		expect((await db_all<{ count: number }>(
			'SELECT COUNT(DISTINCT `owner_key`) AS `count` FROM `poll_votes` WHERE `poll_id` = ?', [poll_id]
		))[0].count).toBe(1);
	});

	test('lets the authorized administrator delete a published poll and publishes the deletion', async () => {
		const creator = await register_client('Briar Delete Test', undefined, '1.5.16');
		const voter = await register_client('Poll Delete Voter', undefined, '1.5.16');
		await db_run("UPDATE `clients` SET `client_identifier` = 'retired-' || `id` WHERE `client_identifier` IN (?, ?, ?)",
			['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['11111111-1111-4111-8111-111111111111', creator.client_id]);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['22222222-2222-4222-8222-222222222222', voter.client_id]);
		const created = await post_json<{ success: boolean; poll: any }>('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Delete this after publishing?', options: ['Yes', 'No']
		}, creator.session_token);
		const poll_id = created.json.poll.poll_id;
		await db_run('UPDATE `polls` SET `creator_id` = ? WHERE `id` = ?', [voter.client_id, poll_id]);
		const discussion = await post_json<{ success: boolean }>('/api/chat/messages/send?' + capability, {
			conversation_kind: 'poll-discussion', conversation_id: poll_id,
			idempotency_key: crypto.randomUUID(), content: 'A discussion message'
		}, voter.session_token);
		expect(discussion.json.success).toBe(true);
		const before = await get_json_with_session<{ revision: number; polls: any[] }>('/api/polls?' + capability, creator.session_token);
		expect(before.json.polls.find(poll => poll.poll_id === poll_id)).toMatchObject({ can_delete: true });

		expect((await post('/api/polls/delete?' + capability, { poll_id }, voter.session_token)).status).toBe(403);
		const deleted = await post_json<{ success: boolean; deleted: boolean; poll_id: number; revision: number }>(
			'/api/polls/delete?' + capability, { poll_id }, creator.session_token);
		expect(deleted.response.status).toBe(200);
		expect(deleted.json).toMatchObject({ success: true, deleted: true, poll_id });
		expect(deleted.json.revision).toBeGreaterThan(before.json.revision);

		const delta = await get_json_with_session<{ polls: any[]; deleted_poll_ids: number[] }>(
			`/api/polls?${capability}&after=${before.json.revision}`, voter.session_token);
		expect(delta.json.polls.some(poll => poll.poll_id === poll_id)).toBe(false);
		expect(delta.json.deleted_poll_ids).toContain(poll_id);
		for (const [table, condition] of [['poll_options', '`poll_id` = ?'], ['poll_votes', '`poll_id` = ?'],
			['poll_interactions', '`poll_id` = ?'],
			['poll_vote_throttles', '`poll_id` = ?'], ['poll_discussion_messages', '`poll_id` = ?'],
			['poll_translation_jobs', "`source_kind` = 'poll' AND `content_id` = ?"]] as const) {
			const rows = await db_all<{ count: number }>(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE ${condition}`, [poll_id]);
			expect(rows[0].count).toBe(0);
		}
		expect((await post('/api/polls/delete?' + capability, { poll_id }, creator.session_token)).status).toBe(404);
	});

	test('keeps discussion unread counts on Poll cards for 1.6.0 clients', async () => {
		const creator = await register_client('Unread Poll Creator', undefined, '1.6.0');
		const reader = await register_client('Unread Poll Reader', undefined, '1.6.0');
		const older = await register_client('Older Poll Reader', undefined, '1.5.16');
		await db_run("UPDATE `clients` SET `client_identifier` = 'retired-' || `id` WHERE `client_identifier` = ?",
			['11111111-1111-4111-8111-111111111111']);
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['11111111-1111-4111-8111-111111111111', creator.client_id]);
		const created = await post_json<{ poll: { poll_id: number } }>('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Unread discussion?', options: ['Yes']
		}, creator.session_token);
		const poll_id = created.json.poll.poll_id;
		const initial = await get_json_with_session<{ revision: number; discussion_unread_counts: Record<number, number> }>(
			'/api/polls?' + capability, reader.session_token);
		expect(initial.json.discussion_unread_counts[poll_id]).toBeUndefined();
		for (const content of ['First reply', 'Second reply']) {
			const sent = await post_json<{ success: boolean }>('/api/chat/messages/send?' + capability, {
				conversation_kind: 'poll-discussion', conversation_id: poll_id,
				idempotency_key: crypto.randomUUID(), content
			}, creator.session_token);
			expect(sent.json.success).toBe(true);
		}
		const incremental = await get_json_with_session<{ polls: unknown[]; discussion_unread_counts: Record<number, number> }>(
			`/api/polls?${capability}&after=${initial.json.revision}`, reader.session_token);
		expect(incremental.json.polls).toEqual([]);
		expect(incremental.json.discussion_unread_counts[poll_id]).toBe(2);
		const own_view = await get_json_with_session<{ discussion_unread_counts: Record<number, number> }>(
			'/api/polls?' + capability, creator.session_token);
		expect(own_view.json.discussion_unread_counts[poll_id]).toBeUndefined();
		const old_view = await get_json_with_session<{ discussion_unread_counts?: Record<number, number> }>(
			'/api/polls?' + capability, older.session_token);
		expect(old_view.json.discussion_unread_counts).toBeUndefined();
		const discussion_url = `/api/chat/messages?conversation_kind=poll-discussion&conversation_id=${poll_id}&${capability}`;
		const opened = await get_json_with_session<{ messages: unknown[] }>(discussion_url, reader.session_token);
		expect(opened.json.messages).toHaveLength(2);
		const read_view = await get_json_with_session<{ discussion_unread_counts: Record<number, number> }>(
			'/api/polls?' + capability, reader.session_token);
		expect(read_view.json.discussion_unread_counts[poll_id]).toBeUndefined();
		await get_with_session(discussion_url, older.session_token);
		const old_read_state = await db_all<{ client_id: number }>(
			'SELECT `client_id` FROM `poll_discussion_read_state` WHERE `poll_id` = ?', [poll_id]);
		expect(old_read_state.map(row => row.client_id)).toEqual([reader.client_id]);
	});
});
