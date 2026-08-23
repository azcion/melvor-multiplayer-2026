import { describe, expect, test } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, request } from '../support/http';
import { db_count, db_run } from '../support/persistence';

type ActivityEvent = {
	id: number;
	event_type: string;
	actor_client_id: number | null;
	actor_display_name: string | null;
	metadata: Record<string, string | number>;
	created_at: number;
};

async function activity(session_token: string, cursor?: string) {
	return get_json_with_session<{ events: ActivityEvent[]; next_cursor: string | null }>(
		`/api/guilds/activity${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
		session_token
	);
}

describe('Guild Activity', () => {
	test('records membership transitions with historical name snapshots and Guild isolation', async () => {
		const pair = await make_guildmates('Activity Founder', 'Activity Member', 'Activity Guild');
		const outsider = await register_guild_client('Activity Outsider', 'Other Activity Guild');
		await db_run('UPDATE `clients` SET `display_name` = ? WHERE `id` = ?', ['Renamed Member', pair.second_id]);

		const feed = await activity(pair.second.session_token);
		const outsider_feed = await activity(outsider.session_token);

		expect(feed.response.status).toBe(200);
		expect(feed.json.events.map(event => [event.event_type, event.actor_display_name])).toEqual([
			['joined', 'Activity Member'],
			['campaign_started', null],
			['joined', 'Activity Founder']
		]);
		expect(outsider_feed.json.events).toHaveLength(2);
		expect(outsider_feed.json.events.find(event => event.event_type === 'joined')?.actor_display_name)
			.toBe('Activity Outsider');
	});

	test('returns stable newest-first twenty-row cursor pages and rejects malformed cursors', async () => {
		const client = await register_guild_client('Paged Activity', 'Paged Activity Guild');
		for (let index = 0; index < 25; index++)
			await db_run(
				'INSERT INTO `guild_activity_events` (`guild_id`, `event_type`, `source_key`, `created_at`) VALUES(?, ?, ?, ?)',
				[client.guild_id, 'campaign_started', `page:${index}`, 100 + Math.floor(index / 2)]
			);

		const first = await activity(client.session_token);
		expect(first.json.events).toHaveLength(20);
		expect(first.json.next_cursor).not.toBeNull();
		const second = await activity(client.session_token, first.json.next_cursor as string);
		expect(second.json.events).toHaveLength(7);
		expect(second.json.next_cursor).toBeNull();
		const ids = [...first.json.events, ...second.json.events].map(event => event.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect((await request('/api/guilds/activity?cursor=invalid', {
			headers: { 'X-Session-Token': client.session_token }
		})).status).toBe(400);
	});

	test('throttles noisy successful actions without suppressing their underlying mutations', async () => {
		const client = await register_guild_client('Activity Donor', 'Donation Guild');
		const first = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'melvorD:Logs', qty: 1 }], command_id: crypto.randomUUID()
		}, client.session_token);
		const second = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'melvorD:Logs', qty: 2 }], command_id: crypto.randomUUID()
		}, client.session_token);

		expect(first.json.success).toBe(true);
		expect(second.json.success).toBe(true);
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `guild_activity_events` WHERE `guild_id` = ? AND `event_type` = 'charitree_donated'",
			[client.guild_id]
		)).toBe(1);
	});
});
