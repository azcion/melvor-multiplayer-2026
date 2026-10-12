import type { Database } from 'bun:sqlite';
import type { trade_offers } from './db/types/db_types';
import { create_custody_source, custody_at, inbox_custody_location, move_custody, move_location, record_dependency } from './economy-custody';
import { record_pending_exchange, record_transfer_history } from './transfer-history';

export type TradeItem = { id:number; item_id:string; qty:number; counter:number };
export const trade_position = (id:number) => `trade-item:${id}`;
export const trade_receive_position = (trade:number,client:number,item:string) => `trade-receive:${JSON.stringify([trade,client,item])}`;
export function trade_items(db:Database,id:number):TradeItem[] {
	return db.query<TradeItem,[number]>('SELECT id,item_id,qty,counter FROM trade_items WHERE trade_id=? ORDER BY id').all(id);
}
export function capture_trade_item(db:Database,trade:trade_offers,row:TradeItem,command:unknown,now:number):void {
	if(typeof command!=='string') return; // Missing legacy command tracking is unproven, not misconduct.
	create_custody_source(db,{root_key:`trade:${trade.trade_id}:${row.counter}:${row.id}:${command}`,operation_key:`receipt:${command}`,
		client_id:row.counter===0?trade.sender_id:trade.recipient_id,object_id:row.item_id,quantity:row.qty,created_at:now,
		snapshot:{trade_id:trade.trade_id,sender_id:trade.sender_id,recipient_id:trade.recipient_id,item_row:row.id,counter:row.counter,command_id:command}},trade_position(row.id));
}

/** One row is one exact escrow position, so duplicate item IDs never merge ancestry. */
export function move_trade_item(db:Database,row:TradeItem,to:string,now:number):void {
	const total=custody_at(db,trade_position(row.id)).reduce((sum,r)=>sum+BigInt(r.quantity),0n);
	if(total>BigInt(row.qty)) throw new Error('Trade custody exceeds live item');
	move_location(db,trade_position(row.id),to,now,'trade-delivery');
}

