import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { crucible_contents, reconcile_crucible } from '../../crucible-service';
import type * as db_row from '../../db/types/db_types';
import { create_custody_source } from '../../economy-custody';
import { apply_crucible_petition, snapshot_crucible_petition, settle_departing_crucible_wish } from '../../crucible-council';

function database_at_minute(minute: number): Database {
	const database = create_test_database();

	database.query('UPDATE crucible_guilds SET processed_minute=?, created_at=? WHERE guild_id=1')
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
	database.query('UPDATE clients SET cheats_detected_at=? WHERE id IN (2,4)').run(60_000_000);
	const filtered = crucible_contents(1, 60_000_000, database, ['items'])!;
	expect(filtered.offerings[0]).toMatchObject({ qty: 4, contributors: [
		{ client_id: 3, icon_id: 'test:Icon_3' }, { client_id: 1, icon_id: 'test:Icon_1' }] });
	expect(filtered.wishes).toEqual(contents.wishes);
	expect(filtered.heat).toEqual(contents.heat);
	database.query('UPDATE clients SET cheats_detected_at=?').run(60_000_000);
	expect(crucible_contents(1, 60_000_000, database, ['items'])!.offerings).toEqual([]);

	database.close();
});

for (const type of ['crucible_sealing', 'crucible_purging', 'crucible_unsealing'] as const)
	test(`${type} rolls back on audit failure and retries with one complete audit`, () => {
		const minute = 1_000;
		const database = database_at_minute(minute);
		try {
			database.run("INSERT INTO clients (id, client_identifier, client_key, friend_code, display_name, icon_id) " +
				"VALUES (100, 'petition-rollback', 'key', '111-222-333', 'Client', 'melvorD:Plant')");
			database.query('UPDATE crucible_guilds SET is_open = ? WHERE guild_id = 1')
				.run(type === 'crucible_unsealing' ? 0 : 1);
			database.run("INSERT INTO crucible_offerings (guild_id, item_id, qty, created_at, refreshed_at, is_untimed) " +
				"VALUES (1, 'melvorD:Weird_Gloop', 3, 1, 1, 1)");
			const petition_id = Number(database.query('INSERT INTO guild_petitions ' +
				'(guild_id, guild_name, type, conflict_subject, petitioner_id, created_at, expires_at) ' +
				"VALUES (1, 'Fellowship', ?, 'guild:crucible', 100, 1, 86400001)")
				.run(type).lastInsertRowid);
			snapshot_crucible_petition(petition_id, 1, type, database);
			const petition = database.query<db_row.guild_petitions, [number]>(
				'SELECT * FROM guild_petitions WHERE id = ?').get(petition_id)!;
			database.run("CREATE TRIGGER fail_petition_audit BEFORE INSERT ON audit_events " +
				"WHEN NEW.event_type IN ('crucible.sealed', 'crucible.purged', 'crucible.unsealed') " +
				"BEGIN SELECT RAISE(ABORT, 'injected petition audit failure'); END");
			const now = (minute + 1) * 60_000;
			expect(() => apply_crucible_petition(petition, now, database)).toThrow('injected petition audit failure');
			expect(database.query('SELECT is_open, processed_minute FROM crucible_guilds WHERE guild_id = 1').get())
				.toEqual({ is_open: type === 'crucible_unsealing' ? 0 : 1, processed_minute: minute });
			expect(database.query('SELECT item_id, qty FROM crucible_offerings WHERE guild_id = 1').all())
				.toEqual([{ item_id: 'melvorD:Weird_Gloop', qty: 3 }]);
			database.run('DROP TRIGGER fail_petition_audit');
			expect(apply_crucible_petition(petition, now, database))
				.toBe(type === 'crucible_sealing' ? 'sealed_and_destroyed' : type === 'crucible_purging' ? 'purged' : 'unsealed');
			apply_crucible_petition(petition, now, database);
			expect(database.query('SELECT COUNT(*) AS total FROM audit_events WHERE source_key = ?')
				.get(`crucible-petition:${petition_id}`)).toEqual({ total: 1 });
			if (type !== 'crucible_unsealing')
				expect(database.query('SELECT quantity, direction FROM audit_event_values WHERE event_id IN ' +
					'(SELECT id FROM audit_events WHERE source_key = ?)').all(`crucible-petition:${petition_id}`))
					.toEqual([{ quantity: 3, direction: 'destroy' }]);
		} finally {
			database.close();
		}
	});


function add_test_gloop(database: Database, qty: number, created_at = 1): number {
	return database.query<{ id: number }, [number, number, number]>(
		"INSERT INTO crucible_offerings (guild_id,item_id,qty,created_at,refreshed_at,is_untimed) " +
		"VALUES (1,'melvorD:Weird_Gloop',?,?,?,1) RETURNING id").get(qty, created_at, created_at)!.id;
}

test('Gloop decays at noon UTC once, catches up each missed day and preserves hidden untimed state', () => {
	const database = database_at_minute(719);
	try {
		add_test_gloop(database, 1_000_000);
		reconcile_crucible(1, 720 * 60_000 - 1, database);
		expect(crucible_contents(1, 0, database)!.offerings[0]!.qty).toBe(1_000_000);
		reconcile_crucible(1, 720 * 60_000, database);
		expect(crucible_contents(1, 0, database)!.offerings[0]!.qty).toBe(750_000);
		reconcile_crucible(1, 720 * 60_000, database);
		expect(crucible_contents(1, 0, database)!.offerings[0]!.qty).toBe(750_000);
		reconcile_crucible(1, (720 + 2 * 1440) * 60_000, database);
		expect(database.query('SELECT qty,is_untimed,meld_points FROM crucible_offerings').get())
			.toEqual({ qty: 421_875, is_untimed: 1, meld_points: 0 });
		expect(database.query("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='crucible.gloop_decayed'").get())
			.toEqual({ count: 3 });
		expect(crucible_contents(1, 0, database)!.heat.value).toBe(0);
	} finally { database.close(); }
});

