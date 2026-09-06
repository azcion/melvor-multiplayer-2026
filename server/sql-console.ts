import { Database } from 'bun:sqlite';
import { createInterface } from 'node:readline';

export const MAX_RESULT_ROWS = 1000;

export type QueryResult = {
	rows: Record<string, unknown>[];
	truncated: boolean;
};

type OutputMode = 'json' | 'table';

export function open_readonly_database(database_path: string): Database {
	const database = new Database(database_path, { readonly: true, strict: true });
	database.run('PRAGMA query_only = ON');
	database.run('PRAGMA busy_timeout = 5000');
	return database;
}

export function execute_read_query(database: Database, sql: string, max_rows = MAX_RESULT_ROWS): QueryResult {
	const rows: Record<string, unknown>[] = [];
	let truncated = false;

	for (const row of database.query<Record<string, unknown>, []>(sql).iterate()) {
		if (rows.length === max_rows) {
			truncated = true;
			break;
		}
		rows.push(row);
	}

	return { rows, truncated };
}

function json_replacer(_key: string, value: unknown): unknown {
	if (typeof value === 'bigint')
		return value.toString();
	if (value instanceof Uint8Array)
		return { base64: Buffer.from(value).toString('base64') };
	return value;
}

export function format_json_result(result: QueryResult): string {
	return JSON.stringify(result, json_replacer, 2);
}

function print_result(result: QueryResult, mode: OutputMode): void {
	if (mode === 'json') {
		console.log(format_json_result(result));
	} else if (result.rows.length === 0) {
		console.log('(no rows)');
	} else {
		console.table(result.rows);
	}

	if (result.truncated)
		console.error(`Result truncated after ${MAX_RESULT_ROWS} rows. Add a narrower WHERE clause or LIMIT.`);
}

function print_help(): void {
	console.log(`Commands:
  .tables             List application tables and views
  .schema [NAME]      Show CREATE statements, optionally for one object
  .mode table|json    Select interactive result formatting
  .help               Show this help
  .quit or .exit      End the session

Terminate interactive SQL statements with a semicolon. Results are capped at ${MAX_RESULT_ROWS} rows.`);
}

function run_dot_command(database: Database, command: string, mode: OutputMode): OutputMode | null {
	if (command === '.quit' || command === '.exit')
		return null;
	if (command === '.help') {
		print_help();
		return mode;
	}
	if (command === '.tables') {
		print_result(execute_read_query(database, `
			SELECT name, type
			FROM sqlite_schema
			WHERE name NOT LIKE 'sqlite_%' AND type IN ('table', 'view')
			ORDER BY name
		`), mode);
		return mode;
	}
	if (command === '.schema' || command.startsWith('.schema ')) {
		const name = command.slice('.schema'.length).trim();
		const result = name.length === 0
			? execute_read_query(database, `
				SELECT name, type, sql
				FROM sqlite_schema
				WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
				ORDER BY type, name
			`)
			: {
				rows: database.query<Record<string, unknown>, [string]>(`
					SELECT name, type, sql
					FROM sqlite_schema
					WHERE name = ? AND sql IS NOT NULL
					ORDER BY type, name
				`).all(name),
				truncated: false
			};
		print_result(result, mode);
		return mode;
	}
	if (command === '.mode table')
		return 'table';
	if (command === '.mode json')
		return 'json';

	console.error(`Unknown command: ${command}. Use .help for available commands.`);
	return mode;
}

async function run_interactive(database: Database): Promise<void> {
	console.log('Connected to the live SQLite database in read-only mode. Use .help for commands.');
	const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
	let sql = '';
	let mode: OutputMode = 'table';
	process.stdout.write('pi-sql> ');

	for await (const line of lines) {
		const trimmed = line.trim();
		if (sql.length === 0 && trimmed.startsWith('.')) {
			const next_mode = run_dot_command(database, trimmed, mode);
			if (next_mode === null)
				break;
			mode = next_mode;
			process.stdout.write('pi-sql> ');
			continue;
		}

		if (sql.length === 0 && trimmed.length === 0) {
			process.stdout.write('pi-sql> ');
			continue;
		}

		sql += `${line}\n`;
		if (!trimmed.endsWith(';')) {
			process.stdout.write('   ...> ');
			continue;
		}

		try {
			print_result(execute_read_query(database, sql), mode);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
		}
		sql = '';
		process.stdout.write('pi-sql> ');
	}

	lines.close();
	if (sql.trim().length > 0)
		console.error('Discarded incomplete SQL statement; terminate statements with a semicolon.');
}

async function main(): Promise<number> {
	const database_path = process.env.DB_PATH;
	if (!database_path) {
		console.error('DB_PATH is required. Run this command through scripts/sql-pi.sh.');
		return 2;
	}

	const database = open_readonly_database(database_path);
	try {
		if (process.stdin.isTTY && process.stdout.isTTY) {
			await run_interactive(database);
			return 0;
		}

		const sql = (await Bun.stdin.text()).trim();
		if (sql.length === 0) {
			console.error('No SQL received on standard input.');
			return 2;
		}
		print_result(execute_read_query(database, sql), 'json');
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		database.close();
	}
}

if (import.meta.main)
	process.exitCode = await main();
