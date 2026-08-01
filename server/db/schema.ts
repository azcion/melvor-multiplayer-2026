type Migration = {
	version: number;
	sql: string;
};

export const migrations: Migration[] = [{
	version: 1,
	sql: `
		CREATE TABLE clients (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_identifier TEXT NOT NULL UNIQUE,
			client_key TEXT NOT NULL,
			friend_code TEXT NOT NULL UNIQUE,
			display_name TEXT NOT NULL,
			icon_id TEXT NOT NULL,
			last_charity INTEGER NOT NULL DEFAULT 0,
			last_bonus_charity INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE client_sessions (
			session_token TEXT PRIMARY KEY,
			client_id INTEGER NOT NULL,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_client_sessions_client_id ON client_sessions (client_id);

		CREATE TABLE friend_requests (
			request_id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL,
			friend_id INTEGER NOT NULL,
			UNIQUE (client_id, friend_id),
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (friend_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_friend_requests_friend_id ON friend_requests (friend_id);

		CREATE TABLE friends (
			client_id_a INTEGER NOT NULL,
			client_id_b INTEGER NOT NULL,
			PRIMARY KEY (client_id_a, client_id_b),
			FOREIGN KEY (client_id_a) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (client_id_b) REFERENCES clients (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_friends_client_id_b ON friends (client_id_b);

		CREATE TABLE gifts (
			gift_id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL,
			sender_id INTEGER NOT NULL,
			flags INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (sender_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_gifts_client_id ON gifts (client_id);

		CREATE TABLE gift_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			gift_id INTEGER NOT NULL,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty >= 0),
			FOREIGN KEY (gift_id) REFERENCES gifts (gift_id) ON DELETE CASCADE
		);
		CREATE INDEX idx_gift_items_gift_id ON gift_items (gift_id);

		CREATE TABLE trade_offers (
			trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
			sender_id INTEGER NOT NULL,
			recipient_id INTEGER NOT NULL,
			attending_id INTEGER NOT NULL,
			state INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (sender_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (recipient_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (attending_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_trade_offers_sender_id ON trade_offers (sender_id);
		CREATE INDEX idx_trade_offers_recipient_id ON trade_offers (recipient_id);

		CREATE TABLE resolved_trade_offers (
			trade_id INTEGER PRIMARY KEY,
			client_id INTEGER NOT NULL,
			sender_id INTEGER NOT NULL,
			declined INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (sender_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_resolved_trade_offers_client_id ON resolved_trade_offers (client_id);

		CREATE TABLE trade_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			trade_id INTEGER NOT NULL,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty >= 0),
			counter INTEGER NOT NULL
		);
		CREATE INDEX idx_trade_items_trade_id ON trade_items (trade_id);

		CREATE TABLE market_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty >= 0),
			available INTEGER NOT NULL CHECK (available >= 0),
			price INTEGER NOT NULL CHECK (price >= 0),
			payout INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
			UNIQUE (client_id, item_id, price),
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_market_items_item_id ON market_items (item_id);
		CREATE INDEX idx_market_items_price ON market_items (price);
		CREATE INDEX idx_market_items_item_id_price ON market_items (item_id, price);

		CREATE TABLE charity_items (
			item_id TEXT PRIMARY KEY,
			qty INTEGER NOT NULL CHECK (qty >= 0)
		);

		CREATE TABLE campaign_state (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			campaign_id TEXT NOT NULL,
			item_id TEXT NOT NULL,
			item_amount INTEGER NOT NULL CHECK (item_amount >= 0),
			item_current INTEGER NOT NULL DEFAULT 0 CHECK (item_current >= 0),
			complete INTEGER NOT NULL DEFAULT 0,
			campaign_next INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE campaign_contributions (
			campaign_id INTEGER NOT NULL,
			client_id INTEGER NOT NULL,
			item_amount INTEGER NOT NULL DEFAULT 0 CHECK (item_amount >= 0),
			taken INTEGER NOT NULL DEFAULT 0 CHECK (taken >= 0),
			PRIMARY KEY (campaign_id, client_id),
			FOREIGN KEY (campaign_id) REFERENCES campaign_state (id) ON DELETE CASCADE,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);
	`
}, {
	version: 2,
	sql: `
		CREATE TABLE guilds (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			icon_id TEXT NOT NULL
		);

		CREATE TABLE guild_memberships (
			client_id INTEGER PRIMARY KEY,
			guild_id INTEGER NOT NULL,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_guild_memberships_guild_id ON guild_memberships (guild_id);

		CREATE TABLE guild_applications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL UNIQUE,
			guild_id INTEGER NOT NULL,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_guild_applications_guild_id ON guild_applications (guild_id);
	`
}, {
	version: 3,
	sql: `
		ALTER TABLE market_items RENAME TO market_items_legacy;

		CREATE TABLE market_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL,
			client_id INTEGER NOT NULL,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty >= 0),
			available INTEGER NOT NULL CHECK (available >= 0),
			price INTEGER NOT NULL CHECK (price >= 0),
			payout INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
			UNIQUE (guild_id, client_id, item_id, price),
			FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		INSERT INTO market_items (id, guild_id, client_id, item_id, qty, available, price, payout)
			SELECT old.id, membership.guild_id, old.client_id, old.item_id, old.qty, old.available, old.price, old.payout
			FROM market_items_legacy AS old
			JOIN guild_memberships AS membership ON membership.client_id = old.client_id;
		DROP TABLE market_items_legacy;
		CREATE INDEX idx_market_items_guild_item ON market_items (guild_id, item_id);
		CREATE INDEX idx_market_items_guild_price ON market_items (guild_id, price);
		CREATE INDEX idx_market_items_guild_item_price ON market_items (guild_id, item_id, price);

		DROP TABLE charity_items;
		CREATE TABLE charity_items (
			guild_id INTEGER NOT NULL,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty >= 0),
			PRIMARY KEY (guild_id, item_id),
			FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
		);
	`
}, {
	version: 4,
	sql: `
		DROP TABLE campaign_contributions;
		DROP TABLE campaign_state;

		CREATE TABLE campaign_state (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL,
			campaign_id TEXT NOT NULL,
			item_id TEXT NOT NULL,
			item_amount INTEGER NOT NULL CHECK (item_amount >= 0),
			item_current INTEGER NOT NULL DEFAULT 0 CHECK (item_current >= 0),
			complete INTEGER NOT NULL DEFAULT 0,
			campaign_next INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
		);
		CREATE INDEX idx_campaign_state_guild_id ON campaign_state (guild_id, id);

		CREATE TABLE campaign_contributions (
			campaign_id INTEGER NOT NULL,
			client_id INTEGER NOT NULL,
			item_amount INTEGER NOT NULL DEFAULT 0 CHECK (item_amount >= 0),
			taken INTEGER NOT NULL DEFAULT 0 CHECK (taken >= 0),
			PRIMARY KEY (campaign_id, client_id),
			FOREIGN KEY (campaign_id) REFERENCES campaign_state (id) ON DELETE CASCADE,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);
	`
}, {
	version: 5,
	sql: `
		ALTER TABLE campaign_state ADD COLUMN required_contributors INTEGER NOT NULL DEFAULT 4
			CHECK (required_contributors >= 1);
		ALTER TABLE campaign_state ADD COLUMN auto_contribution INTEGER NOT NULL DEFAULT 0
			CHECK (auto_contribution >= 0);

		UPDATE campaign_state
		SET auto_contribution = MAX(
			item_current - COALESCE((
				SELECT SUM(item_amount)
				FROM campaign_contributions
				WHERE campaign_contributions.campaign_id = campaign_state.id
			), 0),
			0
		);
	`
}, {
	version: 6,
	sql: `
		ALTER TABLE clients ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1));

		CREATE TABLE service_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
		INSERT INTO service_settings (key, value) VALUES
			('maintenance', '0'),
			('registrations_open', '1'),
			('max_identities', '256');
	`
}, {
	version: 7,
	sql: `
		ALTER TABLE guild_memberships RENAME TO guild_memberships_legacy;

		CREATE TABLE guild_memberships (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			client_id INTEGER NOT NULL UNIQUE,
			guild_id INTEGER NOT NULL,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE,
			FOREIGN KEY (guild_id) REFERENCES guilds (id) ON DELETE CASCADE
		);
		INSERT INTO guild_memberships (client_id, guild_id)
			SELECT client_id, guild_id FROM guild_memberships_legacy;
		DROP TABLE guild_memberships_legacy;
		CREATE INDEX idx_guild_memberships_guild_id ON guild_memberships (guild_id);

		CREATE TABLE guild_petitions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL,
			guild_name TEXT NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('appellation', 'heraldry', 'banishment')),
			conflict_subject TEXT NOT NULL,
			subject_locked INTEGER NOT NULL DEFAULT 1 CHECK (subject_locked IN (0, 1)),
			petitioner_id INTEGER NOT NULL,
			proposed_name TEXT,
			proposed_icon_id TEXT,
			target_client_id INTEGER,
			target_membership_id INTEGER,
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			expires_at INTEGER NOT NULL CHECK (expires_at >= created_at),
			resolved_at INTEGER CHECK (resolved_at IS NULL OR resolved_at >= created_at),
			lifecycle TEXT NOT NULL DEFAULT 'active'
				CHECK (lifecycle IN ('active', 'granted', 'denied', 'lapsed', 'withdrawn')),
			execution_state TEXT NOT NULL DEFAULT 'not_applicable'
				CHECK (execution_state IN ('not_applicable', 'pending', 'running', 'succeeded', 'failed')),
			execution_attempts INTEGER NOT NULL DEFAULT 0 CHECK (execution_attempts >= 0),
			execution_last_attempt_at INTEGER CHECK (execution_last_attempt_at IS NULL OR execution_last_attempt_at >= 0),
			execution_failure_category TEXT,
			execution_failure_message TEXT,
			execution_effect TEXT,
			CHECK (
				(type = 'appellation' AND proposed_name IS NOT NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL) OR
				(type = 'heraldry' AND proposed_name IS NULL AND proposed_icon_id IS NOT NULL
					AND target_client_id IS NULL AND target_membership_id IS NULL) OR
				(type = 'banishment' AND proposed_name IS NULL AND proposed_icon_id IS NULL
					AND target_client_id IS NOT NULL AND target_membership_id IS NOT NULL)
			),
			FOREIGN KEY (petitioner_id) REFERENCES clients (id),
			FOREIGN KEY (target_client_id) REFERENCES clients (id)
		);
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

		CREATE TABLE guild_petition_voters (
			petition_id INTEGER NOT NULL,
			client_id INTEGER NOT NULL,
			PRIMARY KEY (petition_id, client_id),
			FOREIGN KEY (petition_id) REFERENCES guild_petitions (id) ON DELETE CASCADE,
			FOREIGN KEY (client_id) REFERENCES clients (id)
		);

		CREATE TABLE guild_petition_votes (
			petition_id INTEGER NOT NULL,
			client_id INTEGER NOT NULL,
			choice TEXT NOT NULL CHECK (choice IN ('aye', 'nay')),
			submitted_at INTEGER NOT NULL CHECK (submitted_at >= 0),
			PRIMARY KEY (petition_id, client_id),
			FOREIGN KEY (petition_id, client_id)
				REFERENCES guild_petition_voters (petition_id, client_id) ON DELETE CASCADE
		);
		CREATE INDEX idx_guild_petition_votes_petition_choice
			ON guild_petition_votes (petition_id, choice);
	`
}, {
	version: 8,
	sql: `
		CREATE TABLE banishment_returns (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			petition_id INTEGER NOT NULL,
			client_id INTEGER NOT NULL,
			guild_id INTEGER NOT NULL,
			guild_name TEXT NOT NULL,
			notice_pending INTEGER NOT NULL DEFAULT 0 CHECK (notice_pending IN (0, 1)),
			gp INTEGER NOT NULL DEFAULT 0 CHECK (gp >= 0),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= created_at),
			UNIQUE (petition_id, client_id),
			FOREIGN KEY (petition_id) REFERENCES guild_petitions (id),
			FOREIGN KEY (client_id) REFERENCES clients (id)
		);
		CREATE INDEX idx_banishment_returns_client
			ON banishment_returns (client_id, completed_at, id);

		CREATE TABLE banishment_return_items (
			return_id INTEGER NOT NULL,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0),
			PRIMARY KEY (return_id, item_id),
			FOREIGN KEY (return_id) REFERENCES banishment_returns (id) ON DELETE CASCADE
		);

		CREATE TABLE banishment_return_claims (
			id TEXT PRIMARY KEY,
			return_id INTEGER NOT NULL,
			client_id INTEGER NOT NULL,
			gp INTEGER NOT NULL DEFAULT 0 CHECK (gp >= 0),
			includes_notice INTEGER NOT NULL DEFAULT 0 CHECK (includes_notice IN (0, 1)),
			created_at INTEGER NOT NULL CHECK (created_at >= 0),
			acknowledged_at INTEGER CHECK (acknowledged_at IS NULL OR acknowledged_at >= created_at),
			FOREIGN KEY (return_id) REFERENCES banishment_returns (id),
			FOREIGN KEY (client_id) REFERENCES clients (id)
		);
		CREATE UNIQUE INDEX idx_banishment_return_claims_outstanding
			ON banishment_return_claims (client_id) WHERE acknowledged_at IS NULL;

		CREATE TABLE banishment_return_claim_items (
			claim_id TEXT NOT NULL,
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0),
			PRIMARY KEY (claim_id, item_id),
			FOREIGN KEY (claim_id) REFERENCES banishment_return_claims (id) ON DELETE CASCADE
		);
	`
	}, {
		version: 9,
		sql: `
		ALTER TABLE clients ADD COLUMN equipment_visible INTEGER NOT NULL DEFAULT 1
			CHECK (equipment_visible IN (0, 1));

		CREATE TABLE equipment_snapshots (
			client_id INTEGER PRIMARY KEY,
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);

		CREATE TABLE equipment_snapshot_items (
			client_id INTEGER NOT NULL,
			slot_id TEXT NOT NULL,
			item_id TEXT NOT NULL,
			PRIMARY KEY (client_id, slot_id),
			FOREIGN KEY (client_id) REFERENCES equipment_snapshots (client_id) ON DELETE CASCADE
		);
		`
	}, {
		version: 10,
		sql: `
			ALTER TABLE guilds ADD COLUMN type TEXT NOT NULL DEFAULT 'private'
				CHECK (type IN ('private', 'free_fellowship'));

			CREATE UNIQUE INDEX idx_guilds_free_fellowship
				ON guilds (type) WHERE type = 'free_fellowship';

			INSERT INTO guilds (type, name, icon_id)
			SELECT 'free_fellowship', 'Free Fellowship', 'multiplayer'
			WHERE NOT EXISTS (SELECT 1 FROM guilds WHERE type = 'free_fellowship');
		`
	}];
