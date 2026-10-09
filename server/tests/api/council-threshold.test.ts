import { expect, test } from 'bun:test';
import { make_guild_group, allow_alliance_preview } from '../support/fixtures';
import { post_json, get_json_with_session, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

type Petition = { petition_id: number; eligible: boolean; can_vote: boolean; lifecycle: string;
	tally_visible: boolean; tally?: { eligible: number; required_aye: number; required_nay: number; snapshot_active: number; aye: number; nay: number; uncast: number } };
async function council(client: { session_token: string }, id: number) {
	const response = await get_json_with_session<{ petitions: Petition[] }>('/api/guilds/council', client.session_token);
	return response.json.petitions.find(p => p.petition_id === id)!;
}
async function vote(client: { session_token: string }, id: number, choice: 'aye' | 'nay') {
	return (await post_json<{ success?: boolean; lifecycle?: string; error_lang?: string }>(
		'/api/guilds/petitions/vote', { petition_id: id, choice }, client.session_token)).json;
}

for (const choice of ['aye', 'nay'] as const) test(`locked threshold: returning and new members, departures, and cast-majority ${choice} at the deadline`, async () => {
	const members = await make_guild_group(Array.from({ length: 12 }, (_, i) => `Threshold ${choice} ${i}`), `Threshold ${choice}`);
	const guild_id = members[0].guild_id;
	for (const member of members.slice(6))
		await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?', [Date.now() - 10 * 86400000, member.client_id]);
	const raised = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: `Threshold ${choice} won` }, members[0].session_token);
	const id = raised.json.petition_id;
	expect(await db_all('SELECT snapshot_active_count,voting_threshold FROM guild_petitions WHERE id=?', [id]))
		.toEqual([{ snapshot_active_count: 6, voting_threshold: 3 }]);
	const returning = await council(members[6], id);
	expect(returning.can_vote).toBe(true);
	expect(returning.tally_visible).toBe(false);
	expect(returning).not.toHaveProperty('tally');
	// Departures do not adjust either requirement. A departed member cannot vote.
	await db_run('DELETE FROM guild_memberships WHERE client_id IN (?,?)', [members[4].client_id, members[5].client_id]);
	expect((await vote(members[4], id, choice)).success).not.toBe(true);
	const newcomer = await register_client(`New ${choice}`);
	await post_json('/api/guilds/apply', { guild_id }, newcomer.session_token);
	const application = (await db_all<{ id: number }>('SELECT id FROM guild_applications WHERE client_id=?', [newcomer.client_id]))[0];
	await post_json('/api/guilds/application/decide', { application_id: application.id, approve: true }, members[0].session_token);
	expect((await council(newcomer, id)).can_vote).toBe(false);
	expect((await vote(newcomer, id, choice)).error_lang).toBe('MOD_MP_COUNCIL_INELIGIBLE');
	await db_run('UPDATE guild_memberships SET joined_at=? WHERE client_id=?', [Date.now() - 20 * 3600000, newcomer.client_id]);
	expect((await council(newcomer, id)).can_vote).toBe(true);
	expect((await vote(members[0], id, 'aye')).lifecycle).toBe('active');
	expect((await vote(members[1], id, 'aye')).lifecycle).toBe('active');
	expect((await vote(members[6], id, 'nay')).lifecycle).toBe('active');
	expect((await vote(members[7], id, 'nay')).lifecycle).toBe('active');
	const visible = await council(members[6], id);
	expect(visible.tally).toMatchObject({ snapshot_active: 6, required_aye: 3, required_nay: 3, aye: 2, nay: 2 });
	expect(visible.tally!.uncast).toBeGreaterThanOrEqual(0);
	expect((await vote(members[6], id, choice)).error_lang).toBe('MOD_MP_COUNCIL_ALREADY_VOTED');
	expect((await council(newcomer, id)).tally_visible).toBe(false);
	expect((await vote(newcomer, id, choice)).lifecycle).toBe('active');
	await db_run('UPDATE guild_petitions SET expires_at=? WHERE id=?', [Date.now(), id]);
	expect((await council(members[0], id)).lifecycle).toBe(choice === 'aye' ? 'granted' : 'denied');
	expect((await vote(members[8], id, choice === 'aye' ? 'nay' : 'aye')).error_lang).toBe('MOD_MP_COUNCIL_PETITION_FINAL');
	expect(await db_all('SELECT snapshot_active_count,voting_threshold FROM guild_petitions WHERE id=?', [id]))
		.toEqual([{ snapshot_active_count: 6, voting_threshold: 3 }]);
});

