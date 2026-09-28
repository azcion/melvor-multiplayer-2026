import { db } from './db';
import { recently_active_cutoff } from './recent-activity';
import { scale_expedition_hours } from './guild-expedition';
import { record_guild_activity } from './guild-activity';
import { add_inbox_items } from './inbox';
import { client_uses_legacy_transfer_protocol } from './transfer-compatibility';
import { is_client_version_at_least } from './client-version-policy';
import { shadowed_cutoff } from './shadowed';

export const RAID_DURATION = 72 * 60 * 60 * 1000;
export const RAID_COOLDOWN = 96 * 60 * 60 * 1000;
export const RAID_CUTOVER_PAUSE = 7 * 24 * 60 * 60 * 1000;
export const ASSAULT_DURATION = 30 * 60 * 1000;
export const ASSAULT_SETTLEMENT_GRACE = 24 * 60 * 60 * 1000;
export const RAID_BASE_HEALTH = 10_000;
export const RAID_TIER_PROGRESS = Object.freeze<Record<number, number>>({
	1: 1_000,
	2: 1_800,
	3: 3_000,
	4: 4_500
});
export function raid_max_health(active_player_count: number): number {
	return scale_expedition_hours(20, active_player_count) * (RAID_BASE_HEALTH / 20);
}
export const RAID_VICTORY_CACHE = Object.freeze([
	{ item_id: 'melvorD:Diamond', qty: 1000 },
	{ item_id: 'melvorF:Large_Horn', qty: 100 }
]);

const RAID_VICTORY_CACHE_TOTH = Object.freeze([
	{ item_id: 'melvorD:Diamond', qty: 500 },
	{ item_id: 'melvorF:Large_Horn', qty: 100 },
	{ item_id: 'melvorTotH:Zephyte', qty: 200 },
	{ item_id: 'melvorTotH:Ectoplasm', qty: 200 }
]);

type RaidDrop = { item_id: string; min: number; max: number; weight: number; toth?: boolean };
export const RAID_MONSTER_DROPS: Record<number, readonly RaidDrop[]> = Object.freeze({
	1: [
		{ item_id: 'melvorD:Bird_Nest', min: 30, max: 60, weight: 8 },
		{ item_id: 'melvorF:Herb_Sack', min: 10, max: 20, weight: 1 },
		{ item_id: 'melvorD:Weird_Gloop', min: 30, max: 60, weight: 1 }
	],
	2: [
		{ item_id: 'melvorD:Bird_Nest', min: 60, max: 120, weight: 1 },
		{ item_id: 'melvorF:Herb_Sack', min: 40, max: 50, weight: 8 },
		{ item_id: 'melvorD:Weird_Gloop', min: 60, max: 120, weight: 1 }
	],
	3: [
		{ item_id: 'melvorF:Pile_Of_Ores', min: 50, max: 100, weight: 3 },
		{ item_id: 'melvorF:Pile_Of_Logs', min: 50, max: 100, weight: 3 },
		{ item_id: 'melvorF:Stack_Of_Bones', min: 40, max: 80, weight: 3 },
		{ item_id: 'melvorD:Weird_Gloop', min: 120, max: 240, weight: 1 }
	],
	4: [
		{ item_id: 'melvorTotH:Exotic_Herb_Sack', min: 30, max: 60, weight: 2, toth: true },
		{ item_id: 'melvorTotH:Raven_Nest', min: 40, max: 80, weight: 3, toth: true },
		{ item_id: 'melvorF:Antique_Vase', min: 10, max: 100, weight: 2 },
		{ item_id: 'melvorD:Weird_Gloop', min: 160, max: 320, weight: 1 }
	]
});

function owns_toth(client_id: number): boolean {
	const snapshot = db.query<{ owned_dlc: string }, [number]>(
		'SELECT `owned_dlc` FROM `client_runtime_snapshots` WHERE `client_id` = ?'
	).get(client_id);
	if (snapshot === null) return false;
	try {
		const owned = JSON.parse(snapshot.owned_dlc);
		return Array.isArray(owned) && owned.includes('melvorTotH');
	} catch {
		return false;
	}
}

