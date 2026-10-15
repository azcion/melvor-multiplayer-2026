import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { cheat_categories_migration } from '../../db/schema/migrations/cheat-categories';
import { observe_category_mods, read_cheat_markings, CHEAT_OBSERVATION_WINDOW as week, legacy_interdict_applies } from '../../cheat-categories';
import { reconcile_cheat_catalog } from '../../cheat-catalog';
import catalog from '../../cheat-mod-catalog.json';

function historical() {
	const db = new Database(':memory:', { strict: true });
	db.run(`PRAGMA foreign_keys=ON;
		CREATE TABLE clients(id INTEGER PRIMARY KEY,cheats_detected_at INTEGER,event_revision INTEGER DEFAULT 0);
		INSERT INTO clients(id,cheats_detected_at) VALUES(1,100),(2,200),(3,NULL);
		CREATE TABLE client_cheat_mod_detections(client_id INTEGER,mod_name TEXT,detected_at INTEGER,mod_id INTEGER);
		CREATE TABLE client_runtime_snapshots(client_id INTEGER,active_mods TEXT,active_mod_details TEXT,reported_at INTEGER);`);
	return db;
}
function fixture() { const db = historical(); db.transaction(() => db.run(cheat_categories_migration.sql))(); reconcile_cheat_catalog(db, catalog, 0); return db; }
function read(db: Database, now: number, legacy: number | null = null) {
	return read_cheat_markings(db, [{ client_id: 1, cheats_detected_at: legacy }], now).get(1)!;
}

test('migration preserves named, snapshot and timestamp-only evidence without inventing history', () => {
	const db = historical();
	db.run(`INSERT INTO client_cheat_mod_detections VALUES(1,'Add Items',100,2429395);
		INSERT INTO client_runtime_snapshots VALUES(1,'["Time Skip","Free Farming","Remove Consumptions"]',
		 '[{"name":"Time Skip","id":2550564},{"name":"Remove Consumptions","id":null}]',200);`);
	db.transaction(() => db.run(cheat_categories_migration.sql))();
	expect(db.query('SELECT mod_catalog_id,last_observed_at FROM client_mod_observations ORDER BY mod_catalog_id').all())
		.toEqual([{ mod_catalog_id: 2429395, last_observed_at: 100 }, { mod_catalog_id: 2550564, last_observed_at: 200 }]);
	expect(read(db, 200, 100).cheat_categories.map(c => c.id)).toEqual(['time', 'items']);
	const fallback = read_cheat_markings(db, [{ client_id: 2, cheats_detected_at: 200 }], 200).get(2)!;
	expect(fallback.cheat_categories).toMatchObject([{ id: 'items', details_unavailable: true, mods: [], detected_at: 200 }]);
	expect(db.query('SELECT * FROM client_cheat_mod_detections').all()).toHaveLength(1);
	expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	expect(() => db.query("INSERT INTO client_mod_observations VALUES(1,2550564,1.5,'x',NULL,'curated_name','runtime')").run()).toThrow();
	db.close();
});

test('independent positive clocks, omission, exact boundaries, future rejection and legacy parity', () => {
	const db = fixture();
	observe_category_mods(db, 1, ['Add Items'], undefined, 100);
	observe_category_mods(db, 1, ['Time Skip'], undefined, 200);
	observe_category_mods(db, 1, [], undefined, 300);
	expect(read(db, week + 100, 100).cheat_categories.map(c => c.id)).toEqual(['time', 'items']);
	expect(read(db, week + 101, 100).cheat_categories.map(c => c.id)).toEqual(['time']);
	expect(read(db, 99).cheat_categories).toEqual([]);
	expect(read(db, week + 201).cheat_categories).toEqual([]);
	expect(legacy_interdict_applies(100, week + 100)).toBe(true);
	expect(legacy_interdict_applies(100, week + 101)).toBe(false);
	expect(legacy_interdict_applies(101, 100)).toBe(false);
	expect(legacy_interdict_applies(-1, 100)).toBe(false);
	observe_category_mods(db, 1, ['Time Skip'], undefined, 150);
	expect(read(db, 300).cheat_categories[0].detected_at).toBe(200);
	db.close();
});

test('multi-category ready mappings and reviewed Item Cheats membership', () => {
	const db = fixture();
	observe_category_mods(db, 1, ['renamed'], [{ name: 'renamed', id: 5377900 }], 100);
	expect(read(db, 100).cheat_categories.map(c => c.id)).toEqual(['items', 'resources', 'shops', 'loot_rng']);
	expect(read(db, 100).cheat_categories.find(c => c.id === 'loot_rng')!.mods[0].explanation).toBe('Offers extra rare, pet and relic rolls.');
	expect(JSON.stringify(read(db, 100))).not.toContain('supplemental axes');
	const item_ids = db.query<{ mod_catalog_id: number }, []>("SELECT mod_catalog_id FROM mod_category_classifications WHERE category_id='items' AND superseded_at IS NULL AND confidence='high' AND publication_state='approved' ORDER BY mod_catalog_id").all().map(r => r.mod_catalog_id);
	expect(item_ids).toEqual([2253095,2429395,2479713,2647058,5377900,5964319,6209430,6379230,6419494]);
	observe_category_mods(db, 2, ['Requirement Filler', 'Remove Consumptions'], undefined, 100);
	expect(read_cheat_markings(db, [{ client_id: 2, cheats_detected_at: null }], 100).get(2)!.cheat_categories.map(c => c.id)).toEqual(['items', 'resources']);
	db.close();
});

