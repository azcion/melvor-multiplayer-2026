import type { Migration } from '../types';

export const receipt_reviews_migration: Migration = {
	version: 192,
	sql: `
		CREATE TABLE economy_receipt_reviews (
			receipt_id TEXT PRIMARY KEY REFERENCES economy_receipts(id) ON DELETE CASCADE,
			reason TEXT NOT NULL CHECK(reason IN ('blocked', 'invalid', 'acknowledgement_failed')),
			reported_at INTEGER NOT NULL CHECK(reported_at BETWEEN 0 AND 9007199254740991)
		) STRICT;
	`
};
