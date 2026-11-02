import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { migrations } from '../../db/schema';
import { COMBAT_SKILLS, AVAILABLE_COMBAT_SKILLS, grant_combat_resets, combat_reset_balance, combat_character, combat_loadout, level_price, prepare_combat, purchase_combat_levels, reset_combat_levels } from '../../combat-progression';
import { ep_balance } from '../../wish-capacity';

// Single-skill fixture shorthand exercises the same batch command as Confirm all.
function purchase_combat_level(database: Database, client: number, command: string, skill: unknown, revision: unknown, quantity: unknown) {
	const result = purchase_combat_levels(database, client, command, { [String(skill)]: quantity }, revision);
	return { ...result, level: result.success ? result.levels?.[skill as typeof COMBAT_SKILLS[number]] : undefined };
}

function client(database: Database) {
	database.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(101,'combat-progression','key','111-222-333','Progression','melvorD:Plant')");
	if (database.query("SELECT 1 FROM sqlite_master WHERE name='combat_unlocks'").get()) database.query('INSERT INTO combat_unlocks(client_id,skill_caps_json) VALUES(101,?)').run(JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}));
	database.run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(101,10000000000)');
}
function fixture() {
	const database = create_test_database(); client(database); prepare_combat(database,101); database.run('UPDATE combat_tutorial SET victories=7 WHERE client_id=101'); database.run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=101'); return database;
}
function buy(database: Database, skill: string) {
	return database.transaction(() => purchase_combat_level(database,101,crypto.randomUUID(),skill,combat_character(database,101)!.revision,1)).immediate();
}

test('every skill starts independently at 1; each target decade has the agreed price through 99', () => {
	const database=fixture(); try {
		expect(combat_character(database,101)!.max_hp).toBe(10);
		for(const skill of COMBAT_SKILLS) expect(combat_character(database,101)!.levels[skill]).toBe(1);
		for(const skill of AVAILABLE_COMBAT_SKILLS) {
			const before=ep_balance(database,101);
			for(let target=2;target<=99;target++) {
				const price=(Math.floor(target/10)+1)*1_000_000;
				expect(level_price(target)).toBe(price);
				expect(buy(database,skill)).toMatchObject({success:true,level:target,paid_micros:price});
			}
			expect(before-ep_balance(database,101)).toBe(548_000_000);
			expect(buy(database,skill)).toMatchObject({success:false,error:'max_level'});
		}
		expect(combat_character(database,101)!.invested_micros).toBe(2_192_000_000);
		expect(combat_loadout(database,101)!.gear).toEqual({});
		expect(combat_character(database,101)!.max_hp).toBe(990);
		for(const invalid of [1,100,NaN,Infinity,1.5]) expect(()=>level_price(invalid)).toThrow();
	} finally {database.close();}
});

test('stale revisions, insufficient EP and invalid skills leave levels and funds unchanged', () => {
	const database=fixture(); try {
		expect(buy(database,'defence').success).toBe(true);
		const before=combat_character(database,101), balance=ep_balance(database,101);
		expect(purchase_combat_level(database,101,'stale','attack',0,1)).toMatchObject({success:false,error:'quote_changed'});
		for(const invalid of ['prayer','client_id','attack=99',null]) expect(purchase_combat_level(database,101,'bad',invalid,1,1).success).toBe(false);
		expect(combat_character(database,101)).toEqual(before); expect(ep_balance(database,101)).toBe(balance);
		database.run('UPDATE expedition_ep_balances SET points_micros=999999');
		expect(buy(database,'attack')).toMatchObject({success:false,error:'insufficient_ep'});
		expect(combat_character(database,101)).toEqual(before);
		expect(database.query('SELECT COUNT(*) AS n FROM combat_ep_ledger').get()).toEqual({n:1});
	} finally {database.close();}
});

test('all-level reset refunds exactly 90%, charges no further EP, and never changes Wish payments', () => {
	const database=fixture(); try {
		buy(database,'attack');buy(database,'hitpoints');buy(database,'strength');
		const before=ep_balance(database,101), revision=combat_character(database,101)!.revision;
		const result=database.transaction(()=>reset_combat_levels(database,101,'reset',revision)).immediate();
		expect(result).toEqual({success:true,refunded_micros:2_700_000,fee_micros:300_000});
		expect(ep_balance(database,101)).toBe(before+2_700_000);
		for(const skill of COMBAT_SKILLS) expect(combat_character(database,101)!.levels[skill]).toBe(1);
		expect(combat_character(database,101)!.invested_micros).toBe(0);
		expect(reset_combat_levels(database,101,'old-reset',revision).success).toBe(false);
		expect(database.query('SELECT COUNT(*) AS n FROM wish_ep_spends').get()).toEqual({n:0});
		buy(database,'attack');
		expect(combat_character(database,101)!.invested_micros).toBe(1_000_000);
	} finally {database.close();}
});

