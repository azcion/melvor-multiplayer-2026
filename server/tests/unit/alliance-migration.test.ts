import { expect,test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';
function apply(database:Database,migration:typeof migrations[number]) {
	if(migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys=OFF');
	try { database.transaction(()=> {
		database.run(migration.sql);
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	}).immediate(); } finally { database.run('PRAGMA foreign_keys=ON'); }
}
test('Alliance schema preserves legacy electorate, ballots, rule version and translation children',()=> {
	const database=new Database(':memory:');database.run('PRAGMA foreign_keys=ON');
	for(const migration of migrations.filter(m=>m.version<154)) apply(database,migration);
	database.run("INSERT INTO clients(client_identifier,client_key,friend_code,display_name,icon_id) VALUES('alliance-migration','key','123-456-789','Voter','melvorD:Plant')");
	const id=(database.query<{id:number},[]>('SELECT id FROM clients').get())!.id;
	database.query(`INSERT INTO guild_petitions(guild_id,guild_name,type,conflict_subject,petitioner_id,proposed_name,created_at,expires_at)
		VALUES(1,'Legacy','appellation','guild:name',?,'New',100,200)`).run(id);
	const petition=(database.query<{id:number},[]>('SELECT id FROM guild_petitions').get())!.id;
	database.query('INSERT INTO guild_petition_voters VALUES(?,?)').run(petition,id);
	database.query('INSERT INTO guild_petition_votes VALUES(?,?,?,?)').run(petition,id,'nay',150);
	database.run("INSERT INTO chat_translation_jobs(source_kind,message_id,content,enqueued_at,available_at) VALUES('guild',42,'Hello',100,100)");
	const job=(database.query<{id:number},[]>('SELECT id FROM chat_translation_jobs').get())!.id;
	database.query("INSERT INTO chat_message_translations VALUES(?,'zh-CN','你好',150)").run(job);
	for(const migration of migrations.filter(m=>m.version>=154)) apply(database,migration);
	expect(database.query('SELECT rule_version,expires_at FROM guild_petitions').all()).toEqual([{rule_version:1,expires_at:86400150}]);
	expect(database.query('SELECT choice FROM guild_petition_votes').all()).toEqual([{choice:'nay'}]);
	expect(database.query('SELECT * FROM guild_petition_voters').all()).toEqual([{petition_id:petition,client_id:id}]);
	expect(database.query('SELECT content FROM chat_message_translations').all()).toEqual([{content:'你好'}]);
	database.close();
});

test('parallel governance migration preserves existing pending and resolved processes',()=> {
	const database=new Database(':memory:'); database.run('PRAGMA foreign_keys=ON');
	for(const migration of migrations.filter(m=>m.version<164)) apply(database,migration);
	database.run(`INSERT INTO alliance_processes(kind,initiator_guild_id,name,subject,stage,created_at,expires_at,resolved_at)
		VALUES('found',1,'Pending','found:1','waiting',100,200,NULL),('found',2,'Accepted','found:2','accepted',100,200,150)`);
	apply(database,migrations.find(m=>m.version===164)!);
	expect(database.query('SELECT name,stage,governance_version,resolved_at,resolution_reason FROM alliance_processes ORDER BY id').all()).toEqual([
		{name:'Pending',stage:'waiting',governance_version:1,resolved_at:null,resolution_reason:null},
		{name:'Accepted',stage:'accepted',governance_version:1,resolved_at:150,resolution_reason:null}
	]);
	database.close();
});
