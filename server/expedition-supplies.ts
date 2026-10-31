import { db } from './db';

// Historical donation score retained for recovery and audit views.
export function get_expedition_supply_score(client_id: number, expedition_id: number | null) {
	const score = expedition_id === null ? null : db.query<
		{ value_gp_equiv: number; score_micros: number }, [number, number]>(
		'SELECT value_gp_equiv, score_micros FROM expedition_supply_scores WHERE client_id = ? AND expedition_id = ?'
	).get(client_id, expedition_id);
	return { value_gp_equiv: score?.value_gp_equiv ?? 0, score_micros: score?.score_micros ?? 0 };
}
