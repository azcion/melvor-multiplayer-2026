import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { create_test_database } from '../support/database';
import { maintain_global_raids, raid_schedule_state, raid_weekend, RAID_WEEK, RAID_WEEKEND } from '../../raid-schedule';
import { migrations } from '../../db/schema';

const friday = Date.parse('2026-10-16T12:00:00Z');
const health = (players: number) => players * 10_000;

function fixture() {
	const database = create_test_database();
	database.query('UPDATE raid_schedule SET starts_at = ?').run(friday);
	const guild_id = (database.query("SELECT id FROM guilds WHERE type = 'free_fellowship'").get() as { id: number }).id;
	database.query('UPDATE guilds SET created_at = ? WHERE id = ?').run(friday - RAID_WEEK, guild_id);
	for (const [id, joined_at, active_at] of [[1, friday - 1, friday - 60_000], [2, friday - 1, friday - 5 * 86400_000], [3, friday + 1, friday + 1]]) {
		database.query('INSERT INTO clients(id, client_identifier, client_key, friend_code, display_name, icon_id, last_multiplayer_active_at) VALUES(?, ?, ?, ?, ?, ?, ?)')
			.run(id, `schedule-${id}`, `test-key-${id}`, `111-111-11${id}`, `Raider ${id}`, 'melvorD:Crab', active_at);
		database.query('INSERT INTO guild_memberships(id, client_id, guild_id, joined_at) VALUES(?, ?, ?, ?)')
			.run(id, id, guild_id, joined_at);
	}
	return { database, guild_id };
}

test('uses exact UTC opening and closing boundaries across DST and year changes', () => {
	for (const opening of ['2026-10-16T12:00:00Z', '2026-10-23T12:00:00Z', '2026-10-30T12:00:00Z', '2027-01-01T12:00:00Z']) {
		const start = Date.parse(opening);
		expect(raid_weekend(start - 1).active).toBe(false);
		expect(raid_weekend(start)).toMatchObject({ starts_at: start, ends_at: start + RAID_WEEKEND, active: true });
		expect(raid_weekend(start + RAID_WEEKEND - 1).active).toBe(true);
		expect(raid_weekend(start + RAID_WEEKEND).active).toBe(false);
		expect(raid_weekend(start + RAID_WEEK)).toMatchObject({ starts_at: start + RAID_WEEK, active: true });
	}
});

test('waits for the rollout Friday, then snapshots eligible tenures and four-day scaling', () => {
	const { database, guild_id } = fixture();
	try {
		expect(maintain_global_raids(database, friday - RAID_WEEK, health)).toBe(0);
		expect(raid_schedule_state(database, friday - 1)).toMatchObject({ active: false, available_at: friday });
		expect(maintain_global_raids(database, friday, health)).toBe(1);
		expect(database.query('SELECT guild_id, started_at, expires_at, cycle_start, active_member_count, max_health FROM guild_raids').all())
			.toEqual([{ guild_id, started_at: friday, expires_at: friday + RAID_WEEKEND, cycle_start: friday, active_member_count: 1, max_health: 10_000 }]);
		expect(database.query('SELECT client_id FROM guild_raid_roster ORDER BY client_id').all()).toEqual([{ client_id: 1 }, { client_id: 2 }]);
		expect(database.query("SELECT actor_client_id, created_at FROM guild_activity_events WHERE event_type = 'raid_started'").all())
			.toEqual([{ actor_client_id: null, created_at: friday }]);
	} finally { database.close(); }
});

test('late recovery retains Friday timing and never restarts a completed Raid', () => {
	const { database, guild_id } = fixture();
	let restarted: Database | undefined;
	try {
		expect(maintain_global_raids(database, friday + 2 * 86400_000, health, guild_id)).toBe(1);
		database.query('UPDATE guild_raids SET remaining_health = 0, secured_at = ?').run(friday + 2 * 86400_000);
		restarted = Database.deserialize(database.serialize(), { strict: true });
		restarted.run('PRAGMA foreign_keys = ON');
		for (let retry = 0; retry < 5; retry++) expect(maintain_global_raids(restarted, friday + 2 * 86400_000 + retry, health)).toBe(0);
		expect(restarted.query('SELECT started_at, expires_at FROM guild_raids').all())
			.toEqual([{ started_at: friday, expires_at: friday + RAID_WEEKEND }]);
		expect(() => restarted!.query('INSERT INTO guild_raids(guild_id, started_at, expires_at, cycle_start, active_member_count, required_contributors, max_health, remaining_health) VALUES(?, ?, ?, ?, 1, 1, 100, 100)')
			.run(guild_id, friday, friday + RAID_WEEKEND, friday)).toThrow();
		expect(maintain_global_raids(restarted, friday + RAID_WEEKEND, health)).toBe(0);
		expect(raid_schedule_state(restarted, friday + RAID_WEEKEND)).toMatchObject({ active: false, available_at: friday + RAID_WEEK });
		expect(maintain_global_raids(restarted, friday + 3 * RAID_WEEK, health)).toBe(1);
		expect(restarted.query('SELECT cycle_start FROM guild_raids ORDER BY cycle_start').all())
			.toEqual([{ cycle_start: friday }, { cycle_start: friday + 3 * RAID_WEEK }]);
	} finally { restarted?.close(); database.close(); }
});

