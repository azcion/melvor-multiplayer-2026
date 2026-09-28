import type { Migration } from '../types';

export const migrations_141_150: Migration[] = [{
	version: 141,
	sql: `
		CREATE TABLE expedition_crucible_outcomes (
			expedition_id INTEGER PRIMARY KEY CHECK (expedition_id > 0),
			source_guild_id INTEGER NOT NULL CHECK (source_guild_id > 0),
			outcome TEXT NOT NULL CHECK (outcome IN ('crucible', 'destroyed')),
			disposed_at INTEGER NOT NULL CHECK (disposed_at >= 0)
		) STRICT;
		CREATE TABLE expedition_crucible_disposals (
			expedition_id INTEGER NOT NULL REFERENCES expedition_crucible_outcomes(expedition_id),
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
			PRIMARY KEY (expedition_id, item_id)
		) STRICT;
		CREATE INDEX idx_expedition_crucible_outcomes_guild
			ON expedition_crucible_outcomes(source_guild_id, expedition_id);
	`
}, {
	version: 142,
	sql: `CREATE INDEX idx_crucible_guilds_pending ON crucible_guilds(processed_minute, guild_id);`
}, {
	version: 143,
	foreign_keys_disabled: true,
	sql: `
		CREATE TABLE audit_value_lot_positions_next (
			lot_id INTEGER NOT NULL REFERENCES audit_value_lots (id) ON DELETE RESTRICT,
			position_kind TEXT NOT NULL CHECK (position_kind IN ('charitree', 'crucible', 'gift', 'inbox', 'client')),
			position_key TEXT NOT NULL CHECK (length(position_key) BETWEEN 1 AND 255),
			quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 9007199254740991),
			PRIMARY KEY (lot_id, position_kind, position_key)
		);
		INSERT INTO audit_value_lot_positions_next
			SELECT lot_id, position_kind, position_key, quantity FROM audit_value_lot_positions;
		DROP TABLE audit_value_lot_positions;
		ALTER TABLE audit_value_lot_positions_next RENAME TO audit_value_lot_positions;
		CREATE INDEX idx_audit_value_positions_owner
			ON audit_value_lot_positions (position_kind, position_key, lot_id);
		CREATE TABLE audit_value_movements_next (
			event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
			ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
			lot_id INTEGER NOT NULL REFERENCES audit_value_lots (id) ON DELETE RESTRICT,
			from_kind TEXT CHECK (from_kind IS NULL OR from_kind IN ('charitree', 'crucible', 'gift', 'inbox', 'client')),
			from_key TEXT,
			to_kind TEXT CHECK (to_kind IS NULL OR to_kind IN ('charitree', 'crucible', 'gift', 'inbox', 'client')),
			to_key TEXT,
			object_id TEXT NOT NULL,
			quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 9007199254740991),
			PRIMARY KEY (event_id, ordinal),
			CHECK ((from_kind IS NULL) = (from_key IS NULL)),
			CHECK ((to_kind IS NULL) = (to_key IS NULL)),
			CHECK (from_kind IS NOT NULL OR to_kind IS NOT NULL)
		);
		INSERT INTO audit_value_movements_next
			SELECT event_id, ordinal, lot_id, from_kind, from_key, to_kind, to_key, object_id, quantity
			FROM audit_value_movements;
		DROP TABLE audit_value_movements;
		ALTER TABLE audit_value_movements_next RENAME TO audit_value_movements;
		CREATE INDEX idx_audit_value_movements_lot ON audit_value_movements (lot_id, event_id);
	`
}, {
	version: 144,
	sql: `
		CREATE TABLE melvor_account_tags (
			account_id INTEGER NOT NULL REFERENCES melvor_accounts(id) ON DELETE CASCADE,
			tag TEXT NOT NULL CHECK (tag IN ('expedition-tester')),
			granted_at INTEGER NOT NULL CHECK (granted_at >= 0),
			PRIMARY KEY (account_id, tag)
		) STRICT;
		INSERT INTO melvor_account_tags (account_id, tag, granted_at)
		SELECT DISTINCT account.id, 'expedition-tester', CAST(strftime('%s', 'now') AS INTEGER) * 1000
		FROM polls AS poll
		JOIN poll_options AS option ON option.poll_id = poll.id
		JOIN poll_votes AS vote ON vote.poll_id = poll.id AND vote.option_id = option.id
		JOIN clients AS voter ON voter.id = vote.client_id
		JOIN melvor_accounts AS account ON account.id = voter.melvor_account_id
		WHERE poll.content = 'Would you like to help test the upcoming Expedition update?'
		AND option.content = 'Yes, sign me up as a tester!';
		ALTER TABLE global_chat_messages ADD COLUMN channel TEXT NOT NULL DEFAULT 'global'
			CHECK (channel IN ('global', 'testers'));
		CREATE INDEX idx_global_chat_messages_channel_id ON global_chat_messages(channel, id DESC);
		CREATE INDEX idx_global_chat_messages_channel_sender_time
			ON global_chat_messages(channel, sender_id, created_at DESC, id DESC);
		DROP TRIGGER event_global_chat_message_insert;
		CREATE TRIGGER event_global_chat_message_insert AFTER INSERT ON global_chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE deleted_at IS NULL AND (NEW.channel = 'testers' OR global_chat_enabled = 1)
			AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id)
				OR melvor_account_id IN (SELECT observer_account_id FROM chat_shadow_observers));
		END;
		DROP TRIGGER event_global_chat_moderation_insert;
		CREATE TRIGGER event_global_chat_moderation_insert AFTER INSERT ON global_chat_message_moderation BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE deleted_at IS NULL AND ((SELECT channel FROM global_chat_messages WHERE id = NEW.message_id) = 'testers'
				OR global_chat_enabled = 1);
		END;
		CREATE TABLE tester_chat_read_state (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0)
		) STRICT;
		CREATE TRIGGER event_tester_chat_read_insert AFTER INSERT ON tester_chat_read_state BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
		END;
		CREATE TRIGGER event_tester_chat_read_update AFTER UPDATE OF last_read_message_id ON tester_chat_read_state
		WHEN NEW.last_read_message_id != OLD.last_read_message_id BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
		END;
		CREATE TRIGGER event_account_tester_tag_insert AFTER INSERT ON melvor_account_tags BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE melvor_account_id = NEW.account_id;
		END;
		CREATE TRIGGER event_account_tester_tag_delete AFTER DELETE ON melvor_account_tags BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE melvor_account_id = OLD.account_id;
		END;
	`
}, {
	version: 145,
	sql: `ALTER TABLE clients ADD COLUMN dev_tag_visible INTEGER NOT NULL DEFAULT 1 CHECK (dev_tag_visible IN (0, 1));`
}, {
	version: 146,
	sql: `
		INSERT INTO service_settings (key, value) VALUES ('campaign_retirement_phase', 'active');
		CREATE TABLE campaign_retirement (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			operation_id TEXT NOT NULL UNIQUE,
			cutover_at INTEGER NOT NULL CHECK (cutover_at >= 0),
			completed_at INTEGER NOT NULL CHECK (completed_at >= cutover_at),
			summary_json TEXT NOT NULL
		) STRICT;
		CREATE TABLE campaign_refunds (
			receipt_id TEXT PRIMARY KEY REFERENCES economy_receipts(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
			released_at INTEGER CHECK (released_at IS NULL OR released_at >= 0)
		) STRICT;
		CREATE INDEX idx_campaign_refunds_pending ON campaign_refunds(client_id, released_at, receipt_id);
		ALTER TABLE inbox_claims ADD COLUMN campaign_refund_included INTEGER NOT NULL DEFAULT 0
			CHECK (campaign_refund_included IN (0, 1));
	`
}, {
	version: 147,
	sql: `
		CREATE TABLE poll_discussion_read_state (
			poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
			PRIMARY KEY (poll_id, client_id)
		) STRICT;
	`
}, {
	version: 148,
	sql: `
		CREATE TABLE raid_defeat_totals (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
			defeats INTEGER NOT NULL CHECK (defeats >= 0),
			PRIMARY KEY (client_id, tier)
		) STRICT;
		INSERT INTO raid_defeat_totals (client_id, tier, defeats)
		SELECT client_id, tier, COUNT(*) FROM guild_raid_assaults
		WHERE outcome = 'success' GROUP BY client_id, tier;
		CREATE TABLE raid_cutover (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			cutover_at INTEGER NOT NULL CHECK (cutover_at >= 0),
			resume_at INTEGER NOT NULL CHECK (resume_at > cutover_at),
			operation_id TEXT NOT NULL UNIQUE,
			max_raid_id INTEGER NOT NULL CHECK (max_raid_id >= 0),
			completed_raids INTEGER NOT NULL CHECK (completed_raids >= 0),
			new_payouts INTEGER NOT NULL CHECK (new_payouts >= 0)
		) STRICT;
		ALTER TABLE guild_raid_assaults ADD COLUMN fortified_resistance INTEGER NOT NULL DEFAULT 99
			CHECK (fortified_resistance BETWEEN 75 AND 99);
	`
}, {
	version: 149,
	sql: `
		ALTER TABLE guild_raid_assaults ADD COLUMN inbox_loot INTEGER NOT NULL DEFAULT 0
			CHECK (inbox_loot IN (0, 1));
		ALTER TABLE guild_raid_victory_caches ADD COLUMN items_json TEXT NOT NULL DEFAULT
			'[{"item_id":"melvorF:Summoning_Familiar_Wolf","qty":100},{"item_id":"melvorF:Summoning_Familiar_Minotaur","qty":100},{"item_id":"melvorF:Summoning_Familiar_Yak","qty":75},{"item_id":"melvorD:Dragon_Bones","qty":25},{"item_id":"melvorD:Diamond","qty":20}]';
	`
}, {
	version: 150,
	sql: `
		CREATE TABLE raid_tier_unlocks (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
			first_defeated_at INTEGER NOT NULL CHECK (first_defeated_at >= 0),
			PRIMARY KEY (client_id, tier)
		) STRICT;
	`
}];
