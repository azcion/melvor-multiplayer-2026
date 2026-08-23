import type { Migration } from '../types';

export const migrations_031_040: Migration[] = [
	{
		version: 31,
		sql: `
			CREATE TABLE gift_items_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				gift_id INTEGER NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				FOREIGN KEY (gift_id) REFERENCES gifts (gift_id) ON DELETE CASCADE
			);
			INSERT INTO gift_items_new (id, gift_id, item_id, qty)
				SELECT id, gift_id, item_id, qty FROM gift_items WHERE qty > 0;
			DROP TABLE gift_items;
			ALTER TABLE gift_items_new RENAME TO gift_items;
			CREATE INDEX idx_gift_items_gift_id ON gift_items (gift_id);

			CREATE TABLE trade_items_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				trade_id INTEGER NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				counter INTEGER NOT NULL
			);
			INSERT INTO trade_items_new (id, trade_id, item_id, qty, counter)
				SELECT id, trade_id, item_id, qty, counter FROM trade_items WHERE qty > 0;
			DROP TABLE trade_items;
			ALTER TABLE trade_items_new RENAME TO trade_items;
			CREATE INDEX idx_trade_items_trade_id ON trade_items (trade_id);

			CREATE TABLE market_items_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				guild_id INTEGER NOT NULL,
				client_id INTEGER NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				available INTEGER NOT NULL CHECK (available >= 0),
				price INTEGER NOT NULL CHECK (price > 0),
				payout INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
				UNIQUE (guild_id, client_id, item_id, price),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			INSERT INTO market_items_new (id, guild_id, client_id, item_id, qty, available, price, payout)
				SELECT id, guild_id, client_id, item_id, qty, available, price, payout
				FROM market_items WHERE qty > 0 AND price > 0;
			DROP TABLE market_items;
			ALTER TABLE market_items_new RENAME TO market_items;
			CREATE INDEX idx_market_items_guild_item ON market_items (guild_id, item_id);
			CREATE INDEX idx_market_items_guild_price ON market_items (guild_id, price);
			CREATE INDEX idx_market_items_guild_item_price ON market_items (guild_id, item_id, price);

			CREATE TABLE charity_items_new (
				guild_id INTEGER NOT NULL,
				item_id TEXT NOT NULL,
				qty INTEGER NOT NULL CHECK (qty > 0),
				expires_at INTEGER NOT NULL CHECK (expires_at >= 0),
				PRIMARY KEY (guild_id, item_id),
				FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
			);
			INSERT INTO charity_items_new (guild_id, item_id, qty, expires_at)
				SELECT guild_id, item_id, qty, expires_at FROM charity_items WHERE qty > 0;
			DROP TABLE charity_items;
			ALTER TABLE charity_items_new RENAME TO charity_items;
			CREATE INDEX idx_charity_items_expiry ON charity_items (expires_at);
		`
	}, {
		version: 32,
		sql: `
			CREATE TABLE friends_new (
				client_id_a INTEGER NOT NULL,
				client_id_b INTEGER NOT NULL,
				PRIMARY KEY (client_id_a, client_id_b),
				CHECK (client_id_a < client_id_b),
				FOREIGN KEY (client_id_a) REFERENCES clients (id) ON DELETE CASCADE,
				FOREIGN KEY (client_id_b) REFERENCES clients (id) ON DELETE CASCADE
			);
			INSERT INTO friends_new (client_id_a, client_id_b)
				SELECT MIN(client_id_a, client_id_b), MAX(client_id_a, client_id_b)
				FROM friends
				WHERE client_id_a <> client_id_b
				GROUP BY MIN(client_id_a, client_id_b), MAX(client_id_a, client_id_b);
			DROP TABLE friends;
			ALTER TABLE friends_new RENAME TO friends;
			CREATE INDEX idx_friends_client_id_b ON friends (client_id_b);
		`
	}, {
		version: 33,
		sql: `
			CREATE TABLE campaign_completions (
				source_campaign_state_id INTEGER NOT NULL CHECK (source_campaign_state_id > 0),
				source_guild_id INTEGER NOT NULL CHECK (source_guild_id > 0),
				client_id INTEGER NOT NULL,
				campaign_id TEXT NOT NULL,
				item_id TEXT NOT NULL,
				item_amount INTEGER NOT NULL CHECK (item_amount >= 0),
				taken INTEGER NOT NULL DEFAULT 0 CHECK (taken >= 0),
				PRIMARY KEY (source_campaign_state_id, client_id),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
			CREATE INDEX idx_campaign_completions_client
				ON campaign_completions (client_id, source_campaign_state_id DESC);

			INSERT INTO campaign_completions (
				source_campaign_state_id, source_guild_id, client_id, campaign_id, item_id, item_amount, taken
			)
			SELECT state.id, state.guild_id, contribution.client_id, state.campaign_id, state.item_id,
				contribution.item_amount, contribution.taken
			FROM campaign_contributions AS contribution
			JOIN campaign_state AS state ON state.id = contribution.campaign_id
			WHERE state.complete = 1
			ORDER BY state.id, contribution.client_id;
		`
	}, {
		version: 34,
		sql: `
			ALTER TABLE client_sessions ADD COLUMN mod_version TEXT
				CHECK (mod_version IS NULL OR length(mod_version) BETWEEN 1 AND 64);

			CREATE TABLE client_runtime_snapshots (
				client_id INTEGER PRIMARY KEY,
				mod_version TEXT NOT NULL CHECK (length(mod_version) BETWEEN 1 AND 64),
				active_mods TEXT NOT NULL CHECK (length(active_mods) <= 65536),
				reported_at INTEGER NOT NULL CHECK (reported_at >= 0),
				FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
			);
		`
	}, {
		version: 35,
		sql: `
			INSERT INTO service_settings (key, value) VALUES ('released_mod_version', '');
		`
	}, {
		version: 36,
		sql: `
			ALTER TABLE client_runtime_snapshots ADD COLUMN game_mode_id TEXT
				CHECK (game_mode_id IS NULL OR length(game_mode_id) BETWEEN 1 AND 256);
		`
	}, {
		version: 37,
		sql: `
			ALTER TABLE clients ADD COLUMN game_mode_visible INTEGER NOT NULL DEFAULT 1
				CHECK (game_mode_visible IN (0, 1));
		`
	}, {
		version: 38,
		sql: `
			ALTER TABLE clients ADD COLUMN active_mods_visible INTEGER NOT NULL DEFAULT 1
				CHECK (active_mods_visible IN (0, 1));
		`
	}, {
		version: 39,
		sql: `
			ALTER TABLE support_teams ADD COLUMN required_active_mod_name TEXT
				CHECK (required_active_mod_name IS NULL OR length(required_active_mod_name) BETWEEN 1 AND 128);
			ALTER TABLE support_teams ADD COLUMN minimum_client_version TEXT
				CHECK (minimum_client_version IS NULL OR length(minimum_client_version) BETWEEN 1 AND 64);

			INSERT INTO support_teams (
				system_key, display_name, inbox_label, icon_id, welcome_content, created_at,
				required_active_mod_name, minimum_client_version
			) VALUES (
				'super_awesome_expansion', 'SAE Support Team', 'SAE', 'sae_support',
				'Welcome to SUPER AWESOME EXPANSION!\n\nThis is an automated message from EdwinNarwhal, beep boop. Do you have a question, concern, or suggestion? This is the place to voice it! Just reply to this message, here. I look forward to hearing from you!',
				0, 'SUPER AWESOME EXPANSION', '1.3.4'
			);
		`
	}, {
		version: 40,
		sql: `
			ALTER TABLE status_snapshots ADD COLUMN activities TEXT NOT NULL DEFAULT '[]'
				CHECK (length(activities) <= 16384);
			UPDATE status_snapshots SET activities = CASE
				WHEN activity_type = 'skill' THEN
					'[{"type":"skill","skill_id":"' || activity_skill_id ||
					'","action_id":"' || activity_action_id || '"}]'
				WHEN activity_type = 'combat' AND activity_area_id IS NULL THEN
					'[{"type":"combat","area_id":null}]'
				WHEN activity_type = 'combat' THEN
					'[{"type":"combat","area_id":"' || activity_area_id || '"}]'
				ELSE '[]'
			END;
		`
	}
];