test('no fuzzy identities, ambiguous names, explicit local IDs or conflicting IDs; ID wins over title', () => {
	const db = fixture();
	observe_category_mods(db, 1, ['Free Farming', 'SpeedUpACV', 'time skip'], undefined, 100);
	observe_category_mods(db, 1, ['Time Skip'], [{ name: 'Time Skip', id: null }], 100);
	observe_category_mods(db, 1, ['Time Skip'], [{ name: 'Time Skip', id: 2550564 }, { name: 'Time Skip', id: 123 }], 100);
	observe_category_mods(db, 1, ['Time Skip'], [{ name: 'Time Skip', id: 123 }], 100);
	expect(read(db, 100).cheat_categories).toEqual([]);
	observe_category_mods(db, 1, ['Free Farming'], [{ name: 'Free Farming', id: 4791576 }], 100);
	expect(read(db, 100).cheat_categories.map(c => c.id)).toEqual(['resources']);
	expect(read(db, 100).cheat_categories[0].mods[0].id).toBe(4791576);
	db.close();
});

test('approved assignments without public descriptions retain category evidence and observation clocks', () => {
	const db = fixture();
	observe_category_mods(db, 1, ['[Creative Mode] God mode w/ Loot + XP Multipliers'], undefined, 100);
	const updated = structuredClone(catalog);
	const creative = updated.find(m => m.id === 5377900)!;
	creative.classifications.find(c => c.category_id === 'items')!.public_explanation = '';
	creative.classifications.find(c => c.category_id === 'resources')!.public_explanation = '  ';
	reconcile_cheat_catalog(db, updated, 200);
	const marking = read(db, 200, 100);
	expect(marking.cheat_categories.map(c => c.id)).toEqual(['items', 'resources', 'shops', 'loot_rng']);
	const items = marking.cheat_categories.find(c => c.id === 'items')!;
	expect(items.details_unavailable).toBe(false);
	expect(items.mods).toMatchObject([{ id: 5377900, name: creative.canonical_name, explanation: '', detected_at: 100, expires_at: week + 100 }]);
	expect(marking.cheat_categories.find(c => c.id === 'resources')!.mods[0].explanation).toBe('  ');
	expect(marking.cheat_categories.find(c => c.id === 'loot_rng')!.mods[0].explanation).toBe('Offers extra rare, pet and relic rolls.');
	expect(db.query('SELECT last_observed_at FROM client_mod_observations').all()).toEqual([{ last_observed_at: 100 }]);
	expect(read(db, week + 101, 100).cheat_categories).toEqual([]);
	db.close();
});

test('review-only mappings remain unpublished and classification corrections never refresh observations', () => {
	const db = fixture();
	observe_category_mods(db, 1, ['Gashapon', 'Time Skip'], undefined, 100);
	expect(read(db, 100).cheat_categories.map(c => c.id)).toEqual(['time']);
	const superseded = db.query('SELECT id FROM mod_category_classifications WHERE superseded_at IS NOT NULL').all().length;
	const updated = structuredClone(catalog);
	updated.find(m => m.id === 2550564)!.classifications[0].publication_state = 'pending';
	reconcile_cheat_catalog(db, updated, 200);
	expect(read(db, 200).cheat_categories).toEqual([]);
	reconcile_cheat_catalog(db, catalog, 300);
	expect(read(db, 300).cheat_categories[0].detected_at).toBe(100);
	expect(db.query('SELECT last_observed_at FROM client_mod_observations').all()).toEqual([{ last_observed_at: 100 }, { last_observed_at: 100 }]);
	expect(db.query('SELECT id FROM mod_category_classifications WHERE superseded_at IS NOT NULL').all()).toHaveLength(superseded + 2);
	const revision = db.query('SELECT event_revision FROM clients WHERE id=1').get();
	reconcile_cheat_catalog(db, catalog, 400);
	expect(db.query('SELECT event_revision FROM clients WHERE id=1').get()).toEqual(revision);
	expect(read(db, week + 101).cheat_categories).toEqual([]);
	const invalid = structuredClone(catalog); invalid.find(m => m.id === 6209430)!.legacy_interdict_member = 1;
	expect(() => reconcile_cheat_catalog(db, invalid, 500)).toThrow();
	db.close();
});

