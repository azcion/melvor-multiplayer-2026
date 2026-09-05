import { describe, expect, test } from 'bun:test';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { attach_to_free_fellowship, make_guild_group, make_guildmates, register_guild_client } from '../support/fixtures';
import { db_count, db_run } from '../support/persistence';
import { SHADOWED_AFTER } from '../../shadowed';
import { RAID_VICTORY_CACHE } from '../../raid';

type RaidState = {
	affiliation: string;
	can_activate?: boolean;
	cache_pending: boolean;
	raid?: {
		raid_id: number;
		secured: boolean;
		remaining_health: number;
		active_member_count: number;
		required_contributors: number;
		member: { assaults: number; contribution: number; successful_assaults: number } | null;
		leaderboard: Array<{ client_id: number; highest_tier: number; contribution: number; successful_assaults: number }>;
	};
};

type Reservation = {
	success?: boolean;
	assault_id: string;
	settlement_key: string;
	tier: number;
	combat_deadline: number;
	test_occurred_at?: number;
};

async function reserve(session_token: string, tier = 4): Promise<Reservation> {
	const { response, json } = await post_json<Reservation>('/api/raids/assaults/reserve', {
		tier,
		loaded_session_id: crypto.randomUUID()
	}, session_token);
	expect(response.status).toBe(200);
	return json;
}

async function settle(session_token: string, assault: Reservation, outcome = 'success') {
	assault.test_occurred_at ??= Math.min(Date.now(), assault.combat_deadline);
	return post_json<{
		success: boolean;
		credited_progress: number;
		idempotent: boolean;
	}>('/api/raids/assaults/settle', {
		assault_id: assault.assault_id,
		settlement_key: assault.settlement_key,
		outcome,
		occurred_at: assault.test_occurred_at
	}, session_token);
}

