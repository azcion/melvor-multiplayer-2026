import type { Migration } from '../types';

export const identity_recovery_state_migration: Migration = { version: 223, sql: `
ALTER TABLE clients ADD COLUMN registration_character_name TEXT
	CHECK(registration_character_name IS NULL OR length(registration_character_name) BETWEEN 1 AND 100);
ALTER TABLE clients ADD COLUMN account_recovery_revocation TEXT NOT NULL DEFAULT ''
	CHECK(length(account_recovery_revocation) IN (0,36));
` };
