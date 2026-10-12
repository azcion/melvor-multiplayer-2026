import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { migrations } from '../../db/schema';
import { capacity_price_micros, wish_price_micros, purchase_wish_capacity, wish_capacity_state,
	settle_wish_capacity, WISH_CAPACITY_MS, set_wish_capacity_renewal } from '../../wish-capacity';

function fixture() {
	const database = create_test_database();
	database.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(100,'capacity','key','111-222-333','Capacity','melvorD:Plant')");
	database.run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(100,1000000000)');
	return database;
}

test('Wish pricing prorates partial increments and exact upward milli-EP rounding', () => {
	for (const [base, qty, price] of [[100,1,10000],[100,50,500000],[100,100,1000000],
		[100,101,1020000],[100,200,3000000],[100,201,3030000],[100,500,15000000],
		[100,1000,55000000],[500,1,2000],[500,50,100000],[500,500,1000000],
		[500,501,1020000],[500,600,3000000],[500,1000,21000000],
		[300,1,4000],[300,2,7000],[300,299,997000],[300,300,1000000]])
		expect(wish_price_micros(qty!,base!)).toBe(price!);
	for (const invalid of [0,1001,1.1,NaN,Infinity]) expect(() => wish_price_micros(invalid)).toThrow();
	for (const base of [0,101,600]) expect(() => capacity_price_micros(base)).toThrow();
	for (const base of [100,200,300,400,500]) {
		let prior = 0;
		for (let qty=1;qty<=1000;qty++) {
			const price=wish_price_micros(qty,base);
			expect(price % 1000).toBe(0);
			expect(price).toBeGreaterThanOrEqual(prior);
			prior=price;
		}
	}
});

test('purchases charge full costs or differences and reset the whole expiry; characters stay isolated', () => {
	const database=fixture();
	try {
		const now=1000;
		for (const [index,base] of [200,300,400,500].entries()) {
			const time=now+index*100;
			expect(purchase_wish_capacity(database,100,base,true,(index+1)*10000000,`upgrade-${base}`,time))
				.toMatchObject({success:true,capacity:{base,expires_at:time+WISH_CAPACITY_MS,auto_renew:true,
					renewal_micros:[10000000,30000000,60000000,100000000][index]}});
		}
		expect(wish_capacity_state(database,100,1300).points_micros).toBe(900000000);
		expect(purchase_wish_capacity(database,100,500,false,100000000,'renew',2000))
			.toMatchObject({success:false,error:'invalid_capacity_tier'});
		expect(wish_capacity_state(database,100,2000)).toMatchObject({expires_at:1300+WISH_CAPACITY_MS,points_micros:900000000});
		expect(set_wish_capacity_renewal(database,100,false,2000)).toMatchObject({success:true});
		expect(wish_capacity_state(database,101,2000).base).toBe(100);
		expect(wish_capacity_state(database,100,2000+WISH_CAPACITY_MS).base).toBe(100);
		expect(purchase_wish_capacity(database,100,500,false,100000000,'restart',2000+WISH_CAPACITY_MS))
			.toMatchObject({success:true,paid_ep_micros:100000000});
	} finally {database.close();}
});

test('expiry renews exactly once, pauses on insufficient EP and never retries later credits', () => {
	const database=fixture();
	try {
		purchase_wish_capacity(database,100,300,true,30000000,'buy',1000);
		const due=1000+WISH_CAPACITY_MS;
		settle_wish_capacity(database,100,due-1);
		expect(wish_capacity_state(database,100,due-1).points_micros).toBe(970000000);
		settle_wish_capacity(database,100,due);
		settle_wish_capacity(database,100,due);
		expect(wish_capacity_state(database,100,due)).toMatchObject({base:300,expires_at:due+WISH_CAPACITY_MS,points_micros:940000000});
		database.run('UPDATE expedition_ep_balances SET points_micros=29999999 WHERE client_id=100');
		settle_wish_capacity(database,100,due+WISH_CAPACITY_MS);
		expect(wish_capacity_state(database,100,due+WISH_CAPACITY_MS)).toMatchObject({base:100,auto_renew:false,renewal_paused:true,points_micros:29999999});
		database.run('UPDATE expedition_ep_balances SET points_micros=1000000000 WHERE client_id=100');
		settle_wish_capacity(database,100,due+WISH_CAPACITY_MS+1);
		expect(wish_capacity_state(database,100,due+WISH_CAPACITY_MS+1).base).toBe(100);
		expect(set_wish_capacity_renewal(database,100,true,due+WISH_CAPACITY_MS+1).success).toBe(false);
	} finally {database.close();}
});

