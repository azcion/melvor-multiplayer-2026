import type { Migration } from '../types';

export const rollback_admission_migration: Migration = {version:180,sql:`
 CREATE TABLE economy_policy_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, config_json TEXT NOT NULL CHECK(json_valid(config_json)),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000), created_at INTEGER NOT NULL
 ) STRICT;
 CREATE TABLE economy_operator_commands (
  command_id TEXT PRIMARY KEY, request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  result_json TEXT NOT NULL CHECK(json_valid(result_json)), created_at INTEGER NOT NULL
 ) STRICT;
 CREATE TABLE economy_client_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, held INTEGER NOT NULL CHECK(held IN (0,1)),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000), created_at INTEGER NOT NULL
 ) STRICT;
 CREATE INDEX economy_client_holds_latest ON economy_client_holds(client_id,id);
 CREATE TABLE economy_admissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, save_load_id INTEGER NOT NULL REFERENCES economy_load_observations(id),
  policy_id INTEGER NOT NULL REFERENCES economy_policy_changes(id),
  state TEXT NOT NULL CHECK(state IN ('waiting','review','ready','released')),
  reason TEXT NOT NULL, created_at INTEGER NOT NULL
 ) STRICT;
 CREATE INDEX economy_admissions_load ON economy_admissions(save_load_id,id);
 CREATE TABLE economy_player_notices (
  notice_id TEXT PRIMARY KEY, incident_id INTEGER NOT NULL UNIQUE REFERENCES economy_incidents(id),
  client_id INTEGER NOT NULL, created_at INTEGER NOT NULL
 ) STRICT;
 CREATE TABLE economy_notice_acknowledgements (
  notice_id TEXT PRIMARY KEY REFERENCES economy_player_notices(notice_id), client_id INTEGER NOT NULL, acknowledged_at INTEGER NOT NULL
 ) STRICT;
 CREATE TABLE economy_benefit_releases (
  root_key TEXT PRIMARY KEY REFERENCES economy_custody_sources(root_key), client_id INTEGER NOT NULL,
  object_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000), created_at INTEGER NOT NULL
 ) STRICT;
 ${['economy_policy_changes','economy_operator_commands','economy_client_holds','economy_admissions','economy_player_notices','economy_notice_acknowledgements','economy_benefit_releases'].map(table=>`
 CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Economy control history is immutable'); END;
 CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Economy control history is immutable'); END;`).join('\n')}
`};
