import type { Migration } from '../types';

/** Append-only mutation/terminal evidence. Existing rows receive no invented ancestry. */
export const trade_custody_migration: Migration = {version:178,sql:`
	${[
		{table:'trade_offers',key:'trade_id',fields:['trade_id','sender_id','recipient_id','attending_id','state','created_at','updated_at']},
		{table:'resolved_trade_offers',key:'trade_id',fields:['trade_id','client_id','sender_id','declined','created_at']},
		{table:'trade_items',key:'id',fields:['id','trade_id','item_id','qty','counter']},
	].flatMap(({table,key,fields})=>['INSERT','UPDATE','DELETE'].map(action=>{
		const ref=action==='DELETE'?'OLD':'NEW';
		return `CREATE TRIGGER ${table}_custody_${action.toLowerCase()} ${action==='DELETE'?'BEFORE':'AFTER'} ${action} ON ${table} BEGIN
		INSERT INTO economy_terminal_snapshots(table_name,row_id,phase,snapshot_json)
		VALUES('${table}',${ref}.${key},'${action==='INSERT'?'source':'terminal'}',json_object(${fields.map(f=>`'${f}',${ref}.${f}`).join(',')})); END;`;
	})).join('\n')}
	CREATE TRIGGER trade_item_custody_cleanup BEFORE DELETE ON trade_items BEGIN
		INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason)
		SELECT root_key,location,'unresolved:trade-cleanup',quantity,CAST(strftime('%s','now') AS INTEGER)*1000,'unmapped-trade-cleanup'
		FROM economy_custody_balances WHERE location='trade-item:'||OLD.id;
	END;
`};
