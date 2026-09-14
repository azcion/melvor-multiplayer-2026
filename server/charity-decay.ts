import type { Database } from 'bun:sqlite';

export const CHARITY_NORMAL_DECAY_MS = 4 * 24 * 60 * 60 * 1000;
export const CHARITY_DECAY_MINIMUM_REMAINING_MS = 2 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type CharityDecayPolicy = {
	started_at: number;
	ends_at: number;
	effective_lifetime_ms: number;
};

export type CharityDecayContext = {
	activation_at: number;
	effective_lifetime_ms: number;
};

function read_setting(database: Database, key: string): number {
	const value = Number(database.query<{ value: string }, [string]>(
		'SELECT `value` FROM `service_settings` WHERE `key` = ?'
	).get(key)?.value);
	return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function get_timed_wish_promo_decay_policy(
	database: Database,
	now = Date.now()
): CharityDecayPolicy | null {
	const started_at = read_setting(database, 'charity_wish_promo_started_at');
	const ends_at = read_setting(database, 'charity_wish_promo_ends_at');
	const effective_hours = read_setting(database, 'charity_wish_promo_decay_hours');
	const effective_lifetime_ms = effective_hours * HOUR_MS;
	if (started_at > now || ends_at <= now || effective_hours < 1 || effective_lifetime_ms >= CHARITY_NORMAL_DECAY_MS)
		return null;
	return { started_at, ends_at, effective_lifetime_ms };
}

function sync_decay_activation(guild_id: number, now: number, database: Database): number | null {
	const active_wish = database.query<{ created_at: number }, [number]>(
		'SELECT MIN(`created_at`) AS `created_at` FROM `charity_wishes` ' +
		'WHERE `guild_id` = ? AND `progress_gp` < `required_gp`'
	).get(guild_id);
	if (active_wish?.created_at === null || active_wish?.created_at === undefined) {
		database.query('DELETE FROM `charity_decay_activations` WHERE `guild_id` = ?').run(guild_id);
		return null;
	}
	const existing = database.query<{ activated_at: number }, [number]>(
		'SELECT `activated_at` FROM `charity_decay_activations` WHERE `guild_id` = ?'
	).get(guild_id);
	if (existing !== null) return existing.activated_at;
	const activated_at = Math.min(now, active_wish.created_at);
	database.query('INSERT INTO `charity_decay_activations` (`guild_id`, `activated_at`) VALUES(?, ?)')
		.run(guild_id, activated_at);
	return activated_at;
}

export function get_charity_decay_context(
	guild_id: number,
	database: Database,
	now = Date.now()
): CharityDecayContext | null {
	const wish_activation_at = sync_decay_activation(guild_id, now, database);
	if (wish_activation_at === null) return null;
	const policy = get_timed_wish_promo_decay_policy(database, now);
	if (policy === null) return null;
	return {
		activation_at: Math.max(policy.started_at, wish_activation_at),
		effective_lifetime_ms: policy.effective_lifetime_ms
	};
}

export function get_effective_charity_expiry(
	canonical_expires_at: number,
	context: CharityDecayContext | null
): number {
	if (canonical_expires_at === 0 || context === null) return canonical_expires_at;
	const floor_at = context.activation_at + CHARITY_DECAY_MINIMUM_REMAINING_MS;
	if (canonical_expires_at <= floor_at) return canonical_expires_at;
	const reduction_ms = CHARITY_NORMAL_DECAY_MS - context.effective_lifetime_ms;
	return Math.max(floor_at, canonical_expires_at - reduction_ms);
}
