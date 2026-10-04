import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema/migrations';

test('backfills open allowances from start-time progress without changing settled rewards or legacy claims', () => {
	const database = new Database(':memory:', { strict: true });
	const hour = 3_600_000;
	try {
		for (const migration of migrations.filter(entry => entry.version < 153)) database.run(migration.sql);
		database.run(`INSERT INTO expedition_tasks (visit_id, task_id, target_ms, player_ms, system_ms, unlocked_at, completed_at)
			VALUES (1, 'work', ?, ?, ?, 0, ?)`, [10 * hour, 98 * hour / 10, 2 * hour / 10, 28 * hour]);
		const insert = database.query(`INSERT INTO expedition_work_sessions
			(id, expedition_id, visit_id, client_id, tenure_id, task_id, started_at, ended_at,
			start_statistics, start_activities, credited_ms, guild_ms)
			VALUES (?, 1, 1, ?, 1, 'work', ?, ?, '{}', '[]', ?, ?)`);
		insert.run(1, 1, hour, 2 * hour, hour, hour);
		insert.run(2, 2, 25.5 * hour, null, null, null);
		insert.run(3, 1, 2 * hour, 28 * hour, 88 * hour / 10, 88 * hour / 10);
		database.run(`INSERT INTO expedition_work_claims
			(session_id, client_id, expedition_id, visit_id, task_id, started_at, cutoff_at,
			start_statistics, start_activities, evidence_skill_ids, max_observation_gap_ms)
			VALUES (4, 3, 2, 2, 'gone', 100, 200, '{}', '[]', '[]', 0)`);
		database.run(migrations.find(entry => entry.version === 153)!.sql);
		expect(database.query('SELECT reward_remaining_ms FROM expedition_work_sessions WHERE id = 2').get())
			.toEqual({ reward_remaining_ms: 89 * hour / 10 });
		expect(database.query('SELECT credited_ms, guild_ms, reward_remaining_ms FROM expedition_work_sessions WHERE id = 1').get())
			.toEqual({ credited_ms: hour, guild_ms: hour, reward_remaining_ms: null });
		expect(database.query('SELECT reward_remaining_ms FROM expedition_work_claims WHERE session_id = 4').get())
			.toEqual({ reward_remaining_ms: null });
	} finally { database.close(); }
});
