import { test, expect } from 'bun:test';
import { create_test_database } from '../support/database';
import { migrations } from '../../db/schema';
import { get_transfer_history, record_pending_exchange, record_transfer_history, TRANSFER_HISTORY_WINDOW } from '../../transfer-history';
import { Database } from 'bun:sqlite';

function seed(db: Database) {
	db.run("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(1,'Cloud','history',1)");
	for (const id of [101, 102]) db.query('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id,melvor_account_id) VALUES(?,?,?,?,?,?,1)')
		.run(id, `history-${id}`, 'key', `111-222-${id}`, `Player ${id}`, 'melvorD:Plant');
}

function receipt(db: Database, id: string, kind: string, qty: number, at: number) {
	db.query('INSERT INTO economy_receipts(id,client_id,kind,response_json,created_at) VALUES(?,101,?,?,?)')
		.run(id, kind, JSON.stringify({ success: true, receipt: { id, kind,
			effects: [{ storage: 'bank', item_id: 'test:Ore', qty }] } }), at);
}

test('stored feeds enforce owner, pane, 14-day boundary, stable cursor and future exclusion', () => {
	const db = create_test_database(); seed(db);
	const now = Date.now();
	for (let i = 0; i < 25; i++) record_transfer_history(db, { client_id: 101, pane: 'outbox', event_type: 'market-sell',
		source_key: `test:${i}`, occurred_at: now, items: [{ item_id: 'test:Ore', qty: i + 1 }] });
	for (const [id, at] of [['old', now - TRANSFER_HISTORY_WINDOW - 1], ['boundary', now - TRANSFER_HISTORY_WINDOW], ['future', now + 1]] as const)
		record_transfer_history(db, { client_id: 101, pane: 'outbox', event_type: 'market-sell', source_key: id, occurred_at: at });
	const page = get_transfer_history(db, 101, 'outbox', null, now);
	expect(page.entries).toHaveLength(20);
	expect(page.entries[0]?.items[0]?.qty).toBe(25);
	const next = get_transfer_history(db, 101, 'outbox', page.next_cursor, now);
	expect(next.entries).toHaveLength(6);
	expect(next.next_cursor).toBeNull();
	expect(new Set([...page.entries, ...next.entries].map(row => row.id)).size).toBe(26);
	expect(get_transfer_history(db, 102, 'outbox', null, now).entries).toEqual([]);
	expect(get_transfer_history(db, 101, 'inbox', null, now).entries).toEqual([]);
	db.close();
});

test('receipt history retains exact effects, excludes Charitree and positive Outbox movements, and rolls back atomically', () => {
	const db = create_test_database(); seed(db); const now = Date.now();
	receipt(db, 'sell', 'market-sell', -7, now);
	receipt(db, 'charity', 'charity-donate', -9, now);
	receipt(db, 'buy', 'market-buy', 3, now);
	db.query('INSERT INTO economy_receipts(id,client_id,kind,response_json,created_at) VALUES(?,101,?,?,?)')
		.run('transfer', 'return', JSON.stringify({ receipt: { effects: [{ storage: 'transfer', item_id: 'test:Ore', qty: 4 }] } }), now);
	expect(() => db.transaction(() => { receipt(db, 'rollback', 'market-sell', -2, now); throw Error('rollback'); })()).toThrow();
	db.query('UPDATE economy_receipts SET acknowledged_at=?').run(now);
	expect(get_transfer_history(db, 101, 'outbox', null, now).entries.map(row => row.items)).toEqual([[{ item_id: 'test:Ore', qty: 7, direction: 'out' }]]);
	expect(get_transfer_history(db, 101, 'inbox', null, now).entries[0]?.items[0]?.qty).toBe(3);
	db.close();
});

