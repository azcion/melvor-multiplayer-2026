import { Database } from 'bun:sqlite';
import { writeFileSync } from 'node:fs';
import { migrations } from '../../db/schema';

let schema_snapshot: Uint8Array | undefined;

// Ordinary service tests need isolated current schemas, not a migration replay
// for every case. Migration tests continue constructing their historical schemas.
function current_schema(): Uint8Array {
	if (schema_snapshot !== undefined)
		return schema_snapshot;
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	try {
		for (const migration of migrations) {
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = OFF');
			try {
				database.transaction(() => {
					if (migration.preflight_sql) {
						const result = database.query<{ problems: number }, []>(migration.preflight_sql).get();
						if (result?.problems !== 0)
							throw new Error(`Fixture migration ${migration.version} failed preflight`);
					}
					database.run(migration.sql);
					if (migration.foreign_keys_disabled && database.query('PRAGMA foreign_key_check').all().length > 0)
						throw new Error(`Fixture migration ${migration.version} introduced foreign-key violations`);
					database.run(`PRAGMA user_version = ${migration.version}`);
				}).immediate();
			} finally {
				if (migration.foreign_keys_disabled)
					database.run('PRAGMA foreign_keys = ON');
			}
		}
		schema_snapshot = database.serialize();
		return schema_snapshot;
	} finally {
		database.close();
	}
}

export function create_test_database(database_path = ':memory:'): Database {
	const snapshot = current_schema();
	let database: Database;
	if (database_path === ':memory:') {
		database = Database.deserialize(snapshot, { strict: true });
	} else {
		writeFileSync(database_path, snapshot, { flag: 'wx' });
		database = new Database(database_path, { strict: true });
	}
	database.run('PRAGMA foreign_keys = ON');
	return database;
}
