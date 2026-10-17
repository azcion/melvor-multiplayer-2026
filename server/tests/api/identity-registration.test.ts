import { expect, test } from 'bun:test';
import { get_with_session, post, post_json } from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

function payload() {
	return { registration_id: crypto.randomUUID(), client_key: crypto.randomUUID(), display_name: 'Registration Retry',
		cloud_username: 'Retry Player', playfab_id: crypto.randomUUID(),
		client_runtime: { mod_version: '1.6.15', active_mods: [] } };
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

test('legacy callers still receive distinct generated identifiers; accountless replay works', async () => {
	const { registration_id, ...legacy } = payload();
	const first = await post_json<any>('/api/register', legacy), second = await post_json<any>('/api/register', legacy);
	expect(first.response.status).toBe(200); expect(second.response.status).toBe(200);
	expect(first.json.client_identifier).not.toBe(second.json.client_identifier);
	const accountless = { registration_id, client_key: crypto.randomUUID(), client_runtime: legacy.client_runtime };
	expect((await post('/api/register', accountless)).status).toBe(200);
	expect((await post('/api/register', accountless)).status).toBe(409);
});