test('Gloop created after noon waits until the next noon; small and maximum-safe stacks round exactly', () => {
	for (const qty of [1, 2, 3, 4, Number.MAX_SAFE_INTEGER]) {
		const database = database_at_minute(721);
		try {
			add_test_gloop(database, qty, 721 * 60_000);
			reconcile_crucible(1, 2159 * 60_000, database);
			expect(database.query('SELECT qty FROM crucible_offerings').get()).toEqual({ qty });
			reconcile_crucible(1, 2160 * 60_000, database);
			expect(database.query('SELECT qty FROM crucible_offerings').get())
				.toEqual({ qty: Number((BigInt(qty) * 3n + 3n) / 4n) });
		} finally { database.close(); }
	}
});

test('noon decay precedes newly melded Gloop and does not fund Wishes', () => {
	const database = database_at_minute(719);
	try {
		add_test_gloop(database, 1000);
		database.run("INSERT INTO crucible_offerings(guild_id,item_id,qty,value_currency_id,value_per_item,meld_points,created_at,refreshed_at) " +
			"VALUES(1,'test:NoonOre',1,'melvorD:GP',1000000,10079,1,1)");
		reconcile_crucible(1, 720 * 60_000, database);
		expect(database.query('SELECT qty FROM crucible_offerings').get()).toEqual({ qty: 1750 });
	} finally { database.close(); }
});

test('decay retires exact custody and audit value atomically and remains retryable after failure', () => {
	const database = database_at_minute(719);
	try {
		database.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) " +
			"VALUES(100,'decay-client','key','111-222-333','Test','melvorD:Plant')");
		const id = add_test_gloop(database, 1000);
		create_custody_source(database, { root_key: 'decay-root', operation_key: 'decay-operation',
			client_id: 100, object_id: 'melvorD:Weird_Gloop', quantity: 900, created_at: 1, snapshot: {} },
			`crucible-offering:${id}`);
		database.run("CREATE TRIGGER fail_decay BEFORE UPDATE OF qty ON crucible_offerings " +
			"BEGIN SELECT RAISE(ABORT,'injected decay failure'); END");
		expect(() => database.transaction(() => reconcile_crucible(1, 720 * 60_000, database)).immediate()).toThrow('injected decay failure');
		expect(database.query('SELECT processed_minute FROM crucible_guilds WHERE guild_id=1').get()).toEqual({processed_minute:719});
		expect(database.query('SELECT qty FROM crucible_offerings').get()).toEqual({qty:1000});
		expect(database.query("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='crucible.gloop_decayed'").get()).toEqual({count:0});
		database.run('DROP TRIGGER fail_decay');
		database.transaction(() => reconcile_crucible(1, 720 * 60_000, database)).immediate();
		expect(database.query('SELECT quantity,location FROM economy_custody_balances ORDER BY location').all())
			.toEqual([{quantity:150,location:'consumed:gloop-decay'},{quantity:750,location:`crucible-offering:${id}`}]);
		expect(database.query("SELECT quantity FROM audit_event_values WHERE event_id IN " +
			"(SELECT id FROM audit_events WHERE event_type='crucible.gloop_decayed')").all()).toEqual([{quantity:250}]);
	} finally { database.close(); }
});

test('non-GP, zero and unknown Meld value cannot produce Gloop', () => {
	for (const [currency, value] of [['melvorD:SlayerCoins', 10000], ['melvorD:GP', 0], [null, null]] as const) {
		const database = database_at_minute(1000);
		try {
			database.query('INSERT INTO crucible_offerings(guild_id,item_id,qty,value_currency_id,value_per_item,meld_points,created_at,refreshed_at) ' +
				"VALUES(1,'test:NoGP',10000,?,?,10079,1,1)").run(currency, value);
			reconcile_crucible(1, 1001 * 60_000, database);
			expect(database.query('SELECT * FROM crucible_offerings').all()).toEqual([]);
		} finally { database.close(); }
	}
});


test('persisted reconciliation cursor survives restart without repeating noon decay', () => {
	const directory = mkdtempSync(join(tmpdir(), 'crucible-decay-'));
	const path = join(directory, 'state.sqlite');
	let database = database_at_minute(719);
	try {
		add_test_gloop(database, 1_000_000);
		database.transaction(() => reconcile_crucible(1, 720 * 60_000, database)).immediate();
		writeFileSync(path, database.serialize());
		database.close();
		database = new Database(path, { strict: true });
		database.run('PRAGMA foreign_keys=ON');
		database.transaction(() => reconcile_crucible(1, 721 * 60_000, database)).immediate();
		expect(database.query('SELECT qty FROM crucible_offerings').get()).toEqual({qty:750000});
		database.transaction(() => reconcile_crucible(1, 2160 * 60_000, database)).immediate();
		expect(database.query('SELECT qty FROM crucible_offerings').get()).toEqual({qty:562500});
		expect(database.query('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { database.close(); rmSync(directory, {recursive:true,force:true}); }
});
