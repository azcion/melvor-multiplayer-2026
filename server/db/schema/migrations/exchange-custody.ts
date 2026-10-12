import type { Migration } from '../types';

/** New rows only: historical snapshots do not invent command or custody attribution. */
const rows = [
	{table:'gifts',key:'gift_id',fields:['gift_id','client_id','sender_id','flags','created_at','updated_at']},
	{table:'gift_items',key:'id',fields:['id','gift_id','item_id','qty']},
	{table:'inbox_items',key:'rowid',fields:['client_id','source_type','source_name','item_id','qty','created_at','updated_at','history_key']},
	{table:'client_deletion_return_items',key:'rowid',fields:['return_id','item_id','qty']},
];
export const exchange_custody_migration: Migration = {version:175,sql:`
	${rows.flatMap(({table,key,fields})=>['source','terminal'].map(phase=>`
	CREATE TRIGGER ${table}_custody_${phase}_snapshot ${phase==='source'?'AFTER INSERT':'BEFORE DELETE'} ON ${table} BEGIN
		INSERT INTO economy_terminal_snapshots(table_name,row_id,phase,snapshot_json)
		VALUES('${table}',${phase==='source'?'NEW':'OLD'}.${key},'${phase}',json_object(${fields.map(field=>`'${field}',${phase==='source'?'NEW':'OLD'}.${field}`).join(',')}));
	END;`)).join('\n')}
	CREATE TRIGGER gift_items_custody_cleanup BEFORE DELETE ON gift_items
	WHEN (SELECT COUNT(*) FROM gift_items WHERE gift_id=OLD.gift_id AND item_id=OLD.item_id)=1 BEGIN
		INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason)
		SELECT root_key,location,'unresolved:gift-cleanup',quantity,CAST(strftime('%s','now') AS INTEGER)*1000,'unmapped-gift-cleanup'
		FROM economy_custody_balances WHERE location='gift:'||OLD.gift_id||':'||OLD.item_id;
	END;
	CREATE TRIGGER deletion_return_items_custody_cleanup BEFORE DELETE ON client_deletion_return_items BEGIN
		INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason)
		SELECT root_key,location,'unresolved:deletion-return-cleanup',quantity,CAST(strftime('%s','now') AS INTEGER)*1000,'unmapped-deletion-return-cleanup'
		FROM economy_custody_balances WHERE location='deletion-return:'||OLD.return_id||':'||OLD.item_id;
	END;
	CREATE TRIGGER inbox_items_custody_cleanup BEFORE DELETE ON inbox_items BEGIN
		INSERT INTO economy_custody_movements(root_key,from_location,to_location,quantity,occurred_at,reason)
		SELECT root_key,location,'unresolved:inbox-cleanup',quantity,CAST(strftime('%s','now') AS INTEGER)*1000,'unmapped-inbox-cleanup'
		FROM economy_custody_balances WHERE location='inbox:'||json_array(OLD.client_id,OLD.source_type,OLD.source_name,OLD.item_id);
	END;
`};
