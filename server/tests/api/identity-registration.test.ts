import { expect, test } from 'bun:test';
import { get_with_session, post, post_json } from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

function payload() {
	return { registration_id: crypto.randomUUID(), client_key: crypto.randomUUID(), display_name: 'Registration Retry',
		cloud_username: 'Retry Player', playfab_id: crypto.randomUUID(),
		client_runtime: { mod_version: '1.7.0', active_mods: [] } };
}

test('advertises replay-safe registration and validates optional identifiers', async () => {
	expect(((await (await get_with_session('/api/versions', '')).json()) as { capabilities: string[] }).capabilities).toContain('identity-registration-v1');
	for (const registration_id of [null, 42, '', 'not-a-uuid']) expect((await post('/api/register', { ...payload(), registration_id })).status).toBe(400);
});

test('concurrent retry creates exactly one identity and preserves preferences and audit history', async () => {
	const input = payload();
	const responses = await Promise.all([post('/api/register', input), post('/api/register', input)]);
	expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
	const created = await responses.find(r => r.status === 200)!.json() as any;
	expect(created.client_identifier).toBe(input.registration_id);
	expect(await db_count('SELECT COUNT(*) AS count FROM clients WHERE client_identifier = ?', [input.registration_id])).toBe(1);
	expect(await db_count("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = 'identity.registered' AND actor_client_id = ?", [created.chat.client_id])).toBe(1);
	await db_run('UPDATE clients SET display_name = ?, equipment_visible = 0 WHERE id = ?', ['Retained Name', created.chat.client_id]);
	const replay = await post('/api/register', { ...input, display_name: 'Replacement Name', cloud_username: 'Changed Label' });
	expect(replay.status).toBe(409);
	expect(await replay.json()).toEqual({ identity_status: 'registration_exists' });
	const authenticated = await post_json<any>('/api/authenticate', { ...input, client_identifier: input.registration_id });
	expect(authenticated.response.status).toBe(200);
	expect(authenticated.json.display_name).toBe('Retained Name');
	expect(authenticated.json.equipment_visible).toBe(false);
	const automatic_replay = await post('/api/register', { ...input, check_existing_profile: true });
	expect(automatic_replay.status).toBe(409);
	expect(await automatic_replay.json()).toEqual({ identity_status: 'registration_exists' });
});

test('replays cannot replace proof, account association or disabled/deleted identities', async () => {
	const input = payload();
	const created = await post_json<any>('/api/register', input);
	for (const replacement of [{ client_key: crypto.randomUUID() }, { playfab_id: crypto.randomUUID() }, { playfab_id: undefined, cloud_username: undefined }]) {
		expect((await post('/api/register', { ...input, ...replacement })).status).toBe(401);
	}
	for (const column of ['disabled', 'deleted_at']) {
		await db_run(`UPDATE clients SET ${column} = 1 WHERE id = ?`, [created.json.chat.client_id]);
		expect((await post('/api/register', input)).status).toBe(401);
		await db_run(`UPDATE clients SET ${column} = ? WHERE id = ?`, [column === 'disabled' ? 0 : null, created.json.chat.client_id]);
	}
	const rows = await db_all<{ client_key: string }>('SELECT client_key FROM clients WHERE client_identifier = ?', [input.registration_id]);
	expect(rows).toEqual([{ client_key: input.client_key }]);
});

test('existing proof authenticates and replays across normalized PlayFab ID casing', async () => {
	const input = { ...payload(), playfab_id: crypto.randomUUID().toLowerCase() };
	expect((await post('/api/register', input)).status).toBe(200);
	const normalized = { ...input, playfab_id: ` ${input.playfab_id.toUpperCase()} ` };
	const replay = await post('/api/register', normalized);
	expect(replay.status).toBe(409);
	expect(await replay.json()).toEqual({ identity_status: 'registration_exists' });
	expect((await post('/api/authenticate', { ...normalized, client_identifier: input.registration_id })).status).toBe(200);
});

test('legacy callers still receive distinct generated identifiers; accountless replay works', async () => {
	const { registration_id, ...legacy } = payload();
	const first = await post_json<any>('/api/register', legacy), second = await post_json<any>('/api/register', legacy);
	expect(first.response.status).toBe(200); expect(second.response.status).toBe(200);
	expect(first.json.client_identifier).not.toBe(second.json.client_identifier);
	const accountless = { registration_id, client_key: crypto.randomUUID(), client_runtime: legacy.client_runtime };
	expect((await post('/api/register', accountless)).status).toBe(200);
	expect((await post('/api/register', accountless)).status).toBe(409);
});