test('downtime processes affordable scheduled renewals and stops at the first failed deadline', () => {
	const database=fixture();
	try {
		purchase_wish_capacity(database,100,200,true,10000000,'buy',1000);
		database.run('UPDATE expedition_ep_balances SET points_micros=20000000 WHERE client_id=100');
		settle_wish_capacity(database,100,1000+4*WISH_CAPACITY_MS);
		expect(wish_capacity_state(database,100,1000+4*WISH_CAPACITY_MS)).toMatchObject({base:100,renewal_paused:true,points_micros:0});
		expect(database.query("SELECT SUM(points_micros) paid FROM wish_ep_spends WHERE kind='renewal'").get()).toEqual({paid:20000000});
	} finally {database.close();}
});

test('quote mismatches and insufficient balances do not buy a tier; renewal can be disabled', () => {
	const database=fixture();
	try {
		expect(purchase_wish_capacity(database,100,400,true,1,'bad',1000).success).toBe(false);
		database.run('UPDATE expedition_ep_balances SET points_micros=59999999 WHERE client_id=100');
		expect(purchase_wish_capacity(database,100,400,true,60000000,'poor',1000).success).toBe(false);
		expect(wish_capacity_state(database,100,1000).base).toBe(100);
		purchase_wish_capacity(database,100,200,true,10000000,'buy',1000);
		set_wish_capacity_renewal(database,100,false,1001);
		expect(wish_capacity_state(database,100,1000+WISH_CAPACITY_MS)).toMatchObject({base:100,auto_renew:false,points_micros:49999999});
	} finally {database.close();}
});

test('migration preserves all Wish fields, IDs and deleted ID high-water mark while raising the limit', () => {
	const database=new Database(':memory:',{strict:true});
	try {
		for (const migration of migrations.filter(m=>m.version<185)) {
			database.run('PRAGMA foreign_keys=OFF');
			database.run(migration.sql);
		}
		database.run('PRAGMA foreign_keys=ON');
		database.run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(1,'capacity','capacity',1)");
		database.run("INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id,melvor_account_id) VALUES(100,'capacity','key','111-222-333','Capacity','melvorD:Plant',1)");
		database.run("INSERT INTO crucible_wishes(id,guild_id,owner_client_id,melvor_account_id,item_id,qty,required_gp,progress_gp,formation_points,created_at,formed_at,melded_at,delivered_at,auto_deliver_at) VALUES(10,1,100,1,'test:Reward',100,1000,1000,10080,1,2,3,4,5)");
		database.run("UPDATE sqlite_sequence SET seq=99 WHERE name='crucible_wishes'");
		const prior=database.query('SELECT * FROM crucible_wishes').all();
		database.run('PRAGMA foreign_keys=OFF');
		try {database.transaction(()=>{database.run(migrations.find(m=>m.version===185)!.sql);expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);}).immediate();}
		finally {database.run('PRAGMA foreign_keys=ON');}
		expect(database.query('SELECT * FROM crucible_wishes').all()).toEqual(prior);
		expect(database.query("SELECT seq FROM sqlite_sequence WHERE name='crucible_wishes'").get()).toEqual({seq:99});
		database.run('UPDATE crucible_wishes SET qty=1000');
		expect(()=>database.run('UPDATE crucible_wishes SET qty=1001')).toThrow();
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {database.close();}
});


test('migration retains deleted Wish ID high-water mark when no active Wishes remain', () => {
	const database=new Database(':memory:',{strict:true});
	try {
		for (const migration of migrations.filter(m=>m.version<185)) {
			database.run('PRAGMA foreign_keys=OFF');database.run(migration.sql);
		}
		database.run("UPDATE sqlite_sequence SET seq=77 WHERE name='crucible_wishes'");
		database.run(migrations.find(m=>m.version===185)!.sql);
		expect(database.query("SELECT seq FROM sqlite_sequence WHERE name='crucible_wishes'").get()).toEqual({seq:77});
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
	} finally {database.close();}
});
