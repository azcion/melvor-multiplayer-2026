import { Database } from 'bun:sqlite';
import { chmodSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const database_path = process.env.DB_PATH;
const backup_directory = process.env.BACKUP_DIR ?? '/app/backups';

if (database_path === undefined)
	throw new Error('DB_PATH is required');

function backup_path(filename: string | undefined): string {
	if (
		filename === undefined ||
		basename(filename) !== filename ||
		!/^(daily|pre-deploy|pre-change)-\d{8}T\d{6}Z\.sqlite$/.test(filename)
	)
		throw new Error('Backup filename must be a generated daily, pre-deploy, or pre-change SQLite filename');
	return join(backup_directory, filename);
}

function verify(path: string): void {
	const backup = new Database(path, {
		readonly: true,
		strict: true
	});

	try {
		const integrity = backup.query<{ integrity_check: string }, []>('PRAGMA integrity_check').get()?.integrity_check;
		if (integrity !== 'ok')
			throw new Error(`Backup integrity check failed: ${integrity ?? 'no result'}`);

		const clients_table = backup.query<{ count: number }, []>(
			"SELECT COUNT(*) AS `count` FROM `sqlite_schema` WHERE `type` = 'table' AND `name` = 'clients'"
		).get()?.count ?? 0;
		if (clients_table !== 1)
			throw new Error('Backup does not contain the clients table');
	} finally {
		backup.close();
		for (const suffix of ['-wal', '-shm'])
			try {
				unlinkSync(`${path}${suffix}`);
			} catch {}
	}
}

const [command, filename] = Bun.argv.slice(2);
const path = backup_path(filename);

if (command === 'verify') {
	verify(path);
	console.log(`Verified backup ${filename}.`);
	process.exit(0);
}

if (command !== 'create')
	throw new Error('Usage: bun run backup.ts create|verify BACKUP_FILENAME');

const source = new Database(database_path, {
	readonly: true,
	strict: true
});
const temporary_path = `${path}.tmp-${process.pid}`;

try {
	const contents = source.serialize();
	writeFileSync(temporary_path, contents, {
		flag: 'wx',
		mode: 0o600
	});
	verify(temporary_path);
	renameSync(temporary_path, path);
	chmodSync(path, 0o600);
} catch (error) {
	try {
		unlinkSync(temporary_path);
	} catch {}
	throw error;
} finally {
	source.close();
}

console.log(`Created and verified backup ${filename}.`);