function can_receive_raid_rewards(client_id: number, now: number): boolean {
	const row = db.query<{ enabled: number }, [number, number, number]>(
		'SELECT CASE WHEN client.`social_mode` = \'social\' OR client.`social_mode_enforced` = 1 OR ' +
		'COALESCE(account.`social_mode_enforced`, 0) = 1 OR ' +
		'(COALESCE(guild.`cheat_restriction_enabled`, 0) = 1 AND ' +
		'client.`cheats_detected_at` BETWEEN ? AND ?) THEN 0 ELSE 1 END AS `enabled` ' +
		'FROM `clients` AS client LEFT JOIN `melvor_accounts` AS account ' +
		'ON account.`id` = client.`melvor_account_id` ' +
		'LEFT JOIN `guild_memberships` AS membership ON membership.`client_id` = client.`id` ' +
		'LEFT JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` WHERE client.`id` = ?'
	).get(now - 7 * 24 * 60 * 60 * 1000, now, client_id);
	return row?.enabled === 1;
}

function roll_raid_monster_drop(tier: number, has_toth: boolean): { item_id: string; qty: number } {
	const drops = RAID_MONSTER_DROPS[tier].filter(drop => has_toth || !drop.toth);
	const total_weight = drops.reduce((total, drop) => total + drop.weight, 0);
	let roll = Math.floor(Math.random() * total_weight);
	for (const drop of drops) {
		if (roll < drop.weight)
			return { item_id: drop.item_id, qty: drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1)) };
		roll -= drop.weight;
	}
	throw new Error('Raid drop table is empty.');
}

export function raid_fortified_resistance(defeats: number): number {
	return 99 - Math.min(24, Math.floor(Math.max(0, defeats) / 6));
}

type Membership = {
	membership_id: number;
	guild_id: number;
	guild_type: 'private' | 'public' | 'free_fellowship';
};

type RaidRow = {
	id: number;
	guild_id: number;
	started_at: number;
	expires_at: number;
	active_member_count: number;
	required_contributors: number;
	max_health: number;
	remaining_health: number;
	secured_at: number | null;
};

type RosterRow = {
	raid_id: number;
	membership_id: number;
	client_id: number;
	contribution: number;
	highest_tier: number;
	successful_assaults: number;
	manual_assaults_remaining: number | null;
};

type AssaultRow = {
	id: string;
	raid_id: number;
	membership_id: number;
	client_id: number;
	tier: number;
	loaded_session_id: string;
	settlement_key: string;
	reserved_at: number;
	combat_deadline: number;
	settlement_deadline: number;
	outcome: RaidOutcome | null;
	occurred_at: number | null;
	settled_at: number | null;
	credited_progress: number;
	fortified_resistance: number;
	inbox_loot: number;
};

export type RaidOutcome = 'success' | 'death' | 'flee' | 'abandoned';

function membership_for(client_id: number): Membership | null {
	return db.query(
		'SELECT membership.`id` AS `membership_id`, membership.`guild_id`, guild.`type` AS `guild_type` ' +
		'FROM `guild_memberships` AS membership JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` ' +
		'WHERE membership.`client_id` = ? LIMIT 1'
	).get(client_id) as Membership | null;
}

function latest_raid(guild_id: number): RaidRow | null {
	return db.query('SELECT * FROM `guild_raids` WHERE `guild_id` = ? ORDER BY `started_at` DESC LIMIT 1')
		.get(guild_id) as RaidRow | null;
}

type RaidCutover = { cutover_at: number; resume_at: number; max_raid_id: number };

function raid_cutover(): RaidCutover | null {
	return db.query('SELECT `cutover_at`, `resume_at`, `max_raid_id` FROM `raid_cutover` WHERE `id` = 1')
		.get() as RaidCutover | null;
}

function latest_cooldown_raid(guild_id: number, cutover: RaidCutover | null): RaidRow | null {
	if (cutover === null) return latest_raid(guild_id);
	return db.query('SELECT * FROM `guild_raids` WHERE `guild_id` = ? AND `id` > ? ' +
		'ORDER BY `started_at` DESC LIMIT 1').get(guild_id, cutover.max_raid_id) as RaidRow | null;
}

function legacy_raid_client(mod_version: string | null): boolean {
	return mod_version !== 'development' && !is_client_version_at_least(mod_version, '1.6.0');
}

