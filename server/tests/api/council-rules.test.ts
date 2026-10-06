import { expect, test } from 'bun:test';
import { make_guild_group } from '../support/fixtures';
import { post_json, get_json_with_session } from '../support/http';
import { db_all, db_run } from '../support/persistence';

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
	expect(row.expires_at).toBeGreaterThan(Date.now() + 86300000);
	const withdrawn = await post_json<{ error_lang: string }>('/api/guilds/petitions/withdraw', { petition_id: id }, members[0].session_token);
	expect(withdrawn.json.error_lang).toBe('MOD_MP_COUNCIL_WITHDRAW_FORBIDDEN');
	const view = await get_json_with_session<{ petitions: { can_withdraw: boolean }[] }>('/api/guilds/council', members[0].session_token);
	expect(view.json.petitions[0].can_withdraw).toBe(false);
});

test('own ballot permits withdrawal; legacy Petitions retain fixed expiry and withdrawal', async () => {
	for (const legacy of [false, true]) {
		const members = await make_guild_group(['Legacy A', 'Legacy B', 'Legacy C', 'Legacy D'], 'Legacy Rules');
		const raised = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', { type: 'appellation', name: 'Legacy renamed' }, members[0].session_token);
		const id = raised.json.petition_id;
		const expiry = Date.now() + 60000;
		await db_run('UPDATE guild_petitions SET rule_version = ?, expires_at = ? WHERE id = ?', [legacy ? 1 : 2, expiry, id]);
		await post_json('/api/guilds/petitions/vote', { petition_id: id, choice: 'nay' }, members[legacy ? 1 : 0].session_token);
		if (legacy) expect((await db_all('SELECT expires_at FROM guild_petitions WHERE id = ?', [id]))[0].expires_at).toBe(expiry);
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
