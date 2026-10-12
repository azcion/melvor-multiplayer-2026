import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
	get_petition_conflict_subject,
	petition_expiry,
	get_petition_resolution,
	is_petition_choice,
	is_petition_type
} from '../../council';
import { migrations } from '../../db/schema';
import { create_test_database } from '../support/database';

describe('Council petition rules', () => {
	test('Free Fellowship keeps the inactivity deadline within 36 hours of creation', () => {
		const hour = 3600000, created = 1000000000;
		expect(petition_expiry('free_fellowship', created, created)).toBe(created + 24 * hour);
		expect(petition_expiry('free_fellowship', created, created + 5 * hour)).toBe(created + 29 * hour);
		expect(petition_expiry('free_fellowship', created, created + 12 * hour)).toBe(created + 36 * hour);
		expect(petition_expiry('free_fellowship', created, created + 35 * hour)).toBe(created + 36 * hour);
		for (const type of ['public', 'private', undefined])
			expect(petition_expiry(type, created, created + 35 * hour)).toBe(created + 59 * hour);
	});

	test('grants at exactly half of an even electorate', () => {
		expect(get_petition_resolution(4, 1, 0)).toBeNull();
		expect(get_petition_resolution(4, 2, 0)).toBe('granted');
	});

	test('grants only above half of an odd electorate', () => {
		expect(get_petition_resolution(5, 2, 0)).toBeNull();
		expect(get_petition_resolution(5, 3, 0)).toBe('granted');
	});

	test('denies only above half for even and odd electorates', () => {
		expect(get_petition_resolution(4, 0, 2)).toBeNull();
		expect(get_petition_resolution(4, 0, 3)).toBe('denied');
		expect(get_petition_resolution(5, 0, 2)).toBeNull();
		expect(get_petition_resolution(5, 0, 3)).toBe('denied');
	});

	test('handles a one-member Guild without an automatic ballot', () => {
		expect(get_petition_resolution(1, 0, 0)).toBeNull();
		expect(get_petition_resolution(1, 1, 0)).toBe('granted');
		expect(get_petition_resolution(1, 0, 1)).toBe('denied');
	});

	test('rejects impossible tallies', () => {
		expect(() => get_petition_resolution(0, 0, 0)).toThrow(RangeError);
		expect(() => get_petition_resolution(3, 4, 0)).toThrow(RangeError);
		expect(() => get_petition_resolution(3, 2, 2)).toThrow(RangeError);
	});

	test('accepts only the closed petition and ballot vocabularies', () => {
		expect(is_petition_type('banishment')).toBe(true);
		expect(is_petition_type('winnowing')).toBe(true);
		expect(is_petition_type('charitree_ingratitude')).toBe(false);
		expect(is_petition_type('charitree_sacrilege')).toBe(false);
		expect(is_petition_type('charitree_beneficence')).toBe(false);
		expect(is_petition_type('fellowship')).toBe(true);
		expect(is_petition_type('enclosure')).toBe(true);
		expect(is_petition_type('interdict')).toBe(true);
		expect(is_petition_type('heresy')).toBe(true);
		expect(is_petition_type('temperance')).toBe(true);
		expect(is_petition_type('indulgence')).toBe(true);
		expect(is_petition_type('charitree_clearing')).toBe(false);
		expect(is_petition_type('execute_sql')).toBe(false);
		expect(is_petition_choice('aye')).toBe(true);
		expect(is_petition_choice('abstain')).toBe(false);
	});

	test('derives stable conflict subjects', () => {
		expect(get_petition_conflict_subject('appellation')).toBe('guild:name');
		expect(get_petition_conflict_subject('heraldry')).toBe('guild:icon');
		expect(get_petition_conflict_subject('crucible_purging')).toBe('guild:crucible');
		expect(get_petition_conflict_subject('crucible_sealing')).toBe('guild:crucible');
		expect(get_petition_conflict_subject('crucible_unsealing')).toBe('guild:crucible');
		expect(get_petition_conflict_subject('fellowship')).toBe('guild:admission');
		expect(get_petition_conflict_subject('enclosure')).toBe('guild:admission');
		expect(get_petition_conflict_subject('interdict')).toBe('guild:cheat-policy');
		expect(get_petition_conflict_subject('heresy')).toBe('guild:cheat-policy');
		expect(get_petition_conflict_subject('temperance')).toBe('guild:market-discovery-policy');
		expect(get_petition_conflict_subject('indulgence')).toBe('guild:market-discovery-policy');
		expect(get_petition_conflict_subject('winnowing')).toBe('guild:winnowing');
		expect(get_petition_conflict_subject('banishment', 42)).toBe('membership:42');
	});

	test('preserves Petition voters and votes while extending the schema', () => {
		const database = new Database(':memory:', { strict: true });
		for (const migration of migrations.filter(entry => entry.version < 19))
			database.run(migration.sql);
		database.run('PRAGMA foreign_keys = ON');
		database.run(
			'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
			"VALUES(1, 'migration-client', 'key', 'friend', 'Migration Member', 'melvorD:Plant')"
		);
		database.run("INSERT INTO `guilds` (`id`, `name`, `icon_id`) VALUES(2, 'Migration Guild', 'melvorD:Farmlands')");
		database.run(
			'INSERT INTO `guild_petitions` (`id`, `guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
			'`petitioner_id`, `proposed_name`, `created_at`, `expires_at`) ' +
			"VALUES(1, 2, 'Migration Guild', 'appellation', 'guild:name', 1, 'Migrated Guild', 1, 2)"
		);
		database.run('INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) VALUES(1, 1)');
		database.run(
			"INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) " +
			"VALUES(1, 1, 'aye', 1)"
		);
		database.run(
			"INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`) VALUES(2, 'melvorD:Logs', 10)"
		);

		const migration = migrations.find(entry => entry.version === 19);
		expect(migration).toBeDefined();
		database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration?.sql ?? '')).immediate();
		database.run('PRAGMA foreign_keys = ON');

		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		expect(database.query('SELECT choice FROM `guild_petition_votes`').get()).toEqual({ choice: 'aye' });
		expect(database.query('SELECT qty, expires_at FROM `charity_items`').get()).toMatchObject({ qty: 10 });
		expect((database.query(
			'SELECT `expires_at` FROM `charity_items`'
		).get() as { expires_at: number }).expires_at).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000);
		database.close();
	});

	test('preserves Petition children while replacing the legacy Charitree type', () => {
		const database = new Database(':memory:', { strict: true });
		for (const migration of migrations.filter(entry => entry.version < 20)) {
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = ON');
		}
		database.run(
			'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
			"VALUES(1, 'charitree-migration-client', 'key', 'friend', 'Migration Member', 'melvorD:Plant')"
		);
		database.run("INSERT INTO `guilds` (`id`, `name`, `icon_id`) VALUES(2, 'Migration Guild', 'melvorD:Farmlands')");
		database.run(
			'INSERT INTO `guild_petitions` (`id`, `guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
			'`petitioner_id`, `charitree_expires_before`, `created_at`, `expires_at`) ' +
			"VALUES(1, 2, 'Migration Guild', 'charitree_clearing', 'guild:charitree', 1, 100, 1, 2)"
		);
		database.run('INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) VALUES(1, 1)');
		database.run(
			"INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) " +
			"VALUES(1, 1, 'aye', 1)"
		);

		const migration = migrations.find(entry => entry.version === 20);
		expect(migration?.foreign_keys_disabled).toBe(true);
		database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration?.sql ?? '')).immediate();
		database.run('PRAGMA foreign_keys = ON');

		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		expect(database.query('SELECT type FROM `guild_petitions`').get()).toEqual({
			type: 'charitree_ingratitude'
		});
		expect(database.query('SELECT choice FROM `guild_petition_votes`').get()).toEqual({ choice: 'aye' });
		expect(database.query('SELECT charitree_enabled FROM `guilds`').get()).toEqual({ charitree_enabled: 1 });
		database.close();
	});

	test('preserves Guild children while extending admission types and membership locks', () => {
		const database = new Database(':memory:', { strict: true });
		for (const migration of migrations.filter(entry => entry.version < 25)) {
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = ON');
		}
		database.run(
			'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) VALUES ' +
			"(1, 'admission-member', 'key-1', 'friend-1', 'Migration Member', 'melvorD:Plant'), " +
			"(2, 'admission-applicant', 'key-2', 'friend-2', 'Migration Applicant', 'melvorD:Plant')"
		);
		database.run("INSERT INTO `guilds` (`id`, `name`, `icon_id`) VALUES(2, 'Migration Guild', 'melvorD:Farmlands')");
		database.run('INSERT INTO `guild_memberships` (`id`, `client_id`, `guild_id`) VALUES(1, 1, 2)');
		database.run('INSERT INTO `guild_applications` (`id`, `client_id`, `guild_id`) VALUES(1, 2, 2)');
		database.run(
			'INSERT INTO `guild_petitions` (`id`, `guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
			'`petitioner_id`, `proposed_name`, `created_at`, `expires_at`) ' +
			"VALUES(1, 2, 'Migration Guild', 'appellation', 'guild:name', 1, 'Migrated Guild', 1, 2)"
		);
		database.run('INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) VALUES(1, 1)');
		database.run(
			"INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) " +
			"VALUES(1, 1, 'aye', 1)"
		);
		database.run(
			"INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`) " +
			"VALUES(2, 'melvorD:Logs', 10, 100)"
		);

		const migration = migrations.find(entry => entry.version === 25);
		expect(migration?.foreign_keys_disabled).toBe(true);
		database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration?.sql ?? '')).immediate();
		database.run('PRAGMA foreign_keys = ON');

		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		expect(database.query('SELECT client_id, guild_id, charitree_take_available_at FROM guild_memberships').get())
			.toEqual({ client_id: 1, guild_id: 2, charitree_take_available_at: 0 });
		expect(database.query('SELECT client_id, guild_id FROM guild_applications').get())
			.toEqual({ client_id: 2, guild_id: 2 });
		expect(database.query('SELECT choice FROM guild_petition_votes').get()).toEqual({ choice: 'aye' });
		expect(database.query('SELECT qty FROM charity_items').get()).toEqual({ qty: 10 });
		database.run("UPDATE guilds SET type = 'public' WHERE id = 2");
		database.run(
			'INSERT INTO guild_petitions (guild_id, guild_name, type, conflict_subject, petitioner_id, created_at, expires_at) ' +
			"VALUES(2, 'Migration Guild', 'enclosure', 'guild:admission', 1, 3, 4)"
		);
		expect(database.query('SELECT type FROM guilds WHERE id = 2').get()).toEqual({ type: 'public' });
		database.close();
	});

	test('preserves Petition children while adding Winnowing targets', () => {
		const database = new Database(':memory:', { strict: true });
		for (const migration of migrations.filter(entry => entry.version < 26)) {
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = ON');
		}
		database.run(
			'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) VALUES ' +
			"(1, 'winnowing-member', 'key-1', 'friend-1', 'Migration Member', 'melvorD:Plant'), " +
			"(2, 'winnowing-shadowed', 'key-2', 'friend-2', 'Migration Shadowed', 'melvorD:Plant')"
		);
		database.run("INSERT INTO `guilds` (`id`, `name`, `icon_id`) VALUES(2, 'Migration Guild', 'melvorD:Farmlands')");
		database.run('INSERT INTO `guild_memberships` (`id`, `client_id`, `guild_id`) VALUES(1, 1, 2), (2, 2, 2)');
		database.run(
			'INSERT INTO `guild_petitions` (`id`, `guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
			'`petitioner_id`, `proposed_name`, `created_at`, `expires_at`) ' +
			"VALUES(1, 2, 'Migration Guild', 'appellation', 'guild:name', 1, 'Migrated Guild', 1, 2)"
		);
		database.run('INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) VALUES(1, 1)');
		database.run(
			"INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) " +
			"VALUES(1, 1, 'aye', 1)"
		);
		database.run(
			'INSERT INTO `banishment_returns` (`petition_id`, `client_id`, `guild_id`, `guild_name`, `created_at`) ' +
			"VALUES(1, 2, 2, 'Migration Guild', 1)"
		);

		const migration = migrations.find(entry => entry.version === 26);
		expect(migration?.foreign_keys_disabled).toBe(true);
		database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration?.sql ?? '')).immediate();
		database.run('PRAGMA foreign_keys = ON');

		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		expect(database.query('SELECT choice FROM guild_petition_votes').get()).toEqual({ choice: 'aye' });
		expect(database.query('SELECT client_id FROM banishment_returns').get()).toEqual({ client_id: 2 });
		database.run(
			'INSERT INTO guild_petitions (id, guild_id, guild_name, type, conflict_subject, petitioner_id, created_at, expires_at) ' +
			"VALUES(2, 2, 'Migration Guild', 'winnowing', 'guild:winnowing', 1, 3, 4)"
		);
		database.run(
			'INSERT INTO guild_petition_winnowing_targets (petition_id, membership_id, client_id) VALUES(2, 2, 2)'
		);
		expect(database.query('SELECT membership_id, client_id FROM guild_petition_winnowing_targets').get())
			.toEqual({ membership_id: 2, client_id: 2 });
		database.close();
	});

	test('preserves Petition children while adding the Guild cheat policy', () => {
		const database = new Database(':memory:', { strict: true });
		for (const migration of migrations.filter(entry => entry.version < 88)) {
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = ON');
		}
		database.run(
			'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
			"VALUES(1, 'policy-member', 'key', 'friend', 'Policy Member', 'melvorD:Plant')"
		);
		database.run("INSERT INTO `guilds` (`id`, `name`, `icon_id`) VALUES(2, 'Policy Guild', 'melvorD:Farmlands')");
		database.run(
			'INSERT INTO `guild_petitions` (`id`, `guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
			'`petitioner_id`, `proposed_name`, `created_at`, `expires_at`) ' +
			"VALUES(1, 2, 'Policy Guild', 'appellation', 'guild:name', 1, 'Renamed Guild', 1, 2)"
		);
		database.run('INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) VALUES(1, 1)');
		database.run(
			"INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) " +
			"VALUES(1, 1, 'aye', 1)"
		);

		const migration = migrations.find(entry => entry.version === 88);
		expect(migration?.foreign_keys_disabled).toBe(true);
		database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => {
			database.run(migration!.sql);
			expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		}).immediate();
		database.run('PRAGMA foreign_keys = ON');

		expect(database.query('SELECT choice FROM `guild_petition_votes`').get()).toEqual({ choice: 'aye' });
		expect(database.query('SELECT cheat_restriction_enabled FROM `guilds`').get())
			.toEqual({ cheat_restriction_enabled: 0 });
		database.run(
			'INSERT INTO `guild_petitions` (`guild_id`, `guild_name`, `type`, `conflict_subject`, `petitioner_id`, `created_at`, `expires_at`) ' +
			"VALUES(2, 'Policy Guild', 'interdict', 'guild:cheat-policy', 1, 3, 4)"
		);
		database.run("UPDATE `guild_petitions` SET `subject_locked` = 0 WHERE `type` = 'interdict'");
		database.run(
			'INSERT INTO `guild_petitions` (`guild_id`, `guild_name`, `type`, `conflict_subject`, `petitioner_id`, `created_at`, `expires_at`) ' +
			"VALUES(2, 'Policy Guild', 'heresy', 'guild:cheat-policy', 1, 5, 6)"
		);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		database.close();
	});

	test('preserves Petition children while adding the Guild Marketplace discovery policy', () => {
		const database = new Database(':memory:', { strict: true });
		for (const migration of migrations.filter(entry => entry.version < 100)) {
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = ON');
		}
		database.run(
			'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) VALUES ' +
			"(1, 'market-policy-member', 'key-1', 'friend-1', 'Policy Member', 'melvorD:Plant'), " +
			"(2, 'market-policy-return', 'key-2', 'friend-2', 'Policy Return', 'melvorD:Plant')"
		);
		database.run("INSERT INTO `guilds` (`id`, `name`, `icon_id`) VALUES(2, 'Policy Guild', 'melvorD:Farmlands')");
		database.run(
			'INSERT INTO `guild_petitions` (`id`, `guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
			'`petitioner_id`, `proposed_name`, `created_at`, `expires_at`) ' +
			"VALUES(1, 2, 'Policy Guild', 'appellation', 'guild:name', 1, 'Renamed Guild', 1, 2)"
		);
		database.run('INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) VALUES(1, 1)');
		database.run(
			"INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) " +
			"VALUES(1, 1, 'aye', 1)"
		);
		database.run(
			'INSERT INTO `banishment_returns` (`petition_id`, `client_id`, `guild_id`, `guild_name`, `created_at`) ' +
			"VALUES(1, 2, 2, 'Policy Guild', 1)"
		);

		const migration = migrations.find(entry => entry.version === 100);
		expect(migration?.foreign_keys_disabled).toBe(true);
		database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => {
			database.run(migration!.sql);
			expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		}).immediate();
		database.run('PRAGMA foreign_keys = ON');

		expect(database.query('SELECT choice FROM `guild_petition_votes`').get()).toEqual({ choice: 'aye' });
		expect(database.query('SELECT client_id FROM `banishment_returns`').get()).toEqual({ client_id: 2 });
		expect(database.query('SELECT market_discovery_restriction_enabled FROM `guilds`').get())
			.toEqual({ market_discovery_restriction_enabled: 0 });
		database.run(
			'INSERT INTO `guild_petitions` (`guild_id`, `guild_name`, `type`, `conflict_subject`, `petitioner_id`, `created_at`, `expires_at`) ' +
			"VALUES(2, 'Policy Guild', 'temperance', 'guild:market-discovery-policy', 1, 3, 4)"
		);
		database.run("UPDATE `guild_petitions` SET `subject_locked` = 0 WHERE `type` = 'temperance'");
		database.run(
			'INSERT INTO `guild_petitions` (`guild_id`, `guild_name`, `type`, `conflict_subject`, `petitioner_id`, `created_at`, `expires_at`) ' +
			"VALUES(2, 'Policy Guild', 'indulgence', 'guild:market-discovery-policy', 1, 5, 6)"
		);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		database.close();
	});
});