export function guild_raid_tier_defeats(guild_id: number, now = Date.now()): Record<number, number> {
	const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
	const rows = db.query(
		'SELECT totals.`tier`, SUM(totals.`defeats`) AS `defeats` FROM `raid_defeat_totals` AS totals ' +
		'JOIN `guild_memberships` AS membership ON membership.`client_id` = totals.`client_id` ' +
		'JOIN `clients` AS client ON client.`id` = totals.`client_id` ' +
		'WHERE membership.`guild_id` = ? AND client.`last_multiplayer_active_at` >= ? ' +
		'GROUP BY totals.`tier`'
	).all(guild_id, shadowed_cutoff(now)) as Array<{ tier: number; defeats: number }>;
	for (const row of rows) counts[row.tier] = row.defeats;
	return counts;
}

function raid_unlocked_tiers(client_id: number): number[] {
	const rows = db.query('SELECT `tier` FROM `raid_tier_unlocks` WHERE `client_id` = ? ORDER BY `tier`')
		.all(client_id) as Array<{ tier: number }>;
	return rows.map(row => row.tier);
}

function assault_balance(raid: RaidRow, membership_id: number, now: number): number {
	const manual = db.query<{ manual_assaults_remaining: number | null }, [number, number]>(
		'SELECT `manual_assaults_remaining` FROM `guild_raid_roster` WHERE `raid_id` = ? AND `membership_id` = ?'
	).get(raid.id, membership_id);
	if (manual?.manual_assaults_remaining !== null && manual?.manual_assaults_remaining !== undefined)
		return manual.manual_assaults_remaining;

	let earned = 3;
	if (now >= raid.started_at + 24 * 60 * 60 * 1000)
		earned += 3;
	if (now >= raid.started_at + 48 * 60 * 60 * 1000)
		earned += 3;
	const spent = (db.query(
		'SELECT COUNT(*) AS `count` FROM `guild_raid_assaults` WHERE `raid_id` = ? AND `membership_id` = ?'
	).get(raid.id, membership_id) as { count: number }).count;
	return Math.min(6, Math.max(earned - spent, 0));
}

function next_assault_grant_at(raid: RaidRow, now: number): number | null {
	if (now >= raid.expires_at) return null;
	for (const elapsed of [24, 48]) {
		const grant_at = raid.started_at + elapsed * 60 * 60 * 1000;
		if (now < grant_at) return grant_at;
	}
	return null;
}

function create_cache(raid_id: number, roster: Pick<RosterRow, 'membership_id' | 'client_id'>, now: number): void {
	if (!can_receive_raid_rewards(roster.client_id, now))
		return;
	const items = owns_toth(roster.client_id) ? RAID_VICTORY_CACHE_TOTH : RAID_VICTORY_CACHE;
	if (!client_uses_legacy_transfer_protocol(roster.client_id)) {
		const inserted = db.query(
			'INSERT OR IGNORE INTO `guild_raid_victory_caches` ' +
			'(`id`, `raid_id`, `membership_id`, `client_id`, `created_at`, `acknowledged_at`, `items_json`) ' +
			'VALUES(?, ?, ?, ?, ?, ?, ?)'
		).run(crypto.randomUUID(), raid_id, roster.membership_id, roster.client_id, now, now, JSON.stringify(items));
		if (inserted.changes === 1)
			add_inbox_items(roster.client_id, items, { type: 'raid_victory_cache' });
		return;
	}
	db.query(
		'INSERT OR IGNORE INTO `guild_raid_victory_caches` ' +
		'(`id`, `raid_id`, `membership_id`, `client_id`, `created_at`, `items_json`) VALUES(?, ?, ?, ?, ?, ?)'
	).run(crypto.randomUUID(), raid_id, roster.membership_id, roster.client_id, now, JSON.stringify(items));
}

function reservation_from_assault(assault: Pick<AssaultRow, 'id' | 'settlement_key' | 'tier' | 'combat_deadline' | 'fortified_resistance'>) {
	return {
		assault_id: assault.id,
		settlement_key: assault.settlement_key,
		tier: assault.tier,
		combat_deadline: assault.combat_deadline,
		fortified_resistance: assault.fortified_resistance
	};
}

function grant_secured_caches(raid_id: number, now: number): void {
	const eligible = db.query(
		'SELECT roster.`membership_id`, roster.`client_id` FROM `guild_raid_roster` AS roster ' +
		'JOIN `guild_memberships` AS membership ON membership.`id` = roster.`membership_id` ' +
		'AND membership.`client_id` = roster.`client_id` ' +
		'WHERE roster.`raid_id` = ? AND roster.`successful_assaults` > 0'
	).all(raid_id) as Array<Pick<RosterRow, 'membership_id' | 'client_id'>>;
	for (const roster of eligible)
		create_cache(raid_id, roster, now);
}

