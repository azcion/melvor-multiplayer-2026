import { db } from './db';
import { has_alliance_access, ALLIANCE_PREVIEW_ACCOUNT_ID, alliance_for_guild } from './alliances';

type MarketParticipant = { guild_id:number; mod_version:string|null; cheats_detected_at:number|null;
	cheat_restriction_enabled:number; social_mode:string; enforced:number };
function participant(id:number):MarketParticipant|null {
	return db.query<MarketParticipant,[number]>(`SELECT gm.guild_id,r.mod_version,c.cheats_detected_at,g.cheat_restriction_enabled,c.social_mode,
		MAX(c.social_mode_enforced,COALESCE(a.social_mode_enforced,0)) enforced FROM clients c
		JOIN guild_memberships gm ON gm.client_id=c.id JOIN guilds g ON g.id=gm.guild_id
		LEFT JOIN client_runtime_snapshots r ON r.client_id=c.id LEFT JOIN melvor_accounts a ON a.id=c.melvor_account_id WHERE c.id=?`).get(id);
}
export function market_deal_allowed(client_id:number,owner_id:number,listing_guild_id:number,request_version?:string|null,now=Date.now()):boolean {
	const buyer=participant(client_id),owner=participant(owner_id);
	if(!buyer||!owner||owner.guild_id!==listing_guild_id) return false;
	if(buyer.guild_id===owner.guild_id) return true;
	if(!has_alliance_access(client_id,request_version===undefined?buyer.mod_version:request_version)||!has_alliance_access(owner_id,owner.mod_version)) return false;
	const a=alliance_for_guild(buyer.guild_id),b=alliance_for_guild(owner.guild_id);
	if(!a||!b||a.id!==b.id||a.shared_marketplace!==1) return false;
	if(buyer.social_mode==='social'||owner.social_mode==='social'||buyer.enforced||owner.enforced) return false;
	if(buyer.cheat_restriction_enabled||owner.cheat_restriction_enabled) {
		for(const player of [buyer,owner]) if(player.cheats_detected_at!==null&&player.cheats_detected_at>=now-7*86400000&&player.cheats_detected_at<=now) return false;
	}
	return true;
}
// Bounded SQL discovery shares exactly the mutation permission predicate, without loading every listing.
export function market_visibility_sql(alias:string,client_id:number,version:string|null):{sql:string;values:(string|number)[]} {
	const own=participant(client_id);
	if(!own) return {sql:'0',values:[]};
	if(!has_alliance_access(client_id,version)) return {sql:`${alias}.guild_id = ?`,values:[own.guild_id]};
	return {sql:`(${alias}.guild_id = ? OR (${alias}.guild_id IN (
		SELECT am.guild_id FROM alliance_memberships am JOIN alliances a ON a.id=am.alliance_id
		WHERE a.shared_marketplace=1 AND am.alliance_id=(SELECT alliance_id FROM alliance_memberships WHERE guild_id=?)
	) AND EXISTS(SELECT 1 FROM clients ac JOIN guild_memberships agm ON agm.client_id=ac.id
		JOIN guilds ag ON ag.id=agm.guild_id JOIN client_runtime_snapshots ar ON ar.client_id=ac.id
		LEFT JOIN melvor_accounts aa ON aa.id=ac.melvor_account_id
		WHERE ac.melvor_account_id=${ALLIANCE_PREVIEW_ACCOUNT_ID} AND ac.id=${alias}.client_id AND agm.guild_id=${alias}.guild_id AND (ar.mod_version='development' OR (ar.mod_version NOT GLOB '*[^0-9.]*'
		AND length(ar.mod_version)-length(replace(ar.mod_version,'.',''))=2 AND (
		CAST(substr(ar.mod_version,1,instr(ar.mod_version,'.')-1) AS INTEGER)>1 OR
		(CAST(substr(ar.mod_version,1,instr(ar.mod_version,'.')-1) AS INTEGER)=1 AND (
		CAST(substr(ar.mod_version,3,instr(substr(ar.mod_version,3),'.')-1) AS INTEGER)>6 OR
		(CAST(substr(ar.mod_version,3,instr(substr(ar.mod_version,3),'.')-1) AS INTEGER)=6 AND
		CAST(substr(ar.mod_version,instr(ar.mod_version,'.')+instr(substr(ar.mod_version,instr(ar.mod_version,'.')+1),'.')+1) AS INTEGER)>=2))))))
		AND ac.social_mode='full' AND ac.social_mode_enforced=0 AND COALESCE(aa.social_mode_enforced,0)=0
		AND ((ag.cheat_restriction_enabled=0 AND ?=0) OR
		(NOT COALESCE(ac.cheats_detected_at BETWEEN ? AND ?,0) AND ?=0)))))`,
		values:[own.guild_id,own.guild_id,own.cheat_restriction_enabled,Date.now()-7*86400000,Date.now(),
			own.cheats_detected_at!==null&&own.cheats_detected_at>=Date.now()-7*86400000&&own.cheats_detected_at<=Date.now()?1:0]};
}

let cleanup: (() => number) | null = null;
export function register_market_permission_cleanup(handler: () => number) { cleanup = handler; }
export function cleanup_market_permissions() { return cleanup?.() ?? 0; }
