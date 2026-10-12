import type { Migration } from '../types';

// Evidence uses numeric historical identity references, never cascading live ownership.
export const save_rollback_migration: Migration = { version: 173, sql: `
	CREATE TABLE economy_load_observations (
		id INTEGER PRIMARY KEY,
		client_id INTEGER NOT NULL,
		account_id INTEGER,
		load_id TEXT NOT NULL,
		save_timestamp INTEGER CHECK(save_timestamp IS NULL OR save_timestamp BETWEEN 1 AND 9007199254740991),
		client_loaded_at INTEGER NOT NULL CHECK(client_loaded_at BETWEEN 0 AND 9007199254740991),
		capture_source TEXT NOT NULL CHECK(capture_source IN ('decode','character_loaded')),
		admitted_at INTEGER NOT NULL CHECK(admitted_at BETWEEN 0 AND 9007199254740991),
		installation_id TEXT,
		operation_highwater INTEGER NOT NULL DEFAULT 0,
		UNIQUE(client_id,load_id)
	) STRICT;
	INSERT INTO economy_load_observations
	SELECT l.id,l.client_id,c.melvor_account_id,l.load_id,l.save_timestamp,l.client_loaded_at,
		l.capture_source,l.first_reported_at,NULL,0 FROM character_save_loads l JOIN clients c ON c.id=l.client_id;
	CREATE TABLE economy_operations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		source_key TEXT NOT NULL UNIQUE,
		client_id INTEGER,
		account_id INTEGER,
		save_load_id INTEGER REFERENCES economy_load_observations(id),
		kind TEXT NOT NULL,
		committed_at INTEGER NOT NULL CHECK(committed_at BETWEEN 0 AND 9007199254740991),
		local_effect TEXT NOT NULL CHECK(local_effect IN ('outgoing','incoming','server_only','unknown')),
		evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
		historical INTEGER NOT NULL DEFAULT 0 CHECK(historical IN (0,1))
	) STRICT;
	CREATE INDEX economy_operations_client_time ON economy_operations(client_id,committed_at,id);
	INSERT INTO economy_operations(source_key,client_id,account_id,kind,committed_at,local_effect,evidence_json,historical)
	SELECT 'receipt:'||r.id,r.client_id,c.melvor_account_id,r.kind,r.created_at,
		CASE WHEN EXISTS(SELECT 1 FROM json_each(r.response_json,'$.receipt.effects') e WHERE json_extract(e.value,'$.qty')<0) THEN 'outgoing'
		 WHEN EXISTS(SELECT 1 FROM json_each(r.response_json,'$.receipt.effects') e WHERE json_extract(e.value,'$.qty')>0) THEN 'incoming' ELSE 'unknown' END,r.response_json,1
	FROM economy_receipts r LEFT JOIN clients c ON c.id=r.client_id;
	INSERT INTO economy_operations(source_key,client_id,account_id,kind,committed_at,local_effect,evidence_json,historical)
	SELECT 'wish:'||r.client_id||':'||r.id,r.client_id,c.melvor_account_id,'wish-'||r.kind,r.created_at,'server_only',r.response_json,1
	FROM crucible_commands r LEFT JOIN clients c ON c.id=r.client_id;
	INSERT INTO economy_operations(source_key,client_id,account_id,kind,committed_at,local_effect,evidence_json,historical)
	SELECT 'receipt-ack:'||r.id,r.client_id,c.melvor_account_id,'receipt-acknowledge',r.acknowledged_at,'server_only',
	 json_object('receipt_id',r.id,'acknowledged_at',r.acknowledged_at),1
	FROM economy_receipts r LEFT JOIN clients c ON c.id=r.client_id WHERE r.acknowledged_at IS NOT NULL;
	UPDATE economy_load_observations SET operation_highwater=COALESCE((SELECT MAX(id) FROM economy_operations),0);
	CREATE TABLE economy_clock_evidence (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		save_load_id INTEGER NOT NULL UNIQUE REFERENCES economy_load_observations(id),
		recorded_at INTEGER NOT NULL CHECK(recorded_at BETWEEN 0 AND 9007199254740991),
		client_sent_at INTEGER NOT NULL CHECK(client_sent_at BETWEEN 0 AND 9007199254740991),
		client_received_at INTEGER NOT NULL CHECK(client_received_at BETWEEN client_sent_at AND 9007199254740991),
		elapsed_ms INTEGER NOT NULL CHECK(elapsed_ms BETWEEN 0 AND 9007199254740991),
		cutoff_lower INTEGER CHECK(cutoff_lower IS NULL OR cutoff_lower BETWEEN 0 AND 9007199254740991),
		cutoff_upper INTEGER CHECK(cutoff_upper IS NULL OR cutoff_upper BETWEEN cutoff_lower AND 9007199254740991),
		quality TEXT NOT NULL CHECK(quality IN ('calibrated','review_only')),
		reason TEXT NOT NULL
	) STRICT;
	CREATE TABLE economy_incidents (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		save_load_id INTEGER NOT NULL UNIQUE REFERENCES economy_load_observations(id),
		created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
		policy_version INTEGER NOT NULL CHECK(policy_version>0)
	) STRICT;
	CREATE TABLE economy_incident_candidates (
		incident_id INTEGER NOT NULL REFERENCES economy_incidents(id),
		operation_id INTEGER NOT NULL REFERENCES economy_operations(id),
		evidence_id INTEGER REFERENCES economy_clock_evidence(id),
		classification TEXT NOT NULL CHECK(classification IN ('after_cutoff','before_cutoff','uncertain','review_only','server_only')),
		PRIMARY KEY(incident_id,operation_id)
	) STRICT;
	CREATE TABLE economy_candidate_assessments (
		incident_id INTEGER NOT NULL REFERENCES economy_incidents(id),
		operation_id INTEGER NOT NULL REFERENCES economy_operations(id),
		evidence_id INTEGER NOT NULL REFERENCES economy_clock_evidence(id),
		classification TEXT NOT NULL CHECK(classification IN ('after_cutoff','before_cutoff','uncertain','review_only')),
		PRIMARY KEY(incident_id,operation_id,evidence_id)
	) STRICT;
	CREATE TABLE economy_incident_decisions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		incident_id INTEGER NOT NULL REFERENCES economy_incidents(id),
		state TEXT NOT NULL CHECK(state IN ('suspected','confirmed','dismissed')),
		actor_kind TEXT NOT NULL DEFAULT 'operator' CHECK(actor_kind IN ('operator','system')),
		reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),
		decided_at INTEGER NOT NULL CHECK(decided_at BETWEEN 0 AND 9007199254740991)
	) STRICT;
	CREATE TABLE economy_corrections (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		incident_id INTEGER NOT NULL REFERENCES economy_incidents(id),
		operation_id INTEGER NOT NULL REFERENCES economy_operations(id),
		lot_key TEXT NOT NULL,
		object_id TEXT NOT NULL,
		quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
		disposition TEXT NOT NULL CHECK(disposition IN ('invalidated','protected','consumed','unresolved','held')),
		reason TEXT NOT NULL,
		decided_at INTEGER NOT NULL CHECK(decided_at BETWEEN 0 AND 9007199254740991),
		policy_version INTEGER NOT NULL CHECK(policy_version>0)
	) STRICT;
	CREATE UNIQUE INDEX economy_correction_invalidation ON economy_corrections(operation_id,lot_key,object_id)
		WHERE disposition='invalidated';
	${['economy_load_observations','economy_operations','economy_clock_evidence','economy_incidents',
	'economy_incident_candidates','economy_candidate_assessments','economy_incident_decisions','economy_corrections'].map(table => `
	CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table}
	BEGIN SELECT RAISE(ABORT,'Economy evidence is immutable'); END;
	CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table}
	BEGIN SELECT RAISE(ABORT,'Economy evidence is immutable'); END;`).join('')}
` };
