import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

function apply(database: Database, migration: typeof migrations[number]) {
	if (migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys=OFF');
	try {
		database.transaction(() => {
			database.run(migration.sql);
			expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		}).immediate();
	} finally { database.run('PRAGMA foreign_keys=ON'); }
}

test('upgrade backfills only active petitions and preserves translation children and creator exclusions', () => {
	const database = new Database(':memory:');
	database.run('PRAGMA foreign_keys=ON');
	for (const migration of migrations.filter(m => m.version < 184)) apply(database, migration);
	database.exec(`INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id)
		VALUES(100,'petition-author','key','123-456-789','Author','melvorD:Plant'),
		(101,'petition-voter','key','123-456-788','Voter','melvorD:Plant');
		INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at,lifecycle,subject_locked,proposed_name,proposed_icon_id)
		VALUES(100,1,'Guild','appellation','guild:name',100,100,1000,'active',1,'New',NULL),
		(101,1,'Guild','heraldry','guild:icon',100,110,1000,'active',1,NULL,'melvorD:Plant'),
		(102,1,'Guild','appellation','old',100,10,20,'denied',0,'Old',NULL);
		INSERT INTO guild_petition_voters VALUES(100,101),(101,101),(102,101);
		INSERT INTO guild_petition_votes VALUES(100,101,'aye',120),(101,101,'nay',130),(102,101,'nay',15);
		INSERT INTO alliance_processes(id,kind,initiator_guild_id,subject,created_at,expires_at)
		VALUES(100,'join',1,'join:100',100,1000);
		INSERT INTO alliance_process_petitions VALUES(101,100,'local');
		INSERT INTO service_settings(key,value) VALUES('petition_discussion_hidden_processes','[100]');
		INSERT INTO chat_translation_jobs(id,source_kind,message_id,content,enqueued_at,available_at)
		VALUES(500,'guild',500,'Hello',100,100);
		INSERT INTO chat_translation_jobs(id,source_kind,message_id,content,enqueued_at,available_at) VALUES(600,'guild',600,'Removed',100,100);
		DELETE FROM chat_translation_jobs WHERE id=600;
		INSERT INTO chat_message_translations VALUES(500,'zh-CN','你好',150);
		INSERT INTO chat_message_bodies(job_id,parts) VALUES(500,'[{"type":"item","item_id":"melvorD:Logs"}]');`);
	expect(database.query('SELECT COUNT(*) AS count FROM guild_petition_votes').get()).toEqual({ count: 3 });
	apply(database, migrations.find(m => m.version === 184)!);
	expect(database.query('SELECT petition_id,sender_id,event_type,created_at FROM petition_discussion_messages ORDER BY id').all())
		.toEqual([{ petition_id: 100, sender_id: 100, event_type: 'proposal', created_at: 100 },
			{ petition_id: 100, sender_id: 101, event_type: 'aye', created_at: 120 },
			{ petition_id: 101, sender_id: 101, event_type: 'nay', created_at: 130 }]);
	expect(database.query('SELECT content FROM chat_message_translations WHERE job_id=500').get()).toEqual({ content: '你好' });
	expect(database.query('SELECT parts FROM chat_message_bodies WHERE job_id=500').get()).toEqual({ parts: '[{"type":"item","item_id":"melvorD:Logs"}]' });
	expect(database.query('SELECT show_creator FROM guild_petitions WHERE id=101').get()).toEqual({ show_creator: 0 });
	// A later ballot inherits suppression, including if its proposal row already materialized.
	database.run(`INSERT INTO guild_petitions(id,guild_id,guild_name,type,conflict_subject,petitioner_id,created_at,expires_at)
		VALUES(103,1,'Guild','alliance_ballot','alliance:100:member',100,140,1000);
		INSERT INTO alliance_process_petitions VALUES(103,100,'ballot');`);
	expect(database.query('SELECT show_creator FROM guild_petitions WHERE id=103').get()).toEqual({ show_creator: 0 });
	// System Messages are localized locally; only ordinary replies enqueue translation.
	database.run(`INSERT INTO petition_discussion_messages(petition_id,sender_id,idempotency_key,content,created_at)
		VALUES(100,101,'reply','Hello there',200);`);
	expect(database.query("SELECT content FROM chat_translation_jobs WHERE source_kind='petition-discussion'").all()).toEqual([{ content: 'Hello there' }]);
	expect(database.query<{id:number}, []>("SELECT id FROM chat_translation_jobs WHERE source_kind='petition-discussion'").get()!.id).toBeGreaterThan(600);
	expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	database.close();
});
