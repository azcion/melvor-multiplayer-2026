import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';
import { charitree_retirement_migration as retirement } from '../../db/schema/migrations/charitree-retirement';

function old_database(): Database {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations.filter(entry => entry.version < retirement.version)) {
		if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
		try { database.transaction(() => database.run(migration.sql)).immediate(); }
		finally { database.run('PRAGMA foreign_keys = ON'); }
	}
	return database;
}

function apply_retirement(database: Database): void {
	database.run('PRAGMA foreign_keys = OFF');
	try {
		database.transaction(() => {
			const result = database.query<{ problems: number }, []>(retirement.preflight_sql!).get();
			if (result?.problems !== 0) throw new Error('Unmigrated Charitree value');
			database.run(retirement.sql);
			expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		}).immediate();
	} finally { database.run('PRAGMA foreign_keys = ON'); }
}

test('retires feature storage while preserving Crucible, pets, audit lineage and Council children', () => {
	const database = old_database();
	try {
		database.run(`
			INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id)
			VALUES (1, 'retirement-client', 'retirement-key', '123-456-789', 'Retirement', 'melvorD:Plant');
			INSERT INTO guilds (id, name, icon_id) VALUES (2, 'Retirement Guild', 'melvorD:Plant');
			INSERT INTO guild_memberships (id, client_id, guild_id, charitree_take_available_at) VALUES (1, 1, 2, 123);
			INSERT INTO multiplayer_pet_ownership VALUES (1, 'Multiplayer_Pet_Charity', 1, 1);
			INSERT INTO multiplayer_pet_ownership VALUES (1, 'Multiplayer_Pet_Crucible', 1, 1);
			INSERT INTO crucible_offerings (id, guild_id, item_id, qty, created_at, refreshed_at, is_untimed, valuation_source)
			VALUES (1, 2, 'melvorD:Coal_Ore', 7, 1, 1, 0, 'client');
			INSERT INTO charity_items (guild_id, item_id, qty, expires_at) VALUES (2, 'melvorD:Coal_Ore', 7, 100);
			INSERT INTO service_settings VALUES ('crucible_cutover', '1');
			INSERT INTO guild_petitions (id, guild_id, guild_name, type, conflict_subject, petitioner_id,
				proposed_name, created_at, expires_at) VALUES (1, 2, 'Retirement Guild', 'appellation', 'guild:name', 1, 'New Guild', 1, 100);
			INSERT INTO guild_petition_voters (petition_id, client_id) VALUES (1, 1);
			INSERT INTO guild_petition_votes (petition_id, client_id, choice, submitted_at) VALUES (1, 1, 'aye', 2);
			INSERT INTO audit_events (id, occurred_at, event_type, actor_kind, source_key) VALUES (1, 1, 'charitree.donated', 'system', 'retirement-audit');
			INSERT INTO audit_value_lots (id, created_by_event_id, object_id, original_quantity) VALUES (1, 1, 'melvorD:Coal_Ore', 7);
			INSERT INTO audit_value_lot_positions VALUES (1, 'charitree', '2', 7);
		`);
		apply_retirement(database);
		expect(database.query('SELECT qty FROM crucible_offerings WHERE id=1').get()).toEqual({ qty: 7 });
		expect(database.query('SELECT pet_id FROM multiplayer_pet_ownership ORDER BY pet_id').all()).toEqual([
			{ pet_id: 'Multiplayer_Pet_Charity' }, { pet_id: 'Multiplayer_Pet_Crucible' }
		]);
		expect(database.query('SELECT crucible_reclaim_available_at FROM guild_memberships WHERE id=1').get())
			.toEqual({ crucible_reclaim_available_at: 123 });
		expect(database.query('SELECT choice FROM guild_petition_votes WHERE petition_id=1').get()).toEqual({ choice: 'aye' });
		expect(database.query('SELECT quantity FROM audit_value_lot_positions WHERE lot_id=1').get()).toEqual({ quantity: 7 });
		expect(database.query("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'charity_%' OR name='crucible_migration')").all()).toEqual([]);
		expect(database.query('PRAGMA table_info(guild_petitions)').all().some((row: any) => row.name === 'charitree_expires_before')).toBe(false);
		expect(() => database.run("UPDATE guild_petitions SET type='charitree_sacrilege' WHERE id=1")).toThrow();
	} finally { database.close(); }
});

test('rejects an unmigrated database containing value and restores foreign-key enforcement', () => {
	const database = old_database();
	try {
		database.run("INSERT INTO charity_items (guild_id, item_id, qty, expires_at) VALUES (1, 'melvorD:Coal_Ore', 2, 100)");
		expect(() => apply_retirement(database)).toThrow('Unmigrated Charitree value');
		expect(database.query('SELECT qty FROM charity_items').get()).toEqual({ qty: 2 });
		expect(database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
	} finally { database.close(); }
});
