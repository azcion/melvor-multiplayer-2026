import type { JsonObject } from './http';
import { db, get_service_setting } from './db';
import { PETITION_LIFETIME, type PetitionType } from './council';
import { is_client_version_at_least } from './client-version-policy';

export type AllianceProcess = {
	id: number; kind: string; initiator_guild_id: number; target_guild_id: number | null;
	alliance_id: number | null; name: string | null; subject: string; stage: string;
	created_at: number; expires_at: number; resolved_at: number | null;
};
const pending = "('local','waiting','recipient','collective')";
export const alliance_capable = (version: unknown) => version === 'development' || is_client_version_at_least(version, '1.6.2');
// Temporary preview gate: only characters linked to the maintainer's stored account.
export const ALLIANCE_PREVIEW_ACCOUNT_ID = 1;
export function has_alliance_access(client_id: number, version: unknown): boolean {
	return get_service_setting('alliance_preview_enabled') !== '0' && alliance_capable(version) && db.query<{ melvor_account_id: number | null }, [number]>(
		'SELECT melvor_account_id FROM clients WHERE id = ?'
	).get(client_id)?.melvor_account_id === ALLIANCE_PREVIEW_ACCOUNT_ID;
}
export function alliance_for_guild(guild_id: number) {
	return db.query<{ id: number; name: string; shared_marketplace: number; created_at: number }, [number]>(
		'SELECT a.* FROM alliances a JOIN alliance_memberships m ON m.alliance_id = a.id WHERE m.guild_id = ?').get(guild_id);
}
export function alliance_guilds(alliance_id: number): number[] {
	return db.query<{ guild_id: number }, [number]>('SELECT guild_id FROM alliance_memberships WHERE alliance_id = ? ORDER BY guild_id')
		.all(alliance_id).map(row => row.guild_id);
}
function process(id: number) { return db.query<AllianceProcess, [number]>('SELECT * FROM alliance_processes WHERE id = ?').get(id); }
function guild_exists(id: number) { return db.query('SELECT 1 FROM guilds WHERE id = ?').get(id) !== null; }
function slot(id: number) { return db.query('SELECT 1 FROM alliance_pending_slots WHERE guild_id = ?').get(id) !== null; }
function revise() {
	// Membership changes affect discovery, Chat, Council and Marketplace across the roster.
	db.query('UPDATE clients SET event_revision = event_revision + 1').run();
}
export function finish_alliance_process(p: AllianceProcess, stage: string, now = Date.now()) {
	db.query('UPDATE alliance_processes SET stage = ?, resolved_at = ? WHERE id = ?').run(stage, now, p.id);
	db.query('DELETE FROM alliance_pending_slots WHERE process_id = ?').run(p.id);
	db.query(`UPDATE guild_petitions SET lifecycle = 'withdrawn', resolved_at = ?, subject_locked = 0
		WHERE lifecycle = 'active' AND id IN (SELECT petition_id FROM alliance_process_petitions WHERE process_id = ?)`)
		.run(now, p.id);
	revise();
}
function council_petition(guild_id: number, client_id: number, p: AllianceProcess, role: string, type: PetitionType, now: number) {
	const guild = db.query<{ name: string }, [number]>('SELECT name FROM guilds WHERE id = ?').get(guild_id)!;
	const id = Number(db.query(`INSERT INTO guild_petitions
		(guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,rule_version)
		VALUES(?,?,?,?,?,?,?,2)`).run(guild_id, guild.name, type, `alliance:${p.id}:${role}`, client_id, now, p.expires_at).lastInsertRowid);
	db.query(`INSERT INTO guild_petition_voters(petition_id,client_id) SELECT ?, m.client_id FROM guild_memberships m
		JOIN clients c ON c.id = m.client_id WHERE m.guild_id = ? AND c.last_multiplayer_active_at >= ?`)
		.run(id, guild_id, now - 4 * 86400000);
	db.query('INSERT INTO alliance_process_petitions VALUES(?,?,?)').run(id, p.id, role);
	return id;
}
function extend(p: AllianceProcess, now: number) {
	const expires_at = now + PETITION_LIFETIME;
	db.query('UPDATE alliance_processes SET expires_at = ? WHERE id = ?').run(expires_at, p.id);
	db.query(`UPDATE guild_petitions SET expires_at = ? WHERE lifecycle = 'active'
		AND id IN (SELECT petition_id FROM alliance_process_petitions WHERE process_id = ?)`)
		.run(expires_at, p.id);
	revise();
}
export function alliance_ballot_activity(petition_id: number, now: number) {
	const linked = db.query<{ process_id: number }, [number]>('SELECT process_id FROM alliance_process_petitions WHERE petition_id = ?').get(petition_id);
	if (!linked) return;
	const p = process(linked.process_id);
	if (p && ['local','waiting','recipient','collective'].includes(p.stage) && p.expires_at > now) extend(p, now);
}
function same_roster(p: AllianceProcess) {
	if (p.alliance_id === null) return false;
	const current = alliance_guilds(p.alliance_id);
	const snapshot = db.query<{ guild_id: number }, [number]>('SELECT guild_id FROM alliance_ballots WHERE process_id = ? ORDER BY guild_id')
		.all(p.id).map(row => row.guild_id);
	return current.length >= 2 && JSON.stringify(current) === JSON.stringify(snapshot);
}
function cancel_roster_votes(alliance_id: number, now: number) {
	for (const p of db.query<AllianceProcess, [number]>(`SELECT * FROM alliance_processes WHERE alliance_id = ? AND stage IN ${pending}`)
		.all(alliance_id)) finish_alliance_process(p, 'cancelled', now);
}
export function remove_alliance_guild(guild_id: number, now = Date.now()) {
	const alliance = alliance_for_guild(guild_id);
	if (!alliance) return;
	db.query('DELETE FROM alliance_memberships WHERE guild_id = ?').run(guild_id);
	cancel_roster_votes(alliance.id, now);
	if (alliance_guilds(alliance.id).length < 2) db.query('DELETE FROM alliances WHERE id = ?').run(alliance.id);
	revise();
}
function affiliate(guild_id: number, alliance_id: number, now: number, except: number) {
	db.query('INSERT INTO alliance_memberships VALUES(?,?,?)').run(guild_id, alliance_id, now);
	for (const other of db.query<AllianceProcess, [number, number, number]>(`SELECT * FROM alliance_processes WHERE stage IN ${pending}
		AND id != ? AND (initiator_guild_id = ? OR target_guild_id = ?) AND kind IN ('found','join')`).all(except, guild_id, guild_id))
		finish_alliance_process(other, 'cancelled', now);
}
function resolve_collective(p: AllianceProcess, now: number) {
	if (!same_roster(p)) return finish_alliance_process(p, 'cancelled', now);
	const ballots = db.query<{ choice: string | null }, [number]>('SELECT choice FROM alliance_ballots WHERE process_id = ?').all(p.id);
	const aye = ballots.filter(b => b.choice === 'aye').length;
	const nay = ballots.filter(b => b.choice === 'nay').length;
	const majority = Math.floor(ballots.length / 2) + 1;
	if (aye < majority) {
		if (ballots.length - nay < majority) finish_alliance_process(p, 'denied', now);
		return;
	}
	if (p.kind === 'join') {
		if (alliance_for_guild(p.initiator_guild_id) || !guild_exists(p.initiator_guild_id)) return finish_alliance_process(p, 'cancelled', now);
		affiliate(p.initiator_guild_id, p.alliance_id!, now, p.id);
	} else if (p.kind === 'remove') {
		if (p.target_guild_id === null || !alliance_guilds(p.alliance_id!).includes(p.target_guild_id)) return finish_alliance_process(p, 'cancelled', now);
		// Resolve before the roster trigger cancels every unfinished proposal.
		finish_alliance_process(p, 'accepted', now);
		db.query('DELETE FROM alliance_memberships WHERE guild_id = ?').run(p.target_guild_id);
		return;
	} else {
		db.query('UPDATE alliances SET shared_marketplace = ? WHERE id = ?').run(p.kind === 'market_enable' ? 1 : 0, p.alliance_id!);
	}
	finish_alliance_process(p, 'accepted', now);
	if (p.kind === 'join' || p.kind === 'remove') cancel_roster_votes(p.alliance_id!, now);
}
function collective(p: AllianceProcess, petitioner_id: number, now: number) {
	const roster = alliance_guilds(p.alliance_id!);
	if (roster.length < 2) return finish_alliance_process(p, 'cancelled', now);
	db.query("UPDATE alliance_processes SET stage = 'collective' WHERE id = ?").run(p.id);
	p.stage = 'collective'; p.expires_at = now + PETITION_LIFETIME;
	extend(p, now);
	for (const guild_id of roster) {
		const carried = p.kind !== 'join' && guild_id === p.initiator_guild_id;
		db.query('INSERT INTO alliance_ballots VALUES(?,?,?,?)').run(p.id, guild_id, carried ? 'aye' : null, carried ? now : null);
		if (!carried) council_petition(guild_id, petitioner_id, p, 'ballot', 'alliance_ballot', now);
	}
	revise();
}
export function execute_alliance_petition(petition: { id: number; petitioner_id: number; guild_id: number }, now = Date.now()): string {
	const link = db.query<{ process_id: number; role: string }, [number]>('SELECT * FROM alliance_process_petitions WHERE petition_id = ?').get(petition.id);
	if (!link) return 'cancelled';
	const p = process(link.process_id)!;
	if (!['local','waiting','recipient','collective'].includes(p.stage)) return p.stage;
	if (p.expires_at <= now) { finish_alliance_process(p, 'lapsed', now); return 'lapsed'; }
	if (link.role === 'withdraw') { finish_alliance_process(p, 'withdrawn', now); return 'withdrawn'; }
	if (link.role === 'ballot') {
		db.query("UPDATE alliance_ballots SET choice = 'aye', submitted_at = ? WHERE process_id = ? AND guild_id = ? AND choice IS NULL")
			.run(now, p.id, petition.guild_id);
		resolve_collective(p, now); return 'ballot_recorded';
	}
	// The local Petition can be retried after collective creation committed but before
	// the Council worker recorded execution success. Its ballot snapshot already exists.
	if (link.role === 'local' && p.stage === 'collective') return 'submitted';
	if (link.role === 'recipient') {
		if (alliance_for_guild(p.initiator_guild_id) || alliance_for_guild(p.target_guild_id!) ||
			!guild_exists(p.initiator_guild_id) || !guild_exists(p.target_guild_id!)) { finish_alliance_process(p, 'cancelled', now); return 'cancelled'; }
		const id = Number(db.query('INSERT INTO alliances(name,created_at) VALUES(?,?)').run(p.name, now).lastInsertRowid);
		affiliate(p.initiator_guild_id, id, now, p.id); affiliate(p.target_guild_id!, id, now, p.id);
		finish_alliance_process(p, 'accepted', now); return 'founded';
	}
	if (p.kind === 'found') {
		if (alliance_for_guild(p.initiator_guild_id) || alliance_for_guild(p.target_guild_id!) || !guild_exists(p.target_guild_id!)) {
			finish_alliance_process(p, 'cancelled', now); return 'cancelled';
		}
		db.query("UPDATE alliance_processes SET stage = 'waiting' WHERE id = ?").run(p.id); extend(p, now); revise(); return 'submitted';
	}
	if (p.kind === 'leave') {
		finish_alliance_process(p, 'accepted', now); remove_alliance_guild(p.initiator_guild_id, now); return 'departed';
	}
	if ((p.kind === 'join' && alliance_for_guild(p.initiator_guild_id)) ||
		(p.kind !== 'join' && alliance_for_guild(p.initiator_guild_id)?.id !== p.alliance_id)) {
		finish_alliance_process(p, 'cancelled', now); return 'cancelled';
	}
	collective(p, petition.petitioner_id, now); return 'submitted';
}
export function maintain_alliances(now = Date.now()) {
	db.transaction(() => {
		for (const a of db.query<{ id: number }, []>('SELECT id FROM alliances WHERE (SELECT COUNT(*) FROM alliance_memberships WHERE alliance_id = alliances.id) < 2').all()) {
			cancel_roster_votes(a.id, now); db.query('DELETE FROM alliances WHERE id = ?').run(a.id); revise();
		}
		for (const p of db.query<AllianceProcess, []>(`SELECT * FROM alliance_processes WHERE stage IN ${pending}`).all()) {
			if (!guild_exists(p.initiator_guild_id) || (p.target_guild_id !== null && !guild_exists(p.target_guild_id)) ||
				(['found','join'].includes(p.kind) && alliance_for_guild(p.initiator_guild_id)) ||
				(p.kind === 'found' && alliance_for_guild(p.target_guild_id!)) ||
				(p.alliance_id !== null && !db.query('SELECT 1 FROM alliances WHERE id = ?').get(p.alliance_id))) {
				finish_alliance_process(p, 'cancelled', now); continue;
			}
			if (p.stage === 'collective' && !same_roster(p)) { finish_alliance_process(p, 'cancelled', now); continue; }
			const petitions = db.query<{ guild_id: number; lifecycle: string; role: string }, [number]>(`SELECT p.guild_id,p.lifecycle,l.role FROM guild_petitions p
				JOIN alliance_process_petitions l ON l.petition_id = p.id WHERE l.process_id = ?`).all(p.id);
			for (const petition of petitions) {
				if (petition.role === 'withdraw') continue;
				if (petition.role === 'ballot') {
					if (petition.lifecycle === 'denied') db.query("UPDATE alliance_ballots SET choice = 'nay', submitted_at = ? WHERE process_id = ? AND guild_id = ? AND choice IS NULL").run(now,p.id,petition.guild_id);
				} else if (['denied','lapsed','withdrawn'].includes(petition.lifecycle)) {
					finish_alliance_process(p, petition.lifecycle, now); break;
				}
			}
			if (!['local','waiting','recipient','collective'].includes(process(p.id)!.stage)) continue;
			if (p.expires_at <= now) finish_alliance_process(p, 'lapsed', now);
			else if (p.stage === 'collective') resolve_collective(p, now);
		}
	}).immediate();
}
export function raise_alliance_process(guild_id: number, client_id: number, kind: string, target: number | null, name: string | null, now = Date.now()): JsonObject {
	maintain_alliances(now);
	const alliance = alliance_for_guild(guild_id);
	if (['found','join'].includes(kind)) {
		if (alliance || slot(guild_id)) return { error: 'This Guild already has an Alliance or a pending affiliation process.' };
		if (kind === 'found' && name === null) return { error_lang: 'MOD_MP_ALLIANCE_NAME_REQUIRED' };
		if (kind === 'found' && (target === null || target === guild_id || !guild_exists(target) || alliance_for_guild(target))) return { error: 'Founding Guild is unavailable.' };
		if (kind === 'join' && (target === null || !db.query('SELECT 1 FROM alliances WHERE id = ?').get(target))) return { error: 'Alliance is unavailable.' };
	} else {
		if (!alliance) return { error: 'Alliance membership is required.' };
		if (kind === 'remove' && (target === null || target === guild_id || alliance_guilds(alliance.id).length < 3 || alliance_for_guild(target)?.id !== alliance.id)) return { error: 'Remove Guild requires at least three Member Guilds and a current target.' };
		if ((kind === 'market_enable' && alliance.shared_marketplace === 1) || (kind === 'market_disable' && alliance.shared_marketplace === 0)) return { error: 'That policy is already in effect.' };
	}
	const alliance_id = kind === 'join' ? target : alliance?.id ?? null;
	const subject = kind === 'found' ? `found:${guild_id}` : kind === 'join' ? `join:${guild_id}` : kind === 'leave' ? `leave:${guild_id}`
		: kind === 'remove' ? `alliance:${alliance_id}:member:${target}` : `alliance:${alliance_id}:market`;
	if (db.query(`SELECT 1 FROM alliance_processes WHERE subject = ? AND stage IN ${pending}`).get(subject)) return { error: 'A proposal on this subject is already pending.' };
	const id = Number(db.query(`INSERT INTO alliance_processes(kind,initiator_guild_id,target_guild_id,alliance_id,name,subject,created_at,expires_at)
		VALUES(?,?,?,?,?,?,?,?)`).run(kind, guild_id, kind === 'found' || kind === 'remove' ? target : null, alliance_id, name, subject, now, now + PETITION_LIFETIME).lastInsertRowid);
	if (kind === 'found' || kind === 'join') db.query('INSERT INTO alliance_pending_slots VALUES(?,?)').run(guild_id, id);
	const petition_id = council_petition(guild_id,client_id,process(id)!,'local',`alliance_${kind}` as PetitionType,now);
	revise(); return { success: true, process_id: id, petition_id };
}
export function consider_alliance_process(id: number, guild_id: number, client_id: number, withdraw: boolean, now = Date.now()): JsonObject {
	maintain_alliances(now);
	const p = process(id);
	if (!p) return { error: 'Proposal is unavailable.' };
	if (withdraw) {
		if (p.initiator_guild_id !== guild_id || !['waiting','recipient','collective'].includes(p.stage)) return { error: 'Submitted proposal is unavailable.' };
		if (db.query(`SELECT 1 FROM alliance_process_petitions l JOIN guild_petitions p ON p.id=l.petition_id
			WHERE l.process_id=? AND l.role='withdraw' AND p.subject_locked=1`).get(id)) return { error: 'Withdrawal is already pending.' };
		return { success:true, petition_id:council_petition(guild_id,client_id,p,'withdraw','alliance_withdraw',now) };
	}
	if (p.kind !== 'found' || p.stage !== 'waiting' || p.target_guild_id !== guild_id || slot(guild_id) || alliance_for_guild(guild_id)) return { error:'This Founding Proposal cannot be considered now.' };
	db.query('INSERT INTO alliance_pending_slots VALUES(?,?)').run(guild_id,id);
	db.query("UPDATE alliance_processes SET stage='recipient' WHERE id=?").run(id); extend(p,now); p.expires_at=now+PETITION_LIFETIME;
	revise(); return { success:true, petition_id:council_petition(guild_id,client_id,p,'recipient','alliance_consider',now) };
}
