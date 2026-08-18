import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

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

	test('accepts partial updates without replacing the omitted status portion', async () => {
		const pair = await make_guildmates('Partial Status Owner', 'Partial Status Viewer');
		const skills = [{ skill_id: 'melvorD:Attack', level: 42 }];
		await sync_status(pair.first.session_token, skills, {
			type: 'skill', skill_id: 'melvorD:Woodcutting', action_id: 'melvorD:Oak'
		});
		const activity_only = await post_json<{ success: boolean }>('/api/client/status/sync', {
			activity: { type: 'combat', area_id: 'melvorD:Volcanic_Cave' }
		}, pair.first.session_token);
		const after_activity = await get_status(pair.second.session_token, pair.first_id);
		const skills_only = await post_json<{ success: boolean }>('/api/client/status/sync', {
			skills: [{ skill_id: 'melvorD:Attack', level: 43 }]
		}, pair.first.session_token);
		const after_skills = await get_status(pair.second.session_token, pair.first_id);
		const empty = await post('/api/client/status/sync', {}, pair.first.session_token);

		expect(activity_only.json.success).toBe(true);
		expect(after_activity.json.skills).toEqual(skills);
		expect(after_activity.json.activity).toEqual({ type: 'combat', area_id: 'melvorD:Volcanic_Cave' });
		expect(skills_only.json.success).toBe(true);
		expect(after_skills.json.skills).toEqual([{ skill_id: 'melvorD:Attack', level: 43 }]);
		expect(after_skills.json.activity).toEqual({ type: 'combat', area_id: 'melvorD:Volcanic_Cave' });
		expect(empty.status).toBe(400);
	});

	test('shares raw GP and authenticated last-seen activity with current Guild members', async () => {
		const pair = await make_guildmates('GP Owner', 'GP Viewer');
		const last_seen_at = 1_800_000_000_000;
		await post_json('/api/client/status/sync', { gp: 142_609 }, pair.first.session_token);
		await db_run('UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` = ?', [
			last_seen_at,
			pair.first_id
		]);

		const state = await get_json_with_session<{
			members: Array<{
				client_id: number;
				gp_visible: boolean;
				gp: number | null;
				last_seen_at: number | null;
			}>;
		}>('/api/guilds/state', pair.second.session_token);
		const owner = state.json.members.find(member => member.client_id === pair.first_id);

		expect(owner).toMatchObject({
			gp_visible: true,
			gp: 142_609,
			last_seen_at
		});
	});

	test('defaults GP sharing on and deletes the snapshot on opt-out', async () => {
		const pair = await make_guildmates('GP Visibility Owner', 'GP Visibility Viewer');
		await post_json('/api/client/status/sync', { gp: 50_000 }, pair.first.session_token);

		const disabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/gp/visibility',
			{ visible: false },
			pair.first.session_token
		);
		const hidden_state = await get_json_with_session<{
			members: Array<{ client_id: number; gp_visible: boolean; gp: number | null }>;
		}>('/api/guilds/state', pair.second.session_token);
		const rejected = await post_json<{ error_lang: string }>(
			'/api/client/status/sync',
			{ gp: 60_000 },
			pair.first.session_token
		);
		const enabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/gp/visibility',
			{ visible: true },
			pair.first.session_token
		);
		const hidden_owner = hidden_state.json.members.find(member => member.client_id === pair.first_id);

		expect(disabled.json).toEqual({ success: true, visible: false });
		expect(hidden_owner).toMatchObject({ gp_visible: false, gp: null });
		expect(rejected.json.error_lang).toBe('MOD_MP_GP_SHARING_DISABLED');
		expect(enabled.json).toEqual({ success: true, visible: true });
	});

	test('shares the latest game mode by default and preserves the runtime snapshot on opt-out', async () => {
		const pair = await make_guildmates('Mode Visibility Owner', 'Mode Visibility Viewer');
		await db_run(
			'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `game_mode_id`, `reported_at`) ' +
			'VALUES(?, ?, ?, ?, ?)',
			[pair.first_id, '1.3.0', '[]', 'melvorF:Adventure', Date.now()]
		);

		const shared_state = await get_json_with_session<{
			members: Array<{ client_id: number; game_mode_visible: boolean; game_mode_id: string | null }>;
		}>('/api/guilds/state', pair.second.session_token);
		const disabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/game-mode/visibility',
			{ visible: false },
			pair.first.session_token
		);
		const hidden_state = await get_json_with_session<{
			members: Array<{ client_id: number; game_mode_visible: boolean; game_mode_id: string | null }>;
		}>('/api/guilds/state', pair.second.session_token);
		const malformed = await post('/api/client/game-mode/visibility', { visible: 'yes' }, pair.first.session_token);
		const snapshots = await db_all<{ game_mode_id: string | null }>(
			'SELECT `game_mode_id` FROM `client_runtime_snapshots` WHERE `client_id` = ?',
			[pair.first_id]
		);
		const authenticated = await post_json<{ game_mode_visible: boolean }>('/api/authenticate', {
			client_identifier: pair.first.client_identifier,
			client_key: pair.first.client_key
		});

		expect(shared_state.json.members.find(member => member.client_id === pair.first_id)).toMatchObject({
			game_mode_visible: true,
			game_mode_id: 'melvorF:Adventure'
		});
		expect(disabled.json).toEqual({ success: true, visible: false });
		expect(hidden_state.json.members.find(member => member.client_id === pair.first_id)).toMatchObject({
			game_mode_visible: false,
			game_mode_id: null
		});
		expect(malformed.status).toBe(400);
		expect(snapshots).toEqual([{ game_mode_id: 'melvorF:Adventure' }]);
		expect(authenticated.json.game_mode_visible).toBe(false);
	});

	test('shares active mods in reported order by default and preserves the runtime snapshot on opt-out', async () => {
		const pair = await make_guildmates('Active Mods Owner', 'Active Mods Viewer');
		const outsider = await register_client('Active Mods Outsider');
		const active_mods = ['Multiplayer', 'Combat Indicators', 'Bank Tab Values'];
		await db_run(
			'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `reported_at`) ' +
			'VALUES(?, ?, ?, ?)',
			[pair.first_id, '1.3.0', JSON.stringify(active_mods), Date.now()]
		);

		const shared_state = await get_json_with_session<{
			members: Array<{ client_id: number; active_mods_visible: boolean; active_mods_available: boolean }>;
		}>('/api/guilds/state', pair.second.session_token);
		const shared = await get_json_with_session<{ client_id: number; active_mods: string[] }>(
			`/api/guilds/active-mods?client_id=${pair.first_id}`,
			pair.second.session_token
		);
		const outside = await get_json_with_session<{ error_lang: string }>(
			`/api/guilds/active-mods?client_id=${pair.first_id}`,
			outsider.session_token
		);
		const disabled = await post_json<{ success: boolean; visible: boolean }>(
			'/api/client/active-mods/visibility',
			{ visible: false },
			pair.first.session_token
		);
		const hidden_state = await get_json_with_session<{
			members: Array<{ client_id: number; active_mods_visible: boolean; active_mods_available: boolean }>;
		}>('/api/guilds/state', pair.second.session_token);
		const hidden = await get_json_with_session<{ error_lang: string }>(
			`/api/guilds/active-mods?client_id=${pair.first_id}`,
			pair.second.session_token
		);
		const snapshots = await db_all<{ active_mods: string }>(
			'SELECT `active_mods` FROM `client_runtime_snapshots` WHERE `client_id` = ?',
			[pair.first_id]
		);
		const authenticated = await post_json<{ active_mods_visible: boolean }>('/api/authenticate', {
			client_identifier: pair.first.client_identifier,
			client_key: pair.first.client_key
		});

		expect(shared_state.json.members.find(member => member.client_id === pair.first_id)).toMatchObject({
			active_mods_visible: true,
			active_mods_available: true
		});
		expect(shared.json).toEqual({ client_id: pair.first_id, active_mods });
		expect(outside.json.error_lang).toBe('MOD_MP_GUILD_MEMBERSHIP_MISSING');
		expect(disabled.json).toEqual({ success: true, visible: false });
		expect(hidden_state.json.members.find(member => member.client_id === pair.first_id)).toMatchObject({
			active_mods_visible: false,
			active_mods_available: false
		});
		expect(hidden.json.error_lang).toBe('MOD_MP_ACTIVE_MODS_SHARING_DISABLED');
		expect(snapshots).toEqual([{ active_mods: JSON.stringify(active_mods) }]);
		expect(authenticated.json.active_mods_visible).toBe(false);
	});

	test('does not offer an active-mod list when no non-empty runtime snapshot exists', async () => {
		const pair = await make_guildmates('Empty Active Mods Owner', 'Empty Active Mods Viewer');
		await db_run(
			'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `reported_at`) ' +
			'VALUES(?, ?, ?, ?)',
			[pair.first_id, '1.3.0', '[]', Date.now()]
		);

		const state = await get_json_with_session<{
			members: Array<{ client_id: number; active_mods_visible: boolean; active_mods_available: boolean }>;
		}>('/api/guilds/state', pair.second.session_token);
		const viewed = await get_json_with_session<{ error_lang: string }>(
			`/api/guilds/active-mods?client_id=${pair.first_id}`,
			pair.second.session_token
		);

		expect(state.json.members.find(member => member.client_id === pair.first_id)).toMatchObject({
			active_mods_visible: true,
			active_mods_available: false
		});
		expect(viewed.json.error_lang).toBe('MOD_MP_ACTIVE_MODS_NOT_AVAILABLE');
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
			members: Array<{ client_id: number; display_name: string; status_activity: StatusActivity | null }>;
		}>('/api/guilds/members?page=0&search=', viewer.session_token);
		const member = directory.json.members.find(candidate => candidate.client_id === owner.client_id);

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
		const invalid_gp = await post('/api/client/status/sync', { gp: Number.MAX_SAFE_INTEGER + 1 }, owner.session_token);

		expect(idle.json.success).toBe(true);
		expect(combat.json.success).toBe(true);
		for (const response of [duplicate, malformed, invalid_level, too_many, invalid_activity, invalid_gp])
			expect(response.status).toBe(400);
	});
});
