import { db } from './db';

export const GUILD_ACTIVITY_PAGE_SIZE = 20;
export const GUILD_ACTIVITY_THROTTLE = 12 * 60 * 60 * 1000;

export type GuildActivityType =
	| 'joined' | 'left' | 'banished' | 'charitree_donated' | 'raid_started'
	| 'raid_boss_defeated' | 'raid_completed' | 'market_listing_created'
	| 'petition_raised' | 'petition_carried' | 'petition_defeated'
	| 'campaign_started' | 'campaign_completed' | 'campaign_contributed';

type ActivityInput = {
	guild_id: number;
	event_type: GuildActivityType;
	source_key: string;
	actor_client_id?: number;
	metadata?: Record<string, string | number>;
	created_at?: number;
	throttled?: boolean;
};

export function record_guild_activity(input: ActivityInput): boolean {
	const created_at = input.created_at ?? Date.now();
	let actor_display_name: string | null = null;
	if (input.actor_client_id !== undefined) {
		actor_display_name = (db.query('SELECT `display_name` FROM `clients` WHERE `id` = ? LIMIT 1')
			.get(input.actor_client_id) as { display_name: string } | null)?.display_name ?? null;
		if (actor_display_name === null)
			return false;
	}
	if (input.throttled && input.actor_client_id !== undefined) {
		const recent = db.query(
			'SELECT 1 FROM `guild_activity_events` WHERE `guild_id` = ? AND `actor_client_id` = ? ' +
			'AND `event_type` = ? AND `created_at` > ? LIMIT 1'
		).get(input.guild_id, input.actor_client_id, input.event_type, created_at - GUILD_ACTIVITY_THROTTLE);
		if (recent !== null)
			return false;
	}
	const inserted = db.query(
		'INSERT INTO `guild_activity_events` (`guild_id`, `event_type`, `actor_client_id`, ' +
		'`actor_display_name`, `metadata`, `source_key`, `created_at`) VALUES(?, ?, ?, ?, ?, ?, ?) ' +
		'ON CONFLICT (`guild_id`, `source_key`) DO NOTHING'
	).run(input.guild_id, input.event_type, input.actor_client_id ?? null, actor_display_name,
		JSON.stringify(input.metadata ?? {}), input.source_key, created_at);
	return inserted.changes === 1;
}

export function get_guild_activity(guild_id: number, cursor: { created_at: number; id: number } | null) {
	const rows = db.query(
		'SELECT `id`, `event_type`, `actor_client_id`, `actor_display_name`, `metadata`, `created_at` ' +
		'FROM `guild_activity_events` WHERE `guild_id` = ? ' +
		(cursor === null ? '' : 'AND (`created_at` < ? OR (`created_at` = ? AND `id` < ?)) ') +
		'ORDER BY `created_at` DESC, `id` DESC LIMIT ?'
	).all(...(cursor === null
		? [guild_id, GUILD_ACTIVITY_PAGE_SIZE + 1]
		: [guild_id, cursor.created_at, cursor.created_at, cursor.id, GUILD_ACTIVITY_PAGE_SIZE + 1])) as Array<{
		id: number; event_type: GuildActivityType; actor_client_id: number | null;
		actor_display_name: string | null; metadata: string; created_at: number;
	}>;
	const has_more = rows.length > GUILD_ACTIVITY_PAGE_SIZE;
	const page = rows.slice(0, GUILD_ACTIVITY_PAGE_SIZE);
	return {
		events: page.map(row => ({
			...row,
			actor_client_id: row.event_type.startsWith('petition_') ? null : row.actor_client_id,
			actor_display_name: row.event_type.startsWith('petition_') ? null : row.actor_display_name,
			metadata: JSON.parse(row.metadata)
		})),
		next_cursor: has_more && page.length > 0
			? `${page[page.length - 1].created_at}:${page[page.length - 1].id}`
			: null
	};
}

export function parse_guild_activity_cursor(value: string | null): { created_at: number; id: number } | null | false {
	if (value === null)
		return null;
	const match = /^(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(value);
	if (match === null)
		return false;
	const created_at = Number(match[1]);
	const id = Number(match[2]);
	return Number.isSafeInteger(created_at) && Number.isSafeInteger(id) && id > 0 ? { created_at, id } : false;
}
