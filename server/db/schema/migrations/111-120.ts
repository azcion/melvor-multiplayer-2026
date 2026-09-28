import type { Migration } from '../types';

export const migrations_111_120: Migration[] = [{
	version: 111,
	sql: `
		ALTER TABLE melvor_accounts ADD COLUMN chat_shadowbanned INTEGER NOT NULL DEFAULT 0
			CHECK (chat_shadowbanned IN (0, 1));

		DROP TRIGGER event_chat_message_insert;
		CREATE TRIGGER event_chat_message_insert AFTER INSERT ON chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE id IN
				(SELECT client_id FROM chat_participants WHERE conversation_id = NEW.conversation_id)
			AND (melvor_account_id = (SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id) OR NOT EXISTS (
				SELECT 1 FROM clients AS sender LEFT JOIN melvor_accounts AS account
					ON account.id = sender.melvor_account_id
				WHERE sender.id = NEW.sender_id
				AND COALESCE(account.chat_shadowbanned, 0) = 1
			));
		END;

		DROP TRIGGER event_guild_chat_message_insert;
		CREATE TRIGGER event_guild_chat_message_insert AFTER INSERT ON guild_chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE guild_chat_enabled = 1 AND id IN (
				SELECT client_id FROM guild_memberships WHERE guild_id = NEW.guild_id
			) AND (melvor_account_id = (SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id) OR NOT EXISTS (
				SELECT 1 FROM clients AS sender LEFT JOIN melvor_accounts AS account
					ON account.id = sender.melvor_account_id
				WHERE sender.id = NEW.sender_id
				AND COALESCE(account.chat_shadowbanned, 0) = 1
			));
		END;

		DROP TRIGGER event_global_chat_message_insert;
		CREATE TRIGGER event_global_chat_message_insert AFTER INSERT ON global_chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE global_chat_enabled = 1 AND deleted_at IS NULL
			AND (melvor_account_id = (SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id) OR NOT EXISTS (
				SELECT 1 FROM clients AS sender LEFT JOIN melvor_accounts AS account
					ON account.id = sender.melvor_account_id
				WHERE sender.id = NEW.sender_id
				AND COALESCE(account.chat_shadowbanned, 0) = 1
			));
		END;

		DROP TRIGGER event_support_message_insert;
		CREATE TRIGGER event_support_message_insert AFTER INSERT ON support_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE (id = (SELECT player_client_id FROM support_conversations WHERE id = NEW.conversation_id)
				OR id IN (
					SELECT membership.client_id FROM support_team_memberships AS membership
					JOIN support_conversations AS conversation ON conversation.team_id = membership.team_id
					WHERE conversation.id = NEW.conversation_id AND membership.active = 1
						AND membership.client_id IS NOT NULL
				)) AND (NEW.sending_client_id IS NULL OR melvor_account_id = (SELECT melvor_account_id FROM clients WHERE id = NEW.sending_client_id) OR NOT EXISTS (
				SELECT 1 FROM clients AS sender LEFT JOIN melvor_accounts AS account
					ON account.id = sender.melvor_account_id
				WHERE sender.id = NEW.sending_client_id
				AND COALESCE(account.chat_shadowbanned, 0) = 1
			));
		END;

		DROP TRIGGER event_poll_discussion_insert;
		CREATE TRIGGER event_poll_discussion_insert AFTER INSERT ON poll_discussion_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL
			AND (melvor_account_id = (SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id) OR NOT EXISTS (
				SELECT 1 FROM clients AS sender LEFT JOIN melvor_accounts AS account
					ON account.id = sender.melvor_account_id
				WHERE sender.id = NEW.sender_id
				AND COALESCE(account.chat_shadowbanned, 0) = 1
			));
		END;
	`
}, {
	version: 112,
	sql: `
		ALTER TABLE chat_messages ADD COLUMN shadow_hidden INTEGER NOT NULL DEFAULT 0
			CHECK (shadow_hidden IN (0, 1));
		ALTER TABLE guild_chat_messages ADD COLUMN shadow_hidden INTEGER NOT NULL DEFAULT 0
			CHECK (shadow_hidden IN (0, 1));
		ALTER TABLE global_chat_messages ADD COLUMN shadow_hidden INTEGER NOT NULL DEFAULT 0
			CHECK (shadow_hidden IN (0, 1));
		ALTER TABLE poll_discussion_messages ADD COLUMN shadow_hidden INTEGER NOT NULL DEFAULT 0
			CHECK (shadow_hidden IN (0, 1));

		DROP TRIGGER event_chat_message_insert;
		CREATE TRIGGER event_chat_message_insert AFTER INSERT ON chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE id IN
				(SELECT client_id FROM chat_participants WHERE conversation_id = NEW.conversation_id)
			AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id));
		END;

		DROP TRIGGER event_guild_chat_message_insert;
		CREATE TRIGGER event_guild_chat_message_insert AFTER INSERT ON guild_chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE guild_chat_enabled = 1 AND id IN (
				SELECT client_id FROM guild_memberships WHERE guild_id = NEW.guild_id
			) AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id));
		END;

		DROP TRIGGER event_global_chat_message_insert;
		CREATE TRIGGER event_global_chat_message_insert AFTER INSERT ON global_chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE global_chat_enabled = 1 AND deleted_at IS NULL
			AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id));
		END;

		DROP TRIGGER event_support_message_insert;
		CREATE TRIGGER event_support_message_insert AFTER INSERT ON support_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE id = (SELECT player_client_id FROM support_conversations WHERE id = NEW.conversation_id)
				OR id IN (
					SELECT membership.client_id FROM support_team_memberships AS membership
					JOIN support_conversations AS conversation ON conversation.team_id = membership.team_id
					WHERE conversation.id = NEW.conversation_id AND membership.active = 1
						AND membership.client_id IS NOT NULL
				);
		END;

		DROP TRIGGER event_poll_discussion_insert;
		CREATE TRIGGER event_poll_discussion_insert AFTER INSERT ON poll_discussion_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL
			AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id));
		END;
	`
}, {
	version: 113,
	sql: `
		DROP TRIGGER charity_decay_activation_after_wish_insert;
		DROP TRIGGER charity_decay_activation_after_wish_update;
		DROP TRIGGER charity_decay_activation_after_wish_delete;

		CREATE TRIGGER charity_decay_activation_after_wish_insert
		AFTER INSERT ON charity_wishes
		WHEN NEW.matures_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000
			OR NEW.progress_gp < NEW.required_gp
		BEGIN
			INSERT INTO charity_decay_activations (guild_id, activated_at)
			VALUES (NEW.guild_id, NEW.created_at) ON CONFLICT (guild_id) DO NOTHING;
		END;
		CREATE TRIGGER charity_decay_activation_after_wish_update
		AFTER UPDATE OF guild_id, progress_gp, required_gp, created_at, matures_at ON charity_wishes
		BEGIN
			DELETE FROM charity_decay_activations WHERE guild_id = OLD.guild_id
				AND NOT EXISTS (
					SELECT 1 FROM charity_wishes WHERE guild_id = OLD.guild_id
						AND (matures_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000
							OR progress_gp < required_gp)
				);
			INSERT INTO charity_decay_activations (guild_id, activated_at)
			SELECT NEW.guild_id, NEW.created_at
			WHERE NEW.matures_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000
				OR NEW.progress_gp < NEW.required_gp
			ON CONFLICT (guild_id) DO NOTHING;
		END;
		CREATE TRIGGER charity_decay_activation_after_wish_delete
		AFTER DELETE ON charity_wishes
		BEGIN
			DELETE FROM charity_decay_activations WHERE guild_id = OLD.guild_id
				AND NOT EXISTS (
					SELECT 1 FROM charity_wishes WHERE guild_id = OLD.guild_id
						AND (matures_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000
							OR progress_gp < required_gp)
				);
		END;
	`
}];
