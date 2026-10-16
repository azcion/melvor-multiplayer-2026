import { expect, test } from 'bun:test';
import { make_guildmates, get_events } from '../support/fixtures';
import { get_json_with_session, get_with_session, post_json, register_client, request } from '../support/http';

test('page snapshots require authentication and expose only fixed owner-scoped read models', async () => {
	const pair = await make_guildmates('Snapshot Sender', 'Snapshot Recipient', 'Snapshot Guild', { first: '1.6.6', second: '1.6.5' });
	expect((await request('/api/pages/snapshot?page=transfers')).status).toBe(401);
	expect((await get_with_session('/api/pages/snapshot?page=invalid', pair.first.session_token)).status).toBe(400);
	await post_json('/api/gift/send', { recipient_id: pair.second_id, items: [{ id: 'melvorD:Coal_Ore', qty: 3 }] }, pair.first.session_token);
	const gift_id = (await get_events(pair.second)).gifts[0];
	await post_json('/api/gift/accept', { gift_id }, pair.second.session_token);
	const outsider = await register_client('Snapshot Outsider', undefined, '1.6.6');
	const isolated = (await get_json_with_session<{ data: Record<string, { entries: unknown[] }> }>('/api/pages/snapshot?page=transfers&client_id=' + pair.second_id, outsider.session_token)).json;
	expect(isolated.data['/api/transfers/history?pane=inbox']!.entries).toEqual([]);
	const received = (await get_json_with_session<{ data: Record<string, { entries: unknown[] }> }>('/api/pages/snapshot?page=transfers', pair.second.session_token)).json;
	expect(received.data['/api/transfers/history?pane=inbox']!.entries.length).toBeGreaterThan(0);
	const guildless = (await get_json_with_session<{ data: Record<string, unknown> }>('/api/pages/snapshot?page=guild', outsider.session_token)).json;
	expect(Object.keys(guildless.data)).toEqual(['/api/guilds/state', '/api/guilds/list']);
	for (const player of [pair.first, pair.second]) {
		for (const page of ['transfers', 'guild', 'decisions']) {
			const snapshot = (await get_json_with_session<{ data: Record<string, unknown> }>('/api/pages/snapshot?page=' + page, player.session_token)).json;
			expect(Object.keys(snapshot.data).length).toBeGreaterThan(0);
			for (const [route, value] of Object.entries(snapshot.data)) {
				if (route === '/api/alliances' && value && typeof value === 'object' && 'status' in value) {
					expect((await get_with_session(route, player.session_token)).status).toBe((value as { status: number }).status);
					continue;
				}
				const legacy = (await get_json_with_session<unknown>(route, player.session_token)).json;
				// Read models carry independently sampled server timestamps.
				const normalize = (input: unknown): unknown => JSON.parse(JSON.stringify(input, (key, v) => key === 'server_time' ? 0 : v));
				expect(normalize(value)).toEqual(normalize(legacy));
			}
		}
	}
});

test('1.6.14 active snapshots omit history while 1.6.13 defaults retain every pane', async () => {
	const player = await register_client('Loading Compatibility', undefined, '1.6.13');
	const legacy = (await get_json_with_session<{ data: Record<string, unknown> }>('/api/pages/snapshot?page=transfers', player.session_token)).json;
	expect(Object.keys(legacy.data)).toHaveLength(5);
	const active = (await get_json_with_session<{ data: Record<string, unknown> }>('/api/pages/snapshot?page=transfers&view=active', player.session_token)).json;
	expect(Object.keys(active.data)).toEqual(['/api/inbox', '/api/market/haggles']);
});

test('optional event summaries preserve legacy responses and detect Guild-only changes', async () => {
	const pair = await make_guildmates('Summary One', 'Summary Two', 'Summary Guild', { first: '1.6.14', second: '1.6.13' });
	const { db_run } = await import('../support/persistence');
	const legacy = (await get_json_with_session<Record<string, unknown>>('/api/events', pair.second.session_token)).json;
	expect(legacy).not.toHaveProperty('crucible_summary');
	expect(legacy).not.toHaveProperty('guild_revision');
	type Summary = { revision: number; guild_revision: number; unchanged?: boolean;
		crucible_summary: { is_open: boolean; offerings: unknown[]; wishes: unknown[] } };
	const first = (await get_json_with_session<Summary>('/api/events?summaries=1', pair.first.session_token)).json;
	expect(Number.isSafeInteger(first.guild_revision)).toBe(true);
	expect(Object.keys(first.crucible_summary).sort()).toEqual(['is_open', 'offerings', 'wishes']);
	await db_run("UPDATE page_revisions SET revision=revision+1 WHERE section='guild'");
	const changed = (await get_json_with_session<Summary>(`/api/events?summaries=1&revision=${first.revision}&guild_revision=${first.guild_revision}`, pair.first.session_token)).json;
	expect(changed.unchanged).not.toBe(true);
	expect(changed.guild_revision).toBeGreaterThan(first.guild_revision);
	const compact = (await get_json_with_session<Summary>(`/api/events?summaries=1&revision=${changed.revision}&guild_revision=${changed.guild_revision}`, pair.first.session_token)).json;
	expect(compact.unchanged).toBe(true);
	expect(compact.crucible_summary).toBeDefined();
});
