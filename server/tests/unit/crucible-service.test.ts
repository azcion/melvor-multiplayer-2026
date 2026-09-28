import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from '../../db/schema';
import { crucible_contents, reconcile_crucible } from '../../crucible-service';
import { settle_departing_crucible_wish } from '../../crucible-council';

function database_at_minute(minute: number): Database {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations) {
		if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = OFF');
		try { database.transaction(() => database.run(migration.sql)).immediate(); }
		finally { if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys = ON'); }
	}
	database.query('INSERT INTO crucible_guilds (guild_id, processed_minute, created_at) VALUES (1, ?, ?)')
		.run(minute, minute * 60_000);
	return database;
}

test('Wish formation resolves before Offering Meld on the same tick and never ticks twice', () => {
	const minute = 1_000;
	const database = database_at_minute(minute);
	database.run("INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES (1, 'Cloud', 'playfab', 1)");
	database.run("INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id) " +
		"VALUES (100, 'crucible-service-client', 'key', '111-222-333', 'Client', 'melvorD:Plant', 1)");
	database.query('INSERT INTO crucible_offerings (guild_id, item_id, qty, value_currency_id, ' +
		'value_per_item, meld_points, created_at, refreshed_at) VALUES (1, ?, 1, ?, 100, 10079, 1, 1)')
		.run('test:Ore', 'melvorD:GP');
	database.query('INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
		'required_gp, formation_points, created_at) VALUES (1, 100, 1, ?, 1, 100, 10079, 1)')
		.run('test:Reward');
	const now = (minute + 1) * 60_000;
	reconcile_crucible(1, now, database);
	const contents = crucible_contents(1, now, database)!;
	expect(contents.heat).toEqual({ value: 0, tier: 0, points_per_minute: 0 });
	expect(contents.offerings).toEqual([]);
	expect(contents.wishes[0]).toMatchObject({ phase: 'melded', progress_gp: 100,
		formation_points: 10080, auto_deliver_at: now + 20 * 60 * 60_000 });
	reconcile_crucible(1, now, database);
	expect(crucible_contents(1, now, database)?.wishes[0]?.progress_gp).toBe(100);
	reconcile_crucible(1, now + 20 * 60 * 60_000, database);
	expect(database.query('SELECT item_id, qty FROM inbox_items WHERE client_id = 100').all())
		.toEqual([{ item_id: 'test:Reward', qty: 1 }]);
	expect(database.query("SELECT event_type FROM audit_events WHERE event_type LIKE 'crucible.%' ORDER BY id").all())
		.toEqual([{ event_type: 'crucible.offering_melded' }, { event_type: 'crucible.wish_delivered' }]);
	expect(database.query("SELECT position_kind, position_key, quantity FROM audit_value_lot_positions " +
		"WHERE position_kind = 'inbox'").all()).toEqual([
		{ position_kind: 'inbox', position_key: '100:crucible:Wish Granted', quantity: 1 }
	]);
	reconcile_crucible(1, now + 20 * 60 * 60_000, database);
	expect(database.query('SELECT item_id, qty FROM inbox_items WHERE client_id = 100').all())
		.toEqual([{ item_id: 'test:Reward', qty: 1 }]);
	database.close();
});

test('departure reconciles a newly formed and funded Wish before settling it', () => {
	const minute = 1_000;
	const database = database_at_minute(minute);
	database.run("INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES (1, 'Cloud', 'playfab', 1)");
	database.run("INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id) " +
		"VALUES (100, 'crucible-departure-client', 'key', '111-222-333', 'Client', 'melvorD:Plant', 1)");
	database.query('INSERT INTO crucible_offerings (guild_id, item_id, qty, value_currency_id, ' +
		'value_per_item, meld_points, created_at, refreshed_at) VALUES (1, ?, 1, ?, 100, 10079, 1, 1)')
		.run('test:Departure_Ore', 'melvorD:GP');
	database.query('INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
		'required_gp, formation_points, created_at) VALUES (1, 100, 1, ?, 1, 100, 10079, 1)')
		.run('test:Departure_Reward');
	database.run("INSERT INTO crucible_migration (id, started_at, completed_at, source_json, destination_json) " +
		"VALUES (1, 1, 1, '{}', '{}')");
	const now = (minute + 1) * 60_000;
	settle_departing_crucible_wish(100, 1, now, database);
	expect(database.query('SELECT item_id, qty FROM inbox_items WHERE client_id = 100').all())
		.toEqual([{ item_id: 'test:Departure_Reward', qty: 1 }]);
	expect(database.query('SELECT * FROM crucible_wishes').all()).toEqual([]);
	expect(database.query("SELECT event_type FROM audit_events WHERE event_type LIKE 'crucible.%' ORDER BY id").all())
		.toEqual([{ event_type: 'crucible.offering_melded' },
			{ event_type: 'crucible.wish_departure_delivered' }]);
	database.close();
});

