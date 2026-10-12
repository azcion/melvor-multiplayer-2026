import type { Database } from 'bun:sqlite';
import type { DurableAuditContext } from './audit-context';
import { rollback_affected, rollback_held } from './rollback-policy';

// Bank/source mutations and membership transitions can consume, return, or reassign custody.
// Friends, Raids, votes and independent work tracking do not spend these sources.
const unsafe_paths = new Set([
 '/api/inbox/claim','/api/banishment/returns/claim','/api/expedition/supply/donate',
 '/api/identities/delete','/api/identities/delete/cancel',
 '/api/guilds/create','/api/guilds/join','/api/guilds/join-free','/api/guilds/application/decide','/api/guilds/leave',
 '/api/guilds/petitions/raise','/api/guilds/petitions/vote','/api/guilds/petitions/withdraw'
]);
export function unsafe_rollback_request(path:string,method:string):boolean {
 if(method!=='POST') return false;
 return unsafe_paths.has(path) || path.startsWith('/api/gift/') || path.startsWith('/api/trade/') ||
  path.startsWith('/api/crucible/') || path.startsWith('/api/social-mode/') || path.startsWith('/api/campaign/') ||
  path.startsWith('/api/expedition/debug/') || (path.startsWith('/api/market/') && !['/api/market/catalog','/api/market/search'].includes(path));
}
/** Only typed participant references are consulted; sibling timestamps are never compared. */
export function rollback_request_clients(database:Database,path:string,json:Record<string,unknown>|null,actor:number):number[] {
 const clients=new Set<number>([actor]);
 const add=(row:Record<string,unknown>|null)=>{if(row) for(const value of Object.values(row)) if(typeof value==='number'&&Number.isSafeInteger(value)&&value>0) clients.add(value);};
 const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>0;
 if((path==='/api/gift/send'||path==='/api/trade/offer')&&integer(json?.recipient_id)) clients.add(json.recipient_id);
 if(path.startsWith('/api/gift/')&&integer(json?.gift_id)) add(database.query<Record<string,unknown>,[number]>('SELECT sender_id,client_id FROM gifts WHERE gift_id=?').get(json.gift_id));
 if(path.startsWith('/api/trade/')&&integer(json?.trade_id)) add(database.query<Record<string,unknown>,[number]>('SELECT sender_id,recipient_id FROM trade_offers WHERE trade_id=?').get(json.trade_id));
 if(path.startsWith('/api/market/haggle/')&&typeof json?.id==='string') {
  // Terminal claims transfer already-owned entitlements; another party's hold cannot revoke them.
  // The actor's own uncertain/unissued benefit is still gated below and by custody.
  const terminal_claim=path==='/api/market/haggle/claim' && database.query("SELECT 1 FROM market_haggles WHERE id=? AND status<>'active'").get(json.id)!==null;
  if(!terminal_claim) add(database.query<Record<string,unknown>,[string]>('SELECT owner_id,initiator_id FROM market_haggles WHERE id=?').get(json.id));
 }
 else if(path.startsWith('/api/market/')&&integer(json?.id)) add(database.query<Record<string,unknown>,[number]>('SELECT client_id FROM market_items WHERE id=?').get(json.id));
 if(path.startsWith('/api/crucible/wish/')||path==='/api/crucible/clear')
  for(const row of database.query<{id:number},[number]>(`SELECT sibling.id FROM clients actor JOIN clients sibling ON sibling.melvor_account_id=actor.melvor_account_id JOIN guild_memberships am ON am.client_id=actor.id JOIN guild_memberships sm ON sm.client_id=sibling.id AND sm.guild_id=am.guild_id WHERE actor.id=? AND actor.melvor_account_id IS NOT NULL`).all(actor)) clients.add(row.id);
 return [...clients];
}
export function related_rollback_gate(database:Database,clients:number[],actor:number,capable:boolean):RollbackGateError|null {
 const own=rollback_gate(database,actor,capable);if(own) return own;
 return clients.some(client=>client!==actor&&rollback_held(database,client))?new RollbackGateError(false):null;
}
export class RollbackGateError extends Error {
 constructor(public readonly upgrade:boolean) {super(upgrade?'Rollback protocol upgrade required':'Economy review pending');}
 response():Response {return Response.json(this.upgrade?{success:false,error:'economy_upgrade_required',required_capability:'save-rollback-v1',
  message:'Please update Multiplayer before using economy actions.'}:{success:false,error:'economy_review_pending',
  message:'Multiplayer economy actions are awaiting review. Please message Multiplayer Support.'},{status:this.upgrade?426:409});}
}
export function rollback_gate(database:Database,client:number,capable:boolean):RollbackGateError|null {
 if(!capable&&rollback_affected(database,client)) return new RollbackGateError(true);
 return rollback_held(database,client)?new RollbackGateError(false):null;
}
export function guard_rollback_write(database:Database,context:DurableAuditContext|undefined):void {
 if(context?.actor_kind!=='client'||context.actor_client_id===null ||
  !unsafe_rollback_request(String(context.details?.path??''),String(context.details?.method??''))) return;
 const clients=typeof context.details?.rollback_clients==='string'?JSON.parse(context.details.rollback_clients) as number[]:[context.actor_client_id];
 const gate=related_rollback_gate(database,clients,context.actor_client_id,context.details?.rollback_capable===true);
 if(gate) throw gate;
}
