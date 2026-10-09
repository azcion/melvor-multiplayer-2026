import { Database } from 'bun:sqlite';
import { post_json } from './http';
import { raid_max_health, RAID_DURATION } from '../../raid';
import { recently_active_cutoff } from '../../recent-activity';

// Existing HTTP combat/reward fixtures model an in-flight legacy Raid during
// rollout, so they run on any weekday without overriding the production clock.
export function seed_transition_raid(session_token: string): void {
	const database = new Database(process.env.TEST_DB_PATH!, { strict: true });
	try {
		database.run('PRAGMA foreign_keys = ON');
		database.run('PRAGMA busy_timeout = 5000');
		database.transaction(() => {
			const guild = database.query<{ guild_id: number }, [string]>(
				'SELECT m.guild_id FROM guild_memberships m JOIN client_sessions s ON s.client_id = m.client_id WHERE s.session_token = ?'
			).get(session_token);
			if (!guild || database.query('SELECT 1 FROM guild_raids WHERE guild_id = ?').get(guild.guild_id)) return;
			const now = Date.now();
			const members = database.query<{ id: number; client_id: number; last_multiplayer_active_at: number }, [number]>(
				'SELECT m.id, m.client_id, c.last_multiplayer_active_at FROM guild_memberships m JOIN clients c ON c.id = m.client_id WHERE m.guild_id = ?'
			).all(guild.guild_id);
			const count = Math.max(1, members.filter(m => m.last_multiplayer_active_at >= recently_active_cutoff(now)).length);
			const health = raid_max_health(count);
			const raid = database.query<{ id: number }, [number, number, number, number, number, number, number]>(
				'INSERT INTO guild_raids(guild_id, started_at, expires_at, active_member_count, required_contributors, max_health, remaining_health) VALUES(?, ?, ?, ?, ?, ?, ?) RETURNING id'
			).get(guild.guild_id, now, now + RAID_DURATION, count, count, health, health)!;
			for (const member of members)
				database.query('INSERT INTO guild_raid_roster(raid_id, membership_id, client_id) VALUES(?, ?, ?)')
					.run(raid.id, member.id, member.client_id);
		}).immediate();
	} finally { database.close(); }
}

export async function enter_transition_raid<T>(route: '/api/raids/activate', body: Record<string, unknown>, session_token: string) {
	seed_transition_raid(session_token);
	return post_json<T>(route, body, session_token);
}
