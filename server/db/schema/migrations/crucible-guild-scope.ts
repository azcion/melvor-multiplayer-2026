import type { Migration } from '../types';

const now = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";
const window_ms = 48 * 60 * 60_000;

export const crucible_guild_scope_migration: Migration = {
	version: 162,
	foreign_keys_disabled: true,
	sql: `
		CREATE TEMP TABLE crucible_scope_clock AS SELECT ${now} AS now;
		-- The old effective level is used only to select eligible accounts, never to infer a Guild.
		CREATE TEMP TABLE crucible_bonus_accounts AS
		SELECT account.id FROM melvor_accounts AS account CROSS JOIN crucible_scope_clock AS clock
		WHERE (SELECT COUNT(*) FROM crucible_clear_events AS event
			WHERE event.owner_key = 'account:' || account.id AND event.expires_at > clock.now)
			> CASE WHEN EXISTS (SELECT 1 FROM crucible_wishes WHERE melvor_account_id = account.id)
				OR EXISTS (SELECT 1 FROM crucible_visibility_resets WHERE owner_key = 'account:' || account.id
					AND reset_at + ${window_ms} > clock.now) THEN 10 ELSE 0 END;
		CREATE TEMP TABLE crucible_scope_members AS
		SELECT DISTINCT membership.guild_id,
			CASE WHEN client.melvor_account_id IS NULL THEN 'client:' || client.id
				ELSE 'account:' || client.melvor_account_id END AS owner_key,
			client.melvor_account_id AS account_id
		FROM clients AS client JOIN guild_memberships AS membership ON membership.client_id = client.id
		WHERE client.deleted_at IS NULL AND client.disabled = 0;
		CREATE TABLE crucible_wishes_scoped (
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
			auto_deliver_at INTEGER CHECK (auto_deliver_at IS NULL OR auto_deliver_at >= 0),
			UNIQUE (guild_id, melvor_account_id)
		) STRICT;
		INSERT INTO crucible_wishes_scoped (id, guild_id, owner_client_id, melvor_account_id, item_id, qty,
			required_gp, progress_gp, formation_points, created_at, formed_at, melded_at, delivered_at, auto_deliver_at)
		SELECT id, guild_id, owner_client_id, melvor_account_id, item_id, qty,
			required_gp, progress_gp, formation_points, created_at, formed_at, melded_at, delivered_at, auto_deliver_at
		FROM crucible_wishes;
		-- Preserve the high-water ID even when the latest Wish has already been settled.
		UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE(
			(SELECT seq FROM sqlite_sequence WHERE name = 'crucible_wishes'), 0))
		WHERE name = 'crucible_wishes_scoped';
		DROP TABLE crucible_wishes;
		ALTER TABLE crucible_wishes_scoped RENAME TO crucible_wishes;
		CREATE INDEX idx_crucible_wishes_guild ON crucible_wishes(guild_id, formation_points, progress_gp, id);
		CREATE TABLE crucible_visibility_resets_scoped (
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			owner_key TEXT NOT NULL,
			reset_at INTEGER NOT NULL CHECK (reset_at >= 0),
			PRIMARY KEY (guild_id, owner_key)
		) STRICT;
		INSERT INTO crucible_visibility_resets_scoped (guild_id, owner_key, reset_at)
		SELECT member.guild_id, member.owner_key, reset.reset_at
		FROM crucible_scope_members AS member JOIN crucible_visibility_resets AS reset USING (owner_key);
		-- A retained Wish also keeps its reset if its owner is no longer an active member.
		INSERT OR IGNORE INTO crucible_visibility_resets_scoped (guild_id, owner_key, reset_at)
		SELECT wish.guild_id, 'account:' || wish.melvor_account_id, reset.reset_at
		FROM crucible_wishes AS wish JOIN crucible_visibility_resets AS reset
			ON reset.owner_key = 'account:' || wish.melvor_account_id;
		DROP TABLE crucible_visibility_resets;
		ALTER TABLE crucible_visibility_resets_scoped RENAME TO crucible_visibility_resets;
		CREATE TABLE crucible_clear_events_scoped (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			owner_key TEXT NOT NULL,
			cleared_at INTEGER NOT NULL CHECK (cleared_at >= 0),
			expires_at INTEGER NOT NULL CHECK (expires_at > cleared_at)
		) STRICT;
		-- Linked accounts receive a fresh maximum for every currently represented Guild.
		INSERT INTO crucible_clear_events_scoped (guild_id, owner_key, cleared_at, expires_at)
		WITH RECURSIVE points(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM points WHERE value < 30)
		SELECT member.guild_id, member.owner_key, clock.now, clock.now + ${window_ms}
		FROM crucible_scope_members AS member JOIN crucible_bonus_accounts AS account ON account.id = member.account_id
		CROSS JOIN crucible_scope_clock AS clock CROSS JOIN points
		WHERE points.value <= CASE
			WHEN EXISTS (SELECT 1 FROM crucible_wishes WHERE guild_id = member.guild_id AND melvor_account_id = account.id)
				THEN 20
			WHEN EXISTS (SELECT 1 FROM crucible_visibility_resets WHERE guild_id = member.guild_id
				AND owner_key = member.owner_key AND reset_at + ${window_ms} > clock.now) THEN 30
			ELSE 20 END;
		-- Unlinked Clients have no account-wide entitlement; retain their own unexpired points.
		INSERT INTO crucible_clear_events_scoped (guild_id, owner_key, cleared_at, expires_at)
		SELECT member.guild_id, member.owner_key, event.cleared_at, event.expires_at
		FROM crucible_scope_members AS member JOIN crucible_clear_events AS event USING (owner_key)
		CROSS JOIN crucible_scope_clock AS clock WHERE member.account_id IS NULL AND event.expires_at > clock.now;
		DROP TABLE crucible_clear_events;
		ALTER TABLE crucible_clear_events_scoped RENAME TO crucible_clear_events;
		CREATE INDEX idx_crucible_clear_events_owner ON crucible_clear_events(guild_id, owner_key, expires_at);
		UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL AND disabled = 0;
		DROP TABLE crucible_scope_members;
		DROP TABLE crucible_bonus_accounts;
		DROP TABLE crucible_scope_clock;
	`,
};
