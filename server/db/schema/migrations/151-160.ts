import type { Migration } from '../types';

export const migrations_151_160: Migration[] = [{
	version: 151,
	preflight_sql: `SELECT COUNT(*) AS problems FROM (
		SELECT score.client_id FROM expedition_supply_scores AS score
		LEFT JOIN expedition_ep_ledger AS ledger ON ledger.client_id = score.client_id
			AND ledger.source_kind = 'supply'
		LEFT JOIN expeditions AS expedition ON expedition.id = ledger.expedition_id
		GROUP BY score.client_id HAVING COUNT(DISTINCT ledger.expedition_id) != 1
			OR COUNT(DISTINCT expedition.id) != 1
	)`,
	sql: `
		CREATE TABLE expedition_supply_scores_by_run (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			expedition_id INTEGER NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
			value_gp_equiv INTEGER NOT NULL DEFAULT 0 CHECK (value_gp_equiv >= 0 AND value_gp_equiv <= 9007199254740991),
			score_micros INTEGER NOT NULL DEFAULT 0 CHECK (score_micros >= 0),
			PRIMARY KEY (client_id, expedition_id)
		) STRICT;
		INSERT INTO expedition_supply_scores_by_run (client_id, expedition_id, value_gp_equiv, score_micros)
		SELECT score.client_id, MIN(ledger.expedition_id), score.value_gp_equiv, score.score_micros
		FROM expedition_supply_scores AS score
		JOIN expedition_ep_ledger AS ledger ON ledger.client_id = score.client_id
			AND ledger.source_kind = 'supply'
		GROUP BY score.client_id;
		DROP TABLE expedition_supply_scores;
		ALTER TABLE expedition_supply_scores_by_run RENAME TO expedition_supply_scores;
	`
}, {
	version: 152,
	sql: `
		ALTER TABLE expedition_work_sessions ADD COLUMN start_clock_offset_ms INTEGER;
		ALTER TABLE expedition_work_sessions ADD COLUMN pending_reported_capture_at INTEGER;
		ALTER TABLE expedition_work_claims ADD COLUMN start_clock_offset_ms INTEGER;
		ALTER TABLE expedition_work_claims ADD COLUMN pending_reported_capture_at INTEGER;
		DROP TRIGGER expedition_claim_on_guild_delete;
		CREATE TRIGGER expedition_claim_on_guild_delete BEFORE DELETE ON guilds BEGIN
			INSERT OR IGNORE INTO expedition_work_claims
				(session_id, client_id, expedition_id, visit_id, task_id, started_at, cutoff_at,
				start_statistics, start_activities, evidence_skill_ids, last_observed_at, max_observation_gap_ms,
				pending_boundary_at, pending_capture_at, start_clock_offset_ms, pending_reported_capture_at)
			SELECT session.id, session.client_id, session.expedition_id, session.visit_id, session.task_id,
				session.started_at,
				MAX(session.started_at, MIN(COALESCE(tenure.ended_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
				CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))),
				session.start_statistics, session.start_activities, session.evidence_skill_ids,
				session.last_observed_at, session.max_observation_gap_ms,
				session.pending_boundary_at, session.pending_capture_at, session.start_clock_offset_ms, session.pending_reported_capture_at
			FROM expedition_work_sessions AS session
			JOIN expeditions AS expedition ON expedition.id = session.expedition_id
			JOIN expedition_membership_tenures AS tenure ON tenure.id = session.tenure_id
			WHERE expedition.guild_id = OLD.id AND session.ended_at IS NULL;
		END;
	`
}];
