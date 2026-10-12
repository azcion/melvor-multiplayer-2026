import type { Migration } from '../types';

/** Preserve original and terminal exchange states, including correction and cleanup. No historical roots. */
export const market_custody_migration: Migration = {version:177,sql:`
	${[
		{table:'market_haggles',key:'rowid',fields:['id','listing_id','listing_ref','guild_id','initiator_id','owner_id','direction','item_id','item_qty','listing_price','offer_price','listing_reserved_gp','payer_escrow_gp','revision','status','currency_id','created_at','updated_at','terminal_at']},
		{table:'market_haggle_claims',key:'rowid',fields:['haggle_id','client_id','item_id','item_qty','gp','claimed_at']},
		{table:'market_purchases',key:'listing_id',fields:['listing_id','owner_key','qty']},
	].flatMap(({table,key,fields})=>['INSERT','UPDATE','DELETE'].map(action=>{
		const ref=action==='DELETE'?'OLD':'NEW';
		return `CREATE TRIGGER ${table}_custody_${action.toLowerCase()} ${action==='DELETE'?'BEFORE':'AFTER'} ${action} ON ${table} BEGIN
		INSERT INTO economy_terminal_snapshots(table_name,row_id,phase,snapshot_json)
		VALUES('${table}',${ref}.${key},'${action==='INSERT'?'source':'terminal'}',json_object(${fields.map(f=>`'${f}',${ref}.${f}`).join(',')})); END;`;
	})).join('\n')}
`};
