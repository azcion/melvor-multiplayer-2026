import { expect, test } from 'bun:test';
import { create_test_database } from '../support/database';
import { expedition_leaderboard, EXPEDITION_LEADERBOARD_WINDOW_MS } from '../../expedition-leaderboard';

test('global seven-day earnings use settlement boundaries, stable ties and bounded pages independently of balances', () => {
	const db = create_test_database();
	const now = 2 * EXPEDITION_LEADERBOARD_WINDOW_MS;
	try {
		for (let id = 1; id <= 24; id++) {
			db.run('INSERT INTO clients(id,client_identifier,client_key,friend_code,display_name,icon_id) VALUES(?,?,?,?,?,?)',
				[id, `leader-${id}`, 'key', `code-${id}`, `Player ${id}`, 'melvorD:Plant']);
			db.run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at) VALUES(?,'work',?,?,?)", [id,id,1_000_000,now]);
		}
		db.run('UPDATE clients SET deleted_at=? WHERE id=23', [now]);
		db.run('UPDATE clients SET disabled=1 WHERE id=24');
		const award = (id: number, source: number, at: number, points: number) => db.run(
			"INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at) VALUES(?,'supply',?,?,?)", [id,source,points,at]);
		award(2,100,now - EXPEDITION_LEADERBOARD_WINDOW_MS,2_000_000);
		award(3,101,now - EXPEDITION_LEADERBOARD_WINDOW_MS - 1,100_000_000);
		award(3,102,now + 1,100_000_000);
		db.run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at) VALUES(3,'ending',1,100000000,?)", [now]);
		db.run('DELETE FROM expedition_ep_ledger WHERE client_id=22');
		db.run("INSERT INTO expedition_ep_ledger(client_id,source_kind,source_id,points_micros,created_at) VALUES(22,'ending',2,100000000,?)", [now]);
		db.run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(3,999000000)');
		const first = expedition_leaderboard(db,0,now);
		expect(first.total).toBe(21);
		expect(first.players.length).toBe(10);
		expect(first.players[0]).toEqual({client_id:2,display_name:'Player 2',icon_id:'melvorD:Plant',guild_name:null,points_micros:3_000_000});
		db.run("INSERT INTO guilds(id,name,icon_id) VALUES(100,'First Guild','melvorD:Plant'),(101,'Second Guild','melvorD:Plant')");
		db.run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(2,100),(3,101)');
		expect(expedition_leaderboard(db,0,now).players[0].guild_name).toBe('First Guild');
		db.run("UPDATE guilds SET name='Renamed Guild' WHERE id=100");
		expect(expedition_leaderboard(db,0,now).players[0].guild_name).toBe('Renamed Guild');
		db.run('UPDATE guild_memberships SET guild_id=101 WHERE client_id=2');
		expect(expedition_leaderboard(db,0,now).players[0].guild_name).toBe('Second Guild');
		db.run('DELETE FROM guild_memberships WHERE client_id=2');
		expect(expedition_leaderboard(db,0,now).players[0].guild_name).toBeNull();
		expect(first.players.slice(1).map(row => row.client_id)).toEqual([1,3,4,5,6,7,8,9,10]);
		expect(expedition_leaderboard(db,1,now).players.map(row => row.client_id)).toEqual([11,12,13,14,15,16,17,18,19,20]);
		expect(expedition_leaderboard(db,999,now)).toMatchObject({page:2,players:[{client_id:21}]});
		expect(expedition_leaderboard(db,0,now + EXPEDITION_LEADERBOARD_WINDOW_MS + 2)).toMatchObject({total:0,page:0,players:[]});
	} finally { db.close(); }
});
