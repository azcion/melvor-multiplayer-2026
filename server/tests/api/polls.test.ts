import { describe, expect, test } from 'bun:test';
import { get_json_with_session, get_with_session, post, post_json, register_client } from '../support/http';
import { db_run } from '../support/persistence';

const capability = 'capabilities=polls-v1';

describe('Polls Chat', () => {
	test('gates the capability and restricts creation to configured identities', async () => {
		const ordinary = await register_client('Poll Reader');
		expect((await post('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Nope?', options: ['No']
		}, ordinary.session_token)).status).toBe(403);
		expect((await get_with_session('/api/polls', ordinary.session_token)).status).toBe(404);
	});

	test('supports multi-select aggregates, append-only options, reactions, and discussion', async () => {
		const creator = await register_client('Briar Test');
		const voter = await register_client('Poll Voter');
		await db_run('UPDATE `clients` SET `client_identifier` = ? WHERE `id` = ?',
			['11111111-1111-4111-8111-111111111111', creator.client_id]);
		const created = await post_json<{ success: boolean; poll: any }>('/api/polls/create?' + capability, {
			idempotency_key: crypto.randomUUID(), content: 'Choose any that apply', options: ['One', 'Two']
		}, creator.session_token);
		expect(created.response.status).toBe(200);
		expect(created.json.poll.options).toHaveLength(2);
		const poll_id = created.json.poll.poll_id;
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
		const appended = await post_json<{ success: boolean; poll: any }>('/api/polls/options?' + capability,
			{ poll_id, options: ['Three'] }, creator.session_token);
		expect(appended.json.poll.options.map((option: any) => option.content)).toEqual(['One', 'Two', 'Three']);
		const reaction = await post_json<{ success: boolean; poll: any }>('/api/polls/reaction?' + capability,
			{ poll_id, reaction: '👍', reacted: true }, voter.session_token);
		expect(reaction.json.poll.reactions).toEqual([{ reaction: '👍', count: 1, reacted: true }]);
		const sent = await post_json<{ success: boolean; message: any }>('/api/chat/messages/send?' + capability, {
			conversation_kind: 'poll-discussion', conversation_id: poll_id,
			idempotency_key: crypto.randomUUID(), content: 'Why I voted this way'
		}, voter.session_token);
		expect(sent.json.success).toBe(true);
		const discussion = await get_json_with_session<{ messages: any[] }>(
			`/api/chat/messages?conversation_kind=poll-discussion&conversation_id=${poll_id}&${capability}`,
			creator.session_token);
		expect(discussion.json.messages[0].content).toBe('Why I voted this way');
	});
});
