import type { Migration } from '../types';

// Version 229 adds Global Expedition governance and the two Council petition kinds.
// The parent-table rebuild preserves all existing petition rows and dependent ballots.
export const global_expedition_governance_migration: Migration = {
	version: 229,
	foreign_keys_disabled: true,
	sql: `
		CREATE TEMP TABLE global_expedition_petition_sequence AS SELECT seq FROM sqlite_sequence WHERE name='guild_petitions';
		DROP TRIGGER event_council_ballot;
		DROP TRIGGER event_council_petition;
		DROP TRIGGER alliance_roster_departure;
		DROP TRIGGER alliance_deleted_guild;
		DROP TRIGGER council_threshold_immutable;
		DROP TRIGGER petition_discussion_proposal;
		DROP TRIGGER petition_discussion_inherit_creator;
		DROP TRIGGER petition_discussion_creator_change;
		DROP TRIGGER petition_discussion_close;
		DROP TRIGGER petition_discussion_petition_delete;
		DROP TRIGGER page_revision_guild_petitions_insert;
		DROP TRIGGER page_revision_guild_petitions_update;
		DROP TRIGGER page_revision_guild_petitions_delete;
		CREATE TABLE guild_petitions_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			rule_version INTEGER NOT NULL DEFAULT 1 CHECK (rule_version IN (1, 2)),
			guild_id INTEGER NOT NULL,
			guild_name TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN (
				'appellation', 'heraldry', 'banishment', 'winnowing', 'fellowship', 'enclosure',
				'interdict', 'heresy', 'temperance', 'indulgence',
				'crucible_purging', 'crucible_sealing', 'crucible_unsealing', 'alliance_found', 'alliance_consider', 'alliance_join', 'alliance_leave',
				'alliance_remove', 'alliance_market_enable', 'alliance_market_disable', 'alliance_withdraw', 'alliance_ballot',
				'global_expedition_opt_in', 'global_expedition_opt_out'
			)),
			conflict_subject TEXT NOT NULL,
			subject_locked INTEGER NOT NULL DEFAULT 1 CHECK (subject_locked IN (0, 1)),
			petitioner_id INTEGER NOT NULL,
			proposed_name TEXT,
			proposed_icon_id TEXT,
			target_client_id INTEGER,
			target_membership_id INTEGER,
			show_creator INTEGER NOT NULL DEFAULT 1 CHECK(show_creator IN (0,1)),
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
			snapshot_active_count INTEGER CHECK(snapshot_active_count IS NULL OR snapshot_active_count BETWEEN 0 AND 9007199254740991),
			voting_threshold INTEGER CHECK(voting_threshold IS NULL OR voting_threshold BETWEEN 1 AND 9007199254740991),
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
					'alliance_remove', 'alliance_market_enable', 'alliance_market_disable', 'alliance_withdraw', 'alliance_ballot',
					'global_expedition_opt_in', 'global_expedition_opt_out')
					AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL)
			),
			FOREIGN KEY (petitioner_id) REFERENCES clients (id),
			FOREIGN KEY (target_client_id) REFERENCES clients (id)
		);
		INSERT INTO guild_petitions_new (
			id, rule_version, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
			proposed_name, proposed_icon_id, target_client_id, target_membership_id, show_creator,
			created_at, expires_at, resolved_at, lifecycle,
			execution_state, execution_attempts, execution_last_attempt_at,
			execution_failure_category, execution_failure_message, execution_effect, snapshot_active_count, voting_threshold
		)
		SELECT
			id, rule_version, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
			proposed_name, proposed_icon_id, target_client_id, target_membership_id, show_creator,
			created_at, expires_at, resolved_at, lifecycle,
			execution_state, execution_attempts, execution_last_attempt_at,
			execution_failure_category, execution_failure_message, execution_effect, snapshot_active_count, voting_threshold
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
		INSERT INTO sqlite_sequence(name,seq) SELECT 'guild_petitions',seq FROM global_expedition_petition_sequence
			WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='guild_petitions');
		UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM global_expedition_petition_sequence),0))
			WHERE name='guild_petitions';
		DROP TABLE global_expedition_petition_sequence;
		CREATE TRIGGER event_council_ballot AFTER INSERT ON guild_petition_votes BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN (
				SELECT client_id FROM guild_memberships WHERE guild_id=(SELECT guild_id FROM guild_petitions WHERE id=NEW.petition_id));
		END;
		CREATE TRIGGER event_council_petition AFTER UPDATE ON guild_petitions BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN (SELECT client_id FROM guild_memberships WHERE guild_id=NEW.guild_id);
		END;
		CREATE TRIGGER alliance_roster_departure AFTER DELETE ON alliance_memberships BEGIN
			-- Roster changes preserve pending proposals and their original electorate.
			-- Only dissolution makes the Alliance itself unavailable.
			UPDATE alliance_processes SET stage='cancelled', resolution_reason='alliance_unavailable',
				resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE alliance_id=OLD.alliance_id AND stage IN ('local','waiting','recipient','collective')
				AND (SELECT COUNT(*) FROM alliance_memberships WHERE alliance_id=OLD.alliance_id)<2;
			UPDATE guild_petitions SET lifecycle='withdrawn',subject_locked=0,
				resolved_at=MAX(created_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))
			WHERE lifecycle='active' AND id IN (SELECT l.petition_id FROM alliance_process_petitions l
				JOIN alliance_processes p ON p.id=l.process_id WHERE p.alliance_id=OLD.alliance_id AND p.stage='cancelled');
			DELETE FROM alliance_pending_slots WHERE process_id IN (
				SELECT id FROM alliance_processes WHERE alliance_id=OLD.alliance_id AND stage='cancelled');
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
		CREATE TRIGGER petition_discussion_proposal AFTER INSERT ON guild_petitions BEGIN
			INSERT INTO petition_discussions VALUES(NEW.id,NULL,NEW.show_creator,CASE WHEN NEW.lifecycle='active' THEN NULL ELSE COALESCE(NEW.resolved_at,NEW.created_at) END);
			INSERT INTO petition_discussion_links VALUES(NEW.id,NEW.id);
			INSERT INTO petition_discussion_guilds SELECT NEW.id,id FROM guilds WHERE id=NEW.guild_id;
			INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,event_type,created_at)
			SELECT NEW.id,NEW.petitioner_id,'proposal:'||NEW.id,'I propose this petition.','proposal',NEW.created_at WHERE NEW.show_creator=1;
		END;
		CREATE TRIGGER petition_discussion_inherit_creator AFTER INSERT ON alliance_process_petitions BEGIN
			UPDATE guild_petitions SET show_creator=0 WHERE id=NEW.petition_id AND (
				EXISTS(SELECT 1 FROM alliance_process_petitions l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.process_id=NEW.process_id AND p.show_creator=0)
				OR NEW.process_id IN (SELECT value FROM json_each(COALESCE((SELECT value FROM service_settings WHERE key='petition_discussion_hidden_processes'),'[]'))));
			UPDATE petition_discussions SET process_id=NEW.process_id WHERE id=NEW.petition_id
				AND (SELECT shared_discussion FROM alliance_processes WHERE id=NEW.process_id)=1
				AND NOT EXISTS(SELECT 1 FROM petition_discussions WHERE process_id=NEW.process_id);
			UPDATE petition_discussion_links SET discussion_id=(SELECT id FROM petition_discussions WHERE process_id=NEW.process_id)
				WHERE petition_id=NEW.petition_id AND EXISTS(SELECT 1 FROM petition_discussions WHERE process_id=NEW.process_id);
			DELETE FROM petition_discussions WHERE id=NEW.petition_id AND process_id IS NULL
				AND NOT EXISTS(SELECT 1 FROM petition_discussion_links WHERE discussion_id=NEW.petition_id);
			INSERT OR IGNORE INTO petition_discussion_guilds
				SELECT d.id,g.id FROM petition_discussions d JOIN alliance_processes p ON p.id=d.process_id JOIN guilds g
				ON g.id=p.initiator_guild_id OR (p.kind='found' AND g.id=p.target_guild_id)
				OR EXISTS(SELECT 1 FROM alliance_memberships am WHERE am.alliance_id=p.alliance_id AND am.guild_id=g.id)
				WHERE p.id=NEW.process_id AND d.closed_at IS NULL;
			UPDATE petition_discussions SET show_creator=0 WHERE process_id=NEW.process_id
				AND EXISTS(SELECT 1 FROM alliance_process_petitions l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.process_id=NEW.process_id AND p.show_creator=0);
		END;
		CREATE TRIGGER petition_discussion_creator_change AFTER UPDATE OF show_creator ON guild_petitions BEGIN
			UPDATE petition_discussions SET show_creator=NEW.show_creator WHERE id IN (SELECT discussion_id FROM petition_discussion_links WHERE petition_id=NEW.id);
		END;
		CREATE TRIGGER petition_discussion_close AFTER UPDATE OF lifecycle ON guild_petitions WHEN NEW.lifecycle!='active' BEGIN
			UPDATE petition_discussions SET closed_at=COALESCE(NEW.resolved_at,NEW.created_at) WHERE id IN (SELECT discussion_id FROM petition_discussion_links WHERE petition_id=NEW.id) AND process_id IS NULL;
		END;
		CREATE TRIGGER petition_discussion_petition_delete AFTER DELETE ON guild_petitions BEGIN
			DELETE FROM petition_discussions WHERE id=OLD.id AND process_id IS NULL;
		END;
		CREATE TRIGGER page_revision_guild_petitions_insert AFTER INSERT ON guild_petitions BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_petitions_update AFTER UPDATE ON guild_petitions BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_petitions_delete AFTER DELETE ON guild_petitions BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;

		CREATE TABLE global_expedition_launch (
			id INTEGER PRIMARY KEY CHECK(id = 1),
			triggered_at INTEGER NOT NULL CHECK(triggered_at BETWEEN 0 AND 9007199254740991),
			vote_closes_at INTEGER NOT NULL CHECK(vote_closes_at BETWEEN triggered_at AND 9007199254740991),
			switch_at INTEGER NOT NULL CHECK(switch_at BETWEEN vote_closes_at AND 9007199254740991),
			vote_result TEXT CHECK(vote_result IS NULL OR vote_result IN ('passed', 'failed')),
			applied_at INTEGER CHECK(applied_at IS NULL OR applied_at BETWEEN switch_at AND 9007199254740991)
		) STRICT;
		CREATE TABLE global_expedition_launch_guilds (
			guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
			vote_result TEXT CHECK(vote_result IS NULL OR vote_result IN ('passed', 'failed')),
			aye_count INTEGER CHECK(aye_count IS NULL OR aye_count BETWEEN 0 AND 9007199254740991),
			nay_count INTEGER CHECK(nay_count IS NULL OR nay_count BETWEEN 0 AND 9007199254740991),
			eligible_count INTEGER CHECK(eligible_count IS NULL OR eligible_count BETWEEN 0 AND 9007199254740991),
			CHECK ((vote_result IS NULL AND aye_count IS NULL AND nay_count IS NULL AND eligible_count IS NULL) OR
				(vote_result IS NOT NULL AND aye_count IS NOT NULL AND nay_count IS NOT NULL AND eligible_count IS NOT NULL))
		) STRICT;
		CREATE TABLE global_expedition_launch_votes (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			guild_id INTEGER NOT NULL REFERENCES global_expedition_launch_guilds(guild_id) ON DELETE CASCADE,
			choice TEXT NOT NULL CHECK(choice IN ('aye', 'nay')),
			cast_at INTEGER NOT NULL CHECK(cast_at BETWEEN 0 AND 9007199254740991)
		) STRICT;
		CREATE INDEX global_expedition_launch_vote_guild ON global_expedition_launch_votes(guild_id, choice);
		CREATE TRIGGER global_expedition_launch_vote_immutable
			BEFORE UPDATE ON global_expedition_launch_votes BEGIN
			SELECT RAISE(ABORT, 'Global Expedition ballot is immutable');
		END;

		CREATE TABLE global_expedition_guild_participation (
			guild_id INTEGER PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
			opted_in INTEGER NOT NULL CHECK(opted_in IN (0, 1)),
			effective_at INTEGER NOT NULL CHECK(effective_at BETWEEN 0 AND 9007199254740991),
			changed_at INTEGER NOT NULL CHECK(changed_at BETWEEN 0 AND 9007199254740991),
			source TEXT NOT NULL CHECK(source IN ('launch_default', 'council'))
		) STRICT;
		CREATE TRIGGER global_expedition_new_guild_default AFTER INSERT ON guilds
		WHEN EXISTS (SELECT 1 FROM global_expedition_launch WHERE id=1)
		BEGIN
			INSERT INTO global_expedition_guild_participation(guild_id, opted_in, effective_at, changed_at, source)
			SELECT NEW.id, 1, launch.switch_at, CAST((julianday('now')-2440587.5)*86400000 AS INTEGER), 'launch_default'
			FROM global_expedition_launch launch WHERE launch.id=1;
		END;
	`
};
