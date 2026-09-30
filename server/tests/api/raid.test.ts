import { describe, expect, test } from 'bun:test';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { attach_to_free_fellowship, make_guild_group, make_guildmates, register_guild_client } from '../support/fixtures';
import { db_count, db_run } from '../support/persistence';
import { RECENTLY_ACTIVE_AFTER } from '../../recent-activity';
import { get_raid_monster_drops, RAID_MONSTER_DROPS, RAID_TIER_PROGRESS, RAID_VICTORY_CACHE, raid_max_health, raid_fortified_resistance } from '../../raid';

type RaidState = {
	affiliation: string;
	can_activate?: boolean;
	cache_pending: boolean;
	tier_defeats?: Record<number, number>;
	unlocked_tiers?: number[];
	raid?: {
		raid_id: number;
		active: boolean;
		secured: boolean;
		remaining_health: number;
		max_health: number;
		active_member_count: number;
		required_contributors: number;
		member: { assaults: number; contribution: number; successful_assaults: number; next_assault_grant_at: number | null } | null;
		leaderboard: Array<{ client_id: number; highest_tier: number; contribution: number; successful_assaults: number }>;
	};
};

type Reservation = {
	success?: boolean;
	assault_id: string;
	settlement_key: string;
	tier: number;
	combat_deadline: number;
	fortified_resistance: number;
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

async function seed_raid_unlock(client_id: number, tier: number): Promise<void> {
	if (tier > 1)
		await db_run('INSERT INTO `raid_tier_unlocks` (`client_id`, `tier`, `first_defeated_at`) VALUES(?, ?, ?)',
			[client_id, tier - 1, Date.now()]);
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

async function raid_admin(action: 'preview' | 'cutover', cutover_at: number) {
	const child = Bun.spawn({
		cmd: [process.execPath, 'admin.ts', 'raid', action, String(cutover_at), ...(action === 'cutover' ? ['confirm'] : [])],
		cwd: new URL('../..', import.meta.url).pathname,
		env: { ...process.env, DB_PATH: process.env.TEST_DB_PATH },
		stdout: 'pipe', stderr: 'pipe'
	});
	const [exit_code, stdout, stderr] = await Promise.all([
		child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
	]);
	expect({ exit_code, stderr }).toEqual({ exit_code: 0, stderr: '' });
	return JSON.parse(stdout.trim()) as { operation_id: string; completed_raids: number; new_payouts: number };
}

describe('Guild Raids', () => {
	test('matches Expedition scaling and rounds shared health to 500', () => {
		expect([1, 2, 3, 4, 5, 10, 20, 30, 40, 50].map(raid_max_health))
			.toEqual([7_500, 10_000, 14_000, 16_500, 18_500, 27_500, 42_000, 54_000, 65_000, 75_000]);
	});

	test('lowers Fortified resistance at six-win thresholds with a 75 floor', () => {
		expect([0, 5, 6, 18, 119, 120, 999].map(raid_fortified_resistance))
			.toEqual([95, 95, 94, 92, 76, 75, 75]);
	});

	test('defines the requested tier drop weights and inclusive quantity ranges', () => {
		expect(RAID_MONSTER_DROPS[1]).toEqual([
			{ item_id: 'melvorD:Bird_Nest', min: 30, max: 60, weight: 8 },
			{ item_id: 'melvorF:Herb_Sack', min: 10, max: 20, weight: 1 },
			{ item_id: 'melvorD:Weird_Gloop', min: 30, max: 60, weight: 1 }
		]);
		expect(RAID_MONSTER_DROPS[2]).toEqual([
			{ item_id: 'melvorD:Bird_Nest', min: 60, max: 120, weight: 1 },
			{ item_id: 'melvorF:Herb_Sack', min: 40, max: 50, weight: 8 },
			{ item_id: 'melvorD:Weird_Gloop', min: 60, max: 120, weight: 1 }
		]);
		expect(RAID_MONSTER_DROPS[3]).toEqual([
			{ item_id: 'melvorF:Pile_Of_Ores', min: 50, max: 100, weight: 3 },
			{ item_id: 'melvorF:Pile_Of_Logs', min: 50, max: 100, weight: 3 },
			{ item_id: 'melvorF:Stack_Of_Bones', min: 40, max: 80, weight: 3 },
			{ item_id: 'melvorD:Weird_Gloop', min: 120, max: 240, weight: 1 }
		]);
		expect(RAID_MONSTER_DROPS[4]).toEqual([
			{ item_id: 'melvorTotH:Exotic_Herb_Sack', min: 30, max: 60, weight: 2, toth: true },
			{ item_id: 'melvorTotH:Raven_Nest', min: 40, max: 80, weight: 3, toth: true },
			{ item_id: 'melvorF:Antique_Vase', min: 10, max: 100, weight: 2 },
			{ item_id: 'melvorD:Weird_Gloop', min: 160, max: 320, weight: 1 }
		]);
	});

	test('normalizes drop odds after filtering expansion rewards', () => {
		const base = get_raid_monster_drops(-1);
		expect(base[4]).toEqual([
			{ item_id: 'melvorF:Antique_Vase', min: 10, max: 100, weight: 2, total_weight: 3 },
			{ item_id: 'melvorD:Weird_Gloop', min: 160, max: 320, weight: 1, total_weight: 3 }
		]);
		for (const drops of Object.values(base))
			expect(drops.reduce((sum, drop) => sum + drop.weight / drop.total_weight, 0)).toBeCloseTo(1);
	});

	test('returns tier progress once at authentication', async () => {
		const member = await register_client('Raid Settings');
		const authenticated = await post_json<{ raid_tier_progress: Record<number, number>; raid_monster_drops: ReturnType<typeof get_raid_monster_drops> }>('/api/authenticate', {
			client_identifier: member.client_identifier, client_key: member.client_key
		});
		expect(authenticated.json.raid_tier_progress).toEqual(RAID_TIER_PROGRESS);
		expect(authenticated.json.raid_monster_drops).toEqual(get_raid_monster_drops(member.client_id));
	});

	test('includes expansion drops at registration and refreshes odds at authentication', async () => {
		type Bootstrap = { client_identifier: string; raid_monster_drops: ReturnType<typeof get_raid_monster_drops> };
		const client_key = crypto.randomUUID();
		const registered = await post_json<Bootstrap>('/api/register', {
			client_key, display_name: 'Raid Drop Odds',
			client_runtime: { mod_version: '1.6.1', active_mods: [], owned_dlc: ['melvorTotH'] }
		});
		expect(registered.response.status).toBe(200);
		expect(registered.json.raid_monster_drops[4]).toEqual([
			{ item_id: 'melvorTotH:Raven_Nest', min: 40, max: 80, weight: 3, total_weight: 8 },
			{ item_id: 'melvorTotH:Exotic_Herb_Sack', min: 30, max: 60, weight: 2, total_weight: 8 },
			{ item_id: 'melvorF:Antique_Vase', min: 10, max: 100, weight: 2, total_weight: 8 },
			{ item_id: 'melvorD:Weird_Gloop', min: 160, max: 320, weight: 1, total_weight: 8 }
		]);
		const authenticated = await post_json<Bootstrap>('/api/authenticate', {
			client_identifier: registered.json.client_identifier, client_key,
			client_runtime: { mod_version: '1.6.1', active_mods: [], owned_dlc: [] }
		});
		expect(authenticated.response.status).toBe(200);
		expect(authenticated.json.raid_monster_drops[4]).toEqual(get_raid_monster_drops(-1)[4]);
	});

	test('unlocks each tier only after this character defeats the previous boss', async () => {
		const guild = await make_guildmates('Raid Unlock Winner', 'Raid Unlock Peer', 'Raid Unlock Guild');
		await db_run('INSERT INTO `raid_defeat_totals` (`client_id`, `tier`, `defeats`) VALUES(?, 1, 20)',
			[guild.first.client_id]);
		await post_json('/api/raids/activate', {}, guild.first.session_token);
		await db_run('UPDATE `guild_raid_roster` SET `manual_assaults_remaining` = 10 WHERE `client_id` = ?',
			[guild.first.client_id]);
		const reject_locked = async (session_token: string, tier: number) => {
			const result = await post_json<{ error_lang: string }>('/api/raids/assaults/reserve', {
				tier, loaded_session_id: crypto.randomUUID()
			}, session_token);
			expect(result.json.error_lang).toBe('MOD_MP_RAID_TIER_LOCKED');
		};
		const initial = await get_json_with_session<RaidState>('/api/raids/state', guild.first.session_token);
		expect(initial.json.unlocked_tiers).toEqual([]);
		for (const tier of [2, 3, 4]) await reject_locked(guild.first.session_token, tier);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guild_raid_assaults` WHERE `client_id` = ?',
			[guild.first.client_id])).toBe(0);
		const failed = await reserve(guild.first.session_token, 1);
		await settle(guild.first.session_token, failed, 'death');
		await reject_locked(guild.first.session_token, 2);
		for (const tier of [1, 2, 3, 4]) {
			await settle(guild.first.session_token, await reserve(guild.first.session_token, tier));
			const state = await get_json_with_session<RaidState>('/api/raids/state', guild.first.session_token);
			expect(state.json.unlocked_tiers).toEqual(Array.from({ length: tier }, (_, index) => index + 1));
			if (tier <= 2) await reject_locked(guild.first.session_token, tier + 2);
		}
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `raid_tier_unlocks` WHERE `client_id` = ?',
			[guild.first.client_id])).toBe(4);
		await reject_locked(guild.second.session_token, 2);
	});

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
		await seed_raid_unlock(member.client_id, 4);
		const before = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		expect(before.response.status).toBe(200);
		expect(before.json).toMatchObject({ affiliation: 'private', can_activate: true, raid: null });

		const activated = await post_json<{ success: boolean; raid: RaidState['raid'] }>(
			'/api/raids/activate', {}, member.session_token
		);
		expect(activated.response.status).toBe(200);
		expect(activated.json.raid).toMatchObject({
			secured: false,
			remaining_health: 7_500,
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

	test('delivers one tier roll per 1.6.0 win and fixes each participant cache by TotH ownership', async () => {
		const guild = await make_guildmates('Raid Base Reward', 'Raid TotH Reward', 'Raid Inbox Rewards',
			{ first: '1.6.0', second: '1.6.0' });
		await seed_raid_unlock(guild.first.client_id, 4);
		await seed_raid_unlock(guild.second.client_id, 4);
		await db_run('UPDATE `client_runtime_snapshots` SET `owned_dlc` = ? WHERE `client_id` = ?',
			['["melvorTotH"]', guild.second.client_id]);
		await post_json('/api/raids/activate', {}, guild.first.session_token);
		await db_run('UPDATE `guild_raids` SET `remaining_health` = 9000 WHERE `guild_id` = ?', [guild.guild_id]);

		const base_assault = await reserve(guild.first.session_token, 4);
		const base_win = await settle(guild.first.session_token, base_assault);
		expect(base_win.json).toMatchObject({ success: true, idempotent: false });
		const base_inbox = await get_json_with_session<{ groups: Array<{ source_type: string; source_name: string; items: Array<{ item_id: string; qty: number }> }> }>(
			'/api/inbox', guild.first.session_token);
		expect(base_inbox.json.groups.find(group => group.source_type === 'raid_assault')?.source_name).toBe('4');
		const base_roll = base_inbox.json.groups.find(group => group.source_type === 'raid_assault')?.items;
		expect(base_roll).toHaveLength(1);
		expect(base_roll![0]?.item_id).toBeOneOf(['melvorF:Antique_Vase', 'melvorD:Weird_Gloop']);
		const base_range = base_roll![0]?.item_id === 'melvorF:Antique_Vase' ? [10, 100] : [160, 320];
		expect(base_roll![0]?.qty).toBeGreaterThanOrEqual(base_range[0]!);
		expect(base_roll![0]?.qty).toBeLessThanOrEqual(base_range[1]!);
		expect((await settle(guild.first.session_token, base_assault)).json.idempotent).toBe(true);
		const after_retry = await get_json_with_session<typeof base_inbox.json>('/api/inbox', guild.first.session_token);
		expect(after_retry.json.groups.find(group => group.source_type === 'raid_assault')?.items).toEqual(base_roll);

		const toth_win = await settle(guild.second.session_token, await reserve(guild.second.session_token, 4));
		expect(toth_win.json).toMatchObject({ success: true, credited_progress: 4500 });
		const base_cache = await get_json_with_session<typeof base_inbox.json>('/api/inbox', guild.first.session_token);
		const toth_cache = await get_json_with_session<typeof base_inbox.json>('/api/inbox', guild.second.session_token);
		expect(base_cache.json.groups.find(group => group.source_type === 'raid_victory_cache')?.items)
			.toEqual(expect.arrayContaining([...RAID_VICTORY_CACHE]));
		expect(toth_cache.json.groups.find(group => group.source_type === 'raid_victory_cache')?.items)
			.toEqual(expect.arrayContaining([
				{ item_id: 'melvorD:Diamond', qty: 500 },
				{ item_id: 'melvorF:Large_Horn', qty: 100 },
				{ item_id: 'melvorTotH:Zephyte', qty: 200 },
				{ item_id: 'melvorTotH:Ectoplasm', qty: 200 }
			]));
	});

	test('keeps pending pre-change legacy cache contents after the reward migration', async () => {
		const member = await register_guild_client('Raid Legacy Cache', 'Legacy Cache Guild', '1.4.5');
		await post_json('/api/raids/activate', {}, member.session_token);
		const cache_id = crypto.randomUUID();
		await db_run(
			'INSERT INTO `guild_raid_victory_caches` (`id`, `raid_id`, `membership_id`, `client_id`, `created_at`) ' +
			'SELECT ?, `raid_id`, `membership_id`, `client_id`, ? FROM `guild_raid_roster` WHERE `client_id` = ? LIMIT 1',
			[cache_id, Date.now(), member.client_id]
		);
		const response = await get_json_with_session<{ cache: { id: string; items: Array<{ item_id: string; qty: number }> } }>(
			'/api/raids/cache', member.session_token);
		expect(response.json.cache.id).toBe(cache_id);
		expect(response.json.cache.items).toEqual([
			{ item_id: 'melvorF:Summoning_Familiar_Wolf', qty: 100 },
			{ item_id: 'melvorF:Summoning_Familiar_Minotaur', qty: 100 },
			{ item_id: 'melvorF:Summoning_Familiar_Yak', qty: 75 },
			{ item_id: 'melvorD:Dragon_Bones', qty: 25 },
			{ item_id: 'melvorD:Diamond', qty: 20 }
		]);
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

	test('lets one member finish a two-player Raid without a personal contribution cap', async () => {
		const guild = await make_guildmates('Raid Carrier', 'Raid Companion', 'Raid Carry Guild');
		await seed_raid_unlock(guild.first.client_id, 4);
		const activated = await post_json<{ raid: RaidState['raid'] }>('/api/raids/activate', {}, guild.first.session_token);
		expect(activated.json.raid).toMatchObject({ max_health: 10_000, required_contributors: 2 });
		for (const expected of [4_500, 4_500, 4_500]) {
			const result = await settle(guild.first.session_token, await reserve(guild.first.session_token));
			expect(result.json.credited_progress).toBe(expected);
		}
		const state = await get_json_with_session<RaidState>('/api/raids/state', guild.first.session_token);
		expect(state.json.raid).toMatchObject({ secured: true, remaining_health: 0,
			member: { contribution: 13_500, successful_assaults: 3 } });
	});

	test('reports the next three-Assault grant while a tranche remains', async () => {
		const member = await register_guild_client('Raid Grant', 'Raid Grant Guild');
		const activated = await post_json<{ raid: RaidState['raid'] }>('/api/raids/activate', {}, member.session_token);
		const started_at = Date.now();
		const first = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		expect(first.json.raid?.member?.next_assault_grant_at).toBeGreaterThan(started_at + 23 * 60 * 60 * 1000);
		await db_run('UPDATE `guild_raids` SET `started_at` = ?, `expires_at` = ? WHERE `id` = ?',
			[started_at - 25 * 60 * 60 * 1000, started_at + 47 * 60 * 60 * 1000,
				activated.json.raid!.raid_id]);
		const second = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		expect(second.json.raid?.member?.next_assault_grant_at).toBe(started_at + 23 * 60 * 60 * 1000);
		await db_run('UPDATE `guild_raids` SET `started_at` = ?, `expires_at` = ? WHERE `id` = ?',
			[started_at - 49 * 60 * 60 * 1000, started_at + 23 * 60 * 60 * 1000,
				activated.json.raid!.raid_id]);
		const last = await get_json_with_session<RaidState>('/api/raids/state', member.session_token);
		expect(last.json.raid?.member?.next_assault_grant_at).toBeNull();
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
			raid: { member: { assaults: 3, contribution: 0 } }
		});
		expect(fellowship_activate.json.raid?.remaining_health)
			.toBe(raid_max_health(fellowship_activate.json.raid!.active_member_count));
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

	test('excludes members inactive for four days while retaining their Raid roster tenures', async () => {
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
				Date.now() - RECENTLY_ACTIVE_AFTER - 1_000,
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

	test('scales the Raid from the full recently active player count', async () => {
		const members = await make_guild_group(
			Array.from({ length: 13 }, (_, index) => `Raid Scale ${index + 1}`),
			'Raid Scale Guild'
		);
		const activated = await post_json<{ success: boolean; raid: RaidState['raid'] }>(
			'/api/raids/activate', {}, members[0].session_token
		);

		expect(activated.json.raid).toMatchObject({
			active_member_count: 13,
			required_contributors: 13,
			max_health: 32_000
		});
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
		await seed_raid_unlock(member.client_id, 2);
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
		await seed_raid_unlock(member.client_id, 4);

		const replacement = await post_json<Reservation>('/api/raids/assaults/reserve', {
			tier: 4,
			loaded_session_id: crypto.randomUUID()
		}, member.session_token);
		expect(replacement.response.status).toBe(200);
		expect(replacement.json.assault_id).not.toBe(first.json.assault_id);
	});

	test('tracks player-owned tier wins through a Guild change and excludes Shadowed members', async () => {
		const guild = await make_guildmates('Raid Lifetime Winner', 'Raid Lifetime Peer', 'Raid Lifetime Guild');
		await seed_raid_unlock(guild.first.client_id, 2);
		await post_json('/api/raids/activate', {}, guild.first.session_token);
		await db_run('UPDATE `guild_raid_roster` SET `manual_assaults_remaining` = 10 WHERE `client_id` = ?',
			[guild.first.client_id]);
		let last: Reservation | null = null;
		for (let index = 0; index < 6; index++) {
			last = await reserve(guild.first.session_token, 2);
			await settle(guild.first.session_token, last);
		}
		const replay = await settle(guild.first.session_token, last!);
		expect(replay.json.idempotent).toBe(true);
		const source = await get_json_with_session<RaidState>('/api/raids/state', guild.second.session_token);
		expect(source.json.tier_defeats?.[2]).toBe(6);
		const next = await reserve(guild.first.session_token, 2);
		expect(next.fortified_resistance).toBe(94);
		const destination = await register_guild_client('Raid Lifetime Host', 'Raid New Guild');
		await db_run('UPDATE `guild_memberships` SET `guild_id` = ? WHERE `client_id` = ?',
			[destination.guild_id, guild.first.client_id]);
		const moved = await get_json_with_session<RaidState>('/api/raids/state', destination.session_token);
		expect(moved.json.tier_defeats?.[2]).toBe(6);
		const directory = await get_json_with_session<{ members: Array<{ client_id: number; raid_defeats: number }> }>(
			'/api/guilds/state', destination.session_token);
		expect(directory.json.members.find(member => member.client_id === guild.first.client_id)?.raid_defeats).toBe(6);
		await db_run('UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` = ?',
			[Date.now() - 8 * 24 * 60 * 60 * 1000, guild.first.client_id]);
		const shadowed = await get_json_with_session<RaidState>('/api/raids/state', destination.session_token);
		expect(shadowed.json.tier_defeats?.[2]).toBe(0);
	});

	test('cuts over active Raids once, lets 1.6.0 start immediately, and gates old clients', async () => {
		const participant = await register_guild_client('Raid Cutover Winner', 'Raid Cutover Guild', '1.6.0');
		const older = await register_guild_client('Raid Cutover Legacy', 'Raid Old Guild', '1.5.16');
		await post_json('/api/raids/activate', {}, participant.session_token);
		await settle(participant.session_token, await reserve(participant.session_token, 1));
		const cutover_at = Date.now();
		try {
			const preview = await raid_admin('preview', cutover_at);
			expect(preview.completed_raids).toBeGreaterThan(0);
			const completed = await raid_admin('cutover', cutover_at);
			expect(completed.new_payouts).toBe(preview.new_payouts);
			expect(await raid_admin('cutover', cutover_at)).toEqual(completed);
			const state = await get_json_with_session<RaidState>('/api/raids/state', participant.session_token);
			expect(state.json).toMatchObject({ can_activate: true, raid: { secured: true, active: false } });
			const inbox = await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
				'/api/inbox', participant.session_token);
			expect(inbox.json.items).toEqual(expect.arrayContaining([...RAID_VICTORY_CACHE]));
			const blocked = await post_json<{ error_lang: string }>('/api/raids/activate', {}, older.session_token);
			expect(blocked.json.error_lang).toBe('MOD_MP_RAID_COOLDOWN');
			const next = await post_json('/api/raids/activate', {}, participant.session_token);
			expect(next.json).toMatchObject({ success: true });
			const cooling_down = await get_json_with_session<RaidState>('/api/raids/state', participant.session_token);
			expect(cooling_down.json.can_activate).toBe(false);
			const repeated = await post_json<{ error_lang: string }>('/api/raids/activate', {}, participant.session_token);
			expect(repeated.json.error_lang).toBe('MOD_MP_RAID_COOLDOWN');
			await db_run('UPDATE `raid_cutover` SET `resume_at` = `cutover_at` + 1 WHERE `id` = 1');
			const still_blocked = await post_json<{ error_lang: string }>('/api/raids/activate', {}, older.session_token);
			expect(still_blocked.json.error_lang).toBe('MOD_MP_RAID_COOLDOWN');
		} finally {
			await db_run('DELETE FROM `raid_cutover` WHERE `id` = 1');
		}
	});
});
