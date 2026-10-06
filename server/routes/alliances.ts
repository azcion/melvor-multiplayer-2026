import type { HandlerResult } from '../http';
import * as runtime from '../app-runtime';
import { has_alliance_access, alliance_for_guild, maintain_alliances, raise_alliance_process, consider_alliance_process, type AllianceProcess } from '../alliances';

function public_guild(guild_id: number) {
	return runtime.db.query<{ guild_id: number; name: string; icon_id: string; created_at: number; type: string; restricts_cheaters: number; market_discovery_restriction_enabled: number; member_count: number; active_member_count: number }, [number, number]>(`SELECT g.id guild_id,g.name,g.icon_id,g.created_at,g.type,g.cheat_restriction_enabled restricts_cheaters,g.market_discovery_restriction_enabled,
		(SELECT COUNT(*) FROM guild_memberships WHERE guild_id=g.id) member_count,
		(SELECT COUNT(*) FROM guild_memberships gm JOIN clients c ON c.id=gm.client_id WHERE gm.guild_id=g.id AND c.last_multiplayer_active_at>=?) active_member_count
		FROM guilds g WHERE id=?`).get(runtime.shadowed_cutoff(), guild_id);
}
function public_alliance(id: number) {
	const a = runtime.db.query<{ id: number; name: string; shared_marketplace: number; created_at: number }, [number]>('SELECT * FROM alliances WHERE id=?').get(id);
	return a ? { ...a, member_guilds: runtime.db.query<{ guild_id: number }, [number]>('SELECT guild_id FROM alliance_memberships WHERE alliance_id=? ORDER BY guild_id').all(id).map(g=>public_guild(g.guild_id)) } : null;
}
export function register_alliance_routes() {
	runtime.session_get_route('/api/alliances', async (req,url,client_id): Promise<HandlerResult> => {
		if (!has_alliance_access(client_id, runtime.get_request_mod_version(req))) return 404;
		runtime.expire_petitions(); runtime.process_council_actions(); maintain_alliances();
		const guild_id = await runtime.get_client_guild_id(client_id);
		if (guild_id === null) return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		const a = alliance_for_guild(guild_id);
		// Incoming proposals must never displace the process holding this Guild's affiliation slot.
		const rows = runtime.db.query<AllianceProcess, [number,number,number,number]>(`SELECT * FROM alliance_processes WHERE
			initiator_guild_id=? OR target_guild_id=? OR alliance_id=?
			ORDER BY id IN (SELECT process_id FROM alliance_pending_slots WHERE guild_id=?) DESC,
				stage IN ('local','waiting','recipient','collective') DESC, id DESC LIMIT 60`).all(guild_id,guild_id,a?.id??-1,guild_id);
		const affiliation_pending = runtime.db.query('SELECT 1 FROM alliance_pending_slots WHERE guild_id=?').get(guild_id) !== null;
		const market_proposal_pending = a !== null && runtime.db.query(`SELECT 1 FROM alliance_processes WHERE alliance_id=?
			AND kind IN ('market_enable','market_disable') AND stage IN ('local','waiting','recipient','collective') LIMIT 1`).get(a.id) !== null;
		return { market_proposal_pending, guild: public_guild(guild_id), affiliation_pending, alliance: a ? public_alliance(a.id) : null, processes: rows.map(p=> {
			const own_council = runtime.db.query<{ lifecycle: string }, [number,number]>(`SELECT g.lifecycle FROM alliance_process_petitions l JOIN guild_petitions g ON g.id=l.petition_id WHERE l.process_id=? AND g.guild_id=? AND l.role!='withdraw' ORDER BY g.id DESC LIMIT 1`).get(p.id,guild_id)?.lifecycle ?? null;
			const ballots = runtime.db.query<{ choice: string | null; guild_id: number },[number]>('SELECT guild_id,choice FROM alliance_ballots WHERE process_id=?').all(p.id);
			return { process_id:p.id,kind:p.kind,display_kind:p.kind==='join' && p.initiator_guild_id===guild_id ? 'apply' : p.kind,name:p.name,stage:p.stage,governance_version:p.governance_version,own_council,
				applicant_consent:p.kind==='join' ? runtime.db.query<{ lifecycle: string },[number]>(`SELECT g.lifecycle FROM alliance_process_petitions l JOIN guild_petitions g ON g.id=l.petition_id WHERE l.process_id=? AND l.role='local'`).get(p.id)?.lifecycle ?? null : null,
				resolution_reason:p.resolution_reason,resolution_guild_name:p.resolution_guild_name,expires_at:p.expires_at,resolved_at:p.resolved_at,
				...(p.kind === 'found' ? { founding_guilds: [public_guild(p.initiator_guild_id), public_guild(p.target_guild_id!)] } : {}),
				...(p.kind === 'remove' ? { target_guild: public_guild(p.target_guild_id!) } : {}),
				...(p.kind === 'join' ? { applicant: public_guild(p.initiator_guild_id) } : {}),
				own_ballot: ballots.find(b=>b.guild_id===guild_id)?.choice??null,
				tally:{ eligible:ballots.length,required_aye:Math.floor(ballots.length/2)+1,aye:ballots.filter(b=>b.choice==='aye').length,nay:ballots.filter(b=>b.choice==='nay').length },
				can_consider:p.kind==='found' && p.target_guild_id===guild_id && p.stage==='waiting',
				consider_blocked_reason:p.kind==='found' && p.target_guild_id===guild_id && p.stage==='waiting' && affiliation_pending ? 'affiliation_pending' : null,
				can_withdraw:p.initiator_guild_id===guild_id && ['waiting','recipient','collective'].includes(p.stage) };
			}) };
	});
	runtime.session_get_route('/api/alliances/discover', async(req,url,client_id)=> {
		if (!has_alliance_access(client_id, runtime.get_request_mod_version(req))) return 404;
		maintain_alliances();
		const page=Number(url.searchParams.get('page')??0);
		if (!Number.isSafeInteger(page)||page<0||page>1000000) return 400;
		const mode=url.searchParams.get('mode');
		const cutoff=runtime.shadowed_cutoff();
		const guild_id=await runtime.get_client_guild_id(client_id);
		const ids=mode==='found' ? runtime.db.query<{ id:number },[number,number,number]>(`SELECT g.id FROM guilds g WHERE g.id!=? AND NOT EXISTS(SELECT 1 FROM alliance_memberships WHERE guild_id=g.id)
			AND (g.type='free_fellowship' OR EXISTS(SELECT 1 FROM guild_memberships m JOIN clients c ON c.id=m.client_id WHERE m.guild_id=g.id AND c.last_multiplayer_active_at>=?)) ORDER BY (SELECT MAX(c.last_multiplayer_active_at) FROM guild_memberships m JOIN clients c ON c.id=m.client_id WHERE m.guild_id=g.id) DESC,g.id DESC LIMIT 21 OFFSET ?`).all(guild_id??-1,cutoff,page*20)
			:runtime.db.query<{ id:number },[number,number]>(`SELECT a.id FROM alliances a WHERE EXISTS(SELECT 1 FROM alliance_memberships am JOIN guild_memberships gm ON gm.guild_id=am.guild_id JOIN clients c ON c.id=gm.client_id WHERE am.alliance_id=a.id AND c.last_multiplayer_active_at>=?) ORDER BY a.id LIMIT 21 OFFSET ?`).all(cutoff,page*20);
		return { entries:ids.slice(0,20).map(row=>mode==='found'?public_guild(row.id):public_alliance(row.id)),has_more:ids.length>20,page };
	});
	runtime.session_get_route('/api/alliances/guild-preview',async(req,url,client_id)=> {
		if(!has_alliance_access(client_id, runtime.get_request_mod_version(req))) return 404;
		const id=Number(url.searchParams.get('guild_id'));
		if(!Number.isSafeInteger(id)||id<1) return 400;
		const guild=public_guild(id);
		return guild ? {guild} : 404;
	});
	runtime.session_post_route('/api/alliances/propose',async(req,url,client_id,json): Promise<HandlerResult> => {
		if(!has_alliance_access(client_id, runtime.get_request_mod_version(req))) return 404;
		if(typeof json.kind!=='string'||!['found','join','leave','remove','market_enable','market_disable'].includes(json.kind)) return 400;
		const kind=json.kind;
		const target=json.target_id===undefined?null:json.target_id;
		if(target!==null&&(typeof target!=='number'||!Number.isSafeInteger(target)||target<1)) return 400;
		const name=kind==='found'?runtime.parse_guild_name(json.name):null;
		if(kind==='found'&&name===null) return {error_lang:'MOD_MP_ALLIANCE_NAME_REQUIRED'};
		return runtime.db.transaction(()=> {
			const guild=runtime.db.query<{guild_id:number},[number]>('SELECT guild_id FROM guild_memberships WHERE client_id=?').get(client_id);
			return guild ? raise_alliance_process(guild.guild_id,client_id,kind,target,name) : {error_lang:'MOD_MP_GUILD_REQUIRED'};
		}).immediate();
	});
	for(const action of ['consider','withdraw']) runtime.session_post_route(`/api/alliances/${action}`,async(req,url,client_id,json): Promise<HandlerResult> => {
		if(!has_alliance_access(client_id, runtime.get_request_mod_version(req))) return 404;
		if(typeof json.process_id!=='number'||!Number.isSafeInteger(json.process_id)||json.process_id<1) return 400;
		const id=json.process_id;
		return runtime.db.transaction(()=> {
			const guild=runtime.db.query<{guild_id:number},[number]>('SELECT guild_id FROM guild_memberships WHERE client_id=?').get(client_id);
			return guild?consider_alliance_process(id,guild.guild_id,client_id,action==='withdraw'):{error_lang:'MOD_MP_GUILD_REQUIRED'};
		}).immediate();
	});
}