test('Inbox aggregation records only new quantities and survives source removal', () => {
	const db = create_test_database(); seed(db); const now = Date.now();
	db.query("INSERT INTO inbox_items(client_id,item_id,qty,source_type,source_name,created_at,updated_at) VALUES(101,'test:Ore',3,'market_sale','Seller',?,?)").run(now, now);
	db.query("INSERT INTO inbox_items(client_id,item_id,qty,source_type,source_name,created_at,updated_at) VALUES(101,'test:Fish',2,'market_sale','Seller',?,?)").run(now, now);
	db.query("UPDATE inbox_items SET qty=8,updated_at=? WHERE client_id=101 AND item_id='test:Ore'").run(now + 1);
	db.run('DELETE FROM inbox_items WHERE client_id=101');
	const entries = get_transfer_history(db, 101, 'inbox', null, now + 1).entries;
	expect(entries.map(row => row.items[0]?.qty)).toEqual([5, 3]);
	expect(entries[1]?.items.map(item => item.qty)).toEqual([3, 2]);
	expect(entries.every(row => row.source_name === 'Seller' && !row.reconstructed)).toBe(true);
	db.close();
});

test('Trade snapshots retain both sides and names after deletion; source keys prevent duplicate recording', () => {
	const db = create_test_database(); seed(db); const now = Date.now();
	db.query('INSERT INTO trade_offers(trade_id,sender_id,recipient_id,attending_id,created_at,updated_at) VALUES(1,101,102,102,?,?)').run(now, now);
	db.run("INSERT INTO trade_items(trade_id,item_id,qty,counter) VALUES(1,'test:Ore',5,0),(1,'test:Fish',2,1)");
	for (let i = 0; i < 2; i++) record_pending_exchange(db, 'trade', 1, 'trade-accept', now);
	db.run("UPDATE clients SET display_name='Renamed' WHERE id=102");
	db.run('DELETE FROM trade_items'); db.run('DELETE FROM trade_offers');
	const sender = get_transfer_history(db, 101, 'pending', null, now).entries;
	expect(sender).toHaveLength(1);
	expect(sender[0]?.source_name).toBe('Player 102');
	expect(sender[0]?.items.map(item => item.direction)).toEqual(['out', 'in']);
	expect(get_transfer_history(db, 102, 'pending', null, now).entries[0]?.items.map(item => item.direction)).toEqual(['in', 'out']);
	db.close();
});

test('migration reconstructs retained receipts once, marks estimates, and installs forward recording', () => {
	const db = new Database(':memory:'); db.run('PRAGMA foreign_keys=ON');
	for (const migration of migrations.filter(row => row.version < 159)) {
		if (migration.foreign_keys_disabled) db.run('PRAGMA foreign_keys=OFF');
		db.run(migration.sql); db.run('PRAGMA foreign_keys=ON');
	}
	seed(db); const now = Date.now();
	receipt(db, 'historical', 'market-sell', -8, now);
	receipt(db, 'too-old', 'market-sell', -10, now - TRANSFER_HISTORY_WINDOW - 1000);
	receipt(db, 'hidden-charity', 'charity-donate', -4, now);

	// Semantic audit intentionally outlives permanently erased Clients.
	for (const [id, actor, recipient] of [[1, 101, 999], [2, 999, 102]]) {
		db.query("INSERT INTO audit_events(id,occurred_at,event_type,actor_kind,actor_client_id,actor_display_name,source_key) VALUES(?,?,'gift.sent','client',?,'Snapshot sender',?)")
			.run(id, now, actor, `gift-audit:${id}`);
		db.query("INSERT INTO audit_event_participants(event_id,role,client_id,display_name) VALUES(?,'recipient',?,'Snapshot recipient')").run(id, recipient);
		db.query("INSERT INTO audit_event_values(event_id,ordinal,value_kind,object_id,quantity,direction) VALUES(?,0,'item','test:Gift',5,'move')").run(id);
	}
	db.query("INSERT INTO inbox_claims(id,client_id,created_at,acknowledged_at) VALUES('old-claim',101,?,?)").run(now - 1, now);
	db.run("INSERT INTO inbox_claim_items(claim_id,item_id,qty) VALUES('old-claim','test:Claim',3)");
	db.query('INSERT INTO trade_offers(trade_id,sender_id,recipient_id,attending_id,created_at,updated_at) VALUES(1,101,102,102,?,?)').run(now, now);
	db.run("INSERT INTO trade_items(trade_id,item_id,qty,counter) VALUES(1,'test:Trade',2,0)");
	db.run("INSERT INTO guilds(id,name,icon_id) VALUES(501,'History','melvorD:Plant')");
	db.query("INSERT INTO market_haggles(id,listing_ref,guild_id,initiator_id,owner_id,direction,item_id,item_qty,listing_price,offer_price,revision,status,created_at,updated_at,terminal_at) VALUES('historic-haggle',1,501,101,102,'sell','test:Haggle',2,9,8,2,'cancelled',?,?,?)").run(now - 10, now - 1, now - 1);
	for (const migration of migrations.filter(row => row.version >= 159)) db.transaction(() => db.run(migration.sql))();
	const old = get_transfer_history(db, 101, 'outbox', null, now).entries;
	expect(old).toHaveLength(2); expect(old.every(row => row.reconstructed)).toBe(true);
	expect(old.find(row => row.event_type === 'market-sell')?.items[0]?.qty).toBe(8);
	expect(old.find(row => row.event_type === 'gift-send')?.source_name).toBe('Snapshot recipient');
	expect(get_transfer_history(db, 101, 'inbox', null, now).entries[0]?.items[0]?.qty).toBe(3);
	const pending = get_transfer_history(db, 102, 'pending', null, now).entries;
	expect(pending.find(row => row.event_type === 'trade-offer')?.items[0]?.qty).toBe(2);
	expect(pending.find(row => row.event_type === 'haggle.created')?.items).toHaveLength(1);
	expect(pending.find(row => row.event_type === 'haggle.cancelled')?.items[1]?.qty).toBe(16);
	receipt(db, 'new', 'crucible-cast', -2, now);
	expect(get_transfer_history(db, 101, 'outbox', null, now).entries[0]?.reconstructed).toBe(false);
	expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	db.close();
});

