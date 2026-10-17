import type { Migration } from '../types';

export const browser_chat_identities_migration: Migration = {
	version: 191,
	sql: `
CREATE TABLE chat_browsers (
 id INTEGER PRIMARY KEY AUTOINCREMENT, token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 9007199254740991),
 revoked_at INTEGER CHECK (revoked_at BETWEEN 0 AND 9007199254740991)
);
ALTER TABLE chat_browser_sessions ADD COLUMN browser_id INTEGER REFERENCES chat_browsers(id);
INSERT INTO chat_browsers(token_hash,created_at,revoked_at)
 SELECT token_hash,created_at,revoked_at FROM chat_browser_sessions;
UPDATE chat_browser_sessions SET browser_id=(SELECT id FROM chat_browsers WHERE token_hash=chat_browser_sessions.token_hash);
CREATE INDEX chat_browser_sessions_browser ON chat_browser_sessions(browser_id);
CREATE UNIQUE INDEX chat_browser_sessions_browser_client ON chat_browser_sessions(browser_id,client_id) WHERE revoked_at IS NULL;
`
};
