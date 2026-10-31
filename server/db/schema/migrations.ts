import { browser_chat_auth_migration } from './migrations/browser-chat-auth';
import { receipt_reviews_migration } from './migrations/receipt-reviews';
import { browser_chat_identities_migration } from './migrations/browser-chat-identities';
import { cheat_categories_migration } from './migrations/cheat-categories';
import { shared_petition_discussions_migration } from './migrations/shared-petition-discussions';
import { wish_capacity_migration } from './migrations/wish-capacity';
import { petition_discussions_migration } from './migrations/petition-discussions';
import { rollback_admission_migration } from './migrations/rollback-admission';
import { rollback_protocol_migration } from './migrations/rollback-protocol';
import { trade_custody_migration } from './migrations/trade-custody';
import { market_custody_migration } from './migrations/market-custody';
import { market_custody_evidence_migration } from './migrations/market-custody-evidence';
import { exchange_custody_migration } from './migrations/exchange-custody';
import { economy_custody_migration } from './migrations/economy-custody';
import { save_rollback_migration } from './migrations/save-rollback';
import { charitree_retirement_migration } from './migrations/charitree-retirement';
import { market_exchange_history_migration } from './migrations/market-exchange-history';
import { market_listing_terms_migration } from './migrations/market-listing-terms';
import { crucible_guild_scope_migration } from './migrations/crucible-guild-scope';
import { transfer_context_migration } from './migrations/transfer-context';
import type { Migration } from './types';
import { transfers_history_migration } from './migrations/transfers-history';
import { migrations_001_010 } from './migrations/001-010';
import { migrations_011_020 } from './migrations/011-020';
import { migrations_021_030 } from './migrations/021-030';
import { migrations_031_040 } from './migrations/031-040';
import { migrations_041_050 } from './migrations/041-050';
import { migrations_061_070 } from './migrations/061-070';
import { migrations_051_060 } from './migrations/051-060';
import { migrations_071_080 } from './migrations/071-080';
import { migrations_081_090 } from './migrations/081-090';
import { migrations_091_100 } from './migrations/091-100';
import { migrations_101_110 } from './migrations/101-110';
import { migrations_111_120 } from './migrations/111-120';
import { migrations_121_130 } from './migrations/121-130';
import { migrations_131_140 } from './migrations/131-140';
import { migrations_141_150 } from './migrations/141-150';
import { migrations_151_160 } from './migrations/151-160';