test('context migration backfills exact recent claims and destinations while retaining older records', () => {
	const db = create_test_database(); seed(db); const now = Date.now() - 1000;
	db.run('DROP TRIGGER history_context');
	db.run('DROP TABLE inbox_claim_sources');
	for (const [id, at] of [['recent', now], ['old', now - TRANSFER_HISTORY_WINDOW - 1000]] as const) {
		db.query('INSERT INTO inbox_claims(id,client_id,created_at) VALUES(?,101,?)').run(id, at);
		db.query("INSERT INTO inbox_claim_items(claim_id,item_id,qty) VALUES(?,'test:Ore',30)").run(id);
		db.query('UPDATE inbox_claims SET acknowledged_at=? WHERE id=?').run(at, id);
		const audit = db.query<{ id: number }, [number, string]>(
			"INSERT INTO audit_events(occurred_at,event_type,actor_kind,actor_client_id,actor_display_name,source_key) VALUES(?,'inbox.claim_created','client',101,'Player 101',?) RETURNING id"
		).get(at, `inbox-claim:${id}:created`)!;
		for (const [ordinal, name, qty] of [[0, '101:gift_received:Alice:Original', 10], [1, '101:market_bought:Bob', 15]] as const) {
			const lot = db.query<{ id: number }, [number, number]>(
				"INSERT INTO audit_value_lots(created_by_event_id,object_id,original_quantity) VALUES(?,'test:Ore',?) RETURNING id"
			).get(audit.id, qty)!;
			db.query("INSERT INTO audit_value_movements(event_id,ordinal,lot_id,from_kind,from_key,to_kind,to_key,object_id,quantity) VALUES(?,?,?,'inbox',?,'client','101','test:Ore',?)")
				.run(audit.id, ordinal, lot.id, name, qty);
		}
		record_transfer_history(db, { client_id: 101, pane: 'outbox', event_type: 'campaign-contribute', source_key: id, occurred_at: at });
	}
	const before = db.query('SELECT COUNT(*) AS total FROM transfer_history_events').get();
	db.run(migrations.find(row => row.version === 161)!.sql);
	expect(db.query('SELECT COUNT(*) AS total FROM transfer_history_events').get()).toEqual(before);
	expect(db.query('SELECT item_id,source_type,source_name,qty FROM inbox_claim_sources ORDER BY source_type').all()).toEqual([
		{ item_id: 'test:Ore', source_type: 'gift_received', source_name: 'Alice:Original', qty: 10 },
		{ item_id: 'test:Ore', source_type: 'market_bought', source_name: 'Bob', qty: 15 }
	]);
	expect(db.query("SELECT source_type FROM transfer_history_events WHERE pane='outbox' AND source_key='old'").get()).toEqual({ source_type: '' });
	expect(get_transfer_history(db, 101, 'outbox', null, now).entries[0]?.source_type).toBe('campaign');
	expect(get_transfer_history(db, 101, 'inbox', null, now).entries).toHaveLength(1);
	expect(get_transfer_history(db, 101, 'inbox', null, now).entries[0]?.items[0]?.qty).toBe(30);
	expect(get_transfer_history(db, 102, 'inbox', null, now).entries).toEqual([]);
	expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	db.close();
});

