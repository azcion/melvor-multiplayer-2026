import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema/migrations';
import { expedition_capture_time } from '../../expedition-clock';

test('starts at server receipt time regardless of client clock offset', () => {
	for (const reported of [0, 100, 9007199254740991])
		expect(expedition_capture_time(reported, 1000, null)).toBe(1000);
});

test('fixed offsets cancel out in elapsed time', () => {
	for (const offset of [-5000, 0, 5000, 86_400_000])
		expect(expedition_capture_time(2000 + offset, 2100,
			{ started_at: 1000, start_clock_offset_ms: offset })).toBe(2000);
});

test('forward jumps cannot exceed real elapsed time', () => {
	expect(expedition_capture_time(100_000, 2000,
		{ started_at: 1000, start_clock_offset_ms: 0 })).toBe(2000);
});

test('slower clocks and delayed snapshots use the smaller reported duration', () => {
	expect(expedition_capture_time(1500, 20_000,
		{ started_at: 1000, start_clock_offset_ms: 0 })).toBe(1500);
});

test('backward jumps settle at zero rather than failing tracking', () => {
	expect(expedition_capture_time(500, 2000,
		{ started_at: 1000, start_clock_offset_ms: 0 })).toBe(1000);
});

test('legacy segments retain their server-aligned baseline', () => {
	expect(expedition_capture_time(1500, 2000,
		{ started_at: 1000, start_clock_offset_ms: null })).toBe(1500);
});


test('clock migration preserves legacy session and claim boundaries', () => {
	const database = new Database(':memory:', { strict: true });
	try {
		for (const migration of migrations.filter(entry => entry.version < 152))
			database.run(migration.sql);
		database.run(`INSERT INTO expedition_work_sessions
			(id, expedition_id, visit_id, client_id, tenure_id, task_id, started_at,
			start_statistics, start_activities, pending_boundary_at, pending_capture_at)
			VALUES (1, 1, 1, 1, 1, 'work', 100, '{}', '[]', 200, 190)`);
		database.run(`INSERT INTO expedition_work_claims
			(session_id, client_id, expedition_id, visit_id, task_id, started_at, cutoff_at,
			start_statistics, start_activities, evidence_skill_ids, max_observation_gap_ms,
			pending_boundary_at, pending_capture_at)
			VALUES (2, 1, 1, 1, 'work', 100, 200, '{}', '[]', '[]', 0, 200, 190)`);
		database.run(migrations.find(entry => entry.version === 152)!.sql);
		for (const table of ['expedition_work_sessions', 'expedition_work_claims'])
			expect(database.query(`SELECT started_at, pending_boundary_at, pending_capture_at,
				start_clock_offset_ms, pending_reported_capture_at FROM ${table}`).all())
				.toEqual([{ started_at: 100, pending_boundary_at: 200, pending_capture_at: 190,
					start_clock_offset_ms: null, pending_reported_capture_at: null }]);
	} finally {
		database.close();
	}
});
