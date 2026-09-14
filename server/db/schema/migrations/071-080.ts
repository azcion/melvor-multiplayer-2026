import type { Migration } from '../types';

export const migrations_071_080: Migration[] = [
	{
		version: 71,
		sql: `
			UPDATE \`market_items\`
			SET \`published_at\` = COALESCE(
				(
					SELECT MIN(COALESCE(candidate.\`updated_at\`, candidate.\`published_at\`))
					FROM \`market_items\` AS candidate
					WHERE COALESCE(candidate.\`updated_at\`, candidate.\`published_at\`) >
						CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 1209600000
				),
				CAST(strftime('%s', 'now') AS INTEGER) * 1000
			)
			WHERE \`published_at\` = 0 AND \`updated_at\` IS NULL;
		`
	},
	{
		version: 72,
		sql: `
			CREATE TABLE charity_wishes (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL REFERENCES guilds (id) ON DELETE CASCADE,
				owner_client_id INTEGER NOT NULL REFERENCES clients (id),
				melvor_account_id INTEGER NOT NULL REFERENCES melvor_accounts (id),
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 100),
				required_gp INTEGER NOT NULL CHECK (required_gp > 0),
				progress_gp INTEGER NOT NULL DEFAULT 0 CHECK (progress_gp >= 0 AND progress_gp <= required_gp),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				matures_at INTEGER NOT NULL CHECK (matures_at >= created_at),
				UNIQUE (melvor_account_id)
			);
			CREATE INDEX idx_charity_wishes_guild_phase
				ON charity_wishes (guild_id, matures_at, progress_gp, required_gp, id);

			CREATE TABLE charity_wish_commands (
				id TEXT PRIMARY KEY,
				client_id INTEGER NOT NULL REFERENCES clients (id),
				kind TEXT NOT NULL CHECK (kind IN ('make', 'forsake', 'pick')),
				response_json TEXT NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0)
			);

			CREATE TABLE guild_petition_charity_wishes (
				petition_id INTEGER NOT NULL REFERENCES guild_petitions (id) ON DELETE CASCADE,
				wish_id INTEGER NOT NULL REFERENCES charity_wishes (id) ON DELETE CASCADE,
				PRIMARY KEY (petition_id, wish_id)
			);
		`
	},
	{
		version: 73,
		sql: `
			CREATE TABLE update_sections (
				id TEXT PRIMARY KEY CHECK (length(trim(id)) BETWEEN 1 AND 64),
				sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
				title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 128),
				body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 8192)
			);
			CREATE UNIQUE INDEX idx_update_sections_sort_order ON update_sections (sort_order);

			INSERT INTO update_sections (id, sort_order, title, body) VALUES
				('dev-message', 0, 'Dev note', 'It''s a tree - it''s gonna have leaves. 🍃'),
				('working-on', 1, 'In development', 'Many of you have sent us some fun suggestions for things to add. Now that 1.5 is out of the way, we can finally start shifting our focus toward some of those ideas and getting more new stuff into the mod.'),
				('future-update', 2, 'On the roadmap', 'We''re also planning a replacement for the current Raid preview, along with a complete rework of Campaigns.');
		`
	},
	{
		version: 74,
		sql: `
			ALTER TABLE clients ADD COLUMN social_mode_enforced INTEGER NOT NULL DEFAULT 0
				CHECK (social_mode_enforced IN (0, 1));
			ALTER TABLE melvor_accounts ADD COLUMN social_mode_enforced INTEGER NOT NULL DEFAULT 0
				CHECK (social_mode_enforced IN (0, 1));
		`
	},
	{
		version: 75,
		sql: `
			CREATE TABLE audit_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				occurred_at INTEGER NOT NULL CHECK (occurred_at BETWEEN 0 AND 9007199254740991),
				event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 3 AND 96),
				schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
				actor_kind TEXT NOT NULL CHECK (actor_kind IN ('client', 'operator', 'system')),
				actor_client_id INTEGER,
				actor_display_name TEXT,
				guild_id INTEGER,
				guild_name TEXT,
				command_id TEXT,
				source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 1 AND 255),
				installation_id TEXT,
				client_platform TEXT,
				app_distribution TEXT,
				app_channel TEXT,
				app_version TEXT,
				app_build TEXT,
				details_json TEXT NOT NULL DEFAULT '{}'
					CHECK (json_valid(details_json) AND json_type(details_json) = 'object'),
				CHECK ((actor_kind = 'client') = (actor_client_id IS NOT NULL)),
				CHECK (actor_kind != 'client' OR actor_display_name IS NOT NULL)
			);
			CREATE INDEX idx_audit_events_actor_time
				ON audit_events (actor_client_id, occurred_at, id);
			CREATE INDEX idx_audit_events_guild_time
				ON audit_events (guild_id, occurred_at, id);
			CREATE INDEX idx_audit_events_type_time
				ON audit_events (event_type, occurred_at, id);
			CREATE INDEX idx_audit_events_installation_time
				ON audit_events (installation_id, occurred_at, id) WHERE installation_id IS NOT NULL;

			CREATE TABLE audit_event_participants (
				event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
				role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 64),
				client_id INTEGER NOT NULL,
				display_name TEXT NOT NULL,
				PRIMARY KEY (event_id, role, client_id)
			);
			CREATE INDEX idx_audit_event_participants_client
				ON audit_event_participants (client_id, event_id);

			CREATE TABLE audit_event_values (
				event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
				ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
				value_kind TEXT NOT NULL CHECK (value_kind IN ('item', 'currency')),
				object_id TEXT NOT NULL,
				quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 9007199254740991),
				direction TEXT NOT NULL CHECK (direction IN ('in', 'out', 'move', 'destroy', 'create')),
				PRIMARY KEY (event_id, ordinal)
			);
			CREATE INDEX idx_audit_event_values_object
				ON audit_event_values (object_id, event_id);

			CREATE TABLE audit_event_links (
				event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
				relation TEXT NOT NULL CHECK (length(relation) BETWEEN 1 AND 64),
				related_event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
				PRIMARY KEY (event_id, relation, related_event_id),
				CHECK (event_id <> related_event_id)
			);

			CREATE TABLE audit_value_lots (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				created_by_event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
				object_id TEXT NOT NULL,
				original_quantity INTEGER NOT NULL
					CHECK (original_quantity > 0 AND original_quantity <= 9007199254740991)
			);
			CREATE INDEX idx_audit_value_lots_object ON audit_value_lots (object_id, id);

			CREATE TABLE audit_value_lot_positions (
				lot_id INTEGER NOT NULL REFERENCES audit_value_lots (id) ON DELETE RESTRICT,
				position_kind TEXT NOT NULL CHECK (position_kind IN ('charitree', 'gift', 'inbox', 'client')),
				position_key TEXT NOT NULL CHECK (length(position_key) BETWEEN 1 AND 255),
				quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 9007199254740991),
				PRIMARY KEY (lot_id, position_kind, position_key)
			);
			CREATE INDEX idx_audit_value_positions_owner
				ON audit_value_lot_positions (position_kind, position_key, lot_id);

			CREATE TABLE audit_value_movements (
				event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
				ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
				lot_id INTEGER NOT NULL REFERENCES audit_value_lots (id) ON DELETE RESTRICT,
				from_kind TEXT CHECK (from_kind IS NULL OR from_kind IN ('charitree', 'gift', 'inbox', 'client')),
				from_key TEXT,
				to_kind TEXT CHECK (to_kind IS NULL OR to_kind IN ('charitree', 'gift', 'inbox', 'client')),
				to_key TEXT,
				object_id TEXT NOT NULL,
				quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 9007199254740991),
				PRIMARY KEY (event_id, ordinal),
				CHECK ((from_kind IS NULL) = (from_key IS NULL)),
				CHECK ((to_kind IS NULL) = (to_key IS NULL)),
				CHECK (from_kind IS NOT NULL OR to_kind IS NOT NULL)
			);
			CREATE INDEX idx_audit_value_movements_lot ON audit_value_movements (lot_id, event_id);

			CREATE TABLE client_display_name_history (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				client_id INTEGER NOT NULL,
				display_name TEXT NOT NULL,
				valid_from INTEGER,
				valid_to INTEGER,
				changed_by_event_id INTEGER REFERENCES audit_events (id) ON DELETE RESTRICT,
				CHECK (valid_from IS NULL OR valid_from BETWEEN 0 AND 9007199254740991),
				CHECK (valid_to IS NULL OR valid_to BETWEEN 0 AND 9007199254740991),
				CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from)
			);
			CREATE UNIQUE INDEX idx_client_display_name_history_current
				ON client_display_name_history (client_id) WHERE valid_to IS NULL;
			CREATE INDEX idx_client_display_name_history_time
				ON client_display_name_history (client_id, valid_from, id);
			INSERT INTO client_display_name_history (client_id, display_name, valid_from)
			SELECT id, display_name, NULL FROM clients;

			CREATE VIEW audit_event_timeline AS
			SELECT event.id, event.occurred_at, event.event_type, event.actor_kind,
				event.actor_client_id, event.actor_display_name, event.guild_id, event.guild_name,
				event.command_id, event.source_key, event.installation_id, event.client_platform,
				event.app_distribution, event.app_channel, event.app_version, event.app_build,
				event.details_json
			FROM audit_events AS event;
		`
	},
	{
		version: 76,
		sql: `
			CREATE TABLE audit_row_changes (
				event_id INTEGER NOT NULL REFERENCES audit_events (id) ON DELETE RESTRICT,
				ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
				table_name TEXT NOT NULL CHECK (length(table_name) BETWEEN 1 AND 128),
				operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
				row_key_json TEXT NOT NULL CHECK (json_valid(row_key_json) AND json_type(row_key_json) = 'object'),
				before_json TEXT CHECK (before_json IS NULL OR (json_valid(before_json) AND json_type(before_json) = 'object')),
				after_json TEXT CHECK (after_json IS NULL OR (json_valid(after_json) AND json_type(after_json) = 'object')),
				PRIMARY KEY (event_id, ordinal)
			);
			CREATE INDEX idx_audit_row_changes_table_key
				ON audit_row_changes (table_name, row_key_json, event_id);
		`
	},
	{
		version: 77,
		sql: `
			INSERT INTO service_settings (key, value) VALUES ('charity_wish_promo_ends_at', '0');
		`
	},
	{
		version: 78,
		sql: `
			INSERT INTO service_settings (key, value) VALUES
				('charity_wish_promo_started_at', '0'),
				('charity_wish_promo_decay_hours', '0');

			CREATE TABLE charity_decay_activations (
				guild_id INTEGER PRIMARY KEY REFERENCES guilds (id) ON DELETE CASCADE,
				activated_at INTEGER NOT NULL CHECK (activated_at BETWEEN 0 AND 9007199254740991)
			);
			CREATE TRIGGER charity_decay_activation_after_wish_insert
			AFTER INSERT ON charity_wishes
			WHEN NEW.progress_gp < NEW.required_gp
			BEGIN
				INSERT INTO charity_decay_activations (guild_id, activated_at)
				VALUES (NEW.guild_id, NEW.created_at) ON CONFLICT (guild_id) DO NOTHING;
			END;
			CREATE TRIGGER charity_decay_activation_after_wish_update
			AFTER UPDATE OF guild_id, progress_gp, required_gp, created_at ON charity_wishes
			BEGIN
				DELETE FROM charity_decay_activations WHERE guild_id = OLD.guild_id
					AND NOT EXISTS (
						SELECT 1 FROM charity_wishes
						WHERE guild_id = OLD.guild_id AND progress_gp < required_gp
					);
				INSERT INTO charity_decay_activations (guild_id, activated_at)
				SELECT NEW.guild_id, NEW.created_at WHERE NEW.progress_gp < NEW.required_gp
				ON CONFLICT (guild_id) DO NOTHING;
			END;
			CREATE TRIGGER charity_decay_activation_after_wish_delete
			AFTER DELETE ON charity_wishes
			BEGIN
				DELETE FROM charity_decay_activations WHERE guild_id = OLD.guild_id
					AND NOT EXISTS (
						SELECT 1 FROM charity_wishes
						WHERE guild_id = OLD.guild_id AND progress_gp < required_gp
					);
			END;
		`
	},
	{
		version: 79,
		sql: `
			ALTER TABLE guilds ADD COLUMN created_at INTEGER
				CHECK (created_at IS NULL OR created_at BETWEEN 0 AND 9007199254740991);
		`
	},
	{
		version: 80,
		foreign_keys_disabled: true,
		sql: `
			CREATE TABLE guild_raids_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				started_at INTEGER NOT NULL CHECK (started_at >= 0),
				expires_at INTEGER NOT NULL CHECK (expires_at > started_at),
				active_member_count INTEGER NOT NULL CHECK (active_member_count >= 1),
				required_contributors INTEGER NOT NULL CHECK (required_contributors >= 1),
				max_health INTEGER NOT NULL CHECK (max_health > 0),
				remaining_health INTEGER NOT NULL CHECK (remaining_health BETWEEN 0 AND max_health),
				secured_at INTEGER CHECK (secured_at IS NULL OR secured_at >= started_at),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
			);
			INSERT INTO guild_raids_new
				(id, guild_id, started_at, expires_at, active_member_count, required_contributors,
					max_health, remaining_health, secured_at)
			SELECT id, guild_id, started_at, expires_at, active_member_count, required_contributors,
				max_health, remaining_health, secured_at
			FROM guild_raids;
			DROP TABLE guild_raids;
			ALTER TABLE guild_raids_new RENAME TO guild_raids;
			CREATE INDEX idx_guild_raids_guild_started ON guild_raids (guild_id, started_at DESC);
		`
	}
];