test('reset excludes only equipment that no longer meets its level requirement', () => {
	const database=fixture(); try {
		const bought = database.transaction(()=>purchase_combat_levels(database,101,'levels',{defence:4},combat_character(database,101)!.revision)).immediate();
		expect(bought.success).toBe(true);
		for (const [slot,item] of [['Weapon','melvorD:Bronze_Dagger'],['Gloves','melvorD:Steel_Gloves']] as const) {
			database.query('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,?,0,1)').run(101,item,'{}');
			database.query('INSERT INTO combat_equipment_slots(client_id,slot,tier,equipped_item) VALUES(?,?,1,?)').run(101,slot,item);
		}
		expect(combat_loadout(database,101)!.gear).toEqual({Weapon:'melvorD:Bronze_Dagger',Gloves:'melvorD:Steel_Gloves'});
		const reset = database.transaction(()=>reset_combat_levels(database,101,'reset-gear',combat_character(database,101)!.revision)).immediate();
		expect(reset.success).toBe(true);
		expect(combat_loadout(database,101)!.gear).toEqual({Weapon:'melvorD:Bronze_Dagger'});
	} finally {database.close();}
});

test('active encounters freeze upgrades and reset; transaction rollback restores EP and levels', () => {
	const database=fixture(); try {
		buy(database,'attack');
		database.query("INSERT INTO combat_encounters(id,client_id,controller,food_id,used,status,registration_json,created_at) VALUES('fight',101,'controller','melvorD:Shrimp',0,'active','{}',0)").run();
		expect(buy(database,'attack')).toMatchObject({success:false,error:'active'});
		expect(reset_combat_levels(database,101,'reset',1)).toMatchObject({success:false,error:'active'});
		database.run('DELETE FROM combat_encounters');
		const before=ep_balance(database,101);
		expect(()=>database.transaction(()=>{buy(database,'strength');throw new Error('abort');}).immediate()).toThrow('abort');
		expect(ep_balance(database,101)).toBe(before);expect(combat_character(database,101)!.levels.strength).toBe(1);
	} finally {database.close();}
});

test('progression migration drops only native registration and preserves every shared table byte-for-byte', () => {
	const database=new Database(':memory:',{strict:true});
	try {
		for(const migration of migrations.filter(m=>m.version<197)) {
			if(migration.foreign_keys_disabled) database.run('PRAGMA foreign_keys=OFF');
			database.transaction(()=>database.run(migration.sql)).immediate();
			database.run('PRAGMA foreign_keys=ON');
		}
		client(database);
		database.run("INSERT INTO combat_registrations VALUES(101,'{\"levels\":{\"attack\":99}}',1)");
		database.run("INSERT INTO wish_ep_spends(client_id,kind,source_id,points_micros,created_at) VALUES(101,'wish','retained',1000000,1)");
		const names=database.query<{name:string},[]>('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\'').all().map(r=>r.name).filter(n=>n!=='combat_registrations');
		const snapshot=()=>Object.fromEntries(names.map(name=>[name,database.query(`SELECT * FROM "${name}"`).all()]));
		const before=snapshot();
		database.transaction(()=>database.run(migrations.find(m=>m.version===197)!.sql)).immediate();
		expect(snapshot()).toEqual(before);
		expect(database.query("SELECT 1 FROM sqlite_schema WHERE name='combat_registrations'").get()).toBeNull();
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		expect(combat_character(database,101)).toBeNull();
	} finally {database.close();}
});


test('purchased levels, EP investment and reset refunds survive reopening the database', () => {
	const directory = mkdtempSync(join(tmpdir(), 'combat-levels-'));
	const path = join(directory, 'state.sqlite');
	let database = create_test_database(path);
	try {
		client(database); prepare_combat(database, 101); database.run('UPDATE combat_tutorial SET victories=7 WHERE client_id=101'); database.run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=101'); buy(database, 'hitpoints'); buy(database, 'defence');
		const expected = combat_character(database, 101), balance = ep_balance(database, 101);
		database.close(); database = new Database(path, { strict: true });
		expect(combat_character(database, 101)).toEqual(expected); expect(ep_balance(database, 101)).toBe(balance);
		database.transaction(() => reset_combat_levels(database, 101, 'durable-reset', expected!.revision,1)).immediate();
		database.close(); database = new Database(path, { strict: true });
		expect(combat_character(database, 101)!.levels.hitpoints).toBe(1);
		expect(combat_character(database, 101)!.invested_micros).toBe(0);
		expect(ep_balance(database, 101)).toBe(balance + 1800000);
		expect(database.query('SELECT amount_micros FROM combat_ep_ledger ORDER BY id').all())
			.toEqual([{amount_micros:-1000000}, {amount_micros:-1000000}, {amount_micros:1800000}]);
	} finally { database.close(); rmSync(directory, {recursive:true, force:true}); }
});

