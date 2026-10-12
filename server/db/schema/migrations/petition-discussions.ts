import type { Migration } from '../types';

export const petition_discussions_migration: Migration = {
	version: 184,
	foreign_keys_disabled: true,
	sql: `DROP TRIGGER correct_support_chat_translation;
DROP TRIGGER enqueue_private_chat_translation;
DROP TRIGGER enqueue_guild_chat_translation;
DROP TRIGGER enqueue_global_chat_translation;
DROP TRIGGER enqueue_support_chat_translation;
DROP TRIGGER enqueue_poll_discussion_translation;
DROP TRIGGER delete_private_chat_translation;
DROP TRIGGER delete_guild_chat_translation;
DROP TRIGGER delete_global_chat_translation;
DROP TRIGGER delete_support_chat_translation;
DROP TRIGGER delete_poll_discussion_translation;
DROP TRIGGER enqueue_alliance_chat_translation;
DROP TRIGGER delete_alliance_chat_translation;
CREATE TEMP TABLE petition_translation_sequence AS SELECT seq FROM sqlite_sequence WHERE name='chat_translation_jobs';
CREATE TABLE chat_translation_jobs_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				source_kind TEXT NOT NULL CHECK (
					source_kind IN ('private', 'alliance', 'guild', 'global', 'support', 'poll-discussion', 'petition-discussion')
				),
				message_id INTEGER NOT NULL CHECK (message_id > 0),
				content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 1000),
				detected_language TEXT,
				state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'processing', 'complete', 'dead')),
				attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4),
				enqueued_at INTEGER NOT NULL CHECK (enqueued_at BETWEEN 0 AND 9007199254740991),
				available_at INTEGER NOT NULL CHECK (available_at BETWEEN 0 AND 9007199254740991),
				last_attempt_at INTEGER CHECK (last_attempt_at BETWEEN 0 AND 9007199254740991),
				completed_at INTEGER CHECK (completed_at BETWEEN 0 AND 9007199254740991),
				last_error_code TEXT,
				UNIQUE (source_kind, message_id)
			);
			INSERT INTO chat_translation_jobs_new(id,source_kind,message_id,content,detected_language,state,attempts,enqueued_at,available_at,last_attempt_at,completed_at,last_error_code) SELECT id,source_kind,message_id,content,detected_language,state,attempts,enqueued_at,available_at,last_attempt_at,completed_at,last_error_code FROM chat_translation_jobs;
DROP TABLE chat_translation_jobs;
ALTER TABLE chat_translation_jobs_new RENAME TO chat_translation_jobs;
INSERT INTO sqlite_sequence(name,seq) SELECT 'chat_translation_jobs',seq FROM petition_translation_sequence
WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='chat_translation_jobs');
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM petition_translation_sequence),0)) WHERE name='chat_translation_jobs';
DROP TABLE petition_translation_sequence;
CREATE INDEX idx_chat_translation_jobs_fifo ON chat_translation_jobs(state,id,available_at);
CREATE TRIGGER enqueue_alliance_chat_translation AFTER INSERT ON alliance_chat_messages BEGIN
 INSERT INTO chat_translation_jobs(source_kind,message_id,content,enqueued_at,available_at) VALUES('alliance',NEW.id,NEW.content,NEW.created_at,NEW.created_at); END;
 CREATE TRIGGER delete_alliance_chat_translation AFTER DELETE ON alliance_chat_messages BEGIN DELETE FROM chat_translation_jobs WHERE source_kind='alliance' AND message_id=OLD.id; END;

CREATE TRIGGER correct_support_chat_translation AFTER UPDATE OF content ON support_messages
		WHEN OLD.content <> NEW.content BEGIN
			DELETE FROM chat_translation_jobs WHERE source_kind = 'support' AND message_id = NEW.id;
			INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
			VALUES ('support', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
		END;
CREATE TRIGGER enqueue_private_chat_translation AFTER INSERT ON chat_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('private', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_guild_chat_translation AFTER INSERT ON guild_chat_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('guild', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_global_chat_translation AFTER INSERT ON global_chat_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('global', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_support_chat_translation AFTER INSERT ON support_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('support', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER enqueue_poll_discussion_translation AFTER INSERT ON poll_discussion_messages BEGIN
				INSERT INTO chat_translation_jobs (source_kind, message_id, content, enqueued_at, available_at)
				VALUES ('poll-discussion', NEW.id, NEW.content, NEW.created_at, NEW.created_at);
			END;
CREATE TRIGGER delete_private_chat_translation AFTER DELETE ON chat_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'private' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_guild_chat_translation AFTER DELETE ON guild_chat_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'guild' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_global_chat_translation AFTER DELETE ON global_chat_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'global' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_support_chat_translation AFTER DELETE ON support_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'support' AND message_id = OLD.id;
			END;
CREATE TRIGGER delete_poll_discussion_translation AFTER DELETE ON poll_discussion_messages BEGIN
				DELETE FROM chat_translation_jobs WHERE source_kind = 'poll-discussion' AND message_id = OLD.id;
			END;
ALTER TABLE guild_petitions ADD COLUMN show_creator INTEGER NOT NULL DEFAULT 1 CHECK(show_creator IN (0,1));
CREATE TABLE petition_discussion_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 petition_id INTEGER NOT NULL REFERENCES guild_petitions(id) ON DELETE CASCADE,
 sender_id INTEGER NOT NULL REFERENCES clients(id),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 1000),
 event_type TEXT CHECK(event_type IN ('proposal','aye','nay')),
 created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
 shadow_hidden INTEGER NOT NULL DEFAULT 0 CHECK(shadow_hidden IN (0,1)),
 reaction_revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(sender_id,idempotency_key)
);
CREATE INDEX petition_discussion_history ON petition_discussion_messages(petition_id,id);
CREATE TABLE petition_discussion_read_state (
 petition_id INTEGER NOT NULL REFERENCES guild_petitions(id) ON DELETE CASCADE,
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 last_read_message_id INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(petition_id,client_id)
);
CREATE TABLE petition_discussion_message_reactions (
 message_id INTEGER NOT NULL REFERENCES petition_discussion_messages(id) ON DELETE CASCADE,
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 reaction TEXT NOT NULL CHECK(length(reaction) BETWEEN 1 AND 32),
 created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(message_id,client_id,reaction)
);
CREATE TABLE petition_discussion_message_moderation (
 message_id INTEGER PRIMARY KEY REFERENCES petition_discussion_messages(id) ON DELETE CASCADE,
 deleted_at INTEGER NOT NULL CHECK(deleted_at>=0)
);
-- A host may stage numeric process IDs in this setting before the first upgrade.
-- Apply exclusions before any author Messages are backfilled.
UPDATE guild_petitions SET show_creator=0 WHERE id IN (
 SELECT petition_id FROM alliance_process_petitions WHERE process_id IN (
  SELECT value FROM json_each(COALESCE((SELECT value FROM service_settings
   WHERE key='petition_discussion_hidden_processes'),'[]'))
 )
);
INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,event_type,created_at)
 SELECT id,petitioner_id,'proposal:'||id,'I propose this petition.','proposal',created_at
 FROM guild_petitions WHERE lifecycle='active' AND show_creator=1 ORDER BY created_at,id;
INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,event_type,created_at)
 SELECT v.petition_id,v.client_id,'vote:'||v.petition_id,v.choice,v.choice,v.submitted_at
 FROM guild_petition_votes v JOIN guild_petitions p ON p.id=v.petition_id
 WHERE p.lifecycle='active' ORDER BY v.submitted_at,v.petition_id,v.client_id;
CREATE TRIGGER petition_discussion_proposal AFTER INSERT ON guild_petitions WHEN NEW.show_creator=1 BEGIN
 INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,event_type,created_at)
 VALUES(NEW.id,NEW.petitioner_id,'proposal:'||NEW.id,'I propose this petition.','proposal',NEW.created_at);
END;
CREATE TRIGGER petition_discussion_vote AFTER INSERT ON guild_petition_votes BEGIN
 INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,event_type,created_at)
 VALUES(NEW.petition_id,NEW.client_id,'vote:'||NEW.petition_id,NEW.choice,NEW.choice,NEW.submitted_at);
END;
CREATE TRIGGER petition_discussion_inherit_creator AFTER INSERT ON alliance_process_petitions BEGIN
 UPDATE guild_petitions SET show_creator=0 WHERE id=NEW.petition_id AND (
  EXISTS(SELECT 1 FROM alliance_process_petitions l JOIN guild_petitions p ON p.id=l.petition_id
   WHERE l.process_id=NEW.process_id AND p.show_creator=0)
  OR NEW.process_id IN (SELECT value FROM json_each(COALESCE((SELECT value FROM service_settings
   WHERE key='petition_discussion_hidden_processes'),'[]')))
 );
END;
CREATE TRIGGER event_petition_discussion_insert AFTER INSERT ON petition_discussion_messages BEGIN
 UPDATE clients SET event_revision=event_revision+1 WHERE id IN (
  SELECT m.client_id FROM guild_memberships m JOIN guild_petitions p ON p.guild_id=m.guild_id WHERE p.id=NEW.petition_id);
END;
CREATE TRIGGER event_petition_discussion_moderation AFTER INSERT ON petition_discussion_message_moderation BEGIN
 UPDATE clients SET event_revision=event_revision+1 WHERE id IN (
  SELECT m.client_id FROM guild_memberships m JOIN guild_petitions p ON p.guild_id=m.guild_id
  JOIN petition_discussion_messages msg ON msg.petition_id=p.id WHERE msg.id=NEW.message_id);
END;
CREATE TRIGGER enqueue_petition_discussion_translation AFTER INSERT ON petition_discussion_messages WHEN NEW.event_type IS NULL BEGIN
 INSERT INTO chat_translation_jobs(source_kind,message_id,content,enqueued_at,available_at)
 VALUES('petition-discussion',NEW.id,NEW.content,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER delete_petition_discussion_translation AFTER DELETE ON petition_discussion_messages BEGIN
 DELETE FROM chat_translation_jobs WHERE source_kind='petition-discussion' AND message_id=OLD.id;
END;
`
};
