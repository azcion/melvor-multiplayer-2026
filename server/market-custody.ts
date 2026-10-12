import type { Database } from 'bun:sqlite';
import type { market_items, market_haggles } from './db/types/db_types';
import { create_custody_source, custody_at, move_custody, move_custody_fifo, move_location, record_dependency } from './economy-custody';

export const market_position = (id: number, kind: 'stock' | 'gp' | 'payout') => `market:${id}:${kind}`;
export const haggle_position = (id: string, kind: 'stock' | 'gp' | 'reserve') => `haggle:${id}:${kind}`;
export const haggle_claim_position = (id: string, client: number, item: string) => `haggle-claim:${id}:${client}:${item}`;
function custody_total_from(rows:Array<{quantity:number}>):number {
	const total = rows.reduce((sum,row)=>sum+BigInt(row.quantity),0n);
	if(total>BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Custody total exceeds safe integer');
	return Number(total);
}
export function custody_total(db:Database,location:string):number {return custody_total_from(custody_at(db,location));}

/** Historical live prefix precedes every prospective deposit. Never attribute it to a newer root. */
export function move_market_fifo(db: Database, from: string, to: string, amount: number, live: number, now: number): void {
	if(amount===0) return;
	const known=custody_total(db,from);
	if(known>live || amount>live) throw new Error('Marketplace custody exceeds live escrow');
	const mapped=move_custody_fifo(db,from,to,amount,now,'market-fifo',live-known);
	if(mapped<amount) record_dependency(db,null,'market-historical-prefix',amount-mapped,{from,to,amount,live,now});
}

/** Exact actor benefits use their own units, independent of principal units. */
export function market_benefit(db: Database, parent: string, key: string, item: string, qty: number, to: string, now: number): void {
	if(qty===0) return;
	const source=db.query<{operation_key:string;client_id:number},[string]>('SELECT operation_key,client_id FROM economy_custody_sources WHERE root_key=?').get(parent)!;
	create_custody_source(db,{root_key:`market-benefit:${key}:${parent}`,operation_key:`derived:${source.operation_key}`,
		client_id:source.client_id,object_id:item,quantity:qty,created_at:now,snapshot:{parent_root:parent,benefit_kind:'market'}},to);
}

/** Move settled principal and capture the exact actor proceeds of each mapped FIFO allocation. */
export function settle_market_fifo(db: Database, from: string, live: number, qty: number, price: number,
	benefit_item: string, benefit_to: string, key: string, now: number, divisor=1, offset=0): void {
	const before=custody_at(db,from);
	move_market_fifo(db,from,`protected:market:${key}`,qty,live,now);
	const after=new Map(custody_at(db,from).map(row=>[row.root_key,row.quantity]));
	let cursor=BigInt(offset)+BigInt(Math.min(qty,live-custody_total_from(before)));
	const denominator=BigInt(divisor);
	for(const row of before) {
		const moved=row.quantity-(after.get(row.root_key)??0);
		if(moved>0) {
			const start=(cursor+denominator-1n)/denominator;
			const end=(cursor+BigInt(moved))/denominator;
			const units=Number(end>start?end-start:0n);
			if(units>0) market_benefit(db,row.root_key,key,benefit_item,units*price,benefit_to,now);
			if(units*divisor<moved) record_dependency(db,row.root_key,'market-mixed-benefit',moved-units*divisor,
				{benefit_item,benefit_to,key,divisor,reason:'indivisible-benefit-boundary-review',now});
			cursor+=BigInt(moved);
		}
	}
}

export function add_haggle_claim(db: Database, id: string, client: number, item: string | null, qty: number, gp: number): void {
	if(qty===0 && gp===0) return;
	db.query(`INSERT INTO market_haggle_claims(haggle_id,client_id,item_id,item_qty,gp) VALUES(?,?,?,?,?)
		ON CONFLICT(haggle_id,client_id) DO UPDATE SET item_id=COALESCE(market_haggle_claims.item_id,excluded.item_id),
		item_qty=item_qty+excluded.item_qty,gp=gp+excluded.gp`).run(id,client,item,qty,gp);
}

/** Shared by normal expiry/cleanup and correction; caller owns an IMMEDIATE transaction. */
export function terminate_haggle(db: Database, h: market_haggles, status: 'cancelled'|'rejected'|'expired',
	now: number, invalid_root?: string): boolean {
	const changed=db.query("UPDATE market_haggles SET status=?,turn_client_id=NULL,expires_at=NULL,terminal_at=?,updated_at=? WHERE id=? AND status='active' AND revision=?")
		.run(status,now,now,h.id,h.revision);
	if(!changed.changes) return false;
	const retire=(kind:'stock'|'gp'|'reserve')=>{
		const location=haggle_position(h.id,kind);
		let invalid=0;
		for(const row of custody_at(db,location)) if(row.root_key===invalid_root) {
			move_custody(db,row.root_key,location,'invalidated',row.quantity,now,'rollback-haggle-principal');invalid+=row.quantity;
		}
		return invalid;
	};
	const stock_invalid=retire('stock'),gp_invalid=retire('gp'),reserve_invalid=retire('reserve');
	const stock=h.item_qty-stock_invalid;
	const reserve=h.listing_reserved_gp-reserve_invalid;
	if(h.listing_id!==null) {
		const restored=h.direction==='sell'?stock:reserve/h.listing_price;
		if(!Number.isSafeInteger(restored)) throw new Error('Reserved GP does not conserve listing units');
		db.query('UPDATE market_items SET available=available+?,reserved=reserved-?,haggled=haggled+?,escrow_gp=escrow_gp+?,updated_at=? WHERE id=?')
			.run(restored,h.item_qty,h.item_qty-restored,reserve,now,h.listing_id);
		move_location(db,haggle_position(h.id,h.direction==='sell'?'stock':'reserve'),market_position(h.listing_id,h.direction==='sell'?'stock':'gp'),now,'haggle-restored');
	} else if(h.direction==='sell') {
		add_haggle_claim(db,h.id,h.owner_id,h.item_id,stock,0);
		move_location(db,haggle_position(h.id,'stock'),haggle_claim_position(h.id,h.owner_id,h.item_id),now,'haggle-owner-return');
	}
	if(h.direction==='sell') {
		add_haggle_claim(db,h.id,h.initiator_id,null,0,h.payer_escrow_gp-gp_invalid);
		move_location(db,haggle_position(h.id,'gp'),haggle_claim_position(h.id,h.initiator_id,h.currency_id),now,'haggle-return');
	} else {
		add_haggle_claim(db,h.id,h.initiator_id,h.item_id,stock,0);
		move_location(db,haggle_position(h.id,'stock'),haggle_claim_position(h.id,h.initiator_id,h.item_id),now,'haggle-return');
		add_haggle_claim(db,h.id,h.owner_id,null,0,h.payer_escrow_gp-h.listing_reserved_gp-gp_invalid);
		move_location(db,haggle_position(h.id,'gp'),haggle_claim_position(h.id,h.owner_id,h.currency_id),now,'haggle-topup-return');
		if(h.listing_id===null) {
			add_haggle_claim(db,h.id,h.owner_id,null,0,reserve);
			move_location(db,haggle_position(h.id,'reserve'),haggle_claim_position(h.id,h.owner_id,h.currency_id),now,'haggle-reserve-return');
		}
	}
	for(const client of [h.owner_id,h.initiator_id]) db.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(client);
	return true;
}

export function cancel_market_client(db:Database,client:number,now:number):void {
	for(const h of db.query<market_haggles,[number,number]>("SELECT * FROM market_haggles WHERE status='active' AND (initiator_id=? OR owner_id=?)").all(client,client))
		terminate_haggle(db,h,'cancelled',now);
}
export function listing_return_items(lot:market_items):Array<{item_id:string;qty:number;from:string}> {
	if(lot.direction==='buy') return [{item_id:'melvorD:GP',qty:lot.escrow_gp,from:market_position(lot.id,'gp')}];
	return [{item_id:lot.item_id,qty:lot.available,from:market_position(lot.id,'stock')},
		{item_id:lot.currency_id,qty:(lot.qty-lot.available-lot.reserved-lot.haggled)*lot.price-lot.price_adjustment-lot.payout,from:market_position(lot.id,'payout')}];
}

/** Remove only an exact unissued position; original quantities remain in custody/snapshot history. */
export function remove_market_value(db:Database,location:string,item:string,qty:number,owner:number,on_remove:()=>void):boolean {
	if(location.startsWith('market:')) {
		const [,id,kind]=location.split(':');
		const lot=db.query<market_items,[number]>('SELECT * FROM market_items WHERE id=?').get(Number(id));
		if(!lot || lot.client_id!==owner) return false;
		if(kind==='stock' && lot.direction==='sell' && lot.item_id===item && lot.available>=qty) {
			on_remove();
			db.query('UPDATE market_items SET available=available-?,haggled=haggled+? WHERE id=?').run(qty,qty,lot.id);return true;
		}
		if(kind==='payout' && lot.direction==='sell' && lot.currency_id===item) {
			const unpaid=(lot.qty-lot.available-lot.reserved-lot.haggled)*lot.price-lot.price_adjustment-lot.payout;
			if(!Number.isSafeInteger(unpaid) || unpaid<qty || BigInt(lot.payout)+BigInt(qty)>BigInt(Number.MAX_SAFE_INTEGER)) return false;
			on_remove();
			db.query('UPDATE market_items SET payout=payout+? WHERE id=?').run(qty,lot.id);return true;
		}
		if(kind==='gp' && lot.direction==='buy' && item==='melvorD:GP' && lot.escrow_gp>=qty && qty%lot.price===0) {
			on_remove();
			db.query('UPDATE market_items SET available=available-?,haggled=haggled+?,escrow_gp=escrow_gp-? WHERE id=?')
				.run(qty/lot.price,qty/lot.price,qty,lot.id);return true;
		}
		return false;
	}
	if(location.startsWith('haggle-claim:')) {
		const [,id,client,...object]=location.split(':');
		if(Number(client)!==owner || object.join(':')!==item) throw new Error('Haggle claim identity differs from custody');
		const claim=db.query<{item_id:string|null;item_qty:number;gp:number;currency_id:string},[string,number]>(
			'SELECT c.*,h.currency_id FROM market_haggle_claims c JOIN market_haggles h ON h.id=c.haggle_id WHERE c.haggle_id=? AND c.client_id=? AND c.claimed_at IS NULL').get(id!,owner);
		if(!claim) return false;
		const stock=item===claim.item_id && claim.item_qty>=qty;
		const currency=item===claim.currency_id && claim.gp>=qty;
		if(!stock && !currency) return false;
		on_remove();
		const remaining_stock=claim.item_qty-(stock?qty:0),remaining_gp=claim.gp-(stock?0:qty);
		if(remaining_stock===0 && remaining_gp===0) db.query('DELETE FROM market_haggle_claims WHERE haggle_id=? AND client_id=?').run(id!,owner);
		else db.query('UPDATE market_haggle_claims SET item_id=?,item_qty=?,gp=? WHERE haggle_id=? AND client_id=?')
			.run(remaining_stock===0?null:claim.item_id,remaining_stock,remaining_gp,id!,owner);
		return true;
	}
	if(location.startsWith('inbox:')) {
		const [client,type,name,object]=JSON.parse(location.slice(6)) as [number,string,string,string];
		if(client!==owner || object!==item) throw new Error('Benefit Inbox identity differs from custody');
		const row=db.query<{qty:number},[number,string,string,string]>('SELECT qty FROM inbox_items WHERE client_id=? AND source_type=? AND source_name=? AND item_id=?').get(client,type,name,item);
		if(!row || row.qty<qty) return false;
		on_remove();
		if(row.qty===qty) db.query('DELETE FROM inbox_items WHERE client_id=? AND source_type=? AND source_name=? AND item_id=?').run(client,type,name,item);
		else db.query('UPDATE inbox_items SET qty=qty-? WHERE client_id=? AND source_type=? AND source_name=? AND item_id=?').run(qty,client,type,name,item);
		return true;
	}
	for(const [prefix,table] of [['deletion-return','client_deletion_returns'],['banishment-return','banishment_returns']] as const) {
		if(!location.startsWith(`${prefix}:`)) continue;
		const id=Number(location.split(':')[1]);
		const row=db.query<{gp:number;client_id:number},[number]>(`SELECT gp,client_id FROM ${table} WHERE id=?`).get(id);
		if(!row || row.client_id!==owner) return false;
		if(item==='melvorD:GP' && row.gp>=qty) {on_remove();db.query(`UPDATE ${table} SET gp=gp-? WHERE id=?`).run(qty,id);return true;}
		const items=table==='client_deletion_returns'?'client_deletion_return_items':'banishment_return_items';
		const value=db.query<{qty:number},[number,string]>(`SELECT qty FROM ${items} WHERE return_id=? AND item_id=?`).get(id,item);
		if(!value || value.qty<qty) return false;
		on_remove();
		if(value.qty===qty) db.query(`DELETE FROM ${items} WHERE return_id=? AND item_id=?`).run(id,item);
		else db.query(`UPDATE ${items} SET qty=qty-? WHERE return_id=? AND item_id=?`).run(qty,id,item);return true;
	}
	return false;
}

/** Cache eviction handoff for the future admission caller; retained snapshots survive live-row cleanup. */
export function market_correction_cache_clients(db:Database,operation_key:string):number[] {
	const clients=new Set<number>();
	const add=(value:unknown)=>{if(typeof value==='number' && Number.isSafeInteger(value) && value>0) clients.add(value);};
	for(const source of db.query<{client_id:number;snapshot_json:string},[string]>('SELECT client_id,snapshot_json FROM economy_custody_sources WHERE operation_key=?').all(operation_key)) {
		add(source.client_id);
		const snapshot=JSON.parse(source.snapshot_json) as {listing_id?:number;haggle_id?:string;seller_id?:number;buyer_id?:number;party?:number};
		add(snapshot.seller_id);add(snapshot.buyer_id);add(snapshot.party);
		if(snapshot.listing_id!==undefined) {
			add(db.query<{client_id:number},[number]>('SELECT client_id FROM market_items WHERE id=?').get(snapshot.listing_id)?.client_id);
			add(db.query<{client_id:number},[number]>("SELECT json_extract(snapshot_json,'$.client_id') client_id FROM economy_terminal_snapshots WHERE table_name='market_items' AND row_id=? ORDER BY id DESC LIMIT 1").get(snapshot.listing_id)?.client_id);
			// Stock/GP roots also reach reservations created by a different command.
			for(const row of db.query<{initiator_id:number;owner_id:number},[number]>("SELECT DISTINCT json_extract(snapshot_json,'$.initiator_id') initiator_id,json_extract(snapshot_json,'$.owner_id') owner_id FROM economy_terminal_snapshots WHERE table_name='market_haggles' AND json_extract(snapshot_json,'$.listing_ref')=?").all(snapshot.listing_id)) {add(row.initiator_id);add(row.owner_id);}
		}
		if(snapshot.haggle_id!==undefined) {
			const row=db.query<{initiator_id:number;owner_id:number},[string]>("SELECT json_extract(snapshot_json,'$.initiator_id') initiator_id,json_extract(snapshot_json,'$.owner_id') owner_id FROM economy_terminal_snapshots WHERE table_name='market_haggles' AND json_extract(snapshot_json,'$.id')=? ORDER BY id DESC LIMIT 1").get(snapshot.haggle_id);
			add(row?.initiator_id);add(row?.owner_id);
		}
	}
	return [...clients].sort((a,b)=>a-b);
}