test('Guilds created after opening wait until the next weekend', () => {
	const { database, guild_id } = fixture();
	try {
		database.query('UPDATE guilds SET created_at = ? WHERE id = ?').run(friday + 1, guild_id);
		expect(maintain_global_raids(database, friday + 60_000, health)).toBe(0);
		expect(maintain_global_raids(database, friday + RAID_WEEK, health)).toBe(1);
		expect(database.query('SELECT client_id FROM guild_raid_roster ORDER BY client_id').all()).toHaveLength(3);
	} finally { database.close(); }
});

test('rollout migration preserves an existing Raid and its roster and waits past its deadline', () => {
	const database = new Database(':memory:', { strict: true });
	try {
		for (const migration of migrations.filter(m => m.version < 167)) {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
			database.run(migration.sql);
			database.run('PRAGMA foreign_keys = ON');
		}
		const guild = database.query("SELECT id FROM guilds WHERE type = 'free_fellowship'").get() as { id: number };
		database.query("INSERT INTO clients(id, client_identifier, client_key, friend_code, display_name, icon_id) VALUES(1,'legacy','test-key','111-222-333','Legacy','melvorD:Crab')").run();
		database.query('INSERT INTO guild_memberships(id, client_id, guild_id) VALUES(1,1,?)').run(guild.id);
		const end = Math.max(Date.now() + RAID_WEEKEND, friday + 2 * RAID_WEEK + 1);
		database.query('INSERT INTO guild_raids(id, guild_id, started_at, expires_at, active_member_count, required_contributors, max_health, remaining_health) VALUES(1, ?, ?, ?, 1, 1, 1000, 500)')
			.run(guild.id, end - RAID_WEEKEND, end);
		database.query('INSERT INTO guild_raid_roster(raid_id, membership_id, client_id, contribution) VALUES(1,1,1,500)').run();
		database.run(migrations.find(m => m.version === 167)!.sql);
		const schedule = database.query('SELECT starts_at FROM raid_schedule').get() as { starts_at: number };
		expect(schedule.starts_at).toBeGreaterThanOrEqual(end);
		expect(schedule.starts_at - end).toBeLessThan(RAID_WEEK);
		expect(raid_weekend(schedule.starts_at).starts_at).toBe(schedule.starts_at);
		expect(database.query('SELECT remaining_health, cycle_start FROM guild_raids').all()).toEqual([{ remaining_health: 500, cycle_start: null }]);
		expect(database.query('SELECT contribution FROM guild_raid_roster').all()).toEqual([{ contribution: 500 }]);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { database.close(); }
});

test('domain cycles and Assault recovery preserve grants, deadlines, and settlement grace', async () => {
	const { mkdtempSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const directory = mkdtempSync(join(tmpdir(), 'raid-clock-'));
	const database_path = join(directory, 'database.sqlite');
	const database = create_test_database(database_path);
	const guild_id = (database.query("SELECT id FROM guilds WHERE type = 'free_fellowship'").get() as { id: number }).id;
	database.query('UPDATE raid_schedule SET starts_at = ?').run(friday);
	database.query('UPDATE guilds SET created_at = ? WHERE id = ?').run(friday - RAID_WEEK, guild_id);
	database.query("INSERT INTO clients(id, client_identifier, client_key, friend_code, display_name, icon_id, last_multiplayer_active_at) VALUES(1, 'clock', 'test-key', '111-222-333', 'Clock', 'melvorD:Crab', ?)").run(friday);
	database.query('INSERT INTO guild_memberships(id, client_id, guild_id, joined_at) VALUES(1,1,?,?)').run(guild_id, friday - 1);
	database.close();
	try {
		const source = `
			import { get_raid_state, activate_raid, reserve_assault, settle_assault, abandon_assault } from './raid';
			import { db } from './db';
			const start = ${friday}, end = start + ${RAID_WEEKEND};
			const state = time => get_raid_state(1, time, '1.6.7');
			const initial = state(start);
			activate_raid(1, start + 1000, '1.6.7');
			activate_raid(1, start + 2000, '1.6.7');
			const entered = state(start + 2000);
			const saturday = state(start + 86400000);
			const sunday = state(start + 172800000);
			const assault = reserve_assault(1, 1, 'clock-test', end - 1000, '1.6.7');
			const closed = state(end);
			const rejected = reserve_assault(1, 1, 'closed-test', end, '1.6.7');
			const settled = settle_assault(1, assault.assault_id, assault.settlement_key, 'success', end + 1000, end + 60000);
			const next = state(start + ${RAID_WEEK});
			const time = start + ${RAID_WEEK} + 1000;
			db.query('UPDATE guild_raid_roster SET manual_assaults_remaining = 1 WHERE raid_id = ?').run(next.raid.raid_id);
			const last = reserve_assault(1, 1, 'last-session', time, '1.6.7');
			const last_state = state(time);
			const replay = reserve_assault(1, 1, 'last-session', time + 1, '1.6.7');
			const rejoined = reserve_assault(1, 1, 'new-session', time + 1, '1.6.7');
			const expired = reserve_assault(1, 1, 'last-session', last.combat_deadline, '1.6.7');
			const abandoned = abandon_assault(1, last.combat_deadline);
			const exhausted = reserve_assault(1, 1, 'new-session', last.combat_deadline + 1, '1.6.7');
			db.query('UPDATE guild_raid_roster SET manual_assaults_remaining = 2 WHERE raid_id = ?').run(next.raid.raid_id);
			const delayed = reserve_assault(1, 1, 'delay-session', last.combat_deadline + 1, '1.6.7');
			const grace_end = delayed.combat_deadline + 86400000;
			const grace_state = state(grace_end);
			const grace_settled = settle_assault(1, delayed.assault_id, delayed.settlement_key, 'success', delayed.combat_deadline, grace_end);
			const orphan = reserve_assault(1, 1, 'orphan-session', grace_end + 1, '1.6.7');
			const orphan_end = orphan.combat_deadline + 86400000;
			state(orphan_end);
			const at_boundary = db.query('SELECT outcome FROM guild_raid_assaults WHERE id = ?').get(orphan.assault_id);
			state(orphan_end + 1);
			const cleaned = db.query('SELECT outcome FROM guild_raid_assaults WHERE id = ?').get(orphan.assault_id);
			console.log(JSON.stringify({ initial, entered, saturday, sunday, closed, rejected, settled, next,
				last, last_state, replay, rejoined, expired, abandoned, exhausted, delayed, grace_state, grace_settled, at_boundary, cleaned,
				entries: db.query('SELECT count(*) AS count FROM raid_entries').get().count }));
		`;
		const child = Bun.spawn({ cmd: [process.execPath, '-e', source], cwd: new URL('../..', import.meta.url).pathname,
			env: { ...process.env, DB_PATH: database_path }, stdout: 'pipe', stderr: 'pipe' });
		const [exit_code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		expect({ exit_code, stderr }).toEqual({ exit_code: 0, stderr: '' });
		const result = JSON.parse(stdout.trim());
		expect(result.initial).toMatchObject({ entered: false, can_activate: true, raid: { started_at: friday, expires_at: friday + RAID_WEEKEND, member: { assaults: 3 } } });
		expect(result.entered).toMatchObject({ entered: true, raid: { started_at: friday, expires_at: friday + RAID_WEEKEND, member: { assaults: 3 } } });
		expect(result.entries).toBe(1);
		expect(result.saturday.raid.member.assaults).toBe(6);
		expect(result.sunday.raid.member.assaults).toBe(6);
		expect(result.sunday.raid.member.next_assault_grant_at).toBeNull();
		expect(result.closed).toMatchObject({ raid: null, entered: false, can_activate: false, activation_available_at: friday + RAID_WEEK });
		expect(result.rejected).toEqual({ error_lang: 'MOD_MP_RAID_INACTIVE' });
		expect(result.settled).toMatchObject({ success: true, outcome: 'success', credited_progress: 1000 });
		expect(result.replay).toEqual(result.last);
		expect(result.last_state.raid.member).toMatchObject({ assaults: 0, pending_assault: { tier: 1, loaded_session_id: 'last-session', combat_deadline: result.last.combat_deadline } });
		expect(result.last_state.raid.member.pending_assault.settlement_key).toBeUndefined();
		expect(result.rejoined).toEqual({ error_lang: 'MOD_MP_RAID_ASSAULT_PENDING' });
		expect(result.expired).toEqual({ error_lang: 'MOD_MP_RAID_ASSAULT_PENDING' });
		expect(result.abandoned).toEqual({ success: true, abandoned: true });
		expect(result.exhausted).toEqual({ error_lang: 'MOD_MP_RAID_NO_ASSAULTS' });
		expect(result.grace_state.raid.member.pending_assault.loaded_session_id).toBe('delay-session');
		expect(result.grace_settled).toMatchObject({ success: true, outcome: 'success' });
		expect(result.at_boundary).toEqual({ outcome: null });
		expect(result.cleaned).toEqual({ outcome: 'abandoned' });
		expect(result.next).toMatchObject({ entered: false, raid: { started_at: friday + RAID_WEEK, member: { assaults: 3 } } });
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
