import type { Migration } from '../types';
export const fighter_adventures_migration: Migration = { version: 221, sql: `
CREATE TABLE fighter_adventures (
	client_id INTEGER PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
	area_id TEXT,
	opted_in INTEGER NOT NULL DEFAULT 0 CHECK(opted_in IN (0,1)),
	capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity BETWEEN 1 AND 99),
	invested_micros INTEGER NOT NULL DEFAULT 0 CHECK(invested_micros BETWEEN 0 AND 9007199254740991),
	revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
	last_at INTEGER NOT NULL CHECK(last_at BETWEEN 0 AND 9007199254740991),
	used_ms INTEGER NOT NULL DEFAULT 0 CHECK(used_ms BETWEEN 0 AND 356400000),
	pool_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(pool_json)),
	progress_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(progress_json)),
	pending_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(pending_json)),
	eligibility_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(eligibility_json)),
	efficiency REAL NOT NULL DEFAULT 1 CHECK(efficiency BETWEEN 0 AND 20),
	haul_revision INTEGER NOT NULL DEFAULT 0 CHECK(haul_revision>=0),
	seen_revision INTEGER NOT NULL DEFAULT 0 CHECK(seen_revision>=0)
);
` };