/** DB-only return path for correction cancellation. Caller owns IMMEDIATE transaction. */
export function return_trade_items(db:Database,trade:trade_offers,rows:TradeItem[],now:number,invalid_roots:ReadonlySet<string>=new Set()):void {
	for(const row of rows) {
		const owner=row.counter===0?trade.sender_id:trade.recipient_id;
		let invalid=0;
		for(const root of custody_at(db,trade_position(row.id))) if(invalid_roots.has(root.root_key)) {
			move_custody(db,root.root_key,trade_position(row.id),'invalidated',root.quantity,now,'rollback-trade-principal');invalid+=root.quantity;
		}
		const qty=row.qty-invalid;
		if(qty<0) throw new Error('Invalid Trade custody exceeds live escrow');
		if(qty>0) {
			const existing=db.query<{qty:number},[number,string]>("SELECT qty FROM inbox_items WHERE client_id=? AND source_type='trade_cancelled' AND source_name='' AND item_id=?").get(owner,row.item_id)?.qty??0;
			if(BigInt(existing)+BigInt(qty)>BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Trade return exceeds safe integer');
			db.query(`INSERT INTO inbox_items(client_id,source_type,source_name,item_id,qty,created_at,updated_at) VALUES(?,'trade_cancelled','',?,?,?,?)
				ON CONFLICT(client_id,source_type,source_name,item_id) DO UPDATE SET qty=qty+excluded.qty,updated_at=excluded.updated_at`).run(owner,row.item_id,qty,now,now);
			move_trade_item(db,{...row,qty},inbox_custody_location(owner,'trade_cancelled','',row.item_id),now);
			record_transfer_history(db,{client_id:owner,pane:'inbox',event_type:'trade-cancel',source_key:`trade-return:${trade.trade_id}:${row.id}`,occurred_at:now,items:[{item_id:row.item_id,qty}]});
		}
		db.query('DELETE FROM trade_items WHERE id=?').run(row.id);
	}
	for(const client of [trade.sender_id,trade.recipient_id]) db.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
}
export function terminate_trade(db:Database,id:number,now:number,invalid_roots:ReadonlySet<string>):boolean {
	const trade=db.query<trade_offers,[number]>('SELECT * FROM trade_offers WHERE trade_id=?').get(id);
	if(!trade) return false;
	record_pending_exchange(db,'trade',id,'trade-cancel',now);
	return_trade_items(db,trade,trade_items(db,id),now,invalid_roots);
	db.query('DELETE FROM trade_offers WHERE trade_id=?').run(id);
	return true;
}

/** Barter benefits have distinct units and the complete exact outgoing basket as parents.
 * Historical/missing basket ancestry cannot authorize a hold. */
export function settle_trade(db:Database,trade:trade_offers,now:number,legacy:boolean):void {
	const rows=trade_items(db,trade.trade_id);
	for(const counter of [0,1]) {
		const outgoing=rows.filter(r=>r.counter===counter);
		const owner=counter===0?trade.sender_id:trade.recipient_id;
		const parents=outgoing.flatMap(r=>custody_at(db,trade_position(r.id)));
		const exact=outgoing.length>0 && outgoing.every(r=>custody_at(db,trade_position(r.id)).reduce((sum,p)=>sum+BigInt(p.quantity),0n)===BigInt(r.qty));
		const received=rows.filter(r=>r.counter!==counter);
		if(exact) for(const row of received) {
			const roots=parents.map(p=>p.root_key);
			create_custody_source(db,{root_key:`trade-benefit:${trade.trade_id}:${owner}:${row.id}`,operation_key:`derived:trade:${trade.trade_id}:${owner}`,
				client_id:owner,object_id:row.item_id,quantity:row.qty,created_at:now,
				snapshot:{parent_roots:roots,benefit_kind:'trade',trade_id:trade.trade_id,sender_id:trade.sender_id,recipient_id:trade.recipient_id}},
				legacy && counter===0?`protected:trade-receipt:${trade.trade_id}:${owner}`:trade_receive_position(trade.trade_id,owner,row.item_id));
		} else for(const row of received) {
			const unknown=outgoing.map(r=>({item_row:r.id,item:r.item_id,quantity:r.qty-Number(custody_at(db,trade_position(r.id)).reduce((sum,p)=>sum+BigInt(p.quantity),0n))})).filter(r=>r.quantity>0);
			const snapshot={trade_id:trade.trade_id,owner,object_id:row.item_id,item_row:row.id,unknown_outgoing:unknown,reason:'incomplete-basket-ancestry-review-only'};
			record_dependency(db,null,'trade-historical-benefit',row.qty,snapshot);
			for(const parent of new Set(parents.map(p=>p.root_key))) record_dependency(db,parent,'trade-unresolved-benefit',row.qty,snapshot);
		}
	}
	for(const row of rows) move_trade_item(db,row,`protected:trade-settled:${trade.trade_id}`,now);
}

export function remove_trade_value(db:Database,location:string,item:string,qty:number,owner:number,on_remove:()=>void):boolean {
	if(location.startsWith('trade-item:')) {
		const id=Number(location.slice(11));
		const row=db.query<{qty:number;item_id:string;client_id:number;declined:number},[number]>(`SELECT i.qty,i.item_id,t.client_id,t.declined FROM trade_items i JOIN resolved_trade_offers t ON t.trade_id=i.trade_id WHERE i.id=?`).get(id);
		if(!row || row.declined!==1 || row.client_id!==owner || row.item_id!==item || row.qty<qty) return false;
		on_remove();
		if(row.qty===qty) db.query('DELETE FROM trade_items WHERE id=?').run(id);
		else db.query('UPDATE trade_items SET qty=qty-? WHERE id=?').run(qty,id);
		return true;
	}
	if(!location.startsWith('trade-receive:')) return false;
	const [id,client,object]=JSON.parse(location.slice(14)) as [number,number,string];
	if(client!==owner || object!==item) throw new Error('Trade benefit identity differs from custody');
	const resolved=db.query('SELECT 1 FROM resolved_trade_offers WHERE trade_id=? AND client_id=? AND declined=0').get(id,owner);
	const rows=trade_items(db,id).filter(r=>r.item_id===item);
	if(!resolved || rows.reduce((sum,r)=>sum+BigInt(r.qty),0n)<BigInt(qty)) return false;
	on_remove();
	let remaining=qty;
	for(const row of rows) {
		const removed=Math.min(row.qty,remaining);if(!removed) break;
		if(removed===row.qty) db.query('DELETE FROM trade_items WHERE id=?').run(row.id);
		else db.query('UPDATE trade_items SET qty=qty-? WHERE id=?').run(removed,row.id);
		remaining-=removed;
	}
	return true;
}
export function trade_correction_cache_clients(db:Database,operation:string):number[] {
	const clients=new Set<number>();
	for(const row of db.query<{client_id:number;snapshot_json:string},[string]>('SELECT client_id,snapshot_json FROM economy_custody_sources WHERE operation_key=?').all(operation)) {
		clients.add(row.client_id);
		const snapshot=JSON.parse(row.snapshot_json) as {sender_id?:number;recipient_id?:number};
		for(const id of [snapshot.sender_id,snapshot.recipient_id]) if(typeof id==='number') clients.add(id);
	}
	return [...clients].sort((a,b)=>a-b);
}