test('bulk purchases cross price bands atomically and reject invalid or unavailable skills', () => {
	const database=fixture(); try {
		const before=ep_balance(database,101);
		const result=database.transaction(()=>purchase_combat_level(database,101,'bulk','attack',0,19)).immediate();
		expect(result).toMatchObject({success:true,level:20,paid_micros:31_000_000});
		expect(ep_balance(database,101)).toBe(before-31_000_000);
		const character=combat_character(database,101);
		for(const quantity of [undefined,0,-1,1.5,99,NaN,Infinity,'2']) expect(purchase_combat_level(database,101,'bad','attack',1,quantity).success).toBe(false);
		for(const skill of ['ranged','magic']) expect(purchase_combat_level(database,101,'disabled',skill,1,1).success).toBe(false);
		database.run('UPDATE expedition_ep_balances SET points_micros=1000000');
		expect(purchase_combat_level(database,101,'poor','strength',1,2)).toMatchObject({success:false,error:'insufficient_ep'});
		expect(combat_character(database,101)).toEqual(character);
		expect(database.query('SELECT COUNT(*) AS n FROM combat_ep_ledger').get()).toEqual({n:1});
	} finally { database.close(); }
});

test('banked grants are idempotent, scoped and survive character creation; free reset refunds all EP once', () => {
	const database=create_test_database(); try {
		client(database); const command=crypto.randomUUID();
		expect(grant_combat_resets(database,101,9,command)).toBe(true);
		expect(grant_combat_resets(database,101,9,command)).toBe(true);
		expect(grant_combat_resets(database,101,8,command)).toBe(false);
		expect(grant_combat_resets(database,999,9,crypto.randomUUID())).toBe(false);
		expect(combat_reset_balance(database,101)).toBe(9);
		prepare_combat(database,101); database.run('UPDATE combat_tutorial SET victories=7 WHERE client_id=101'); database.run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=101');buy(database,'hitpoints');
		let character=combat_character(database,101)!;
		expect(character).toMatchObject({banked_resets:9,reset_fee_micros:0,reset_refund_micros:1000000});
		const before=ep_balance(database,101);
		const reset=database.transaction(()=>reset_combat_levels(database,101,'free-reset',character.revision)).immediate();
		expect(reset).toMatchObject({success:true,refunded_micros:1000000,fee_micros:0});
		expect(ep_balance(database,101)).toBe(before+1000000);
		expect(combat_reset_balance(database,101)).toBe(8);
		expect(reset_combat_levels(database,101,'repeat',character.revision).success).toBe(false);
		character=combat_character(database,101)!;
		expect(reset_combat_levels(database,101,'empty',character.revision)).toMatchObject({success:false,error:'nothing_to_reset'});
		expect(combat_reset_balance(database,101)).toBe(8);
		buy(database,'attack');character=combat_character(database,101)!;
		expect(grant_combat_resets(database,101,1,crypto.randomUUID())).toBe(true);
		expect(reset_combat_levels(database,101,'stale',character.revision)).toMatchObject({success:false,error:'quote_changed'});
		expect(()=>database.transaction(()=>{reset_combat_levels(database,101,'aborted',character.revision+1);throw new Error('abort');}).immediate()).toThrow('abort');
		expect(combat_reset_balance(database,101)).toBe(9);
		expect(combat_character(database,101)!.invested_micros).toBe(1000000);
	} finally { database.close(); }
});

test('multi-skill order validates all upgrades before spending and commits one revision and ledger entry', () => {
	const database=fixture(); try {
		const before=combat_character(database,101), balance=ep_balance(database,101);
		for (const upgrades of [{attack:2,magic:1},{attack:2,strength:99},{attack:2,defence:0},{},null,[]]) {
			expect(database.transaction(()=>purchase_combat_levels(database,101,'invalid',upgrades,0)).immediate().success).toBe(false);
			expect(combat_character(database,101)).toEqual(before); expect(ep_balance(database,101)).toBe(balance);
		}
		database.run('UPDATE expedition_ep_balances SET points_micros=31000000 WHERE client_id=101');
		expect(database.transaction(()=>purchase_combat_levels(database,101,'poor',{attack:19,strength:1},0)).immediate()).toMatchObject({success:false,error:'insufficient_ep'});
		expect(combat_character(database,101)).toEqual(before);expect(ep_balance(database,101)).toBe(31000000);
		database.run('UPDATE expedition_ep_balances SET points_micros=100000000 WHERE client_id=101');
		expect(database.transaction(()=>purchase_combat_levels(database,101,'all',{attack:19,strength:2,hitpoints:9},0)).immediate()).toEqual({success:true,levels:{attack:20,strength:3,hitpoints:10},paid_micros:43000000});
		expect(combat_character(database,101)).toMatchObject({revision:1,invested_micros:43000000,max_hp:100});
		expect(ep_balance(database,101)).toBe(57000000);
		expect(database.query('SELECT amount_micros FROM combat_ep_ledger').all()).toEqual([{amount_micros:-43000000}]);
	} finally {database.close();}
});
