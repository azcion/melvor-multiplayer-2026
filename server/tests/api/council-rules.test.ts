import { expect, test } from 'bun:test';
import { make_guild_group, attach_to_free_fellowship, allow_alliance_preview } from '../support/fixtures';
import { post_json, get_json_with_session, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

test('dissolved Guild petitions lapse without blocking Council and Alliance reads', async () => {
	const viewers = await make_guild_group(['Surviving A', 'Surviving B'], 'Surviving Council', '1.6.12');
	await allow_alliance_preview(viewers[0].client_id);
	for (const overdue of [false, true]) {
		const members = await make_guild_group(['Dissolving A', 'Dissolving B', 'Dissolving C'], 'Dissolving Council');
		const raised = await post_json<{ success: boolean; petition_id: number }>('/api/guilds/petitions/raise',
			{ type: 'fellowship' }, members[0].session_token);
		expect(raised.json.success).toBe(true);
		const id = raised.json.petition_id;
		await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'aye' }, members[0].session_token);
		for (const member of members)
			expect((await post_json<{ success: boolean }>('/api/guilds/leave', {}, member.session_token)).json.success).toBe(true);
		expect(await db_all('SELECT id FROM guilds WHERE id=?', [members[0].guild_id])).toEqual([]);
		const now = Date.now();
		await db_run('UPDATE guild_petitions SET created_at=?,expires_at=? WHERE id=?',
			[now - 60000, now + (overdue ? -1000 : 60000), id]);
		for (const path of ['/api/alliances', '/api/guilds/council', '/api/pages/snapshot?page=decisions'])
			expect((await get_json_with_session(path, viewers[0].session_token)).response.status).toBe(200);
		expect(await db_all('SELECT lifecycle,execution_state,subject_locked FROM guild_petitions WHERE id=?', [id]))
			.toEqual([{ lifecycle: 'lapsed', execution_state: 'not_applicable', subject_locked: 0 }]);
		expect(await db_all('SELECT choice FROM guild_petition_votes WHERE petition_id=?', [id])).toEqual([{ choice: 'aye' }]);
		expect(await db_all('SELECT id FROM guild_activity_events WHERE guild_id=?', [members[0].guild_id])).toEqual([]);
	}
	const healthy = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'fellowship' }, viewers[0].session_token);
	const now = Date.now();
	await db_run('UPDATE guild_petitions SET created_at=?,expires_at=? WHERE id=?',
		[now - 60000, now - 1000, healthy.json.petition_id]);
	expect((await get_json_with_session('/api/guilds/council', viewers[0].session_token)).response.status).toBe(200);
	expect(await db_all('SELECT lifecycle,execution_state FROM guild_petitions WHERE id=?', [healthy.json.petition_id]))
		.toEqual([{ lifecycle: 'granted', execution_state: 'succeeded' }]);
});

for (const choice of ['aye', 'nay']) test(`another player's ${choice} locks withdrawal and extends inactivity`, async () => {
	const members = await make_guild_group(['Rules A', 'Rules B', 'Rules C', 'Rules D'], 'Rules Guild');
	await db_run('UPDATE clients SET last_multiplayer_active_at = ? WHERE id = ?', [Date.now() - 5 * 86400000, members[3].client_id]);
	const raised = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', { type: 'appellation', name: 'Rules renamed' }, members[0].session_token);
	const id = raised.json.petition_id;
	expect(await db_all('SELECT rule_version FROM guild_petitions WHERE id = ?', [id])).toEqual([{ rule_version: 2 }]);
	expect((await db_all('SELECT client_id FROM guild_petition_voters WHERE petition_id = ?', [id])).length).toBe(3);
	await db_run('UPDATE guild_petitions SET expires_at = ? WHERE id = ?', [Date.now() + 60000, id]);
	await post_json('/api/guilds/petitions/vote', { petition_id: id, choice }, members[1].session_token);
	const row = (await db_all<{ expires_at: number }>('SELECT expires_at FROM guild_petitions WHERE id = ?', [id]))[0];
	expect(row.expires_at).toBeGreaterThan(Date.now() + 24 * 3600000 - 10000);
	expect(row.expires_at).toBeLessThanOrEqual(Date.now() + 24 * 3600000);
	const withdrawn = await post_json<{ error_lang: string }>('/api/guilds/petitions/withdraw', { petition_id: id }, members[0].session_token);
	expect(withdrawn.json.error_lang).toBe('MOD_MP_COUNCIL_WITHDRAW_FORBIDDEN');
	const view = await get_json_with_session<{ petitions: { can_withdraw: boolean }[] }>('/api/guilds/council', members[0].session_token);
	expect(view.json.petitions[0].can_withdraw).toBe(false);
});

