import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations } from '../../db/schema';

const temporary_directories: string[] = [];

function fixture_database(): string {
	const directory = mkdtempSync(join(tmpdir(), 'melvor-admin-test-'));
	temporary_directories.push(directory);
	const database_path = join(directory, 'database.sqlite');
	const database = new Database(database_path, { create: true, strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations) {
		database.run(migration.sql);
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
	database.query(
		'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
		'VALUES (?, ?, ?, ?, ?)'
	).run(crypto.randomUUID(), crypto.randomUUID(), '123-456-789', 'Diagnostic Idler', 'melvorD:Plant');
	database.query('INSERT INTO `client_sessions` (`session_token`, `client_id`) VALUES (?, 1)').run('secret-session');
	database.query('INSERT INTO `guilds` (`name`, `icon_id`) VALUES (?, ?)').run('Diagnostic Guild', 'melvorD:Farmlands');
	database.query('INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES (1, 2)').run();
	database.query(
		'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `game_mode_id`, `language`, `reported_at`) ' +
		'VALUES (1, ?, ?, ?, ?, ?)'
	).run('1.4.5', '["Melvor Multiplayer", "Test Mod"]', 'melvor:standard', 'en-US', 1700000000000);
	const campaign = database.query(
		'INSERT INTO `campaign_state` (`guild_id`, `campaign_id`, `item_id`, `item_amount`, `item_current`, ' +
		'`required_contributors`, `auto_contribution`, `campaign_next`, `complete`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
	).run(2, 'Diagnostic Campaign', 'melvorD:Logs', 100, 25, 1, 5, 1700003600000, 0);
	database.query(
		'INSERT INTO `campaign_contributions` (`campaign_id`, `client_id`, `item_amount`, `taken`) VALUES (?, ?, ?, ?)'
	).run(Number(campaign.lastInsertRowid), 1, 20, 0);
	database.query(
		'INSERT INTO `guild_activity_events` (`guild_id`, `event_type`, `actor_client_id`, `actor_display_name`, ' +
		'`metadata`, `source_key`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).run(2, 'campaign_contributed', 1, 'Diagnostic Idler', '{"amount":20}', 'diagnostic:campaign:1', 1700000000000);
	database.close();
	return database_path;
}

async function run_admin(database_path: string, ...args: string[]) {
	const child_process = Bun.spawn({
		cmd: [process.execPath, 'run', 'admin.ts', ...args],
		cwd: join(import.meta.dir, '../..'),
		env: { ...Bun.env, DB_PATH: database_path },
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const [exit_code, stdout, stderr] = await Promise.all([
		child_process.exited,
		new Response(child_process.stdout).text(),
		new Response(child_process.stderr).text()
	]);
	return { exit_code, stdout, stderr };
}

afterEach(() => {
	for (const directory of temporary_directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe('administration CLI', () => {
	test('sets, reports, validates, and clears the released mod version', async () => {
		const database_path = fixture_database();
		const set = await run_admin(database_path, 'release-version', '1.3.0');
		const status = await run_admin(database_path, 'status');
		const invalid = await run_admin(database_path, 'release-version', 'backend-57');
		const clear = await run_admin(database_path, 'release-version', 'clear');
		const cleared_status = await run_admin(database_path, 'status');

		expect(set.exit_code).toBe(0);
		expect(set.stdout).toBe('Released mod version set to 1.3.0.\n');
		expect(status.stdout).toContain('released_mod_version=1.3.0\n');
		expect(invalid.exit_code).toBe(2);
		expect(invalid.stderr).toContain('Usage:');
		expect(clear.exit_code).toBe(0);
		expect(clear.stdout).toBe('Released mod version cleared.\n');
		expect(cleared_status.stdout).toContain('released_mod_version=none\n');
	});

	test('toggles and reports icon collection without accepting arbitrary values', async () => {
		const database_path = fixture_database();
		const disabled = await run_admin(database_path, 'icon-collection', 'off');
		const status = await run_admin(database_path, 'status');
		const invalid = await run_admin(database_path, 'icon-collection', 'maybe');
		const enabled = await run_admin(database_path, 'icon-collection', 'on');

		expect(disabled.exit_code).toBe(0);
		expect(disabled.stdout).toBe('Icon collection off.\n');
		expect(status.stdout).toContain('icon_collection=off\n');
		expect(invalid.exit_code).toBe(2);
		expect(invalid.stderr).toContain('Usage:');
		expect(enabled.exit_code).toBe(0);
		expect(enabled.stdout).toBe('Icon collection on.\n');
	});

	test('sets bounded icon collection limits and reports the effective settings', async () => {
		const database_path = fixture_database();
		const set = await run_admin(database_path, 'icon-collection-limit', 'catalog-bytes', '4096');
		const status = await run_admin(database_path, 'status');
		const too_large = await run_admin(database_path, 'icon-collection-limit', 'catalog-bytes', '999999999');
		const invalid = await run_admin(database_path, 'icon-collection-limit', 'manifest-items', '0');

		expect(set.exit_code).toBe(0);
		expect(set.stdout).toBe('Icon collection catalog-bytes limit set to 4096.\n');
		expect(status.stdout).toContain('icon_collection_max_catalog_bytes=4096\n');
		expect(too_large.exit_code).toBe(2);
		expect(too_large.stderr).toContain('Usage:');
		expect(invalid.exit_code).toBe(2);
	});

	test('inspects one identity without exposing credentials', async () => {
		const result = await run_admin(fixture_database(), 'identity', 'inspect', '1');

		expect(result.exit_code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('identity_id=1\n');
		expect(result.stdout).toContain('display_name="Diagnostic Idler"\n');
		expect(result.stdout).toContain('active_sessions=1\n');
		expect(result.stdout).toContain('guild_name="Diagnostic Guild"\n');
		expect(result.stdout).not.toContain('secret-session');
	});

	test('inspects bounded Guild state without exposing credentials', async () => {
		const result = await run_admin(fixture_database(), 'guild', 'inspect', '2');

		expect(result.exit_code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('guild_id=2\n');
		expect(result.stdout).toContain('name="Diagnostic Guild"\n');
		expect(result.stdout).toContain('"mod_version":"1.4.5"');
		expect(result.stdout).toContain('"campaign_id":"Diagnostic Campaign"');
		expect(result.stdout).toContain('"item_amount":20');
		expect(result.stdout).toContain('"event_type":"campaign_contributed"');
		expect(result.stdout).not.toContain('secret-session');
	});

	test('reports a missing Guild without accepting arbitrary SQL', async () => {
		const result = await run_admin(fixture_database(), 'guild', 'inspect', '999');

		expect(result.exit_code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('Guild 999 does not exist.\n');
	});

	test('reports a missing identity without accepting arbitrary SQL', async () => {
		const result = await run_admin(fixture_database(), 'identity', 'inspect', '999');

		expect(result.exit_code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('Multiplayer identity 999 does not exist.\n');
	});

	test('finds an identity by exact display name and resets its Charitree timers', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.query('UPDATE `clients` SET `display_name` = ?, `last_charity` = ?, `last_bonus_charity` = ? WHERE `id` = 1')
			.run('Briar', 1700000000000, 1700000001000);
		database.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = ? WHERE `client_id` = 1')
			.run(1700000002000);
		database.close();

		const found = await run_admin(database_path, 'identity', 'find', 'Briar');
		const reset = await run_admin(database_path, 'charity', 'reset', '1');
		expect(found.exit_code).toBe(0);
		expect(found.stdout).toContain('"id":1');
		expect(found.stdout).toContain('"display_name":"Briar"');
		expect(reset.exit_code).toBe(0);
		expect(reset.stdout).toContain('previous_last_charity=1700000000000\n');
		expect(reset.stdout).toContain('previous_last_bonus_charity=1700000001000\n');
		expect(reset.stdout).toContain('previous_charitree_take_available_at=1700000002000\n');
		expect(reset.stdout).toContain('last_charity=0\n');
		expect(reset.stdout).toContain('last_bonus_charity=0\n');
		expect(reset.stdout).toContain('charitree_take_available_at=0\n');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			'SELECT `last_charity`, `last_bonus_charity` FROM `clients` WHERE `id` = 1'
		).get()).toEqual({ last_charity: 0, last_bonus_charity: 0 });
		expect(verification.query(
			'SELECT `charitree_take_available_at` FROM `guild_memberships` WHERE `client_id` = 1'
		).get()).toEqual({ charitree_take_available_at: 0 });
		verification.close();
	});

	test('resets every identity cooldown and membership lock in one transaction', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, ' +
			'`last_charity`, `last_bonus_charity`) VALUES (?, ?, ?, ?, ?, ?, ?)'
		).run(crypto.randomUUID(), crypto.randomUUID(), '987-654-321', 'Second Idler', 'melvorD:Plant',
			1700000010000, 1700000011000);
		database.query('INSERT INTO `guild_memberships` (`client_id`, `guild_id`, `charitree_take_available_at`) VALUES (?, ?, ?)')
			.run(2, 2, 1700000012000);
		database.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = ? WHERE `client_id` = 1')
			.run(1700000013000);
		database.query('UPDATE `clients` SET `last_charity` = ?, `last_bonus_charity` = ? WHERE `id` = 1')
			.run(1700000014000, 1700000015000);
		database.close();

		const reset = await run_admin(database_path, 'charity', 'reset-all');
		expect(reset.exit_code).toBe(0);
		expect(reset.stdout).toBe('charity_clients_reset=2\ncharity_memberships_reset=2\n');
		expect(reset.stderr).toBe('');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			'SELECT COUNT(*) AS `count` FROM `clients` WHERE `last_charity` <> 0 OR `last_bonus_charity` <> 0'
		).get()).toEqual({ count: 0 });
		expect(verification.query(
			'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `charitree_take_available_at` <> 0'
		).get()).toEqual({ count: 0 });
		verification.close();
	});
});
