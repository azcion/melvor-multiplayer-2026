import { expect, test } from 'bun:test';
import { post_json, get_with_session } from '../support/http';
import { db_all } from '../support/persistence';

test('new diagnostics are bounded, session-specific, and optional for legacy clients', async () => {
	const client_key = crypto.randomUUID();
	const installation_id = crypto.randomUUID();
	const device = { installation_id, platform: 'android', engine: 'gecko', distribution: 'google_play', app_channel: 'beta', secret: 'MUST-NOT-PERSIST' };
	const registered = await post_json<any>('/api/register', { client_key, display_name: 'Diagnostics',
		client_runtime: { mod_version: '1.4.5', active_mods: [], device } });
	expect(registered.response.status).toBe(200);
	const client_id = registered.json.chat.client_id;
	const installations = await db_all<any>('SELECT device_diagnostics FROM client_installations WHERE client_id = ?', [client_id]);
	expect(installations).toHaveLength(1);
	expect(JSON.parse(installations[0].device_diagnostics).app_channel).toBe('beta');
	expect(installations[0].device_diagnostics).not.toContain('MUST-NOT-PERSIST');
	const sessions = await db_all<any>('SELECT device_diagnostics FROM client_sessions WHERE client_id = ?', [client_id]);
	expect(sessions[0].device_diagnostics).toBe(installations[0].device_diagnostics);
	const legacy = await post_json<any>('/api/authenticate', { client_key, client_identifier: registered.json.client_identifier,
		client_runtime: { mod_version: '1.4.4', active_mods: [] } });
	expect(legacy.response.status).toBe(200);
	const legacy_sessions = await db_all<any>('SELECT device_diagnostics FROM client_sessions WHERE client_id = ?', [client_id]);
	expect(legacy_sessions[0].device_diagnostics).toBeNull();
	expect((await get_with_session('/api/events', legacy.json.session_token)).status).toBe(200);
	const malformed = await post_json<any>('/api/authenticate', { client_key, client_identifier: registered.json.client_identifier,
		client_runtime: { mod_version: '1.4.5', active_mods: [], device: { installation_id: 'invalid' } } });
	expect(malformed.response.status).toBe(200);
});
