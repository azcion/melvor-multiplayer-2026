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
}, {
	version: 153,
	sql: `
		ALTER TABLE expedition_work_sessions ADD COLUMN reward_remaining_ms INTEGER
			CHECK (reward_remaining_ms IS NULL OR reward_remaining_ms >= 0);
		ALTER TABLE expedition_work_claims ADD COLUMN reward_remaining_ms INTEGER
			CHECK (reward_remaining_ms IS NULL OR reward_remaining_ms >= 0);
		-- Reconstruct the remaining work at an open segment's start, before later check-ins.
		-- Assistance grows by 1% per full hour after the first 24 hours; never use later assistance.
		UPDATE expedition_work_sessions AS session SET reward_remaining_ms = (
			SELECT MAX(0, task.target_ms - COALESCE((
				SELECT SUM(prior.guild_ms) FROM expedition_work_sessions AS prior
				WHERE prior.visit_id = session.visit_id AND prior.task_id = session.task_id
					AND prior.ended_at <= session.started_at AND prior.id != session.id
			), 0) - MIN(task.system_ms,
				CAST(task.target_ms * CAST(MAX(0, session.started_at - MAX(COALESCE(task.unlocked_at, session.started_at), COALESCE(task.promoted_at, 0))
					- 86400000) / 3600000 AS INTEGER) / 100 AS INTEGER)))
			FROM expedition_tasks AS task
			WHERE task.visit_id = session.visit_id AND task.task_id = session.task_id
		) WHERE session.ended_at IS NULL;
		-- Previously dissolved Guild claims have no surviving task history: retain legacy awards.
		DROP TRIGGER expedition_claim_on_guild_delete;
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
}, {
	version: 154,
	sql: `ALTER TABLE guild_petitions ADD COLUMN rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version IN (1, 2));`
}, {
	version: 155,
	foreign_keys_disabled: true,
	sql: `
		CREATE TABLE guild_petitions_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version IN (1, 2)),
			guild_id INTEGER NOT NULL,
			guild_name TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN (
				'appellation', 'heraldry', 'banishment', 'winnowing', 'charitree_ingratitude',
				'charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure',
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
					'crucible_purging', 'crucible_sealing', 'crucible_unsealing', 'alliance_found', 'alliance_consider', 'alliance_join', 'alliance_leave',
				'alliance_remove', 'alliance_market_enable', 'alliance_market_disable', 'alliance_withdraw', 'alliance_ballot')
					AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL
					AND charitree_expires_before IS NULL)
			),
			FOREIGN KEY (petitioner_id) REFERENCES clients (id),
			FOREIGN KEY (target_client_id) REFERENCES clients (id)
		);
		INSERT INTO guild_petitions_new (
			id, rule_version, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
			proposed_name, proposed_icon_id, target_client_id, target_membership_id,
			charitree_expires_before, created_at, expires_at, resolved_at, lifecycle,
			execution_state, execution_attempts, execution_last_attempt_at,
			execution_failure_category, execution_failure_message, execution_effect
		)
		SELECT
			id, rule_version, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
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

		CREATE TABLE alliances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 20),
			shared_marketplace INTEGER NOT NULL DEFAULT 0 CHECK (shared_marketplace IN (0,1)),
			created_at INTEGER NOT NULL
		) STRICT;
		CREATE TABLE alliance_memberships (
			guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
			alliance_id INTEGER NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
			joined_at INTEGER NOT NULL
		) STRICT;
		CREATE INDEX idx_alliance_memberships_alliance ON alliance_memberships(alliance_id);
		CREATE TABLE alliance_processes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			kind TEXT NOT NULL CHECK (kind IN ('found','join','leave','remove','market_enable','market_disable')),
			initiator_guild_id INTEGER NOT NULL,
			target_guild_id INTEGER,
			alliance_id INTEGER,
			name TEXT,
			subject TEXT NOT NULL,
			stage TEXT NOT NULL DEFAULT 'local' CHECK (stage IN ('local','waiting','recipient','collective','accepted','denied','lapsed','withdrawn','cancelled')),
			created_at INTEGER NOT NULL,
			expires_at INTEGER NOT NULL,
			resolved_at INTEGER
		) STRICT;
		CREATE UNIQUE INDEX idx_alliance_process_subject ON alliance_processes(subject)
			WHERE stage IN ('local','waiting','recipient','collective');
		CREATE TABLE alliance_pending_slots (
			guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
			process_id INTEGER NOT NULL REFERENCES alliance_processes(id)
		) STRICT;
		CREATE TABLE alliance_process_petitions (
			petition_id INTEGER PRIMARY KEY REFERENCES guild_petitions(id),
			process_id INTEGER NOT NULL REFERENCES alliance_processes(id),
			role TEXT NOT NULL CHECK (role IN ('local','recipient','ballot','withdraw'))
		) STRICT;
		CREATE INDEX idx_alliance_process_petitions_process ON alliance_process_petitions(process_id);
		CREATE TABLE alliance_ballots (
			process_id INTEGER NOT NULL REFERENCES alliance_processes(id),
			guild_id INTEGER NOT NULL,
			choice TEXT CHECK (choice IN ('aye','nay')),
			submitted_at INTEGER,
			PRIMARY KEY (process_id, guild_id)
		) STRICT;
