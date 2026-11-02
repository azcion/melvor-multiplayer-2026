import type { Database } from 'bun:sqlite';
import { DUNGEONS } from './combat/raids';
type LeaderboardRow = { client_id: number; display_name: string; icon_id: string; elapsed_ms: number; achieved_at: number };
export function combat_leaderboard(database: Database, requested_page = 0, raid = 'golbins') {
	const eligible = `FROM combat_raid_records r JOIN clients c ON c.id=r.client_id
		WHERE r.raid=? AND r.ruleset=? AND c.deleted_at IS NULL AND c.disabled=0`;
	const total = database.query<{ total: number }, [string, string]>('SELECT COUNT(*) AS total ' + eligible).get(raid,DUNGEONS[raid].ruleset)!.total;
	const page = Math.min(Math.max(0, Number.isSafeInteger(requested_page) ? requested_page : 0), Math.max(0, Math.ceil(total / 10) - 1));
	const players = database.query<LeaderboardRow, [string, string, number]>(`SELECT r.client_id,c.display_name,c.icon_id,r.elapsed_ms,r.achieved_at ` + eligible +
		' ORDER BY r.elapsed_ms,r.achieved_at,r.client_id LIMIT 10 OFFSET ?').all(raid,DUNGEONS[raid].ruleset,page * 10);
	return { raid, ruleset: DUNGEONS[raid].ruleset, page, total, players };
}
