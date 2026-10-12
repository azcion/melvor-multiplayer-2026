import type { Database } from 'bun:sqlite';
import { current_audit_context } from './audit-context';

export const ROLLBACK_POLICY_VERSION = 1;
type LocalEffect = 'outgoing' | 'incoming' | 'server_only' | 'unknown';
type Observation = { id: number; client_id: number; save_timestamp: number | null;
	client_loaded_at: number; admitted_at: number; capture_source: string; operation_highwater: number; installation_id: string | null };
type Operation = { id: number; committed_at: number; local_effect: LocalEffect; historical: number;
	save_load_id: number | null };
// Counts use the latest calibrated assessment, not the immutable initial raw candidate set.
const affected_operations_cte = (controls_available:boolean) => `affected AS (
 SELECT a.incident_id,a.operation_id FROM economy_candidate_assessments a
 JOIN economy_incidents i ON i.id=a.incident_id
 JOIN economy_clock_evidence e ON e.id=a.evidence_id AND e.save_load_id=i.save_load_id
 JOIN economy_operations o ON o.id=a.operation_id
 WHERE a.classification='after_cutoff' AND e.quality='calibrated'
 AND o.local_effect='outgoing' AND o.historical=0
 AND NOT EXISTS(SELECT 1 FROM economy_candidate_assessments newer
  WHERE newer.incident_id=a.incident_id AND newer.operation_id=a.operation_id AND newer.evidence_id>a.evidence_id)
 ${controls_available?`AND NOT EXISTS(SELECT 1 FROM economy_admissions admission JOIN economy_policy_changes policy ON policy.id=admission.policy_id
  WHERE admission.save_load_id=i.save_load_id AND o.id<json_extract(policy.config_json,'$.first_operation_id'))`:''}
)`;
const safe_time = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

// Call inside the domain transaction. The request context belongs to the actual session,
// never the latest session for a Client (multiple installations can remain connected).
export function record_economy_operation(database: Database, input: {
	source_key: string; client_id: number | null; kind: string; committed_at?: number;
	local_effect: LocalEffect; evidence: unknown;
}): number {
	const context = current_audit_context();
	const load_id = context?.actor_client_id === input.client_id ? context?.save_load_id ?? null : null;
	const account = input.client_id === null ? null : database.query<{ melvor_account_id: number | null }, [number]>(
		'SELECT melvor_account_id FROM clients WHERE id=?').get(input.client_id)?.melvor_account_id ?? null;
	const now = input.committed_at ?? Date.now();
	if (!safe_time(now)) throw new Error('Invalid operation timestamp');
	database.query('INSERT INTO economy_operations(source_key,client_id,account_id,save_load_id,kind,committed_at,local_effect,evidence_json) ' +
		'VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(source_key) DO NOTHING').run(input.source_key,input.client_id,account,
		load_id,input.kind,now,input.local_effect,JSON.stringify(input.evidence));
	return database.query<{ id: number }, [string]>('SELECT id FROM economy_operations WHERE source_key=?')
		.get(input.source_key)!.id;
}

export function observe_economy_load(database: Database, load_id: number, installation_id: string | null): void {
	database.query('INSERT INTO economy_load_observations ' +
		'(id,client_id,account_id,load_id,save_timestamp,client_loaded_at,capture_source,admitted_at,installation_id,operation_highwater) ' +
		'SELECT l.id,l.client_id,c.melvor_account_id,l.load_id,l.save_timestamp,l.client_loaded_at,l.capture_source,l.first_reported_at,?,COALESCE((SELECT MAX(id) FROM economy_operations),0) ' +
		'FROM character_save_loads l JOIN clients c ON c.id=l.client_id WHERE l.id=? ON CONFLICT DO NOTHING')
		.run(installation_id,load_id);
}

