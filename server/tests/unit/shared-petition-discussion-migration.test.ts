import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

function apply(db: Database, migration: typeof migrations[number]) {
	if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
	try {
		db.transaction(() => {
			db.run(migration.sql);
			expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
			db.run(`PRAGMA user_version=${migration.version}`);
		}).immediate();
	} finally { db.run('PRAGMA foreign_keys=ON'); }
}

test('shared discussion upgrade preserves messages, read markers, reactions, moderation, translations and original audiences', () => {
	const db = new Database(':memory:');
	try {
		db.run('PRAGMA foreign_keys=ON');
		for (const migration of migrations.filter(m => m.version < 186)) apply(db,migration);
		db.exec(`INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id)
		 VALUES(900,'discussion-upgrade','key','900-000-000','Author','melvorD:Plant');
		 INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,proposed_name)
		 VALUES(900,1,'Guild','appellation','upgrade-name',900,100,1000,'New name');
		 INSERT INTO petition_discussion_messages(id,petition_id,sender_id,idempotency_key,content,created_at)
		 VALUES(900,900,900,'upgrade-reply','Keep this reply',120);
		 INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,proposed_name,show_creator,lifecycle,resolved_at)
		 VALUES(901,999999,'Dissolved Guild','appellation','retained-name',900,100,1000,'Old name',0,'denied',200);
		 INSERT INTO petition_discussion_messages(id,petition_id,sender_id,idempotency_key,content,created_at) VALUES(901,901,900,'retained-reply','Retained archive',130);
		 INSERT INTO petition_discussion_read_state VALUES(900,900,900);
		 INSERT INTO petition_discussion_message_reactions VALUES(900,900,'👍',130);
		 INSERT INTO petition_discussion_message_moderation VALUES(900,140);
		 INSERT INTO chat_message_translations SELECT id,'zh-CN','保留',150 FROM chat_translation_jobs WHERE source_kind='petition-discussion' AND message_id=900;
		 INSERT INTO chat_message_bodies(job_id,parts) SELECT id,'[{"type":"person","client_id":900,"display_name":"Author","icon_id":"melvorD:Plant"}]' FROM chat_translation_jobs WHERE source_kind='petition-discussion' AND message_id=900;
		 INSERT INTO alliance_processes(id,kind,initiator_guild_id,subject,created_at,expires_at) VALUES(900,'join',1,'upgrade-join',100,1000);
		 INSERT INTO alliance_process_petitions VALUES(900,900,'local');
		 INSERT INTO petition_discussion_messages(id,petition_id,sender_id,idempotency_key,content,created_at) VALUES(950,900,900,'removed-sequence','Removed',150);
		 DELETE FROM petition_discussion_messages WHERE id=950;`);
		const upgrade=migrations.find(m => m.version === 186)!;
		// A failed transaction must preserve the old schema/data and permit a subsequent retry.
		expect(() => apply(db,{ ...upgrade,sql:upgrade.sql+'SELECT * FROM missing_upgrade_table;' })).toThrow();
		expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys:1 });
		expect(db.query('PRAGMA user_version').get()).toEqual({ user_version:185 });
		apply(db,upgrade);
		expect(db.query('SELECT content FROM petition_discussion_messages WHERE id=900').get()).toEqual({content:'Keep this reply'});
		expect(db.query('SELECT * FROM petition_discussion_read_state WHERE client_id=900').get()).toEqual({petition_id:900,client_id:900,last_read_message_id:900});
		expect(db.query('SELECT reaction FROM petition_discussion_message_reactions').get()).toEqual({reaction:'👍'});
		expect(db.query('SELECT deleted_at FROM petition_discussion_message_moderation').get()).toEqual({deleted_at:140});
		expect(db.query("SELECT content FROM chat_message_translations WHERE content='保留'").get()).toEqual({content:'保留'});
		expect(db.query('SELECT parts FROM chat_message_bodies').all()).toHaveLength(1);
		expect(db.query('SELECT shared_discussion FROM alliance_processes WHERE id=900').get()).toEqual({shared_discussion:0});
		expect(db.query('SELECT process_id FROM petition_discussions WHERE id=900').get()).toEqual({process_id:null});
		expect(db.query('SELECT * FROM petition_discussion_guilds WHERE discussion_id=901').all()).toEqual([]);
		expect(db.query('SELECT content FROM petition_discussion_messages WHERE petition_id=901').get()).toEqual({content:'Retained archive'});
		db.run("INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,created_at) VALUES(900,900,'next-reply','Next',160)");
		expect(db.query<{id:number},[]>('SELECT MAX(id) id FROM petition_discussion_messages').get()!.id).toBeGreaterThan(950);
		expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally { db.close(); }
});
