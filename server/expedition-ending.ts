import type { Database } from 'bun:sqlite';
import { settle_wish_capacity } from './wish-capacity';
import { record_economy_operation } from './save-rollback';

export function get_expedition_return_summary(db: Database, client_id: number, expedition_id: number) {
	const record = db.query<{ registered_at: number; ended_at: number | null; status: string; ending_bonus_eligible: number }, [number, number]>(
		'SELECT registered_at, ended_at, status, ending_bonus_eligible FROM expedition_personal_records WHERE client_id=? AND expedition_id=?'
	).get(client_id, expedition_id);
	if (!record) return null;
	const earnings = db.query<{ earned_points_micros: number; bonus_claimed_micros: number }, [number, number]>(
		`SELECT COALESCE(SUM(CASE WHEN source_kind <> 'ending' THEN points_micros ELSE 0 END),0) AS earned_points_micros,
		COALESCE(SUM(CASE WHEN source_kind = 'ending' THEN points_micros ELSE 0 END),0) AS bonus_claimed_micros
		FROM expedition_ep_ledger WHERE client_id=? AND expedition_id=?`
	).get(client_id, expedition_id)!;
	const work = db.query<{ contributed_ms: number; chamber_count: number }, [number, number]>(
		`SELECT COALESCE(SUM(session.credited_ms),0) AS contributed_ms,
		COUNT(DISTINCT CASE WHEN session.guild_ms > 0 AND visit.chamber_id <> 'rift_preparations' THEN visit.chamber_id END) AS chamber_count
		FROM expedition_work_sessions AS session JOIN expedition_visits AS visit ON visit.id=session.visit_id
		WHERE session.client_id=? AND session.expedition_id=?`
	).get(client_id, expedition_id)!;
	const bonus_total_micros = record.status === 'completed' && record.ending_bonus_eligible
		? Math.floor(earnings.earned_points_micros / 5) : 0;
	return { ...record, ...earnings, ...work, bonus_total_micros,
		bonus_available_micros: Math.max(0, bonus_total_micros - earnings.bonus_claimed_micros) };
}

// Only server-owned EP moves: the transaction itself is the durable claim/retry boundary.
export function claim_expedition_ending(db: Database, client_id: number, expedition_id: number, now = Date.now()) {
	return db.transaction(() => {
		const summary = get_expedition_return_summary(db, client_id, expedition_id);
		if (!summary || summary.status !== 'completed' || !summary.ending_bonus_eligible) return null;
		const amount = summary.bonus_available_micros;
		if (amount > 0) {
			const balance = db.query<{ points_micros: number }, [number]>('SELECT points_micros FROM expedition_ep_balances WHERE client_id=?').get(client_id)?.points_micros ?? 0;
			if (!Number.isSafeInteger(balance + amount)) return null;
			settle_wish_capacity(db, client_id, now);
			const claim = db.query('INSERT INTO expedition_ending_claims(client_id,expedition_id,points_micros,created_at) VALUES(?,?,?,?)')
				.run(client_id, expedition_id, amount, now);
			db.query("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at,expedition_id) VALUES(?,'ending',?,?,?,?)")
				.run(client_id, Number(claim.lastInsertRowid), amount, now, expedition_id);
			db.query('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET points_micros=points_micros+excluded.points_micros')
				.run(client_id, amount);
			record_economy_operation(db, { source_key: `expedition-ending:${claim.lastInsertRowid}`, client_id,
				kind: 'expedition-ending', local_effect: 'server_only', committed_at: now,
				evidence: { expedition_id, points_micros: amount } });
		}
		return { success: true, claimed_points_micros: amount };
	}).immediate();
}

export function unclaimed_expedition_endings(db: Database, client_id: number) {
	return db.query<{ expedition_id: number; bonus_available_micros: number }, [number]>(`
		SELECT record.expedition_id,
		CAST(SUM(CASE WHEN ledger.source_kind <> 'ending' THEN ledger.points_micros ELSE 0 END)/5 AS INTEGER)
		- SUM(CASE WHEN ledger.source_kind = 'ending' THEN ledger.points_micros ELSE 0 END) AS bonus_available_micros
		FROM expedition_personal_records AS record JOIN expedition_ep_ledger AS ledger
		ON ledger.client_id=record.client_id AND ledger.expedition_id=record.expedition_id
		WHERE record.client_id=? AND record.status='completed' AND record.ending_bonus_eligible=1
		GROUP BY record.expedition_id HAVING bonus_available_micros > 0
		ORDER BY record.expedition_id DESC LIMIT 50
	`).all(client_id);
}