test('departure cancellation records the Gloop created from residual Wish value', () => {
	const minute = 1_000;
	const database = database_at_minute(minute);
	database.run("INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES (1, 'Cloud', 'playfab', 1)");
	database.run("INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id) " +
		"VALUES (100, 'crucible-departure-gloop', 'key', '111-222-333', 'Client', 'melvorD:Plant', 1)");
	database.run("INSERT INTO crucible_migration (id, started_at, completed_at, source_json, destination_json) " +
		"VALUES (1, 1, 1, '{}', '{}')");
	database.query('INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
		'required_gp, progress_gp, created_at) VALUES (1, 100, 1, ?, 1, 2000, 1500, 1)')
		.run('test:Departure_Reward');
	settle_departing_crucible_wish(100, 1, minute * 60_000, database);
	expect(database.query("SELECT qty FROM crucible_offerings WHERE item_id = 'melvorD:Weird_Gloop'").get())
		.toEqual({ qty: 2 });
	expect(database.query("SELECT position_kind, position_key, quantity FROM audit_value_lot_positions " +
		"WHERE lot_id IN (SELECT id FROM audit_value_lots WHERE object_id = 'melvorD:Weird_Gloop')").all())
		.toEqual([{ position_kind: 'crucible', position_key: '1', quantity: 2 }]);
	database.close();
});

test('downtime catch-up cools after Meld and rounds each residual stack into Gloop', () => {
	const minute = 1_000;
	const database = database_at_minute(minute);
	for (const [item_id, value, points] of [['test:Rich', 10_000_000_000, 10079], ['test:Poor', 0, 0]] as const)
		database.query('INSERT INTO crucible_offerings (guild_id, item_id, qty, value_currency_id, ' +
			'value_per_item, meld_points, created_at, refreshed_at) VALUES (1, ?, 1, ?, ?, ?, 1, 1)')
			.run(item_id, 'melvorD:GP', value, points);
	reconcile_crucible(1, (minute + 2) * 60_000, database);
	const contents = crucible_contents(1, (minute + 2) * 60_000, database)!;
	expect(contents.offerings.find(row => row.item_id === 'test:Poor')?.meld_points).toBe(29);
	expect(contents.offerings.find(row => row.item_id === 'melvorD:Weird_Gloop')?.qty).toBe(10_000_000);
	expect(contents.heat).toEqual({ value: 101, tier: 1, points_per_minute: 1 });
	database.close();
});

test('one-point Meld cannot grant more than one point across ready Wishes', () => {
	const minute = 1_000;
	const database = database_at_minute(minute);
	for (const id of [1, 2]) {
		database.query('INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES (?, ?, ?, 1)')
			.run(id, `Cloud ${id}`, `playfab-${id}`);
		database.query('INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, `crucible-split-${id}`, `key-${id}`,
			`111-222-33${id}`, `Client ${id}`, 'melvorD:Plant', id);
		database.query('INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
			'required_gp, formation_points, created_at) VALUES (1, ?, ?, ?, 1, 100, 10080, 1)')
			.run(id, id, `test:Reward_${id}`);
	}
	database.query('INSERT INTO crucible_offerings (guild_id, item_id, qty, value_currency_id, ' +
		'value_per_item, meld_points, created_at, refreshed_at) VALUES (1, ?, 1, ?, 1, 10079, 1, 1)')
		.run('test:One_Point', 'melvorD:GP');
	reconcile_crucible(1, (minute + 1) * 60_000, database);
	expect(database.query('SELECT progress_gp FROM crucible_wishes ORDER BY id').all())
		.toEqual([{ progress_gp: 1 }, { progress_gp: 0 }]);
	expect(crucible_contents(1, (minute + 1) * 60_000, database)?.offerings).toEqual([]);
	database.close();
});

test('contents expose the top three stack contributors and the Wish maker', () => {
	const database = database_at_minute(1_000);
	for (const id of [1, 2, 3, 4]) {
		database.query('INSERT INTO melvor_accounts (id, cloud_username, playfab_id, created_at) VALUES (?, ?, ?, 1)')
			.run(id, `Cloud ${id}`, `playfab-${id}`);
		database.query('INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id) ' +
			'VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, `crucible-icon-${id}`, `key-${id}`,
			`111-222-34${id}`, `Maker ${id}`, `test:Icon_${id}`, id);
	}
	const offering = database.query<{ id: number }, []>('INSERT INTO crucible_offerings ' +
		'(guild_id, item_id, qty, value_currency_id, value_per_item, created_at, refreshed_at) ' +
		"VALUES (1, 'test:Ore', 10, 'melvorD:GP', 1, 1, 1) RETURNING id").get()!;
	for (const [client_id, qty] of [[1, 1], [2, 4], [3, 3], [4, 2]])
		database.query('INSERT INTO crucible_contribution_lots ' +
			'(offering_id, client_id, qty, contributed_at, source_kind, source_id) ' +
			"VALUES (?, ?, ?, 1, 'cast', ?)").run(offering.id, client_id, qty, `cast:${client_id}`);
	database.query('INSERT INTO crucible_wishes (guild_id, owner_client_id, melvor_account_id, item_id, qty, ' +
		'required_gp, created_at) VALUES (1, 4, 4, ?, 1, 100, 1)').run('test:Reward');
	const contents = crucible_contents(1, 60_000_000, database)!;
	expect(contents.offerings[0]?.contributors).toEqual([
		{ client_id: 2, icon_id: 'test:Icon_2' },
		{ client_id: 3, icon_id: 'test:Icon_3' },
		{ client_id: 4, icon_id: 'test:Icon_4' }
	]);
	expect(contents.wishes[0]).toMatchObject({ wisher: 'Maker 4',
		contributors: [{ client_id: 4, icon_id: 'test:Icon_4' }] });
	database.close();
});
