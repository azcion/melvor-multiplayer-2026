import type { Database } from 'bun:sqlite';

export type FundingOrigin = { root_key: string | null; amount_gp: number; origin_kind?: 'principal' | 'derived' | 'unknown' };
export type CustodySource = { root_key: string; operation_key: string; client_id: number;
	object_id: string; quantity: number; created_at: number; snapshot: unknown };

function positive(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Invalid custody quantity');
}

/** Caller owns the domain write transaction. No historical attribution is inferred. */
export function create_custody_source(database: Database, source: CustodySource, location: string): void {
	positive(source.quantity);
	const snapshot = JSON.stringify(source.snapshot);
	const existing = database.query<{ operation_key: string; client_id: number; object_id: string; quantity: number; created_at: number; snapshot_json: string }, [string]>(
		'SELECT operation_key,client_id,object_id,quantity,created_at,snapshot_json FROM economy_custody_sources WHERE root_key=?').get(source.root_key);
	if (existing !== null) {
		if (existing.operation_key !== source.operation_key || existing.client_id !== source.client_id || existing.object_id !== source.object_id || existing.created_at !== source.created_at || existing.quantity !== source.quantity || existing.snapshot_json !== snapshot)
			throw new Error('Custody source identity was reused');
		return;
	}
	database.query('INSERT INTO economy_custody_sources VALUES(?,?,?,?,?,?,?)')
		.run(source.root_key,source.operation_key,source.client_id,source.object_id,source.quantity,source.created_at,snapshot);
	database.query('INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason) VALUES(?,NULL,?,?,?,?)')
		.run(source.root_key,location,source.quantity,source.created_at,'source');
}

export function custody_at(database: Database, location: string): Array<{ root_key: string; quantity: number }> {
	return database.query<{ root_key: string; quantity: number }, [string]>(
		'SELECT b.root_key,b.quantity FROM economy_custody_balances b JOIN economy_custody_sources s ON s.root_key=b.root_key WHERE b.location=? ORDER BY s.created_at,s.rowid').all(location);
}

export function move_custody(database: Database, root_key: string, from: string, to: string,
	quantity: number, now: number, reason: string): void {
	positive(quantity);
	if(from==='invalidated' || from==='held' || from.startsWith('protected:') || from.startsWith('consumed:')) throw new Error('Terminal or held custody cannot re-enter active economy custody');
	const available = database.query<{ quantity: number }, [string,string]>(
		'SELECT quantity FROM economy_custody_balances WHERE root_key=? AND location=?').get(root_key,from)?.quantity ?? 0;
	if (quantity > available) throw new Error('Custody movement exceeds exact remaining principal');
	database.query('INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason) VALUES(?,?,?,?,?,?)')
		.run(root_key,from,to,quantity,now,reason);
}

export function move_location(database: Database, from: string, to: string, now: number, reason: string): void {
	for (const source of custody_at(database,from)) move_custody(database,source.root_key,from,to,source.quantity,now,reason);
}

export function record_dependency(database: Database, root_key: string | null, kind: string, quantity: number, snapshot: unknown): void {
	if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('Invalid dependency quantity');
	database.query('INSERT INTO economy_dependency_evidence(root_key,kind,quantity,snapshot_json) VALUES(?,?,?,?)')
		.run(root_key,kind,quantity,JSON.stringify(snapshot));
}

/** Consume a deterministic FIFO GP queue; null origins explicitly retain unproven pooled value. */
export function allocate_wish_funding(database: Database, wish_id: number, quantity: number,
	origins: FundingOrigin[], now: number, reason: string): void {
	positive(quantity);
	let remaining = quantity;
	for (const origin of origins) {
		if (remaining === 0) break;
		const amount = Math.min(remaining,origin.amount_gp);
		if (amount === 0) continue;
		database.query('INSERT INTO economy_wish_funding(wish_id,root_key,origin_kind,amount_gp,reason,occurred_at) VALUES(?,?,?,?,?,?)')
			.run(wish_id,origin.root_key,origin.origin_kind ?? (origin.root_key===null?'unknown':'principal'),amount,reason,now);
		origin.amount_gp -= amount;
		remaining -= amount;
	}
	if (remaining !== 0) throw new Error('Wish funding origins do not conserve GP');
}

export function wish_funding(database: Database, wish_id: number, progress_gp: number): FundingOrigin[] {
	const origins = database.query<FundingOrigin,[number]>(
		'SELECT root_key,origin_kind,SUM(amount_gp) AS amount_gp FROM economy_wish_funding WHERE wish_id=? GROUP BY root_key,origin_kind HAVING SUM(amount_gp)>0 ORDER BY MIN(id)')
		.all(wish_id);
	const known = origins.reduce((sum,origin) => sum + BigInt(origin.amount_gp),0n);
	if (known > BigInt(progress_gp)) throw new Error('Wish funding exceeds live progress');
	if (known < BigInt(progress_gp)) origins.unshift({ root_key: null, amount_gp: Number(BigInt(progress_gp)-known) });
	return origins;
}

