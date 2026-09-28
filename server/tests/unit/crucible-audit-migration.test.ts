import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';

test('Crucible audit vocabulary upgrade preserves existing value lineage', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	try {
		for (const migration of migrations.filter(entry => entry.version < 143)) {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
			try { database.transaction(() => database.run(migration.sql)).immediate(); }
			finally { if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = ON'); }
		}
		database.run("INSERT INTO audit_events (id, occurred_at, event_type, actor_kind, source_key) " +
			"VALUES (1, 1, 'charitree.donated', 'system', 'crucible-audit-fixture')");
		database.run("INSERT INTO audit_value_lots (id, created_by_event_id, object_id, original_quantity) " +
			"VALUES (1, 1, 'melvorD:Coal_Ore', 2)");
		database.run("INSERT INTO audit_value_lot_positions (lot_id, position_kind, position_key, quantity) " +
			"VALUES (1, 'charitree', '1', 2)");
		database.run("INSERT INTO audit_value_movements " +
			"(event_id, ordinal, lot_id, to_kind, to_key, object_id, quantity) " +
			"VALUES (1, 0, 1, 'charitree', '1', 'melvorD:Coal_Ore', 2)");
		const migration = migrations.find(entry => entry.version === 143)!;
		expect(migration.foreign_keys_disabled).toBe(true);
		database.run('PRAGMA foreign_keys = OFF');
		try {
			database.transaction(() => {
				database.run(migration.sql);
				expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
			}).immediate();
		} finally { database.run('PRAGMA foreign_keys = ON'); }
		expect(database.query('SELECT position_kind, quantity FROM audit_value_lot_positions').get())
			.toEqual({ position_kind: 'charitree', quantity: 2 });
		expect(database.query('SELECT to_kind, quantity FROM audit_value_movements').get())
			.toEqual({ to_kind: 'charitree', quantity: 2 });
		database.run("INSERT INTO audit_value_lot_positions (lot_id, position_kind, position_key, quantity) " +
			"VALUES (1, 'crucible', '1', 1)");
		database.run("INSERT INTO audit_value_movements " +
			"(event_id, ordinal, lot_id, from_kind, from_key, to_kind, to_key, object_id, quantity) " +
			"VALUES (1, 1, 1, 'charitree', '1', 'crucible', '1', 'melvorD:Coal_Ore', 1)");
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { database.close(); }
});