test('own ballot permits withdrawal; legacy Petitions also reset expiry while retaining withdrawal', async () => {
	for (const legacy of [false, true]) {
		const members = await make_guild_group(['Legacy A', 'Legacy B', 'Legacy C', 'Legacy D'], 'Legacy Rules');
		const raised = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', { type: 'appellation', name: 'Legacy renamed' }, members[0].session_token);
		const id = raised.json.petition_id;
		const expiry = Date.now() + 60000;
		await db_run('UPDATE guild_petitions SET rule_version = ?, expires_at = ? WHERE id = ?', [legacy ? 1 : 2, expiry, id]);
		await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'nay' }, members[legacy ? 1 : 0].session_token);
		expect((await db_all('SELECT expires_at FROM guild_petitions WHERE id = ?', [id]))[0].expires_at).toBeGreaterThan(Date.now() + 24 * 3600000 - 10000);
		expect((await post_json<{ success: boolean }>('/api/guilds/petitions/withdraw', { petition_id: id }, members[0].session_token)).json.success).toBe(true);
	}
});

test('raising a Petition invalidates member event snapshots but rejected raises do not', async () => {
	const members = await make_guild_group(['Notify A', 'Notify B'], 'Notify Guild');
	const [outsider] = await make_guild_group(['Notify Outsider'], 'Other Notify Guild');
	const snapshots = await Promise.all([...members, outsider].map(member =>
		get_json_with_session<{ revision: number }>('/api/events', member.session_token)));
	const raised = await post_json<{ success: boolean; petition_id: number }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Notified Guild' }, members[0].session_token);
	expect(raised.json.success).toBe(true);
	for (const [index, member] of members.entries()) {
		const events = await get_json_with_session<{ revision: number; unchanged?: boolean }>(
			`/api/events?revision=${snapshots[index].json.revision}`, member.session_token);
		expect(events.json.unchanged).not.toBe(true);
		expect(events.json.revision).toBeGreaterThan(snapshots[index].json.revision);
	}
	expect((await get_json_with_session<{ unchanged: boolean }>(
		`/api/events?revision=${snapshots[2].json.revision}`, outsider.session_token)).json.unchanged).toBe(true);
	const council = await get_json_with_session<{ petitions: { petition_id: number; can_vote: boolean }[] }>(
		'/api/guilds/council', members[1].session_token);
	expect(council.json.petitions.find(petition => petition.petition_id === raised.json.petition_id)?.can_vote).toBe(true);
	const before_rejection = await get_json_with_session<{ revision: number }>('/api/events', members[1].session_token);
	const duplicate = await post_json<{ error_lang: string }>('/api/guilds/petitions/raise',
		{ type: 'appellation', name: 'Duplicate Guild' }, members[0].session_token);
	expect(duplicate.json.error_lang).toBe('MOD_MP_COUNCIL_CONFLICT');
	expect((await get_json_with_session<{ unchanged: boolean }>(
		`/api/events?revision=${before_rejection.json.revision}`, members[1].session_token)).json.unchanged).toBe(true);
});


test('Free Fellowship votes extend inactivity only up to 36 hours and cannot reopen a capped petition', async () => {
	const members = [];
	for (let i=0;i<4;i++) members.push(await attach_to_free_fellowship(await register_client(`Deadline ${i}`,undefined,'1.6.9')));
	await db_run('UPDATE clients SET last_multiplayer_active_at=? WHERE id IN (?,?,?,?)',[Date.now(),...members.map(m=>m.client_id)]);
	const raised = await post_json<{success:boolean;petition_id:number}>('/api/guilds/petitions/raise', {type:'temperance'}, members[0].session_token);
	expect(raised.json.success).toBe(true);
	const id = raised.json.petition_id, hour = 3600000;
	for (const [index, age] of [2,20,35].entries()) {
		const created = Date.now()-age*hour;
		await db_run('UPDATE guild_petitions SET created_at=?,expires_at=? WHERE id=?',[created,Date.now()+hour,id]);
		const voted = await post_json<{success:boolean}>('/api/guilds/petitions/vote',{petition_id:id,choice:'aye'},members[index].session_token);
		expect(voted.json.success).toBe(true);
		const row = (await db_all<{expires_at:number}>('SELECT expires_at FROM guild_petitions WHERE id=?',[id]))[0];
		if (age<12) {
			expect(row.expires_at).toBeGreaterThan(Date.now()+24*hour-10000);
			expect(row.expires_at).toBeLessThanOrEqual(Date.now()+24*hour);
		} else expect(row.expires_at).toBe(created+36*hour);
	}
	const created = Date.now()-37*hour;
	await db_run('UPDATE guild_petitions SET created_at=?,expires_at=? WHERE id=?',[created,created+36*hour,id]);
	const late = await post_json<{success?:boolean}>('/api/guilds/petitions/vote',{petition_id:id,choice:'nay'},members[3].session_token);
	expect(late.json.success).not.toBe(true);
	expect((await db_all('SELECT COUNT(*) AS n FROM guild_petition_votes WHERE petition_id=?',[id]))[0].n).toBe(3);
	expect((await db_all('SELECT lifecycle FROM guild_petitions WHERE id=?',[id]))[0].lifecycle).toBe('granted');
});