`
}, {
	version: 156,
	sql: `
			ALTER TABLE clients ADD COLUMN alliance_chat_enabled INTEGER NOT NULL DEFAULT 1
				CHECK (alliance_chat_enabled IN (0, 1));

			CREATE TABLE alliance_chat_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				alliance_id INTEGER NOT NULL,
				sender_id INTEGER NOT NULL,
				idempotency_key TEXT NOT NULL,
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (sender_id, idempotency_key),
				FOREIGN KEY (alliance_id) REFERENCES alliances (id) ON DELETE CASCADE,
				FOREIGN KEY (sender_id) REFERENCES clients (id)
			);
			CREATE INDEX idx_alliance_chat_messages_guild ON alliance_chat_messages (alliance_id, id);
			CREATE INDEX idx_alliance_chat_messages_sender ON alliance_chat_messages (sender_id, id);

			CREATE TABLE alliance_chat_read_state (
				alliance_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
				PRIMARY KEY (alliance_id, client_id),
				FOREIGN KEY (alliance_id) REFERENCES alliances (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);

			CREATE TABLE alliance_chat_message_moderation (
				message_id INTEGER PRIMARY KEY,
				deleted_at INTEGER NOT NULL CHECK (deleted_at >= 0),
				FOREIGN KEY (message_id) REFERENCES alliance_chat_messages (id) ON DELETE CASCADE
			);

		ALTER TABLE alliance_chat_messages ADD COLUMN shadow_hidden INTEGER NOT NULL DEFAULT 0 CHECK (shadow_hidden IN (0,1));
		ALTER TABLE alliance_chat_messages ADD COLUMN reaction_revision INTEGER NOT NULL DEFAULT 0;
		CREATE TABLE alliance_chat_message_reactions (
			message_id INTEGER NOT NULL REFERENCES alliance_chat_messages(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id), reaction TEXT NOT NULL, created_at INTEGER NOT NULL,
			PRIMARY KEY(message_id,client_id,reaction)
		);
		CREATE TRIGGER alliance_chat_guild_baseline AFTER INSERT ON alliance_memberships BEGIN
			INSERT INTO alliance_chat_read_state(alliance_id,client_id,last_read_message_id)
			SELECT NEW.alliance_id,gm.client_id,COALESCE((SELECT MAX(id) FROM alliance_chat_messages WHERE alliance_id=NEW.alliance_id),0)
			FROM guild_memberships gm WHERE gm.guild_id=NEW.guild_id
			ON CONFLICT(alliance_id,client_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id;
		END;
		CREATE TRIGGER alliance_chat_member_baseline AFTER INSERT ON guild_memberships BEGIN
			INSERT INTO alliance_chat_read_state(alliance_id,client_id,last_read_message_id)
			SELECT am.alliance_id,NEW.client_id,COALESCE((SELECT MAX(id) FROM alliance_chat_messages WHERE alliance_id=am.alliance_id),0)
			FROM alliance_memberships am WHERE am.guild_id=NEW.guild_id
			ON CONFLICT(alliance_id,client_id) DO UPDATE SET last_read_message_id=excluded.last_read_message_id;
		END;

 CREATE TRIGGER event_alliance_chat_messages_insert AFTER INSERT ON alliance_chat_messages BEGIN UPDATE clients SET event_revision=event_revision+1; END;

 CREATE TRIGGER event_alliance_chat_read_state_insert AFTER INSERT ON alliance_chat_read_state BEGIN UPDATE clients SET event_revision=event_revision+1; END;

 CREATE TRIGGER event_alliance_chat_read_state_update AFTER UPDATE ON alliance_chat_read_state BEGIN UPDATE clients SET event_revision=event_revision+1; END;

 CREATE TRIGGER event_alliance_chat_message_moderation_insert AFTER INSERT ON alliance_chat_message_moderation BEGIN UPDATE clients SET event_revision=event_revision+1; END;

 CREATE TRIGGER event_alliance_chat_message_reactions_insert AFTER INSERT ON alliance_chat_message_reactions BEGIN UPDATE clients SET event_revision=event_revision+1; END;

 CREATE TRIGGER event_alliance_chat_message_reactions_delete AFTER DELETE ON alliance_chat_message_reactions BEGIN UPDATE clients SET event_revision=event_revision+1; END;

 CREATE TRIGGER event_alliance_participation AFTER UPDATE OF alliance_chat_enabled ON clients BEGIN UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.id; END;
`
}, {
	version: 157,
	foreign_keys_disabled: true,
	sql: `DROP TRIGGER correct_support_chat_translation;
DROP TRIGGER enqueue_private_chat_translation;
DROP TRIGGER enqueue_guild_chat_translation;
DROP TRIGGER enqueue_global_chat_translation;
DROP TRIGGER enqueue_support_chat_translation;
DROP TRIGGER enqueue_poll_discussion_translation;
DROP TRIGGER delete_private_chat_translation;
DROP TRIGGER delete_guild_chat_translation;
DROP TRIGGER delete_global_chat_translation;
DROP TRIGGER delete_support_chat_translation;
DROP TRIGGER delete_poll_discussion_translation;
CREATE TABLE chat_translation_jobs_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source_kind TEXT NOT NULL CHECK (
					source_kind IN ('private', 'alliance', 'guild', 'global', 'support', 'poll-discussion')
				),
				message_id INTEGER NOT NULL CHECK (message_id > 0),
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				detected_language TEXT,
				state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'complete', 'dead')),
				attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
				enqueued_at INTEGER NOT NULL CHECK (enqueued_at BETWEEN 0 AND 9007199254740991),
				available_at INTEGER NOT NULL CHECK (available_at BETWEEN 0 AND 9007199254740991),
				last_attempt_at INTEGER CHECK (last_attempt_at BETWEEN 0 AND 9007199254740991),
				completed_at INTEGER CHECK (completed_at BETWEEN 0 AND 9007199254740991),
				last_error_code TEXT,
				UNIQUE (source_kind, message_id)
			);
			INSERT INTO chat_translation_jobs_new(id,source_kind,message_id,content,detected_language,state,attempts,enqueued_at,available_at,last_attempt_at,completed_at,last_error_code) SELECT id,source_kind,message_id,content,detected_language,state,attempts,enqueued_at,available_at,last_attempt_at,completed_at,last_error_code FROM chat_translation_jobs;
