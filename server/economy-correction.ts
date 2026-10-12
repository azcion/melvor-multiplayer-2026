import { terminate_trade, remove_trade_value } from './trade-custody';
import type { market_haggles } from './db/types/db_types';
import { terminate_haggle, remove_market_value } from './market-custody';
import { reconcile_crucible } from './crucible-service';
import type { Database } from 'bun:sqlite';
import { move_custody, record_dependency } from './economy-custody';

/** No environment switch or production caller: activation requires a deliberate prospective service call. */
export type CorrectionActivation = { enabled: boolean; first_operation_id: number; policy_version: number };
const OFF: CorrectionActivation = { enabled:false,first_operation_id:Number.MAX_SAFE_INTEGER,policy_version:1 };
type Source = { root_key:string; client_id:number; object_id:string; quantity:number; snapshot_json:string };
type Disposition = 'invalidated' | 'protected' | 'consumed' | 'unresolved' | 'held';

export function correct_custody_operation(database: Database, incident_id: number, operation_id: number,
	activation: CorrectionActivation = OFF, now = Date.now()): { applied:boolean; reason:string } {
	if (!activation.enabled) return {applied:false,reason:'disabled'};
	if (!Number.isSafeInteger(activation.first_operation_id) || activation.first_operation_id < 1 ||
		!Number.isSafeInteger(activation.policy_version) || activation.policy_version < 1)
		throw new RangeError('Invalid prospective correction boundary');
	return database.transaction(() => {
		const operation = database.query<{source_key:string;client_id:number|null;historical:number;local_effect:string;evidence_json:string},[number]>(
			'SELECT source_key,client_id,historical,local_effect,evidence_json FROM economy_operations WHERE id=?').get(operation_id);
		if (!operation || operation_id < activation.first_operation_id || operation.historical || operation.local_effect !== 'outgoing')
			return {applied:false,reason:'outside_prospective_boundary'};
		const decision = database.query<{state:string},[number]>('SELECT state FROM economy_incident_decisions WHERE incident_id=? ORDER BY id DESC LIMIT 1').get(incident_id);
		const assessment = database.query<{classification:string;quality:string},[number,number]>(
			'SELECT a.classification,e.quality FROM economy_candidate_assessments a JOIN economy_incidents i ON i.id=a.incident_id JOIN economy_clock_evidence e ON e.id=a.evidence_id AND e.save_load_id=i.save_load_id JOIN economy_incident_candidates c ON c.incident_id=a.incident_id AND c.operation_id=a.operation_id WHERE a.incident_id=? AND a.operation_id=? ORDER BY a.evidence_id DESC LIMIT 1').get(incident_id,operation_id);
		if (decision?.state !== 'confirmed' || assessment?.classification !== 'after_cutoff' || assessment.quality !== 'calibrated')
			return {applied:false,reason:'not_approved_and_calibrated'};
		const sources = database.query<Source,[string]>('SELECT * FROM economy_custody_sources WHERE operation_key=? ORDER BY root_key').all(operation.source_key);
		if (!sources.length) return {applied:false,reason:'unproven_custody'};
		const guilds=database.query<{guild_id:number|null},[string,string,string,string]>(`
			SELECT DISTINCT guild_id FROM (
			 SELECT json_extract(snapshot_json,'$.guild_id') guild_id FROM economy_custody_sources WHERE operation_key=?
			 UNION SELECT o.guild_id FROM economy_custody_balances b JOIN economy_custody_sources s ON s.root_key=b.root_key
			 JOIN crucible_contribution_lots l ON b.location='crucible-lot:'||l.id JOIN crucible_offerings o ON o.id=l.offering_id WHERE s.operation_key=?
			 UNION SELECT o.guild_id FROM economy_custody_balances b JOIN economy_custody_sources s ON s.root_key=b.root_key
			 JOIN crucible_offerings o ON b.location='crucible-offering:'||o.id WHERE s.operation_key=?
			 UNION SELECT w.guild_id FROM economy_wish_funding f JOIN economy_custody_sources s ON s.root_key=f.root_key
			 JOIN crucible_wishes w ON w.id=f.wish_id WHERE s.operation_key=?
			) WHERE guild_id IS NOT NULL ORDER BY guild_id`).all(operation.source_key,operation.source_key,operation.source_key,operation.source_key);
		for(const guild of guilds) if(guild.guild_id!==null && database.query('SELECT 1 FROM crucible_guilds WHERE guild_id=?').get(guild.guild_id))
			if(reconcile_crucible(guild.guild_id,now,database)<Math.floor(now/60000)) throw new Error('Crucible must catch up before correction');

		let writes = 0;
		const write = (source:Source,lot:string,object:string,qty:number,disposition:Disposition,reason:string) => {
			if (qty === 0) return;
			if(database.query('SELECT 1 FROM economy_corrections WHERE operation_id=? AND lot_key=? AND object_id=? AND disposition=? AND quantity=?').get(operation_id,lot,object,disposition,qty)) return;
			writes++;
			const correction=database.query('INSERT INTO economy_corrections(incident_id,operation_id,lot_key,object_id,quantity,disposition,reason,decided_at,policy_version) VALUES(?,?,?,?,?,?,?,?,?)')
				.run(incident_id,operation_id,lot,object,qty,disposition,reason,now,activation.policy_version);
			if(disposition!=='unresolved') {
				let outstanding=qty;
				const unresolved=database.query<{id:number;lot_key:string;reason:string;remaining_quantity:number},[number,string]>(
					"SELECT id,lot_key,reason,remaining_quantity FROM economy_current_corrections WHERE operation_id=? AND object_id=? AND disposition='unresolved' ORDER BY id").all(operation_id,object);
				for(const previous of unresolved) {
					const exact_principal=reason==='exact-custody-disposition' && previous.reason===reason && previous.lot_key.startsWith(`${source.root_key}:`);
					const exact_ep=lot===`${source.root_key}:supply-ep` && previous.lot_key===`${source.root_key}:supply-ep-unresolved`;
					if(previous.lot_key!==lot && !exact_principal && !exact_ep) continue;
					const resolved=Math.min(outstanding,previous.remaining_quantity);
					if(resolved===0) break;
					database.query('INSERT INTO economy_correction_resolutions(unresolved_id,resolution_id,quantity) VALUES(?,?,?)')
						.run(previous.id,correction.lastInsertRowid,resolved);
					outstanding-=resolved;
				}
			}
		};
		const invalid_trade_roots=new Set(sources.map(s=>s.root_key));
		for(const source of sources) for(const position of database.query<{location:string;quantity:number},[string]>("SELECT location,quantity FROM economy_custody_balances WHERE root_key=? AND location LIKE 'trade-item:%'").all(source.root_key)) {
			const row=database.query<{trade_id:number},[number]>('SELECT trade_id FROM trade_items WHERE id=?').get(Number(position.location.slice(11)));
			if(row && terminate_trade(database,row.trade_id,now,invalid_trade_roots)) for(const affected of sources) {
				const invalid=database.query<{quantity:number},[string]>("SELECT quantity FROM economy_custody_balances WHERE root_key=? AND location='invalidated'").get(affected.root_key);
				if(invalid) write(affected,`${affected.root_key}:trade-invalidated`,affected.object_id,invalid.quantity,'invalidated','exact-custody-disposition');
			}
		}
		for (const source of sources) {
			if (source.client_id !== operation.client_id) throw new Error('Custody owner differs from originating command');
			// Retire invalid escrow before any ordinary return can be created. Refresh positions afterwards.
			for(const position of database.query<{location:string;quantity:number},[string]>("SELECT location,quantity FROM economy_custody_balances WHERE root_key=? AND location LIKE 'haggle:%'").all(source.root_key)) {
				const id=position.location.split(':')[1]!;
				const haggle=database.query<market_haggles,[string]>('SELECT * FROM market_haggles WHERE id=?').get(id);
				if(haggle && terminate_haggle(database,haggle,'cancelled',now,source.root_key))
					write(source,`${source.root_key}:${position.location}`,source.object_id,position.quantity,'invalidated','exact-custody-disposition');
			}
			const balances = database.query<{location:string;quantity:number},[string]>(
				'SELECT location,quantity FROM economy_custody_balances WHERE root_key=? ORDER BY location').all(source.root_key);
			if (balances.reduce((sum,b)=>sum+BigInt(b.quantity),0n)!==BigInt(source.quantity))
				throw new Error('Custody principal does not conserve original quantity');
			for (const balance of balances) {
				const location = balance.location;
				if(location==='invalidated') continue;
				// Incomplete historical evidence-only captures never authorize principal correction.
				if(location.startsWith('unresolved:market-source:')) continue;
				let disposition:Disposition = location.startsWith('protected:') ? 'protected' : location.startsWith('consumed:') ? 'consumed' : 'unresolved';
				if(location.startsWith('trade-item:')) {
					if(remove_trade_value(database,location,source.object_id,balance.quantity,source.client_id,()=>move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-trade-return'))) disposition='invalidated';
				} else if (location.startsWith('market:') || location.startsWith('haggle-claim:') || location.startsWith('banishment-return:')) {
					if(remove_market_value(database,location,source.object_id,balance.quantity,source.client_id,()=>move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-market-principal'))) {
						disposition='invalidated';
					}
				} else if (location.startsWith('gift:')) {
					const id=Number(location.split(':')[1]);
					const row=database.query<{qty:number;sender_id:number;client_id:number;flags:number},[number,string]>(
						'SELECT SUM(i.qty) qty,g.sender_id,g.client_id,g.flags FROM gift_items i JOIN gifts g ON g.gift_id=i.gift_id WHERE i.gift_id=? AND i.item_id=? GROUP BY g.gift_id').get(id,source.object_id);
					if(row && row.qty>=balance.quantity && ((row.flags&1) ? row.client_id : row.sender_id)===source.client_id) {
						move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-gift-principal');
						let remaining=balance.quantity;
						for(const item of database.query<{id:number;qty:number},[number,string]>('SELECT id,qty FROM gift_items WHERE gift_id=? AND item_id=? ORDER BY id').all(id,source.object_id)) {
							const removed=Math.min(remaining,item.qty);
							if(removed===0) break;
							if(removed===item.qty) database.query('DELETE FROM gift_items WHERE id=?').run(item.id);
							else database.query('UPDATE gift_items SET qty=qty-? WHERE id=?').run(removed,item.id);
							remaining-=removed;
						}
						// No return is issued for invalid pending principal.
						database.query('DELETE FROM gifts WHERE gift_id=? AND NOT EXISTS(SELECT 1 FROM gift_items WHERE gift_id=?)').run(id,id);
						database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=? AND id<>?').run(row.client_id,source.client_id);
						disposition='invalidated';
					}
				} else if (location.startsWith('deletion-return:')) {
					if(source.object_id==='melvorD:GP' && remove_market_value(database,location,source.object_id,balance.quantity,source.client_id,()=>move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-market-principal'))) {
						write(source,`${source.root_key}:${location}`,source.object_id,balance.quantity,'invalidated','exact-custody-disposition');continue;
					}

					const id=Number(location.split(':')[1]);
					const row=database.query<{qty:number;client_id:number},[number,string]>(
						'SELECT i.qty,r.client_id FROM client_deletion_return_items i JOIN client_deletion_returns r ON r.id=i.return_id WHERE i.return_id=? AND i.item_id=?').get(id,source.object_id);
					if(row && row.client_id===source.client_id && row.qty>=balance.quantity) {
						move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-unissued-deletion-return');
						if(row.qty===balance.quantity) database.query('DELETE FROM client_deletion_return_items WHERE return_id=? AND item_id=?').run(id,source.object_id);
						else database.query('UPDATE client_deletion_return_items SET qty=qty-? WHERE return_id=? AND item_id=?').run(balance.quantity,id,source.object_id);
						disposition='invalidated';
					}
				} else if (location.startsWith('inbox:')) {
					const [owner,type,name,item]=JSON.parse(location.slice(6)) as [number,string,string,string];
					if(owner!==source.client_id || item!==source.object_id) throw new Error('Inbox return custody differs from source');
					const row=database.query<{qty:number},[number,string,string,string]>(
						'SELECT qty FROM inbox_items WHERE client_id=? AND source_type=? AND source_name=? AND item_id=?').get(owner,type,name,item);
					if(row && row.qty>=balance.quantity) {
						move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-unissued-return');
						if(row.qty===balance.quantity) database.query('DELETE FROM inbox_items WHERE client_id=? AND source_type=? AND source_name=? AND item_id=?').run(owner,type,name,item);
						else database.query('UPDATE inbox_items SET qty=qty-? WHERE client_id=? AND source_type=? AND source_name=? AND item_id=?').run(balance.quantity,owner,type,name,item);
						disposition='invalidated';
					}
				} else if (location.startsWith('crucible-lot:')) {
					const lot_id = Number(location.slice('crucible-lot:'.length));
					const lot = database.query<{offering_id:number;client_id:number;qty:number},[number]>('SELECT offering_id,client_id,qty FROM crucible_contribution_lots WHERE id=?').get(lot_id);
					if (lot && lot.qty >= balance.quantity) {
						const offering = database.query<{qty:number;item_id:string},[number]>('SELECT qty,item_id FROM crucible_offerings WHERE id=?').get(lot.offering_id)!;
						if(lot.client_id!==source.client_id || offering.item_id!==source.object_id) throw new Error('Custody identity differs from held principal');
						if (offering.qty < balance.quantity) throw new Error('Offering does not conserve custody');
						move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-principal');
						if (lot.qty === balance.quantity) database.query('DELETE FROM crucible_contribution_lots WHERE id=?').run(lot_id);
						else database.query('UPDATE crucible_contribution_lots SET qty=qty-? WHERE id=?').run(balance.quantity,lot_id);
						if (offering.qty === balance.quantity) database.query('DELETE FROM crucible_offerings WHERE id=?').run(lot.offering_id);
						else database.query('UPDATE crucible_offerings SET qty=qty-? WHERE id=?').run(balance.quantity,lot.offering_id);
						disposition='invalidated';
					}
				} else if (location.startsWith('crucible-offering:')) {
					const id=Number(location.slice('crucible-offering:'.length));
					const row=database.query<{qty:number;item_id:string},[number]>('SELECT qty,item_id FROM crucible_offerings WHERE id=?').get(id);
					if (row && row.qty>=balance.quantity) {
						if(row.item_id!==source.object_id) throw new Error('Custody object differs from held principal');
						move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-principal');
						if(row.qty===balance.quantity) database.query('DELETE FROM crucible_offerings WHERE id=?').run(id);
						else database.query('UPDATE crucible_offerings SET qty=qty-? WHERE id=?').run(balance.quantity,id);
						disposition='invalidated';
					}
				} else if (location.startsWith('expedition-lot:')) {
					const id=Number(location.slice('expedition-lot:'.length));
					const lot=database.query<{expedition_id:number;item_id:string;client_id:number;qty:number},[number]>('SELECT expedition_id,item_id,client_id,qty FROM expedition_supply_lots WHERE id=?').get(id);
					if(lot && lot.qty>=balance.quantity) {
						if(lot.client_id!==source.client_id || lot.item_id!==source.object_id) throw new Error('Expedition custody identity differs from source');
						const stash=database.query<{qty:number},[number,string]>('SELECT qty FROM expedition_supplies WHERE expedition_id=? AND item_id=?').get(lot.expedition_id,lot.item_id)!;
						if(stash.qty<balance.quantity) throw new Error('Expedition stash does not conserve custody');
						move_custody(database,source.root_key,location,'invalidated',balance.quantity,now,'rollback-principal');
						if(lot.qty===balance.quantity) database.query('DELETE FROM expedition_supply_lots WHERE id=?').run(id);
						else database.query('UPDATE expedition_supply_lots SET qty=qty-? WHERE id=?').run(balance.quantity,id);
						if(stash.qty===balance.quantity) database.query('DELETE FROM expedition_supplies WHERE expedition_id=? AND item_id=?').run(lot.expedition_id,lot.item_id);
						else database.query('UPDATE expedition_supplies SET qty=qty-? WHERE expedition_id=? AND item_id=?').run(balance.quantity,lot.expedition_id,lot.item_id);
						database.query('UPDATE expeditions SET revision=revision+1 WHERE id=?').run(lot.expedition_id);
						disposition='invalidated';
					}
				}
				write(source,`${source.root_key}:${location}`,source.object_id,balance.quantity,disposition,'exact-custody-disposition');
			}
			for(const point of database.query<{id:number;snapshot_json:string},[string]>("SELECT * FROM economy_dependency_evidence WHERE root_key=? AND kind='slag-clear-point'").all(source.root_key)) {
				const snapshot=JSON.parse(point.snapshot_json) as {event_id:number;guild_id:number;owner_key:string;cleared_at:number;expires_at:number};
				const live=database.query<{id:number},[number,number,string,number,number,number]>('SELECT id FROM crucible_clear_events WHERE id=? AND guild_id=? AND owner_key=? AND cleared_at=? AND expires_at=? AND expires_at>?')
					.get(snapshot.event_id,snapshot.guild_id,snapshot.owner_key,snapshot.cleared_at,snapshot.expires_at,now);
				const slot=`${source.root_key}:slag:${point.id}`;
				if(!database.query("SELECT 1 FROM economy_corrections WHERE operation_id=? AND lot_key=? AND disposition='held'").get(operation_id,slot)) {
					if(live) database.query('DELETE FROM crucible_clear_events WHERE id=?').run(live.id);
					write(source,slot,'multiplayer:SlagClearPoint',1,live?'held':'consumed','exact-clearing-point-dependency');
				}
			}
			for(const lock of database.query<{id:number},[string]>("SELECT id FROM economy_dependency_evidence WHERE root_key=? AND kind='slag-currency-lock'").all(source.root_key))
				write(source,`${source.root_key}:slag-lock:${lock.id}`,'multiplayer:SlagCurrencyLock',1,'unresolved','restrictive-lock-retained-for-review');
			const supply = database.query<{quantity:number;snapshot_json:string},[string]>(
				"SELECT quantity,snapshot_json FROM economy_dependency_evidence WHERE root_key=? AND kind='expedition-supply-score' LIMIT 1").get(source.root_key);
			if (supply && !database.query("SELECT 1 FROM economy_corrections WHERE operation_id=? AND lot_key=? AND disposition='held'").get(operation_id,`${source.root_key}:supply-ep`)) {
				const snapshot=JSON.parse(supply.snapshot_json) as {expedition_id:number;added_value:number};
				const score=database.query<{value_gp_equiv:number;score_micros:number},[number,number]>(
					'SELECT value_gp_equiv,score_micros FROM expedition_supply_scores WHERE client_id=? AND expedition_id=?').get(source.client_id,snapshot.expedition_id);
				if (score && (score.value_gp_equiv>=snapshot.added_value || database.query("SELECT 1 FROM economy_dependency_evidence WHERE root_key=? AND kind='supply-score-held'").get(source.root_key))) {
					const prior_dependency=database.query<{quantity:number;snapshot_json:string},[string]>("SELECT quantity,snapshot_json FROM economy_dependency_evidence WHERE root_key=? AND kind='supply-score-held' ORDER BY id LIMIT 1").get(source.root_key);
					const valid_value=prior_dependency ? score.value_gp_equiv : score.value_gp_equiv-snapshot.added_value;
					const valid_score=Math.floor(10*Math.log10(1+valid_value/1000)*1_000_000);
					const dependency=prior_dependency?.quantity ?? score.score_micros-valid_score;
					if(dependency<0) throw new Error('Supply score correction increased derived benefits');
					const balance=database.query<{points_micros:number},[number]>('SELECT points_micros FROM expedition_ep_balances WHERE client_id=?').get(source.client_id);
					const earned=database.query<{points_micros:number},[number]>('SELECT points_micros FROM expedition_ep_ledger WHERE client_id=?').all(source.client_id)
						.reduce((sum,row)=>sum+BigInt(row.points_micros),0n);
					const previous_holds=database.query<{quantity:number},[number]>("SELECT c.quantity FROM economy_corrections c JOIN economy_operations o ON o.id=c.operation_id WHERE o.client_id=? AND c.object_id='multiplayer:ExpeditionPointsMicros' AND c.disposition='held'").all(source.client_id)
						.reduce((sum,row)=>sum+BigInt(row.quantity),0n);
					// Wish spending deliberately breaks this proof; spent or otherwise ambiguous EP stays unresolved
					// rather than debiting unrelated work EP or reversing an accepted Wish/capacity purchase.
					const unspent_proven=BigInt(balance?.points_micros ?? 0)===earned-previous_holds && (balance?.points_micros ?? 0)>=dependency;
					const held=unspent_proven?dependency:0;
					if(held>0) database.query('UPDATE expedition_ep_balances SET points_micros=points_micros-? WHERE client_id=?').run(held,source.client_id);
					database.query('UPDATE expedition_supply_scores SET value_gp_equiv=?,score_micros=? WHERE client_id=? AND expedition_id=?')
						.run(valid_value,valid_score,source.client_id,snapshot.expedition_id);
					write(source,`${source.root_key}:supply-ep`,'multiplayer:ExpeditionPointsMicros',held,'held','exact-cumulative-supply-dependency');
					write(source,`${source.root_key}:supply-ep-unresolved`,'multiplayer:ExpeditionPointsMicros',dependency-held,'unresolved','unavailable-derived-ep');
					if(!prior_dependency) record_dependency(database,source.root_key,'supply-score-held',dependency,{expedition_id:snapshot.expedition_id,old_value:score.value_gp_equiv,valid_value,old_score:score.score_micros,valid_score});
				} else write(source,`${source.root_key}:supply-ep-unresolved`,'multiplayer:ExpeditionPointsMicros',supply.quantity,'unresolved','missing-supply-score');
			}
			const funding=database.query<{wish_id:number;amount:number;origin_kind:string},[string]>(
				'SELECT wish_id,origin_kind,SUM(amount_gp) AS amount FROM economy_wish_funding WHERE root_key=? GROUP BY wish_id,origin_kind HAVING SUM(amount_gp)>0').all(source.root_key);
			for(const allocation of funding) {
				const wish=database.query<{owner_client_id:number;progress_gp:number},[number]>('SELECT owner_client_id,progress_gp FROM crucible_wishes WHERE id=?').get(allocation.wish_id);
				const delivered=database.query("SELECT 1 FROM economy_dependency_evidence WHERE kind='wish-delivered' AND json_extract(snapshot_json,'$.wish_id')=? LIMIT 1").get(allocation.wish_id);
				let disposition:Disposition=delivered?'protected':'consumed';
				if(wish) {
					if(allocation.amount>wish.progress_gp) throw new Error('Invalid funding exceeds Wish progress');
					database.query('INSERT INTO economy_wish_funding(wish_id,root_key,origin_kind,amount_gp,reason,occurred_at) VALUES(?,?,?,?,?,?)')
						.run(allocation.wish_id,source.root_key,allocation.origin_kind,-allocation.amount,'rollback-invalid-funding',now);
					database.query('UPDATE crucible_wishes SET progress_gp=progress_gp-?,melded_at=NULL,auto_deliver_at=NULL WHERE id=?').run(allocation.amount,allocation.wish_id);
					disposition=allocation.origin_kind==='derived'?'held':'invalidated';
				}
				write(source,`${source.root_key}:wish:${allocation.wish_id}:${allocation.origin_kind}`,'multiplayer:WishFundingGPEquivalent',allocation.amount,disposition,'wish-funding-dependency');
			}
			const outputs=database.query<Source,[string,string]>("SELECT * FROM economy_custody_sources WHERE json_extract(snapshot_json,'$.parent_root')=? OR EXISTS(SELECT 1 FROM json_each(snapshot_json,'$.parent_roots') WHERE value=?) ORDER BY root_key").all(source.root_key,source.root_key);
			for(const output of outputs) {
				const positions=database.query<{location:string;quantity:number},[string]>('SELECT location,quantity FROM economy_custody_balances WHERE root_key=?').all(output.root_key);
				for(const position of positions) {
					if(position.location==='held') continue;
					let disposition:Disposition=position.location.startsWith('protected:')?'protected':'unresolved';
					if(remove_trade_value(database,position.location,output.object_id,position.quantity,output.client_id,()=>move_custody(database,output.root_key,position.location,'held',position.quantity,now,'derived-trade-review')) || remove_market_value(database,position.location,output.object_id,position.quantity,output.client_id,()=>move_custody(database,output.root_key,position.location,'held',position.quantity,now,'derived-market-review'))) {
						disposition='held';
					} else if(position.location.startsWith('crucible-offering:')) {
						const id=Number(position.location.slice('crucible-offering:'.length));
						const offering=database.query<{qty:number;item_id:string},[number]>('SELECT qty,item_id FROM crucible_offerings WHERE id=?').get(id);
						if(offering && offering.qty>=position.quantity) {
							if(offering.item_id!==output.object_id) throw new Error('Derived output object differs from held custody');
							move_custody(database,output.root_key,position.location,'held',position.quantity,now,'derived-gloop-review');
							if(offering.qty===position.quantity) database.query('DELETE FROM crucible_offerings WHERE id=?').run(id);
							else database.query('UPDATE crucible_offerings SET qty=qty-? WHERE id=?').run(position.quantity,id);
							disposition='held';
						}
					}
					write(source,`${output.root_key}:${position.location}`,output.object_id,position.quantity,disposition,`exact-derived-${JSON.parse(output.snapshot_json).benefit_kind ?? 'gloop'}-output`);
				}
			}
			for(const dep of database.query<{id:number;kind:string;quantity:number;snapshot_json:string},[string]>(
				"SELECT * FROM economy_dependency_evidence WHERE root_key=? AND kind='mixed-gloop-rounding' ORDER BY id").all(source.root_key))
				write(source,`${source.root_key}:dependency:${dep.id}`,'melvorD:Weird_Gloop',dep.quantity,'unresolved','mixed-output-unit-protects-other-contributors');
			for(const dep of database.query<{id:number;quantity:number},[string]>("SELECT id,quantity FROM economy_dependency_evidence WHERE root_key=? AND kind='market-mixed-benefit'").all(source.root_key))
				write(source,`${source.root_key}:mixed-market:${dep.id}`,'multiplayer:MixedMarketBenefitFunding',dep.quantity,'unresolved','indivisible-benefit-review');
			for(const dep of database.query<{id:number;quantity:number;snapshot_json:string},[string]>("SELECT id,quantity,snapshot_json FROM economy_dependency_evidence WHERE root_key=? AND kind='trade-unresolved-benefit'").all(source.root_key))
				write(source,`${source.root_key}:trade-benefit-review:${dep.id}`,JSON.parse(dep.snapshot_json).object_id,dep.quantity,'unresolved','incomplete-trade-basket-ancestry');
			if(writes>0 && !database.query("SELECT 1 FROM economy_dependency_evidence WHERE root_key=? AND kind='shared-progress-flag'").get(source.root_key)) {
				record_dependency(database,source.root_key,'shared-progress-flag',0,{incident_id,operation_id,reason:'shared-earned-progress-is-flag-only'});
				const original=JSON.parse(operation.evidence_json) as {pet_id?:unknown};
				if(typeof original.pet_id==='string') record_dependency(database,source.root_key,'permanent-pet-flag',1,{incident_id,operation_id,pet_id:original.pet_id,reason:'permanent-pets-are-flag-only'});
			}
			if(writes>0) record_dependency(database,source.root_key,'rollback-source-disposed',source.quantity,{incident_id,operation_id});
		}
		if(writes>0) database.query('UPDATE clients SET event_revision=event_revision+1 WHERE id=?').run(operation.client_id);
		return {applied:writes>0,reason:writes>0?'disposed':'already_disposed'};
	}).immediate();
}
