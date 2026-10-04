import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('direct fixture writes wait for a concurrent database writer', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'melvor-fixture-lock-'));
	const database_path = join(directory, 'fixture.sqlite');
	const database = new Database(database_path, { create: true, strict: true });
	let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
	try {
		database.run('PRAGMA journal_mode = WAL');
		database.run('CREATE TABLE probe (value INTEGER NOT NULL)');
		database.run('INSERT INTO probe VALUES (0)');
		database.run('BEGIN IMMEDIATE');
		database.run('UPDATE probe SET value = 1');
		child = Bun.spawn({
			cmd: [process.execPath, '-e', `
				import { db_run } from './tests/support/persistence.ts';
				console.log('ready');
				await db_run('UPDATE probe SET value = value + 1');
			`],
			cwd: join(import.meta.dir, '../..'),
			env: { ...process.env, TEST_DB_PATH: database_path },
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe'
		});
		const reader = child.stdout.getReader();
		try {
			expect(new TextDecoder().decode((await reader.read()).value)).toBe('ready\n');
		} finally {
			reader.releaseLock();
		}
		await Bun.sleep(100);
		expect(child.exitCode).toBeNull();
		database.run('COMMIT');
		const [exit_code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
		expect({ exit_code, stderr }).toEqual({ exit_code: 0, stderr: '' });
		expect(database.query('SELECT value FROM probe').get()).toEqual({ value: 2 });
	} finally {
		if (database.inTransaction)
			database.run('ROLLBACK');
		if (child !== undefined) {
			child.kill();
			await child.exited;
		}
		database.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
