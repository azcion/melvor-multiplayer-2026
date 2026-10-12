import type { Migration } from '../types';

export const rollback_protocol_migration: Migration = {version:179,sql:`
	ALTER TABLE client_sessions ADD COLUMN rollback_capable INTEGER NOT NULL DEFAULT 0 CHECK(rollback_capable IN (0,1));
	ALTER TABLE client_runtime_snapshots ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(capabilities));
`};
