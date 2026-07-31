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
		return database.query(sql).run(...values).changes;
	} finally {
		database.close();
	}
}
