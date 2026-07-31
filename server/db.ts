import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations } from './db/schema';
import { report_error } from './log';

export type DatabaseRow = Record<string, any>;
export type DatabaseRunResult = {
	changes: number;
	lastInsertRowid: number;
};

export type ClientRegistration =
	| { status: 'created'; client_id: number }
	| { status: 'closed' }
	| { status: 'full' };

const database_path = process.env.DB_PATH ?? './data/melvor-multiplayer.sqlite';
mkdirSync(dirname(database_path), { recursive: true });

export const db = new Database(database_path, {
	create: true,
	strict: true
});

db.run('PRAGMA journal_mode = WAL');
db.run('PRAGMA foreign_keys = ON');
db.run('PRAGMA busy_timeout = 5000');

function initialize_schema(): void {
	const current_version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;

	for (const migration of migrations) {
		if (migration.version <= current_version)
			continue;

		const apply_migration = db.transaction(() => {
			db.run(migration.sql);
			db.run(`PRAGMA user_version = ${migration.version}`);
		});
		apply_migration.immediate();
	}
}

initialize_schema();

export async function db_run(sql: string, values: SQLQueryBindings[] = []): Promise<DatabaseRunResult> {
	const result = db.query(sql).run(...values);
	return {
		changes: result.changes,
		lastInsertRowid: Number(result.lastInsertRowid)
	};
}

export async function db_execute(sql: string, values: SQLQueryBindings[] = []): Promise<void> {
	try {
		await db_run(sql, values);
	} catch (error) {
		report_error('sqlite: db_execute failed', error);
	}
}

export async function db_get_all(
	sql: string,
	values: SQLQueryBindings[] = []
): Promise<DatabaseRow[]> {
	try {
		return db.query<DatabaseRow, SQLQueryBindings[]>(sql).all(...values);
	} catch (error) {
		report_error('sqlite: db_get_all failed', error);
		return [];
	}
}

export async function db_get_single(
	sql: string,
	values: SQLQueryBindings[] = []
): Promise<DatabaseRow|null> {
	const rows = await db_get_all(sql, values);
	return rows[0] ?? null;
}

export async function db_count(sql: string, values: SQLQueryBindings[] = []): Promise<number> {
	const row = await db_get_single(sql, values);
	return row?.count ?? 0;
}

export async function db_exists(sql: string, values: SQLQueryBindings[] = []): Promise<boolean> {
	const row = await db_get_single(sql, values);
	return row !== null;
}

export async function db_insert(sql: string, values: SQLQueryBindings[] = []): Promise<number> {
	try {
		return (await db_run(sql, values)).lastInsertRowid;
	} catch (error) {
		report_error('sqlite: db_insert failed', error);
		return -1;
	}
}

export function get_service_setting(key: string): string | null {
	const row = db.query<{ value: string }, [string]>(
		'SELECT `value` FROM `service_settings` WHERE `key` = ?'
	).get(key);
	return row?.value ?? null;
}

export function register_client(
	client_identifier: string,
	client_key: string,
	friend_code: string,
	display_name: string,
	icon_id: string
): ClientRegistration {
	const transaction = db.transaction((): ClientRegistration => {
		if (get_service_setting('registrations_open') !== '1')
			return { status: 'closed' };

		const maximum = Number(get_service_setting('max_identities'));
		const count = db.query<{ count: number }, []>('SELECT COUNT(*) AS `count` FROM `clients`').get()?.count ?? 0;
		if (!Number.isSafeInteger(maximum) || maximum < 1 || count >= maximum)
			return { status: 'full' };

		const result = db.query(
			'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
			'VALUES(?, ?, ?, ?, ?)'
		).run(client_identifier, client_key, friend_code, display_name, icon_id);

		return {
			status: 'created',
			client_id: Number(result.lastInsertRowid)
		};
	});

	return transaction.immediate();
}
