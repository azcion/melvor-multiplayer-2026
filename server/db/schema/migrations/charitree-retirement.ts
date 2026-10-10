import type { Migration } from '../types';

export const charitree_retirement_migration: Migration = {
	version: 171,
	foreign_keys_disabled: true,
	preflight_sql: `SELECT COUNT(*) AS problems FROM (SELECT guild_id FROM charity_items WHERE qty > 0 UNION ALL SELECT guild_id FROM charity_wishes) WHERE NOT EXISTS (SELECT 1 FROM service_settings WHERE key = 'crucible_cutover' AND value = '1')`,
	sql: `
DROP TRIGGER event_council_ballot;
DROP TRIGGER event_council_petition;
DROP TRIGGER alliance_roster_departure;
DROP TRIGGER alliance_deleted_guild;
DROP TRIGGER council_threshold_immutable;
DROP TABLE guild_petition_charity_wishes;
DELETE FROM guild_petition_votes WHERE petition_id IN (SELECT id FROM guild_petitions WHERE type LIKE 'charitree_%');
DELETE FROM guild_petition_voters WHERE petition_id IN (SELECT id FROM guild_petitions WHERE type LIKE 'charitree_%');
DELETE FROM guild_petition_winnowing_targets WHERE petition_id IN (SELECT id FROM guild_petitions WHERE type LIKE 'charitree_%');
DELETE FROM guild_petition_crucible_targets WHERE petition_id IN (SELECT id FROM guild_petitions WHERE type LIKE 'charitree_%');
DELETE FROM guild_petition_crucible_wishes WHERE petition_id IN (SELECT id FROM guild_petitions WHERE type LIKE 'charitree_%');
DELETE FROM alliance_process_petitions WHERE petition_id IN (SELECT id FROM guild_petitions WHERE type LIKE 'charitree_%');
DELETE FROM guild_petitions WHERE type LIKE 'charitree_%';
CREATE TABLE guild_petitions_next (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version IN (1, 2)),
			guild_id INTEGER NOT NULL,
			guild_name TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN (
				'appellation', 'heraldry', 'banishment', 'winnowing', 'fellowship', 'enclosure',
				'interdict', 'heresy', 'temperance', 'indulgence',
				'crucible_purging', 'crucible_sealing', 'crucible_unsealing', 'alliance_found', 'alliance_consider', 'alliance_join', 'alliance_leave',
				'alliance_remove', 'alliance_market_enable', 'alliance_market_disable', 'alliance_withdraw', 'alliance_ballot'
			)),
			conflict_subject TEXT NOT NULL,
			subject_locked INTEGER NOT NULL DEFAULT 1 CHECK (subject_locked IN (0, 1)),
			petitioner_id INTEGER NOT NULL,
			proposed_name TEXT,
			proposed_icon_id TEXT,
			target_client_id INTEGER,
			target_membership_id INTEGER,
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
			execution_effect TEXT, snapshot_active_count INTEGER
			CHECK(snapshot_active_count IS NULL OR snapshot_active_count BETWEEN 0 AND 9007199254740991), voting_threshold INTEGER
			CHECK(voting_threshold IS NULL OR voting_threshold BETWEEN 1 AND 9007199254740991),
			CHECK (
				(type = 'appellation' AND proposed_name IS NOT NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL) OR
				(type = 'heraldry' AND proposed_name IS NULL AND proposed_icon_id IS NOT NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL) OR
				(type = 'banishment' AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NOT NULL AND target_membership_id IS NOT NULL) OR
				(type IN ('winnowing', 'fellowship',
					'enclosure', 'interdict', 'heresy', 'temperance', 'indulgence',
					'crucible_purging', 'crucible_sealing', 'crucible_unsealing', 'alliance_found', 'alliance_consider', 'alliance_join', 'alliance_leave',
				'alliance_remove', 'alliance_market_enable', 'alliance_market_disable', 'alliance_withdraw', 'alliance_ballot')
					AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL)
			),
			FOREIGN KEY (petitioner_id) REFERENCES clients (id),
			FOREIGN KEY (target_client_id) REFERENCES clients (id)
		);
INSERT INTO guild_petitions_next (id, rule_version, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id, proposed_name, proposed_icon_id, target_client_id, target_membership_id, created_at, expires_at, resolved_at, lifecycle, execution_state, execution_attempts, execution_last_attempt_at, execution_failure_category, execution_failure_message, execution_effect, snapshot_active_count, voting_threshold) SELECT id, rule_version, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id, proposed_name, proposed_icon_id, target_client_id, target_membership_id, created_at, expires_at, resolved_at, lifecycle, execution_state, execution_attempts, execution_last_attempt_at, execution_failure_category, execution_failure_message, execution_effect, snapshot_active_count, voting_threshold FROM guild_petitions;
DROP TABLE guild_petitions;
ALTER TABLE guild_petitions_next RENAME TO guild_petitions;
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
CREATE TRIGGER event_council_ballot AFTER INSERT ON guild_petition_votes BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN (
				SELECT client_id FROM guild_memberships WHERE guild_id=(SELECT guild_id FROM guild_petitions WHERE id=NEW.petition_id));
		END;
CREATE TRIGGER event_council_petition AFTER UPDATE ON guild_petitions BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN (SELECT client_id FROM guild_memberships WHERE guild_id=NEW.guild_id);
		END;
CREATE TRIGGER alliance_roster_departure AFTER DELETE ON alliance_memberships BEGIN
			UPDATE alliance_processes SET stage='cancelled', resolution_reason='roster_changed', resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE alliance_id=OLD.alliance_id AND stage IN ('local','waiting','recipient','collective');
			UPDATE guild_petitions SET lifecycle='withdrawn',subject_locked=0,
				resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE lifecycle='active' AND id IN (SELECT l.petition_id FROM alliance_process_petitions l
				JOIN alliance_processes p ON p.id=l.process_id WHERE p.alliance_id=OLD.alliance_id AND p.stage='cancelled');
			DELETE FROM alliance_pending_slots WHERE process_id IN (SELECT id FROM alliance_processes WHERE alliance_id=OLD.alliance_id AND stage='cancelled');
			DELETE FROM alliances WHERE id=OLD.alliance_id AND (SELECT COUNT(*) FROM alliance_memberships WHERE alliance_id=OLD.alliance_id)<2;
			UPDATE clients SET event_revision=event_revision+1;
		END;
CREATE TRIGGER alliance_deleted_guild BEFORE DELETE ON guilds BEGIN
			UPDATE alliance_processes SET stage='cancelled', resolution_reason='guild_unavailable', resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE (initiator_guild_id=OLD.id OR target_guild_id=OLD.id) AND stage IN ('local','waiting','recipient','collective');
			UPDATE guild_petitions SET lifecycle='withdrawn',subject_locked=0,
				resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE lifecycle='active' AND id IN (SELECT l.petition_id FROM alliance_process_petitions l
				JOIN alliance_processes p ON p.id=l.process_id WHERE (p.initiator_guild_id=OLD.id OR p.target_guild_id=OLD.id) AND p.stage='cancelled');
			DELETE FROM alliance_pending_slots WHERE process_id IN (SELECT id FROM alliance_processes WHERE stage='cancelled');
		END;
CREATE TRIGGER council_threshold_immutable BEFORE UPDATE OF snapshot_active_count, voting_threshold ON guild_petitions
		WHEN OLD.voting_threshold IS NOT NULL AND
			(NEW.voting_threshold IS NOT OLD.voting_threshold OR NEW.snapshot_active_count IS NOT OLD.snapshot_active_count)
		BEGIN SELECT RAISE(ABORT, 'Council voting threshold is immutable'); END;
DROP TABLE charity_contribution_lots;
DROP TABLE charity_wishes;
DROP TABLE charity_decay_activations;
DROP TABLE charity_wish_commands;
DROP TABLE charity_shuffles;
DROP TABLE charity_shuffle_events;
DROP TABLE charity_currency_locks;
DROP TABLE charity_items;
DROP TABLE crucible_migration;
ALTER TABLE guild_memberships RENAME COLUMN charitree_take_available_at TO crucible_reclaim_available_at;
ALTER TABLE guilds DROP COLUMN charitree_enabled;
ALTER TABLE clients DROP COLUMN last_charity;
ALTER TABLE clients DROP COLUMN last_bonus_charity;
DELETE FROM service_settings WHERE key LIKE 'charity_%' OR key = 'crucible_cutover';
INSERT OR IGNORE INTO crucible_guilds (guild_id, processed_minute, created_at)
SELECT id, CAST(strftime('%s','now') AS INTEGER) / 60, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM guilds;

	`
};
