import type { Migration } from '../types';

export const migrations_041_050: Migration[] = [
	{
		version: 41,
		sql: `
			CREATE TABLE icon_catalog_blobs (
				content_hash TEXT PRIMARY KEY
					CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
				bytes BLOB NOT NULL CHECK (length(bytes) > 0),
				media_type TEXT NOT NULL CHECK (media_type IN (
					'image/svg+xml', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'
				)),
				byte_length INTEGER NOT NULL CHECK (byte_length > 0),
				first_seen_at INTEGER NOT NULL CHECK (first_seen_at >= 0),
				last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= first_seen_at),
				CHECK (byte_length = length(bytes))
			);

			CREATE TABLE icon_catalog_observations (
				kind TEXT NOT NULL CHECK (kind = 'skill'),
				object_id TEXT NOT NULL CHECK (
					length(object_id) BETWEEN 3 AND 256 AND
					instr(object_id, ':') > 0 AND
					instr(object_id, ':') < length(object_id)
				),
				content_hash TEXT NOT NULL,
				first_seen_at INTEGER NOT NULL CHECK (first_seen_at >= 0),
				last_seen_at INTEGER NOT NULL CHECK (last_seen_at >= first_seen_at),
				PRIMARY KEY (kind, object_id, content_hash),
				FOREIGN KEY (content_hash) REFERENCES icon_catalog_blobs (content_hash) ON DELETE RESTRICT
			);
			CREATE INDEX idx_icon_catalog_observations_object
				ON icon_catalog_observations (kind, object_id, last_seen_at DESC);
			CREATE INDEX idx_icon_catalog_observations_hash
				ON icon_catalog_observations (content_hash);
		`
	}, {
		version: 42,
		sql: `
			INSERT INTO service_settings (key, value) VALUES ('icon_collection_enabled', '1');
		`
	}, {
		version: 43,
		sql: `
			INSERT INTO service_settings (key, value) VALUES
				('icon_collection_max_icon_bytes', '1048576'),
				('icon_collection_max_manifest_items', '64'),
				('icon_collection_max_catalog_bytes', '268435456'),
				('icon_collection_max_observations', '16384');
		`
	}, {
		version: 44,
		sql: `
			CREATE TABLE guild_activity_events (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				event_type TEXT NOT NULL CHECK (event_type IN (
					'joined', 'left', 'banished', 'charitree_donated', 'raid_started',
					'raid_boss_defeated', 'raid_completed', 'market_listing_created',
					'petition_raised', 'petition_carried', 'petition_defeated',
					'campaign_started', 'campaign_completed', 'campaign_contributed'
				)),
				actor_client_id INTEGER,
				actor_display_name TEXT,
				metadata TEXT NOT NULL DEFAULT '{}'
					CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
				source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 255),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
				UNIQUE (guild_id, source_key),
				CHECK ((actor_client_id IS NULL) = (actor_display_name IS NULL))
			);
			CREATE INDEX idx_guild_activity_page
				ON guild_activity_events (guild_id, created_at DESC, id DESC);
			CREATE INDEX idx_guild_activity_throttle
				ON guild_activity_events (guild_id, actor_client_id, event_type, created_at DESC);
		`
	}, {
		version: 45,
		sql: `
			ALTER TABLE client_runtime_snapshots ADD COLUMN language TEXT
				CHECK (language IS NULL OR length(language) <= 64);
		`
	}, {
		version: 46,
		sql: `
			CREATE TABLE market_items_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				direction TEXT NOT NULL DEFAULT 'sell' CHECK (direction IN ('sell', 'buy')),
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				available INTEGER NOT NULL CHECK (available >= 0),
				price INTEGER NOT NULL CHECK (price > 0),
				payout INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
				escrow_gp INTEGER NOT NULL DEFAULT 0 CHECK (escrow_gp >= 0),
				UNIQUE (guild_id, client_id, direction, item_id, price),
				CHECK ((direction = 'sell' AND escrow_gp = 0) OR
					(direction = 'buy' AND payout = 0)),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			INSERT INTO market_items_new
				(id, guild_id, client_id, direction, item_id, qty, available, price, payout, escrow_gp)
				SELECT id, guild_id, client_id, 'sell', item_id, qty, available, price, payout, 0
				FROM market_items;
			DROP TABLE market_items;
			ALTER TABLE market_items_new RENAME TO market_items;
			CREATE INDEX idx_market_items_guild_direction_item
				ON market_items (guild_id, direction, item_id);
			CREATE INDEX idx_market_items_guild_direction_price
				ON market_items (guild_id, direction, price);
			CREATE INDEX idx_market_items_guild_direction_item_price
				ON market_items (guild_id, direction, item_id, price);

			CREATE TRIGGER event_market_insert AFTER INSERT ON market_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_market_update AFTER UPDATE ON market_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id IN (OLD.client_id, NEW.client_id);
			END;
			CREATE TRIGGER event_market_delete AFTER DELETE ON market_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id;
			END;
		`
	}
];