DROP TABLE chat_translation_jobs;
ALTER TABLE chat_translation_jobs_new RENAME TO chat_translation_jobs;
CREATE INDEX idx_chat_translation_jobs_fifo ON chat_translation_jobs(state,id,available_at);
CREATE TRIGGER enqueue_alliance_chat_translation AFTER INSERT ON alliance_chat_messages BEGIN
 INSERT INTO chat_translation_jobs(source_kind,message_id,content,enqueued_at,available_at) VALUES('alliance',NEW.id,NEW.content,NEW.created_at,NEW.created_at); END;
 CREATE TRIGGER delete_alliance_chat_translation AFTER DELETE ON alliance_chat_messages BEGIN DELETE FROM chat_translation_jobs WHERE source_kind='alliance' AND message_id=OLD.id; END;

CREATE TRIGGER correct_support_chat_translation AFTER UPDATE OF content ON support_messages
		WHEN OLD.content <> NEW.content BEGIN
			DELETE FROM chat_translation_jobs WHERE source_kind = 'support' AND message_id = NEW.id;
			INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
			VALUES ('support', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
		END;
CREATE TRIGGER enqueue_private_chat_translation AFTER INSERT ON chat_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('private', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_guild_chat_translation AFTER INSERT ON guild_chat_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('guild', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_global_chat_translation AFTER INSERT ON global_chat_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('global', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_support_chat_translation AFTER INSERT ON support_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('support', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_poll_discussion_translation AFTER INSERT ON poll_discussion_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('poll-discussion', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER delete_private_chat_translation AFTER DELETE ON chat_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'private' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_guild_chat_translation AFTER DELETE ON guild_chat_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'guild' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_global_chat_translation AFTER DELETE ON global_chat_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'global' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_support_chat_translation AFTER DELETE ON support_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'support' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_poll_discussion_translation AFTER DELETE ON poll_discussion_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'poll-discussion' AND message_id = OLD.id;
			END;`
}, {
	version: 158,
	sql: `
		CREATE TRIGGER event_council_ballot AFTER INSERT ON guild_petition_votes BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN (
				SELECT client_id FROM guild_memberships WHERE guild_id=(SELECT guild_id FROM guild_petitions WHERE id=NEW.petition_id));
		END;
		CREATE TRIGGER event_council_petition AFTER UPDATE ON guild_petitions BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN (SELECT client_id FROM guild_memberships WHERE guild_id=NEW.guild_id);
		END;
		CREATE TRIGGER alliance_roster_departure AFTER DELETE ON alliance_memberships BEGIN
			UPDATE alliance_processes SET stage='cancelled', resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
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
			UPDATE alliance_processes SET stage='cancelled', resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE (initiator_guild_id=OLD.id OR target_guild_id=OLD.id) AND stage IN ('local','waiting','recipient','collective');
			UPDATE guild_petitions SET lifecycle='withdrawn',subject_locked=0,
				resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE lifecycle='active' AND id IN (SELECT l.petition_id FROM alliance_process_petitions l
				JOIN alliance_processes p ON p.id=l.process_id WHERE (p.initiator_guild_id=OLD.id OR p.target_guild_id=OLD.id) AND p.stage='cancelled');
			DELETE FROM alliance_pending_slots WHERE process_id IN (SELECT id FROM alliance_processes WHERE stage='cancelled');
		END;
	`
}];
