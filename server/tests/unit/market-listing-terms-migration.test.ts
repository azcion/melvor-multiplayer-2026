import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('listing terms upgrade preserves IDs, active Haggles, claims, and the ID high-water mark', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations.filter(row => row.version < 166)) {
		database.run(`PRAGMA foreign_keys=${migration.foreign_keys_disabled ? 'OFF' : 'ON'}`);
		database.transaction(() => database.run(migration.sql)).immediate();
	}
	database.run('PRAGMA foreign_keys=ON');
	for (const id of [1, 2]) database.run(`INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id)
		VALUES(?,?,'key',?,'Migration Client','melvorD:Plant')`, [id, `terms-${id}`, `111-111-11${id}`]);
	database.run("INSERT INTO guilds(id,name,icon_id) VALUES(100,'Terms Guild','multiplayer')");
	database.run("INSERT INTO market_items(id,guild_id,client_id,item_id,qty,available,reserved,price,published_at) VALUES(4,100,1,'melvorD:Apple',10,8,2,5,1)");
	database.run("INSERT INTO market_items(id,guild_id,client_id,item_id,qty,available,price) VALUES(999,100,1,'melvorD:Other',1,1,1)");
	database.run('DELETE FROM market_items WHERE id=999');
	const id = crypto.randomUUID();
	database.run(`INSERT INTO market_haggles(id,listing_id,listing_ref,guild_id,initiator_id,owner_id,direction,item_id,item_qty,
		listing_price,offer_price,payer_escrow_gp,turn_client_id,created_at,updated_at,expires_at)
		VALUES(?,4,4,100,2,1,'sell','melvorD:Apple',2,5,4,8,1,1,1,2)`, [id]);
	database.run('INSERT INTO market_haggle_claims(haggle_id,client_id,gp) VALUES(?,2,1)', [id]);
	const upgrade = migrations.find(row => row.version === 166)!;
	database.run('PRAGMA foreign_keys=OFF');
	try {
		database.transaction(() => {
			database.run(upgrade.sql);
			expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		}).immediate();
	} finally { database.run('PRAGMA foreign_keys=ON'); }
	expect(database.query('SELECT listing_id,payer_escrow_gp,currency_id FROM market_haggles WHERE id=?').get(id))
		.toEqual({ listing_id: 4, payer_escrow_gp: 8, currency_id: 'melvorD:GP' });
	expect(database.query('SELECT gp FROM market_haggle_claims WHERE haggle_id=?').get(id)).toEqual({ gp: 1 });
	expect(database.query('SELECT qty,available,reserved,currency_id,purchase_limit,allow_haggles FROM market_items WHERE id=4').get())
		.toEqual({ qty: 10, available: 8, reserved: 2, currency_id: 'melvorD:GP', purchase_limit: 0, allow_haggles: 1 });
	const next = database.query<{ id: number }, []>(`INSERT INTO market_items(guild_id,client_id,item_id,qty,available,price,currency_id)
		VALUES(100,1,'melvorD:Apple',2,2,5,'melvorD:SlayerCoins') RETURNING id`).get()!;
	expect(next.id).toBeGreaterThan(999);
	database.run("INSERT INTO market_purchases(listing_id,owner_key,qty) VALUES(4,'client:2',1)");
	database.run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(77,'Migration Account','migration-account',0)");
	database.run('UPDATE clients SET melvor_account_id=77 WHERE id=2');
	expect(database.query('SELECT owner_key,qty FROM market_purchases WHERE listing_id=4').all()).toEqual([{ owner_key: 'account:77', qty: 1 }]);
	expect(database.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
	database.close();
});
