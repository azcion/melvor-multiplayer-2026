import type { Migration } from '../types';

/** Retain exact row states without assigning historical stock to a command. */
export const market_custody_evidence_migration: Migration = {version:176,sql:`
	${['INSERT','UPDATE','DELETE'].map(action=>{
		const ref=action==='DELETE'?'OLD':'NEW';
		const fields=['id','guild_id','client_id','direction','item_id','qty','available','reserved','haggled','price','currency_id','escrow_gp','payout','price_adjustment','published_at','updated_at','purchase_limit','alliance_price','allow_haggles'];
		return `CREATE TRIGGER market_items_custody_${action.toLowerCase()} ${action==='DELETE'?'BEFORE':'AFTER'} ${action} ON market_items BEGIN
		INSERT INTO economy_terminal_snapshots(table_name,row_id,phase,snapshot_json)
		VALUES('market_items',${ref}.id,'${action==='INSERT'?'source':'terminal'}',json_object(${fields.map(field=>`'${field}',${ref}.${field}`).join(',')})); END;`;
	}).join('\n')}
`};
