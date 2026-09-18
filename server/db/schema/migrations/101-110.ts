import type { Migration } from '../types';

export const migrations_101_110: Migration[] = [{
	version: 101,
	sql: `
		CREATE TABLE update_section_translations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			section_id TEXT NOT NULL REFERENCES update_sections (id) ON DELETE CASCADE,
			field TEXT NOT NULL CHECK (field IN ('title', 'body')),
			language TEXT NOT NULL CHECK (length(language) BETWEEN 2 AND 64),
			source_content TEXT NOT NULL CHECK (length(trim(source_content)) BETWEEN 1 AND 8192),
			content TEXT CHECK (content IS NULL OR length(trim(content)) BETWEEN 1 AND 8192),
			detected_language TEXT,
			state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'complete', 'dead')),
			attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
			enqueued_at INTEGER NOT NULL CHECK (enqueued_at BETWEEN 0 AND 9007199254740991),
			available_at INTEGER NOT NULL CHECK (available_at BETWEEN 0 AND 9007199254740991),
			last_attempt_at INTEGER CHECK (last_attempt_at BETWEEN 0 AND 9007199254740991),
			completed_at INTEGER CHECK (completed_at BETWEEN 0 AND 9007199254740991),
			last_error_code TEXT,
			UNIQUE (section_id, field, language)
		);
		CREATE INDEX idx_update_section_translations_queue
			ON update_section_translations (state, available_at, enqueued_at, id);

		INSERT INTO update_section_translations
			(section_id, field, language, source_content, enqueued_at, available_at)
		SELECT id, 'title', 'zh-CN', title, CAST(strftime('%s', 'now') AS INTEGER) * 1000,
			CAST(strftime('%s', 'now') AS INTEGER) * 1000
		FROM update_sections
		UNION ALL
		SELECT id, 'body', 'zh-CN', body, CAST(strftime('%s', 'now') AS INTEGER) * 1000,
			CAST(strftime('%s', 'now') AS INTEGER) * 1000
		FROM update_sections;

		CREATE TRIGGER enqueue_update_section_title_translation
		AFTER UPDATE OF title ON update_sections
		WHEN NEW.title IS NOT OLD.title
		BEGIN
			INSERT INTO update_section_translations
				(section_id, field, language, source_content, enqueued_at, available_at)
			VALUES (NEW.id, 'title', 'zh-CN', NEW.title, CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				CAST(strftime('%s', 'now') AS INTEGER) * 1000)
			ON CONFLICT (section_id, field, language) DO UPDATE SET
				source_content = excluded.source_content,
				content = NULL,
				detected_language = NULL,
				state = 'queued',
				attempts = 0,
				enqueued_at = excluded.enqueued_at,
				available_at = excluded.available_at,
				last_attempt_at = NULL,
				completed_at = NULL,
				last_error_code = NULL;
		END;

		CREATE TRIGGER enqueue_update_section_body_translation
		AFTER UPDATE OF body ON update_sections
		WHEN NEW.body IS NOT OLD.body
		BEGIN
			INSERT INTO update_section_translations
				(section_id, field, language, source_content, enqueued_at, available_at)
			VALUES (NEW.id, 'body', 'zh-CN', NEW.body, CAST(strftime('%s', 'now') AS INTEGER) * 1000,
				CAST(strftime('%s', 'now') AS INTEGER) * 1000)
			ON CONFLICT (section_id, field, language) DO UPDATE SET
				source_content = excluded.source_content,
				content = NULL,
				detected_language = NULL,
				state = 'queued',
				attempts = 0,
				enqueued_at = excluded.enqueued_at,
				available_at = excluded.available_at,
				last_attempt_at = NULL,
				completed_at = NULL,
				last_error_code = NULL;
		END;
	`
}];