type Cutoff = { lower: number | null; upper: number | null; quality: string; reason: string };
export function calibrated_save_cutoff(observation: Observation,
	client_sent_at: number, client_received_at: number, elapsed_ms: number): Cutoff {
	const review = (reason: string): Cutoff => ({ lower: null, upper: null, quality: 'review_only', reason });
	if (![client_sent_at,client_received_at,elapsed_ms].every(safe_time) || client_received_at < client_sent_at)
		return review('invalid_clock_sample');
	if (!safe_time(observation.admitted_at) || !safe_time(observation.client_loaded_at)) return review('unsafe_observation');
	if (observation.save_timestamp === null) return review('unknown_save_timestamp');
	if (observation.capture_source !== 'decode') return review('fallback_capture');
	if (observation.installation_id === null) return review('missing_device_evidence');
	if (Math.abs((client_received_at-client_sent_at)-elapsed_ms)>50 || elapsed_ms>30_000)
		return review('clock_change_or_slow_request');
	if (observation.save_timestamp>client_sent_at || observation.client_loaded_at>client_sent_at)
		return review('future_timestamp');
	// Admission happened between the client's send and receive. Monotonic elapsed time
	// detects a wall-clock step during this exchange; no load-to-connect delay is used.
	const lower = observation.save_timestamp + (observation.admitted_at-client_received_at);
	const upper = observation.save_timestamp + (observation.admitted_at-client_sent_at);
	if (!safe_time(lower) || !safe_time(upper) || upper<lower) return review('unsafe_cutoff');
	return { lower,upper,quality:'calibrated',reason:'handshake_interval' };
}

// No correction, hold, notice, or player response is produced by this classifier.
// Reconnects never call it. The operation admission bound is frozen even when clock
// evidence arrives later, excluding the current load's own subsequent operations.
export function detect_save_rollback(database: Database, load_id: number, now=Date.now()): number | null {
	const load = database.query<Observation,[number]>('SELECT * FROM economy_load_observations WHERE id=?').get(load_id);
	if (load === null || load.save_timestamp === null) return null;
	const existing = database.query<{ id: number },[number]>('SELECT id FROM economy_incidents WHERE save_load_id=?').get(load_id);
	const clock = database.query<{ id: number; cutoff_lower: number | null; cutoff_upper: number | null; quality: string },[number]>(
		'SELECT * FROM economy_clock_evidence WHERE save_load_id=?').get(load_id);
	const prior = database.query<Operation,[number,number,number,number]>(
		'SELECT * FROM economy_operations WHERE client_id=? AND id<=? AND committed_at<=? AND (save_load_id IS NULL OR save_load_id<>?) ORDER BY id')
		.all(load.client_id,load.operation_highwater,load.admitted_at,load.id);
	const initial_candidates=new Set(database.query<{operation_id:number},[number]>('SELECT operation_id FROM economy_incident_candidates WHERE incident_id=?').all(existing?.id ?? -1).map(row=>row.operation_id));
	const candidates = prior.filter(op => initial_candidates.has(op.id) || (op.local_effect === 'outgoing' || op.local_effect === 'unknown') &&
			op.committed_at >= (clock?.cutoff_lower ?? load.save_timestamp!));
	if (candidates.length === 0) return existing?.id ?? null;
	return database.transaction(() => {
		const incident = existing?.id ?? database.query<{ id:number },[number,number,number]>(
			'INSERT INTO economy_incidents(save_load_id,created_at,policy_version) VALUES(?,?,?) RETURNING id')
			.get(load_id,now,ROLLBACK_POLICY_VERSION)!.id;
		for (const op of candidates) {
			// Previous calibrated loads must identify the same installation with overlapping
			// clock offsets. A changed device/clock or missing historical provenance is review-only.
			const previous = op.save_load_id === null ? null : database.query<Observation,[number]>(
				'SELECT * FROM economy_load_observations WHERE id=?').get(op.save_load_id);
			const previous_clock = op.save_load_id === null ? null : database.query<{
				client_sent_at:number; client_received_at:number; quality:string },[number]>(
				'SELECT * FROM economy_clock_evidence WHERE save_load_id=?').get(op.save_load_id);
			const same_clock = previous !== null && previous_clock?.quality === 'calibrated' && clock?.quality === 'calibrated' &&
				previous.installation_id === load.installation_id && load.installation_id !== null &&
				Math.max(previous.admitted_at-previous_clock.client_received_at,clock.cutoff_lower!-load.save_timestamp!) <=
				Math.min(previous.admitted_at-previous_clock.client_sent_at,clock.cutoff_upper!-load.save_timestamp!);
			const classification = op.historical === 1 || op.local_effect !== 'outgoing' || !same_clock
				? 'review_only' : op.committed_at<clock!.cutoff_lower! ? 'before_cutoff'
				: op.committed_at>clock!.cutoff_upper! ? 'after_cutoff' : 'uncertain';
			database.query('INSERT INTO economy_incident_candidates(incident_id,operation_id,evidence_id,classification) VALUES(?,?,?,?) ON CONFLICT DO NOTHING')
				.run(incident,op.id,clock?.id ?? null,classification);
			if (clock !== null) database.query('INSERT INTO economy_candidate_assessments(incident_id,operation_id,evidence_id,classification) VALUES(?,?,?,?) ON CONFLICT DO NOTHING')
				.run(incident,op.id,clock.id,classification);
		}
		if (existing === null) database.query("INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at,actor_kind) VALUES(?,?,?,?,'system')")
			.run(incident,'suspected','Observational timestamp comparison; operator review required',now);
		return incident;
	}).immediate();
}