test('leaving and rejoining resets the wait, keeps the ballot, and does not expose an uncast tally', async () => {
	const members = await make_guild_group(['Rejoin A', 'Rejoin B', 'Rejoin C', 'Rejoin D', 'Rejoin E', 'Rejoin F'], 'Rejoin threshold');
	const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Rejoin renamed' }, members[0].session_token)).json.petition_id;
	await vote(members[1], id, 'aye');
	await db_run('DELETE FROM guild_memberships WHERE client_id=?', [members[1].client_id]);
	await db_run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(?,?)', [members[1].client_id, members[0].guild_id]);
	expect((await council(members[1], id)).can_vote).toBe(false);
	expect((await council(members[1], id)).tally_visible).toBe(true);
	await db_run('UPDATE guild_memberships SET joined_at=? WHERE client_id=?', [Date.now() - 20 * 3600000, members[1].client_id]);
	expect((await vote(members[1], id, 'nay')).error_lang).toBe('MOD_MP_COUNCIL_ALREADY_VOTED');
	await db_run('DELETE FROM guild_memberships WHERE client_id=?', [members[2].client_id]);
	await db_run('INSERT INTO guild_memberships(client_id,guild_id) VALUES(?,?)', [members[2].client_id, members[0].guild_id]);
	expect((await council(members[2], id)).can_vote).toBe(false);
	expect((await council(members[2], id))).not.toHaveProperty('tally');
});

test('Alliance Council ballots use cast-majority closure and returning-member eligibility', async () => {
	const members = await make_guild_group(['Alliance threshold A', 'Alliance threshold B', 'Alliance returning'], 'Alliance threshold', '1.6.3');
	for (const member of members) await allow_alliance_preview(member.client_id);
	const target = await make_guild_group(['Alliance target'], 'Alliance target', '1.6.3');
	await allow_alliance_preview(target[0].client_id);
	await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id=?', [Date.now() - 8 * 86400000, members[2].client_id]);
	const proposed = await post_json<{ petition_id: number; process_id: number }>('/api/alliances/propose',
		{ kind: 'found', name: 'Threshold Alliance', target_id: target[0].guild_id }, members[0].session_token);
	expect(await db_all('SELECT snapshot_active_count,voting_threshold FROM guild_petitions WHERE id=?', [proposed.json.petition_id]))
		.toEqual([{ snapshot_active_count: 2, voting_threshold: 1 }]);
	expect((await council(members[2], proposed.json.petition_id)).can_vote).toBe(true);
	expect((await vote(members[2], proposed.json.petition_id, 'nay')).lifecycle).toBe('active');
	await db_run('UPDATE guild_petitions SET expires_at=? WHERE id=?', [Date.now(), proposed.json.petition_id]);
	expect((await council(members[0], proposed.json.petition_id)).lifecycle).toBe('denied');
	expect((await db_all<{ stage: string }>('SELECT stage FROM alliance_processes WHERE id=?', [proposed.json.process_id]))[0].stage).toBe('denied');
});

