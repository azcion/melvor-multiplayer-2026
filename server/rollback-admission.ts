import type { Database } from 'bun:sqlite';
import { correct_custody_operation } from './economy-correction';
import { detect_save_rollback } from './save-rollback';
import { rollback_policy, rollback_operator_command } from './rollback-policy';

type Admission = {save_load_id:number;policy_id:number;state:string};
function append_admission(database:Database,admission:Admission,state:string,reason:string,now:number) {
 database.query('INSERT INTO economy_admissions(save_load_id,policy_id,state,reason,created_at) VALUES(?,?,?,?,?)').run(admission.save_load_id,admission.policy_id,state,reason,now);
}
/** Caller commits load observation and this gate before returning a session/recovery response. */
export function admit_rollback_load(database:Database,client:number,load:number|null,capable:boolean,now=Date.now()):void {
 const policy=rollback_policy(database);
 if(!policy.config.enabled||!policy.config.client_ids.includes(client)) return;
 if(load===null) {
  if(database.query<{held:number},[number]>('SELECT held FROM economy_client_holds WHERE client_id=? ORDER BY id DESC LIMIT 1').get(client)?.held!==1)
   database.query('INSERT INTO economy_client_holds(client_id,held,reason,created_at) VALUES(?,1,?,?)').run(client,'Opted-in admission lacks tracked load evidence',now);
  return;
 }
 if(database.query('SELECT 1 FROM economy_admissions WHERE save_load_id=?').get(load)) return;
 append_admission(database,{save_load_id:load,policy_id:policy.revision,state:'waiting'},capable?'waiting':'review',capable?'Awaiting original handshake calibration':'Protocol capability required',now);
 database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
}