// Calibrate once per new load using the exact auth response's server admission time.
// A retry preserves the first sample. It never uses a reconnect response as a new sample.
export function record_load_clock(database: Database, client_id:number, load_id:number,
	input: unknown, now=Date.now()): boolean {
	if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
	const sample=input as Record<string,unknown>;
	if (![sample.client_sent_at,sample.client_received_at,sample.elapsed_ms].every(safe_time) ||
		(sample.client_received_at as number)<(sample.client_sent_at as number)) return false;
	const load=database.query<Observation,[number,number]>(
		'SELECT * FROM economy_load_observations WHERE id=? AND client_id=?').get(load_id,client_id);
	if (load===null || sample.server_admitted_at!==load.admitted_at) return false;
	const sent=sample.client_sent_at as number, received=sample.client_received_at as number, elapsed=sample.elapsed_ms as number;
	const cutoff=calibrated_save_cutoff(load,sent,received,elapsed);
	if (now-load.admitted_at>60_000 || now<load.admitted_at) {
		cutoff.lower=null;cutoff.upper=null;cutoff.quality='review_only';cutoff.reason='late_calibration';
	}
	return database.transaction(() => {
		database.query('INSERT INTO economy_clock_evidence(save_load_id,recorded_at,client_sent_at,client_received_at,elapsed_ms,cutoff_lower,cutoff_upper,quality,reason) ' +
			'VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(save_load_id) DO NOTHING').run(load_id,now,sent,received,elapsed,
				cutoff.lower,cutoff.upper,cutoff.quality,cutoff.reason);
		detect_save_rollback(database,load_id,now);
		return true;
	}).immediate();
}