export const migrations: Migration[] = [
	...migrations_001_010,
	...migrations_011_020,
	...migrations_021_030,
	...migrations_031_040,
	...migrations_041_050,
	...migrations_051_060,
	...migrations_061_070,
	...migrations_071_080,
	...migrations_081_090,
	...migrations_091_100,
	...migrations_101_110,
	...migrations_111_120,
	...migrations_121_130,
	...migrations_131_140,
	...migrations_141_150,
	...migrations_151_160,
	transfers_history_migration,
	{ version: 160, sql: `
		CREATE TABLE character_feature_testers (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			feature TEXT NOT NULL CHECK(length(feature) BETWEEN 1 AND 64),
			PRIMARY KEY(client_id, feature)
		);
		CREATE TRIGGER event_feature_tester_insert AFTER INSERT ON character_feature_testers BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.client_id;
		END;
		CREATE TRIGGER event_feature_tester_delete AFTER DELETE ON character_feature_testers BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=OLD.client_id;
		END;
	` },
	transfer_context_migration,
	crucible_guild_scope_migration,
	{ version: 163, sql: `
		CREATE TABLE client_cheat_mod_detections (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			mod_name TEXT NOT NULL,
			detected_at INTEGER NOT NULL CHECK(detected_at BETWEEN 0 AND 9007199254740991),
			PRIMARY KEY(client_id, mod_name)
		);
		INSERT INTO client_cheat_mod_detections (client_id, mod_name, detected_at)
		SELECT runtime.client_id, mod.value, runtime.reported_at
		FROM client_runtime_snapshots runtime, json_each(runtime.active_mods) mod
		WHERE mod.value IN ('Add Items', 'God Mode', 'dev.Console',
			'[Creative Mode] God mode w/ Loot + XP Multipliers', 'Melvor Cheat Suite',
			'Cheat Chest', 'Universal Item Spawner', 'Loot Chests');
	` },
	{ version: 164, sql: `
		ALTER TABLE alliance_processes ADD COLUMN governance_version INTEGER NOT NULL DEFAULT 1 CHECK(governance_version IN (1,2));
		ALTER TABLE alliance_processes ADD COLUMN resolution_reason TEXT;
		ALTER TABLE alliance_processes ADD COLUMN resolution_guild_name TEXT;
		DROP TRIGGER alliance_roster_departure;
		DROP TRIGGER alliance_deleted_guild;
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
	` },
	{ version: 165, sql: `
		ALTER TABLE guild_memberships ADD COLUMN joined_at INTEGER NOT NULL DEFAULT 0
			CHECK(joined_at BETWEEN 0 AND 9007199254740991);
		UPDATE guild_memberships SET joined_at = COALESCE((
			SELECT created_at FROM guild_activity_events
			WHERE guild_id = guild_memberships.guild_id
			AND source_key = 'membership:' || guild_memberships.id || ':joined'
		), 0);
		CREATE TRIGGER guild_membership_join_time AFTER INSERT ON guild_memberships
		WHEN NEW.joined_at = 0 BEGIN
			UPDATE guild_memberships SET joined_at = CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)
			WHERE id = NEW.id;
		END;
		ALTER TABLE guild_petitions ADD COLUMN snapshot_active_count INTEGER
			CHECK(snapshot_active_count IS NULL OR snapshot_active_count BETWEEN 0 AND 9007199254740991);
		ALTER TABLE guild_petitions ADD COLUMN voting_threshold INTEGER
			CHECK(voting_threshold IS NULL OR voting_threshold BETWEEN 1 AND 9007199254740991);
		CREATE TRIGGER council_threshold_immutable BEFORE UPDATE OF snapshot_active_count, voting_threshold ON guild_petitions
		WHEN OLD.voting_threshold IS NOT NULL AND
			(NEW.voting_threshold IS NOT OLD.voting_threshold OR NEW.snapshot_active_count IS NOT OLD.snapshot_active_count)
		BEGIN SELECT RAISE(ABORT, 'Council voting threshold is immutable'); END;
	` },
	market_listing_terms_migration,
	{ version: 167, sql: `
		ALTER TABLE guild_raids ADD COLUMN cycle_start INTEGER
			CHECK(cycle_start IS NULL OR cycle_start = started_at);
		CREATE UNIQUE INDEX guild_raid_cycle ON guild_raids(guild_id, cycle_start)
			WHERE cycle_start IS NOT NULL;
		CREATE TABLE raid_schedule (
			id INTEGER PRIMARY KEY CHECK(id = 1),
			starts_at INTEGER NOT NULL CHECK(starts_at >= 0)
		);
		-- Round up to Friday noon after every existing active Raid has ended.
		WITH cutoff AS (
			SELECT MAX(CAST(strftime('%s','now') AS INTEGER) * 1000,
				COALESCE(MAX(expires_at), 0)) AS ends_at FROM guild_raids
		)
		INSERT INTO raid_schedule(id, starts_at)
		SELECT 1, 129600000 + ((ends_at - 129600000 + 604799999) / 604800000) * 604800000 FROM cutoff;
		CREATE TABLE raid_entries (
			raid_id INTEGER NOT NULL REFERENCES guild_raids(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			entered_at INTEGER NOT NULL CHECK(entered_at >= 0),
			PRIMARY KEY(raid_id, client_id)
		);
	` },
	{ version: 168, sql: `
		CREATE TABLE poll_discussion_message_moderation (
			message_id INTEGER PRIMARY KEY REFERENCES poll_discussion_messages(id) ON DELETE CASCADE,
			deleted_at INTEGER NOT NULL CHECK(deleted_at >= 0)
		);
		CREATE TRIGGER event_poll_discussion_moderation AFTER INSERT ON poll_discussion_message_moderation BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL;
		END;
	` },
	{ version: 169, sql: `
		-- Apply the new inactivity deadline to every unfinished Council Petition.
		-- Completed results and Guild-cast Alliance ballots remain unchanged.
		UPDATE guild_petitions SET expires_at = COALESCE((
			SELECT MAX(submitted_at) FROM guild_petition_votes WHERE petition_id=guild_petitions.id
		), created_at) + 86400000 WHERE lifecycle='active';
	` },
	market_exchange_history_migration,
	charitree_retirement_migration,
	{ version: 172, sql: `
		CREATE TABLE character_save_loads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			load_id TEXT NOT NULL,
			save_timestamp INTEGER CHECK(save_timestamp IS NULL OR save_timestamp BETWEEN 1 AND 9007199254740991),
			client_loaded_at INTEGER NOT NULL CHECK(client_loaded_at BETWEEN 0 AND 9007199254740991),
			capture_source TEXT NOT NULL CHECK(capture_source IN ('decode', 'character_loaded')),
			first_reported_at INTEGER NOT NULL CHECK(first_reported_at BETWEEN 0 AND 9007199254740991),
			last_reported_at INTEGER NOT NULL CHECK(last_reported_at BETWEEN first_reported_at AND 9007199254740991),
			UNIQUE(client_id, load_id)
		);
		CREATE INDEX character_save_load_history ON character_save_loads(client_id, first_reported_at, id);
		ALTER TABLE client_sessions ADD COLUMN save_load_id INTEGER REFERENCES character_save_loads(id) ON DELETE SET NULL;
	` },
	save_rollback_migration,
	economy_custody_migration,
	exchange_custody_migration,
	market_custody_evidence_migration,
	market_custody_migration,
	trade_custody_migration,
	rollback_protocol_migration,
	rollback_admission_migration,
	{ version: 181, sql: `
		DROP TRIGGER alliance_roster_departure;
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
	` },
	{ version: 182, sql: `
		-- Preserve any earlier inactivity deadline; cap all active Free Fellowship Petitions.
		UPDATE guild_petitions SET expires_at=MIN(expires_at,created_at+129600000)
		WHERE lifecycle='active' AND guild_id IN (SELECT id FROM guilds WHERE type='free_fellowship');
	` },
	{ version: 183, sql: `
		ALTER TABLE client_runtime_snapshots ADD COLUMN active_mod_details TEXT NOT NULL DEFAULT '[]'
			CHECK(length(active_mod_details)<=65536);
		ALTER TABLE client_cheat_mod_detections ADD COLUMN mod_id INTEGER
			CHECK(mod_id IS NULL OR mod_id BETWEEN 1 AND 9007199254740991);
		ALTER TABLE support_teams ADD COLUMN required_active_mod_id INTEGER
			CHECK(required_active_mod_id IS NULL OR required_active_mod_id BETWEEN 1 AND 9007199254740991);
		-- Frozen public mod.io title/ID mappings verified on 2026-10-11. No guessed aliases.
		CREATE TEMP TABLE mod_id_backfill (id INTEGER NOT NULL, name TEXT PRIMARY KEY);
		INSERT INTO mod_id_backfill(id,name) VALUES
			(2429395,'Add Items'),
			(5562948,'God Mode'),
			(2253095,'dev.Console'),
			(5377900,'[Creative Mode] God mode w/ Loot + XP Multipliers'),
			(5964319,'Melvor Cheat Suite'),
			(6379230,'Cheat Chest'),
			(6419494,'Universal Item Spawner'),
			(2479713,'Loot Chests'),
			(5043199,'SUPER AWESOME EXPANSION'),
			(5043199,'Super Awesome Expansion!');
		UPDATE client_runtime_snapshots SET active_mod_details=(
			SELECT json_group_array(json_object('id',known.id,'name',loaded.value))
			FROM json_each(client_runtime_snapshots.active_mods) loaded
			LEFT JOIN mod_id_backfill known ON known.name=loaded.value
		);
		UPDATE client_cheat_mod_detections SET mod_id=(SELECT id FROM mod_id_backfill WHERE name=mod_name);
		UPDATE support_teams SET required_active_mod_id=(SELECT id FROM mod_id_backfill WHERE name=required_active_mod_name);
		DROP TABLE mod_id_backfill;
	` },
	petition_discussions_migration,
	wish_capacity_migration,
	shared_petition_discussions_migration,
	cheat_categories_migration,
	{ version: 188, sql: `
		CREATE TABLE page_revisions (section TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
		INSERT INTO page_revisions(section) VALUES ('guild');
		CREATE TRIGGER page_revision_client_profile AFTER UPDATE OF display_name, icon_id ON clients BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guilds_insert AFTER INSERT ON guilds BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guilds_update AFTER UPDATE ON guilds BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guilds_delete AFTER DELETE ON guilds BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_memberships_insert AFTER INSERT ON guild_memberships BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_memberships_update AFTER UPDATE ON guild_memberships BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_memberships_delete AFTER DELETE ON guild_memberships BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_applications_insert AFTER INSERT ON guild_applications BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_applications_update AFTER UPDATE ON guild_applications BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_applications_delete AFTER DELETE ON guild_applications BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
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
		CREATE TRIGGER page_revision_guild_petition_votes_insert AFTER INSERT ON guild_petition_votes BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_petition_votes_update AFTER UPDATE ON guild_petition_votes BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_petition_votes_delete AFTER DELETE ON guild_petition_votes BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_activity_events_insert AFTER INSERT ON guild_activity_events BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_activity_events_update AFTER UPDATE ON guild_activity_events BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_guild_activity_events_delete AFTER DELETE ON guild_activity_events BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliances_insert AFTER INSERT ON alliances BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliances_update AFTER UPDATE ON alliances BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliances_delete AFTER DELETE ON alliances BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_memberships_insert AFTER INSERT ON alliance_memberships BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_memberships_update AFTER UPDATE ON alliance_memberships BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_memberships_delete AFTER DELETE ON alliance_memberships BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_processes_insert AFTER INSERT ON alliance_processes BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_processes_update AFTER UPDATE ON alliance_processes BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_processes_delete AFTER DELETE ON alliance_processes BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_process_petitions_insert AFTER INSERT ON alliance_process_petitions BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_process_petitions_update AFTER UPDATE ON alliance_process_petitions BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_process_petitions_delete AFTER DELETE ON alliance_process_petitions BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_ballots_insert AFTER INSERT ON alliance_ballots BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_ballots_update AFTER UPDATE ON alliance_ballots BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_ballots_delete AFTER DELETE ON alliance_ballots BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_pending_slots_insert AFTER INSERT ON alliance_pending_slots BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_pending_slots_update AFTER UPDATE ON alliance_pending_slots BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
		CREATE TRIGGER page_revision_alliance_pending_slots_delete AFTER DELETE ON alliance_pending_slots BEGIN
			UPDATE page_revisions SET revision=revision+1 WHERE section='guild';
		END;
	` },
	{ version: 189, sql: `
		CREATE TABLE listing_filter_prompt_views (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			viewed_at INTEGER NOT NULL CHECK(viewed_at BETWEEN 0 AND 9007199254740991)
		);
	` },
	browser_chat_auth_migration,
	browser_chat_identities_migration,
	receipt_reviews_migration,
	{ version: 193, sql: `
		ALTER TABLE chat_translation_jobs ADD COLUMN highlight_color TEXT
			CHECK(highlight_color IS NULL OR (length(highlight_color) = 7 AND
				substr(highlight_color, 1, 1) = '#' AND substr(highlight_color, 2) NOT GLOB '*[^0-9a-fA-F]*'));
	` },
	{ version: 194, sql: `
		CREATE TABLE expedition_preparation_tasks (
			visit_id INTEGER NOT NULL,
			task_id TEXT NOT NULL,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			skill_ids TEXT NOT NULL CHECK (json_valid(skill_ids) AND json_array_length(skill_ids) = 8),
			PRIMARY KEY (visit_id, task_id),
			UNIQUE (visit_id, client_id),
			FOREIGN KEY (visit_id, task_id) REFERENCES expedition_tasks(visit_id, task_id) ON DELETE CASCADE
		) STRICT;
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
	` },
];
