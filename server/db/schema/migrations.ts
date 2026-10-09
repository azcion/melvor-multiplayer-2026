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
];