export function inspect_save_rollback(database: Database, client_id:number) {
	const controls_available=database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='economy_admissions'").get()!==null;
	const custody_available=database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='economy_custody_sources'").get()!==null;
	const incidents=database.query<{ id:number; state:string },[number]>(
		'SELECT i.*, (SELECT state FROM economy_incident_decisions d WHERE d.incident_id=i.id ORDER BY d.id DESC LIMIT 1) state ' +
		'FROM economy_incidents i JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.client_id=? ORDER BY i.id DESC LIMIT 100')
		.all(client_id);
	const counts=database.query<{ state:string; occurrences:number; first_occurrence:number; last_occurrence:number },[number]>(`
		WITH ${affected_operations_cte(controls_available)}, states AS (SELECT i.id,(SELECT state FROM economy_incident_decisions d WHERE d.incident_id=i.id ORDER BY d.id DESC LIMIT 1) state
		 FROM economy_incidents i JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.client_id=?)
		SELECT state,COUNT(*) occurrences,MIN((SELECT created_at FROM economy_incidents WHERE id=s.id)) first_occurrence,
		 MAX((SELECT created_at FROM economy_incidents WHERE id=s.id)) last_occurrence FROM states s WHERE state<>'confirmed' OR EXISTS(
		 SELECT 1 FROM affected c WHERE c.incident_id=s.id AND NOT EXISTS(
		  SELECT 1 FROM affected old JOIN states prev ON prev.id=old.incident_id
		  WHERE old.operation_id=c.operation_id AND prev.state='confirmed' AND prev.id<s.id)) GROUP BY state`).all(client_id);
	const account_id=database.query<{account_id:number|null},[number]>('SELECT account_id FROM economy_load_observations WHERE client_id=? ORDER BY id DESC LIMIT 1').get(client_id)?.account_id ?? null;
	const active=controls_available?database.query<{config_json:string},[]>('SELECT config_json FROM economy_policy_changes ORDER BY id DESC LIMIT 1').get():null;
	return { client_id, mode:active&&JSON.parse(active.config_json).enabled?'opt_in':'observational', counts, incidents,
		account_rollup:account_id===null?[]:database.query(`
		 WITH ${affected_operations_cte(controls_available)}, states AS (SELECT i.id,l.client_id,(SELECT state FROM economy_incident_decisions d WHERE d.incident_id=i.id ORDER BY d.id DESC LIMIT 1) state
		  FROM economy_incidents i JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.account_id=?)
		 SELECT s.client_id,s.state,COUNT(*) occurrences FROM states s WHERE s.state<>'confirmed' OR EXISTS(
		  SELECT 1 FROM affected c WHERE c.incident_id=s.id AND NOT EXISTS(
		   SELECT 1 FROM affected old JOIN states prev ON prev.id=old.incident_id
		   WHERE old.operation_id=c.operation_id AND prev.state='confirmed' AND prev.id<s.id))
		 GROUP BY s.client_id,s.state ORDER BY s.client_id,s.state LIMIT 512`).all(account_id),
		totals:database.query('SELECT COUNT(DISTINCT i.id) restore_observations,COUNT(DISTINCT c.operation_id) distinct_operations FROM economy_incidents i JOIN economy_load_observations l ON l.id=i.save_load_id LEFT JOIN economy_incident_candidates c ON c.incident_id=i.id WHERE l.client_id=?').get(client_id),
		observations:database.query('SELECT * FROM economy_load_observations WHERE client_id=? ORDER BY id DESC LIMIT 100').all(client_id),
		clock_evidence:database.query('SELECT e.* FROM economy_clock_evidence e JOIN economy_load_observations l ON l.id=e.save_load_id WHERE l.client_id=? ORDER BY e.id DESC LIMIT 100').all(client_id),
		candidates:database.query('SELECT c.*,o.source_key,o.kind,o.local_effect,o.committed_at,o.historical FROM economy_incident_candidates c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=? ORDER BY c.incident_id DESC,o.id LIMIT 500').all(client_id),
		decisions:database.query('SELECT d.* FROM economy_incident_decisions d JOIN economy_incidents i ON i.id=d.incident_id JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.client_id=? ORDER BY d.id DESC LIMIT 500').all(client_id),
		operations:database.query('SELECT * FROM economy_operations WHERE client_id=? ORDER BY id DESC LIMIT 100').all(client_id),
		assessments:database.query('SELECT a.* FROM economy_candidate_assessments a JOIN economy_operations o ON o.id=a.operation_id WHERE o.client_id=? ORDER BY a.incident_id DESC,o.id LIMIT 500').all(client_id),
		custody_sources:custody_available?database.query('SELECT * FROM economy_custody_sources WHERE client_id=? ORDER BY created_at DESC,root_key LIMIT 500').all(client_id):[],
		custody_movements:custody_available?database.query('SELECT m.* FROM economy_custody_movements m JOIN economy_custody_sources s ON s.root_key=m.root_key WHERE s.client_id=? ORDER BY m.id DESC LIMIT 500').all(client_id):[],
		custody_balances:custody_available?database.query('SELECT b.* FROM economy_custody_balances b JOIN economy_custody_sources s ON s.root_key=b.root_key WHERE s.client_id=? ORDER BY b.root_key,b.location LIMIT 500').all(client_id):[],
		wish_funding:custody_available?database.query('SELECT f.* FROM economy_wish_funding f JOIN economy_custody_sources s ON s.root_key=f.root_key WHERE s.client_id=? ORDER BY f.id DESC LIMIT 500').all(client_id):[],
		dependencies:custody_available?database.query('SELECT d.* FROM economy_dependency_evidence d JOIN economy_custody_sources s ON s.root_key=d.root_key WHERE s.client_id=? ORDER BY d.id DESC LIMIT 500').all(client_id):[],
		// Restrict indirect ownership to typed tables/keys; a matching arbitrary JSON value
		// is not party evidence. Retained observations preserve account ownership after deletion.
		terminal_snapshots:custody_available?database.query(`
		 WITH owned_accounts AS (SELECT DISTINCT account_id FROM economy_load_observations WHERE client_id=? AND account_id IS NOT NULL),
		 party_gifts AS (SELECT DISTINCT json_extract(snapshot_json,'$.gift_id') gift_id FROM economy_terminal_snapshots
		  WHERE table_name='gifts' AND (json_extract(snapshot_json,'$.sender_id')=? OR json_extract(snapshot_json,'$.client_id')=?)),
		 party_trades AS (SELECT DISTINCT json_extract(snapshot_json,'$.trade_id') trade_id FROM economy_terminal_snapshots
		  WHERE table_name='trade_offers' AND (json_extract(snapshot_json,'$.sender_id')=? OR json_extract(snapshot_json,'$.recipient_id')=?))
		 SELECT t.* FROM economy_terminal_snapshots t WHERE
		 json_extract(t.snapshot_json,'$.client_id')=? OR json_extract(t.snapshot_json,'$.owner_client_id')=?
		 OR (t.table_name IN ('gifts','trade_offers','resolved_trade_offers') AND json_extract(t.snapshot_json,'$.sender_id')=?)
		 OR (t.table_name='trade_offers' AND json_extract(t.snapshot_json,'$.recipient_id')=?)
		 OR (t.table_name='market_haggles' AND (json_extract(t.snapshot_json,'$.owner_id')=? OR json_extract(t.snapshot_json,'$.initiator_id')=?))
		 OR (t.table_name='gift_items' AND json_extract(t.snapshot_json,'$.gift_id') IN (SELECT gift_id FROM party_gifts))
		 OR (t.table_name='client_deletion_return_items' AND EXISTS(
		  SELECT 1 FROM economy_custody_movements m JOIN economy_custody_sources source ON source.root_key=m.root_key
		  WHERE source.client_id=? AND (m.from_location='deletion-return:'||json_extract(t.snapshot_json,'$.return_id')||':'||json_extract(t.snapshot_json,'$.item_id')
		   OR m.to_location='deletion-return:'||json_extract(t.snapshot_json,'$.return_id')||':'||json_extract(t.snapshot_json,'$.item_id'))))
		 OR (t.table_name='trade_items' AND json_extract(t.snapshot_json,'$.trade_id') IN (SELECT trade_id FROM party_trades))
		 OR (t.table_name='market_purchases' AND (json_extract(t.snapshot_json,'$.owner_key')='client:'||?
		  OR json_extract(t.snapshot_json,'$.owner_key') IN (SELECT 'account:'||account_id FROM owned_accounts)))
		 ORDER BY t.id DESC LIMIT 500`).all(client_id,client_id,client_id,client_id,client_id,client_id,client_id,client_id,client_id,client_id,client_id,client_id,client_id):[],
		derived_sources:custody_available?database.query(`SELECT DISTINCT child.* FROM economy_custody_sources child
		 WHERE EXISTS(SELECT 1 FROM economy_custody_sources parent WHERE parent.client_id=? AND
		 (json_extract(child.snapshot_json,'$.parent_root')=parent.root_key OR EXISTS(
		  SELECT 1 FROM json_each(child.snapshot_json,'$.parent_roots') p WHERE p.value=parent.root_key)))
		 ORDER BY child.created_at DESC,child.root_key LIMIT 500`).all(client_id):[],
		current_corrections:custody_available?database.query('SELECT c.* FROM economy_current_corrections c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=? ORDER BY c.id DESC LIMIT 500').all(client_id):[],
		correction_resolutions:custody_available?database.query('SELECT r.* FROM economy_correction_resolutions r JOIN economy_corrections c ON c.id=r.resolution_id JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=? ORDER BY r.id DESC LIMIT 500').all(client_id):[],
		corrections:database.query('SELECT c.* FROM economy_corrections c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=? ORDER BY c.id DESC LIMIT 500').all(client_id) };
}
