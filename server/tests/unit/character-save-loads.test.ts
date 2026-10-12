import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse_loaded_save, record_character_save_load, type LoadedSaveReport } from '../../character-save-loads';
import { create_test_database } from '../support/database';

const report: LoadedSaveReport = { load_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
	save_timestamp: 100, client_loaded_at: 200, capture_source: 'decode' };

test('load history and session association survive reopening the database', () => {
	const directory = mkdtempSync(join(tmpdir(), 'save-load-test-'));
	const filename = join(directory, 'tracking.sqlite');
	let database = create_test_database(filename);
	try {
		database.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'save-durable','key','111-222-101','Save Tracking','melvorD:Plant')");
		const save_load_id = record_character_save_load(database, 101, report, 300);
		database.query('INSERT INTO client_sessions(session_token,client_id,save_load_id) VALUES(?,101,?)').run('session', save_load_id);
		database.close();
		database = new Database(filename, { strict: true });
		expect(database.query('SELECT load_id, save_timestamp FROM character_save_loads AS l JOIN client_sessions AS s ON s.save_load_id=l.id').all())
			.toEqual([{ load_id: report.load_id, save_timestamp: 100 }]);
	} finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('validates optional, unknown, and safe timestamp reports', () => {
	expect(parse_loaded_save(undefined)).toBeUndefined();
	expect(parse_loaded_save(report)).toEqual(report);
	expect(parse_loaded_save({ ...report, save_timestamp: null, capture_source: 'character_loaded' })).not.toBeNull();
	for (const invalid of [null, [], {}, { ...report, load_id: 'bad' },
		{ ...report, capture_source: 'unknown' }, { ...report, client_loaded_at: -1 },
		{ ...report, client_loaded_at: Number.MAX_SAFE_INTEGER + 1 },
		...[0, -1, 1.5, Infinity, '100', Number.MAX_SAFE_INTEGER + 1].map(save_timestamp => ({ ...report, save_timestamp }))])
		expect(parse_loaded_save(invalid)).toBeNull();
});

test('retains immutable first observation across reconnects, rollback loads, and identities', () => {
	const db = create_test_database();
	try {
		for (const id of [101, 102]) db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)')
			.run(id, `save-${id}`, 'key', `111-222-${id}`, 'Save Tracking', 'melvorD:Plant');
		expect(record_character_save_load(db, 101, undefined, 300)).toBeNull();
		const first = record_character_save_load(db, 101, report, 300);
		expect(record_character_save_load(db, 101, { ...report, save_timestamp: 999 }, 400)).toBe(first);
		expect(record_character_save_load(db, 101, report, 250)).toBe(first);
		expect(db.query('SELECT save_timestamp, first_reported_at, last_reported_at FROM character_save_loads WHERE id=?').get(first))
			.toEqual({ save_timestamp: 100, first_reported_at: 300, last_reported_at: 400 });
		expect(record_character_save_load(db, 102, report, 300)).not.toBe(first);
		expect(record_character_save_load(db, 101, { ...report, load_id: crypto.randomUUID(), save_timestamp: 50 }, 500)).not.toBe(first);
		db.query('INSERT INTO client_sessions(session_token,client_id,save_load_id) VALUES(?,101,?)').run('session', first);
		db.run('DELETE FROM clients WHERE id=101');
		expect(db.query('SELECT client_id FROM character_save_loads').all()).toEqual([{ client_id: 102 }]);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});
