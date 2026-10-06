import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';

function apply(database: Database, after: number, until: number): void {
	for (const migration of migrations.filter(entry => entry.version > after && entry.version <= until)) {
		if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
		try {
			database.transaction(() => {
				database.run(migration.sql);
				expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
				database.run(`PRAGMA user_version = ${migration.version}`);
			}).immediate();
		} finally { database.run('PRAGMA foreign_keys = ON'); }
	}
}

test('Guild scope upgrade preserves Wishes and grants only positive accounts a fresh maximum in active Guilds', () => {
	const database = new Database(':memory:', { strict: true });
	try {
		database.run('PRAGMA foreign_keys = ON');
		apply(database, 0, 161);
		const now = Date.now();
		const window = 48 * 60 * 60_000;
		for (const id of [2, 3, 4, 5])
			database.query("INSERT INTO guilds (id, name, icon_id) VALUES (?, ?, 'melvorD:Plant')").run(id, `Guild ${id}`);
		for (let id = 1; id <= 7; id++)
			database.query('INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES (?, ?, ?, 1)')
				.run(id, `Account ${id}`, `playfab-${id}`);
		function member(id: number, account: number | null, guild: number | null, disabled = 0, deleted: number | null = null) {
			database.query('INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, ' +
				'melvor_account_id, disabled, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
				.run(id, `client-${id}`, `key-${id}`, `friend-${id}`, `Client ${id}`, 'melvorD:Plant', account, disabled, deleted);
			if (guild !== null) database.query('INSERT INTO guild_memberships (client_id, guild_id) VALUES (?, ?)').run(id, guild);
		}
		member(100, 1, 1); member(101, 1, 1); member(102, 1, 2);
		member(103, 1, 3, 1); member(104, 1, 4, 0, now); member(105, 1, null);
		member(200, 2, 1); member(300, 3, 1); member(400, 4, 1); member(500, 5, 1);
		member(600, 6, 1); member(700, 7, 1); member(800, null, 2);
		function points(owner: string, count: number, expired = false) {
			for (let i = 0; i < count; i++) database.query(
				'INSERT INTO crucible_clear_events (owner_key, cleared_at, expires_at) VALUES (?, ?, ?)')
				.run(owner, now - window, expired ? now - 1 : now + 60_000);
		}
		function wish(id: number, account: number, owner: number) {
			database.query('INSERT INTO crucible_wishes (id, guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
				'required_gp, progress_gp, formation_points, created_at, formed_at, melded_at, auto_deliver_at) ' +
				'VALUES (?, 1, ?, ?, ?, 1, 100, 50, 10080, 1, 2, 3, 4)').run(id, owner, account, 'test:Reward');
		}
		wish(42, 1, 100); wish(43, 2, 200); wish(1000, 7, 700);
		database.run('DELETE FROM crucible_wishes WHERE id = 1000');
		points('account:1', 11); // Positive after the active-Wish -10 floor.
		points('account:2', 10); // Effective zero, ineligible.
		points('account:3', 1, true); // Expired, ineligible.
		points('account:4', 1); // Positive without a reset.
		points('account:5', 9); // Negative after a recent reset, ineligible.
		points('account:6', 11); // Positive with a recent reset and no Wish.
		points('client:800', 2); // Preserve the unlinked fallback.
		for (const account of [1, 2, 5, 6]) database.query(
			'INSERT INTO crucible_visibility_resets (owner_key, reset_at) VALUES (?, ?)').run(`account:${account}`, now);
		database.query('INSERT INTO guild_petitions (id, guild_id, guild_name, type, conflict_subject, petitioner_id, ' +
			"created_at, expires_at) VALUES (1, 1, 'Free Fellowship', 'crucible_purging', 'crucible', 100, 1, 2)").run();
		database.run('INSERT INTO guild_petition_crucible_wishes (petition_id, wish_id) VALUES (1, 42)');
		const wishes = database.query('SELECT * FROM crucible_wishes ORDER BY id').all();
		apply(database, 161, 162);
		expect(database.query('PRAGMA user_version').get()).toEqual({ user_version: 162 });
		expect(database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
		expect(database.query('SELECT * FROM crucible_wishes ORDER BY id').all()).toEqual(wishes);
		expect(database.query('SELECT * FROM guild_petition_crucible_wishes').all()).toEqual([{ petition_id: 1, wish_id: 42 }]);
		expect(database.query('SELECT guild_id, owner_key, COUNT(*) AS count FROM crucible_clear_events ' +
			'GROUP BY guild_id, owner_key ORDER BY guild_id, owner_key').all()).toEqual([
			{ guild_id: 1, owner_key: 'account:1', count: 20 },
			{ guild_id: 1, owner_key: 'account:4', count: 20 },
			{ guild_id: 1, owner_key: 'account:6', count: 30 },
			{ guild_id: 2, owner_key: 'account:1', count: 30 },
			{ guild_id: 2, owner_key: 'client:800', count: 2 },
		]);
		const clock = database.query<{ earliest: number; latest: number }, []>(
			"SELECT MIN(cleared_at) AS earliest, MAX(cleared_at) AS latest FROM crucible_clear_events WHERE owner_key LIKE 'account:%'").get()!;
		expect(clock.earliest).toBeGreaterThanOrEqual(now - 1);
		expect(clock.latest).toBe(clock.earliest);
		expect(database.query('SELECT COUNT(*) AS count FROM crucible_clear_events WHERE owner_key LIKE ? AND expires_at != ?')
			.get('account:%', clock.latest + window)).toEqual({ count: 0 });
		expect(database.query('SELECT COUNT(*) AS count FROM crucible_clear_events WHERE expires_at > ?')
			.get(clock.latest + window)).toEqual({ count: 0 });
		expect(() => wish(44, 1, 101)).toThrow(); // Same-Guild sibling is still constrained.
		const next = database.query<{ id: number }, []>('INSERT INTO crucible_wishes ' +
			'(guild_id, owner_client_id, melvor_account_id, item_id, qty, required_gp, created_at) ' +
			"VALUES (2, 102, 1, 'test:Second', 1, 100, 1) RETURNING id").get()!;
		expect(next.id).toBeGreaterThan(1000);
		database.run('DELETE FROM guilds WHERE id = 2');
		expect(database.query('SELECT COUNT(*) AS count FROM crucible_clear_events WHERE guild_id = 2').get()).toEqual({ count: 0 });
		expect(database.query('SELECT COUNT(*) AS count FROM crucible_visibility_resets WHERE guild_id = 2').get()).toEqual({ count: 0 });
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { database.close(); }
});
