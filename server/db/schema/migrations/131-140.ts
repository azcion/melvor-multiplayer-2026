import type { Migration } from '../types';

export const migrations_131_140: Migration[] = [{
	version: 131,
	sql: `
		CREATE TABLE expedition_supply_scores (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			value_gp_equiv INTEGER NOT NULL DEFAULT 0 CHECK (value_gp_equiv >= 0 AND value_gp_equiv <= 9007199254740991),
			score_micros INTEGER NOT NULL DEFAULT 0 CHECK (score_micros >= 0)
		) STRICT;
	`
}, {
	version: 132,
	sql: `
		ALTER TABLE expedition_work_sessions ADD COLUMN last_observed_at INTEGER;
		ALTER TABLE expedition_work_sessions ADD COLUMN max_observation_gap_ms INTEGER NOT NULL DEFAULT 0
			CHECK (max_observation_gap_ms >= 0);
	`
}, {
	version: 133,
	sql: `
		ALTER TABLE expedition_ep_ledger ADD COLUMN expedition_id INTEGER CHECK (expedition_id IS NULL OR expedition_id > 0);
		UPDATE expedition_ep_ledger SET expedition_id = (
			SELECT session.expedition_id FROM expedition_work_sessions AS session
			WHERE expedition_ep_ledger.source_kind = 'work' AND session.id = expedition_ep_ledger.source_id
		) WHERE source_kind = 'work';
		UPDATE expedition_ep_ledger SET expedition_id = (
			SELECT lot.expedition_id FROM expedition_supply_lots AS lot
			WHERE expedition_ep_ledger.source_kind = 'supply' AND lot.id = expedition_ep_ledger.source_id
		) WHERE source_kind = 'supply';
		CREATE INDEX idx_expedition_ep_ledger_history ON expedition_ep_ledger(client_id, expedition_id);
	`
}, {
	version: 134,
	sql: `
		ALTER TABLE expedition_work_sessions ADD COLUMN evidence_skill_ids TEXT NOT NULL DEFAULT '[]'
			CHECK (json_valid(evidence_skill_ids));
		CREATE TABLE expedition_work_claims (
		session_id INTEGER PRIMARY KEY CHECK (session_id > 0),
		client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
		expedition_id INTEGER NOT NULL CHECK (expedition_id > 0),
		visit_id INTEGER NOT NULL CHECK (visit_id > 0),
		task_id TEXT NOT NULL,
		started_at INTEGER NOT NULL CHECK (started_at >= 0),
		cutoff_at INTEGER NOT NULL CHECK (cutoff_at >= started_at),
		start_statistics TEXT NOT NULL CHECK (json_valid(start_statistics)),
		start_activities TEXT NOT NULL CHECK (json_valid(start_activities)),
		evidence_skill_ids TEXT NOT NULL CHECK (json_valid(evidence_skill_ids)),
		last_observed_at INTEGER,
		max_observation_gap_ms INTEGER NOT NULL CHECK (max_observation_gap_ms >= 0),
		settled_at INTEGER CHECK (settled_at IS NULL OR settled_at >= started_at),
		credited_ms INTEGER CHECK (credited_ms IS NULL OR credited_ms >= 0)
		) STRICT;
		CREATE UNIQUE INDEX idx_expedition_claim_open ON expedition_work_claims(client_id) WHERE settled_at IS NULL;
		CREATE TRIGGER expedition_claim_on_guild_delete BEFORE DELETE ON guilds BEGIN
			INSERT OR IGNORE INTO expedition_work_claims
				(session_id, client_id, expedition_id, visit_id, task_id, started_at, cutoff_at,
				start_statistics, start_activities, evidence_skill_ids, last_observed_at, max_observation_gap_ms)
			SELECT session.id, session.client_id, session.expedition_id, session.visit_id, session.task_id,
				session.started_at,
				MAX(session.started_at, MIN(COALESCE(tenure.ended_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
				CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))),
				session.start_statistics, session.start_activities, session.evidence_skill_ids,
				session.last_observed_at, session.max_observation_gap_ms
			FROM expedition_work_sessions AS session
			JOIN expeditions AS expedition ON expedition.id = session.expedition_id
			JOIN expedition_membership_tenures AS tenure ON tenure.id = session.tenure_id
			WHERE expedition.guild_id = OLD.id AND session.ended_at IS NULL;
		END;
	`
}, {
	version: 135,
	sql: `
		ALTER TABLE expedition_work_sessions ADD COLUMN pending_boundary_at INTEGER;
		ALTER TABLE expedition_work_sessions ADD COLUMN pending_capture_at INTEGER;
		ALTER TABLE expedition_work_claims ADD COLUMN pending_boundary_at INTEGER;
		ALTER TABLE expedition_work_claims ADD COLUMN pending_capture_at INTEGER;
		DROP TRIGGER expedition_claim_on_guild_delete;
		CREATE TRIGGER expedition_claim_on_guild_delete BEFORE DELETE ON guilds BEGIN
			INSERT OR IGNORE INTO expedition_work_claims
				(session_id, client_id, expedition_id, visit_id, task_id, started_at, cutoff_at,
				start_statistics, start_activities, evidence_skill_ids, last_observed_at, max_observation_gap_ms,
				pending_boundary_at, pending_capture_at)
			SELECT session.id, session.client_id, session.expedition_id, session.visit_id, session.task_id,
				session.started_at,
				MAX(session.started_at, MIN(COALESCE(tenure.ended_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
				CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))),
				session.start_statistics, session.start_activities, session.evidence_skill_ids,
				session.last_observed_at, session.max_observation_gap_ms,
				session.pending_boundary_at, session.pending_capture_at
			FROM expedition_work_sessions AS session
			JOIN expeditions AS expedition ON expedition.id = session.expedition_id
			JOIN expedition_membership_tenures AS tenure ON tenure.id = session.tenure_id
			WHERE expedition.guild_id = OLD.id AND session.ended_at IS NULL;
		END;
	`
}, {
	version: 136,
	sql: `
		CREATE TABLE crucible_guilds (
			guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
			is_open INTEGER NOT NULL DEFAULT 1 CHECK (is_open IN (0, 1)),
			processed_minute INTEGER NOT NULL CHECK (processed_minute >= 0),
			created_at INTEGER NOT NULL CHECK (created_at >= 0)
		) STRICT;
		CREATE TABLE crucible_offerings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
			value_currency_id TEXT,
			value_per_item INTEGER CHECK (value_per_item IS NULL OR value_per_item BETWEEN 0 AND 9007199254740991),
			meld_points INTEGER NOT NULL DEFAULT 0 CHECK (meld_points BETWEEN 0 AND 10080),
			generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			refreshed_at INTEGER NOT NULL CHECK (refreshed_at >= created_at),
			is_untimed INTEGER NOT NULL DEFAULT 0 CHECK (is_untimed IN (0, 1)),
			valuation_source TEXT NOT NULL DEFAULT 'client' CHECK (valuation_source IN ('client', 'server', 'migration')),
			UNIQUE (guild_id, item_id)
		) STRICT;
		CREATE INDEX idx_crucible_offerings_progress ON crucible_offerings(guild_id, is_untimed, meld_points, id);
		CREATE TABLE crucible_contribution_lots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			offering_id INTEGER NOT NULL REFERENCES crucible_offerings(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id),
			qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
			contributed_at INTEGER NOT NULL CHECK (contributed_at >= 0),
			source_kind TEXT NOT NULL CHECK (source_kind IN ('cast', 'clear', 'expedition', 'migration')),
			source_id TEXT,
			locked_until INTEGER CHECK (locked_until IS NULL OR locked_until >= 0),
			UNIQUE (source_kind, source_id)
		) STRICT;
		CREATE INDEX idx_crucible_lots_fifo ON crucible_contribution_lots(offering_id, contributed_at, id);
		CREATE TABLE crucible_wishes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			owner_client_id INTEGER NOT NULL REFERENCES clients(id),
			melvor_account_id INTEGER NOT NULL REFERENCES melvor_accounts(id),
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 100),
			required_gp INTEGER NOT NULL CHECK (required_gp > 0 AND required_gp <= 9007199254740991),
			progress_gp INTEGER NOT NULL DEFAULT 0 CHECK (progress_gp BETWEEN 0 AND required_gp),
			formation_points INTEGER NOT NULL DEFAULT 0 CHECK (formation_points BETWEEN 0 AND 10080),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			formed_at INTEGER,
			melded_at INTEGER,
			delivered_at INTEGER,
			UNIQUE (melvor_account_id)
		) STRICT;
		CREATE INDEX idx_crucible_wishes_guild ON crucible_wishes(guild_id, formation_points, progress_gp, id);
		CREATE TABLE crucible_clear_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			owner_key TEXT NOT NULL,
			cleared_at INTEGER NOT NULL CHECK (cleared_at >= 0),
			expires_at INTEGER NOT NULL CHECK (expires_at > cleared_at)
		) STRICT;
		CREATE INDEX idx_crucible_clear_events_owner ON crucible_clear_events(owner_key, expires_at);
		CREATE TABLE crucible_visibility_resets (
			owner_key TEXT PRIMARY KEY,
			reset_at INTEGER NOT NULL CHECK (reset_at >= 0)
		) STRICT;
		CREATE TABLE crucible_currency_locks (
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			owner_key TEXT NOT NULL,
			currency_id TEXT NOT NULL,
			locked_until INTEGER NOT NULL CHECK (locked_until >= 0),
			PRIMARY KEY (guild_id, owner_key, currency_id)
		) STRICT;
		CREATE TABLE crucible_reclaim_state (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			last_reclaimed_at INTEGER NOT NULL CHECK (last_reclaimed_at >= 0)
		) STRICT;
		CREATE TABLE crucible_commands (
			id TEXT NOT NULL,
			client_id INTEGER NOT NULL REFERENCES clients(id),
			kind TEXT NOT NULL,
			response_json TEXT NOT NULL CHECK (json_valid(response_json)),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			PRIMARY KEY (id, client_id)
		) STRICT;
		CREATE TABLE crucible_migration (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			started_at INTEGER NOT NULL CHECK (started_at >= 0),
			completed_at INTEGER,
			source_json TEXT NOT NULL CHECK (json_valid(source_json)),
			destination_json TEXT CHECK (destination_json IS NULL OR json_valid(destination_json))
		) STRICT;
	`
}, {
	version: 137,
	foreign_keys_disabled: true,
	sql: `
		CREATE TABLE multiplayer_pet_ownership_new (
			client_id INTEGER NOT NULL,
			pet_id TEXT NOT NULL CHECK (pet_id IN (
				'Multiplayer_Pet_Charity', 'Multiplayer_Pet_Crucible',
				'Multiplayer_Pet_Campaign_Jungle', 'Multiplayer_Pet_Campaign_Desert',
				'Multiplayer_Pet_Campaign_Snow', 'Multiplayer_Pet_Campaign_Volcanic',
				'Multiplayer_Pet_Campaign_Forsaken', 'Multiplayer_Pet_Campaign_Forest'
			)),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
			PRIMARY KEY (client_id, pet_id),
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		INSERT INTO multiplayer_pet_ownership_new (client_id, pet_id, created_at, updated_at)
			SELECT client_id, pet_id, created_at, updated_at FROM multiplayer_pet_ownership;
		DROP TABLE multiplayer_pet_ownership;
		ALTER TABLE multiplayer_pet_ownership_new RENAME TO multiplayer_pet_ownership;
		CREATE INDEX idx_multiplayer_pet_ownership_client ON multiplayer_pet_ownership (client_id, pet_id);
	`
}, {
	version: 138,
	sql: `
		ALTER TABLE crucible_wishes ADD COLUMN auto_deliver_at INTEGER
			CHECK (auto_deliver_at IS NULL OR auto_deliver_at >= 0);
	`
}, {
	version: 139,
	foreign_keys_disabled: true,
	sql: `
		CREATE TABLE guild_petitions_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL,
			guild_name TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN (
				'appellation', 'heraldry', 'banishment', 'winnowing', 'charitree_ingratitude',
				'charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure',
				'interdict', 'heresy', 'temperance', 'indulgence',
				'crucible_purging', 'crucible_sealing', 'crucible_unsealing'
			)),
			conflict_subject TEXT NOT NULL,
			subject_locked INTEGER NOT NULL DEFAULT 1 CHECK (subject_locked IN (0, 1)),
			petitioner_id INTEGER NOT NULL,
			proposed_name TEXT,
			proposed_icon_id TEXT,
			target_client_id INTEGER,
			target_membership_id INTEGER,
			charitree_expires_before INTEGER CHECK (
				charitree_expires_before IS NULL OR charitree_expires_before >= 0
			),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			expires_at INTEGER NOT NULL CHECK (expires_at >= created_at),
			resolved_at INTEGER CHECK (resolved_at IS NULL OR resolved_at >= created_at),
			lifecycle TEXT NOT NULL DEFAULT 'active'
				CHECK (lifecycle IN ('active', 'granted', 'denied', 'lapsed', 'withdrawn')),
			execution_state TEXT NOT NULL DEFAULT 'not_applicable'
				CHECK (execution_state IN ('not_applicable', 'pending', 'running', 'succeeded', 'failed')),
			execution_attempts INTEGER NOT NULL DEFAULT 0 CHECK (execution_attempts >= 0),
			execution_last_attempt_at INTEGER CHECK (
				execution_last_attempt_at IS NULL OR execution_last_attempt_at >= 0
			),
			execution_failure_category TEXT,
			execution_failure_message TEXT,
			execution_effect TEXT,
			CHECK (
				(type = 'appellation' AND proposed_name IS NOT NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL
					AND charitree_expires_before IS NULL) OR
				(type = 'heraldry' AND proposed_name IS NULL AND proposed_icon_id IS NOT NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL
					AND charitree_expires_before IS NULL) OR
				(type = 'banishment' AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NOT NULL AND target_membership_id IS NOT NULL
					AND charitree_expires_before IS NULL) OR
				(type = 'charitree_ingratitude' AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL
					AND charitree_expires_before IS NOT NULL) OR
				(type IN ('winnowing', 'charitree_sacrilege', 'charitree_beneficence', 'fellowship',
					'enclosure', 'interdict', 'heresy', 'temperance', 'indulgence',
					'crucible_purging', 'crucible_sealing', 'crucible_unsealing')
					AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL
					AND charitree_expires_before IS NULL)
			),
			FOREIGN KEY (petitioner_id) REFERENCES clients (id),
			FOREIGN KEY (target_client_id) REFERENCES clients (id)
		);
		INSERT INTO guild_petitions_new (
			id, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
			proposed_name, proposed_icon_id, target_client_id, target_membership_id,
			charitree_expires_before, created_at, expires_at, resolved_at, lifecycle,
			execution_state, execution_attempts, execution_last_attempt_at,
			execution_failure_category, execution_failure_message, execution_effect
		)
		SELECT
			id, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
			proposed_name, proposed_icon_id, target_client_id, target_membership_id,
			charitree_expires_before, created_at, expires_at, resolved_at, lifecycle,
			execution_state, execution_attempts, execution_last_attempt_at,
			execution_failure_category, execution_failure_message, execution_effect
		FROM guild_petitions;
		DROP TABLE guild_petitions;
		ALTER TABLE guild_petitions_new RENAME TO guild_petitions;
		CREATE UNIQUE INDEX idx_guild_petitions_locked_subject
			ON guild_petitions (guild_id, conflict_subject) WHERE subject_locked = 1;
		CREATE INDEX idx_guild_petitions_history
			ON guild_petitions (guild_id, lifecycle, resolved_at DESC, id DESC);
		CREATE INDEX idx_guild_petitions_expiry
			ON guild_petitions (expires_at) WHERE lifecycle = 'active';
		CREATE INDEX idx_guild_petitions_petitioner
			ON guild_petitions (petitioner_id, lifecycle);
		CREATE INDEX idx_guild_petitions_execution
			ON guild_petitions (execution_state, execution_last_attempt_at, id)
			WHERE execution_state IN ('pending', 'running', 'failed');
		CREATE TABLE guild_petition_crucible_targets (
			petition_id INTEGER NOT NULL REFERENCES guild_petitions(id) ON DELETE CASCADE,
			offering_id INTEGER NOT NULL,
			generation INTEGER NOT NULL CHECK (generation > 0),
			PRIMARY KEY (petition_id, offering_id)
		) STRICT;
		CREATE TABLE guild_petition_crucible_wishes (
			petition_id INTEGER NOT NULL REFERENCES guild_petitions(id) ON DELETE CASCADE,
			wish_id INTEGER NOT NULL,
			PRIMARY KEY (petition_id, wish_id)
		) STRICT;
	`
}, {
	version: 140,
	sql: `
		CREATE TRIGGER crucible_guild_on_guild_insert AFTER INSERT ON guilds BEGIN
			INSERT INTO crucible_guilds (guild_id, processed_minute, created_at)
			VALUES (NEW.id, CAST((julianday('now') - 2440587.5) * 1440 AS INTEGER),
				CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER));
		END;
	`
}];
