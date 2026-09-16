import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations_091_100 } from '../../db/schema/migrations/091-100';

test('adds isolated Poll translation jobs and backfills existing questions and options', () => {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	database.run(`
		CREATE TABLE service_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		INSERT INTO service_settings VALUES ('poll_revision', '4');
		CREATE TABLE polls (id INTEGER PRIMARY KEY, content TEXT NOT NULL, created_at INTEGER NOT NULL, revision INTEGER NOT NULL);
		CREATE TABLE poll_options (
			id INTEGER PRIMARY KEY,
			poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
			content TEXT NOT NULL,
			created_at INTEGER NOT NULL
		);
		INSERT INTO polls VALUES (7, 'Existing question', 100, 4);
		INSERT INTO poll_options VALUES (11, 7, 'Existing option', 101);
	`);
	const migration = migrations_091_100.find(entry => entry.version === 94)!;
	expect(migration.foreign_keys_disabled).not.toBe(true);
	database.transaction(() => database.run(migration.sql)).immediate();

	expect(database.query('SELECT source_kind, content_id, content FROM poll_translation_jobs ORDER BY id').all()).toEqual([
		{ source_kind: 'poll', content_id: 7, content: 'Existing question' },
		{ source_kind: 'poll-option', content_id: 11, content: 'Existing option' }
	]);
	database.run("INSERT INTO poll_translations (job_id, language, content, translated_at) VALUES (1, 'zh-CN', '现有问题', 200)");
	expect(database.query('SELECT revision FROM polls WHERE id = 7').get()).toEqual({ revision: 5 });

	database.run("INSERT INTO polls VALUES (8, 'New question', 300, 6)");
	database.run("INSERT INTO poll_options VALUES (12, 8, 'New option', 301)");
	expect(database.query('SELECT COUNT(*) AS count FROM poll_translation_jobs').get()).toEqual({ count: 4 });
	database.run('DELETE FROM polls WHERE id = 7');
	expect(database.query('SELECT COUNT(*) AS count FROM poll_translation_jobs WHERE content_id IN (7, 11)').get())
		.toEqual({ count: 0 });
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});