export type RaidCutoverSummary = {
	operation_id: string;
	cutover_at: number;
	resume_at: number;
	max_raid_id: number;
	completed_raids: number;
	new_payouts: number;
};

export function preview_raid_cutover(cutover_at = Date.now()): RaidCutoverSummary {
	const completed = db.query('SELECT `operation_id`, `cutover_at`, `resume_at`, `max_raid_id`, ' +
		'`completed_raids`, `new_payouts` FROM `raid_cutover` WHERE `id` = 1')
		.get() as RaidCutoverSummary | null;
	if (completed !== null) return completed;
	if (!Number.isSafeInteger(cutover_at) || cutover_at < 0 || cutover_at > Date.now())
		throw new Error('Raid cutover time must be a past UTC millisecond timestamp');
	const completed_raids = (db.query('SELECT COUNT(*) AS `count` FROM `guild_raids` WHERE `expires_at` > ?')
		.get(cutover_at) as { count: number }).count;
	const max_raid_id = (db.query('SELECT COALESCE(MAX(`id`), 0) AS `id` FROM `guild_raids`')
		.get() as { id: number }).id;
	const new_payouts = (db.query(
		'SELECT COUNT(*) AS `count` FROM `guild_raid_roster` AS roster ' +
		'JOIN `guild_raids` AS raid ON raid.`id` = roster.`raid_id` ' +
		'JOIN `guild_memberships` AS membership ON membership.`id` = roster.`membership_id` ' +
			'AND membership.`client_id` = roster.`client_id` ' +
		'JOIN `clients` AS client ON client.`id` = roster.`client_id` ' +
		'WHERE raid.`expires_at` > ? AND roster.`successful_assaults` > 0 ' +
		"AND client.`social_mode` != 'social' AND NOT EXISTS (" +
		'SELECT 1 FROM `guild_raid_victory_caches` AS cache WHERE cache.`raid_id` = raid.`id` ' +
		'AND cache.`membership_id` = roster.`membership_id`)'
	).get(cutover_at) as { count: number }).count;
	return { operation_id: '', cutover_at, resume_at: cutover_at + RAID_CUTOVER_PAUSE, max_raid_id,
		completed_raids, new_payouts };
}

export function settle_raid_cutover(cutover_at = Date.now()): RaidCutoverSummary {
	return db.transaction(() => {
		const preview = preview_raid_cutover(cutover_at);
		if (preview.operation_id !== '') return preview;
		const raids = db.query('SELECT `id`, `guild_id`, `remaining_health`, `started_at` ' +
			'FROM `guild_raids` WHERE `expires_at` > ? ORDER BY `id`')
			.all(cutover_at) as Array<Pick<RaidRow, 'id' | 'guild_id' | 'remaining_health' | 'started_at'>>;
		const caches_before = (db.query('SELECT COUNT(*) AS `count` FROM `guild_raid_victory_caches`')
			.get() as { count: number }).count;
		const operation_id = crypto.randomUUID();
		for (const raid of raids) {
			db.query("UPDATE `guild_raid_assaults` SET `outcome` = 'abandoned', `occurred_at` = ?, " +
				'`settled_at` = ? WHERE `raid_id` = ? AND `outcome` IS NULL')
				.run(cutover_at, cutover_at, raid.id);
			db.query('UPDATE `guild_raids` SET `remaining_health` = 0, ' +
				'`secured_at` = COALESCE(`secured_at`, ?), `expires_at` = ? WHERE `id` = ?')
				.run(cutover_at, Math.max(cutover_at, raid.started_at + 1), raid.id);
			grant_secured_caches(raid.id, cutover_at);
			if (raid.remaining_health > 0)
				record_guild_activity({ guild_id: raid.guild_id, event_type: 'raid_completed',
					source_key: `raid:${raid.id}:completed`, created_at: cutover_at });
		}
		const caches_after = (db.query('SELECT COUNT(*) AS `count` FROM `guild_raid_victory_caches`')
			.get() as { count: number }).count;
		if (caches_after - caches_before !== preview.new_payouts)
			throw new Error('Raid cutover payout count changed from preview');
		db.query('INSERT INTO `raid_cutover` (`id`, `cutover_at`, `resume_at`, `operation_id`, ' +
			'`max_raid_id`, `completed_raids`, `new_payouts`) VALUES(1, ?, ?, ?, ?, ?, ?)')
			.run(cutover_at, preview.resume_at, operation_id, preview.max_raid_id,
				raids.length, preview.new_payouts);
		return { ...preview, operation_id };
	}).immediate();
}

