import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations } from './db/schema';
import { report_error } from './log';
import type { DeviceDiagnostics } from './diagnostics';
import { instrument_audited_database } from './audit-context';

export type DatabaseRow = Record<string, any>;
export type DatabaseRunResult = {
	changes: number;
	lastInsertRowid: number;
};

export type MelvorAccountInput = {
	cloud_username: string;
	playfab_id: string;
};

export type ClientRegistration =
	| { status: 'created'; client_id: number }
	| { status: 'closed' };

const database_path = process.env.DB_PATH ?? './data/melvor-multiplayer.sqlite';
mkdirSync(dirname(database_path), { recursive: true });

const raw_db = new Database(database_path, {
	create: true,
	strict: true
});

export let db = raw_db;

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
			if (migration.foreign_keys_disabled) {
				const violations = db.query<Record<string, unknown>, []>('PRAGMA foreign_key_check').all();
				if (violations.length > 0)
					throw new Error(`Migration ${migration.version} introduced foreign-key violations`);
			}
			db.run(`PRAGMA user_version = ${migration.version}`);
		});
		if (migration.foreign_keys_disabled)
			db.run('PRAGMA foreign_keys = OFF');
		try {
			apply_migration.immediate();
		} finally {
			if (migration.foreign_keys_disabled)
				db.run('PRAGMA foreign_keys = ON');
		}
	}
}

initialize_schema();
db = instrument_audited_database(raw_db);

export async function db_run(sql: string, values: SQLQueryBindings[] = []): Promise<DatabaseRunResult> {
	const result = db.query(sql).run(...values);
	const direct_changes = db.query<{ changes: number }, []>('SELECT changes() AS `changes`').get()?.changes ?? 0;
	return {
		changes: direct_changes,
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

export function get_or_create_melvor_account(account: MelvorAccountInput, now = Date.now()): number {
	const row = db.query<{ id: number }, [string, string, number]>(
		'INSERT INTO `melvor_accounts` (`cloud_username`, `playfab_id`, `created_at`) VALUES(?, ?, ?) ' +
		'ON CONFLICT (`playfab_id`) DO UPDATE SET `playfab_id` = excluded.`playfab_id` ' +
		'RETURNING `id`'
	).get(account.cloud_username, account.playfab_id, now) as { id: number };
	return row.id;
}

export function register_client(
	client_identifier: string,
	client_key: string,
	friend_code: string,
	display_name: string,
	icon_id: string,
	melvor_account: MelvorAccountInput | null = null,
	device: DeviceDiagnostics | null = null
): ClientRegistration {
	const transaction = db.transaction((): ClientRegistration => {
		if (get_service_setting('registrations_open') !== '1')
			return { status: 'closed' };

		const melvor_account_id = melvor_account === null ? null : get_or_create_melvor_account(melvor_account);

		const result = db.query(
			'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, ' +
			'`melvor_account_id`) VALUES(?, ?, ?, ?, ?, ?)'
		).run(client_identifier, client_key, friend_code, display_name, icon_id, melvor_account_id);
		const client_id = Number(result.lastInsertRowid);
		const created_at = Date.now();
		const audit_event = db.query<{ id: number }, [
			number, number, string, string, string | null, string | null, string | null, string | null, string | null, string | null
		]>(
			'INSERT INTO `audit_events` (`occurred_at`, `event_type`, `actor_kind`, `actor_client_id`, ' +
			'`actor_display_name`, `source_key`, `installation_id`, `client_platform`, `app_distribution`, ' +
			'`app_channel`, `app_version`, `app_build`) VALUES(?, \'identity.registered\', \'client\', ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
			'RETURNING `id`'
		).get(created_at, client_id, display_name, `identity-registered:${client_id}`,
			device?.installation_id ?? null, device?.platform ?? null, device?.distribution ?? null,
			device?.app_channel ?? null, device?.app_version ?? null, device?.app_build ?? null) as { id: number };
		db.query(
			'INSERT INTO `client_display_name_history` (`client_id`, `display_name`, `valid_from`, `changed_by_event_id`) ' +
			'VALUES(?, ?, ?, ?)'
		).run(client_id, display_name, created_at, audit_event.id);
		db.query(
			'INSERT INTO `global_chat_read_state` (`client_id`, `last_read_message_id`) ' +
			'SELECT ?, COALESCE(MAX(`id`), 0) FROM `global_chat_messages`'
		).run(client_id);

		return {
			status: 'created',
			client_id
		};
	});

	return transaction.immediate();
}
