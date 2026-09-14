import type { Migration } from '../types';

export const migrations_081_090: Migration[] = [
	{
		version: 81,
		sql: `
			CREATE TABLE chat_message_reactions (
				message_id INTEGER NOT NULL REFERENCES chat_messages (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				reaction TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (message_id, client_id, reaction)
			);
			CREATE INDEX idx_chat_message_reactions_summary
				ON chat_message_reactions (message_id, created_at, reaction);

			CREATE TABLE guild_chat_message_reactions (
				message_id INTEGER NOT NULL REFERENCES guild_chat_messages (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				reaction TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (message_id, client_id, reaction)
			);
			CREATE INDEX idx_guild_chat_message_reactions_summary
				ON guild_chat_message_reactions (message_id, created_at, reaction);

			CREATE TABLE global_chat_message_reactions (
				message_id INTEGER NOT NULL REFERENCES global_chat_messages (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				reaction TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (message_id, client_id, reaction)
			);
			CREATE INDEX idx_global_chat_message_reactions_summary
				ON global_chat_message_reactions (message_id, created_at, reaction);

			CREATE TABLE support_message_reactions (
				message_id INTEGER NOT NULL REFERENCES support_messages (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				reaction TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (message_id, client_id, reaction)
			);
			CREATE INDEX idx_support_message_reactions_summary
				ON support_message_reactions (message_id, created_at, reaction);
		`
	},
	{
		version: 82,
		sql: `
			INSERT INTO service_settings (key, value) VALUES ('chat_reaction_revision', '0');

			ALTER TABLE chat_messages ADD COLUMN reaction_revision INTEGER NOT NULL DEFAULT 0
				CHECK (reaction_revision BETWEEN 0 AND 9007199254740991);
			ALTER TABLE guild_chat_messages ADD COLUMN reaction_revision INTEGER NOT NULL DEFAULT 0
				CHECK (reaction_revision BETWEEN 0 AND 9007199254740991);
			ALTER TABLE global_chat_messages ADD COLUMN reaction_revision INTEGER NOT NULL DEFAULT 0
				CHECK (reaction_revision BETWEEN 0 AND 9007199254740991);
			ALTER TABLE support_messages ADD COLUMN reaction_revision INTEGER NOT NULL DEFAULT 0
				CHECK (reaction_revision BETWEEN 0 AND 9007199254740991);

			CREATE INDEX idx_chat_messages_reaction_revision
				ON chat_messages (conversation_id, reaction_revision);
			CREATE INDEX idx_guild_chat_messages_reaction_revision
				ON guild_chat_messages (guild_id, reaction_revision);
			CREATE INDEX idx_global_chat_messages_reaction_revision
				ON global_chat_messages (reaction_revision);
			CREATE INDEX idx_support_messages_reaction_revision
				ON support_messages (conversation_id, reaction_revision);
		`
	},
	{
		version: 83,
		sql: `
			CREATE TABLE charity_contribution_lots (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				item_id TEXT NOT NULL,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
				contributed_at INTEGER NOT NULL CHECK (contributed_at BETWEEN 0 AND 9007199254740991),
				source_audit_lot_id INTEGER UNIQUE REFERENCES audit_value_lots (id) ON DELETE RESTRICT,
				FOREIGN KEY (guild_id, item_id) REFERENCES charity_items (guild_id, item_id) ON DELETE CASCADE
			);
			CREATE INDEX idx_charity_contribution_lots_stack
				ON charity_contribution_lots (guild_id, item_id, contributed_at, id);

			INSERT INTO charity_contribution_lots
				(guild_id, item_id, client_id, qty, contributed_at, source_audit_lot_id)
			SELECT item.guild_id, lot.object_id, event.actor_client_id, position.quantity,
				event.occurred_at, lot.id
			FROM audit_value_lot_positions AS position
			JOIN audit_value_lots AS lot ON lot.id = position.lot_id
			JOIN audit_events AS event ON event.id = lot.created_by_event_id
			JOIN charity_items AS item ON item.guild_id = CAST(position.position_key AS INTEGER)
				AND item.item_id = lot.object_id
			WHERE position.position_kind = 'charitree'
				AND event.actor_client_id IS NOT NULL
				AND event.event_type IN ('charitree.donated', 'charitree.shuffled');
		`
	},
	{
		version: 84,
		sql: `
			INSERT INTO service_settings (key, value) VALUES ('poll_revision', '0');

			CREATE TABLE polls (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				creator_id INTEGER NOT NULL REFERENCES clients (id),
				idempotency_key TEXT NOT NULL,
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				revision INTEGER NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 9007199254740991),
				reaction_revision INTEGER NOT NULL DEFAULT 0 CHECK (reaction_revision BETWEEN 0 AND 9007199254740991),
				UNIQUE (creator_id, idempotency_key)
			);
			CREATE INDEX idx_polls_created ON polls (id DESC);

			CREATE TABLE poll_options (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
				position INTEGER NOT NULL CHECK (position >= 0),
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 200),
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				UNIQUE (poll_id, position)
			);
			CREATE TABLE poll_votes (
				poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
				option_id INTEGER NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (option_id, client_id)
			);
			CREATE INDEX idx_poll_votes_poll ON poll_votes (poll_id, option_id);
			CREATE TABLE poll_vote_throttles (
				poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				last_mutated_at INTEGER NOT NULL CHECK (last_mutated_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (poll_id, client_id)
			);
			CREATE TABLE poll_reactions (
				message_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				reaction TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (message_id, client_id, reaction)
			);
			CREATE INDEX idx_poll_reactions_summary ON poll_reactions (message_id, created_at, reaction);

			CREATE TABLE poll_discussion_messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
				sender_id INTEGER NOT NULL REFERENCES clients (id),
				idempotency_key TEXT NOT NULL,
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				reaction_revision INTEGER NOT NULL DEFAULT 0 CHECK (reaction_revision BETWEEN 0 AND 9007199254740991),
				UNIQUE (sender_id, idempotency_key)
			);
			CREATE INDEX idx_poll_discussion_messages_poll ON poll_discussion_messages (poll_id, id);
			CREATE TABLE poll_discussion_message_reactions (
				message_id INTEGER NOT NULL REFERENCES poll_discussion_messages (id) ON DELETE CASCADE,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				reaction TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
				PRIMARY KEY (message_id, client_id, reaction)
			);
			CREATE INDEX idx_poll_discussion_reactions_summary
				ON poll_discussion_message_reactions (message_id, created_at, reaction);

			CREATE TRIGGER event_poll_insert AFTER INSERT ON polls BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL;
			END;
			CREATE TRIGGER event_poll_update AFTER UPDATE OF revision, reaction_revision ON polls BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL;
			END;
			CREATE TRIGGER event_poll_discussion_insert AFTER INSERT ON poll_discussion_messages BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL;
			END;
		`
	},
	{
		version: 85,
		sql: `
			ALTER TABLE charity_wishes ADD COLUMN ripe_at INTEGER
				CHECK (ripe_at IS NULL OR ripe_at BETWEEN 0 AND 9007199254740991);
			UPDATE charity_wishes
			SET ripe_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
			WHERE progress_gp >= required_gp;
			CREATE INDEX idx_charity_wishes_auto_claim
				ON charity_wishes (ripe_at, id)
				WHERE ripe_at IS NOT NULL;
		`
	},
	{
		version: 86,
		sql: `
			INSERT INTO service_settings (key, value) VALUES ('minimum_supported_mod_version', '');
		`
	},
	{
		version: 87,
		sql: `
			ALTER TABLE clients ADD COLUMN cheats_detected_at INTEGER
				CHECK (cheats_detected_at IS NULL OR cheats_detected_at BETWEEN 0 AND 9007199254740991);
		`
	},
	{
		version: 88,
		foreign_keys_disabled: true,
		sql: `
			ALTER TABLE guilds ADD COLUMN cheat_restriction_enabled INTEGER NOT NULL DEFAULT 0
				CHECK (cheat_restriction_enabled IN (0, 1));

			CREATE TABLE guild_petitions_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				guild_name TEXT NOT NULL,
				type TEXT NOT NULL CHECK (type IN (
					'appellation', 'heraldry', 'banishment', 'winnowing', 'charitree_ingratitude',
					'charitree_sacrilege', 'charitree_beneficence', 'fellowship', 'enclosure',
					'interdict', 'heresy'
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
						'enclosure', 'interdict', 'heresy')
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
	}
];
