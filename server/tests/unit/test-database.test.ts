import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations } from '../../db/schema';
import { create_test_database } from '../support/database';

test('current-schema fixtures isolate mutations and enforce foreign keys', () => {
	const first = create_test_database();
	const second = create_test_database();
	try {
		first.run("UPDATE service_settings SET value = '1' WHERE key = 'maintenance'");
		first.run('CREATE TABLE fixture_only (id INTEGER)');
		expect(second.query("SELECT value FROM service_settings WHERE key = 'maintenance'").get())
			.toEqual({ value: '0' });
		expect(second.query("SELECT name FROM sqlite_schema WHERE name = 'fixture_only'").get()).toBeNull();
		expect(() => second.run("INSERT INTO client_sessions (session_token, client_id) VALUES ('orphan', 999)"))
			.toThrow('FOREIGN KEY constraint failed');
		expect(second.query('PRAGMA user_version').get()).toEqual({ user_version: migrations.at(-1)!.version });
	} finally {
		first.close();
		second.close();
	}
	const later = create_test_database();
	try {
		expect(later.query("SELECT name FROM sqlite_schema WHERE name = 'fixture_only'").get()).toBeNull();
	} finally {
		later.close();
	}
});

test('file fixtures persist across reopening without overwriting an existing database', () => {
	const directory = mkdtempSync(join(tmpdir(), 'melvor-fixture-test-'));
	const database_path = join(directory, 'fixture.sqlite');
	try {
		const database = create_test_database(database_path);
		try {
			database.run("UPDATE service_settings SET value = '1' WHERE key = 'maintenance'");
		} finally {
			database.close();
		}
		const reopened = new Database(database_path, { readonly: true, strict: true });
		try {
			expect(reopened.query("SELECT value FROM service_settings WHERE key = 'maintenance'").get())
				.toEqual({ value: '1' });
			expect(reopened.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
			expect(() => create_test_database(database_path)).toThrow();
			expect(reopened.query("SELECT value FROM service_settings WHERE key = 'maintenance'").get())
				.toEqual({ value: '1' });
		} finally {
			reopened.close();
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
