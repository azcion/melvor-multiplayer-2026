import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import type { JsonObject } from '../../http';
import { compact_work_reply, compact_work_reply_batch, restore_work_reply } from '../../expedition-work-replies';
import { expedition_work_catalogs_migration } from '../../db/schema/migrations/expedition-work-catalogs';

function fixture() {
	const db = new Database(':memory:', { strict: true });
	db.run('PRAGMA foreign_keys=ON; CREATE TABLE expedition_work_operations(response TEXT NOT NULL)');
	db.run(expedition_work_catalogs_migration.sql);
	return db;
}

test('catalog deduplication preserves exact historical replies, including clients without a catalog revision', () => {
	const db = fixture();
	try {
		const first = { success: true, clock: { effective_capture_at: 123 }, settlement: { points_micros: 456 },
			points_micros: 789, tracking: null, equipment_projects: { catalog: [{ name: 'Old sword', stages: [1] }],
				access: { slot: ['old'] }, unlocked: ['old'], project: null } };
		const second = { ...first, points_micros: 1000, equipment_projects: { ...first.equipment_projects, unlocked: ['new'] } };
		const a = compact_work_reply(db, JSON.stringify(first));
		const b = compact_work_reply(db, JSON.stringify(second));
		expect(a.catalog_hash).toBe(b.catalog_hash);
		expect(db.query('SELECT COUNT(*) AS count FROM expedition_work_catalogs').get()).toEqual({ count: 1 });
		expect(JSON.parse(a.response).equipment_projects.catalog).toBeUndefined();
		const changed = { ...first, equipment_projects: { ...first.equipment_projects, catalog: [{ name: 'New sword', stages: [2] }] } };
		const c = compact_work_reply(db, JSON.stringify(changed));
		expect(c.catalog_hash).not.toBe(a.catalog_hash);
		expect(restore_work_reply(db, a.response, a.catalog_hash)).toEqual(first);
		expect(restore_work_reply(db, b.response, b.catalog_hash)).toEqual(second);
		expect(restore_work_reply(db, c.response, c.catalog_hash)).toEqual(changed);
		expect(restore_work_reply(db, JSON.stringify(first), null)).toEqual(first);
		const missing = JSON.stringify({ success: true, equipment_projects: { catalog: [] } });
		expect(compact_work_reply(db, missing)).toEqual({ response: missing, catalog_hash: null });
		expect(() => restore_work_reply(db, a.response, 'missing')).toThrow('Missing saved');
	} finally { db.close(); }
});

test('bounded backfill resumes without changing historical results or processing rows twice', () => {
	const db = fixture();
	try {
		const responses: JsonObject[] = [
			{ success: true, points_micros: 12, equipment_projects: { catalog: ['old'], access: { old: true }, slots: ['bronze'] } },
			{ success: false, error: 'old-result' },
			{ success: true, points_micros: 99, equipment_projects: { catalog: ['old'], access: { old: true }, slots: ['iron'], catalog_revision: 'historical' } }
		];
		for (const response of responses) db.query('INSERT INTO expedition_work_operations(response) VALUES (?)').run(JSON.stringify(response));
		const first = compact_work_reply_batch(db, 0, 1);
		expect(first.compacted).toBe(1);
		// Restart from the beginning, as the host command does after interruption.
		const second = compact_work_reply_batch(db, 0, 2);
		expect(second.scanned).toBe(2);
		expect(second.compacted).toBe(1);
		const rows = db.query<{ response: string; catalog_hash: string | null }, []>(
			'SELECT response, catalog_hash FROM expedition_work_operations ORDER BY rowid').all();
		expect(rows.map(row => restore_work_reply(db, row.response, row.catalog_hash))).toEqual(responses);
		expect(compact_work_reply_batch(db, 0).compacted).toBe(0);
		expect(db.query('SELECT COUNT(*) AS count FROM expedition_work_catalogs').get()).toEqual({ count: 1 });
		expect(() => db.run('DELETE FROM expedition_work_catalogs')).toThrow();
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});