test('opposing concurrent deciding ballots produce one immutable result', async () => {
	const members = await make_guild_group(['Race threshold A', 'Race threshold B', 'Race threshold C', 'Race threshold D'], 'Race threshold');
	const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Race resolved' }, members[0].session_token)).json.petition_id;
	expect((await vote(members[0], id, 'aye')).lifecycle).toBe('active');
	expect((await vote(members[1], id, 'nay')).lifecycle).toBe('active');
	const deciding = await Promise.all([vote(members[2], id, 'aye'), vote(members[3], id, 'nay')]);
	expect(deciding.filter(result => result.success)).toHaveLength(2);
	expect(deciding.filter(result => result.error_lang === 'MOD_MP_COUNCIL_PETITION_FINAL')).toHaveLength(0);
	const row = (await db_all<{ lifecycle: string }>('SELECT lifecycle FROM guild_petitions WHERE id=?', [id]))[0];
	expect(row.lifecycle).toBe('denied');
	expect((await db_all('SELECT choice FROM guild_petition_votes WHERE petition_id=?', [id]))).toHaveLength(4);
});

test('pre-cutover petitions retain eligibility but use cast totals at closure', async () => {
	const members = await make_guild_group(['Legacy threshold A', 'Legacy threshold B', 'Legacy threshold C', 'Legacy threshold D', 'Legacy returning'], 'Legacy threshold');
	const now = Date.now();
	await db_run(`INSERT INTO guild_petitions(guild_id,guild_name,type,conflict_subject,petitioner_id,proposed_name,created_at,expires_at,rule_version)
		VALUES(?,'Legacy threshold','appellation','guild:name',?,'Legacy renamed',?,?,2)`,
		[members[0].guild_id, members[0].client_id, now, now + 48 * 3600000]);
	const id = (await db_all<{ id: number }>('SELECT id FROM guild_petitions WHERE guild_id=?', [members[0].guild_id]))[0].id;
	for (const member of members.slice(0, 4)) await db_run('INSERT INTO guild_petition_voters VALUES(?,?)', [id, member.client_id]);
	expect((await council(members[4], id)).can_vote).toBe(false);
	expect((await vote(members[4], id, 'aye')).error_lang).toBe('MOD_MP_COUNCIL_INELIGIBLE');
	expect((await vote(members[0], id, 'nay')).lifecycle).toBe('active');
	expect((await vote(members[1], id, 'nay')).lifecycle).toBe('active');
	expect((await vote(members[2], id, 'nay')).lifecycle).toBe('active');
	expect((await vote(members[3], id, 'aye')).lifecycle).toBe('denied');
});

for (const tie of [false, true]) test(`deadline resolves sparse turnout as ${tie ? 'denied tie' : 'granted majority'} and rejects late ballots`, async () => {
	const members = await make_guild_group(['Sparse A', 'Sparse B', 'Sparse C', 'Sparse D', 'Sparse E', 'Sparse F'], 'Sparse turnout');
	const id = (await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Sparse renamed' }, members[0].session_token)).json.petition_id;
	expect((await vote(members[0], id, 'aye')).lifecycle).toBe('active');
	if (tie) expect((await vote(members[1], id, 'nay')).lifecycle).toBe('active');
	await db_run('UPDATE guild_petitions SET expires_at=? WHERE id=?', [Date.now(), id]);
	expect((await vote(members[2], id, 'aye')).error_lang).toBe('MOD_MP_COUNCIL_PETITION_FINAL');
	expect((await council(members[2], id)).lifecycle).toBe(tie ? 'denied' : 'granted');
	expect(await db_all('SELECT execution_state,subject_locked FROM guild_petitions WHERE id=?', [id]))
		.toEqual([{ execution_state: tie ? 'not_applicable' : 'succeeded', subject_locked: 0 }]);
	expect(await db_all('SELECT COUNT(*) AS count FROM guild_activity_events WHERE source_key=?', [`petition:${id}:${tie ? 'denied' : 'granted'}`]))
		.toEqual([{ count: 1 }]);
	expect(await db_all('SELECT COUNT(*) AS count FROM guild_petition_votes WHERE petition_id=?', [id]))
		.toEqual([{ count: tie ? 2 : 1 }]);
});