describe('Guild Raids', () => {
	test('allows Social Only Raid progress but forfeits cache delivery', async () => {
		const member = await register_guild_client('Social Raid Member', 'Social Raid Guild');
		await post_json('/api/raids/activate', {}, member.session_token);
		await db_run('UPDATE `guild_raids` SET `remaining_health` = 1000 WHERE `guild_id` = ?', [member.guild_id]);
		const mode = await post_json<{ success: boolean; social_mode: string }>('/api/social-mode/set', {
			mode: 'social', command_id: crypto.randomUUID()
		}, member.session_token);
		expect(mode.json).toMatchObject({ success: true, social_mode: 'social' });

		const assault = await reserve(member.session_token, 1);
		const settled = await settle(member.session_token, assault);
		expect(settled.json).toMatchObject({ success: true, credited_progress: 1000 });
		const state = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		const inbox = await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>('/api/inbox', member.session_token);

		expect(state.json).toMatchObject({ cache_pending: false, raid: { secured: true } });
		expect(inbox.json.items).not.toEqual(expect.arrayContaining([...RAID_VICTORY_CACHE]));
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guild_raid_victory_caches` WHERE `client_id` = ?', [member.client_id])).toBe(0);
	});

	test('activates a private-Guild Raid and secures it through bounded idempotent Assaults', async () => {
		const member = await register_guild_client('Raid Founder', 'Raid Test Guild');
		const before = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		expect(before.response.status).toBe(200);
		expect(before.json).toMatchObject({ affiliation: 'private', can_activate: true, raid: null });

		const activated = await post_json<{ success: boolean; raid: RaidState['raid'] }>(
			'/api/raids/activate', {}, member.session_token
		);
		expect(activated.response.status).toBe(200);
		expect(activated.json.raid).toMatchObject({
			secured: false,
			remaining_health: 9_000,
			member: { assaults: 3, contribution: 0 }
		});

		const first = await reserve(member.session_token);
		const first_result = await settle(member.session_token, first);
		expect(first_result.response.status).toBe(200);
		expect(first_result.json).toMatchObject({ success: true, credited_progress: 4_500, idempotent: false });
		const retried = await settle(member.session_token, first);
		expect(retried.response.status).toBe(200);
		expect(retried.json).toMatchObject({ success: true, credited_progress: 4_500, idempotent: true });

		const second = await reserve(member.session_token);
		const second_result = await settle(member.session_token, second);
		expect(second_result.json.credited_progress).toBe(4_500);

		const secured = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		expect(secured.json).toMatchObject({
			cache_pending: false,
			raid: {
				secured: true,
				remaining_health: 0,
				member: { assaults: 1, contribution: 9_000, successful_assaults: 2 }
			}
		});

		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', member.session_token
		)).json.items).toEqual([...RAID_VICTORY_CACHE].sort((a, b) => a.item_id.localeCompare(b.item_id)));
	});

	test('lists only members who have started an Assault, including an unresolved Assault at Tier 0', async () => {
		const guild = await make_guildmates('Raid Participant One', 'Raid Participant Two', 'Raid Participants');
		const activated = await post_json<{ success: boolean; raid: RaidState['raid'] }>(
			'/api/raids/activate', {}, guild.first.session_token
		);
		expect(activated.json.raid?.leaderboard).toEqual([]);

		const pending = await reserve(guild.second.session_token, 1);
		expect(pending.assault_id).toBeString();
		const state = await get_json_with_session<RaidState>('/api/raids/state', guild.first.session_token);
		expect(state.json.raid?.leaderboard).toHaveLength(1);
		expect(state.json.raid?.leaderboard).toMatchObject([{
			client_id: guild.second.client_id,
			contribution: 0,
			highest_tier: 0,
			successful_assaults: 0
		}]);
	});

	test('consumes a manual Assault allowance beyond the automatic daily limit', async () => {
		const member = await register_guild_client('Raid Override', 'Raid Override Guild');
		await post_json('/api/raids/activate', {}, member.session_token);
		expect(await db_run(
			'UPDATE `guild_raid_roster` SET `manual_assaults_remaining` = 10 WHERE `client_id` = ?',
			[member.client_id]
		)).toBe(1);

		for (let attempt = 0; attempt < 4; attempt++) {
			const assault = await reserve(member.session_token, 1);
			const settled = await settle(member.session_token, assault);
			expect(settled.response.status).toBe(200);
		}

		const state = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		expect(state.json.raid?.member).toMatchObject({ assaults: 6, successful_assaults: 4 });
	});

	test('excludes Guildless identities and allows Free Fellowship members to use normal Raids', async () => {
		const guildless = await register_client('Guildless Raider');
		const guildless_state = await get_json_with_session<RaidState>('/api/raids/state', guildless.session_token);
		expect(guildless_state.json.affiliation).toBe('none');
		const guildless_activate = await post_json<{ error_lang: string }>('/api/raids/activate', {}, guildless.session_token);
		expect(guildless_activate.json.error_lang).toBe('MOD_MP_GUILD_REQUIRED');

		const fellowship = await attach_to_free_fellowship(
			await register_client('Fellowship Raider')
		);
		const fellowship_state = await get_json_with_session<RaidState>('/api/raids/state', fellowship.session_token);
		expect(fellowship_state.json).toMatchObject({ affiliation: 'free_fellowship', can_activate: true, raid: null });
		const fellowship_activate = await post_json<{ success: boolean; raid: RaidState['raid'] }>(
			'/api/raids/activate', {}, fellowship.session_token
		);
		expect(fellowship_activate.response.status).toBe(200);
		expect(fellowship_activate.json).toMatchObject({
			success: true,
			raid: { remaining_health: 9_000, member: { assaults: 3, contribution: 0 } }
		});
		const fellowship_assault = await reserve(fellowship.session_token, 1);
		const fellowship_settled = await settle(fellowship.session_token, fellowship_assault);
		expect(fellowship_settled.response.status).toBe(200);
		expect(fellowship_settled.json).toMatchObject({ success: true, credited_progress: 1_000 });
		await post_json('/api/guilds/leave', {}, fellowship.session_token);
	});

	test('keeps members who join after activation outside the Raid roster', async () => {
		const guild = await make_guildmates('Raid Roster Founder', 'Raid Roster Member', 'Raid Roster Guild');
		await post_json('/api/raids/activate', {}, guild.first.session_token);
		const late_member = await register_client('Late Raid Member');
		await post_json('/api/guilds/apply', { guild_id: guild.guild_id }, late_member.session_token);
		const guild_state = await get_json_with_session<{
			applicants: Array<{ application_id: number; client_id: number }>;
		}>('/api/guilds/state', guild.first.session_token);
		const application = guild_state.json.applicants.find(item => item.client_id === late_member.client_id);
		expect(application).toBeDefined();
		await post_json('/api/guilds/application/decide', {
			application_id: application?.application_id,
			approve: true
		}, guild.first.session_token);

		const state = await get_json_with_session<RaidState>('/api/raids/state', late_member.session_token);
		expect(state.json.raid?.member).toBeNull();
		const excluded = await post_json<{ error_lang: string }>('/api/raids/assaults/reserve', {
			tier: 1,
			loaded_session_id: crypto.randomUUID()
		}, late_member.session_token);
		expect(excluded.json.error_lang).toBe('MOD_MP_RAID_NOT_ELIGIBLE');
	});

	test('excludes Shadowed members from scaling while retaining their Raid roster tenures', async () => {
		const members = await make_guild_group([
			'Raid Active One',
			'Raid Active Two',
			'Raid Shadow Three',
			'Raid Shadow Four',
			'Raid Shadow Five',
			'Raid Shadow Six'
		], 'Raid Shadow Guild');
		await db_run(
			'UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` IN (?, ?, ?, ?)',
			[
				Date.now() - SHADOWED_AFTER - 1_000,
				members[2].client_id,
				members[3].client_id,
				members[4].client_id,
				members[5].client_id
			]
		);

		const activated = await post_json<{ success: boolean; raid: RaidState['raid'] }>(
			'/api/raids/activate', {}, members[0].session_token
		);
		expect(activated.json.raid).toMatchObject({
			active_member_count: 2,
			required_contributors: 2
		});
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `guild_raid_roster` WHERE `raid_id` = ?',
			[activated.json.raid?.raid_id ?? -1]
		)).toBe(6);

		const returned = await get_json_with_session<RaidState>('/api/raids/state', members[2].session_token);
		expect(returned.json.raid).toMatchObject({
			active_member_count: 2,
			required_contributors: 2,
			member: { assaults: 3, contribution: 0 }
		});
		const reservation = await reserve(members[2].session_token, 1);
		expect(reservation.assault_id).toBeString();
	});

	test('rejects malformed reservations and conflicting settlement replays', async () => {
		const member = await register_guild_client('Raid Boundary', 'Raid Boundary Guild');
		await post_json('/api/raids/activate', {}, member.session_token);
		const invalid = await post('/api/raids/assaults/reserve', {
			tier: 9,
			loaded_session_id: 'short'
		}, member.session_token);
		expect(invalid.status).toBe(400);

		const assault = await reserve(member.session_token, 1);
		const settled = await settle(member.session_token, assault, 'death');
		expect(settled.response.status).toBe(200);
		const conflict = await post('/api/raids/assaults/settle', {
			assault_id: assault.assault_id,
			settlement_key: assault.settlement_key,
			outcome: 'success',
			occurred_at: assault.test_occurred_at
		}, member.session_token);
		expect(conflict.status).toBe(409);
	});

	test('finalizes an out-of-window terminal result so the next Assault can begin', async () => {
		const member = await register_guild_client('Raid Expiry', 'Raid Expiry Guild');
		await post_json('/api/raids/activate', {}, member.session_token);
		const assault = await reserve(member.session_token, 1);
		const late = await post_json<{
			success: boolean;
			outcome: string;
			credited_progress: number;
			idempotent: boolean;
		}>('/api/raids/assaults/settle', {
			assault_id: assault.assault_id,
			settlement_key: assault.settlement_key,
			outcome: 'death',
			occurred_at: assault.combat_deadline + 1
		}, member.session_token);
		expect(late.response.status).toBe(200);
		expect(late.json).toMatchObject({
			success: true,
			outcome: 'abandoned',
			credited_progress: 0,
			idempotent: false
		});

		const retry = await post('/api/raids/assaults/settle', {
				assault_id: assault.assault_id,
				settlement_key: assault.settlement_key,
				outcome: 'death',
				occurred_at: assault.combat_deadline + 1
			}, member.session_token);
		expect(retry.status).toBe(409);

		const next = await reserve(member.session_token, 1);
		expect(next.assault_id).not.toBe(assault.assault_id);
	});

	test('replays a same-session pending Assault and explicitly abandons it for a new session', async () => {
		const member = await register_guild_client('Raid Resume', 'Raid Resume Guild');
		await post_json('/api/raids/activate', {}, member.session_token);
		const loaded_session_id = crypto.randomUUID();
		const first = await post_json<Reservation>('/api/raids/assaults/reserve', {
			tier: 2,
			loaded_session_id
		}, member.session_token);
		expect(first.response.status).toBe(200);

		const replay = await post_json<Reservation>('/api/raids/assaults/reserve', {
			tier: 4,
			loaded_session_id
		}, member.session_token);
		expect(replay.response.status).toBe(200);
		expect(replay.json).toMatchObject({
			assault_id: first.json.assault_id,
			settlement_key: first.json.settlement_key,
			tier: 2,
			combat_deadline: first.json.combat_deadline
		});

		const recovered = await post_json<Reservation & { error_lang?: string }>('/api/raids/assaults/reserve', {
			tier: 4,
			loaded_session_id: crypto.randomUUID()
		}, member.session_token);
		expect(recovered.response.status).toBe(200);
		expect(recovered.json.error_lang).toBe('MOD_MP_RAID_ASSAULT_PENDING');

		const abandoned = await post_json<{ success: boolean; abandoned: boolean }>(
			'/api/raids/assaults/abandon', {}, member.session_token
		);
		expect(abandoned.response.status).toBe(200);
		expect(abandoned.json).toMatchObject({ success: true, abandoned: true });

		const replacement = await post_json<Reservation>('/api/raids/assaults/reserve', {
			tier: 4,
			loaded_session_id: crypto.randomUUID()
		}, member.session_token);
		expect(replacement.response.status).toBe(200);
		expect(replacement.json.assault_id).not.toBe(first.json.assault_id);
	});
});
