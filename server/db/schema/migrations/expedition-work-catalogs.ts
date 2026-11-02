import type { Migration } from '../types';

export const expedition_work_catalogs_migration: Migration = { version: 210, sql: `
	CREATE TABLE expedition_work_catalogs (
		hash TEXT PRIMARY KEY CHECK(length(hash) = 64),
		definitions TEXT NOT NULL CHECK(json_valid(definitions))
	) STRICT;
	ALTER TABLE expedition_work_operations ADD COLUMN catalog_hash TEXT REFERENCES expedition_work_catalogs(hash);
` };
