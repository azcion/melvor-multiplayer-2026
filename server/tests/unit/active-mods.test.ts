import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';
import { expect, test } from 'bun:test';
import { resolve_active_mods, matches_active_mod } from '../../active-mods';
import { create_test_database } from '../support/database';

test('IDs survive renamed titles and explicit different IDs do not match by name', () => {
	expect(matches_active_mod({ id: 2429395, name: 'Renamed' }, 2429395, 'Add Items')).toBe(true);
	expect(matches_active_mod({ id: 999, name: 'Add Items' }, 2429395, 'Add Items')).toBe(false);
	expect(matches_active_mod({ id: null, name: 'Add Items' }, 2429395, 'Add Items')).toBe(true);
});

test('backfills verified names and same-character evidence without inventing local IDs', () => {
	expect(resolve_active_mods(['Add Items', 'Unknown'], undefined)).toEqual([
		{ id: 2429395, name: 'Add Items' }, { id: null, name: 'Unknown' }
	]);
	expect(resolve_active_mods(['Local'], [{ name: 'Local', id: -1 }], [{ name: 'Local', id: 42 }]))
		.toEqual([{ name: 'Local', id: null }]);
	expect(resolve_active_mods(['Old'], undefined, [{ name: 'Old', id: 42 }]))
		.toEqual([{ name: 'Old', id: 42 }]);
	expect(resolve_active_mods(['Old'], [{ name: 'Old', id: 42 }, { name: 'Old', id: 43 }]))
		.toEqual([{ name: 'Old', id: null }]);
	expect(resolve_active_mods(['Unknown'], [{ name: 'Unloaded', id: 42 }]))
		.toEqual([{ name: 'Unknown', id: null }]);
});

test('schema adds optional ID metadata and backfills the SAE requirement', () => {
	const db = create_test_database();
	expect(db.query('SELECT required_active_mod_id FROM support_teams WHERE system_key=?').get('super_awesome_expansion'))
		.toEqual({ required_active_mod_id: 5043199 });
	db.close();
});


test('migration preserves names and timestamps while backfilling only verified exact aliases', () => {
	const db = new Database(':memory:');
	db.run(`CREATE TABLE client_runtime_snapshots (active_mods TEXT, reported_at INTEGER);
		CREATE TABLE client_cheat_mod_detections (mod_name TEXT, detected_at INTEGER);
		CREATE TABLE support_teams (required_active_mod_name TEXT);
		INSERT INTO client_runtime_snapshots VALUES ('["Add Items","Unknown"]',123);
		INSERT INTO client_cheat_mod_detections VALUES ('Add Items',456),('Unknown',789);
		INSERT INTO support_teams VALUES ('SUPER AWESOME EXPANSION');`);
	db.transaction(() => db.run(migrations.find(m => m.version === 183)!.sql)).immediate();
	const row = db.query<{ active_mods: string; reported_at: number; active_mod_details: string }, []>('SELECT * FROM client_runtime_snapshots').get()!;
	expect(row.active_mods).toBe('["Add Items","Unknown"]');
	expect(row.reported_at).toBe(123);
	expect(JSON.parse(row.active_mod_details)).toEqual([{ id: 2429395, name: 'Add Items' }, { id: null, name: 'Unknown' }]);
	expect(db.query('SELECT * FROM client_cheat_mod_detections').all()).toEqual([
		{ mod_name: 'Add Items', detected_at: 456, mod_id: 2429395 }, { mod_name: 'Unknown', detected_at: 789, mod_id: null }
	]);
	db.close();
});
