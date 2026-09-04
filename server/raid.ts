import { db } from './db';
import { shadowed_cutoff } from './shadowed';
import { record_guild_activity } from './guild-activity';
import { add_inbox_items } from './inbox';
import { client_uses_legacy_transfer_protocol } from './transfer-compatibility';

export const RAID_DURATION = 72 * 60 * 60 * 1000;
export const RAID_COOLDOWN = 96 * 60 * 60 * 1000;
export const ASSAULT_DURATION = 30 * 60 * 1000;
export const ASSAULT_SETTLEMENT_GRACE = 24 * 60 * 60 * 1000;
export const RAID_MAX_HEALTH = 9_000;
export const RAID_TIER_PROGRESS = Object.freeze<Record<number, number>>({
	1: 1_000,
	2: 1_800,
	3: 3_000,
	4: 4_500
});
export const RAID_VICTORY_CACHE = Object.freeze([
	{ item_id: 'melvorF:Summoning_Familiar_Wolf', qty: 100 },
	{ item_id: 'melvorF:Summoning_Familiar_Minotaur', qty: 100 },
	{ item_id: 'melvorF:Summoning_Familiar_Yak', qty: 75 },
	{ item_id: 'melvorD:Dragon_Bones', qty: 25 },
	{ item_id: 'melvorD:Diamond', qty: 20 }
]);

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

