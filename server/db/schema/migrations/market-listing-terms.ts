import type { Migration } from '../types';

export const market_listing_terms_migration: Migration = {
	version: 166,
	foreign_keys_disabled: true,
	sql: `
		CREATE TEMP TABLE market_sequence AS SELECT seq FROM sqlite_sequence WHERE name='market_items';
		CREATE TABLE market_items_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
			direction TEXT NOT NULL DEFAULT 'sell' CHECK(direction IN ('sell','buy')),
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 9007199254740991),
			available INTEGER NOT NULL CHECK(available BETWEEN 0 AND 9007199254740991),
			price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 9007199254740991),
			payout INTEGER NOT NULL DEFAULT 0 CHECK(payout BETWEEN 0 AND 9007199254740991),
			escrow_gp INTEGER NOT NULL DEFAULT 0 CHECK(escrow_gp BETWEEN 0 AND 9007199254740991),
			published_at INTEGER NOT NULL DEFAULT 0 CHECK(published_at >= 0),
			reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
			haggled INTEGER NOT NULL DEFAULT 0 CHECK(haggled >= 0),
			updated_at INTEGER CHECK(updated_at IS NULL OR updated_at >= 0),
			currency_id TEXT NOT NULL DEFAULT 'melvorD:GP' CHECK(currency_id IN
				('melvorD:GP','melvorD:SlayerCoins','melvorItA:AbyssalPieces','melvorItA:AbyssalSlayerCoins')),
			alliance_price INTEGER NOT NULL DEFAULT 0 CHECK(alliance_price BETWEEN 0 AND 9007199254740991),
			purchase_limit INTEGER NOT NULL DEFAULT 0 CHECK(purchase_limit BETWEEN 0 AND 9007199254740991),
			allow_haggles INTEGER NOT NULL DEFAULT 1 CHECK(allow_haggles IN (0,1)),
			price_adjustment INTEGER NOT NULL DEFAULT 0 CHECK(price_adjustment BETWEEN -9007199254740991 AND 9007199254740991),
			UNIQUE(guild_id,client_id,direction,item_id,price,currency_id,alliance_price,purchase_limit,allow_haggles),
			CHECK((direction='sell' AND escrow_gp=0) OR (direction='buy' AND payout=0)),
			CHECK(direction='sell' OR (currency_id='melvorD:GP' AND alliance_price=0 AND purchase_limit=0 AND allow_haggles=1))
		);
		INSERT INTO market_items_new(id,guild_id,client_id,direction,item_id,qty,available,price,payout,
			escrow_gp,published_at,reserved,haggled,updated_at)
		SELECT id,guild_id,client_id,direction,item_id,qty,available,price,payout,
			escrow_gp,published_at,reserved,haggled,updated_at FROM market_items;
		DROP TABLE market_items;
		ALTER TABLE market_items_new RENAME TO market_items;
		UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM market_sequence),0)) WHERE name='market_items';
		DROP TABLE market_sequence;
		CREATE INDEX idx_market_items_guild_direction_item ON market_items(guild_id,direction,item_id);
		CREATE INDEX idx_market_items_guild_direction_price ON market_items(guild_id,direction,price);
		CREATE INDEX idx_market_items_guild_direction_item_price ON market_items(guild_id,direction,item_id,price);
		CREATE INDEX idx_market_items_guild_direction_published ON market_items(guild_id,direction,published_at DESC,id DESC);
		CREATE INDEX idx_market_items_guild_direction_updated ON market_items(guild_id,direction,updated_at DESC,id DESC);
		CREATE TRIGGER event_market_insert AFTER INSERT ON market_items BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=NEW.client_id;
		END;
		CREATE TRIGGER event_market_update AFTER UPDATE ON market_items BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id IN (OLD.client_id,NEW.client_id);
		END;
		CREATE TRIGGER event_market_delete AFTER DELETE ON market_items BEGIN
			UPDATE clients SET event_revision=event_revision+1 WHERE id=OLD.client_id;
		END;
		ALTER TABLE market_haggles ADD COLUMN currency_id TEXT NOT NULL DEFAULT 'melvorD:GP' CHECK(currency_id IN
			('melvorD:GP','melvorD:SlayerCoins','melvorItA:AbyssalPieces','melvorItA:AbyssalSlayerCoins'));
		CREATE TABLE market_purchases (
			listing_id INTEGER NOT NULL REFERENCES market_items(id) ON DELETE CASCADE,
			owner_key TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK(qty BETWEEN 1 AND 9007199254740991),
			PRIMARY KEY(listing_id,owner_key)
		);
		CREATE TRIGGER market_purchase_account_link AFTER UPDATE OF melvor_account_id ON clients
		WHEN OLD.melvor_account_id IS NULL AND NEW.melvor_account_id IS NOT NULL BEGIN
			INSERT INTO market_purchases(listing_id,owner_key,qty)
			SELECT listing_id,'account:' || NEW.melvor_account_id,qty FROM market_purchases
			WHERE owner_key='client:' || NEW.id
			ON CONFLICT(listing_id,owner_key) DO UPDATE SET qty=qty+excluded.qty;
			DELETE FROM market_purchases WHERE owner_key='client:' || NEW.id;
		END;
		-- Retain historical GP snapshots; new snapshots use the Haggle's immutable currency.
		CREATE TRIGGER history_market_currency AFTER INSERT ON transfer_history_items
		WHEN NEW.ordinal=1 AND NEW.item_id='melvorD:GP' BEGIN
			UPDATE transfer_history_items SET item_id=COALESCE((
				SELECT m.currency_id FROM market_haggles m JOIN transfer_history_events e ON e.id=NEW.event_id
				WHERE e.pane='pending' AND ((e.source_key LIKE 'haggle:%' AND m.id=substr(e.source_key,8,36))
				OR (e.source_key LIKE 'haggle-claim:%' AND m.id=substr(e.source_key,14,36)))
			),'melvorD:GP') WHERE event_id=NEW.event_id AND ordinal=NEW.ordinal;
		END;
	`
};