/** Entire classification/decision/correction commits or rolls back together. Cache callbacks run only after return. */
export function evaluate_rollback_admission(database:Database,client:number,load:number,capable:boolean,now=Date.now()):string[] {
 return database.transaction(()=>{
  const admission=database.query<Admission,[number]>('SELECT * FROM economy_admissions WHERE save_load_id=? ORDER BY id DESC LIMIT 1').get(load);
  if(!admission||admission.state==='released'||admission.state==='ready') return [];
  const current=rollback_policy(database);
  // Turning off never removes explicit holds or reverses any existing disposition.
  if(!current.config.enabled||!current.config.client_ids.includes(client)||!capable) return [];
  const policy=database.query<{config_json:string},[number]>('SELECT config_json FROM economy_policy_changes WHERE id=?').get(admission.policy_id)!;
  const config=JSON.parse(policy.config_json) as typeof current.config;
  if(config.first_operation_id===null) throw new Error('Admission lacks prospective boundary');
  const incident=detect_save_rollback(database,load,now);
  const clock=database.query<{quality:string},[number]>('SELECT quality FROM economy_clock_evidence WHERE save_load_id=?').get(load);
  if(!clock) return [];
  if(incident===null) {append_admission(database,admission,'ready','No prior outgoing candidate',now);return [];}
  const decision=database.query<{state:string},[number]>('SELECT state FROM economy_incident_decisions WHERE incident_id=? ORDER BY id DESC LIMIT 1').get(incident);
  if(decision?.state==='dismissed') {append_admission(database,admission,'released','Incident dismissed by operator',now);return [];}
  const eligible=database.query<{id:number;source_key:string},[number,number]>(`SELECT o.id,o.source_key FROM economy_incident_candidates c JOIN economy_operations o ON o.id=c.operation_id
   JOIN economy_candidate_assessments a ON a.incident_id=c.incident_id AND a.operation_id=c.operation_id
   JOIN economy_clock_evidence e ON e.id=a.evidence_id AND e.save_load_id=?
   WHERE c.incident_id=? AND a.classification='after_cutoff' AND e.quality='calibrated' AND o.historical=0 AND o.local_effect='outgoing'
   AND NOT EXISTS(SELECT 1 FROM economy_candidate_assessments n WHERE n.incident_id=a.incident_id AND n.operation_id=a.operation_id AND n.evidence_id>a.evidence_id)
   ORDER BY o.id`).all(load,incident).filter(op=>op.id>=config.first_operation_id!);
  if(eligible.length&&decision?.state!=='confirmed') database.query(`INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at,actor_kind)
   VALUES(?,'confirmed','Prospective opted-in calibrated outgoing operation',?,'system')`).run(incident,now);
  const corrected:string[]=[];
  for(const operation of eligible) {
   const result=correct_custody_operation(database,incident,operation.id,{enabled:true,first_operation_id:config.first_operation_id,policy_version:config.policy_version},now);
   if(result.applied) corrected.push(operation.source_key);
  }
  if(eligible.length) database.query('INSERT INTO economy_player_notices VALUES(?,?,?,?) ON CONFLICT(incident_id) DO NOTHING').run(crypto.randomUUID(),incident,client,now);
  // Initial raw candidates remain private evidence. Any non-before candidate without complete
  // prospective proof stays in nonblocking review; confirmation alone cannot authorize its removal.
  const unresolved=database.query(`SELECT 1 FROM economy_incident_candidates c JOIN economy_operations o ON o.id=c.operation_id
   LEFT JOIN economy_candidate_assessments a ON a.incident_id=c.incident_id AND a.operation_id=c.operation_id
    AND a.evidence_id=(SELECT MAX(n.evidence_id) FROM economy_candidate_assessments n WHERE n.incident_id=c.incident_id AND n.operation_id=c.operation_id)
   WHERE c.incident_id=? AND (a.classification IS NULL OR a.classification IN ('uncertain','review_only') OR
    (a.classification='after_cutoff' AND (o.id<? OR NOT EXISTS(SELECT 1 FROM economy_corrections correction WHERE correction.operation_id=o.id)
     OR EXISTS(SELECT 1 FROM economy_current_corrections correction WHERE correction.operation_id=o.id AND correction.disposition='unresolved')))) LIMIT 1`).get(incident,config.first_operation_id)!==null;
  append_admission(database,admission,unresolved?'review':'ready',unresolved?'Private evidence requires operator review':'Calibrated classification completed',now);
  database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
  return corrected;
 }).immediate();
}
export function decide_rollback_incident(database:Database,id:string,incident:number,expected:number,state:'confirmed'|'dismissed',reason:string) {
 return rollback_operator_command(database,id,{kind:'incident',incident,expected,state},reason,()=>{
  const old=database.query<{id:number},[number]>('SELECT id FROM economy_incident_decisions WHERE incident_id=? ORDER BY id DESC LIMIT 1').get(incident);
  if(!old||old.id!==expected) throw new Error('Incident decision changed or missing');
  const decision=database.query<{id:number},[number,string,string,number]>(`INSERT INTO economy_incident_decisions(incident_id,state,reason,decided_at,actor_kind) VALUES(?,?,?,?,'operator') RETURNING id`).get(incident,state,reason,Date.now())!;
  // Dismiss releases admission only; marked value and retired receipts remain terminal.
  if(state==='dismissed') {
   const admission=database.query<Admission,[number]>(`SELECT a.* FROM economy_admissions a JOIN economy_incidents i ON i.save_load_id=a.save_load_id WHERE i.id=? ORDER BY a.id DESC LIMIT 1`).get(incident);
   if(admission) append_admission(database,admission,'released',reason,Date.now());
  }
  if(state==='confirmed') {
   const owner=database.query<{client_id:number;save_load_id:number},[number]>('SELECT l.client_id,i.save_load_id FROM economy_incidents i JOIN economy_load_observations l ON l.id=i.save_load_id WHERE i.id=?').get(incident)!;
   const capable=database.query('SELECT 1 FROM client_sessions WHERE client_id=? AND save_load_id=? AND rollback_capable=1 LIMIT 1').get(owner.client_id,owner.save_load_id)!==null;
   evaluate_rollback_admission(database,owner.client_id,owner.save_load_id,capable);
  }
  database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=(SELECT l.client_id FROM economy_incidents i JOIN economy_load_observations l ON l.id=i.save_load_id WHERE i.id=?)').run(incident);
  return {decision_id:decision.id,state};
 });
}
