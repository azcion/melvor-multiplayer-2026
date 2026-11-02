import type { Database } from 'bun:sqlite';

export const EXPEDITION_LEADERBOARD_WINDOW_MS = 7 * 24 * 60 * 60_000;
const PAGE_SIZE = 10;
type LeaderboardRow = { client_id: number; display_name: string; icon_id: string; guild_name: string | null; points_micros: number };

// Earnings are attributed when settled, independently of Guild, balance, spending or refunds.
export function expedition_leaderboard(database: Database, requested_page = 0, now = Date.now()) {
	const since = Math.max(0, now - EXPEDITION_LEADERBOARD_WINDOW_MS);
	const earnings = `WITH earnings AS (
		SELECT ledger.client_id, SUM(ledger.points_micros) AS points_micros
		FROM expedition_ep_ledger AS ledger JOIN clients AS client ON client.id = ledger.client_id
		WHERE ledger.created_at >= ? AND ledger.created_at <= ? AND client.deleted_at IS NULL AND client.disabled = 0
		GROUP BY ledger.client_id HAVING SUM(ledger.points_micros) > 0
	)`;
	return database.transaction(() => {
		const total = database.query<{ total: number }, [number, number]>(earnings + ' SELECT COUNT(*) AS total FROM earnings').get(since, now)!.total;
		const page = Math.min(requested_page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
		const players = database.query<LeaderboardRow, [number, number, number]>(earnings + `
			SELECT earnings.client_id, client.display_name, client.icon_id, guild.name AS guild_name, earnings.points_micros
			FROM earnings JOIN clients AS client ON client.id = earnings.client_id
			LEFT JOIN guild_memberships AS membership ON membership.client_id = client.id
			LEFT JOIN guilds AS guild ON guild.id = membership.guild_id
			ORDER BY earnings.points_micros DESC, earnings.client_id ASC LIMIT 10 OFFSET ?`
		).all(since, now, page * PAGE_SIZE);
		return { page, total, players, since, as_of: now };
	})();
}
