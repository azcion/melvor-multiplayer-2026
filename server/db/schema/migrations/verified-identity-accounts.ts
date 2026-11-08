import type { Migration } from '../types';
export const verified_identity_accounts_migration: Migration = { version: 222, sql: `
CREATE TABLE verified_identity_accounts (
	client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
	playfab_id TEXT NOT NULL CHECK(length(playfab_id) BETWEEN 1 AND 128),
	character_name TEXT NOT NULL CHECK(length(character_name) BETWEEN 1 AND 100),
	verified_at INTEGER NOT NULL CHECK(verified_at BETWEEN 0 AND 9007199254740991)
);
CREATE INDEX idx_verified_identity_account_name ON verified_identity_accounts(playfab_id,character_name);
` };
