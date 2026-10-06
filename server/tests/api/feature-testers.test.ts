import { PETITION_TYPES } from '../../council';
import { test, expect } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post_json, post } from '../support/http';
import { db_all, db_run } from '../support/persistence';
import { pending_test_data, council_test_data } from '../../feature-testers';

test('Pending tester snapshots are character scoped, opt-in, revocable and contain every exchange role', async () => {
	const pair = await make_guildmates('Preview Tester', 'Preview Ordinary', 'Preview Guild', { first: '1.6.3', second: '1.6.3' });
	const events = (token: string, query = '') => get_json_with_session<{ pending_preview?: ReturnType<typeof pending_test_data> | null; revision: number; unchanged?: boolean }>('/api/events?pending_preview=1' + query, token);
	expect((await events(pair.first.session_token)).json.pending_preview).toBeNull();
	await db_run('INSERT INTO character_feature_testers(client_id,feature) VALUES (?,?)', [pair.first_id, 'pending']);
	const snapshot = (await events(pair.first.session_token)).json;
	expect(snapshot.pending_preview).toEqual(pending_test_data());
	expect((await events(pair.second.session_token)).json.pending_preview).toBeNull();
	expect((await get_json_with_session<Record<string, unknown>>('/api/events', pair.first.session_token)).json.pending_preview).toBeUndefined();
	expect((await events(pair.first.session_token, '&revision=' + snapshot.revision)).json.unchanged).toBe(true);
	expect(snapshot.pending_preview!.trades.filter(row => row.data !== null).map(row => [row.state, row.attending])).toEqual([[0, true], [0, false], [1, true], [1, false]]);
	expect(new Set(snapshot.pending_preview!.haggles.map(row => row.status))).toEqual(new Set(['active', 'accepted', 'cancelled', 'rejected', 'expired']));
	await db_run('DELETE FROM character_feature_testers WHERE client_id=?', [pair.first_id]);
	const revoked = (await events(pair.first.session_token, '&revision=' + snapshot.revision)).json;
	expect(revoked.unchanged).toBeUndefined();
	expect(revoked.pending_preview).toBeNull();
});

test('Preview actions cannot mutate real exchanges, receipts, inventory or history', async () => {
	const pair = await make_guildmates('Noop Tester', 'Noop Ordinary', 'Noop Guild', { first: '1.6.3', second: '1.6.3' });
	await db_run('INSERT INTO character_feature_testers(client_id,feature) VALUES (?,?)', [pair.first_id, 'pending']);
	const real = (await post_json<{ trade_id: number }>('/api/trade/offer', { recipient_id: pair.second_id,
		items: [{ id: 'melvorD:Coal_Ore', qty: 4 }] }, pair.first.session_token)).json;
	const tables = ['gifts', 'trade_offers', 'trade_items', 'market_haggles', 'market_haggle_claims', 'economy_receipts', 'transfer_history_events', 'transfer_history_items', 'inbox_items'];
	const capture = async () => Promise.all(tables.map(table => db_all(`SELECT * FROM ${table} ORDER BY rowid`)));
	const before = await capture();
	const fixtures = pending_test_data();
	for (const [kind, ids, actions] of [
		['gift', fixtures.gifts.map(row => row.id), ['accept', 'decline', 'discard']],
		['trade', [...fixtures.trades, ...fixtures.resolved_trades].map(row => row.trade_id), ['counter', 'accept', 'decline', 'cancel', 'resolve']],
		['haggle', fixtures.haggles.map(row => row.id), ['accept', 'counter', 'terminate', 'claim']]
	] as const) {
		for (const id of ids) for (const action of actions)
			expect((await post_json('/api/features/pending/action', { kind, id, action }, pair.first.session_token)).json).toEqual({ success: true, synthetic: true });
	}
	expect(await capture()).toEqual(before);
	expect((await post('/api/features/pending/action', { kind: 'trade', id: real.trade_id, action: 'accept' }, pair.first.session_token)).status).toBe(400);
	expect((await post('/api/features/pending/action', { kind: 'gift', id: -1, action: 'accept' }, pair.second.session_token)).status).toBe(403);
	await db_run('DELETE FROM character_feature_testers WHERE client_id=?', [pair.first_id]);
	expect((await post('/api/features/pending/action', { kind: 'gift', id: -1, action: 'accept' }, pair.first.session_token)).status).toBe(403);
});


