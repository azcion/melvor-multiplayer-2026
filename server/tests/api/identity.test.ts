import { describe, expect, test } from 'bun:test';
import { get_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

const default_icon = 'melvorD:Plant';

describe('identity API', () => {
	test('registers a client and returns its credentials', async () => {
		const client = await register_client('Identity Test');

		expect(client.client_identifier).toMatch(/^[0-9a-f-]{36}$/);
		expect(client.session_token).toMatch(/^[0-9a-f-]{36}$/);
		expect(client.friend_code).toMatch(/^[0-9]{3}-[0-9]{3}-[0-9]{3}$/);
		expect(client.display_name).toBe('Identity Test');
		expect(client.icon_id).toBe(default_icon);
	});

	test('persists and replaces one bounded client runtime snapshot', async () => {
		const client_key = crypto.randomUUID();
		const registered = await post_json<{
			client_identifier: string;
			session_token: string;
			chat: { client_id: number };
		}>('/api/register', {
			client_key,
			display_name: 'Runtime Snapshot Test',
			client_runtime: {
				mod_version: '1.3.0-beta.1',
				active_mods: ['Multiplayer', 'QoL Mod', 'Multiplayer'],
				game_mode_id: 'melvorF:Adventure'
			}
		});
		expect(registered.response.status).toBe(200);

		let snapshots = await db_all<{
			mod_version: string;
			active_mods: string;
			game_mode_id: string | null;
			reported_at: number;
		}>(
			'SELECT `mod_version`, `active_mods`, `game_mode_id`, `reported_at` FROM `client_runtime_snapshots` WHERE `client_id` = ?',
			[registered.json.chat.client_id]
		);
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.mod_version).toBe('1.3.0-beta.1');
		expect(JSON.parse(snapshots[0]?.active_mods ?? 'null')).toEqual(['Multiplayer', 'QoL Mod']);
		expect(snapshots[0]?.game_mode_id).toBe('melvorF:Adventure');
		expect(snapshots[0]?.reported_at).toBeGreaterThan(0);

		const sessions = await db_all<{ mod_version: string | null }>(
			'SELECT `mod_version` FROM `client_sessions` WHERE `client_id` = ?',
			[registered.json.chat.client_id]
		);
		expect(sessions).toEqual([{ mod_version: '1.3.0-beta.1' }]);

		const authenticated = await post('/api/authenticate', {
			client_identifier: registered.json.client_identifier,
			client_key,
			client_runtime: {
				mod_version: '1.3.0',
				active_mods: ['Multiplayer', 'Compatibility Mod'],
				game_mode_id: 'customMode:Iron_Idler'
			}
		});
		expect(authenticated.status).toBe(200);
		snapshots = await db_all<{
			mod_version: string;
			active_mods: string;
			game_mode_id: string | null;
			reported_at: number;
		}>(
			'SELECT `mod_version`, `active_mods`, `game_mode_id`, `reported_at` FROM `client_runtime_snapshots` WHERE `client_id` = ?',
			[registered.json.chat.client_id]
		);
		expect(snapshots[0]?.mod_version).toBe('1.3.0');
		expect(JSON.parse(snapshots[0]?.active_mods ?? 'null')).toEqual(['Multiplayer', 'Compatibility Mod']);
		expect(snapshots[0]?.game_mode_id).toBe('customMode:Iron_Idler');
	});

	test('keeps runtime reporting optional and rejects malformed snapshots', async () => {
		const legacy = await register_client('Legacy Runtime Test');
		const legacy_sessions = await db_all<{ mod_version: string | null }>(
			'SELECT `mod_version` FROM `client_sessions` WHERE `client_id` = ?',
			[legacy.client_id]
		);
		expect(legacy_sessions).toEqual([{ mod_version: null }]);

		for (const client_runtime of [
			null,
			{ mod_version: 'bad version', active_mods: [] },
			{ mod_version: '1.3.0', active_mods: [''] },
			{ mod_version: '1.3.0', active_mods: ['x'.repeat(129)] },
			{ mod_version: '1.3.0', active_mods: Array.from({ length: 129 }, (_, index) => `Mod ${index}`) },
			{ mod_version: '1.3.0', active_mods: [], game_mode_id: 'not namespaced' },
			{ mod_version: '1.3.0', active_mods: [], game_mode_id: 'x:'.padEnd(258, 'y') },
			{ mod_version: '1.3.0', active_mods: [], game_mode_id: 1 }
		]) {
			const response = await post('/api/register', {
				client_key: crypto.randomUUID(),
				display_name: 'Invalid Runtime',
				client_runtime
			});
			expect(response.status).toBe(400);
		}

		const legacy_runtime = await post_json<{ chat: { client_id: number } }>('/api/register', {
			client_key: crypto.randomUUID(),
			display_name: 'Legacy Runtime Shape',
			client_runtime: { mod_version: '1.2.0', active_mods: ['Multiplayer'] }
		});
		const snapshots = await db_all<{ game_mode_id: string | null }>(
			'SELECT `game_mode_id` FROM `client_runtime_snapshots` WHERE `client_id` = ?',
			[legacy_runtime.json.chat.client_id]
		);
		expect(snapshots).toEqual([{ game_mode_id: null }]);
	});

	test('reports only the operator-controlled released mod version during identity startup', async () => {
		const client = await register_client('Released Version Test');
		await db_run("UPDATE `service_settings` SET `value` = '1.3.0' WHERE `key` = 'released_mod_version'");
		try {
			const authenticated = await post_json<{ released_mod_version: string | null }>('/api/authenticate', {
				client_identifier: client.client_identifier,
				client_key: client.client_key
			});
			expect(authenticated.response.status).toBe(200);
			expect(authenticated.json.released_mod_version).toBe('1.3.0');
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '' WHERE `key` = 'released_mod_version'");
		}
	});

	test('rejects malformed registration credentials', async () => {
		const response = await post('/api/register', {
			client_key: 'not-a-uuid',
			display_name: 'Invalid'
		});

		expect(response.status).toBe(400);
	});

	test('authenticates a registered client and rejects incorrect credentials', async () => {
		const client = await register_client('Authentication Test');
		const invalid = await post('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: crypto.randomUUID(),
			display_name: 'Authentication Test'
		});
		const valid = await post_json<{
			session_token: string;
			friend_code: string;
			display_name: string;
			icon_id: string;
		}>('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: client.client_key,
			display_name: 'Renamed Character'
		});

		expect(invalid.status).toBe(401);
		expect(valid.response.status).toBe(200);
		expect(valid.json.session_token).not.toBe(client.session_token);
		expect(valid.json.display_name).toBe('Authentication Test');
		expect(valid.json.icon_id).toBe(default_icon);
	});

	test('returns the existing friend code when authenticating', async () => {
		const client = await register_client('Friend Code Authentication Test');
		const { response, json } = await post_json<{
			session_token: string;
			friend_code: string;
			icon_id: string;
		}>('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: client.client_key,
			display_name: 'Friend Code Authentication Test'
		});

		expect(response.status).toBe(200);
		expect(json.friend_code).toBe(client.friend_code);
	});

	test('rejects malformed authentication credentials', async () => {
		const response = await post('/api/authenticate', {
			client_identifier: 'not-a-uuid',
			client_key: 'also-not-a-uuid'
		});

		expect(response.status).toBe(400);
	});

	test('validates and persists the selected icon', async () => {
		const client = await register_client('Icon Test');
		const invalid = await post('/api/client/set_icon', {
			icon_id: 'otherMod:Invalid'
		}, client.session_token);
		const valid = await post_json('/api/client/set_icon', {
			icon_id: 'melvorD:Cow'
		}, client.session_token);
		const authenticated = await post_json<{
			session_token: string;
			friend_code: string;
			icon_id: string;
		}>('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: client.client_key,
			display_name: 'Icon Test'
		});

		expect(invalid.status).toBe(400);
		expect(valid.response.status).toBe(200);
		expect(authenticated.response.status).toBe(200);
		expect(authenticated.json.icon_id).toBe('melvorD:Cow');
	});

	test('validates, normalizes, and persists a custom display name', async () => {
		const client = await register_client('Original Character');
		const empty = await post('/api/client/set_display_name', {
			display_name: '   '
		}, client.session_token);
		const too_long = await post('/api/client/set_display_name', {
			display_name: '123456789012345678901'
		}, client.session_token);
		const wrong_type = await post('/api/client/set_display_name', {
			display_name: 123
		}, client.session_token);
		const markup = await post('/api/client/set_display_name', {
			display_name: '<svg/onload=alert()>'
		}, client.session_token);
		const unsupported_punctuation = await post('/api/client/set_display_name', {
			display_name: 'Idler & Friends'
		}, client.session_token);
		const updated = await post_json<{
			success: boolean;
			display_name: string;
		}>('/api/client/set_display_name', {
			display_name: '  Éowyn-7  '
		}, client.session_token);
		const authenticated = await post_json<{
			session_token: string;
			display_name: string;
		}>('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: client.client_key,
			display_name: 'Different Character Name'
		});

		expect(empty.status).toBe(400);
		expect(too_long.status).toBe(400);
		expect(wrong_type.status).toBe(400);
		expect(markup.status).toBe(400);
		expect(unsupported_punctuation.status).toBe(400);
		expect(updated.response.status).toBe(200);
		expect(updated.json).toEqual({
			success: true,
			display_name: 'Éowyn-7'
		});
		expect(authenticated.response.status).toBe(200);
		expect(authenticated.json.display_name).toBe('Éowyn-7');
	});

	test('replaces unsafe registration display names with the safe default', async () => {
		const client = await register_client('<svg/onload=alert()>');
		expect(client.display_name).toBe('Unknown Idler');
	});

	test('invalidates a previously cached session when authenticating again', async () => {
		const client = await register_client('Session Rotation Test');
		const initial = await get_with_session('/api/events', client.session_token);
		const authenticated = await post_json<{
			session_token: string;
		}>('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: client.client_key,
			display_name: 'Session Rotation Test'
		});
		const previous_session = await get_with_session('/api/events', client.session_token);
		const current_session = await get_with_session('/api/events', authenticated.json.session_token);

		expect(initial.status).toBe(200);
		expect(authenticated.response.status).toBe(200);
		expect(previous_session.status).toBe(401);
		expect(current_session.status).toBe(200);
	});

	test('closes registration without blocking existing authentication', async () => {
		const client = await register_client('Closed Registration Authentication');
		await db_run("UPDATE `service_settings` SET `value` = '0' WHERE `key` = 'registrations_open'");
		try {
			const registration = await post('/api/register', {
				client_key: crypto.randomUUID(),
				display_name: 'Closed Registration'
			});
			const authentication = await post('/api/authenticate', {
				client_identifier: client.client_identifier,
				client_key: client.client_key
			});

			expect(registration.status).toBe(503);
			expect(registration.headers.get('Retry-After')).toBe('300');
			expect(authentication.status).toBe(200);
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'registrations_open'");
		}
	});

	test('does not enforce a fixed identity capacity', async () => {
		await db_run(
			"INSERT INTO `service_settings` (`key`, `value`) VALUES ('max_identities', '1') " +
			'ON CONFLICT (`key`) DO UPDATE SET `value` = excluded.`value`'
		);
		try {
			const response = await post('/api/register', {
				client_key: crypto.randomUUID(),
				display_name: 'Uncapped Registration'
			});

			expect(response.status).toBe(200);
		} finally {
			await db_run("DELETE FROM `service_settings` WHERE `key` = 'max_identities'");
		}
	});

	test('rejects disabled identities and their existing sessions', async () => {
		const client = await register_client('Disabled Identity');
		await db_run(
			'UPDATE `clients` SET `disabled` = 1 WHERE `client_identifier` = ?',
			[client.client_identifier]
		);
		try {
			const session = await get_with_session('/api/events', client.session_token);
			const authentication = await post('/api/authenticate', {
				client_identifier: client.client_identifier,
				client_key: client.client_key
			});

			expect(session.status).toBe(401);
			expect(authentication.status).toBe(403);
		} finally {
			await db_run(
				'UPDATE `clients` SET `disabled` = 0 WHERE `client_identifier` = ?',
				[client.client_identifier]
			);
		}
	});
});
