import type { Migration } from '../types';

export const migrations_061_070: Migration[] = [{
	version: 61,
	sql: `
		ALTER TABLE charity_items ADD COLUMN donated_at INTEGER NOT NULL DEFAULT 0
			CHECK (donated_at BETWEEN 0 AND 9007199254740991);
		UPDATE charity_items SET donated_at = MAX(0, expires_at - 345600000);
		CREATE TABLE charity_shuffles (
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			owner_key TEXT NOT NULL,
			shuffled_at INTEGER NOT NULL CHECK (shuffled_at BETWEEN 0 AND 9007199254740991),
			PRIMARY KEY (guild_id, owner_key)
		);
		CREATE TABLE charity_currency_locks (
			guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
			owner_key TEXT NOT NULL,
			currency_id TEXT NOT NULL,
			locked_until INTEGER NOT NULL CHECK (locked_until BETWEEN 0 AND 9007199254740991),
			PRIMARY KEY (guild_id, owner_key, currency_id)
		);
	`
}, {
	version: 62,
	sql: `
		CREATE TABLE charity_shuffle_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			owner_key TEXT NOT NULL,
			shuffled_at INTEGER NOT NULL CHECK (shuffled_at BETWEEN 0 AND 9007199254740991)
		);
		CREATE INDEX idx_charity_shuffle_events_owner_time ON charity_shuffle_events (owner_key, shuffled_at);
	`
}, {
	version: 63,
	sql: `
		CREATE TABLE inbox_items_new (
			client_id INTEGER NOT NULL,
			source_type TEXT NOT NULL DEFAULT 'other',
			source_name TEXT NOT NULL DEFAULT '',
			item_id TEXT NOT NULL,
			qty INTEGER NOT NULL CHECK (qty > 0),
			created_at INTEGER CHECK (created_at IS NULL OR created_at >= 0),
			updated_at INTEGER CHECK (updated_at IS NULL OR updated_at >= 0),
			PRIMARY KEY (client_id, source_type, source_name, item_id),
			FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
		);
		INSERT INTO inbox_items_new
			(client_id, source_type, source_name, item_id, qty, created_at, updated_at)
		SELECT client_id, 'other', '', item_id, qty, created_at, updated_at FROM inbox_items;
		DROP TABLE inbox_items;
		ALTER TABLE inbox_items_new RENAME TO inbox_items;
		CREATE INDEX idx_inbox_items_pending_created
			ON inbox_items (created_at, client_id, source_type, source_name, item_id);
		CREATE INDEX idx_inbox_items_pending_updated
			ON inbox_items (updated_at, client_id, source_type, source_name, item_id);
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
	version: 64,
	sql: `
		ALTER TABLE charity_items ADD COLUMN value_currency_id TEXT;
		ALTER TABLE charity_items ADD COLUMN value_per_item INTEGER
			CHECK (value_per_item IS NULL OR value_per_item BETWEEN 0 AND 9007199254740991);
		INSERT INTO service_settings (key, value)
			SELECT 'charity_value_backfill_pending', CASE WHEN EXISTS(SELECT 1 FROM charity_items) THEN '1' ELSE '0' END;
		UPDATE charity_items SET expires_at = 0, donated_at = 0 WHERE item_id = 'melvorD:Weird_Gloop';
	`
}];
