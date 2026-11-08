import { identity_recovery_state_migration } from './migrations/identity-recovery-state';
import { verified_identity_accounts_migration } from './migrations/verified-identity-accounts';
import { fighter_adventures_migration } from './migrations/fighter-adventures';
import { expedition_work_catalogs_migration } from './migrations/expedition-work-catalogs';
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
		CREATE TABLE combat_registrations(client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			registration_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
		CREATE TABLE combat_encounters(id TEXT PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			controller TEXT NOT NULL,food_id TEXT NOT NULL,budget INTEGER NOT NULL CHECK(budget BETWEEN 0 AND 1000),
			used INTEGER NOT NULL CHECK(used BETWEEN 0 AND budget),status TEXT NOT NULL CHECK(status IN ('active','victory','defeat','fled','expired','interrupted')),
			registration_json TEXT NOT NULL,created_at INTEGER NOT NULL,refunded_at INTEGER,refund_admin INTEGER,refund_reason TEXT);
		CREATE UNIQUE INDEX combat_one_active ON combat_encounters(client_id) WHERE status='active';
	` },
	{ version: 195, sql: `
		CREATE TABLE combat_rollback_enrollments(
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			first_operation_id INTEGER NOT NULL CHECK(first_operation_id BETWEEN 1 AND 9007199254740991),
			created_at INTEGER NOT NULL);
	` },
	{ version: 196, foreign_keys_disabled: true, sql: `
		CREATE TABLE combat_encounters_new(id TEXT PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			controller TEXT NOT NULL,food_id TEXT NOT NULL,budget INTEGER NOT NULL CHECK(budget BETWEEN 0 AND 9007199254740991),
			used INTEGER NOT NULL CHECK(used BETWEEN 0 AND budget),status TEXT NOT NULL CHECK(status IN ('active','victory','defeat','fled','expired','interrupted')),
			registration_json TEXT NOT NULL,created_at INTEGER NOT NULL,refunded_at INTEGER,refund_admin INTEGER,refund_reason TEXT);
		INSERT INTO combat_encounters_new(id,client_id,controller,food_id,budget,used,status,registration_json,created_at,refunded_at,refund_admin,refund_reason)
			SELECT id,client_id,controller,food_id,budget,used,status,registration_json,created_at,refunded_at,refund_admin,refund_reason FROM combat_encounters;
		DROP TABLE combat_encounters;
		ALTER TABLE combat_encounters_new RENAME TO combat_encounters;
		CREATE UNIQUE INDEX combat_one_active ON combat_encounters(client_id) WHERE status='active';
	` },
	{ version: 197, sql: `
		-- Test-only native registration is deliberately discarded. Shared economy data is untouched.
		DROP TABLE combat_registrations;
		CREATE TABLE combat_characters (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			attack INTEGER NOT NULL DEFAULT 1 CHECK(attack BETWEEN 1 AND 99),
			strength INTEGER NOT NULL DEFAULT 1 CHECK(strength BETWEEN 1 AND 99),
			defence INTEGER NOT NULL DEFAULT 1 CHECK(defence BETWEEN 1 AND 99),
			hitpoints INTEGER NOT NULL DEFAULT 1 CHECK(hitpoints BETWEEN 1 AND 99),
			ranged INTEGER NOT NULL DEFAULT 1 CHECK(ranged BETWEEN 1 AND 99),
			magic INTEGER NOT NULL DEFAULT 1 CHECK(magic BETWEEN 1 AND 99),
			invested_micros INTEGER NOT NULL DEFAULT 0 CHECK(invested_micros BETWEEN 0 AND 3288000000),
			revision INTEGER NOT NULL DEFAULT 0 CHECK(revision BETWEEN 0 AND 9007199254740991)
		) STRICT;
		CREATE TABLE combat_ep_ledger (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL REFERENCES clients(id),
			command_id TEXT NOT NULL UNIQUE,
			amount_micros INTEGER NOT NULL CHECK(amount_micros BETWEEN -3288000000 AND 3288000000 AND amount_micros!=0),
			created_at INTEGER NOT NULL
		) STRICT;
		CREATE INDEX combat_ep_owner ON combat_ep_ledger(client_id);
	` },
	{ version: 198, sql: `
		CREATE TABLE combat_reset_balances (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			resets INTEGER NOT NULL DEFAULT 0 CHECK(resets BETWEEN 0 AND 1000000)
		) STRICT;
		CREATE TABLE combat_reset_grants (
			command_id TEXT PRIMARY KEY,
			client_id INTEGER NOT NULL REFERENCES clients(id),
			quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
			created_at INTEGER NOT NULL
		) STRICT;
	` },
	{ version: 199, sql: `
		CREATE TABLE combat_equipment_slots(client_id INTEGER NOT NULL REFERENCES combat_characters(client_id) ON DELETE CASCADE,
			slot TEXT NOT NULL CHECK(slot='Weapon'),tier INTEGER NOT NULL CHECK(tier BETWEEN 0 AND 1),equipped_item TEXT,
			PRIMARY KEY(client_id,slot)) STRICT;
		CREATE TABLE combat_equipment_projects(id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL REFERENCES combat_characters(client_id) ON DELETE CASCADE,item_id TEXT NOT NULL,
			progress_json TEXT NOT NULL,created_at INTEGER NOT NULL,completed_at INTEGER,UNIQUE(client_id,item_id)) STRICT;
		CREATE UNIQUE INDEX combat_one_project ON combat_equipment_projects(client_id) WHERE completed_at IS NULL;
		CREATE TABLE combat_project_tracking(client_id INTEGER PRIMARY KEY REFERENCES combat_characters(client_id) ON DELETE CASCADE,
			project_id INTEGER NOT NULL REFERENCES combat_equipment_projects(id) ON DELETE CASCADE,task_id TEXT NOT NULL,
			started_at INTEGER NOT NULL,start_clock_offset_ms INTEGER NOT NULL,epoch TEXT NOT NULL,
			counter_ms INTEGER NOT NULL CHECK(counter_ms>=0),statistics_json TEXT NOT NULL) STRICT;
		CREATE TABLE combat_project_reports(client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(client_id,operation_id)) STRICT;
	` },
	{ version: 200, foreign_keys_disabled: true, sql: `
		-- Preserve the original Weapon slot and expand the equipment table's slot and tier vocabulary.
		CREATE TABLE combat_equipment_slots_new(client_id INTEGER NOT NULL REFERENCES combat_characters(client_id) ON DELETE CASCADE,
			slot TEXT NOT NULL CHECK(slot IN ('Weapon','Shield','Helmet','Boots','Platelegs','Platebody','Gloves')),
			tier INTEGER NOT NULL CHECK(tier BETWEEN 0 AND 6),equipped_item TEXT,
			PRIMARY KEY(client_id,slot)) STRICT;
		INSERT INTO combat_equipment_slots_new(client_id,slot,tier,equipped_item)
			SELECT client_id,slot,tier,equipped_item FROM combat_equipment_slots;
		DROP TABLE combat_equipment_slots;
		ALTER TABLE combat_equipment_slots_new RENAME TO combat_equipment_slots;
	` },
	{ version: 201, foreign_keys_disabled: true, sql: `
		-- Preserve all equipment access and equipped items while adding arrow project access.
		CREATE TABLE combat_equipment_slots_new(client_id INTEGER NOT NULL REFERENCES combat_characters(client_id) ON DELETE CASCADE,
			slot TEXT NOT NULL CHECK(slot IN ('Weapon','Shield','Helmet','Boots','Platelegs','Platebody','Gloves','Quiver')),
			tier INTEGER NOT NULL CHECK(tier BETWEEN 0 AND 6),equipped_item TEXT,
			PRIMARY KEY(client_id,slot)) STRICT;
		INSERT INTO combat_equipment_slots_new(client_id,slot,tier,equipped_item)
			SELECT client_id,slot,tier,equipped_item FROM combat_equipment_slots;
		DROP TABLE combat_equipment_slots;
		ALTER TABLE combat_equipment_slots_new RENAME TO combat_equipment_slots;
	` },
	{ version: 202, sql: `CREATE INDEX idx_expedition_ep_ledger_recent ON expedition_ep_ledger(created_at, client_id, points_micros);` },
	{ version: 203, sql: `
		CREATE TABLE combat_food_access(client_id INTEGER PRIMARY KEY REFERENCES combat_characters(client_id) ON DELETE CASCADE,
			tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 8),equipped_item TEXT) STRICT;
		-- Authorized disposal of test food. Preserve custody conservation and audit ancestry.
		INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason)
			SELECT root_key,location,'consumed:combat-food-retired',quantity,unixepoch()*1000,'retire-combat-food'
			FROM economy_custody_balances WHERE location LIKE 'combat-online:%' OR location LIKE 'combat-reserved:%';
		DROP TABLE combat_encounters;
		CREATE TABLE combat_encounters(id TEXT PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			controller TEXT NOT NULL,food_id TEXT NOT NULL,used INTEGER NOT NULL CHECK(used BETWEEN 0 AND 9007199254740991),
			status TEXT NOT NULL CHECK(status IN ('active','victory','defeat','fled','expired','interrupted')),
			registration_json TEXT NOT NULL,created_at INTEGER NOT NULL) STRICT;
		CREATE UNIQUE INDEX combat_one_active ON combat_encounters(client_id) WHERE status='active';
	` },
	{ version: 204, sql: `
		CREATE TABLE combat_food_access_new(client_id INTEGER NOT NULL REFERENCES combat_characters(client_id) ON DELETE CASCADE,
			slot TEXT NOT NULL DEFAULT 'Food' CHECK(slot IN ('Food','Food2')),
			tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 8),equipped_item TEXT,PRIMARY KEY(client_id,slot)) STRICT;
		INSERT INTO combat_food_access_new(client_id,slot,tier,equipped_item)
			SELECT client_id,'Food',tier,equipped_item FROM combat_food_access;
		DROP TABLE combat_food_access;
		ALTER TABLE combat_food_access_new RENAME TO combat_food_access;
	` },
	{ version: 205, sql: `
		ALTER TABLE polls ADD COLUMN announcement INTEGER NOT NULL DEFAULT 0 CHECK(announcement IN (0,1));
		ALTER TABLE polls ADD COLUMN deleted_at INTEGER CHECK(deleted_at IS NULL OR deleted_at BETWEEN 0 AND 9007199254740991);
		CREATE TABLE announcement_read_state (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK(last_read_message_id BETWEEN 0 AND 9007199254740991)
		) STRICT;
		CREATE TABLE announcement_reactions (
			message_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			reaction TEXT NOT NULL, created_at INTEGER NOT NULL,
			PRIMARY KEY(message_id,client_id,reaction)
		) STRICT;
		CREATE TABLE chat_message_moderation (
			message_id INTEGER PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
			deleted_at INTEGER NOT NULL CHECK(deleted_at BETWEEN 0 AND 9007199254740991)
		) STRICT;
		CREATE TRIGGER event_private_message_moderation AFTER INSERT ON chat_message_moderation BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN
				(SELECT client_id FROM chat_participants WHERE conversation_id=
					(SELECT conversation_id FROM chat_messages WHERE id=NEW.message_id));
		END;
		CREATE TRIGGER event_announcement_delete AFTER UPDATE OF deleted_at ON polls
		WHEN NEW.announcement=1 AND NEW.deleted_at IS NOT OLD.deleted_at BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE deleted_at IS NULL;
		END;
		CREATE TRIGGER event_announcement_read_insert AFTER INSERT ON announcement_read_state BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.client_id;
		END;
		CREATE TRIGGER event_announcement_read_update AFTER UPDATE OF last_read_message_id ON announcement_read_state
		WHEN NEW.last_read_message_id!=OLD.last_read_message_id BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.client_id;
		END;
	` },
	{ version: 206, sql: `
		ALTER TABLE poll_translation_jobs ADD COLUMN highlight_color TEXT;
		CREATE TABLE poll_message_bodies (
			job_id INTEGER PRIMARY KEY REFERENCES poll_translation_jobs(id) ON DELETE CASCADE,
			parts TEXT NOT NULL,
			translations TEXT NOT NULL DEFAULT '{}'
		) STRICT;
	` },
	{ version: 207, sql: `
		CREATE TABLE combat_tutorial (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			victories INTEGER NOT NULL DEFAULT 0 CHECK(victories BETWEEN 0 AND 7)
		) STRICT;
		ALTER TABLE combat_encounters ADD COLUMN tutorial_trial INTEGER;
	` },
	{ version: 208, sql: `
		-- No tables reference combat_encounters; preserve all encounter history and its active index.
		CREATE TABLE combat_encounters_new(id TEXT PRIMARY KEY,client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			controller TEXT NOT NULL,food_id TEXT NOT NULL,used INTEGER NOT NULL CHECK(used BETWEEN 0 AND 9007199254740991),
			status TEXT NOT NULL CHECK(status IN ('active','victory','defeat','draw','fled','expired','interrupted')),
			registration_json TEXT NOT NULL,created_at INTEGER NOT NULL,tutorial_trial INTEGER) STRICT;
		INSERT INTO combat_encounters_new(id,client_id,controller,food_id,used,status,registration_json,created_at,tutorial_trial)
			SELECT id,client_id,controller,food_id,used,status,registration_json,created_at,tutorial_trial FROM combat_encounters;
		DROP TABLE combat_encounters;
		ALTER TABLE combat_encounters_new RENAME TO combat_encounters;
		CREATE UNIQUE INDEX combat_one_active ON combat_encounters(client_id) WHERE status='active';
	` },
	{ version: 209, sql: `
		CREATE TABLE combat_unlocks (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			skill_caps_json TEXT NOT NULL DEFAULT '{}',
			material_caps_json TEXT NOT NULL DEFAULT '{}',
			food_cap INTEGER NOT NULL DEFAULT 1 CHECK(food_cap BETWEEN 1 AND 8),
			auto_eat INTEGER NOT NULL DEFAULT 0 CHECK(auto_eat IN (0,1))
		) STRICT;
		CREATE TABLE combat_raid_progress (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			raid TEXT NOT NULL, tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 3),
			wins INTEGER NOT NULL CHECK(wins BETWEEN 1 AND 9007199254740991),
			PRIMARY KEY(client_id,raid,tier)
		) STRICT;
		CREATE TABLE combat_raid_records (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			raid TEXT NOT NULL, ruleset TEXT NOT NULL,
			elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms BETWEEN 1 AND 9007199254740991),
			achieved_at INTEGER NOT NULL CHECK(achieved_at BETWEEN 0 AND 9007199254740991),
			PRIMARY KEY(client_id,raid,ruleset)
		) STRICT;
		ALTER TABLE combat_encounters ADD COLUMN raid_endpoint INTEGER CHECK(raid_endpoint BETWEEN 1 AND 3);
		ALTER TABLE combat_encounters ADD COLUMN raid_completed INTEGER NOT NULL DEFAULT 0 CHECK(raid_completed BETWEEN 0 AND 11);
		ALTER TABLE combat_encounters ADD COLUMN raid_ruleset TEXT;
	` },
	expedition_work_catalogs_migration,
	{ version: 211, sql: `
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
	{ version: 212, sql: `
		ALTER TABLE combat_encounters ADD COLUMN practice_id TEXT;
		ALTER TABLE combat_encounters ADD COLUMN practice_tier INTEGER CHECK(practice_tier BETWEEN 1 AND 12);
		ALTER TABLE combat_encounters ADD COLUMN practice_completed INTEGER NOT NULL DEFAULT 0 CHECK(practice_completed BETWEEN 0 AND 4);
		CREATE TABLE combat_practice_completions (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			practice_id TEXT NOT NULL,
			tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 12),
			ruleset TEXT NOT NULL,
			PRIMARY KEY(client_id, practice_id, tier, ruleset)
		) STRICT;
	` },
	{ version: 213, sql: `
		ALTER TABLE expedition_personal_records ADD COLUMN ending_bonus_eligible INTEGER NOT NULL DEFAULT 0 CHECK(ending_bonus_eligible IN (0,1));
		CREATE TABLE expedition_ending_claims (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			expedition_id INTEGER NOT NULL,
			points_micros INTEGER NOT NULL CHECK(points_micros > 0),
			created_at INTEGER NOT NULL
		) STRICT;
		CREATE INDEX idx_expedition_ending_claims_owner ON expedition_ending_claims(client_id, expedition_id);
		CREATE INDEX idx_expedition_work_owner_run ON expedition_work_sessions(client_id, expedition_id);
		CREATE TABLE expedition_ep_ledger_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			source_kind TEXT NOT NULL CHECK(source_kind IN ('work','supply','ending')),
			source_id INTEGER NOT NULL,
			points_micros INTEGER NOT NULL CHECK(points_micros >= 0),
			created_at INTEGER NOT NULL CHECK(created_at >= 0),
			expedition_id INTEGER CHECK(expedition_id IS NULL OR expedition_id > 0),
			UNIQUE(source_kind, source_id)
		) STRICT;
		INSERT INTO expedition_ep_ledger_new SELECT * FROM expedition_ep_ledger;
		INSERT INTO sqlite_sequence(name,seq)
		SELECT 'expedition_ep_ledger_new',seq FROM sqlite_sequence WHERE name='expedition_ep_ledger'
		AND NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='expedition_ep_ledger_new');
		UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM sqlite_sequence WHERE name='expedition_ep_ledger'),0))
		WHERE name='expedition_ep_ledger_new';
		DROP TABLE expedition_ep_ledger;
		ALTER TABLE expedition_ep_ledger_new RENAME TO expedition_ep_ledger;
		CREATE INDEX idx_expedition_ep_ledger_history ON expedition_ep_ledger(client_id, expedition_id);
		CREATE INDEX idx_expedition_ep_ledger_recent ON expedition_ep_ledger(created_at, client_id, points_micros);
	` },
	{ version: 214, sql: `
		CREATE TABLE combat_test_profiles (
			client_id INTEGER PRIMARY KEY REFERENCES combat_characters(client_id) ON DELETE CASCADE
		) STRICT;
	` },
	{ version: 215, sql: `
		CREATE INDEX combat_encounters_history ON combat_encounters(client_id, created_at DESC);
		CREATE INDEX combat_raid_ranking ON combat_raid_records(raid, ruleset, elapsed_ms, achieved_at, client_id);
	` },
	{ version: 216, sql: `
		CREATE TABLE combat_recovery (
			encounter_id TEXT PRIMARY KEY REFERENCES combat_encounters(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
			checkpoint TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
			state TEXT NOT NULL CHECK(state IN ('running','paused','terminal')),
			expires INTEGER NOT NULL DEFAULT 0, format INTEGER NOT NULL DEFAULT 1
		) STRICT;
		CREATE TABLE combat_availability (
			id INTEGER PRIMARY KEY CHECK(id=1), clock INTEGER NOT NULL DEFAULT 0,
			last_seen INTEGER NOT NULL DEFAULT 0, drain_at INTEGER, incompatible INTEGER NOT NULL DEFAULT 0
		) STRICT;
		INSERT INTO combat_availability(id) VALUES(1);
	` },
	{ version: 217, sql: `
		-- Finish saved tutorial projects that already meet the shortened requirements.
		CREATE TEMP TABLE tutorial_project_targets(item_id TEXT PRIMARY KEY, targets TEXT);
		INSERT INTO tutorial_project_targets VALUES
			('melvorD:Bronze_Sword','{"melvorD:Mining|melvorD:Copper_Ore":45000,"melvorD:Mining|melvorD:Tin_Ore":45000,"melvorD:Smithing|melvorD:Bronze_Bar":45000,"melvorD:Smithing|melvorD:Bronze_Sword":45000}'),
			('melvorD:Bronze_Helmet','{"melvorD:Mining|melvorD:Copper_Ore":90000,"melvorD:Mining|melvorD:Tin_Ore":90000,"melvorD:Smithing|melvorD:Bronze_Bar":90000,"melvorD:Smithing|melvorD:Bronze_Helmet":90000}'),
			('melvorD:Bronze_Shield','{"melvorD:Mining|melvorD:Copper_Ore":135000,"melvorD:Mining|melvorD:Tin_Ore":135000,"melvorD:Smithing|melvorD:Bronze_Bar":135000,"melvorD:Smithing|melvorD:Bronze_Shield":135000}'),
			('melvorD:Iron_Shield','{"melvorD:Mining|melvorD:Iron_Ore":135000,"melvorD:Smithing|melvorD:Iron_Bar":135000,"melvorD:Smithing|melvorD:Iron_Shield":135000}'),
			('melvorD:Shrimp','{"melvorD:Fishing|melvorD:Raw_Shrimp":45000,"melvorD:Cooking|melvorD:Shrimp":45000}');
		CREATE TEMP TABLE completed_tutorial_projects AS
		SELECT project.id, project.client_id FROM combat_equipment_projects project
		JOIN tutorial_project_targets recipe ON recipe.item_id=project.item_id
		WHERE project.completed_at IS NULL AND NOT EXISTS (
			SELECT 1 FROM json_each(recipe.targets) task
			WHERE COALESCE(json_extract(project.progress_json, '$."' || task.key || '"'), 0) < task.value
		);
		UPDATE combat_characters SET revision=revision+1
		WHERE client_id IN (SELECT client_id FROM completed_tutorial_projects);
		DELETE FROM combat_project_tracking WHERE project_id IN (SELECT id FROM completed_tutorial_projects);
		UPDATE combat_equipment_projects SET completed_at=unixepoch()*1000
		WHERE id IN (SELECT id FROM completed_tutorial_projects);
		DROP TABLE completed_tutorial_projects;
		DROP TABLE tutorial_project_targets;
	` },
	{ version: 218, sql: `
		CREATE TABLE melvor_account_contributors (
			account_id INTEGER PRIMARY KEY REFERENCES melvor_accounts(id) ON DELETE CASCADE,
			granted_at INTEGER NOT NULL CHECK(granted_at >= 0)
		) STRICT;
	` },
	{ version: 219, sql: `
		ALTER TABLE combat_encounters ADD COLUMN completed_at INTEGER CHECK(completed_at IS NULL OR completed_at >= 0);
		CREATE TABLE combat_activity_exclusions (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE
		) STRICT;
		INSERT OR IGNORE INTO combat_activity_exclusions(client_id)
			SELECT actor_client_id FROM audit_events WHERE event_type='combat-dungeon-test'
			AND actor_client_id IN (SELECT id FROM clients);
		INSERT OR IGNORE INTO combat_activity_exclusions(client_id) SELECT client_id FROM combat_test_profiles;
		CREATE INDEX combat_dungeon_activity ON combat_encounters(COALESCE(completed_at,created_at) DESC, id DESC)
			WHERE raid_endpoint IS NOT NULL AND status IN ('victory','defeat');
	` },
	{ version: 220, sql: `
		-- Fixed release targets: never derive historical migration behavior from runtime definitions.
		CREATE TEMP TABLE final_project_tasks(item_id TEXT PRIMARY KEY, task_id TEXT);
		INSERT INTO final_project_tasks VALUES
			('melvorD:Bronze_Dagger','melvorD:Smithing|melvorD:Bronze_Dagger'),
			('melvorD:Bronze_Sword','melvorD:Smithing|melvorD:Bronze_Sword'),
			('melvorD:Bronze_Battleaxe','melvorD:Smithing|melvorD:Bronze_Battleaxe'),
			('melvorD:Bronze_2H_Sword','melvorD:Smithing|melvorD:Bronze_2H_Sword'),
			('melvorD:Bronze_Helmet','melvorD:Smithing|melvorD:Bronze_Helmet'),
			('melvorD:Bronze_Boots','melvorD:Smithing|melvorD:Bronze_Boots'),
			('melvorD:Bronze_Platelegs','melvorD:Smithing|melvorD:Bronze_Platelegs'),
			('melvorD:Bronze_Platebody','melvorD:Smithing|melvorD:Bronze_Platebody'),
			('melvorD:Bronze_Shield','melvorD:Smithing|melvorD:Bronze_Shield'),
			('melvorD:Bronze_Scimitar','melvorD:Smithing|melvorD:Bronze_Scimitar'),
			('melvorD:Bronze_Gloves','melvorD:Smithing|melvorD:Bronze_Gloves'),
			('melvorD:Iron_Dagger','melvorD:Smithing|melvorD:Iron_Dagger'),
			('melvorD:Iron_Sword','melvorD:Smithing|melvorD:Iron_Sword'),
			('melvorD:Iron_Battleaxe','melvorD:Smithing|melvorD:Iron_Battleaxe'),
			('melvorD:Iron_2H_Sword','melvorD:Smithing|melvorD:Iron_2H_Sword'),
			('melvorD:Iron_Helmet','melvorD:Smithing|melvorD:Iron_Helmet'),
			('melvorD:Iron_Boots','melvorD:Smithing|melvorD:Iron_Boots'),
			('melvorD:Iron_Platelegs','melvorD:Smithing|melvorD:Iron_Platelegs'),
			('melvorD:Iron_Platebody','melvorD:Smithing|melvorD:Iron_Platebody'),
			('melvorD:Iron_Shield','melvorD:Smithing|melvorD:Iron_Shield'),
			('melvorD:Iron_Scimitar','melvorD:Smithing|melvorD:Iron_Scimitar'),
			('melvorD:Iron_Gloves','melvorD:Smithing|melvorD:Iron_Gloves'),
			('melvorD:Steel_Dagger','melvorD:Smithing|melvorD:Steel_Dagger'),
			('melvorD:Steel_Sword','melvorD:Smithing|melvorD:Steel_Sword'),
			('melvorD:Steel_Battleaxe','melvorD:Smithing|melvorD:Steel_Battleaxe'),
			('melvorD:Steel_2H_Sword','melvorD:Smithing|melvorD:Steel_2H_Sword'),
			('melvorD:Steel_Helmet','melvorD:Smithing|melvorD:Steel_Helmet'),
			('melvorD:Steel_Boots','melvorD:Smithing|melvorD:Steel_Boots'),
			('melvorD:Steel_Platelegs','melvorD:Smithing|melvorD:Steel_Platelegs'),
			('melvorD:Steel_Platebody','melvorD:Smithing|melvorD:Steel_Platebody'),
			('melvorD:Steel_Shield','melvorD:Smithing|melvorD:Steel_Shield'),
			('melvorD:Steel_Scimitar','melvorD:Smithing|melvorD:Steel_Scimitar'),
			('melvorD:Steel_Gloves','melvorD:Smithing|melvorD:Steel_Gloves'),
			('melvorD:Mithril_Dagger','melvorD:Smithing|melvorD:Mithril_Dagger'),
			('melvorD:Mithril_Sword','melvorD:Smithing|melvorD:Mithril_Sword'),
			('melvorD:Mithril_Battleaxe','melvorD:Smithing|melvorD:Mithril_Battleaxe'),
			('melvorD:Mithril_2H_Sword','melvorD:Smithing|melvorD:Mithril_2H_Sword'),
			('melvorD:Mithril_Helmet','melvorD:Smithing|melvorD:Mithril_Helmet'),
			('melvorD:Mithril_Boots','melvorD:Smithing|melvorD:Mithril_Boots'),
			('melvorD:Mithril_Platelegs','melvorD:Smithing|melvorD:Mithril_Platelegs'),
			('melvorD:Mithril_Platebody','melvorD:Smithing|melvorD:Mithril_Platebody'),
			('melvorD:Mithril_Shield','melvorD:Smithing|melvorD:Mithril_Shield'),
			('melvorD:Mithril_Scimitar','melvorD:Smithing|melvorD:Mithril_Scimitar'),
			('melvorD:Mithril_Gloves','melvorD:Smithing|melvorD:Mithril_Gloves'),
			('melvorD:Adamant_Dagger','melvorD:Smithing|melvorD:Adamant_Dagger'),
			('melvorD:Adamant_Sword','melvorD:Smithing|melvorD:Adamant_Sword'),
			('melvorD:Adamant_Battleaxe','melvorD:Smithing|melvorD:Adamant_Battleaxe'),
			('melvorD:Adamant_2H_Sword','melvorD:Smithing|melvorD:Adamant_2H_Sword'),
			('melvorD:Adamant_Helmet','melvorD:Smithing|melvorD:Adamant_Helmet'),
			('melvorD:Adamant_Boots','melvorD:Smithing|melvorD:Adamant_Boots'),
			('melvorD:Adamant_Platelegs','melvorD:Smithing|melvorD:Adamant_Platelegs'),
			('melvorD:Adamant_Platebody','melvorD:Smithing|melvorD:Adamant_Platebody'),
			('melvorD:Adamant_Shield','melvorD:Smithing|melvorD:Adamant_Shield'),
			('melvorD:Adamant_Scimitar','melvorD:Smithing|melvorD:Adamant_Scimitar'),
			('melvorD:Adamant_Gloves','melvorD:Smithing|melvorD:Adamant_Gloves'),
			('melvorD:Rune_Dagger','melvorD:Smithing|melvorD:Rune_Dagger'),
			('melvorD:Rune_Sword','melvorD:Smithing|melvorD:Rune_Sword'),
			('melvorD:Rune_Battleaxe','melvorD:Smithing|melvorD:Rune_Battleaxe'),
			('melvorD:Rune_2H_Sword','melvorD:Smithing|melvorD:Rune_2H_Sword'),
			('melvorD:Rune_Helmet','melvorD:Smithing|melvorD:Rune_Helmet'),
			('melvorD:Rune_Boots','melvorD:Smithing|melvorD:Rune_Boots'),
			('melvorD:Rune_Platelegs','melvorD:Smithing|melvorD:Rune_Platelegs'),
			('melvorD:Rune_Platebody','melvorD:Smithing|melvorD:Rune_Platebody'),
			('melvorD:Rune_Shield','melvorD:Smithing|melvorD:Rune_Shield'),
			('melvorD:Rune_Scimitar','melvorD:Smithing|melvorD:Rune_Scimitar'),
			('melvorD:Rune_Gloves','melvorD:Smithing|melvorD:Rune_Gloves'),
			('melvorD:Bronze_Arrows','melvorD:Fletching|melvorF:Bronze_Arrows'),
			('melvorD:Iron_Arrows','melvorD:Fletching|melvorF:Iron_Arrows'),
			('melvorD:Steel_Arrows','melvorD:Fletching|melvorF:Steel_Arrows'),
			('melvorD:Mithril_Arrows','melvorD:Fletching|melvorF:Mithril_Arrows'),
			('melvorD:Adamant_Arrows','melvorD:Fletching|melvorF:Adamant_Arrows'),
			('melvorD:Rune_Arrows','melvorD:Fletching|melvorF:Rune_Arrows'),
			('melvorD:Shrimp','melvorD:Cooking|melvorD:Shrimp'),
			('melvorD:Herring','melvorD:Cooking|melvorD:Herring'),
			('melvorD:Trout','melvorD:Cooking|melvorD:Trout'),
			('melvorD:Salmon','melvorD:Cooking|melvorD:Salmon'),
			('melvorD:Lobster','melvorD:Cooking|melvorD:Lobster'),
			('melvorD:Swordfish','melvorD:Cooking|melvorD:Swordfish'),
			('melvorD:Crab','melvorD:Cooking|melvorD:Crab'),
			('melvorD:Carp','melvorD:Cooking|melvorD:Carp');
		CREATE TEMP TABLE completed_final_projects AS
		SELECT project.id, project.client_id FROM combat_equipment_projects project
		JOIN final_project_tasks task ON task.item_id=project.item_id
		WHERE project.completed_at IS NULL
		AND COALESCE(json_extract(project.progress_json, '$."' || task.task_id || '"'), 0) >= 30000;
		-- Keep matching production sessions, but retire removed tasks and finished sessions.
		DELETE FROM combat_project_tracking WHERE project_id IN (SELECT id FROM completed_final_projects)
		OR EXISTS (SELECT 1 FROM combat_equipment_projects project JOIN final_project_tasks task ON task.item_id=project.item_id
			WHERE project.id=combat_project_tracking.project_id AND task.task_id<>combat_project_tracking.task_id);
		UPDATE combat_characters SET revision=revision+1
		WHERE client_id IN (SELECT client_id FROM completed_final_projects);
		UPDATE combat_equipment_projects SET completed_at=unixepoch()*1000
		WHERE id IN (SELECT id FROM completed_final_projects);
		DROP TABLE completed_final_projects;
		DROP TABLE final_project_tasks;
	` },
	fighter_adventures_migration,
	verified_identity_accounts_migration,
	identity_recovery_state_migration,
	{ version: 224, sql: `
	CREATE TABLE adventure_participation(client_id INTEGER NOT NULL, area_id TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER);
	CREATE INDEX adventure_participation_area ON adventure_participation(area_id,started_at,ended_at);
	INSERT INTO adventure_participation SELECT client_id,area_id,last_at,NULL FROM fighter_adventures WHERE area_id IS NOT NULL;
	CREATE TRIGGER adventure_join AFTER UPDATE OF area_id ON fighter_adventures WHEN NEW.area_id IS NOT OLD.area_id BEGIN
	 UPDATE adventure_participation SET ended_at=NEW.last_at WHERE client_id=NEW.client_id AND ended_at IS NULL;
	 INSERT INTO adventure_participation SELECT NEW.client_id,NEW.area_id,NEW.last_at,NULL WHERE NEW.area_id IS NOT NULL;
	END;
	CREATE TRIGGER adventure_leave BEFORE DELETE ON fighter_adventures BEGIN
	 UPDATE adventure_participation SET ended_at=MAX(started_at,CAST(unixepoch('subsec')*1000 AS INTEGER)) WHERE client_id=OLD.client_id AND ended_at IS NULL;
	END;
	` },
	{ version: 225, sql: `
	CREATE INDEX adventure_participation_client ON adventure_participation(client_id,started_at);
	DROP TRIGGER adventure_join;
	DROP TRIGGER adventure_leave;
	UPDATE adventure_participation SET ended_at=MAX(started_at, MIN(
	 COALESCE((SELECT last_at + MAX(0,capacity*3600000-used_ms) FROM fighter_adventures f WHERE f.client_id=adventure_participation.client_id),started_at),
	 COALESCE((SELECT deleted_at FROM clients c WHERE c.id=adventure_participation.client_id),9007199254740991))) WHERE ended_at IS NULL;
	CREATE TRIGGER adventure_participation_update AFTER UPDATE OF area_id,last_at,used_ms,capacity ON fighter_adventures
	WHEN NEW.area_id IS NOT OLD.area_id OR NEW.last_at != OLD.last_at OR NEW.used_ms != OLD.used_ms OR NEW.capacity != OLD.capacity BEGIN
	 UPDATE adventure_participation SET ended_at=MAX(started_at,MIN(ended_at,NEW.last_at))
	 WHERE client_id=NEW.client_id AND ended_at>NEW.last_at AND NEW.area_id IS NOT OLD.area_id;
	 UPDATE adventure_participation SET ended_at=NEW.last_at+NEW.capacity*3600000-NEW.used_ms
	 WHERE rowid=(SELECT rowid FROM adventure_participation WHERE client_id=NEW.client_id AND area_id=NEW.area_id
	  AND started_at<=NEW.last_at AND ended_at>=NEW.last_at ORDER BY started_at DESC,rowid DESC LIMIT 1)
	 AND NEW.area_id IS OLD.area_id AND NEW.used_ms<NEW.capacity*3600000;
	 INSERT INTO adventure_participation SELECT NEW.client_id,NEW.area_id,NEW.last_at,NEW.last_at+NEW.capacity*3600000-NEW.used_ms
	 WHERE NEW.area_id IS NOT NULL AND NEW.used_ms<NEW.capacity*3600000 AND EXISTS(SELECT 1 FROM clients WHERE id=NEW.client_id AND deleted_at IS NULL)
	 AND NOT EXISTS(SELECT 1 FROM adventure_participation WHERE client_id=NEW.client_id AND area_id=NEW.area_id AND started_at<=NEW.last_at AND ended_at>NEW.last_at);
	END;
	CREATE TRIGGER adventure_participation_delete BEFORE DELETE ON fighter_adventures BEGIN
	 UPDATE adventure_participation SET ended_at=MAX(started_at,MIN(ended_at,CAST(unixepoch('subsec')*1000 AS INTEGER))) WHERE client_id=OLD.client_id AND ended_at>CAST(unixepoch('subsec')*1000 AS INTEGER);
	END;
	CREATE TRIGGER adventure_identity_delete AFTER UPDATE OF deleted_at ON clients WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL BEGIN
	 UPDATE adventure_participation SET ended_at=MAX(started_at,MIN(ended_at,NEW.deleted_at)) WHERE client_id=NEW.id AND ended_at>NEW.deleted_at;
	END;
	` },
	{ version: 226, sql: `
	CREATE TABLE client_preferences (
		client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
		key TEXT NOT NULL,
		value TEXT NOT NULL,
		PRIMARY KEY (client_id, key)
	);
	` },
	{ version: 227, sql: `
		ALTER TABLE polls ADD COLUMN audience TEXT NOT NULL DEFAULT '' CHECK(length(audience)<=64);
	` },
	{ version: 228, sql: `
		CREATE TABLE announcement_audience_read_state (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			audience TEXT NOT NULL CHECK(length(audience) BETWEEN 1 AND 64),
			last_read_message_id INTEGER NOT NULL CHECK(last_read_message_id BETWEEN 0 AND 9007199254740991),
			PRIMARY KEY(client_id, audience)
		) STRICT;
		CREATE TRIGGER event_announcement_audience_read_insert AFTER INSERT ON announcement_audience_read_state BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.client_id;
		END;
		CREATE TRIGGER event_announcement_audience_read_update AFTER UPDATE OF last_read_message_id ON announcement_audience_read_state
		WHEN NEW.last_read_message_id!=OLD.last_read_message_id BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.client_id;
		END;
	` },
];
