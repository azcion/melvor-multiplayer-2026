import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
	get_petition_conflict_subject,
	get_petition_resolution,
	is_petition_choice,
	is_petition_type
} from '../../council';
import { migrations } from '../../db/schema';

describe('Council petition rules', () => {
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
		expect(is_petition_type('charitree_ingratitude')).toBe(true);
		expect(is_petition_type('charitree_sacrilege')).toBe(true);
		expect(is_petition_type('charitree_beneficence')).toBe(true);
		expect(is_petition_type('fellowship')).toBe(true);
		expect(is_petition_type('enclosure')).toBe(true);
		expect(is_petition_type('charitree_clearing')).toBe(false);
		expect(is_petition_type('execute_sql')).toBe(false);
		expect(is_petition_choice('aye')).toBe(true);
		expect(is_petition_choice('abstain')).toBe(false);
	});

	test('derives stable conflict subjects', () => {
		expect(get_petition_conflict_subject('appellation')).toBe('guild:name');
		expect(get_petition_conflict_subject('heraldry')).toBe('guild:icon');
		expect(get_petition_conflict_subject('charitree_ingratitude')).toBe('guild:charitree');
		expect(get_petition_conflict_subject('charitree_sacrilege')).toBe('guild:charitree');
		expect(get_petition_conflict_subject('charitree_beneficence')).toBe('guild:charitree');
		expect(get_petition_conflict_subject('fellowship')).toBe('guild:admission');
		expect(get_petition_conflict_subject('enclosure')).toBe('guild:admission');
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
});
