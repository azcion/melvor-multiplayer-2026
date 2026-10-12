import type { Database } from 'bun:sqlite';
import { rollback_operator_command } from './rollback-policy';
import { add_inbox_items } from './inbox';

export function inspect_rollback_benefits(database:Database,client:number) {
 const sources=database.query<{root_key:string;object_id:string;quantity:number;snapshot_json:string},[number]>(`SELECT s.root_key,s.object_id,b.quantity,s.snapshot_json
  FROM economy_custody_sources s JOIN economy_custody_balances b ON b.root_key=s.root_key WHERE s.client_id=? AND b.location='held'
  ORDER BY s.created_at,s.root_key LIMIT 500`).all(client).map(row=>({...row,
   release_supported:['market','trade'].includes(JSON.parse(row.snapshot_json).benefit_kind)}));
 const domain_gates=database.query(`SELECT c.* FROM economy_current_corrections c JOIN economy_operations o ON o.id=c.operation_id
  WHERE o.client_id=? AND c.disposition='held' ORDER BY c.id DESC LIMIT 500`).all(client);
 return {sources,domain_gates,releases:database.query('SELECT * FROM economy_benefit_releases WHERE client_id=? ORDER BY created_at DESC LIMIT 500').all(client)};
}
/** Only negotiated actor item/currency entitlements have a canonical generic release path.
 * Gloop/public Offering, Wish funding, Clear points/locks and EP require separate domain approval.
 * No generic item-ID conversion, discard, or Bank instruction is available. */
export function release_rollback_benefit(database:Database,id:string,root:string,expected:number,reason:string) {
 return rollback_operator_command(database,id,{kind:'benefit-release',root,expected},reason,()=>{
  const source=database.query<{client_id:number;object_id:string;snapshot_json:string},[string]>('SELECT client_id,object_id,snapshot_json FROM economy_custody_sources WHERE root_key=?').get(root);
  if(!source) throw new Error('Unknown held benefit');
  const snapshot=JSON.parse(source.snapshot_json);
  if(!['market','trade'].includes(snapshot.benefit_kind)||(!snapshot.parent_root&&!snapshot.parent_roots?.length)||
   !/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/.test(source.object_id)||source.object_id.startsWith('multiplayer:'))
   throw new Error('Domain-specific release gate: no generic entitlement release for this benefit');
  if(database.query('SELECT 1 FROM economy_benefit_releases WHERE root_key=?').get(root)) throw new Error('Benefit already released');
  const held=database.query<{quantity:number},[string]>("SELECT quantity FROM economy_custody_balances WHERE root_key=? AND location='held'").get(root)?.quantity;
  if(!Number.isSafeInteger(expected)||expected<1||held!==expected) throw new Error('Held quantity changed');
  if(!database.query('SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL AND disabled=0').get(source.client_id)) throw new Error('Live recipient required; retained benefit remains held');
  const now=Date.now();
  database.query('INSERT INTO economy_benefit_releases VALUES(?,?,?,?,?,?)').run(root,source.client_id,source.object_id,held,reason,now);
  add_inbox_items(source.client_id,[{item_id:source.object_id,qty:held}],{type:'other',name:'Multiplayer'},database);
  // This narrowly authorized transition is deliberately unavailable to generic custody movement.
  database.query('INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason) VALUES(?,?,?,?,?,?)')
   .run(root,'held',`protected:review-release:${id}`,held,now,'operator-authorized-entitlement');
  return {root_key:root,client_id:source.client_id,quantity:held,disposition:'released_to_inbox'};
 });
}
