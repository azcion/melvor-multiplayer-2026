import { Database } from 'bun:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import {
	execute_read_query,
	format_json_result,
	MAX_RESULT_ROWS,
	open_readonly_database
} from '../../sql-console';

describe('SQL console', () => {
	test('returns query rows with a deterministic truncation marker', () => {
		const database = new Database(':memory:', { strict: true });
		database.run('CREATE TABLE sample (value INTEGER NOT NULL)');
		for (let value = 1; value <= MAX_RESULT_ROWS + 1; value++)
			database.query('INSERT INTO sample (value) VALUES (?)').run(value);

		const result = execute_read_query(database, 'SELECT value FROM sample ORDER BY value');
		expect(result.rows).toHaveLength(MAX_RESULT_ROWS);
		expect(result.rows[0]).toEqual({ value: 1 });
		expect(result.rows.at(-1)).toEqual({ value: MAX_RESULT_ROWS });
		expect(result.truncated).toBe(true);
		database.close();
	});

	test('formats batch results as structured JSON', () => {
		expect(format_json_result({ rows: [{ count: 3, value: 4n }], truncated: false })).toBe(`{
  "rows": [
    {
      "count": 3,
      "value": "4"
    }
  ],
  "truncated": false
}`);
	});

	test('opens the deployed database in query-only mode', () => {
		const root = mkdtempSync(join(tmpdir(), 'melvor-sql-console-'));
		const database_path = join(root, 'test.sqlite');
		const writable = new Database(database_path, { create: true, strict: true });
		writable.run('CREATE TABLE sample (value INTEGER NOT NULL)');
		writable.run('INSERT INTO sample (value) VALUES (1)');
		writable.close();

		const readonly = open_readonly_database(database_path);
		expect(execute_read_query(readonly, 'SELECT value FROM sample').rows).toEqual([{ value: 1 }]);
		expect(() => readonly.run('DELETE FROM sample')).toThrow();
		readonly.close();
	});
});
