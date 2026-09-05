import { expect, test } from 'bun:test';
import { post, post_json, get_with_session } from '../support/http';
import { db_all, db_run } from '../support/persistence';

async function new_client() {
	const client_key = crypto.randomUUID();
	const installation_id = crypto.randomUUID();
	const registered = await post_json<any>('/api/register', { client_key, display_name: 'Installations',
		client_runtime: { mod_version: '1.5.1', active_mods: [], device: { installation_id, platform: 'android' } } });
	return { ...registered.json, client_key, installation_id, installation_key: crypto.randomUUID() };
}
async function enroll(client: any) {
	return post('/api/installations/enroll', { installation_id: client.installation_id, installation_key: client.installation_key }, client.session_token);
}
function installation_auth(client: any, extra = {}) {
	return post('/api/authenticate', { client_identifier: client.client_identifier,
		installation_id: client.installation_id, installation_key: client.installation_key, ...extra });
}

test('enrollment is authenticated and replay-safe; installation IDs alone are not credentials', async () => {
	const client = await new_client();
	expect(client.installation_auth_supported).toBe(true);
	expect((await post('/api/installations/enroll', { installation_id: client.installation_id, installation_key: client.installation_key })).status).toBe(401);
	expect((await enroll(client)).status).toBe(200);
	expect((await enroll(client)).status).toBe(200);
	const hashes = await db_all<any>('SELECT credential_hash FROM installation_credentials WHERE client_id = ?', [client.chat.client_id]);
	expect(hashes[0].credential_hash).not.toBe(client.installation_key);
	expect(hashes[0].credential_hash).toHaveLength(64);
	expect((await installation_auth(client, { installation_key: crypto.randomUUID(), client_key: client.client_key })).status).toBe(401);
	expect((await installation_auth(client, { installation_key: undefined })).status).toBe(401);
	const authenticated = await installation_auth(client);
	expect(authenticated.status).toBe(200);
	const current = await authenticated.json() as any;
	expect((await get_with_session('/api/events', current.session_token)).status).toBe(200);
	const replaced = await get_with_session('/api/events', client.session_token);
	expect(replaced.status).toBe(401);
	expect(replaced.headers.get('X-Multiplayer-Session-State')).toBe('replaced');
});

test('independent installations remain connected and same-installation authentication replaces only its session', async () => {
	const first = await new_client();
	await enroll(first);
	const second = { ...first, installation_id: crypto.randomUUID(), installation_key: crypto.randomUUID() };
	const legacy = await post_json<any>('/api/authenticate', { client_identifier: first.client_identifier, client_key: first.client_key,
		client_runtime: { mod_version: '1.5.1', active_mods: [], device: { installation_id: second.installation_id } } });
	second.session_token = legacy.json.session_token;
	expect((await enroll(second)).status).toBe(200);
	const attempts = await Promise.all([installation_auth(first), installation_auth(second)]);
	const connected = [];
	for (const response of attempts) {
		expect(response.status).toBe(200);
		connected.push((await response.json() as any).session_token);
	}
	for (const token of connected) expect((await get_with_session('/api/events', token)).status).toBe(200);
	const first_reconnected = await installation_auth(first);
	expect(first_reconnected.status).toBe(200);
	expect((await get_with_session('/api/events', connected[0])).status).toBe(401);
	expect((await get_with_session('/api/events', connected[1])).status).toBe(200);
	const sessions = await db_all<any>('SELECT COUNT(*) AS count FROM client_sessions WHERE client_id = ?', [first.chat.client_id]);
	expect(sessions[0].count).toBe(2);
	const creds = await db_all<any>('SELECT COUNT(*) AS count FROM installation_credentials WHERE client_id = ?', [first.chat.client_id]);
	expect(creds[0].count).toBe(2);
	const legacy_again = await post('/api/authenticate', { client_identifier: first.client_identifier, client_key: first.client_key });
	expect(legacy_again.status).toBe(200);
	expect((await get_with_session('/api/events', connected[1])).status).toBe(200);
	await db_run('UPDATE installation_credentials SET revoked_at = 1 WHERE client_id = ? AND installation_id = ?', [first.chat.client_id, first.installation_id]);
	const revoked = await installation_auth(first);
	expect(revoked.status).toBe(403);
	expect((await revoked.json() as any).identity_status).toBe('installation_revoked');
	expect((await installation_auth(second)).status).toBe(200);
});

test('session caches honor host-side deletion and enrollment cannot cross identities', async () => {
	const client = await new_client();
	const other = await new_client();
	expect((await enroll(client)).status).toBe(200);
	expect((await installation_auth(client, { client_identifier: other.client_identifier })).status).toBe(401);
	expect((await post('/api/installations/enroll', { installation_id: client.installation_id, installation_key: client.installation_key }, other.session_token)).status).toBe(400);
	const authenticated = await installation_auth(client);
	const current = await authenticated.json() as any;
	expect((await get_with_session('/api/events', current.session_token)).status).toBe(200);
	await db_run('DELETE FROM client_sessions WHERE client_id = ?', [client.chat.client_id]);
	expect((await get_with_session('/api/events', current.session_token)).status).toBe(401);
});

test('operator revocation removes an active installation session without exposing its key', async () => {
	const client = await new_client();
	await enroll(client);
	await enroll(client);
	expect((await get_with_session('/api/events', client.session_token)).status).toBe(200);
	const child = Bun.spawn({ cmd: [process.execPath, 'run', 'admin.ts', 'installation', 'revoke', String(client.chat.client_id), client.installation_id],
		env: { ...process.env, DB_PATH: process.env.TEST_DB_PATH }, stdout: 'pipe', stderr: 'pipe' });
	const [code, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
	expect(code).toBe(0);
	expect(output).not.toContain(client.installation_key);
	const stopped = await get_with_session('/api/events', client.session_token);
	expect(stopped.status).toBe(401);
	expect(stopped.headers.get('X-Multiplayer-Session-State')).toBeNull();
	expect((await installation_auth(client)).status).toBe(403);
});

test('retained installation credentials allow the existing soft-deletion recovery flow', async () => {
	const client = await new_client();
	await enroll(client);
	await db_run('UPDATE clients SET deleted_at = 1 WHERE id = ?', [client.chat.client_id]);
	await db_run('DELETE FROM client_installations WHERE client_id = ?', [client.chat.client_id]);
	await db_run('DELETE FROM client_sessions WHERE client_id = ?', [client.chat.client_id]);
	const response = await installation_auth(client);
	expect(response.status).toBe(200);
	expect((await response.json() as any).identity_recovered).toBe(true);
});
