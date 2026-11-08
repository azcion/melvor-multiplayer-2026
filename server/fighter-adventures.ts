import type { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { legacy_interdict_applies } from './cheat-categories';
import { combat_loadout, combat_reset_balance, level_price } from './combat-progression';
import { adventure_heal, estimate_monster } from './fighter-adventures-math';
import { sample_loot } from './fighter-adventures-loot';
import type { JsonObject } from './http';
import { add_inbox_items } from './inbox';
import { ep_balance, settle_wish_capacity } from './wish-capacity';
import { rollback_held } from './rollback-policy';
import { record_economy_operation } from './save-rollback';
import { ADVENTURE_CATALOG, ADVENTURE_HOUR, ADVENTURE_INTERVAL, adventure_items, type AdventureMonster, type AdventureArea, type AdventureCatalog } from './fighter-adventures-catalog';
import { tutorial_complete } from './combat-tutorial';

type Eligibility = { discovered: string[]; owned_dlc: string[] };
type Progress = Record<string, { fraction: number; serial: number }>;
export type AdventureRow = { client_id: number; area_id: string | null; opted_in: number; capacity: number; invested_micros: number;
	revision: number; last_at: number; used_ms: number; pool_json: string; progress_json: string; pending_json: string;
	eligibility_json: string; efficiency: number; haul_revision: number; seen_revision: number };
const rejected = (error = 'rejected') => ({ success: false, error });
export function read_adventure(database: Database, client: number) {
	return database.query<AdventureRow,[number]>('SELECT * FROM fighter_adventures WHERE client_id=?').get(client);
}
export function adventure_social(database: Database, client: number, now = Date.now()): boolean {
	const row = database.query<{ restricted: number; guild_enforced: number; cheats_detected_at: number | null },[number]>(`
		SELECT (c.social_mode='social' OR c.social_mode_enforced=1 OR COALESCE(a.social_mode_enforced,0)=1) AS restricted,
		COALESCE(g.cheat_restriction_enabled,0) AS guild_enforced,c.cheats_detected_at
		FROM clients c LEFT JOIN melvor_accounts a ON a.id=c.melvor_account_id
		LEFT JOIN guild_memberships m ON m.client_id=c.id LEFT JOIN guilds g ON g.id=m.guild_id WHERE c.id=?`).get(client);
	return !!row && (!!row.restricted || (!!row.guild_enforced && legacy_interdict_applies(row.cheats_detected_at,now)));
}
export function parse_adventure_eligibility(value: unknown): Eligibility | null {
	if (!value || typeof value !== 'object') return null;
	const report = value as Eligibility;
	if (!Array.isArray(report.discovered) || report.discovered.length > 512 || report.discovered.some(id => typeof id !== 'string' || id.length>256) ||
		!Array.isArray(report.owned_dlc) || report.owned_dlc.length>3 || report.owned_dlc.some(id => !['melvorAoD','melvorTotH','melvorItA'].includes(id))) return null;
	return { discovered: [...new Set(report.discovered)], owned_dlc: [...new Set(report.owned_dlc)] };
}
function catalog_signature(catalog:AdventureCatalog):string {return createHash('sha256').update(JSON.stringify(catalog)).digest('hex');}
type Snapshot = { signature:string; version:number; monsters:AdventureMonster[]; discovered:string[] };
function selection(area:AdventureArea,input:unknown):AdventureMonster[]|null {
	if(!Array.isArray(input)||!input.length||input.length>area.monsters.length||new Set(input).size!==input.length||input.some(id=>typeof id!=='string'||!area.monsters.some(m=>m.id===id)))return null;
	return area.monsters.filter(m=>input.includes(m.id));
}
function production(database:Database,client:number,monsters:AdventureMonster[],catalog:AdventureCatalog) {
	const loadout=combat_loadout(database,client),heal=adventure_heal(database,client);
	const estimates=monsters.map(m=>estimate_monster(loadout,heal,m,catalog));
	return estimates.length&&estimates.every(e=>e.eligible)?1/estimates.reduce((sum,e)=>sum+e.seconds,0):0;
}
export function adventure_efficiency(database:Database,client:number,area:AdventureArea):number {
	return production(database,client,area.monsters,ADVENTURE_CATALOG);
}
export function adventure_multiplier(others:number):number {return 1+others*(others+1)/2*0.01;}
function boosted_elapsed(database:Database,client:number,area:string,start:number,end:number):number {
 const rows=database.query<{started_at:number;ended_at:number|null},[string,number,number,number]>(
  'SELECT started_at,ended_at FROM adventure_participation WHERE area_id=? AND client_id!=? AND started_at<? AND (ended_at IS NULL OR ended_at>?)').all(area,client,end,start);
 const events=new Map<number,number>();let count=0;
 for(const r of rows){if(r.started_at<=start)count++;else events.set(r.started_at,(events.get(r.started_at)??0)+1);if(r.ended_at!==null&&r.ended_at<end)events.set(r.ended_at,(events.get(r.ended_at)??0)-1);}
 let at=start,total=0;
 for(const [time,delta] of [...events].sort((a,b)=>a[0]-b[0])){total+=(time-at)*adventure_multiplier(count);count+=delta;at=time;}
 return total+(end-at)*adventure_multiplier(count);
}
export function accrue_adventure(database: Database, client: number, now = Date.now()): void {
	const row=read_adventure(database,client);
	if (!row || !row.area_id || now<=row.last_at) return;
	const elapsed=Math.min(now-row.last_at,Math.max(0,row.capacity*ADVENTURE_HOUR-row.used_ms));
	const progress=JSON.parse(row.progress_json) as Progress;
	const pending=JSON.parse(row.pending_json) as Record<string,number>;
	const saved=JSON.parse(row.pool_json) as Snapshot;
	const permitted=(!adventure_social(database,client,now)||row.opted_in===1) && !rollback_held(database,client);
	if (permitted && saved.monsters) for (const monster of saved.monsters) {
		const entry=progress[monster.id] ?? {fraction:0,serial:0};
		let effective=0;
		for(let offset=0;offset<elapsed;offset+=ADVENTURE_HOUR)effective+=boosted_elapsed(database,client,row.area_id,row.last_at+offset,row.last_at+Math.min(elapsed,offset+ADVENTURE_HOUR));
		entry.fraction+=effective/1000*row.efficiency;
		const kills=Math.floor(entry.fraction+1e-10);entry.fraction=Math.max(0,entry.fraction-kills);entry.serial+=kills;
		if(kills)for(const [id,qty]of Object.entries(sample_loot(monster,kills,new Set(saved.discovered))))pending[id]=(pending[id]??0)+qty;
		progress[monster.id]=entry;
	}
	database.query('UPDATE fighter_adventures SET last_at=?,used_ms=used_ms+?,progress_json=?,pending_json=? WHERE client_id=?')
		.run(now,elapsed,JSON.stringify(progress),JSON.stringify(pending),client);
}
function end_assignment(database:Database,client:number,now:number,reason:string) {
	payout(database,client,reason,now);
	database.query("UPDATE fighter_adventures SET area_id=NULL,pool_json='[]',progress_json='{}',efficiency=0,revision=revision+1 WHERE client_id=?").run(client);
}
export function refresh_adventure_efficiency(database: Database, client: number, now=Date.now(),catalog=ADVENTURE_CATALOG): void {
	const row=read_adventure(database,client);
	if(!row?.area_id)return;
	const saved=JSON.parse(row.pool_json) as Snapshot;
	const area=catalog.areas.find(a=>a.id===row.area_id);
	if(saved.signature!==catalog_signature(catalog)||!area) {end_assignment(database,client,now,'catalog-change');return;}
	const monsters=selection(area,saved.monsters.map(m=>m.id));
	const rate=monsters?production(database,client,monsters,catalog):0;
	if(!rate){end_assignment(database,client,now,'loadout-change');return;}
	database.query('UPDATE fighter_adventures SET efficiency=? WHERE client_id=?').run(rate,client);
}
function payout(database: Database, client: number, reason: string, now: number) {
	const row=read_adventure(database,client)!;
	const items=Object.entries(JSON.parse(row.pending_json) as Record<string,number>).filter(([,qty])=>qty>0).map(([item_id,qty])=>({item_id,qty}));
	if (items.length) {
		add_inbox_items(client,items,{type:'fighter_adventures',name:'Adventures'},database);
		record_economy_operation(database,{source_key:`adventure-payout:${client}:${row.revision+1}`,client_id:client,kind:'adventure-payout',local_effect:'server_only',committed_at:now,evidence:{items,reason}});
	}
	database.query('UPDATE fighter_adventures SET pending_json=\'{}\',used_ms=0,last_at=?,revision=revision+1,haul_revision=haul_revision+? WHERE client_id=?')
		.run(now,reason==='login' && items.length>0 ? 1 : 0,client);
}
function monster_rewards(monster:AdventureMonster) {
 const items:Record<string,number>={};
 const weight=monster.lootTable.reduce((n,r)=>n+r.weight,0);
 for(const r of monster.lootTable)items[r.itemID]=(items[r.itemID]??0)+monster.lootChance/100*r.weight/weight*(r.minQuantity+r.maxQuantity)/2;
 if(monster.bones)items[monster.bones.itemID]=(items[monster.bones.itemID]??0)+monster.bones.quantity;
 for(const c of monster.currencyDrops)items[c.currencyID]=(items[c.currencyID]??0)+(c.min+c.max)/2;
 return Object.entries(items).map(([item_id,per_kill])=>({item_id,per_kill}));
}
export function adventure_state(database: Database, client: number, now = Date.now(), catalog=ADVENTURE_CATALOG) {
	const row=read_adventure(database,client);
	const report=parse_adventure_eligibility(row ? JSON.parse(row.eligibility_json) : null) ?? {discovered:[],owned_dlc:[]};
	const free=combat_reset_balance(database,client)>0;
	const loadout=combat_loadout(database,client),heal=adventure_heal(database,client);
	return { supported:true, server_time:now, interval_ms:ADVENTURE_INTERVAL, character_ready:!!combat_loadout(database,client),
		tutorial_complete:tutorial_complete(database,client),
		social_only:adventure_social(database,client,now), opted_in:row?.opted_in===1, active_area:row?.area_id??null, capacity:row?.capacity??1,
		invested_micros:row?.invested_micros??0, revision:row?.revision??0, ep_micros:ep_balance(database,client),
		reset_refund_micros:Math.round((row?.invested_micros??0)*(free?1:0.9)), free_reset:free,
		haul_revision:row?.haul_revision??0, seen_revision:row?.seen_revision??0, unread:(row?.haul_revision??0)>(row?.seen_revision??0),
		used_ms:row?.used_ms??0,
		active_monsters:row?.area_id?(JSON.parse(row.pool_json) as Snapshot).monsters?.map(m=>m.id)??[]:[],
		areas:catalog.areas.map(area=>{
			const monsters=area.monsters.map(m=>({...estimate_monster(loadout,heal,m,catalog),id:m.id,name:m.name,rewards:monster_rewards(m)}));
			const others=database.query<{n:number},[string,number,number,number]>('SELECT COUNT(*) AS n FROM adventure_participation WHERE area_id=? AND client_id!=? AND started_at<=? AND ended_at>?').get(area.id,client,now,now)!.n;
			return {id:area.id,name:area.name,fighter_count:others+(row?.area_id===area.id && row.last_at+Math.max(0,row.capacity*ADVENTURE_HOUR-row.used_ms)>now?1:0),kill_multiplier:adventure_multiplier(others),monsters,items:adventure_items(area).map(item_id=>({item_id,dlc:null,eligible:report.discovered.includes(item_id)}))};
		}) };

}
export function adventure_action(database: Database, client: number, action: string, input: Record<string,unknown>, now=Date.now(), catalog=ADVENTURE_CATALOG): JsonObject {
	if (!Number.isSafeInteger(now)||now<0||rollback_held(database,client)) return rejected();
	if (!combat_loadout(database,client)) return rejected('fighter_required');
	if (['start','capacity'].includes(action) && !tutorial_complete(database,client)) return rejected('tutorial_required');
	const report=['start','check-in'].includes(action)?parse_adventure_eligibility(input.eligibility):null;
	if (['start','check-in'].includes(action)&&!report) return rejected('invalid_eligibility');
	const area=action==='start'?catalog.areas.find(a=>a.id===input.area_id):undefined;
	if (action==='start'&&!area) return rejected('area_required');
	const selected=area?selection(area,input.monster_ids):null;
	if(action==='start'&&!selected)return rejected('monsters_required');
	if(action==='start'&&!production(database,client,selected!,catalog))return rejected('fighter_not_ready');
	if (action==='check-in'&&input.reason!=='login'&&input.reason!=='online') return rejected();
	const previous=read_adventure(database,client);
	// Consume the revision observed by the caller, never reapply a stale intent to a newer assignment.
	if (action!=='seen' && (previous?.revision??0)!==input.revision)
		return rejected(['capacity','reset-capacity'].includes(action)?'quote_changed':'adventure_changed');
	if (action==='capacity' && (!Number.isSafeInteger(input.target)||Number(input.target)<2||Number(input.target)>99||Number(input.target)<=(previous?.capacity??1))) return rejected();
	if (action==='opt-in'&&typeof input.enabled!=='boolean') return rejected();
	if (!['start','stop','check-in','capacity','reset-capacity','opt-in','seen'].includes(action)) return rejected();
	if (action==='seen' && (!Number.isSafeInteger(input.haul_revision)||Number(input.haul_revision)<0||Number(input.haul_revision)>(previous?.haul_revision??0))) return rejected();
	if (action==='start' && adventure_social(database,client,now) && previous?.opted_in!==1) return rejected('opt_in_required');
	if (action==='reset-capacity'&& !previous?.invested_micros) return rejected('nothing_to_reset');
	if(action==='capacity'||action==='reset-capacity') settle_wish_capacity(database,client,now);
	let cost=0;
	if (action==='capacity') {
		for(let h=(previous?.capacity??1)+1;h<=Number(input.target);h++) cost+=level_price(h);
		if(ep_balance(database,client)<cost) return rejected('insufficient_ep');
	}
	if (action==='reset-capacity' && !Number.isSafeInteger(ep_balance(database,client)+previous!.invested_micros)) return rejected();
	database.query('INSERT INTO fighter_adventures(client_id,last_at) VALUES(?,?) ON CONFLICT DO NOTHING').run(client,now);
	if(action==='seen') {
		const updated=database.query('UPDATE fighter_adventures SET seen_revision=? WHERE client_id=? AND seen_revision<?')
			.run(Number(input.haul_revision),client,Number(input.haul_revision));
		if (updated.changes) database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
		return {success:true};
	}
	if(action==='check-in'&&input.reason==='online'&&previous&&previous.used_ms+Math.max(0,now-previous.last_at)<ADVENTURE_INTERVAL) return {success:true,too_soon:true};
	accrue_adventure(database,client,now);
	if(action==='check-in'||action==='stop'||(action==='opt-in'&&input.enabled===false)||action==='reset-capacity') payout(database,client,action==='check-in'?String(input.reason):'stop',now);
	if(action==='capacity'||action==='reset-capacity') {
		const row=read_adventure(database,client)!;
		const free=action==='reset-capacity'&&combat_reset_balance(database,client)>0;
		const amount=action==='capacity'?-cost:Math.round(row.invested_micros*(free?1:0.9));
		database.query('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,0) ON CONFLICT DO NOTHING').run(client);
		database.query('UPDATE expedition_ep_balances SET points_micros=points_micros+? WHERE client_id=?').run(amount,client);
		const ledger_id=randomUUID();
		database.query('INSERT INTO combat_ep_ledger(client_id,command_id,amount_micros,created_at) VALUES(?,?,?,?)').run(client,ledger_id,amount,now);
		record_economy_operation(database,{source_key:`adventure-ep:${ledger_id}`,client_id:client,kind:`adventure-${action}`,
			local_effect:'server_only',committed_at:now,evidence:{amount_micros:amount}});
		if(free) database.query('UPDATE combat_reset_balances SET resets=resets-1 WHERE client_id=?').run(client);
		database.query('UPDATE fighter_adventures SET capacity=?,invested_micros=?,revision=revision+1 WHERE client_id=?').run(action==='capacity'?Number(input.target):1,action==='capacity'?row.invested_micros+cost:0,client);
	}
	if(action==='opt-in') database.query('UPDATE fighter_adventures SET opted_in=?,area_id=CASE WHEN ?=0 THEN NULL ELSE area_id END,revision=revision+1 WHERE client_id=?').run(input.enabled?1:0,input.enabled?1:0,client);
	if(action==='stop') database.query('UPDATE fighter_adventures SET area_id=NULL,revision=revision+1 WHERE client_id=?').run(client);
	if(action==='start'&&previous?.area_id)end_assignment(database,client,now,'selection-change');
	if (action==='start' && !previous?.area_id) database.query('UPDATE fighter_adventures SET last_at=MAX(last_at,?) WHERE client_id=?').run(now,client);
	if(report) {
		if(action==='check-in')refresh_adventure_efficiency(database,client,now,catalog);
		const active=read_adventure(database,client)!;
		const saved=JSON.parse(active.pool_json) as Snapshot;
		const monsters=action==='start'?selected!:active.area_id?saved.monsters:[];
		const active_area=action==='start'?area!.id:active.area_id;
		const snapshot:Snapshot={signature:catalog_signature(catalog),version:catalog.version,monsters,discovered:report.discovered};
		database.query('UPDATE fighter_adventures SET eligibility_json=?,area_id=?,pool_json=?,efficiency=?,revision=revision+1 WHERE client_id=?').run(JSON.stringify(report),active_area,JSON.stringify(snapshot),monsters.length?production(database,client,monsters,catalog):0,client);
	}
	if(action==='capacity'||(action==='opt-in'&&input.enabled===true))refresh_adventure_efficiency(database,client,now,catalog);
	if(action==='stop'||(action==='opt-in'&&input.enabled===false))database.query("UPDATE fighter_adventures SET progress_json='{}',pool_json='[]',efficiency=0 WHERE client_id=?").run(client);

	database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
	return {success:true};
}
