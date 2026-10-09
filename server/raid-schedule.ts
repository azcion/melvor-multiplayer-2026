import type { Database } from 'bun:sqlite';
import { recently_active_cutoff } from './recent-activity';

export const RAID_WEEK = 7 * 24 * 60 * 60 * 1000;
export const RAID_WEEKEND = 72 * 60 * 60 * 1000;
// Friday 1970-01-02 at 12:00 UTC. UTC arithmetic does not observe DST.
const RAID_FRIDAY = 129_600_000;

export function raid_weekend(now: number) {
	const starts_at = RAID_FRIDAY + Math.floor((now - RAID_FRIDAY) / RAID_WEEK) * RAID_WEEK;
	const ends_at = starts_at + RAID_WEEKEND;
	return { starts_at, ends_at, active: now >= starts_at && now < ends_at,
		next_starts_at: starts_at + RAID_WEEK };
}

export function raid_schedule_state(database: Database, now: number) {
	const first = database.query<{ starts_at: number }, []>('SELECT starts_at FROM raid_schedule WHERE id = 1').get();
	if (first === null) throw new Error('Raid schedule is missing');
	const weekend = raid_weekend(now);
	const active = weekend.active && weekend.starts_at >= first.starts_at;
	return { ...weekend, active, first_starts_at: first.starts_at,
		available_at: active ? weekend.starts_at : Math.max(first.starts_at, weekend.next_starts_at) };
}

// Use the same operation from startup, the timer, and request-time recovery.
// Persisted cycle uniqueness protects concurrent callers and completed Raids.
export function maintain_global_raids(database: Database, now: number,
	max_health_for: (players: number) => number, guild_id?: number): number {
	return database.transaction(() => {
		const window = raid_schedule_state(database, now);
		if (!window.active) return 0;
		const guilds = database.query<{ id: number }, [number, number | null, number | null, number]>(
			'SELECT id FROM guilds WHERE COALESCE(created_at, 0) <= ? AND (? IS NULL OR id = ?) ' +
			'AND NOT EXISTS (SELECT 1 FROM guild_raids WHERE guild_id = guilds.id AND cycle_start = ?)'
		).all(window.starts_at, guild_id ?? null, guild_id ?? null, window.starts_at);
		let created = 0;
		for (const guild of guilds) {
			const members = database.query<{ id: number; client_id: number; last_multiplayer_active_at: number }, [number, number]>(
				'SELECT m.id, m.client_id, c.last_multiplayer_active_at FROM guild_memberships m ' +
				'JOIN clients c ON c.id = m.client_id WHERE m.guild_id = ? AND m.joined_at <= ? ' +
				'AND c.deleted_at IS NULL ORDER BY m.id'
			).all(guild.id, window.starts_at);
			if (members.length === 0) continue;
			const players = Math.max(1, members.filter(m => m.last_multiplayer_active_at >= recently_active_cutoff(window.starts_at)).length);
			const health = max_health_for(players);
			const raid = database.query<{ id: number }, [number, number, number, number, number, number, number, number]>(
				'INSERT INTO guild_raids(guild_id, started_at, expires_at, active_member_count, ' +
				'required_contributors, max_health, remaining_health, cycle_start) VALUES(?, ?, ?, ?, ?, ?, ?, ?) RETURNING id'
			).get(guild.id, window.starts_at, window.ends_at, players, players, health, health, window.starts_at)!;
			const roster = database.query('INSERT INTO guild_raid_roster(raid_id, membership_id, client_id) VALUES(?, ?, ?)');
			for (const member of members) roster.run(raid.id, member.id, member.client_id);
			database.query('INSERT INTO guild_activity_events(guild_id, event_type, source_key, created_at, metadata) ' +
				"VALUES(?, 'raid_started', ?, ?, '{}') ON CONFLICT(guild_id, source_key) DO NOTHING")
				.run(guild.id, `raid:${raid.id}:started`, window.starts_at);
			database.query('UPDATE clients SET event_revision = event_revision + 1 WHERE id IN ' +
				'(SELECT client_id FROM guild_memberships WHERE guild_id = ?)').run(guild.id);
			created++;
		}
		return created;
	}).immediate();
}
