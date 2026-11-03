import type { Database } from 'bun:sqlite';
import type { Arena } from './combat/engine';
import { update_combat, type Encounter } from './combat-inventory';

export const RECOVERY_FORMAT = 1;
export const RETENTION_MS = 30 * 60_000;
type Saved = { encounter_id: string; client_id: number; checkpoint: string; revision: number; state: 'running'|'paused'|'terminal'; expires: number; format: number };
type Availability = { clock: number; last_seen: number; drain_at: number|null; incompatible: number };
export function combat_availability(db: Database): Availability {
	const value = db.query<Availability,[]>('SELECT * FROM combat_availability WHERE id=1').get()!;
	if (db.query<{value:string},[]>("SELECT value FROM service_settings WHERE key='maintenance'").get()?.value === '1') return {...value,drain_at:value.drain_at ?? 0};
	return value;
}
// Only a healthy authority connection advances this coarse reconnect-opportunity clock.
export function combat_available(db: Database, now = Date.now()) {
	const a = combat_availability(db), delta = now - a.last_seen;
	if (delta > 10_000 && a.last_seen > 0) db.query("UPDATE combat_recovery SET expires=MAX(expires,?) WHERE state='paused'").run(a.clock + 5 * 60_000);
	db.query('UPDATE combat_availability SET clock=clock+?,last_seen=? WHERE id=1').run(a.drain_at === null && delta >= 0 && delta <= 10_000 ? delta : 0, now);
	expire_recovery(db);
	return combat_availability(db);
}
export function set_combat_drain(db: Database, minutes: number|null, incompatible = false, now = Date.now()) {
	if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 60)) throw new Error('Minutes must be 0–60');
	db.query('UPDATE combat_availability SET drain_at=?,incompatible=?,last_seen=? WHERE id=1').run(minutes === null ? null : now + minutes * 60_000, incompatible ? 1 : 0, now);
}
// Read the admission gate and battle counts from one snapshot. Legacy encounters have no recovery row.
export function combat_drain_status(db: Database) {
	return db.transaction(() => {
		const availability = db.query<Availability,[]>('SELECT * FROM combat_availability WHERE id=1').get()!;
		const { running, paused } = db.query<{running:number; paused:number},[]>(`
			SELECT COUNT(CASE WHEN r.state IS NULL OR r.state!='paused' THEN 1 END) AS running,
				COUNT(CASE WHEN r.state='paused' THEN 1 END) AS paused
			FROM combat_encounters e LEFT JOIN combat_recovery r ON r.encounter_id=e.id WHERE e.status='active'
		`).get()!;
		return {...availability, running_battles: running, paused_battles: paused,
			ready: availability.drain_at !== null && running === 0 && (!availability.incompatible || paused === 0)};
	})();
}
export async function wait_combat_drain(db: Database, report: (status: ReturnType<typeof combat_drain_status>) => void) {
	const initial = combat_drain_status(db);
	if (initial.drain_at === null) throw new Error('Enable a combat drain before waiting.');
	const deadline = Math.min(initial.drain_at, Date.now() + 60 * 60_000) + 15_000;
	let previous = '';
	for (;;) {
		const status = combat_drain_status(db);
		if (status.drain_at !== initial.drain_at || status.incompatible !== initial.incompatible)
			throw new Error('Combat drain changed while waiting; inspect status before deployment.');
		const counts = JSON.stringify([status.running_battles,status.paused_battles,status.ready]);
		if (counts !== previous) { report(status); previous = counts; }
		if (status.ready) return;
		if (Date.now() >= deadline) throw new Error('Combat drain did not finish; admissions remain closed. Inspect combat service health before deployment.');
		await Bun.sleep(1000);
	}
}
function finish(db: Database, row: Saved, status: 'expired'|'interrupted'|'fled') {
	return db.transaction(() => {
		const arena = JSON.parse(row.checkpoint) as Arena;
		const owner = db.query<Encounter,[string]>('SELECT * FROM combat_encounters WHERE id=?').get(row.encounter_id)!;
		// Incompatible rules may no longer validate; interruption preserves already committed grants.
		if (!update_combat(db,owner.controller,row.encounter_id,owner.used,status,owner.raid_endpoint !== null ? owner.raid_completed : owner.practice_completed))
			update_combat(db,owner.controller,row.encounter_id,owner.used,'interrupted');
		arena.status = status === 'interrupted' ? 'expired' : status;
		db.query("UPDATE combat_recovery SET state='terminal',checkpoint=?,revision=revision+1 WHERE encounter_id=?").run(JSON.stringify(arena),row.encounter_id);
	}).immediate();
}
export function expire_recovery(db: Database) {
	const a = combat_availability(db);
	for (const row of db.query<Saved,[number]>("SELECT * FROM combat_recovery WHERE state='paused' AND expires<=?").all(a.clock)) finish(db,row,'expired');
}
export function pause_recovery(db: Database, controller?: string, encounter?: string) {
	const clock = combat_availability(db).clock;
	db.query(`UPDATE combat_recovery SET state='paused',expires=?,revision=revision+1 WHERE state='running' AND (? IS NULL OR encounter_id=?)
		AND encounter_id IN (SELECT id FROM combat_encounters WHERE ? IS NULL OR controller=?)`).run(clock+RETENTION_MS,encounter??null,encounter??null,controller??null,controller??null);
}
export function save_recovery(db: Database, controller: string, arena: Arena, revision: number, initial = false): number|null {
	return db.transaction(() => {
		const owner = db.query<Encounter,[string]>('SELECT * FROM combat_encounters WHERE id=?').get(arena.id);
		if (!owner || owner.controller !== controller) return null;
		const row = db.query<Saved,[string]>('SELECT * FROM combat_recovery WHERE encounter_id=?').get(arena.id);
		if (initial) {
			if (row || revision !== 0 || owner.status !== 'active') return null;
		} else if (!row || row.state !== 'running' || row.revision !== revision) return null;
		if (!update_combat(db,controller,arena.id,arena.food_used,arena.status,arena.run?.completed,Date.now(),arena.run?.total_ms)) return null;
		const next = revision+1, state = arena.status === 'active' ? 'running' : 'terminal';
		db.query(`INSERT INTO combat_recovery(encounter_id,client_id,checkpoint,revision,state) VALUES(?,?,?,?,?)
			ON CONFLICT(encounter_id) DO UPDATE SET checkpoint=excluded.checkpoint,revision=excluded.revision,state=excluded.state`)
			.run(arena.id,owner.client_id,JSON.stringify(arena),next,state);
		return next;
	}).immediate();
}
export function read_recovery(db: Database, client: number) {
	expire_recovery(db);
	let row = db.query<Saved,[number]>('SELECT * FROM combat_recovery WHERE client_id=?').get(client);
	if (!row) return null;
	const owner = db.query<Encounter,[string]>('SELECT * FROM combat_encounters WHERE id=?').get(row.encounter_id)!;
	if ((row.format !== RECOVERY_FORMAT || owner.status !== 'active') && row.state !== 'terminal') { finish(db,row,'interrupted'); row = db.query<Saved,[number]>('SELECT * FROM combat_recovery WHERE client_id=?').get(client)!; }
	return { arena: JSON.parse(row.checkpoint) as Arena, state: row.state, revision: row.revision,
		remaining_ms: Math.max(0,row.expires-combat_availability(db).clock) };
}
export function resume_recovery(db: Database, client: number, controller: string, id: string) {
	return db.transaction(() => {
		const saved = read_recovery(db,client);
		if (!saved || saved.arena.id !== id || saved.state !== 'paused' || combat_availability(db).drain_at !== null) return null;
		if (db.query('UPDATE combat_encounters SET controller=? WHERE id=? AND status=\'active\'').run(controller,id).changes !== 1) return null;
		db.query("UPDATE combat_recovery SET state='running',revision=revision+1 WHERE encounter_id=?").run(id);
		return {...saved, state: 'running', revision: saved.revision+1};
	}).immediate();
}
export function abandon_recovery(db: Database, client: number, id: string) {
	const row = db.query<Saved,[number,string]>('SELECT * FROM combat_recovery WHERE client_id=? AND encounter_id=?').get(client,id);
	if (!row || row.state === 'running') return false;
	if (row.state === 'paused') finish(db,row,'fled');
	db.query('DELETE FROM combat_recovery WHERE encounter_id=?').run(id);
	return true;
}

export function invalidate_recovery(db: Database) {
	for (const row of db.query<Saved,[]>("SELECT * FROM combat_recovery WHERE state='paused'").all()) finish(db,row,'interrupted');
}
