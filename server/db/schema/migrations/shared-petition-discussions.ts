import type { Migration } from '../types';

export const shared_petition_discussions_migration: Migration = {
	version: 186,
	foreign_keys_disabled: true,
	sql: `
ALTER TABLE alliance_processes ADD COLUMN shared_discussion INTEGER NOT NULL DEFAULT 0 CHECK(shared_discussion IN (0,1));
CREATE TABLE petition_discussions (
 id INTEGER PRIMARY KEY,
 process_id INTEGER UNIQUE REFERENCES alliance_processes(id),
 show_creator INTEGER NOT NULL DEFAULT 1 CHECK(show_creator IN (0,1)),
 closed_at INTEGER
);
CREATE TABLE petition_discussion_links (
 petition_id INTEGER PRIMARY KEY REFERENCES guild_petitions(id) ON DELETE CASCADE,
 discussion_id INTEGER NOT NULL REFERENCES petition_discussions(id) ON DELETE CASCADE
);
CREATE INDEX petition_discussion_link_scope ON petition_discussion_links(discussion_id);
CREATE TABLE petition_discussion_guilds (
 discussion_id INTEGER NOT NULL REFERENCES petition_discussions(id) ON DELETE CASCADE,
 guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
 PRIMARY KEY(discussion_id,guild_id)
);
CREATE INDEX petition_discussion_guild_scope ON petition_discussion_guilds(guild_id,discussion_id);
CREATE TABLE petition_discussion_voters (
 discussion_id INTEGER NOT NULL REFERENCES petition_discussions(id) ON DELETE CASCADE,
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 PRIMARY KEY(discussion_id,client_id)
);
INSERT INTO petition_discussions SELECT id,NULL,show_creator,CASE WHEN lifecycle='active' THEN NULL ELSE COALESCE(resolved_at,created_at) END FROM guild_petitions;
INSERT INTO petition_discussion_links SELECT id,id FROM guild_petitions;
INSERT INTO petition_discussion_guilds SELECT p.id,p.guild_id FROM guild_petitions p JOIN guilds g ON g.id=p.guild_id;
INSERT INTO petition_discussion_voters SELECT petition_id,client_id FROM guild_petition_votes;

DROP TRIGGER petition_discussion_proposal;
DROP TRIGGER petition_discussion_vote;
DROP TRIGGER petition_discussion_inherit_creator;
DROP TRIGGER event_petition_discussion_insert;
DROP TRIGGER event_petition_discussion_moderation;
DROP TRIGGER enqueue_petition_discussion_translation;
DROP TRIGGER delete_petition_discussion_translation;
CREATE TEMP TABLE petition_message_sequence AS SELECT seq FROM sqlite_sequence WHERE name='petition_discussion_messages';
CREATE TABLE petition_discussion_messages_next (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 petition_id INTEGER NOT NULL REFERENCES petition_discussions(id) ON DELETE CASCADE,
 sender_id INTEGER NOT NULL REFERENCES clients(id),
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 128),
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 1000),
 event_type TEXT CHECK(event_type IN ('proposal','aye','nay')),
 created_at INTEGER NOT NULL CHECK(created_at BETWEEN 0 AND 9007199254740991),
 shadow_hidden INTEGER NOT NULL DEFAULT 0 CHECK(shadow_hidden IN (0,1)),
 reaction_revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(sender_id,idempotency_key)
);
INSERT INTO petition_discussion_messages_next SELECT id,petition_id,sender_id,idempotency_key,content,event_type,created_at,shadow_hidden,reaction_revision FROM petition_discussion_messages;
DROP TABLE petition_discussion_messages;
ALTER TABLE petition_discussion_messages_next RENAME TO petition_discussion_messages;
INSERT INTO sqlite_sequence(name,seq) SELECT 'petition_discussion_messages',seq FROM petition_message_sequence WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='petition_discussion_messages');
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM petition_message_sequence),0)) WHERE name='petition_discussion_messages';
DROP TABLE petition_message_sequence;
CREATE INDEX petition_discussion_history ON petition_discussion_messages(petition_id,id);
CREATE TABLE petition_discussion_read_state_next (
 petition_id INTEGER NOT NULL REFERENCES petition_discussions(id) ON DELETE CASCADE,
 client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 last_read_message_id INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(petition_id,client_id)
);
INSERT INTO petition_discussion_read_state_next SELECT petition_id,client_id,last_read_message_id FROM petition_discussion_read_state;
DROP TABLE petition_discussion_read_state;
ALTER TABLE petition_discussion_read_state_next RENAME TO petition_discussion_read_state;
INSERT OR IGNORE INTO petition_discussion_read_state
 SELECT d.id,m.client_id,CASE WHEN d.closed_at IS NULL THEN 0 ELSE COALESCE((SELECT MAX(id) FROM petition_discussion_messages WHERE petition_id=d.id),0) END
 FROM petition_discussions d JOIN petition_discussion_guilds g ON g.discussion_id=d.id JOIN guild_memberships m ON m.guild_id=g.guild_id;

CREATE TRIGGER petition_discussion_proposal AFTER INSERT ON guild_petitions BEGIN
 INSERT INTO petition_discussions VALUES(NEW.id,NULL,NEW.show_creator,CASE WHEN NEW.lifecycle='active' THEN NULL ELSE COALESCE(NEW.resolved_at,NEW.created_at) END);
 INSERT INTO petition_discussion_links VALUES(NEW.id,NEW.id);
 INSERT INTO petition_discussion_guilds SELECT NEW.id,id FROM guilds WHERE id=NEW.guild_id;
 INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,event_type,created_at)
 SELECT NEW.id,NEW.petitioner_id,'proposal:'||NEW.id,'I propose this petition.','proposal',NEW.created_at WHERE NEW.show_creator=1;
END;
CREATE TRIGGER petition_discussion_vote AFTER INSERT ON guild_petition_votes BEGIN
 INSERT OR IGNORE INTO petition_discussion_voters SELECT discussion_id,NEW.client_id FROM petition_discussion_links WHERE petition_id=NEW.petition_id;
 INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,event_type,created_at)
 SELECT discussion_id,NEW.client_id,'vote:'||NEW.petition_id,NEW.choice,NEW.choice,NEW.submitted_at FROM petition_discussion_links WHERE petition_id=NEW.petition_id;
END;
CREATE TRIGGER petition_discussion_inherit_creator AFTER INSERT ON alliance_process_petitions BEGIN
 UPDATE guild_petitions SET show_creator=0 WHERE id=NEW.petition_id AND (
 EXISTS(SELECT 1 FROM alliance_process_petitions l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.process_id=NEW.process_id AND p.show_creator=0)
 OR NEW.process_id IN (SELECT value FROM json_each(COALESCE((SELECT value FROM service_settings WHERE key='petition_discussion_hidden_processes'),'[]'))));
 -- Only new processes share a discussion. No existing history changes audience.
 UPDATE petition_discussions SET process_id=NEW.process_id WHERE id=NEW.petition_id
 AND (SELECT shared_discussion FROM alliance_processes WHERE id=NEW.process_id)=1
 AND NOT EXISTS(SELECT 1 FROM petition_discussions WHERE process_id=NEW.process_id);
 UPDATE petition_discussion_links SET discussion_id=(SELECT id FROM petition_discussions WHERE process_id=NEW.process_id)
 WHERE petition_id=NEW.petition_id AND EXISTS(SELECT 1 FROM petition_discussions WHERE process_id=NEW.process_id);
 DELETE FROM petition_discussions WHERE id=NEW.petition_id AND process_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM petition_discussion_links WHERE discussion_id=NEW.petition_id);
 INSERT OR IGNORE INTO petition_discussion_guilds
 SELECT d.id,g.id FROM petition_discussions d JOIN alliance_processes p ON p.id=d.process_id JOIN guilds g
 ON g.id=p.initiator_guild_id OR (p.kind='found' AND g.id=p.target_guild_id)
 OR EXISTS(SELECT 1 FROM alliance_memberships am WHERE am.alliance_id=p.alliance_id AND am.guild_id=g.id)
 WHERE p.id=NEW.process_id AND d.closed_at IS NULL;
 UPDATE petition_discussions SET show_creator=0 WHERE process_id=NEW.process_id
 AND EXISTS(SELECT 1 FROM alliance_process_petitions l JOIN guild_petitions p ON p.id=l.petition_id WHERE l.process_id=NEW.process_id AND p.show_creator=0);
END;
CREATE TRIGGER petition_discussion_creator_change AFTER UPDATE OF show_creator ON guild_petitions BEGIN
 UPDATE petition_discussions SET show_creator=NEW.show_creator WHERE id IN (SELECT discussion_id FROM petition_discussion_links WHERE petition_id=NEW.id);
END;
CREATE TRIGGER petition_discussion_close AFTER UPDATE OF lifecycle ON guild_petitions WHEN NEW.lifecycle!='active' BEGIN
 UPDATE petition_discussions SET closed_at=COALESCE(NEW.resolved_at,NEW.created_at) WHERE id IN (SELECT discussion_id FROM petition_discussion_links WHERE petition_id=NEW.id) AND process_id IS NULL;
END;
CREATE TRIGGER petition_discussion_process_close AFTER UPDATE OF stage ON alliance_processes
 WHEN NEW.stage NOT IN ('local','waiting','recipient','collective') BEGIN
 UPDATE petition_discussions SET closed_at=COALESCE(NEW.resolved_at,NEW.created_at) WHERE process_id=NEW.id AND closed_at IS NULL;
END;
CREATE TRIGGER petition_discussion_petition_delete AFTER DELETE ON guild_petitions BEGIN
 DELETE FROM petition_discussions WHERE id=OLD.id AND process_id IS NULL;
END;
CREATE TRIGGER petition_discussion_alliance_join AFTER INSERT ON alliance_memberships BEGIN
 INSERT OR IGNORE INTO petition_discussion_guilds SELECT d.id,NEW.guild_id FROM petition_discussions d JOIN alliance_processes p ON p.id=d.process_id WHERE p.alliance_id=NEW.alliance_id AND d.closed_at IS NULL;
END;
CREATE TRIGGER petition_discussion_alliance_leave AFTER DELETE ON alliance_memberships BEGIN
 DELETE FROM petition_discussion_guilds WHERE guild_id=OLD.guild_id AND discussion_id IN (SELECT d.id FROM petition_discussions d JOIN alliance_processes p ON p.id=d.process_id WHERE p.alliance_id=OLD.alliance_id AND d.closed_at IS NULL);
END;
CREATE TRIGGER petition_discussion_participant_add AFTER INSERT ON petition_discussion_guilds BEGIN
 INSERT OR IGNORE INTO petition_discussion_read_state SELECT NEW.discussion_id,m.client_id,0 FROM guild_memberships m WHERE m.guild_id=NEW.guild_id;
END;
CREATE TRIGGER petition_discussion_participant_remove AFTER DELETE ON petition_discussion_guilds BEGIN
 DELETE FROM petition_discussion_read_state WHERE petition_id=OLD.discussion_id AND client_id IN (SELECT client_id FROM guild_memberships WHERE guild_id=OLD.guild_id);
END;
CREATE TRIGGER petition_discussion_member_join AFTER INSERT ON guild_memberships BEGIN
 INSERT OR IGNORE INTO petition_discussion_read_state SELECT d.id,NEW.client_id,CASE WHEN d.closed_at IS NULL THEN 0 ELSE COALESCE((SELECT MAX(id) FROM petition_discussion_messages WHERE petition_id=d.id),0) END FROM petition_discussions d JOIN petition_discussion_guilds g ON g.discussion_id=d.id WHERE g.guild_id=NEW.guild_id;
END;
CREATE TRIGGER petition_discussion_member_leave AFTER DELETE ON guild_memberships BEGIN
 DELETE FROM petition_discussion_read_state WHERE client_id=OLD.client_id AND petition_id IN (SELECT discussion_id FROM petition_discussion_guilds WHERE guild_id=OLD.guild_id);
END;
CREATE TRIGGER event_petition_discussion_insert AFTER INSERT ON petition_discussion_messages BEGIN
 UPDATE clients SET event_revision=event_revision+1 WHERE id IN (SELECT m.client_id FROM guild_memberships m JOIN petition_discussion_guilds g ON g.guild_id=m.guild_id WHERE g.discussion_id=NEW.petition_id);
END;
CREATE TRIGGER event_petition_discussion_moderation AFTER INSERT ON petition_discussion_message_moderation BEGIN
 UPDATE clients SET event_revision=event_revision+1 WHERE id IN (SELECT m.client_id FROM guild_memberships m JOIN petition_discussion_guilds g ON g.guild_id=m.guild_id JOIN petition_discussion_messages msg ON msg.petition_id=g.discussion_id WHERE msg.id=NEW.message_id);
END;
CREATE TRIGGER enqueue_petition_discussion_translation AFTER INSERT ON petition_discussion_messages WHEN NEW.event_type IS NULL BEGIN
 INSERT INTO chat_translation_jobs(source_kind,message_id,content,enqueued_at,available_at) VALUES('petition-discussion',NEW.id,NEW.content,NEW.created_at,NEW.created_at);
END;
CREATE TRIGGER delete_petition_discussion_translation AFTER DELETE ON petition_discussion_messages BEGIN
 DELETE FROM chat_translation_jobs WHERE source_kind='petition-discussion' AND message_id=OLD.id;
END;
`
};
