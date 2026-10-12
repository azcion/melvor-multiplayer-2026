import type { Migration } from '../types';

const fields = ['id','guild_id','owner_client_id','melvor_account_id','item_id','qty','required_gp',
	'progress_gp','formation_points','created_at','formed_at','melded_at','auto_deliver_at'];

export const wish_capacity_migration: Migration = {
	version: 185,
	foreign_keys_disabled: true,
	sql: `
		CREATE TABLE crucible_wishes_capacity (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			owner_client_id INTEGER NOT NULL REFERENCES clients(id),
			melvor_account_id INTEGER NOT NULL REFERENCES melvor_accounts(id),
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 1000),
			required_gp INTEGER NOT NULL CHECK (required_gp > 0 AND required_gp <= 9007199254740991),
			progress_gp INTEGER NOT NULL DEFAULT 0 CHECK (progress_gp BETWEEN 0 AND required_gp),
			formation_points INTEGER NOT NULL DEFAULT 0 CHECK (formation_points BETWEEN 0 AND 10080),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			formed_at INTEGER,
			melded_at INTEGER,
			delivered_at INTEGER,
			auto_deliver_at INTEGER CHECK (auto_deliver_at IS NULL OR auto_deliver_at >= 0),
			UNIQUE (guild_id, melvor_account_id)
		) STRICT;
		INSERT INTO crucible_wishes_capacity (id, guild_id, owner_client_id, melvor_account_id, item_id, qty,
			required_gp, progress_gp, formation_points, created_at, formed_at, melded_at, delivered_at, auto_deliver_at)
		SELECT id, guild_id, owner_client_id, melvor_account_id, item_id, qty,
			required_gp, progress_gp, formation_points, created_at, formed_at, melded_at, delivered_at, auto_deliver_at
		FROM crucible_wishes;
		-- Preserve the high-water ID even when the latest Wish has already been settled.
		UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE(
			(SELECT seq FROM sqlite_sequence WHERE name = 'crucible_wishes'), 0))
		WHERE name = 'crucible_wishes_capacity';
		DROP TABLE crucible_wishes;
		ALTER TABLE crucible_wishes_capacity RENAME TO crucible_wishes;
		CREATE INDEX idx_crucible_wishes_guild ON crucible_wishes(guild_id, formation_points, progress_gp, id);
		CREATE TRIGGER crucible_wishes_terminal_snapshot BEFORE DELETE ON crucible_wishes BEGIN
			INSERT INTO economy_terminal_snapshots(table_name,row_id,snapshot_json)
			VALUES('crucible_wishes',OLD.id,json_object(${fields.map(field => `'${field}',OLD.${field}`).join(',')})); END;
		CREATE TRIGGER crucible_wishes_source_snapshot AFTER INSERT ON crucible_wishes BEGIN
			INSERT INTO economy_terminal_snapshots(table_name,row_id,phase,snapshot_json)
			VALUES('crucible_wishes',NEW.id,'source',json_object(${fields.map(field => `'${field}',NEW.${field}`).join(',')})); END;
		CREATE TABLE wish_capacities (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			base INTEGER NOT NULL CHECK(base IN (200,300,400,500)),
			expires_at INTEGER NOT NULL CHECK(expires_at >= 0 AND expires_at <= 9007199254740991),
			auto_renew INTEGER NOT NULL DEFAULT 0 CHECK(auto_renew IN (0,1)),
			renewal_paused INTEGER NOT NULL DEFAULT 0 CHECK(renewal_paused IN (0,1))
		) STRICT;
		CREATE INDEX idx_wish_capacity_expiry ON wish_capacities(expires_at) WHERE auto_renew=1;
		CREATE TABLE wish_ep_spends (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL REFERENCES clients(id),
			kind TEXT NOT NULL CHECK(kind IN ('wish','capacity','renewal')),
			source_id TEXT NOT NULL,
			points_micros INTEGER NOT NULL CHECK(points_micros>0 AND points_micros<=9007199254740991),
			created_at INTEGER NOT NULL CHECK(created_at>=0),
			UNIQUE(client_id,kind,source_id)
		) STRICT;
	`,
};
