import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations_151_160 } from '../../db/schema/migrations/151-160';

test('moves a single-run score to its Expedition and refuses ambiguous history', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	try {
		database.run('CREATE TABLE clients (id INTEGER PRIMARY KEY)');
		database.run('CREATE TABLE expeditions (id INTEGER PRIMARY KEY)');
		database.run('CREATE TABLE expedition_ep_ledger (client_id INTEGER, expedition_id INTEGER, source_kind TEXT)');
		database.run('CREATE TABLE expedition_supply_scores (client_id INTEGER PRIMARY KEY, value_gp_equiv INTEGER, score_micros INTEGER)');
		database.run('INSERT INTO clients VALUES (1)');
		database.run('INSERT INTO expeditions VALUES (10), (11)');
		database.run('INSERT INTO expedition_supply_scores VALUES (1, 2000, 4771212)');
		database.run("INSERT INTO expedition_ep_ledger VALUES (1, 10, 'supply'), (1, 10, 'supply'), (1, 11, 'supply')");
		const migration = migrations_151_160[0];
		expect(database.query<{ problems: number }, []>(migration.preflight_sql!).get()?.problems).toBe(1);
		expect(database.query('SELECT client_id, value_gp_equiv FROM expedition_supply_scores').all())
			.toEqual([{ client_id: 1, value_gp_equiv: 2000 }]);
		database.run('DELETE FROM expedition_ep_ledger WHERE expedition_id = 11');
		expect(database.query<{ problems: number }, []>(migration.preflight_sql!).get()?.problems).toBe(0);
		database.transaction(() => database.run(migration.sql)).immediate();
		expect(database.query('SELECT client_id, expedition_id, value_gp_equiv, score_micros FROM expedition_supply_scores').all())
			.toEqual([{ client_id: 1, expedition_id: 10, value_gp_equiv: 2000, score_micros: 4771212 }]);
		database.run('INSERT INTO expedition_supply_scores VALUES (1, 11, 1000, 3010299)');
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { database.close(); }
});