test('Free Fellowship deadline migration clamps only active Fellowship petitions', () => {
	const database = create_test_database();
	try {
		const fellowship = database.query<{ id: number }, []>("SELECT id FROM guilds WHERE type='free_fellowship'").get()!.id;
		const other = Number(database.query("INSERT INTO guilds(name,icon_id,created_at) VALUES('Deadline Guild','melvorD:Plant',100)").run().lastInsertRowid);
		const client = Number(database.query("INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES('deadline','key','deadline-friend','Voter','melvorD:Plant')").run().lastInsertRowid);
		const hour = 3600000, created = 1000000000;
		for (const [index, guild, lifecycle, hours] of [[1,fellowship,'active',50],[2,fellowship,'active',24],[3,fellowship,'granted',50],[4,other,'active',50]] as const) {
			database.query(`INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,lifecycle,subject_locked)
				VALUES(?,?,'Deadline','interdict',?,?,?, ?,?,0)`)
				.run(index,guild,`deadline:${index}`,client,created,created+hours*hour,lifecycle);
		}
		database.run(migrations.find(m=>m.version===182)!.sql);
		expect(database.query('SELECT id,expires_at FROM guild_petitions ORDER BY id').all()).toEqual([
			{id:1,expires_at:created+36*hour}, {id:2,expires_at:created+24*hour},
			{id:3,expires_at:created+50*hour}, {id:4,expires_at:created+50*hour}
		]);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { database.close(); }
});