test('policy changes re-evaluate existing reports without refreshing clocks or deleting historical evidence', () => {
	const db = historical();
	db.run(`INSERT INTO clients(id,cheats_detected_at) VALUES(4,NULL),(5,180),(6,190),(7,200),(8,NULL),(9,200);
		UPDATE clients SET cheats_detected_at=200 WHERE id=1;
		INSERT INTO client_cheat_mod_detections VALUES
		(1,'God Mode',200,5562948),(2,'God Mode',200,5562948),(2,'Add Items',100,2429395),
		(6,'Unknown Legacy Mod',190,NULL),(7,'God Mode',200,5562948),(7,'Unknown Legacy Mod',200,NULL),
		(9,'God Mode',200,5562948),(9,'Unknown Legacy Mod',190,NULL);
		INSERT INTO client_runtime_snapshots VALUES
		(3,'["X  Auto Manger"]','[{"name":"X  Auto Manger","id":2647058}]',150),
		(4,'["Requirement Filler"]','[{"name":"Requirement Filler","id":6209430}]',160),
		(8,'["Requirement Filler"]','[{"name":"Requirement Filler","id":123}]',170);`);
	db.transaction(() => db.run(cheat_categories_migration.sql))();
	const before = db.query('SELECT * FROM client_mod_observations ORDER BY client_id,mod_catalog_id').all();
	const history = db.query('SELECT * FROM client_cheat_mod_detections').all();
	reconcile_cheat_catalog(db, catalog, 300);
	expect(db.query('SELECT id,cheats_detected_at FROM clients ORDER BY id').all()).toEqual([
		{ id:1,cheats_detected_at:null },{ id:2,cheats_detected_at:100 },
		{ id:3,cheats_detected_at:150 },{ id:4,cheats_detected_at:160 },
		{ id:5,cheats_detected_at:180 },{ id:6,cheats_detected_at:190 },
		{ id:7,cheats_detected_at:200 },{ id:8,cheats_detected_at:null },{ id:9,cheats_detected_at:190 }
	]);
	expect(read(db,300).cheat_categories.map(c => c.id)).toEqual(['resources','loot_rng']);
	const mixed = read_cheat_markings(db,[{client_id:2,cheats_detected_at:100}],300).get(2)!;
	expect(mixed.cheat_mods).toEqual(['Add Items']);
	expect(mixed.cheat_categories.find(c => c.id==='items')!.mods[0].detected_at).toBe(100);
	const newlyFlagged = read_cheat_markings(db,[{client_id:3,cheats_detected_at:150}],300).get(3)!;
	expect(newlyFlagged.cheat_mods).toEqual(['X  Auto Manger']);
	expect(newlyFlagged.cheat_categories.map(c => c.id)).toEqual(['items','resources']);
	expect(db.query('SELECT * FROM client_mod_observations ORDER BY client_id,mod_catalog_id').all()).toEqual(before);
	expect(db.query('SELECT * FROM client_cheat_mod_detections').all()).toEqual(history);
	const clients = db.query('SELECT * FROM clients ORDER BY id').all();
	reconcile_cheat_catalog(db,catalog,400);
	expect(db.query('SELECT * FROM clients ORDER BY id').all()).toEqual(clients);
	expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	db.close();
});

test('named legacy evidence uses current optional descriptions and ID precedence', () => {
	const db = fixture();
	db.run(`INSERT INTO client_cheat_mod_detections VALUES
		(1,'[Creative Mode] God mode w/ Loot + XP Multipliers',100,5377900),
		(1,'God Mode',100,5562948),(1,'Add Items',100,5562948);`);
	const items = read(db,100,100).cheat_categories.find(c=>c.id==='items')!;
	expect(items.mods).toHaveLength(1);
	expect(items.mods[0]).toMatchObject({id:5377900,explanation:'',detected_at:100});
	expect(items.details_unavailable).toBe(false);
	expect(read(db,100,100).cheat_mods).toEqual(['[Creative Mode] God mode w/ Loot + XP Multipliers']);
	db.close();
});


test('removing every assignment opts out a mod after its existing report was re-evaluated', () => {
	const db = fixture();
	observe_category_mods(db,3,['Requirement Filler'],undefined,100);
	// Re-evaluate a pre-existing informational observation as the Item assignment is approved.
	const excluded = structuredClone(catalog);
	excluded.find(m=>m.id===6209430)!.classifications = [];
	reconcile_cheat_catalog(db,excluded,200);
	reconcile_cheat_catalog(db,catalog,300);
	expect(db.query('SELECT cheats_detected_at FROM clients WHERE id=3').get()).toEqual({cheats_detected_at:100});
	// No new runtime report or legacy detection row was generated.
	expect(db.query('SELECT * FROM client_cheat_mod_detections').all()).toEqual([]);
	reconcile_cheat_catalog(db,excluded,400);
	expect(db.query('SELECT cheats_detected_at FROM clients WHERE id=3').get()).toEqual({cheats_detected_at:null});
	expect(read_cheat_markings(db,[{client_id:3,cheats_detected_at:null}],400).get(3)!.cheat_categories).toEqual([]);
	expect(db.query('SELECT last_observed_at FROM client_mod_observations WHERE client_id=3').get()).toEqual({last_observed_at:100});
	db.close();
});