test('Council showcase covers all types, active variants and history without affecting ordinary members or pagination', async () => {
	const pair = await make_guildmates('Council Tester', 'Council Ordinary', 'Council Preview', { first: '1.6.3', second: '1.6.3' });
	type Snapshot = { petitions: ReturnType<typeof council_test_data>['active']; available_petition_types: string[]; has_more: boolean };
	const read = (token: string, page = 0) => get_json_with_session<Snapshot>('/api/guilds/council?page=' + page, token);
	expect((await post_json('/api/guilds/petitions/raise', { type: 'appellation', name: 'Real Council Name' }, pair.first.session_token)).json).toMatchObject({ success: true });
	const original = (await read(pair.first.session_token)).json;
	await db_run('INSERT INTO character_feature_testers(client_id,feature) VALUES (?,?)', [pair.first_id, 'pending']);
	expect((await read(pair.first.session_token)).json).toEqual(original);
	await db_run('INSERT INTO character_feature_testers(client_id,feature) VALUES (?,?)', [pair.first_id, 'council']);
	const snapshot = (await read(pair.first.session_token)).json;
	expect(snapshot.petitions.filter(row => row.petition_id > 0)).toEqual(original.petitions);
	const synthetic = snapshot.petitions.filter(row => row.synthetic);
	const active = synthetic.filter(row => row.lifecycle === 'active');
	const history = synthetic.filter(row => row.lifecycle !== 'active');
	expect(new Set(active.map(row => row.type))).toEqual(new Set(PETITION_TYPES));
	expect(active.length).toBe(PETITION_TYPES.length + 4);
	expect(history.length).toBe(7);
	expect(new Set(history.map(row => row.lifecycle))).toEqual(new Set(['granted', 'denied', 'lapsed', 'withdrawn']));
	expect(new Set(history.filter(row => row.lifecycle === 'granted').map(row => row.execution_state))).toEqual(new Set(['succeeded', 'pending', 'running', 'failed']));
	expect(active.some(row => row.current_vote === 'aye' && row.can_withdraw)).toBe(true);
	expect(active.some(row => row.current_vote === 'aye' && !row.can_withdraw)).toBe(true);
	expect(active.some(row => row.current_vote === 'nay')).toBe(true);
	expect(active.some(row => !row.eligible && !row.can_vote)).toBe(true);
	expect(active.some(row => row.can_vote && !row.can_withdraw && !row.tally_visible)).toBe(true);
	for (const row of synthetic) {
		expect(row.petition_id).toBeLessThan(0);
		expect(row.can_vote).toBe(row.lifecycle === 'active' && row.eligible && row.current_vote === null);
		if (row.tally_visible) expect(row.tally!.aye + row.tally!.nay + row.tally!.uncast).toBe(row.tally!.eligible);
		else expect(row.tally).toBeUndefined();
	}
	expect(new Set(snapshot.petitions.map(row => row.petition_id)).size).toBe(snapshot.petitions.length);
	expect(snapshot.available_petition_types).toEqual(original.available_petition_types);
	expect(snapshot.has_more).toBe(original.has_more);
	expect((await read(pair.second.session_token)).json.petitions.every(row => row.petition_id > 0)).toBe(true);
	expect((await read(pair.first.session_token, 1)).json.petitions.filter(row => row.synthetic).map(row => row.petition_id)).toEqual(active.map(row => row.petition_id));
	await db_run('DELETE FROM character_feature_testers WHERE client_id=? AND feature=?', [pair.first_id, 'council']);
	expect((await read(pair.first.session_token)).json).toEqual(original);
});

test('Council preview vote and withdraw enforce fixture affordances and never write real decisions', async () => {
	const pair = await make_guildmates('Council Noop', 'Council Noop Other', 'Council Noop Guild', { first: '1.6.3', second: '1.6.3' });
	await db_run('INSERT INTO character_feature_testers(client_id,feature) VALUES (?,?)', [pair.first_id, 'council']);
	const fixtures = council_test_data(0);
	const capture = async () => Promise.all([
		db_all('SELECT * FROM guilds WHERE id=?', [pair.guild_id]),
		db_all('SELECT * FROM guild_petitions WHERE guild_id=? ORDER BY id', [pair.guild_id]),
		db_all('SELECT * FROM guild_petition_votes WHERE petition_id IN (SELECT id FROM guild_petitions WHERE guild_id=?) ORDER BY petition_id,client_id', [pair.guild_id]),
		db_all('SELECT * FROM guild_activity_events WHERE guild_id=? ORDER BY id', [pair.guild_id])
	]);
	const before = await capture();
	for (const fixture of fixtures.active) {
		if (fixture.can_vote) for (const choice of ['aye', 'nay'])
			expect((await post_json('/api/guilds/petitions/vote', { petition_id: fixture.petition_id, choice }, pair.first.session_token)).json).toEqual({ success: true, synthetic: true, lifecycle: 'active' });
		if (fixture.can_withdraw)
			expect((await post_json('/api/guilds/petitions/withdraw', { petition_id: fixture.petition_id }, pair.first.session_token)).json).toEqual({ success: true, synthetic: true });
	}
	expect(await capture()).toEqual(before);
	const id = fixtures.active[0]!.petition_id;
	for (const [token, petition_id, choice] of [
		[pair.second.session_token, id, 'aye'], [pair.first.session_token, -999999, 'aye'],
		[pair.first.session_token, id, 'invalid'], [pair.first.session_token, fixtures.history[0]!.petition_id, 'aye']
	]) expect((await post('/api/guilds/petitions/vote', { petition_id, choice }, token as string)).status).toBe(400);
	expect((await post('/api/guilds/petitions/withdraw', { petition_id: id }, pair.first.session_token)).status).toBe(400);
	await db_run('DELETE FROM character_feature_testers WHERE client_id=?', [pair.first_id]);
	expect((await post('/api/guilds/petitions/vote', { petition_id: id, choice: 'aye' }, pair.first.session_token)).status).toBe(400);
	expect(await capture()).toEqual(before);
});


test('Council showcase does not reach older clients even with a character assignment', async () => {
	const pair = await make_guildmates('Council Legacy', 'Council Legacy Other', 'Council Legacy Guild', { first: '1.6.2', second: '1.6.3' });
	await db_run('INSERT INTO character_feature_testers(client_id,feature) VALUES (?,?)', [pair.first_id, 'council']);
	const snapshot = await get_json_with_session<{ petitions: unknown[] }>('/api/guilds/council', pair.first.session_token);
	expect(snapshot.json.petitions).toEqual([]);
	expect((await post('/api/guilds/petitions/vote', { petition_id: council_test_data(0).active[0]!.petition_id, choice: 'aye' }, pair.first.session_token)).status).toBe(400);
});