function create_cache(raid_id: number, roster: Pick<RosterRow, 'membership_id' | 'client_id'>, now: number): void {
	const client = db.query<{ social_mode: 'full' | 'social' }, [number]>(
		'SELECT `social_mode` FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(roster.client_id);
	if (client?.social_mode === 'social')
		return;
	if (!client_uses_legacy_transfer_protocol(roster.client_id)) {
		const inserted = db.query(
			'INSERT OR IGNORE INTO `guild_raid_victory_caches` ' +
			'(`id`, `raid_id`, `membership_id`, `client_id`, `created_at`, `acknowledged_at`) VALUES(?, ?, ?, ?, ?, ?)'
		).run(crypto.randomUUID(), raid_id, roster.membership_id, roster.client_id, now, now);
		if (inserted.changes === 1)
			add_inbox_items(roster.client_id, RAID_VICTORY_CACHE);
		return;
	}
	db.query(
		'INSERT OR IGNORE INTO `guild_raid_victory_caches` ' +
		'(`id`, `raid_id`, `membership_id`, `client_id`, `created_at`) VALUES(?, ?, ?, ?, ?)'
	).run(crypto.randomUUID(), raid_id, roster.membership_id, roster.client_id, now);
}

function reservation_from_assault(assault: Pick<AssaultRow, 'id' | 'settlement_key' | 'tier' | 'combat_deadline'>) {
	return {
		assault_id: assault.id,
		settlement_key: assault.settlement_key,
		tier: assault.tier,
		combat_deadline: assault.combat_deadline
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
	const contribution_cap = Math.floor(raid.max_health / raid.required_contributors);
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
		contribution_cap,
		member: roster === null ? null : {
			eligible: true,
			contribution: roster.contribution,
			highest_tier: roster.highest_tier,
			successful_assaults: roster.successful_assaults,
			assaults: assault_balance(raid, membership_id, now)
		},
		leaderboard
	};
}

export function get_raid_state(client_id: number, now = Date.now()) {
	const membership = membership_for(client_id);
	const cache_pending = db.query(
		'SELECT EXISTS(SELECT 1 FROM `guild_raid_victory_caches` WHERE `client_id` = ? AND `acknowledged_at` IS NULL) AS `pending`'
	).get(client_id) as { pending: number };
	if (membership === null)
		return { affiliation: 'none', cache_pending: cache_pending.pending === 1 };

	const raid = latest_raid(membership.guild_id);
	const available_at = raid === null ? now : raid.expires_at + RAID_COOLDOWN;
	return {
		affiliation: membership.guild_type,
		cache_pending: cache_pending.pending === 1,
		activation_available_at: available_at,
		can_activate: raid === null || now >= available_at,
		raid: raid === null ? null : public_raid(raid, membership.membership_id, now)
	};
}

export function activate_raid(client_id: number, now = Date.now()) {
	const activate = db.transaction(() => {
		const membership = membership_for(client_id);
		if (membership === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' } as const;

		const previous = latest_raid(membership.guild_id);
		if (previous !== null && now < previous.expires_at + RAID_COOLDOWN)
			return { error_lang: 'MOD_MP_RAID_COOLDOWN' } as const;

		const members = db.query(
			'SELECT membership.`id` AS `membership_id`, membership.`client_id`, client.`last_multiplayer_active_at` ' +
			'FROM `guild_memberships` AS membership JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
			'WHERE membership.`guild_id` = ? ORDER BY membership.`id`'
		).all(membership.guild_id) as Array<{ membership_id: number; client_id: number; last_multiplayer_active_at: number }>;
		const active_member_count = members.filter(
			member => member.last_multiplayer_active_at >= shadowed_cutoff(now)
		).length;
		const required_contributors = active_member_count <= 1
			? 1
			: Math.min(5, Math.max(2, Math.ceil(active_member_count * 0.4)));
		const inserted = db.query(
			'INSERT INTO `guild_raids` (`guild_id`, `started_at`, `expires_at`, `active_member_count`, ' +
			'`required_contributors`, `max_health`, `remaining_health`) VALUES(?, ?, ?, ?, ?, ?, ?) RETURNING `id`'
		).get(
			membership.guild_id, now, now + RAID_DURATION, Math.max(active_member_count, 1),
			required_contributors, RAID_MAX_HEALTH, RAID_MAX_HEALTH
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

export function reserve_assault(client_id: number, tier: number, loaded_session_id: string, now = Date.now()) {
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
			'SELECT `id`, `loaded_session_id`, `settlement_key`, `tier`, `combat_deadline` ' +
			'FROM `guild_raid_assaults` WHERE `membership_id` = ? AND `outcome` IS NULL LIMIT 1'
		).get(membership.membership_id) as Pick<AssaultRow,
			'id' | 'loaded_session_id' | 'settlement_key' | 'tier' | 'combat_deadline'> | null;
		if (unresolved !== null) {
			if (unresolved.loaded_session_id === loaded_session_id)
				return reservation_from_assault(unresolved);
			return { error_lang: 'MOD_MP_RAID_ASSAULT_PENDING' } as const;
		}

		const assault_id = crypto.randomUUID();
		const settlement_key = crypto.randomUUID();
		const combat_deadline = now + ASSAULT_DURATION;
		db.query(
			'INSERT INTO `guild_raid_assaults` (`id`, `raid_id`, `membership_id`, `client_id`, `tier`, ' +
			'`loaded_session_id`, `settlement_key`, `reserved_at`, `combat_deadline`, `settlement_deadline`) ' +
			'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
		).run(
			assault_id, raid.id, membership.membership_id, client_id, tier, loaded_session_id,
			settlement_key, now, combat_deadline, combat_deadline + ASSAULT_SETTLEMENT_GRACE
		);
		db.query(
			'UPDATE `guild_raid_roster` SET `manual_assaults_remaining` = `manual_assaults_remaining` - 1 ' +
			'WHERE `raid_id` = ? AND `membership_id` = ? AND `manual_assaults_remaining` IS NOT NULL AND ' +
			'`manual_assaults_remaining` > 0'
		).run(raid.id, membership.membership_id);
		return { assault_id, settlement_key, tier, combat_deadline } as const;
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
			record_guild_activity({ guild_id: raid.guild_id, event_type: 'raid_boss_defeated', actor_client_id: client_id,
				source_key: `raid-assault:${assault.id}:defeated`, metadata: { tier: assault.tier },
				created_at: now, throttled: true });
			const cap = Math.floor(raid.max_health / raid.required_contributors);
			credited_progress = Math.min(
				RAID_TIER_PROGRESS[assault.tier],
				Math.max(cap - roster.contribution, 0),
				raid.remaining_health
			);
			db.query(
				'UPDATE `guild_raid_roster` SET `contribution` = `contribution` + ?, ' +
				'`highest_tier` = MAX(`highest_tier`, ?), `successful_assaults` = `successful_assaults` + 1 ' +
				'WHERE `raid_id` = ? AND `membership_id` = ?'
			).run(credited_progress, assault.tier, raid.id, roster.membership_id);
			if (credited_progress > 0) {
				const remaining = raid.remaining_health - credited_progress;
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
		'SELECT `id`, `raid_id`, `created_at` FROM `guild_raid_victory_caches` ' +
		'WHERE `client_id` = ? AND `acknowledged_at` IS NULL ORDER BY `created_at`, `id` LIMIT 1'
	).get(client_id) as { id: string; raid_id: number; created_at: number } | null;
	return cache === null ? { cache: null } : { cache: { ...cache, items: RAID_VICTORY_CACHE } };
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
