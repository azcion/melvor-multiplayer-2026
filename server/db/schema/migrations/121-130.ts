import type { Migration } from '../types';

export const migrations_121_130: Migration[] = [{
	version: 121,
	sql: `
		CREATE TABLE chat_shadow_observers (
			observer_account_id INTEGER PRIMARY KEY REFERENCES melvor_accounts(id) ON DELETE CASCADE,
			granted_at INTEGER NOT NULL CHECK (granted_at >= 0)
		) STRICT;

		DROP TRIGGER event_chat_message_insert;
		CREATE TRIGGER event_chat_message_insert AFTER INSERT ON chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE id IN
				(SELECT client_id FROM chat_participants WHERE conversation_id = NEW.conversation_id)
			AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id)
				OR melvor_account_id IN (SELECT observer_account_id FROM chat_shadow_observers));
		END;

		DROP TRIGGER event_guild_chat_message_insert;
		CREATE TRIGGER event_guild_chat_message_insert AFTER INSERT ON guild_chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE guild_chat_enabled = 1 AND id IN (
				SELECT client_id FROM guild_memberships WHERE guild_id = NEW.guild_id
			) AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id)
				OR melvor_account_id IN (SELECT observer_account_id FROM chat_shadow_observers));
		END;

		DROP TRIGGER event_global_chat_message_insert;
		CREATE TRIGGER event_global_chat_message_insert AFTER INSERT ON global_chat_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1
			WHERE global_chat_enabled = 1 AND deleted_at IS NULL
			AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id)
				OR melvor_account_id IN (SELECT observer_account_id FROM chat_shadow_observers));
		END;

		DROP TRIGGER event_poll_discussion_insert;
		CREATE TRIGGER event_poll_discussion_insert AFTER INSERT ON poll_discussion_messages BEGIN
			UPDATE clients SET event_revision = event_revision + 1 WHERE deleted_at IS NULL
			AND (NEW.shadow_hidden = 0 OR melvor_account_id =
				(SELECT melvor_account_id FROM clients WHERE id = NEW.sender_id)
				OR melvor_account_id IN (SELECT observer_account_id FROM chat_shadow_observers));
		END;
	`
}, {
	version: 122,
	sql: `
		CREATE TABLE dev_work_tracking (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			work_type TEXT NOT NULL CHECK (work_type = 'woodcutting'),
			started_at INTEGER NOT NULL CHECK (started_at >= 0),
			stopped_at INTEGER CHECK (stopped_at IS NULL OR stopped_at >= started_at),
			stop_activities TEXT CHECK (stop_activities IS NULL OR length(stop_activities) <= 16384)
		) STRICT;
	`
}, {
	version: 123,
	sql: `
		DROP TABLE dev_work_tracking;

		CREATE TABLE dev_work_tracking_sessions (
			id INTEGER PRIMARY KEY,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			work_type TEXT NOT NULL CHECK (work_type = 'woodcutting'),
			started_at INTEGER NOT NULL CHECK (started_at >= 0),
			ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at),
			end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN ('check_in', 'activity_stopped')),
			elapsed_ms INTEGER CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
			target_work_ms INTEGER CHECK (target_work_ms IS NULL OR target_work_ms >= 0),
			total_work_ms INTEGER CHECK (total_work_ms IS NULL OR total_work_ms >= 0),
			timeline_credit_ms INTEGER CHECK (timeline_credit_ms IS NULL OR timeline_credit_ms >= 0),
			statistics_credit_ms INTEGER CHECK (statistics_credit_ms IS NULL OR statistics_credit_ms >= 0),
			credited_ms INTEGER CHECK (credited_ms IS NULL OR credited_ms >= 0),
			CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
			CHECK ((ended_at IS NULL) = (elapsed_ms IS NULL))
		) STRICT;
		CREATE UNIQUE INDEX idx_dev_work_tracking_active
			ON dev_work_tracking_sessions(client_id) WHERE ended_at IS NULL;

		CREATE TABLE dev_work_tracking_activity_events (
			id INTEGER PRIMARY KEY,
			session_id INTEGER NOT NULL REFERENCES dev_work_tracking_sessions(id) ON DELETE CASCADE,
			observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
			activities TEXT NOT NULL CHECK (length(activities) <= 16384),
			activity_count INTEGER NOT NULL CHECK (activity_count >= 0 AND activity_count <= 16)
		) STRICT;
		CREATE INDEX idx_dev_work_tracking_activity_events_session
			ON dev_work_tracking_activity_events(session_id, observed_at, id);

		CREATE TABLE dev_work_tracking_stat_snapshots (
			id INTEGER PRIMARY KEY,
			session_id INTEGER NOT NULL REFERENCES dev_work_tracking_sessions(id) ON DELETE CASCADE,
			phase TEXT NOT NULL CHECK (phase IN ('start', 'check_in', 'stop')),
			observed_at INTEGER NOT NULL CHECK (observed_at >= 0),
			statistics TEXT NOT NULL CHECK (length(statistics) <= 16384)
		) STRICT;
		CREATE INDEX idx_dev_work_tracking_stat_snapshots_session
			ON dev_work_tracking_stat_snapshots(session_id, observed_at, id);
	`
}, {
	version: 124,
	sql: `
		CREATE TABLE expeditions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			status TEXT NOT NULL CHECK (status IN ('registration', 'active', 'completed', 'inactive', 'dissolved')),
			content_version INTEGER NOT NULL CHECK (content_version > 0),
			content_snapshot TEXT NOT NULL CHECK (json_valid(content_snapshot)),
			registered_at INTEGER NOT NULL CHECK (registered_at >= 0),
			registration_ends_at INTEGER NOT NULL CHECK (registration_ends_at > registered_at),
			current_visit_id INTEGER,
			last_qualifying_activity_at INTEGER NOT NULL CHECK (last_qualifying_activity_at >= 0),
			ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= registered_at),
			revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0)
		) STRICT;
		CREATE UNIQUE INDEX idx_expeditions_one_active_per_guild ON expeditions(guild_id)
			WHERE status IN ('registration', 'active');
		CREATE INDEX idx_expeditions_guild_history ON expeditions(guild_id, id DESC);

		CREATE TABLE expedition_registrations (
			expedition_id INTEGER NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			registered_at INTEGER NOT NULL CHECK (registered_at >= 0),
			PRIMARY KEY (expedition_id, client_id)
		) STRICT;
		CREATE INDEX idx_expedition_registrations_client ON expedition_registrations(client_id, expedition_id);
		CREATE TABLE expedition_operations (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			operation_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			expedition_id INTEGER NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			PRIMARY KEY (client_id, operation_id)
		) STRICT;

		CREATE TABLE expedition_visits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			expedition_id INTEGER NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
			chamber_id TEXT NOT NULL,
			entered_at INTEGER NOT NULL CHECK (entered_at >= 0),
			departed_at INTEGER CHECK (departed_at IS NULL OR departed_at >= entered_at),
			participant_count INTEGER NOT NULL CHECK (participant_count > 0),
			charted_on_arrival INTEGER NOT NULL CHECK (charted_on_arrival IN (0, 1)),
			chosen_exit_id TEXT,
			UNIQUE (expedition_id, id)
		) STRICT;
		CREATE UNIQUE INDEX idx_expedition_visits_current ON expedition_visits(expedition_id)
			WHERE departed_at IS NULL;
		CREATE INDEX idx_expedition_visits_history ON expedition_visits(expedition_id, id);

		CREATE TABLE expedition_tasks (
			visit_id INTEGER NOT NULL REFERENCES expedition_visits(id) ON DELETE CASCADE,
			task_id TEXT NOT NULL,
			target_ms INTEGER NOT NULL CHECK (target_ms > 0),
			player_ms INTEGER NOT NULL DEFAULT 0 CHECK (player_ms >= 0),
			system_ms INTEGER NOT NULL DEFAULT 0 CHECK (system_ms >= 0),
			unlocked_at INTEGER CHECK (unlocked_at IS NULL OR unlocked_at >= 0),
			completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= 0),
			promoted_at INTEGER CHECK (promoted_at IS NULL OR promoted_at >= 0),
			PRIMARY KEY (visit_id, task_id)
		) STRICT;

		CREATE TABLE expedition_exits (
			visit_id INTEGER NOT NULL REFERENCES expedition_visits(id) ON DELETE CASCADE,
			exit_id TEXT NOT NULL,
			discovered_at INTEGER CHECK (discovered_at IS NULL OR discovered_at >= 0),
			PRIMARY KEY (visit_id, exit_id)
		) STRICT;

		CREATE TABLE expedition_charted (
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			chamber_id TEXT NOT NULL,
			completed_at INTEGER NOT NULL CHECK (completed_at >= 0),
			PRIMARY KEY (guild_id, chamber_id)
		) STRICT;
	`
}, {
	version: 125,
	sql: `
		CREATE TABLE expedition_personal_records (
			expedition_id INTEGER NOT NULL CHECK (expedition_id > 0),
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			source_guild_id INTEGER NOT NULL CHECK (source_guild_id > 0),
			source_guild_name TEXT NOT NULL,
			registered_at INTEGER NOT NULL CHECK (registered_at >= 0),
			status TEXT NOT NULL CHECK (status IN ('registration', 'active', 'completed', 'inactive', 'dissolved')),
			ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= registered_at),
			PRIMARY KEY (expedition_id, client_id)
		) STRICT;
		CREATE INDEX idx_expedition_personal_records_client ON expedition_personal_records(client_id, expedition_id DESC);
		INSERT INTO expedition_personal_records
			(expedition_id, client_id, source_guild_id, source_guild_name, registered_at, status, ended_at)
		SELECT expedition.id, registration.client_id, expedition.guild_id, guild.name,
			registration.registered_at, expedition.status, expedition.ended_at
		FROM expedition_registrations AS registration
		JOIN expeditions AS expedition ON expedition.id = registration.expedition_id
		JOIN guilds AS guild ON guild.id = expedition.guild_id;

		CREATE TRIGGER expedition_personal_status AFTER UPDATE OF status ON expeditions BEGIN
			UPDATE expedition_personal_records SET status = NEW.status, ended_at = NEW.ended_at
			WHERE expedition_id = NEW.id;
		END;
		CREATE TRIGGER expedition_personal_guild_deleted BEFORE DELETE ON guilds BEGIN
			UPDATE expedition_personal_records SET status = 'dissolved',
				ended_at = MAX(registered_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			WHERE source_guild_id = OLD.id AND status IN ('registration', 'active');
		END;
	`
}, {
	version: 126,
	sql: `
		CREATE TABLE expedition_membership_tenures (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			expedition_id INTEGER NOT NULL CHECK (expedition_id > 0),
			source_guild_id INTEGER NOT NULL CHECK (source_guild_id > 0),
			membership_id INTEGER NOT NULL CHECK (membership_id > 0),
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			started_at INTEGER NOT NULL CHECK (started_at >= 0),
			ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at),
			UNIQUE (expedition_id, membership_id)
		) STRICT;
		CREATE INDEX idx_expedition_tenures_client ON expedition_membership_tenures(client_id, expedition_id);
		INSERT INTO expedition_membership_tenures
			(expedition_id, source_guild_id, membership_id, client_id, started_at)
		SELECT registration.expedition_id, expedition.guild_id, membership.id,
			registration.client_id, registration.registered_at
		FROM expedition_registrations AS registration
		JOIN expeditions AS expedition ON expedition.id = registration.expedition_id
		JOIN guild_memberships AS membership ON membership.client_id = registration.client_id
			AND membership.guild_id = expedition.guild_id;

		CREATE TRIGGER expedition_tenure_membership_deleted BEFORE DELETE ON guild_memberships BEGIN
			UPDATE expedition_membership_tenures SET
				ended_at = MAX(started_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			WHERE membership_id = OLD.id AND ended_at IS NULL;
		END;
		CREATE TRIGGER expedition_tenure_guild_deleted BEFORE DELETE ON guilds BEGIN
			UPDATE expedition_membership_tenures SET
				ended_at = MAX(started_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			WHERE source_guild_id = OLD.id AND ended_at IS NULL;
		END;
	`
}, {
	version: 127,
	sql: `
		ALTER TABLE expeditions ADD COLUMN stash_outcome TEXT NOT NULL DEFAULT 'pending'
			CHECK (stash_outcome IN ('pending', 'empty', 'charitree', 'destroyed'));
		ALTER TABLE expedition_personal_records ADD COLUMN stash_outcome TEXT NOT NULL DEFAULT 'pending'
			CHECK (stash_outcome IN ('pending', 'empty', 'charitree', 'destroyed'));

		CREATE TABLE expedition_supplies (
			expedition_id INTEGER NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
			value_currency_id TEXT,
			value_per_item INTEGER CHECK (value_per_item IS NULL OR value_per_item >= 0),
			PRIMARY KEY (expedition_id, item_id)
		) STRICT;
		CREATE TABLE expedition_supply_lots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			expedition_id INTEGER NOT NULL,
			item_id TEXT NOT NULL,
			client_id INTEGER NOT NULL REFERENCES clients(id),
			owner_key TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
			contributed_at INTEGER NOT NULL CHECK (contributed_at >= 0),
			FOREIGN KEY (expedition_id, item_id) REFERENCES expedition_supplies(expedition_id, item_id)
				ON DELETE CASCADE
		) STRICT;
		CREATE INDEX idx_expedition_supply_lots_item ON expedition_supply_lots(expedition_id, item_id);

		CREATE TRIGGER expedition_personal_stash_outcome AFTER UPDATE OF stash_outcome ON expeditions BEGIN
			UPDATE expedition_personal_records SET stash_outcome = NEW.stash_outcome
			WHERE expedition_id = NEW.id;
		END;
		CREATE TRIGGER expedition_stash_guild_deleted BEFORE DELETE ON guilds BEGIN
			UPDATE expedition_personal_records SET stash_outcome =
				CASE WHEN EXISTS (
					SELECT 1 FROM expedition_supplies AS supply
					JOIN expeditions AS expedition ON expedition.id = supply.expedition_id
					WHERE expedition.guild_id = OLD.id AND expedition.id = expedition_personal_records.expedition_id
				) THEN 'destroyed' ELSE 'empty' END
			WHERE source_guild_id = OLD.id AND stash_outcome = 'pending';
		END;
	`
}, {
	version: 128,
	sql: `
		CREATE TABLE expedition_stash_disposals (
			expedition_id INTEGER NOT NULL CHECK (expedition_id > 0),
			source_guild_id INTEGER NOT NULL CHECK (source_guild_id > 0),
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9007199254740991),
			outcome TEXT NOT NULL CHECK (outcome IN ('charitree', 'destroyed')),
			disposed_at INTEGER NOT NULL CHECK (disposed_at >= 0),
			PRIMARY KEY (expedition_id, item_id)
		) STRICT;
		CREATE INDEX idx_expedition_stash_disposals_guild ON expedition_stash_disposals(source_guild_id, expedition_id);
		CREATE TRIGGER expedition_stash_disposal_on_guild_delete BEFORE DELETE ON guilds BEGIN
			INSERT OR IGNORE INTO expedition_stash_disposals
				(expedition_id, source_guild_id, item_id, qty, outcome, disposed_at)
			SELECT expedition.id, OLD.id, supply.item_id, supply.qty, 'destroyed',
				MAX(expedition.registered_at, CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER))
			FROM expeditions AS expedition JOIN expedition_supplies AS supply
				ON supply.expedition_id = expedition.id WHERE expedition.guild_id = OLD.id;
		END;
	`
}, {
	version: 129,
	sql: `
		CREATE TABLE expedition_work_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			expedition_id INTEGER NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
			visit_id INTEGER NOT NULL REFERENCES expedition_visits(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			tenure_id INTEGER NOT NULL REFERENCES expedition_membership_tenures(id) ON DELETE CASCADE,
			task_id TEXT NOT NULL,
			started_at INTEGER NOT NULL CHECK (started_at >= 0),
			start_statistics TEXT NOT NULL CHECK (json_valid(start_statistics)),
			start_activities TEXT NOT NULL CHECK (json_valid(start_activities)),
			ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at),
			credited_ms INTEGER CHECK (credited_ms IS NULL OR credited_ms >= 0),
			guild_ms INTEGER CHECK (guild_ms IS NULL OR guild_ms >= 0),
			end_reason TEXT,
			FOREIGN KEY (visit_id, task_id) REFERENCES expedition_tasks(visit_id, task_id)
		) STRICT;
		CREATE UNIQUE INDEX idx_expedition_work_active ON expedition_work_sessions(client_id) WHERE ended_at IS NULL;
		CREATE INDEX idx_expedition_work_task ON expedition_work_sessions(visit_id, task_id);
		CREATE TABLE expedition_work_operations (
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			operation_id TEXT NOT NULL,
			request_hash TEXT NOT NULL,
			response TEXT NOT NULL CHECK (json_valid(response)),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			PRIMARY KEY (client_id, operation_id)
		) STRICT;
		CREATE TABLE expedition_ep_balances (
			client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
			points_micros INTEGER NOT NULL DEFAULT 0 CHECK (points_micros >= 0)
		) STRICT;
		CREATE TABLE expedition_ep_ledger (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			source_kind TEXT NOT NULL CHECK (source_kind IN ('work', 'supply')),
			source_id INTEGER NOT NULL,
			points_micros INTEGER NOT NULL CHECK (points_micros >= 0),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			UNIQUE (source_kind, source_id)
		) STRICT;
	`
}, {
	version: 130,
	sql: `
		ALTER TABLE expedition_visits ADD COLUMN vote_opened_at INTEGER;
		ALTER TABLE expedition_visits ADD COLUMN vote_deadline_at INTEGER;
		ALTER TABLE expedition_visits ADD COLUMN vote_locked_at INTEGER;
		ALTER TABLE expedition_visits ADD COLUMN vote_half_shortened INTEGER NOT NULL DEFAULT 0 CHECK (vote_half_shortened IN (0, 1));
		ALTER TABLE expedition_visits ADD COLUMN vote_full_shortened INTEGER NOT NULL DEFAULT 0 CHECK (vote_full_shortened IN (0, 1));
		CREATE TABLE expedition_votes (
			visit_id INTEGER NOT NULL REFERENCES expedition_visits(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			exit_id TEXT NOT NULL,
			voted_at INTEGER NOT NULL CHECK (voted_at >= 0),
			PRIMARY KEY (visit_id, client_id)
		) STRICT;
		CREATE TABLE expedition_interactions (
			visit_id INTEGER NOT NULL REFERENCES expedition_visits(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			interacted_at INTEGER NOT NULL CHECK (interacted_at >= 0),
			PRIMARY KEY (visit_id, client_id)
		) STRICT;
	`
}];
