import type { Migration } from '../types';

export const migrations_021_030: Migration[] = [
	{
		version: 21,
		foreign_keys_disabled: true,
		sql: `
			UPDATE clients
			SET melvor_account_id = (
				SELECT canonical.id
				FROM melvor_accounts AS current
				JOIN melvor_accounts AS canonical ON canonical.playfab_id = current.playfab_id
				WHERE current.id = clients.melvor_account_id
				ORDER BY canonical.created_at, canonical.id
				LIMIT 1
			)
			WHERE melvor_account_id IS NOT NULL;

			CREATE TABLE melvor_accounts_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				cloud_username TEXT NOT NULL,
				playfab_id TEXT NOT NULL UNIQUE,
				created_at INTEGER NOT NULL CHECK (created_at >= 0)
			);
			INSERT INTO melvor_accounts_new (id, cloud_username, playfab_id, created_at)
			SELECT account.id, account.cloud_username, account.playfab_id, account.created_at
			FROM melvor_accounts AS account
			WHERE account.id = (
				SELECT canonical.id
				FROM melvor_accounts AS canonical
				WHERE canonical.playfab_id = account.playfab_id
				ORDER BY canonical.created_at, canonical.id
				LIMIT 1
			);
			DROP TABLE melvor_accounts;
			ALTER TABLE melvor_accounts_new RENAME TO melvor_accounts;
		`
	}, {
		version: 22,
		sql: `
			ALTER TABLE clients ADD COLUMN gp_visible INTEGER NOT NULL DEFAULT 1
				CHECK (gp_visible IN (0, 1));

			CREATE TABLE gp_snapshots (
				client_id INTEGER PRIMARY KEY,
				amount INTEGER NOT NULL CHECK (amount >= 0),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
		`
	}, {
		version: 23,
		sql: `
			DELETE FROM chat_conversations
			WHERE NOT EXISTS (
				SELECT 1 FROM chat_messages
				WHERE chat_messages.conversation_id = chat_conversations.id
			);
		`
	}, {
		version: 24,
		sql: `
			CREATE TABLE support_teams (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				system_key TEXT NOT NULL UNIQUE,
				display_name TEXT NOT NULL,
				inbox_label TEXT NOT NULL,
				icon_id TEXT NOT NULL,
				welcome_content TEXT NOT NULL CHECK (length(welcome_content) BETWEEN 1 AND 1000),
				created_at INTEGER NOT NULL CHECK (created_at >= 0)
			);
			INSERT INTO support_teams (system_key, display_name, inbox_label, icon_id, welcome_content, created_at)
			VALUES ('multiplayer_mod_team', 'Multiplayer Mod Team', 'mp', 'multiplayer',
				'Welcome to Melvor Multiplayer!\n\nThis is an automated message. If you run into any problems or have a suggestion, just reply here. We''d love to hear from you!', 0);

			CREATE TABLE support_team_memberships (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				team_id INTEGER NOT NULL,
				melvor_account_id INTEGER NOT NULL,
				active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (team_id, melvor_account_id),
				FOREIGN KEY (team_id) REFERENCES support_teams (id),
				FOREIGN KEY (melvor_account_id) REFERENCES melvor_accounts (id)
			);
			CREATE INDEX idx_support_memberships_account ON support_team_memberships (melvor_account_id, active, team_id);

			CREATE TABLE support_virtual_welcomes (
				team_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				presented_at INTEGER NOT NULL CHECK (presented_at >= 0),
				read_at INTEGER CHECK (read_at IS NULL OR read_at >= presented_at),
				PRIMARY KEY (team_id, client_id),
				FOREIGN KEY (team_id) REFERENCES support_teams (id),
				FOREIGN KEY (client_id) REFERENCES clients (id)
			);

			CREATE TABLE support_conversations (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				team_id INTEGER NOT NULL,
				player_client_id INTEGER NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (team_id, player_client_id),
				FOREIGN KEY (team_id) REFERENCES support_teams (id),
				FOREIGN KEY (player_client_id) REFERENCES clients (id)
			);
			CREATE INDEX idx_support_conversations_team ON support_conversations (team_id, id DESC);

			CREATE TABLE support_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_id INTEGER NOT NULL,
				author_kind TEXT NOT NULL CHECK (author_kind IN ('automated', 'player', 'member')),
				membership_id INTEGER,
				sending_client_id INTEGER,
				idempotency_scope TEXT NOT NULL,
				idempotency_key TEXT NOT NULL,
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (idempotency_scope, idempotency_key),
				CHECK ((author_kind = 'automated' AND membership_id IS NULL AND sending_client_id IS NULL) OR
					(author_kind = 'player' AND membership_id IS NULL AND sending_client_id IS NOT NULL) OR
					(author_kind = 'member' AND membership_id IS NOT NULL AND sending_client_id IS NOT NULL)),
				FOREIGN KEY (conversation_id) REFERENCES support_conversations (id),
				FOREIGN KEY (membership_id) REFERENCES support_team_memberships (id),
				FOREIGN KEY (sending_client_id) REFERENCES clients (id)
			);
			CREATE INDEX idx_support_messages_conversation ON support_messages (conversation_id, id DESC);

			CREATE TABLE support_player_message_reads (
				message_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				read_at INTEGER NOT NULL CHECK (read_at >= 0),
				PRIMARY KEY (message_id, client_id),
				FOREIGN KEY (message_id) REFERENCES support_messages (id),
				FOREIGN KEY (client_id) REFERENCES clients (id)
			);

			CREATE TABLE support_member_message_reads (
				message_id INTEGER NOT NULL,
				membership_id INTEGER NOT NULL,
				read_at INTEGER NOT NULL CHECK (read_at >= 0),
				PRIMARY KEY (message_id, membership_id),
				FOREIGN KEY (message_id) REFERENCES support_messages (id),
				FOREIGN KEY (membership_id) REFERENCES support_team_memberships (id)
			);

			CREATE TABLE support_message_moderation (
				message_id INTEGER PRIMARY KEY,
				deleted_at INTEGER NOT NULL CHECK (deleted_at >= 0),
				FOREIGN KEY (message_id) REFERENCES support_messages (id)
			);
		`
	}, {
		version: 25,
		foreign_keys_disabled: true,
		sql: `
			ALTER TABLE guild_memberships ADD COLUMN charitree_take_available_at INTEGER NOT NULL DEFAULT 0
				CHECK (charitree_take_available_at >= 0);

			CREATE TABLE guilds_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL,
				icon_id TEXT NOT NULL,
				type TEXT NOT NULL DEFAULT 'private'
					CHECK (type IN ('private', 'public', 'free_fellowship')),
				charitree_enabled INTEGER NOT NULL DEFAULT 1
					CHECK (charitree_enabled IN (0, 1))
			);
			INSERT INTO guilds_new (id, name, icon_id, type, charitree_enabled)
				SELECT id, name, icon_id, type, charitree_enabled FROM guilds;
			DROP TABLE guilds;
			ALTER TABLE guilds_new RENAME TO guilds;
			CREATE UNIQUE INDEX idx_guilds_free_fellowship
				ON guilds (type) WHERE type = 'free_fellowship';

			CREATE TABLE guild_petitions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				guild_name TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN (
					'appellation', 'heraldry', 'banishment', 'charitree_ingratitude',
					'charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure'
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
					(type IN ('charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure')
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
				id, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
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
	}, {
		version: 26,
		foreign_keys_disabled: true,
		sql: `
			CREATE TABLE guild_petitions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				guild_name TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN (
					'appellation', 'heraldry', 'banishment', 'winnowing', 'charitree_ingratitude',
					'charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure'
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
					(type IN ('winnowing', 'charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure')
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
				id, guild_id, guild_name, type, conflict_subject, subject_locked, petitioner_id,
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

			CREATE TABLE guild_petition_winnowing_targets (
				petition_id INTEGER NOT NULL,
				membership_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				subject_locked INTEGER NOT NULL DEFAULT 1 CHECK (subject_locked IN (0, 1)),
				PRIMARY KEY (petition_id, membership_id),
				FOREIGN KEY (petition_id) REFERENCES guild_petitions (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id)
			);
			CREATE UNIQUE INDEX idx_guild_petition_winnowing_targets_locked_membership
				ON guild_petition_winnowing_targets (membership_id) WHERE subject_locked = 1;
			CREATE INDEX idx_guild_petition_winnowing_targets_petition
				ON guild_petition_winnowing_targets (petition_id, subject_locked);
		`
	}, {
		version: 27,
		sql: `
			ALTER TABLE clients ADD COLUMN guild_chat_enabled INTEGER NOT NULL DEFAULT 1
				CHECK (guild_chat_enabled IN (0, 1));

			CREATE TABLE guild_chat_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				sender_id INTEGER NOT NULL,
				idempotency_key TEXT NOT NULL,
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (sender_id, idempotency_key),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
				FOREIGN KEY (sender_id) REFERENCES clients (id)
			);
			CREATE INDEX idx_guild_chat_messages_guild ON guild_chat_messages (guild_id, id);
			CREATE INDEX idx_guild_chat_messages_sender ON guild_chat_messages (sender_id, id);

			CREATE TABLE guild_chat_read_state (
				guild_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				last_read_message_id INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0),
				PRIMARY KEY (guild_id, client_id),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);

			CREATE TABLE guild_chat_message_moderation (
				message_id INTEGER PRIMARY KEY,
				deleted_at INTEGER NOT NULL CHECK (deleted_at >= 0),
				FOREIGN KEY (message_id) REFERENCES guild_chat_messages (id) ON DELETE CASCADE
			);

			INSERT INTO guild_chat_read_state (guild_id, client_id, last_read_message_id)
				SELECT membership.guild_id, membership.client_id,
					COALESCE((SELECT MAX(message.id) FROM guild_chat_messages AS message
						WHERE message.guild_id = membership.guild_id), 0)
				FROM guild_memberships AS membership;

			CREATE TRIGGER guild_chat_membership_baseline AFTER INSERT ON guild_memberships BEGIN
				INSERT INTO guild_chat_read_state (guild_id, client_id, last_read_message_id)
				VALUES (NEW.guild_id, NEW.client_id,
					COALESCE((SELECT MAX(id) FROM guild_chat_messages WHERE guild_id = NEW.guild_id), 0))
				ON CONFLICT (guild_id, client_id) DO UPDATE SET
					last_read_message_id = excluded.last_read_message_id;
			END;

			CREATE TRIGGER event_guild_chat_message_insert AFTER INSERT ON guild_chat_messages BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE guild_chat_enabled = 1 AND id IN (
					SELECT client_id FROM guild_memberships WHERE guild_id = NEW.guild_id
				);
			END;
			CREATE TRIGGER event_guild_chat_read_insert AFTER INSERT ON guild_chat_read_state BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_guild_chat_read_update AFTER UPDATE OF last_read_message_id ON guild_chat_read_state
			WHEN NEW.last_read_message_id != OLD.last_read_message_id BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_guild_chat_moderation_insert AFTER INSERT ON guild_chat_message_moderation BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE guild_chat_enabled = 1 AND id IN (
					SELECT membership.client_id FROM guild_memberships AS membership
					JOIN guild_chat_messages AS message ON message.guild_id = membership.guild_id
					WHERE message.id = NEW.message_id
				);
			END;
			CREATE TRIGGER event_guild_chat_participation_update AFTER UPDATE OF guild_chat_enabled ON clients BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.id;
			END;
		`
	}, {
		version: 28,
		foreign_keys_disabled: true,
		sql: `
			CREATE TABLE support_team_memberships_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				team_id INTEGER NOT NULL,
				client_id INTEGER,
				member_display_name TEXT NOT NULL CHECK (length(member_display_name) BETWEEN 1 AND 64),
				active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				UNIQUE (team_id, client_id),
				CHECK (client_id IS NOT NULL OR active = 0),
				FOREIGN KEY (team_id) REFERENCES support_teams (id),
				FOREIGN KEY (client_id) REFERENCES clients (id)
			);
			INSERT INTO support_team_memberships_new (
				id, team_id, client_id, member_display_name, active, created_at
			)
			SELECT membership.id, membership.team_id, NULL, account.cloud_username, 0, membership.created_at
			FROM support_team_memberships AS membership
			JOIN melvor_accounts AS account ON account.id = membership.melvor_account_id;
			DROP TABLE support_team_memberships;
			ALTER TABLE support_team_memberships_new RENAME TO support_team_memberships;
			CREATE INDEX idx_support_memberships_client
				ON support_team_memberships (client_id, active, team_id);

			CREATE TABLE client_deletion_requests_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				target_client_id INTEGER NOT NULL,
				requester_client_id INTEGER NOT NULL,
				requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
				execute_at INTEGER NOT NULL CHECK (execute_at >= requested_at),
				cancelled_at INTEGER CHECK (cancelled_at IS NULL OR cancelled_at >= requested_at),
				executed_at INTEGER CHECK (executed_at IS NULL OR executed_at >= requested_at),
				CHECK (cancelled_at IS NULL OR executed_at IS NULL),
				FOREIGN KEY (target_client_id) REFERENCES clients (id) ON DELETE CASCADE,
				FOREIGN KEY (requester_client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			INSERT INTO client_deletion_requests_new (
				id, target_client_id, requester_client_id, requested_at, execute_at, cancelled_at, executed_at
			)
			SELECT id, target_client_id, requester_client_id, requested_at, execute_at, cancelled_at, executed_at
			FROM client_deletion_requests;
			DROP TABLE client_deletion_requests;
			ALTER TABLE client_deletion_requests_new RENAME TO client_deletion_requests;
			CREATE UNIQUE INDEX idx_client_deletion_requests_pending
				ON client_deletion_requests (target_client_id)
				WHERE cancelled_at IS NULL AND executed_at IS NULL;
			CREATE INDEX idx_client_deletion_requests_due
				ON client_deletion_requests (execute_at, id)
				WHERE cancelled_at IS NULL AND executed_at IS NULL;
		`
	}, {
		version: 29,
		sql: `
			CREATE TABLE economy_receipts (
				id TEXT PRIMARY KEY,
				client_id INTEGER NOT NULL,
				kind TEXT NOT NULL,
				response_json TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				acknowledged_at INTEGER CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_economy_receipts_pending
				ON economy_receipts (client_id, acknowledged_at, created_at, id);
		`
	}, {
		version: 30,
		sql: `
			CREATE TRIGGER event_support_conversation_insert AFTER INSERT ON support_conversations BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id = NEW.player_client_id OR id IN (
					SELECT client_id FROM support_team_memberships
					WHERE team_id = NEW.team_id AND active = 1 AND client_id IS NOT NULL
				);
			END;
			CREATE TRIGGER event_support_conversation_delete AFTER DELETE ON support_conversations BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id = OLD.player_client_id OR id IN (
					SELECT client_id FROM support_team_memberships
					WHERE team_id = OLD.team_id AND active = 1 AND client_id IS NOT NULL
				);
			END;

			CREATE TRIGGER event_support_message_insert AFTER INSERT ON support_messages BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id = (
					SELECT player_client_id FROM support_conversations WHERE id = NEW.conversation_id
				) OR id IN (
					SELECT membership.client_id FROM support_team_memberships AS membership
					JOIN support_conversations AS conversation ON conversation.team_id = membership.team_id
					WHERE conversation.id = NEW.conversation_id AND membership.active = 1
						AND membership.client_id IS NOT NULL
				);
			END;

			CREATE TRIGGER event_support_player_read_insert AFTER INSERT ON support_player_message_reads BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_support_member_read_insert AFTER INSERT ON support_member_message_reads BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = (
					SELECT client_id FROM support_team_memberships
					WHERE id = NEW.membership_id AND active = 1
				);
			END;

			CREATE TRIGGER event_support_moderation_insert AFTER INSERT ON support_message_moderation BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id = (
					SELECT conversation.player_client_id FROM support_conversations AS conversation
					JOIN support_messages AS message ON message.conversation_id = conversation.id
					WHERE message.id = NEW.message_id
				) OR id IN (
					SELECT membership.client_id FROM support_team_memberships AS membership
					JOIN support_conversations AS conversation ON conversation.team_id = membership.team_id
					JOIN support_messages AS message ON message.conversation_id = conversation.id
					WHERE message.id = NEW.message_id AND membership.active = 1
						AND membership.client_id IS NOT NULL
				);
			END;
		`
	}
];
