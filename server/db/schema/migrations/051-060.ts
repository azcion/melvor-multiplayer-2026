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
	}, {
		version: 53,
		sql: `
			ALTER TABLE clients ADD COLUMN skills_visible INTEGER NOT NULL DEFAULT 1
				CHECK (skills_visible IN (0, 1));
			ALTER TABLE clients ADD COLUMN activity_visible INTEGER NOT NULL DEFAULT 1
				CHECK (activity_visible IN (0, 1));
			ALTER TABLE clients ADD COLUMN skills_available INTEGER NOT NULL DEFAULT 0
				CHECK (skills_available IN (0, 1));
			ALTER TABLE clients ADD COLUMN activity_available INTEGER NOT NULL DEFAULT 0
				CHECK (activity_available IN (0, 1));
			UPDATE clients SET
				skills_available = EXISTS(SELECT 1 FROM status_snapshot_skills WHERE status_snapshot_skills.client_id = clients.id),
				activity_available = EXISTS(SELECT 1 FROM status_snapshots WHERE status_snapshots.client_id = clients.id);
			UPDATE clients SET skills_visible = status_visible, activity_visible = status_visible;
		`
	}, {
		version: 54,
		sql: `
			CREATE TABLE inbox_items (
				client_id INTEGER NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				PRIMARY KEY (client_id, item_id),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);

			CREATE TABLE inbox_claims (
				id TEXT PRIMARY KEY,
				client_id INTEGER NOT NULL,
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				acknowledged_at INTEGER CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE UNIQUE INDEX idx_inbox_claims_outstanding
				ON inbox_claims (client_id) WHERE acknowledged_at IS NULL;

			CREATE TABLE inbox_claim_items (
				claim_id TEXT NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				PRIMARY KEY (claim_id, item_id),
				FOREIGN KEY (claim_id) REFERENCES inbox_claims (id) ON DELETE CASCADE
			);

			CREATE TRIGGER event_inbox_insert AFTER INSERT ON inbox_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
			CREATE TRIGGER event_inbox_update AFTER UPDATE ON inbox_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1
				WHERE id IN (OLD.client_id, NEW.client_id);
			END;
			CREATE TRIGGER event_inbox_delete AFTER DELETE ON inbox_items BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = OLD.client_id;
			END;
		`
	}, {
		version: 55,
		sql: `
			ALTER TABLE clients ADD COLUMN social_mode TEXT NOT NULL DEFAULT 'full'
				CHECK (social_mode IN ('full', 'social'));
		`
	}, {
		version: 56,
		sql: `
			ALTER TABLE market_items ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0);
			ALTER TABLE market_items ADD COLUMN haggled INTEGER NOT NULL DEFAULT 0 CHECK (haggled >= 0);

			CREATE TABLE market_haggles (
				id TEXT PRIMARY KEY,
				listing_id INTEGER,
				listing_ref INTEGER NOT NULL,
				guild_id INTEGER,
				initiator_id INTEGER NOT NULL,
				owner_id INTEGER NOT NULL,
				direction TEXT NOT NULL CHECK (direction IN ('sell', 'buy')),
				item_id TEXT NOT NULL,
				item_qty INTEGER NOT NULL CHECK (item_qty > 0),
				listing_price INTEGER NOT NULL CHECK (listing_price > 0),
				offer_price INTEGER NOT NULL CHECK (offer_price > 0),
				listing_reserved_gp INTEGER NOT NULL DEFAULT 0 CHECK (listing_reserved_gp >= 0),
				payer_escrow_gp INTEGER NOT NULL DEFAULT 0 CHECK (payer_escrow_gp >= 0),
				turn_client_id INTEGER,
				revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
				status TEXT NOT NULL DEFAULT 'active'
					CHECK (status IN ('active', 'accepted', 'cancelled', 'rejected', 'expired')),
				created_at INTEGER NOT NULL CHECK (created_at >= 0),
				updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
				expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= updated_at),
				terminal_at INTEGER CHECK (terminal_at IS NULL OR terminal_at >= created_at),
				FOREIGN KEY (listing_id) REFERENCES market_items (id) ON DELETE SET NULL,
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE SET NULL,
				FOREIGN KEY (initiator_id) REFERENCES clients (id) ON DELETE CASCADE,
				FOREIGN KEY (owner_id) REFERENCES clients (id) ON DELETE CASCADE,
				FOREIGN KEY (turn_client_id) REFERENCES clients (id) ON DELETE SET NULL,
				CHECK (initiator_id != owner_id),
				CHECK ((status = 'active' AND listing_id IS NOT NULL AND guild_id IS NOT NULL AND turn_client_id IS NOT NULL AND
					expires_at IS NOT NULL AND terminal_at IS NULL) OR
					(status != 'active' AND turn_client_id IS NULL AND expires_at IS NULL AND terminal_at IS NOT NULL)),
				CHECK ((direction = 'sell' AND listing_reserved_gp = 0) OR
					(direction = 'buy' AND listing_reserved_gp = item_qty * listing_price))
			);
			CREATE UNIQUE INDEX idx_market_haggles_active_initiator_listing
				ON market_haggles (initiator_id, listing_ref) WHERE status = 'active';
			CREATE INDEX idx_market_haggles_active_expiry
				ON market_haggles (expires_at) WHERE status = 'active';
			CREATE INDEX idx_market_haggles_participants
				ON market_haggles (initiator_id, owner_id, updated_at DESC);

			CREATE TABLE market_haggle_claims (
				haggle_id TEXT NOT NULL,
				client_id INTEGER NOT NULL,
				item_id TEXT,
				item_qty INTEGER NOT NULL DEFAULT 0 CHECK (item_qty >= 0),
				gp INTEGER NOT NULL DEFAULT 0 CHECK (gp >= 0),
				claimed_at INTEGER CHECK (claimed_at IS NULL OR claimed_at >= 0),
				PRIMARY KEY (haggle_id, client_id),
				FOREIGN KEY (haggle_id) REFERENCES market_haggles (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
				CHECK ((item_qty = 0 AND item_id IS NULL) OR (item_qty > 0 AND item_id IS NOT NULL)),
				CHECK (item_qty > 0 OR gp > 0)
			);

			CREATE TRIGGER event_market_haggle_insert AFTER INSERT ON market_haggles BEGIN
				UPDATE clients SET event_revision = event_revision + 1
					WHERE id IN (NEW.initiator_id, NEW.owner_id);
			END;
			CREATE TRIGGER event_market_haggle_update AFTER UPDATE ON market_haggles BEGIN
				UPDATE clients SET event_revision = event_revision + 1
					WHERE id IN (OLD.initiator_id, OLD.owner_id, NEW.initiator_id, NEW.owner_id);
			END;
			CREATE TRIGGER event_market_haggle_claim_update AFTER UPDATE ON market_haggle_claims BEGIN
				UPDATE clients SET event_revision = event_revision + 1 WHERE id = NEW.client_id;
			END;
		`
	}
];