test('recent destination backfill uses exact command links and saved names, leaving unknown records alone', () => {
	const db = create_test_database(); seed(db); const now = Date.now() - 1000;
	db.run('DROP TRIGGER history_context'); db.run('DROP TABLE inbox_claim_sources');
	for (const [event_type, command] of [['gift-send', 'gift-command'], ['market-buy', 'market-command'], ['market-fulfill', 'fulfill-command'], ['market-buy', 'unknown-command']] as const)
		record_transfer_history(db, { client_id: 101, pane: 'outbox', event_type, source_key: `receipt:${command}`, occurred_at: now });
	db.query("INSERT INTO audit_events(id,occurred_at,event_type,actor_kind,actor_client_id,actor_display_name,command_id,source_key) VALUES(1,?,'gift.sent','client',101,'Sender','gift-command','gift-audit')").run(now);
	db.run("INSERT INTO audit_event_participants(event_id,role,client_id,display_name) VALUES(1,'recipient',102,'Original Recipient')");
	db.run("INSERT INTO guilds(id,name,icon_id) VALUES(501,'Context','melvorD:Plant')");
	for (const [kind, command, buyer, seller] of [['market_purchased', 'market-purchase:market-command', 'Viewer', 'Original Seller'],
		['market_fulfilled', 'market-fulfillment:fulfill-command', 'Original Buyer', 'Viewer']])
		db.query('INSERT INTO guild_activity_events(guild_id,event_type,actor_client_id,actor_display_name,metadata,source_key,created_at,buyer_client_id,buyer_display_name,seller_client_id,seller_display_name,item_id,quantity) VALUES(501,?,101,\'Viewer\',\'{}\',?,?,101,?,102,?,\'test:Ore\',1)')
			.run(kind, command, now, buyer, seller);
	db.query('INSERT INTO economy_receipts(id,client_id,kind,response_json,created_at) VALUES(?,101,?,?,?)')
		.run('haggle-command', 'market-haggle', JSON.stringify({ haggle_id: 'saved-haggle', receipt: { effects: [{ storage: 'gp', qty: -7 }] } }), now);
	record_transfer_history(db, { client_id: 101, pane: 'pending', event_type: 'haggle.created',
		source_key: 'haggle:saved-haggle:created', occurred_at: now, source_name: 'Original Trader' });
	record_transfer_history(db, { client_id: 101, pane: 'pending', event_type: 'haggle.claimed',
		source_key: 'haggle-claim:saved-haggle', occurred_at: now });
	db.run("UPDATE clients SET display_name='Renamed' WHERE id=102");
	db.run(migrations.find(row => row.version === 161)!.sql);
	const names = db.query<{ source_key: string; source_name: string }, []>('SELECT source_key,source_name FROM transfer_history_events').all();
	for (const [key, name] of [['receipt:gift-command', 'Original Recipient'], ['receipt:market-command', 'Original Seller'],
		['receipt:fulfill-command', 'Original Buyer'], ['receipt:haggle-command', 'Original Trader'], ['haggle-claim:saved-haggle', 'Original Trader'],
		['receipt:unknown-command', '']]) expect(names.find(row => row.source_key === key)?.source_name).toBe(name);
	expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
	db.close();
});
