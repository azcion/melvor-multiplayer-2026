import type { Migration } from '../types';

export const migrations_011_020: Migration[] = [
	{
		version: 11,
		sql: `
			ALTER TABLE clients ADD COLUMN status_visible INTEGER NOT NULL DEFAULT 1
				CHECK (status_visible IN (0, 1));

			CREATE TABLE status_snapshots (
				client_id INTEGER PRIMARY KEY,
				activity_type TEXT NOT NULL CHECK (activity_type IN ('idle', 'skill', 'combat')),
				activity_skill_id TEXT,
				activity_action_id TEXT,
				activity_area_id TEXT,
				CHECK (
					(activity_type = 'idle' AND activity_skill_id IS NULL AND activity_action_id IS NULL
						AND activity_area_id IS NULL) OR
					(activity_type = 'skill' AND activity_skill_id IS NOT NULL AND activity_action_id IS NOT NULL
						AND activity_area_id IS NULL) OR
					(activity_type = 'combat' AND activity_skill_id IS NULL AND activity_action_id IS NULL)
				),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);

			CREATE TABLE status_snapshot_skills (
				client_id INTEGER NOT NULL,
				skill_id TEXT NOT NULL,
				level INTEGER NOT NULL CHECK (level >= 0),
				PRIMARY KEY (client_id, skill_id),
				FOREIGN KEY (client_id) REFERENCES status_snapshots (client_id) ON DELETE CASCADE
			);
		`
	}, {
		version: 12,
		sql: `
			ALTER TABLE clients ADD COLUMN messaging_enabled INTEGER NOT NULL DEFAULT 1
				CHECK (messaging_enabled IN (0, 1));
			ALTER TABLE clients ADD COLUMN messaging_credits INTEGER NOT NULL DEFAULT 5
				CHECK (messaging_credits >= 0);
			ALTER TABLE clients ADD COLUMN messaging_refill_at INTEGER NOT NULL DEFAULT 0
				CHECK (messaging_refill_at >= 0);

			CREATE TABLE chat_conversations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				participant_low_id INTEGER NOT NULL,
				participant_high_id INTEGER NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				CHECK (participant_low_id < participant_high_id),
				UNIQUE (participant_low_id, participant_high_id),
				FOREIGN KEY (participant_low_id) REFERENCES clients (id) ON DELETE CASCADE,
				FOREIGN KEY (participant_high_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_chat_conversations_high ON chat_conversations (participant_high_id, id);

			CREATE TABLE chat_participants (
				conversation_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				conversation_hidden INTEGER NOT NULL DEFAULT 0 CHECK (conversation_hidden IN (0, 1)),
				hidden_through_message_id INTEGER NOT NULL DEFAULT 0 CHECK (hidden_through_message_id >= 0),
				PRIMARY KEY (conversation_id, client_id),
				FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_chat_participants_client ON chat_participants (client_id, conversation_id);

			CREATE TABLE chat_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_id INTEGER NOT NULL,
				sender_id INTEGER NOT NULL,
				idempotency_key TEXT NOT NULL,
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (sender_id, idempotency_key),
				FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id) ON DELETE CASCADE,
				FOREIGN KEY (sender_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_chat_messages_conversation ON chat_messages (conversation_id, id);
			CREATE INDEX idx_chat_messages_sender ON chat_messages (sender_id, id);

			CREATE TABLE chat_message_reads (
				message_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				read_at INTEGER NOT NULL CHECK (read_at >= 0),
				PRIMARY KEY (message_id, client_id),
				FOREIGN KEY (message_id) REFERENCES chat_messages (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_chat_message_reads_client ON chat_message_reads (client_id, message_id);

			CREATE TABLE chat_message_deletions (
				message_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				deleted_at INTEGER NOT NULL CHECK (deleted_at >= 0),
				PRIMARY KEY (message_id, client_id),
				FOREIGN KEY (message_id) REFERENCES chat_messages (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_chat_message_deletions_client ON chat_message_deletions (client_id, message_id);

			CREATE TABLE chat_blocks (
				blocker_id INTEGER NOT NULL,
				blocked_id INTEGER NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				CHECK (blocker_id != blocked_id),
				PRIMARY KEY (blocker_id, blocked_id),
				FOREIGN KEY (blocker_id) REFERENCES clients (id) ON DELETE CASCADE,
				FOREIGN KEY (blocked_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_chat_blocks_blocked ON chat_blocks (blocked_id, blocker_id);
		`
	}, {
		version: 13,
		sql: `
			CREATE TABLE melvor_accounts (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				cloud_username TEXT NOT NULL,
				playfab_id TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (cloud_username, playfab_id)
			);

			ALTER TABLE clients ADD COLUMN melvor_account_id INTEGER
				REFERENCES melvor_accounts (id);
			ALTER TABLE clients ADD COLUMN deleted_at INTEGER
				CHECK (deleted_at IS NULL OR deleted_at >= 0);
			CREATE INDEX idx_clients_melvor_account
				ON clients (melvor_account_id, deleted_at, id);

			CREATE TABLE client_deletion_requests (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				target_client_id INTEGER NOT NULL,
				requester_client_id INTEGER NOT NULL,
				requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
				execute_at INTEGER NOT NULL CHECK (execute_at >= requested_at),
				cancelled_at INTEGER CHECK (cancelled_at IS NULL OR cancelled_at >= requested_at),
				executed_at INTEGER CHECK (executed_at IS NULL OR executed_at >= requested_at),
				CHECK (target_client_id != requester_client_id),
				CHECK (cancelled_at IS NULL OR executed_at IS NULL),
				FOREIGN KEY (target_client_id) REFERENCES clients (id) ON DELETE CASCADE,
				FOREIGN KEY (requester_client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE UNIQUE INDEX idx_client_deletion_requests_pending
				ON client_deletion_requests (target_client_id)
				WHERE cancelled_at IS NULL AND executed_at IS NULL;
			CREATE INDEX idx_client_deletion_requests_due
				ON client_deletion_requests (execute_at, id)
				WHERE cancelled_at IS NULL AND executed_at IS NULL;

			CREATE TABLE client_deletion_returns (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				request_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				source_display_name TEXT NOT NULL,
				gp INTEGER NOT NULL DEFAULT 0 CHECK (gp >= 0),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= created_at),
				UNIQUE (request_id, client_id),
				FOREIGN KEY (request_id) REFERENCES client_deletion_requests (id),
				FOREIGN KEY (client_id) REFERENCES clients (id)
			);
			CREATE INDEX idx_client_deletion_returns_client
				ON client_deletion_returns (client_id, completed_at, id);

			CREATE TABLE client_deletion_return_items (
				return_id INTEGER NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				PRIMARY KEY (return_id, item_id),
				FOREIGN KEY (return_id) REFERENCES client_deletion_returns (id) ON DELETE CASCADE
			);

			CREATE TABLE client_deletion_return_claims (
				id TEXT PRIMARY KEY,
				return_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				gp INTEGER NOT NULL DEFAULT 0 CHECK (gp >= 0),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				acknowledged_at INTEGER CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
				FOREIGN KEY (return_id) REFERENCES client_deletion_returns (id),
				FOREIGN KEY (client_id) REFERENCES clients (id)
			);
			CREATE UNIQUE INDEX idx_client_deletion_return_claims_outstanding
				ON client_deletion_return_claims (client_id) WHERE acknowledged_at IS NULL;

			CREATE TABLE client_deletion_return_claim_items (
				claim_id TEXT NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				PRIMARY KEY (claim_id, item_id),
				FOREIGN KEY (claim_id) REFERENCES client_deletion_return_claims (id) ON DELETE CASCADE
			);
		`
	}, {
		version: 14,
		sql: `
			DELETE FROM service_settings WHERE key = 'max_identities';
		`
	}, {
		version: 15,
		sql: `
			ALTER TABLE clients ADD COLUMN last_multiplayer_active_at INTEGER NOT NULL DEFAULT 0
				CHECK (last_multiplayer_active_at >= 0);

			CREATE TABLE guild_raids (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				started_at INTEGER NOT NULL CHECK (started_at >= 0),
				expires_at INTEGER NOT NULL CHECK (expires_at > started_at),
				active_member_count INTEGER NOT NULL CHECK (active_member_count >= 1),
				required_contributors INTEGER NOT NULL CHECK (required_contributors BETWEEN 1 AND 5),
				max_health INTEGER NOT NULL CHECK (max_health > 0),
				remaining_health INTEGER NOT NULL CHECK (remaining_health BETWEEN 0 AND max_health),
				secured_at INTEGER CHECK (secured_at IS NULL OR secured_at >= started_at),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_guild_raids_guild_started ON guild_raids (guild_id, started_at DESC);

			CREATE TABLE guild_raid_roster (
				raid_id INTEGER NOT NULL,
				membership_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				contribution INTEGER NOT NULL DEFAULT 0 CHECK (contribution >= 0),
				highest_tier INTEGER NOT NULL DEFAULT 0 CHECK (highest_tier BETWEEN 0 AND 4),
				successful_assaults INTEGER NOT NULL DEFAULT 0 CHECK (successful_assaults >= 0),
				PRIMARY KEY (raid_id, membership_id),
				UNIQUE (raid_id, client_id),
				FOREIGN KEY (raid_id) REFERENCES guild_raids (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_guild_raid_roster_client ON guild_raid_roster (client_id, raid_id);

			CREATE TABLE guild_raid_assaults (
				id TEXT PRIMARY KEY,
				raid_id INTEGER NOT NULL,
				membership_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 4),
				loaded_session_id TEXT NOT NULL,
				settlement_key TEXT NOT NULL UNIQUE,
				reserved_at INTEGER NOT NULL CHECK (reserved_at >= 0),
				combat_deadline INTEGER NOT NULL CHECK (combat_deadline > reserved_at),
				settlement_deadline INTEGER NOT NULL CHECK (settlement_deadline > combat_deadline),
				outcome TEXT CHECK (outcome IS NULL OR outcome IN ('success', 'death', 'flee', 'abandoned')),
				occurred_at INTEGER,
				settled_at INTEGER,
				credited_progress INTEGER NOT NULL DEFAULT 0 CHECK (credited_progress >= 0),
				CHECK ((outcome IS NULL AND occurred_at IS NULL AND settled_at IS NULL) OR
					(outcome IS NOT NULL AND occurred_at IS NOT NULL AND settled_at IS NOT NULL)),
				FOREIGN KEY (raid_id, membership_id) REFERENCES guild_raid_roster (raid_id, membership_id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_guild_raid_assaults_member ON guild_raid_assaults (raid_id, membership_id, reserved_at);
			CREATE UNIQUE INDEX idx_guild_raid_assaults_unsettled ON guild_raid_assaults (membership_id)
				WHERE outcome IS NULL;

			CREATE TABLE guild_raid_victory_caches (
				id TEXT PRIMARY KEY,
				raid_id INTEGER NOT NULL,
				membership_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				acknowledged_at INTEGER CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
				UNIQUE (raid_id, membership_id),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_guild_raid_victory_caches_client
				ON guild_raid_victory_caches (client_id, acknowledged_at, created_at);
		`
	}, {
		version: 16,
		sql: `
			ALTER TABLE clients ADD COLUMN manual_melvor_account_link INTEGER NOT NULL DEFAULT 0
				CHECK (manual_melvor_account_link IN (0, 1));

			ALTER TABLE guild_raid_roster ADD COLUMN manual_assaults_remaining INTEGER
				CHECK (manual_assaults_remaining IS NULL OR manual_assaults_remaining >= 0);
		`
	}, {
		version: 17,
		sql: `
			UPDATE campaign_state
			SET item_id = CASE item_id
				WHEN 'melvorD:Small_Urn' THEN 'melvorF:Small_Urn'
				WHEN 'melvorD:Medium_Urn' THEN 'melvorF:Medium_Urn'
				ELSE item_id
			END
			WHERE item_id IN ('melvorD:Small_Urn', 'melvorD:Medium_Urn');
		`
	}, {
		version: 18,
		sql: `
			ALTER TABLE clients ADD COLUMN event_revision INTEGER NOT NULL DEFAULT 1
				CHECK (event_revision >= 1);

			CREATE TRIGGER event_friend_insert AFTER INSERT ON friend_requests BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_friend_delete AFTER DELETE ON friend_requests BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id;
			END;

			CREATE TRIGGER event_gift_insert AFTER INSERT ON gifts BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_gift_update AFTER UPDATE ON gifts BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (OLD.client_id, NEW.client_id);
			END;
			CREATE TRIGGER event_gift_delete AFTER DELETE ON gifts BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id;
			END;

			CREATE TRIGGER event_trade_insert AFTER INSERT ON trade_offers BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (NEW.sender_id, NEW.recipient_id);
			END;
			CREATE TRIGGER event_trade_update AFTER UPDATE ON trade_offers BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id IN (OLD.sender_id, OLD.recipient_id, NEW.sender_id, NEW.recipient_id);
			END;
			CREATE TRIGGER event_trade_delete AFTER DELETE ON trade_offers BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (OLD.sender_id, OLD.recipient_id);
			END;

			CREATE TRIGGER event_resolved_trade_insert AFTER INSERT ON resolved_trade_offers BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_resolved_trade_update AFTER UPDATE ON resolved_trade_offers BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (OLD.client_id, NEW.client_id);
			END;
			CREATE TRIGGER event_resolved_trade_delete AFTER DELETE ON resolved_trade_offers BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id;
			END;

			CREATE TRIGGER event_market_insert AFTER INSERT ON market_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_market_update AFTER UPDATE ON market_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (OLD.client_id, NEW.client_id);
			END;
			CREATE TRIGGER event_market_delete AFTER DELETE ON market_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id;
			END;

			CREATE TRIGGER event_campaign_insert AFTER INSERT ON campaign_state BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id IN (SELECT client_id FROM guild_memberships WHERE guild_id = NEW.guild_id);
			END;
			CREATE TRIGGER event_campaign_update AFTER UPDATE ON campaign_state BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id IN (SELECT client_id FROM guild_memberships WHERE guild_id IN (OLD.guild_id, NEW.guild_id));
			END;
			CREATE TRIGGER event_campaign_delete AFTER DELETE ON campaign_state BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id IN (SELECT client_id FROM guild_memberships WHERE guild_id = OLD.guild_id);
			END;

			CREATE TRIGGER event_application_insert AFTER INSERT ON guild_applications BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id
					OR id IN (SELECT client_id FROM guild_memberships WHERE guild_id = NEW.guild_id);
			END;
			CREATE TRIGGER event_application_delete AFTER DELETE ON guild_applications BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id
					OR id IN (SELECT client_id FROM guild_memberships WHERE guild_id = OLD.guild_id);
			END;

			CREATE TRIGGER event_membership_insert AFTER INSERT ON guild_memberships BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id
					OR id IN (SELECT client_id FROM guild_memberships WHERE guild_id = NEW.guild_id);
			END;
			CREATE TRIGGER event_membership_delete AFTER DELETE ON guild_memberships BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id
					OR id IN (SELECT client_id FROM guild_memberships WHERE guild_id = OLD.guild_id);
			END;

			CREATE TRIGGER event_banishment_insert AFTER INSERT ON banishment_returns BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_banishment_update AFTER UPDATE ON banishment_returns BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (OLD.client_id, NEW.client_id);
			END;
			CREATE TRIGGER event_deletion_return_insert AFTER INSERT ON client_deletion_returns BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_deletion_return_update AFTER UPDATE ON client_deletion_returns BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (OLD.client_id, NEW.client_id);
			END;

			CREATE TRIGGER event_chat_message_insert AFTER INSERT ON chat_messages BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN
					(SELECT client_id FROM chat_participants WHERE conversation_id = NEW.conversation_id);
			END;
			CREATE TRIGGER event_chat_read_insert AFTER INSERT ON chat_message_reads BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_chat_delete_insert AFTER INSERT ON chat_message_deletions BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;

			CREATE TRIGGER event_client_profile_update AFTER UPDATE OF display_name, icon_id ON clients BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN
					(SELECT client_id FROM friend_requests WHERE friend_id = NEW.id)
					OR id IN (
						SELECT membership.client_id FROM guild_memberships AS membership
						JOIN guild_applications AS application ON application.guild_id = membership.guild_id
						WHERE application.client_id = NEW.id
					);
			END;
		`
	}, {
		version: 19,
		foreign_keys_disabled: true,
		sql: `
			ALTER TABLE charity_items ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0
				CHECK (expires_at >= 0);
			UPDATE charity_items
			SET expires_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 345600000;
			CREATE INDEX idx_charity_items_expiry ON charity_items (expires_at);

			CREATE TABLE guild_petitions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				guild_name TEXT NOT NULL,
				type TEXT NOT NULL
					CHECK (type IN ('appellation', 'heraldry', 'banishment', 'charitree_clearing')),
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
					(type = 'charitree_clearing' AND proposed_name IS NULL AND proposed_icon_id IS NULL
						AND target_client_id IS NULL AND target_membership_id IS NULL
						AND charitree_expires_before IS NOT NULL)
				),
				FOREIGN KEY (petitioner_id) REFERENCES clients (id),
				FOREIGN KEY (target_client_id) REFERENCES clients (id)
			);
			INSERT INTO guild_petitions_new (
				id, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
				proposed_name, proposed_icon_id, target_client_id, target_membership_id,
				charitree_expires_before, created_at, expires_at, resolved_at, lifecycle,
				execution_state, execution_attempts, execution_last_attempt_at,
				execution_failure_category, execution_failure_message, execution_effect
			)
			SELECT
				id, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
				proposed_name, proposed_icon_id, target_client_id, target_membership_id,
				NULL, created_at, expires_at, resolved_at, lifecycle,
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
		`
	}, {
		version: 20,
		foreign_keys_disabled: true,
		sql: `
			ALTER TABLE guilds ADD COLUMN charitree_enabled INTEGER NOT NULL DEFAULT 1
				CHECK (charitree_enabled IN (0, 1));

			CREATE TABLE guild_petitions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				guild_name TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN (
					'appellation', 'heraldry', 'banishment', 'charitree_ingratitude',
					'charitree_sacrilege', 'charitree_beneficence'
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
					(type IN ('charitree_sacrilege', 'charitree_beneficence')
						AND proposed_name IS NULL AND proposed_icon_id IS NULL
						AND target_client_id IS NULL AND target_membership_id IS NULL
						AND charitree_expires_before IS NULL)
				),
				FOREIGN KEY (petitioner_id) REFERENCES clients (id),
				FOREIGN KEY (target_client_id) REFERENCES clients (id)
			);
			INSERT INTO guild_petitions_new (
				id, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
				proposed_name, proposed_icon_id, target_client_id, target_membership_id,
				charitree_expires_before, created_at, expires_at, resolved_at, lifecycle,
				execution_state, execution_attempts, execution_last_attempt_at,
				execution_failure_category, execution_failure_message, execution_effect
			)
			SELECT
				id, guild_id, guild_name,
				CASE type WHEN 'charitree_clearing' THEN 'charitree_ingratitude' ELSE type END,
				conflict_subject, subject_locked, petitioner_id,
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
		`
	}
];