function public_raid(raid: RaidRow, membership_id: number, now: number) {
	const roster = db.query(
		'SELECT * FROM `guild_raid_roster` WHERE `raid_id` = ? AND `membership_id` = ?'
	).get(raid.id, membership_id) as RosterRow | null;
	const leaderboard = db.query(
		'SELECT roster.`client_id`, client.`display_name`, client.`icon_id`, roster.`contribution`, ' +
		'roster.`highest_tier`, roster.`successful_assaults` FROM `guild_raid_roster` AS roster ' +
		'JOIN `clients` AS client ON client.`id` = roster.`client_id` WHERE roster.`raid_id` = ? ' +
		'AND EXISTS (SELECT 1 FROM `guild_raid_assaults` AS assault WHERE assault.`raid_id` = roster.`raid_id` ' +
		'AND assault.`membership_id` = roster.`membership_id` AND assault.`client_id` = roster.`client_id`) ' +
		'ORDER BY roster.`highest_tier` DESC, roster.`contribution` DESC, client.`display_name`, roster.`client_id`'
	).all(raid.id);
	return {
		raid_id: raid.id,
		started_at: raid.started_at,
		expires_at: raid.expires_at,
		active: now < raid.expires_at,
		secured: raid.remaining_health === 0,
		secured_at: raid.secured_at,
		max_health: raid.max_health,
		remaining_health: raid.remaining_health,
		required_contributors: raid.required_contributors,
		active_member_count: raid.active_member_count,
		// Older clients still render this denominator. The only remaining limit is shared health.
		contribution_cap: raid.max_health,
		member: roster === null ? null : {
			eligible: true,
			contribution: roster.contribution,
			highest_tier: roster.highest_tier,
			successful_assaults: roster.successful_assaults,
			assaults: assault_balance(raid, membership_id, now),
			next_assault_grant_at: roster.manual_assaults_remaining === null ? next_assault_grant_at(raid, now) : null
		},
		leaderboard
	};
}

export function get_raid_state(client_id: number, now = Date.now(), mod_version: string | null = null) {
	const membership = membership_for(client_id);
	const cache_pending = db.query(
		'SELECT EXISTS(SELECT 1 FROM `guild_raid_victory_caches` WHERE `client_id` = ? AND `acknowledged_at` IS NULL) AS `pending`'
	).get(client_id) as { pending: number };
	if (membership === null)
		return { affiliation: 'none', cache_pending: cache_pending.pending === 1 };

	const cutover = raid_cutover();
	const raid = latest_raid(membership.guild_id);
	const cooldown_raid = latest_cooldown_raid(membership.guild_id, cutover);
	const legacy_blocked = cutover !== null && legacy_raid_client(mod_version);
	const available_at = legacy_blocked ? now + RAID_CUTOVER_PAUSE :
		cooldown_raid === null ? now : cooldown_raid.expires_at + RAID_COOLDOWN;
	return {
		affiliation: membership.guild_type,
		cache_pending: cache_pending.pending === 1,
		activation_available_at: available_at,
		can_activate: !legacy_blocked && now >= available_at,
		tier_defeats: guild_raid_tier_defeats(membership.guild_id, now),
		unlocked_tiers: raid_unlocked_tiers(client_id),
		raid: raid === null ? null : public_raid(raid, membership.membership_id, now)
	};
}

