import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('backup copies committed WAL data, excludes uncommitted writes and publishes a private verified file', async () => {
	const root = mkdtempSync(join(tmpdir(), 'melvor-backup-'));
	const path = join(root, 'source.sqlite');
	const source = new Database(path, { create: true });
	const filename = 'pre-deploy-20261031T000000Z.sqlite';
	try {
		source.run('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE clients(id INTEGER PRIMARY KEY, data BLOB)');
		source.query('INSERT INTO clients VALUES (?, zeroblob(?))').run(1, 8 * 1024 * 1024);
		source.run('BEGIN IMMEDIATE; INSERT INTO clients VALUES (2, NULL)');
		const child = Bun.spawn([process.execPath, 'run', 'backup.ts', 'create', filename], {
			env: { ...process.env, DB_PATH: path, BACKUP_DIR: root }, stdout: 'pipe', stderr: 'pipe'
		});
		const stderr = await new Response(child.stderr).text();
		expect(await child.exited, stderr).toBe(0);
		const copy = new Database(join(root, filename), { readonly: true });
		try {
			expect(copy.query('SELECT id, length(data) AS bytes FROM clients').all()).toEqual([{ id: 1, bytes: 8 * 1024 * 1024 }]);
			expect(copy.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
		} finally { copy.close(); }
		expect(statSync(join(root, filename)).mode & 0o777).toBe(0o600);
		expect(readdirSync(root).filter(name => name.includes('.tmp-'))).toEqual([]);
		expect(source.query('SELECT COUNT(*) AS count FROM clients').get()).toEqual({ count: 2 });
	} finally {
		source.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test('failed verification removes the incomplete backup without publishing it', async () => {
	const root = mkdtempSync(join(tmpdir(), 'melvor-backup-'));
	const path = join(root, 'source.sqlite');
	const filename = 'daily-20261031T000000Z.sqlite';
	try {
		const source = new Database(path, { create: true });
		source.run('CREATE TABLE wrong_schema(id INTEGER)');
		source.close();
		const child = Bun.spawn([process.execPath, 'run', 'backup.ts', 'create', filename], {
			env: { ...process.env, DB_PATH: path, BACKUP_DIR: root }, stdout: 'pipe', stderr: 'pipe'
		});
		const stderr = await new Response(child.stderr).text();
		expect(await child.exited).not.toBe(0);
		expect(stderr).toContain('clients table');
		expect(existsSync(join(root, filename))).toBe(false);
		expect(readdirSync(root).filter(name => name.includes('.tmp-'))).toEqual([]);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
