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

	test('reports a missing identity without accepting arbitrary SQL', async () => {
		const result = await run_admin(fixture_database(), 'identity', 'inspect', '999');

		expect(result.exit_code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('Multiplayer identity 999 does not exist.\n');
	});
});