export function retire_wish_funding(database: Database, wish_id: number, origins: FundingOrigin[], now: number, reason: string): void {
	for (const origin of origins) if (origin.amount_gp > 0)
		database.query('INSERT INTO economy_wish_funding(wish_id,root_key,origin_kind,amount_gp,reason,occurred_at) VALUES(?,?,?,?,?,?)')
			.run(wish_id,origin.root_key,origin.origin_kind ?? (origin.root_key===null?'unknown':'principal'),-origin.amount_gp,reason,now);
}

/** Capture exact whole Gloop units and explicit mixed rounding boundaries without per-unit iteration. */
export function create_gloop_custody(database: Database, offering_id: number, origins: FundingOrigin[],
	event_key: string, guild_id: number, now: number, meld_multiplier = 1): void {
	if (!Number.isSafeInteger(meld_multiplier) || meld_multiplier <= 0) throw new RangeError('Invalid Gloop Meld multiplier');
	const divisor=1000n*BigInt(meld_multiplier);
	const total=origins.reduce((sum,o)=>sum+BigInt(o.amount_gp),0n);
	if(total===0n) return;
	let cursor=0n;
	const intervals=origins.filter(o=>o.amount_gp>0).map(origin=>{
		const start=cursor; cursor+=BigInt(origin.amount_gp); return {...origin,start,end:cursor};
	});
	const boundaries=new Set<string>();
	for(let index=0;index<intervals.length;index++) {
		const interval=intervals[index]!;
		const first=(interval.start+divisor-1n)/divisor;
		const end=interval.end/divisor;
		let units=end>first?end-first:0n;
		if(interval.end===total && total%divisor!==0n && interval.start<=total/divisor*divisor) units++;
		if(interval.end<total && interval.end%divisor!==0n) boundaries.add(String(interval.end/divisor));
		if(units===0n || interval.root_key===null) continue;
		const parent=database.query<{operation_key:string;client_id:number},[string]>('SELECT operation_key,client_id FROM economy_custody_sources WHERE root_key=?').get(interval.root_key)!;
		create_custody_source(database,{root_key:`gloop:${event_key}:${index}`,operation_key:`derived:${parent.operation_key}`,
			client_id:parent.client_id,object_id:'melvorD:Weird_Gloop',quantity:Number(units),created_at:now,
			snapshot:{parent_root:interval.root_key,benefit_kind:'gloop',guild_id,offering_id,first_unit:String(first),units:Number(units),
				gp_start:String(interval.start),gp_end:String(interval.end),total_gp:String(total),meld_multiplier}},`crucible-offering:${offering_id}`);
	}
	for(const boundary of boundaries) {
		const start=BigInt(boundary)*divisor;const end=start+divisor<total?start+divisor:total;
		const contributors=intervals.filter(o=>o.start<end && o.end>start);
		for(const contributor of contributors) record_dependency(database,contributor.root_key,'mixed-gloop-rounding',1,
			{event_key,offering_id,guild_id,unit:boundary,total_gp:String(total),meld_multiplier,contributors:contributors.map(o=>({root_key:o.root_key,
				gp:Number((o.end<end?o.end:end)-(o.start>start?o.start:start))}))});
	}
}

/** Stable item-level positions prevent provenance mixing in source-grouped Inbox stacks. */
export function inbox_custody_location(client_id: number, type: string, name: string, item_id: string): string {
	return `inbox:${JSON.stringify([client_id,type,name,item_id])}`;
}

/** Caller must supply any unproven FIFO prefix; it is consumed without inventing roots.
 * Return the mapped quantity so a caller can retain explicit unresolved evidence for a shortfall. */
export function move_custody_fifo(database: Database, from: string, to: string, quantity: number,
	now: number, reason: string, unproven_prefix = 0): number {
	positive(quantity);
	if (!Number.isSafeInteger(unproven_prefix) || unproven_prefix < 0) throw new RangeError('Invalid unproven custody prefix');
	let remaining = Math.max(0,quantity-unproven_prefix);
	const mapped = remaining;
	for (const source of custody_at(database,from)) {
		const moved = Math.min(remaining,source.quantity);
		if (moved === 0) break;
		move_custody(database,source.root_key,from,to,moved,now,reason);
		remaining -= moved;
	}
	return mapped-remaining;
}
