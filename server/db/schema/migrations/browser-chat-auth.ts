import type { Migration } from '../types';

export const browser_chat_auth_migration: Migration = {
	version: 190,
	sql: `
CREATE TABLE chat_pairing_codes (
 code_hash TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 issued_at INTEGER NOT NULL CHECK (issued_at BETWEEN 0 AND 9007199254740991),
 expires_at INTEGER NOT NULL CHECK (expires_at BETWEEN issued_at AND 9007199254740991),
 consumed_at INTEGER CHECK (consumed_at BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX chat_pairing_codes_client ON chat_pairing_codes(client_id);
CREATE TABLE chat_pairing_issuance (
 client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
 window_start INTEGER NOT NULL CHECK (window_start BETWEEN 0 AND 9007199254740991),
 issued_count INTEGER NOT NULL CHECK (issued_count BETWEEN 1 AND 3)
);
CREATE TABLE chat_browser_sessions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
 expires_at INTEGER NOT NULL CHECK (expires_at BETWEEN created_at AND 9007199254740991),
 last_browser_seen_at INTEGER NOT NULL CHECK (last_browser_seen_at BETWEEN 0 AND 9007199254740991),
 revoked_at INTEGER CHECK (revoked_at BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX chat_browser_sessions_client ON chat_browser_sessions(client_id);
CREATE TRIGGER chat_browser_identity_revocation AFTER UPDATE OF disabled, deleted_at ON clients
WHEN (NEW.disabled <> 0 AND OLD.disabled = 0) OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
BEGIN
 UPDATE chat_browser_sessions SET revoked_at = COALESCE(revoked_at, 1) WHERE client_id = NEW.id;
 UPDATE chat_pairing_codes SET consumed_at = COALESCE(consumed_at, 1) WHERE client_id = NEW.id;
END;
`
};