export function activate_raid(client_id: number, now = Date.now(), mod_version: string | null = null) {
	const activate = db.transaction(() => {
		const membership = membership_for(client_id);
		if (membership === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' } as const;

		const cutover = raid_cutover();
		if (cutover !== null && legacy_raid_client(mod_version))
			return { error_lang: 'MOD_MP_RAID_COOLDOWN' } as const;
		const previous = latest_cooldown_raid(membership.guild_id, cutover);
		if (previous !== null && now < previous.expires_at + RAID_COOLDOWN)
			return { error_lang: 'MOD_MP_RAID_COOLDOWN' } as const;

		const members = db.query(
			'SELECT membership.`id` AS `membership_id`, membership.`client_id`, client.`last_multiplayer_active_at` ' +
			'FROM `guild_memberships` AS membership JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
			'WHERE membership.`guild_id` = ? ORDER BY membership.`id`'
		).all(membership.guild_id) as Array<{ membership_id: number; client_id: number; last_multiplayer_active_at: number }>;
		const active_member_count = members.filter(
			member => member.last_multiplayer_active_at >= recently_active_cutoff(now)
		).length;
		const raid_player_count = Math.max(active_member_count, 1);
		const max_health = raid_max_health(raid_player_count);
		const inserted = db.query(
			'INSERT INTO `guild_raids` (`guild_id`, `started_at`, `expires_at`, `active_member_count`, ' +
			'`required_contributors`, `max_health`, `remaining_health`) VALUES(?, ?, ?, ?, ?, ?, ?) RETURNING `id`'
		).get(
			membership.guild_id, now, now + RAID_DURATION, raid_player_count,
			raid_player_count, max_health, max_health
		) as { id: number };
		const insert_roster = db.query(
			'INSERT INTO `guild_raid_roster` (`raid_id`, `membership_id`, `client_id`) VALUES(?, ?, ?)'
		);
		for (const member of members)
			insert_roster.run(inserted.id, member.membership_id, member.client_id);
		record_guild_activity({ guild_id: membership.guild_id, event_type: 'raid_started', actor_client_id: client_id,
			source_key: `raid:${inserted.id}:started`, created_at: now });
		return { raid_id: inserted.id, membership_id: membership.membership_id } as const;
	});

	const result = activate.immediate();
	if ('error_lang' in result)
		return result;
	const raid = latest_raid(membership_for(client_id)!.guild_id)!;
	return { success: true, raid: public_raid(raid, result.membership_id, now) };
}

export function reserve_assault(client_id: number, tier: number, loaded_session_id: string, now = Date.now(), mod_version: string | null = null) {
	if (!Number.isSafeInteger(tier) || RAID_TIER_PROGRESS[tier] === undefined ||
		typeof loaded_session_id !== 'string' || loaded_session_id.length < 8 || loaded_session_id.length > 128)
		return { status: 400 as const };

	const reserve = db.transaction(() => {
		const membership = membership_for(client_id);
		if (membership === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' } as const;
		const raid = latest_raid(membership.guild_id);
		if (raid === null || now >= raid.expires_at)
			return { error_lang: 'MOD_MP_RAID_INACTIVE' } as const;
		const roster = db.query(
			'SELECT * FROM `guild_raid_roster` WHERE `raid_id` = ? AND `membership_id` = ? AND `client_id` = ?'
		).get(raid.id, membership.membership_id, client_id) as RosterRow | null;
		if (roster === null)
			return { error_lang: 'MOD_MP_RAID_NOT_ELIGIBLE' } as const;
		if (assault_balance(raid, membership.membership_id, now) < 1)
			return { error_lang: 'MOD_MP_RAID_NO_ASSAULTS' } as const;
		const unresolved = db.query(
			'SELECT `id`, `loaded_session_id`, `settlement_key`, `tier`, `combat_deadline`, `fortified_resistance` ' +
			'FROM `guild_raid_assaults` WHERE `membership_id` = ? AND `outcome` IS NULL LIMIT 1'
		).get(membership.membership_id) as Pick<AssaultRow,
			'id' | 'loaded_session_id' | 'settlement_key' | 'tier' | 'combat_deadline' | 'fortified_resistance'> | null;
		if (unresolved !== null) {
			if (unresolved.loaded_session_id === loaded_session_id)
				return reservation_from_assault(unresolved);
			return { error_lang: 'MOD_MP_RAID_ASSAULT_PENDING' } as const;
		}
		if (tier > 1 && !raid_unlocked_tiers(client_id).includes(tier - 1))
			return { error_lang: 'MOD_MP_RAID_TIER_LOCKED' } as const;

		const assault_id = crypto.randomUUID();
		const settlement_key = crypto.randomUUID();
		const combat_deadline = now + ASSAULT_DURATION;
		const fortified_resistance = raid_fortified_resistance(guild_raid_tier_defeats(raid.guild_id, now)[tier]);
		const inbox_loot = legacy_raid_client(mod_version) ? 0 : 1;
		db.query(
			'INSERT INTO `guild_raid_assaults` (`id`, `raid_id`, `membership_id`, `client_id`, `tier`, ' +
			'`loaded_session_id`, `settlement_key`, `reserved_at`, `combat_deadline`, `settlement_deadline`, ' +
			'`fortified_resistance`, `inbox_loot`) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run(
			assault_id, raid.id, membership.membership_id, client_id, tier, loaded_session_id,
			settlement_key, now, combat_deadline, combat_deadline + ASSAULT_SETTLEMENT_GRACE,
			fortified_resistance, inbox_loot
		);
		db.query(
			'UPDATE `guild_raid_roster` SET `manual_assaults_remaining` = `manual_assaults_remaining` - 1 ' +
			'WHERE `raid_id` = ? AND `membership_id` = ? AND `manual_assaults_remaining` IS NOT NULL AND ' +
			'`manual_assaults_remaining` > 0'
		).run(raid.id, membership.membership_id);
		return { assault_id, settlement_key, tier, combat_deadline, fortified_resistance } as const;
	});
	return reserve.immediate();
}

export function abandon_assault(
	client_id: number,
	now = Date.now()
): { error_lang: 'MOD_MP_GUILD_REQUIRED' } | { success: true; abandoned: boolean } {
	const membership = membership_for(client_id);
	if (membership === null)
		return { error_lang: 'MOD_MP_GUILD_REQUIRED' } as const;

	const updated = db.query(
		'UPDATE `guild_raid_assaults` SET `outcome` = \'abandoned\', `occurred_at` = ?, `settled_at` = ? ' +
		'WHERE `membership_id` = ? AND `outcome` IS NULL'
	).run(now, now, membership.membership_id);
	return { success: true, abandoned: updated.changes === 1 } as const;
}

export function settle_assault(
	client_id: number,
	assault_id: string,
	settlement_key: string,
	outcome: RaidOutcome,
	occurred_at: number,
	now = Date.now()
) {
	if (typeof assault_id !== 'string' || typeof settlement_key !== 'string' ||
		!['success', 'death', 'flee', 'abandoned'].includes(outcome) || !Number.isSafeInteger(occurred_at))
		return { status: 400 as const };

	const settle = db.transaction(() => {
		const assault = db.query(
			'SELECT * FROM `guild_raid_assaults` WHERE `id` = ? AND `client_id` = ? AND `settlement_key` = ?'
		).get(assault_id, client_id, settlement_key) as AssaultRow | null;
		if (assault === null)
			return { status: 404 as const };
		if (assault.outcome !== null) {
			if (assault.outcome !== outcome || assault.occurred_at !== occurred_at)
				return { status: 409 as const };
			return { success: true, outcome: assault.outcome, credited_progress: assault.credited_progress, idempotent: true };
		}
		if (now > assault.settlement_deadline || occurred_at < assault.reserved_at || occurred_at > assault.combat_deadline) {
			// The client has already reached a terminal state, but the reported time is
			// no longer creditable. Close the one-shot reservation so a delayed or
			// clock-skewed terminal result cannot strand the member behind the
			// unresolved-Assault guard. Keep the submitted timestamp for exact retries.
			db.query(
				'UPDATE `guild_raid_assaults` SET `outcome` = \'abandoned\', `occurred_at` = ?, `settled_at` = ? ' +
				'WHERE `id` = ? AND `outcome` IS NULL'
			).run(occurred_at, now, assault.id);
			return { success: true, outcome: 'abandoned' as const, credited_progress: 0, idempotent: false };
		}

		let credited_progress = 0;
		const raid = db.query('SELECT * FROM `guild_raids` WHERE `id` = ?').get(assault.raid_id) as RaidRow | null;
		const roster = db.query(
			'SELECT roster.* FROM `guild_raid_roster` AS roster JOIN `guild_memberships` AS membership ' +
			'ON membership.`id` = roster.`membership_id` AND membership.`client_id` = roster.`client_id` ' +
			'WHERE roster.`raid_id` = ? AND roster.`membership_id` = ? AND roster.`client_id` = ?'
		).get(assault.raid_id, assault.membership_id, client_id) as RosterRow | null;
		if (outcome === 'success' && raid !== null && roster !== null) {
			if (assault.inbox_loot === 1 && can_receive_raid_rewards(client_id, now))
				add_inbox_items(client_id, [roll_raid_monster_drop(assault.tier, owns_toth(client_id))],
					{ type: 'raid_assault', name: String(assault.tier) });
			db.query(
				'INSERT INTO `raid_defeat_totals` (`client_id`, `tier`, `defeats`) VALUES(?, ?, 1) ' +
				'ON CONFLICT (`client_id`, `tier`) DO UPDATE SET `defeats` = `defeats` + 1'
			).run(client_id, assault.tier);
			db.query(
				'INSERT INTO `raid_tier_unlocks` (`client_id`, `tier`, `first_defeated_at`) VALUES(?, ?, ?) ' +
				'ON CONFLICT (`client_id`, `tier`) DO NOTHING'
			).run(client_id, assault.tier, now);
			record_guild_activity({ guild_id: raid.guild_id, event_type: 'raid_boss_defeated', actor_client_id: client_id,
				source_key: `raid-assault:${assault.id}:defeated`, metadata: { tier: assault.tier },
				created_at: now, throttled: true });
			credited_progress = RAID_TIER_PROGRESS[assault.tier];
			db.query(
				'UPDATE `guild_raid_roster` SET `contribution` = `contribution` + ?, ' +
				'`highest_tier` = MAX(`highest_tier`, ?), `successful_assaults` = `successful_assaults` + 1 ' +
				'WHERE `raid_id` = ? AND `membership_id` = ?'
			).run(credited_progress, assault.tier, raid.id, roster.membership_id);
			if (credited_progress > 0) {
				const remaining = Math.max(raid.remaining_health - credited_progress, 0);
				db.query(
					'UPDATE `guild_raids` SET `remaining_health` = ?, `secured_at` = CASE ' +
					'WHEN ? = 0 AND `secured_at` IS NULL THEN ? ELSE `secured_at` END WHERE `id` = ?'
				).run(remaining, remaining, now, raid.id);
				if (remaining === 0 && raid.remaining_health > 0) {
					grant_secured_caches(raid.id, now);
					record_guild_activity({ guild_id: raid.guild_id, event_type: 'raid_completed',
						source_key: `raid:${raid.id}:completed`, created_at: now });
				}
			}
			const secured = raid.remaining_health === 0 || raid.remaining_health - credited_progress === 0;
			if (secured)
				create_cache(raid.id, roster, now);
		}

		db.query(
			'UPDATE `guild_raid_assaults` SET `outcome` = ?, `occurred_at` = ?, `settled_at` = ?, ' +
			'`credited_progress` = ? WHERE `id` = ? AND `outcome` IS NULL'
		).run(outcome, occurred_at, now, credited_progress, assault.id);
		return { success: true, outcome, credited_progress, idempotent: false };
	});
	return settle.immediate();
}

export function get_victory_cache(client_id: number) {
	const cache = db.query(
		'SELECT `id`, `raid_id`, `created_at`, `items_json` FROM `guild_raid_victory_caches` ' +
		'WHERE `client_id` = ? AND `acknowledged_at` IS NULL ORDER BY `created_at`, `id` LIMIT 1'
	).get(client_id) as { id: string; raid_id: number; created_at: number; items_json: string } | null;
	if (cache === null) return { cache: null };
	const { items_json, ...details } = cache;
	return { cache: { ...details, items: JSON.parse(items_json) as Array<{ item_id: string; qty: number }> } };
}

export function acknowledge_victory_cache(client_id: number, cache_id: string, now = Date.now()) {
	if (typeof cache_id !== 'string')
		return { status: 400 as const };
	const updated = db.query(
		'UPDATE `guild_raid_victory_caches` SET `acknowledged_at` = ? ' +
		'WHERE `id` = ? AND `client_id` = ? AND `acknowledged_at` IS NULL'
	).run(now, cache_id, client_id);
	if (updated.changes === 1)
		return { success: true };
	const exists = db.query(
		'SELECT 1 FROM `guild_raid_victory_caches` WHERE `id` = ? AND `client_id` = ? AND `acknowledged_at` IS NOT NULL'
	).get(cache_id, client_id);
	return exists === null ? { status: 404 as const } : { success: true, idempotent: true };
}
