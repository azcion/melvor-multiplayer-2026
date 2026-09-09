import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('shuffle migration preserves existing donations and bounds persistent timestamps', () => {
	const database = new Database(':memory:', { strict: true });
	try {
		for (const migration of migrations.filter(entry => entry.version < 61)) {
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = ON');
		}
		database.run('PRAGMA foreign_keys = ON');
		database.run("INSERT INTO charity_items (guild_id, item_id, qty, expires_at) VALUES (1, 'melvorD:GP', 100, 345601000)");
		database.transaction(() => database.run(migrations.find(m => m.version === 61)!.sql)).immediate();
		expect(database.query('SELECT item_id, qty, expires_at, donated_at FROM charity_items').all()).toEqual([
			{ item_id: 'melvorD:GP', qty: 100, expires_at: 345601000, donated_at: 1000 }
		]);
		database.run("INSERT INTO charity_shuffles VALUES (1, 'account:1', 2000)");
		database.run("INSERT INTO charity_currency_locks VALUES (1, 'account:1', 'melvorD:GP', 14402000)");
	database.transaction(() => database.run(migrations.find(m => m.version === 62)!.sql)).immediate();
		database.run("INSERT INTO charity_shuffle_events (owner_key, shuffled_at) VALUES ('account:1', 3000)");
		expect(() => database.run("UPDATE charity_shuffle_events SET shuffled_at = -1")).toThrow();
		expect(() => database.run("UPDATE charity_shuffles SET shuffled_at = -1")).toThrow();
		expect(() => database.run("UPDATE charity_currency_locks SET locked_until = 9007199254740992")).toThrow();
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		const restored = Database.deserialize(database.serialize());
		expect(restored.query('SELECT shuffled_at FROM charity_shuffles').get()).toEqual({ shuffled_at: 2000 });
		expect(restored.query('SELECT locked_until FROM charity_currency_locks').get()).toEqual({ locked_until: 14402000 });
		expect(restored.query('SELECT owner_key, shuffled_at FROM charity_shuffle_events').get()).toEqual({ owner_key: 'account:1', shuffled_at: 3000 });
		restored.close();
	} finally { database.close(); }
});
