import type { Migration } from '../types';

export const migrations_051_060: Migration[] = [
	{
		version: 51,
		sql: `
			ALTER TABLE status_snapshots ADD COLUMN account_creation_date INTEGER
				CHECK (account_creation_date IS NULL OR account_creation_date > 0);
			ALTER TABLE status_snapshots ADD COLUMN total_skill_level INTEGER
				CHECK (total_skill_level IS NULL OR total_skill_level >= 0);
		`
	}, {
		version: 52,
		foreign_keys_disabled: true,
		sql: `
			CREATE TABLE guild_activity_events_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				event_type TEXT NOT NULL CHECK (event_type IN (
					'joined', 'left', 'banished', 'charitree_donated', 'raid_started',
					'raid_boss_defeated', 'raid_completed', 'market_listing_created',
					'market_purchased', 'market_fulfilled',
					'petition_raised', 'petition_carried', 'petition_defeated',
					'campaign_started', 'campaign_completed', 'campaign_contributed'
				)),
				actor_client_id INTEGER,
				actor_display_name TEXT,
				metadata TEXT NOT NULL DEFAULT '{}'
					CHECK (json_valid(metadata) AND json_type(metadata) = 'object'),
				source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 255),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				buyer_client_id INTEGER,
				buyer_display_name TEXT,
				seller_client_id INTEGER,
				seller_display_name TEXT,
				item_id TEXT,
				quantity INTEGER,
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
				UNIQUE (guild_id, source_key),
				CHECK ((actor_client_id IS NULL) = (actor_display_name IS NULL)),
				CHECK ((buyer_client_id IS NULL) = (buyer_display_name IS NULL)),
				CHECK ((seller_client_id IS NULL) = (seller_display_name IS NULL)),
				CHECK ((item_id IS NULL) = (quantity IS NULL)),
				CHECK (quantity IS NULL OR quantity > 0),
				CHECK ((event_type IN ('market_purchased', 'market_fulfilled')) =
					(buyer_client_id IS NOT NULL AND seller_client_id IS NOT NULL AND item_id IS NOT NULL AND quantity IS NOT NULL))
			);
			INSERT INTO guild_activity_events_new
				(id, guild_id, event_type, actor_client_id, actor_display_name, metadata, source_key, created_at)
				SELECT id, guild_id, event_type, actor_client_id, actor_display_name, metadata, source_key, created_at
				FROM guild_activity_events;
			DROP TABLE guild_activity_events;
			ALTER TABLE guild_activity_events_new RENAME TO guild_activity_events;
			CREATE INDEX idx_guild_activity_page
				ON guild_activity_events (guild_id, created_at DESC, id DESC);
			CREATE INDEX idx_guild_activity_throttle
				ON guild_activity_events (guild_id, actor_client_id, event_type, created_at DESC);
			CREATE INDEX idx_guild_activity_private_buyer
				ON guild_activity_events (guild_id, buyer_client_id, created_at DESC, id DESC);
			CREATE INDEX idx_guild_activity_private_seller
				ON guild_activity_events (guild_id, seller_client_id, created_at DESC, id DESC);
		`
	}
];
