import type { Migration } from '../types';

const snapshots = [
	{ table: 'crucible_offerings', fields: ['id','guild_id','item_id','qty','value_currency_id','value_per_item','generation','meld_points','created_at','refreshed_at','is_untimed','valuation_source'] },
	{ table: 'crucible_contribution_lots', fields: ['id','offering_id','client_id','qty','contributed_at','source_kind','source_id','locked_until'] },
	{ table: 'crucible_wishes', fields: ['id','guild_id','owner_client_id','melvor_account_id','item_id','qty','required_gp','progress_gp','formation_points','created_at','formed_at','melded_at','auto_deliver_at'] },
	{ table: 'expedition_supply_lots', fields: ['id','expedition_id','item_id','client_id','owner_key','qty','contributed_at'] },
];
export const economy_custody_migration: Migration = { version: 174, sql: `
	CREATE TABLE economy_custody_sources (
		root_key TEXT PRIMARY KEY,
		operation_key TEXT NOT NULL,
		client_id INTEGER NOT NULL,
		object_id TEXT NOT NULL,
		quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
		created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
		snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
	) STRICT;
	CREATE INDEX economy_custody_operation ON economy_custody_sources(operation_key);
	CREATE TABLE economy_custody_movements (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		root_key TEXT NOT NULL REFERENCES economy_custody_sources(root_key),
		from_location TEXT,
		to_location TEXT NOT NULL,
		quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
		occurred_at INTEGER NOT NULL CHECK(occurred_at BETWEEN 0 AND 9007199254740991),
		reason TEXT NOT NULL,
		CHECK(from_location IS NULL OR from_location <> to_location)
	) STRICT;
	CREATE VIEW economy_custody_balances AS
	SELECT root_key,location,SUM(delta) AS quantity FROM (
		SELECT root_key,to_location AS location,quantity AS delta FROM economy_custody_movements
		UNION ALL SELECT root_key,from_location,-quantity FROM economy_custody_movements WHERE from_location IS NOT NULL
	) GROUP BY root_key,location HAVING SUM(delta)>0;
	CREATE TABLE economy_correction_resolutions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		unresolved_id INTEGER NOT NULL REFERENCES economy_corrections(id),
		resolution_id INTEGER NOT NULL REFERENCES economy_corrections(id),
		quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
		CHECK(unresolved_id<>resolution_id),
		UNIQUE(unresolved_id,resolution_id)
	) STRICT;
	CREATE TRIGGER economy_resolution_conservation BEFORE INSERT ON economy_correction_resolutions BEGIN
		SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM economy_corrections old JOIN economy_corrections next
			ON next.id=NEW.resolution_id AND next.operation_id=old.operation_id AND next.object_id=old.object_id
			WHERE old.id=NEW.unresolved_id AND old.disposition='unresolved' AND next.disposition<>'unresolved'
			AND NEW.quantity+COALESCE((SELECT SUM(quantity) FROM economy_correction_resolutions WHERE unresolved_id=old.id),0)<=old.quantity
			AND NEW.quantity+COALESCE((SELECT SUM(quantity) FROM economy_correction_resolutions WHERE resolution_id=next.id),0)<=next.quantity)
			THEN RAISE(ABORT,'Correction resolution does not conserve quantity') END;
	END;
	CREATE VIEW economy_current_corrections AS SELECT c.*,
		c.quantity-COALESCE((SELECT SUM(r.quantity) FROM economy_correction_resolutions r WHERE r.unresolved_id=c.id),0) AS remaining_quantity
		FROM economy_corrections c WHERE c.quantity>COALESCE((SELECT SUM(r.quantity) FROM economy_correction_resolutions r WHERE r.unresolved_id=c.id),0);
	CREATE TABLE economy_terminal_snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		table_name TEXT NOT NULL,
		row_id INTEGER NOT NULL,
		recorded_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s','now') AS INTEGER)*1000),
		phase TEXT NOT NULL DEFAULT 'terminal' CHECK(phase IN ('source','terminal')),
		snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
	) STRICT;
	CREATE TABLE economy_wish_funding (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		wish_id INTEGER NOT NULL,
		root_key TEXT REFERENCES economy_custody_sources(root_key),
		origin_kind TEXT NOT NULL DEFAULT 'principal' CHECK(origin_kind IN ('principal','derived','unknown')),
		amount_gp INTEGER NOT NULL CHECK(amount_gp BETWEEN -9007199254740991 AND 9007199254740991 AND amount_gp<>0),
		reason TEXT NOT NULL,
		occurred_at INTEGER NOT NULL CHECK(occurred_at BETWEEN 0 AND 9007199254740991)
	) STRICT;
	CREATE INDEX economy_wish_funding_origin ON economy_wish_funding(root_key,wish_id);
	CREATE TABLE economy_dependency_evidence (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		root_key TEXT REFERENCES economy_custody_sources(root_key),
		kind TEXT NOT NULL,
		quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 9007199254740991),
		snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
	) STRICT;
	${snapshots.map(({table,fields}) => `CREATE TRIGGER ${table}_terminal_snapshot BEFORE DELETE ON ${table} BEGIN
		INSERT INTO economy_terminal_snapshots(table_name,row_id,snapshot_json)
		VALUES('${table}',OLD.id,json_object(${fields.map(field => `'${field}',OLD.${field}`).join(',')})); END;`).join('\n')}
	${snapshots.map(({table,fields})=>`CREATE TRIGGER ${table}_source_snapshot AFTER INSERT ON ${table} BEGIN
		INSERT INTO economy_terminal_snapshots(table_name,row_id,phase,snapshot_json)
		VALUES('${table}',NEW.id,'source',json_object(${fields.map(field=>`'${field}',NEW.${field}`).join(',')})); END;`).join('\n')}
	${[{table:'crucible_contribution_lots',prefix:'crucible-lot:',time:'contributed_at'},
		{table:'expedition_supply_lots',prefix:'expedition-lot:',time:'contributed_at'},
		{table:'crucible_offerings',prefix:'crucible-offering:',time:'refreshed_at'}].map(({table,prefix,time})=>`
	CREATE TRIGGER ${table}_custody_cleanup BEFORE DELETE ON ${table} BEGIN
		INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason)
		SELECT root_key,location,'unresolved:terminal-cleanup',quantity,CAST(strftime('%s','now') AS INTEGER)*1000,'live-row-cleanup'
		FROM economy_custody_balances WHERE location='${prefix}'||OLD.id; END;`).join('\n')}
	${['economy_correction_resolutions','economy_custody_sources','economy_custody_movements','economy_terminal_snapshots','economy_wish_funding','economy_dependency_evidence'].map(table => `
	CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Economy custody is immutable'); END;
	CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Economy custody is immutable'); END;`).join('\n')}
` };
