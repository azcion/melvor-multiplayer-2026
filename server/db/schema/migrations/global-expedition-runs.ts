import type { Migration } from '../types';

export const global_expedition_runs_migration: Migration = {
	version: 230,
	foreign_keys_disabled: true,
	sql: `
	DROP TRIGGER expedition_personal_status;
	DROP TRIGGER expedition_personal_guild_deleted;
	DROP TRIGGER expedition_tenure_membership_deleted;
	DROP TRIGGER expedition_tenure_guild_deleted;
	DROP TRIGGER expedition_personal_stash_outcome;
	DROP TRIGGER expedition_stash_guild_deleted;
	DROP TRIGGER expedition_stash_disposal_on_guild_delete;
	DROP TRIGGER expedition_claim_on_guild_delete;

	CREATE TABLE expeditions_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id INTEGER REFERENCES guilds(id) ON DELETE CASCADE,
		status TEXT NOT NULL CHECK (status IN ('registration', 'active', 'completed', 'inactive', 'dissolved')),
		content_version INTEGER NOT NULL CHECK (content_version > 0),
		content_snapshot TEXT NOT NULL CHECK (json_valid(content_snapshot)),
		registered_at INTEGER NOT NULL CHECK (registered_at >= 0),
		registration_ends_at INTEGER NOT NULL CHECK (registration_ends_at > registered_at),
		current_visit_id INTEGER,
		last_qualifying_activity_at INTEGER NOT NULL CHECK (last_qualifying_activity_at >= 0),
		ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= registered_at),
		revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
		stash_outcome TEXT NOT NULL DEFAULT 'pending'
			CHECK (stash_outcome IN ('pending', 'empty', 'charitree', 'destroyed'))
	) STRICT;
	INSERT INTO expeditions_new (id, guild_id, status, content_version, content_snapshot, registered_at,
		registration_ends_at, current_visit_id, last_qualifying_activity_at, ended_at, revision, stash_outcome)
	SELECT id, guild_id, status, content_version, content_snapshot, registered_at,
		registration_ends_at, current_visit_id, last_qualifying_activity_at, ended_at, revision, stash_outcome
	FROM expeditions;
	DELETE FROM sqlite_sequence WHERE name = 'expeditions_new';
	UPDATE sqlite_sequence SET name = 'expeditions_new' WHERE name = 'expeditions';
	DROP TABLE expeditions;
	ALTER TABLE expeditions_new RENAME TO expeditions;
	CREATE UNIQUE INDEX idx_expeditions_one_active_per_guild ON expeditions(guild_id)
		WHERE status IN ('registration', 'active');
	CREATE UNIQUE INDEX idx_expeditions_one_active_global ON expeditions((1))
		WHERE guild_id IS NULL AND status IN ('registration', 'active');
	CREATE INDEX idx_expeditions_guild_history ON expeditions(guild_id, id DESC);

	CREATE TABLE expedition_membership_tenures_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		expedition_id INTEGER NOT NULL CHECK (expedition_id > 0),
		source_guild_id INTEGER NOT NULL CHECK (source_guild_id > 0),
		membership_id INTEGER NOT NULL CHECK (membership_id > 0),
		client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
		started_at INTEGER NOT NULL CHECK (started_at >= 0),
		ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at)
	) STRICT;
	INSERT INTO expedition_membership_tenures_new (id, expedition_id, source_guild_id, membership_id, client_id, started_at, ended_at)
	SELECT id, expedition_id, source_guild_id, membership_id, client_id, started_at, ended_at
	FROM expedition_membership_tenures;
	DELETE FROM sqlite_sequence WHERE name = 'expedition_membership_tenures_new';
	UPDATE sqlite_sequence SET name = 'expedition_membership_tenures_new' WHERE name = 'expedition_membership_tenures';
	DROP TABLE expedition_membership_tenures;
	ALTER TABLE expedition_membership_tenures_new RENAME TO expedition_membership_tenures;
	CREATE INDEX idx_expedition_tenures_client ON expedition_membership_tenures(client_id, expedition_id);
	CREATE UNIQUE INDEX idx_expedition_open_tenure ON expedition_membership_tenures(expedition_id, membership_id)
		WHERE ended_at IS NULL;

	CREATE TABLE expedition_shared_knowledge (
		chamber_id TEXT NOT NULL,
		exit_id TEXT NOT NULL,
		PRIMARY KEY (chamber_id, exit_id)
	) STRICT;
	CREATE TABLE expedition_inherited_knowledge (
		guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
		chamber_id TEXT NOT NULL,
		exit_id TEXT NOT NULL,
		PRIMARY KEY (guild_id, chamber_id, exit_id)
	) STRICT;
	CREATE TABLE expedition_global_charted (
		chamber_id TEXT PRIMARY KEY,
		completed_at INTEGER NOT NULL
	) STRICT;
	CREATE TRIGGER expedition_share_visit_knowledge AFTER INSERT ON expedition_visits
	WHEN NEW.chamber_id <> 'rift_preparations' AND EXISTS (
		SELECT 1 FROM expeditions WHERE id = NEW.expedition_id AND guild_id IS NULL
	) BEGIN
		INSERT OR IGNORE INTO expedition_inherited_knowledge (guild_id, chamber_id, exit_id)
		SELECT guild_id, NEW.chamber_id, '' FROM global_expedition_guild_participation
		WHERE opted_in = 1 AND effective_at <= NEW.entered_at;
	END;
	CREATE TRIGGER expedition_share_exit_knowledge AFTER UPDATE OF discovered_at ON expedition_exits
	WHEN OLD.discovered_at IS NULL AND NEW.discovered_at IS NOT NULL BEGIN
		INSERT OR IGNORE INTO expedition_inherited_knowledge (guild_id, chamber_id, exit_id)
		SELECT participating.guild_id, visit.chamber_id, NEW.exit_id FROM expedition_visits visit
		JOIN expeditions run ON run.id = visit.expedition_id
		CROSS JOIN global_expedition_guild_participation participating
		WHERE visit.id = NEW.visit_id AND run.guild_id IS NULL
		AND participating.opted_in = 1 AND participating.effective_at <= NEW.discovered_at;
	END;

	CREATE TRIGGER expedition_personal_status AFTER UPDATE OF status ON expeditions BEGIN
			UPDATE expedition_personal_records SET status = NEW.status, ended_at = NEW.ended_at
			WHERE expedition_id = NEW.id;
		END;
	CREATE TRIGGER expedition_personal_guild_deleted BEFORE DELETE ON guilds BEGIN
			UPDATE expedition_personal_records SET status = 'dissolved',
				ended_at = MAX(registered_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			WHERE expedition_id IN (SELECT id FROM expeditions WHERE guild_id = OLD.id) AND status IN ('registration', 'active');
		END;
	CREATE TRIGGER expedition_tenure_membership_deleted BEFORE DELETE ON guild_memberships BEGIN
			UPDATE expedition_membership_tenures SET
				ended_at = MAX(started_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			WHERE membership_id = OLD.id AND ended_at IS NULL;
		END;
	CREATE TRIGGER expedition_tenure_guild_deleted BEFORE DELETE ON guilds BEGIN
			UPDATE expedition_membership_tenures SET
				ended_at = MAX(started_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			WHERE source_guild_id = OLD.id AND ended_at IS NULL;
		END;
	CREATE TRIGGER expedition_personal_stash_outcome AFTER UPDATE OF stash_outcome ON expeditions BEGIN
			UPDATE expedition_personal_records SET stash_outcome = NEW.stash_outcome
			WHERE expedition_id = NEW.id;
		END;
	CREATE TRIGGER expedition_stash_guild_deleted BEFORE DELETE ON guilds BEGIN
			UPDATE expedition_personal_records SET stash_outcome =
				CASE WHEN EXISTS (
					SELECT 1 FROM expedition_supplies AS supply
					JOIN expeditions AS expedition ON expedition.id = supply.expedition_id
					WHERE expedition.guild_id = OLD.id AND expedition.id = expedition_personal_records.expedition_id
				) THEN 'destroyed' ELSE 'empty' END
			WHERE expedition_id IN (SELECT id FROM expeditions WHERE guild_id = OLD.id) AND stash_outcome = 'pending';
		END;
	CREATE TRIGGER expedition_stash_disposal_on_guild_delete BEFORE DELETE ON guilds BEGIN
			INSERT OR IGNORE INTO expedition_stash_disposals
				(expedition_id, source_guild_id, item_id, qty, outcome, disposed_at)
			SELECT expedition.id, OLD.id, supply.item_id, supply.qty, 'destroyed',
				MAX(expedition.registered_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			FROM expeditions AS expedition JOIN expedition_supplies AS supply
				ON supply.expedition_id = expedition.id WHERE expedition.guild_id = OLD.id;
		END;
	CREATE TRIGGER expedition_claim_on_guild_delete BEFORE DELETE ON guilds BEGIN
			INSERT OR IGNORE INTO expedition_work_claims
				(session_id, client_id, expedition_id, visit_id, task_id, started_at, cutoff_at,
				start_statistics, start_activities, evidence_skill_ids, last_observed_at, max_observation_gap_ms,
				pending_boundary_at, pending_capture_at, start_clock_offset_ms, pending_reported_capture_at, reward_remaining_ms)
			SELECT session.id, session.client_id, session.expedition_id, session.visit_id, session.task_id,
				session.started_at,
				MAX(session.started_at, MIN(COALESCE(tenure.ended_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
					COALESCE(visit.departed_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
					COALESCE(expedition.ended_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)),
					CASE WHEN visit.chamber_id = 'rift_preparations' THEN expedition.registration_ends_at ELSE 9007199254740991 END,
				CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))),
				session.start_statistics, session.start_activities, session.evidence_skill_ids,
				session.last_observed_at, session.max_observation_gap_ms,
				session.pending_boundary_at, session.pending_capture_at, session.start_clock_offset_ms, session.pending_reported_capture_at, session.reward_remaining_ms
			FROM expedition_work_sessions AS session
			JOIN expeditions AS expedition ON expedition.id = session.expedition_id
			JOIN expedition_membership_tenures AS tenure ON tenure.id = session.tenure_id
			JOIN expedition_visits AS visit ON visit.id = session.visit_id
			WHERE expedition.guild_id = OLD.id AND session.ended_at IS NULL;
		END;
	`
};