test('automatic onboarding prompts only for the normalized account and exact character name', async () => {
	const original = { ...payload(), playfab_id: crypto.randomUUID().toUpperCase(), display_name: 'Returning Player' };
	const created = await post_json<any>('/api/register', original);
	expect(created.response.status).toBe(200);
	const attempt = { ...payload(), playfab_id: `  ${original.playfab_id.toLowerCase()}  `,
		display_name: 'Returning Player', check_existing_profile: true };
	const match = await post('/api/register', attempt);
	expect(match.status).toBe(409);
	expect(await match.json()).toEqual({ identity_status: 'recovery_required' });
	await db_run('UPDATE clients SET display_name = ? WHERE id = ?', ['Renamed Profile', created.json.chat.client_id]);
	expect((await post('/api/register', attempt)).status).toBe(409);
	expect(await db_count('SELECT COUNT(*) AS count FROM clients WHERE client_identifier = ?', [attempt.registration_id])).toBe(0);
	// A known account alone, or a matching name on another account, is insufficient.
	for (const input of [{ ...attempt, display_name: 'Another Character' }, { ...attempt, display_name: 'returning player' }, { ...attempt, playfab_id: crypto.randomUUID() },
		{ ...attempt, playfab_id: undefined, cloud_username: undefined }]) {
		expect((await post('/api/register', { ...input, registration_id: crypto.randomUUID() })).status).toBe(200);
	}
	// Explicit confirmation can create a separate profile; it never authenticates the old one.
	const confirmed = await post_json<any>('/api/register', { ...attempt, check_existing_profile: false });
	expect(confirmed.response.status).toBe(200);
	expect(confirmed.json.client_identifier).toBe(attempt.registration_id);
	expect(confirmed.json.chat.client_id).not.toBe(created.json.chat.client_id);
});

test('automatic onboarding serializes competing creates', async () => {
	const input = { ...payload(), check_existing_profile: true };
	const responses = await Promise.all([post('/api/register', input),
		post('/api/register', { ...input, registration_id: crypto.randomUUID(), client_key: crypto.randomUUID() })]);
	expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
	expect(await responses.find(r => r.status === 409)!.json()).toEqual({ identity_status: 'recovery_required' });
});

test('automatic onboarding retains exact native names independently of display-name validation', async () => {
	for (const character_name of [' Alice ', 'A'.repeat(21), 'Alice!', '🧙']) {
		const input = { ...payload(), display_name: character_name, character_name, check_existing_profile: true };
		const responses = await Promise.all([post('/api/register', input), post('/api/register', {
			...input, registration_id: crypto.randomUUID(), client_key: crypto.randomUUID()
		})]);
		expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
		expect(await responses.find(response => response.status === 409)!.json()).toEqual({ identity_status: 'recovery_required' });
		const created = await responses.find(response => response.status === 200)!.json() as any;
		const id = created.chat.client_id;
		expect(await db_all('SELECT registration_character_name FROM clients WHERE id=?', [id]))
			.toEqual([{ registration_character_name: character_name }]);
		expect(await db_count('SELECT COUNT(*) AS count FROM verified_identity_accounts WHERE client_id=?', [id])).toBe(0);
		await db_run('UPDATE clients SET display_name=? WHERE id=?', ['New Profile Name', id]);
		const retry = await post('/api/register', { ...input, registration_id: crypto.randomUUID() });
		expect(retry.status).toBe(409);
		expect(await retry.json()).toEqual({ identity_status: 'recovery_required' });
	}
});

test('disabled and deleted matching profiles still prevent silent duplicate creation', async () => {
	const input = payload(), created = await post_json<any>('/api/register', input);
	for (const column of ['disabled', 'deleted_at']) {
		await db_run(`UPDATE clients SET ${column} = 1 WHERE id = ?`, [created.json.chat.client_id]);
		const blocked = await post('/api/register', { ...input, registration_id: crypto.randomUUID(), check_existing_profile: true });
		expect(blocked.status).toBe(409);
		expect(await blocked.json()).toEqual({ identity_status: 'recovery_required' });
		await db_run(`UPDATE clients SET ${column} = ? WHERE id = ?`, [column === 'disabled' ? 0 : null, created.json.chat.client_id]);
	}
	for (const check_existing_profile of [null, 1, 'true'])
		expect((await post('/api/register', { ...payload(), check_existing_profile })).status).toBe(400);
});

test('account recovery routes are capability-gated, protected, uncached and do not trust claimed account IDs', async () => {
	const capabilities = await (await get_with_session('/api/versions', '')).json() as { capabilities: string[] };
	expect(capabilities.capabilities).toContain('identity-account-recovery-v1');
	for (const action of ['enroll', 'disable'])
		expect((await post('/api/identity-recovery/' + action, {})).status).toBe(401);
	for (const action of ['list', 'connect']) {
		const response = await post('/api/identity-recovery/' + action, {
			melvor_token: 'not-a-token', character_name: 'Exact Character', client_id: 1,
			playfab_id: 'CLAIMED-ID', cloud_username: 'Claimed Account'
		});
		expect(response.status).toBe(422);
		expect(response.headers.get('Cache-Control')).toBe('no-store');
		expect(await response.json()).toEqual({ error: 'account_recovery_failed' });
	}
	const input = payload(), created = await post_json<any>('/api/register', input);
	const own_id = created.json.chat.client_id;
	// Simulate an existing verified binding to exercise only authenticated revocation wiring.
	await db_run('INSERT INTO verified_identity_accounts(client_id,playfab_id,character_name,verified_at) VALUES(?,?,?,?)',
		[own_id, input.playfab_id.toUpperCase(), 'Exact Character', Date.now()]);
	const revoked = await post('/api/identity-recovery/disable', {}, created.json.session_token);
	expect(revoked.status).toBe(200);
	expect(await db_count('SELECT COUNT(*) AS count FROM verified_identity_accounts WHERE client_id=?', [own_id])).toBe(0);
	const [state] = await db_all<{ account_recovery_revocation: string }>('SELECT account_recovery_revocation FROM clients WHERE id=?', [own_id]);
	expect(state.account_recovery_revocation).toMatch(/^[0-9a-f-]{36}$/);
});
