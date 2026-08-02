import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';

type StatusSkill = { skill_id: string; level: number };
type StatusActivity =
	| { type: 'idle' }
	| { type: 'skill'; skill_id: string; action_id: string }
	| { type: 'combat'; area_id: string | null };

async function sync_status(
	session_token: string,
	skills: StatusSkill[],
	activity: StatusActivity
) {
	return post_json<{ success?: boolean; error_lang?: string }>(
		'/api/client/status/sync',
		{ skills, activity },
		session_token
	);
}

async function get_status(session_token: string, client_id: number) {
	return get_json_with_session<{
		client_id?: number;
		skills?: StatusSkill[];
		activity?: StatusActivity;
		error_lang?: string;
	}>(`/api/guilds/status?client_id=${client_id}`, session_token);
}

describe('player status API', () => {
	test('stores identity-owned skills and activity and exposes roster availability hints', async () => {
		const pair = await make_guildmates('Status Owner', 'Status Viewer');
		const skills = [
			{ skill_id: 'melvorD:Attack', level: 42 },
			{ skill_id: 'melvorD:Woodcutting', level: 18 }
		];
		const activity = { type: 'skill' as const, skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Oak' };

		const saved = await sync_status(pair.first.session_token, skills, activity);
		const viewed = await get_status(pair.second.session_token, pair.first_id);
		const state = await get_json_with_session<{
			members: Array<{
				client_id: number;
				status_visible: boolean;
				status_available: boolean;
				status_activity: StatusActivity | null;
			}>;
		}>('/api/guilds/state', pair.second.session_token);
		const owner = state.json.members.find(member => member.client_id === pair.first_id);

		expect(saved.json.success).toBe(true);
		expect(viewed.json).toEqual({
			client_id: pair.first_id,
			skills: [skills[0], skills[1]],
			activity
		});
		expect(owner).toMatchObject({
			status_visible: true,
			status_available: true,
			status_activity: activity
		});
	});

	test('includes only the minimal activity descriptor in the Free Fellowship directory', async () => {
		const [owner, viewer] = await Promise.all([
			register_client('Directory Status Owner'),
			register_client('Directory Status Viewer')
		]);
		await post_json('/api/guilds/join-free', {}, owner.session_token);
		await post_json('/api/guilds/join-free', {}, viewer.session_token);
		const activity = { type: 'combat' as const, area_id: 'melvorD:Volcanic_Cave' };
		await sync_status(owner.session_token, [], activity);

		const directory = await get_json_with_session<{
			members: Array<{ display_name: string; status_activity: StatusActivity | null }>;
		}>('/api/guilds/members?page=0&search=', viewer.session_token);
		const member = directory.json.members.find(candidate => candidate.display_name === owner.display_name);

		expect(directory.response.status).toBe(200);
		expect(member).toMatchObject({ status_activity: activity });
	});

	test('authorizes every read against current same-Guild membership', async () => {
		const pair = await make_guildmates('Private Status Owner', 'Former Status Viewer');
		const outsider = await register_client('Outside Status Viewer');
		await sync_status(pair.first.session_token, [], { type: 'idle' });

		const outside = await get_status(outsider.session_token, pair.first_id);
		await post_json('/api/guilds/leave', {}, pair.second.session_token);
		const former = await get_status(pair.second.session_token, pair.first_id);

		expect(outside.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
		expect(former.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
	});

	test('deletes a snapshot on opt-out and requires a new upload after opt-in', async () => {
		const pair = await make_guildmates('Status Visibility Owner', 'Status Visibility Viewer');
		await sync_status(pair.first.session_token, [
			{ skill_id: 'melvorD:Mining', level: 55 }
		], { type: 'combat', area_id: 'melvorD:Volcanic_Cave' });

		const disabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/status/visibility',
			{ visible: false },
			pair.first.session_token
		);
		const hidden = await get_status(pair.second.session_token, pair.first_id);
		const rejected_sync = await sync_status(pair.first.session_token, [], { type: 'idle' });
		const enabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/status/visibility',
			{ visible: true },
			pair.first.session_token
		);
		const missing = await get_status(pair.second.session_token, pair.first_id);

		expect(disabled.json).toEqual({ success: true, visible: false });
		expect(hidden.json.error_lang).toBe('MOD_MP_STATUS_SHARING_DISABLED');
		expect(rejected_sync.json.error_lang).toBe('MOD_MP_STATUS_SHARING_DISABLED');
		expect(enabled.json).toEqual({ success: true, visible: true });
		expect(missing.json.error_lang).toBe('MOD_MP_STATUS_NOT_AVAILABLE');
	});

	test('accepts idle and combat-without-area status and rejects malformed or oversized input', async () => {
		const owner = await register_client('Status Boundary Owner');
		const idle = await sync_status(owner.session_token, [], { type: 'idle' });
		const combat = await sync_status(owner.session_token, [], { type: 'combat', area_id: null });
		const duplicate = await post('/api/client/status/sync', {
			skills: [
				{ skill_id: 'melvorD:Attack', level: 1 },
				{ skill_id: 'melvorD:Attack', level: 2 }
			],
			activity: { type: 'idle' }
		}, owner.session_token);
		const malformed = await post('/api/client/status/sync', {
			skills: [{ skill_id: 'not-namespaced', level: 1 }],
			activity: { type: 'idle' }
		}, owner.session_token);
		const invalid_level = await post('/api/client/status/sync', {
			skills: [{ skill_id: 'melvorD:Attack', level: -1 }],
			activity: { type: 'idle' }
		}, owner.session_token);
		const too_many = await post('/api/client/status/sync', {
			skills: Array.from({ length: 65 }, (_, index) => ({
				skill_id: `test:Skill_${index}`,
				level: index
			})),
			activity: { type: 'idle' }
		}, owner.session_token);
		const invalid_activity = await post('/api/client/status/sync', {
			skills: [],
			activity: { type: 'skill', skill_id: 'melvorD:Attack' }
		}, owner.session_token);

		expect(idle.json.success).toBe(true);
		expect(combat.json.success).toBe(true);
		for (const response of [duplicate, malformed, invalid_level, too_many, invalid_activity])
			expect(response.status).toBe(400);
	});
});
