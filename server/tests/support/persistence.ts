import { Database, type SQLQueryBindings } from 'bun:sqlite';

const database_path = process.env.TEST_DB_PATH;
if (database_path === undefined)
	throw new Error('TEST_DB_PATH is required');

export async function db_all<T extends Record<string, unknown>>(
	sql: string,
	values: SQLQueryBindings[] = []
): Promise<T[]> {
	const database = new Database(database_path, {
		readonly: true,
		strict: true
	});

	try {
		database.run('PRAGMA busy_timeout = 5000');
		return database.query<T, SQLQueryBindings[]>(sql).all(...values);
	} finally {
		database.close();
	}
}

export async function db_count(sql: string, values: SQLQueryBindings[] = []): Promise<number> {
	const rows = await db_all<{ count: number }>(sql, values);
	return rows[0]?.count ?? 0;
}

export async function db_run(sql: string, values: SQLQueryBindings[] = []): Promise<number> {
	const database = new Database(database_path, {
		strict: true
	});

	try {
		// Fixture writes share the WAL database with the HTTP server. Use its
		// bounded lock wait rather than failing on a momentary concurrent write.
		database.run('PRAGMA busy_timeout = 5000');
		database.query(sql).run(...values);
		return database.query<{ changes: number }, []>('SELECT changes() AS `changes`').get()?.changes ?? 0;
	} finally {
		database.close();
	}
}

export async function clear_global_chat_throttle(): Promise<void> {
	await db_run('DELETE FROM `global_chat_server_throttle`');
}
