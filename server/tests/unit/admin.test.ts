import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create_test_database } from '../support/database';

const temporary_directories: string[] = [];

function fixture_database(): string {
	const directory = mkdtempSync(join(tmpdir(), 'melvor-admin-test-'));
	temporary_directories.push(directory);
	const database_path = join(directory, 'database.sqlite');
	const database = create_test_database(database_path);

	database.query(
		'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
		'VALUES (?, ?, ?, ?, ?)'
	).run(crypto.randomUUID(), crypto.randomUUID(), '123-456-789', 'Diagnostic Idler', 'melvorD:Plant');
	database.query('INSERT INTO `client_sessions` (`session_token`, `client_id`) VALUES (?, 1)').run('secret-session');
	database.query('INSERT INTO `guilds` (`name`, `icon_id`) VALUES (?, ?)').run('Diagnostic Guild', 'melvorD:Farmlands');
	database.query('INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES (1, 2)').run();
	database.query(
		'INSERT INTO `client_runtime_snapshots` (`client_id`, `mod_version`, `active_mods`, `game_mode_id`, `language`, `reported_at`) ' +
		'VALUES (1, ?, ?, ?, ?, ?)'
	).run('1.4.5', '["Melvor Multiplayer", "Test Mod"]', 'melvor:standard', 'en-US', 1700000000000);
	const campaign = database.query(
		'INSERT INTO `campaign_state` (`guild_id`, `campaign_id`, `item_id`, `item_amount`, `item_current`, ' +
		'`required_contributors`, `auto_contribution`, `campaign_next`, `complete`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
	).run(2, 'Diagnostic Campaign', 'melvorD:Logs', 100, 25, 1, 5, 1700003600000, 0);
	database.query(
		'INSERT INTO `campaign_contributions` (`campaign_id`, `client_id`, `item_amount`, `taken`) VALUES (?, ?, ?, ?)'
	).run(Number(campaign.lastInsertRowid), 1, 20, 0);
	database.query(
		'INSERT INTO `guild_activity_events` (`guild_id`, `event_type`, `actor_client_id`, `actor_display_name`, ' +
		'`metadata`, `source_key`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).run(2, 'campaign_contributed', 1, 'Diagnostic Idler', '{"amount":20}', 'diagnostic:campaign:1', 1700000000000);
	database.close();
	return database_path;
}

async function run_admin(database_path: string, ...args: string[]) {
	const child_process = Bun.spawn({
		cmd: [process.execPath, 'run', 'admin.ts', ...args],
		cwd: join(import.meta.dir, '../..'),
		env: { ...Bun.env, DB_PATH: database_path },
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const [exit_code, stdout, stderr] = await Promise.all([
		child_process.exited,
		new Response(child_process.stdout).text(),
		new Response(child_process.stderr).text()
	]);
	return { exit_code, stdout, stderr };
}

async function run_admin_with_input(database_path: string, input: string, ...args: string[]) {
	const child_process = Bun.spawn({
		cmd: [process.execPath, 'run', 'admin.ts', ...args],
		cwd: join(import.meta.dir, '../..'),
		env: { ...Bun.env, DB_PATH: database_path },
		stdin: 'pipe',
		stdout: 'pipe',
		stderr: 'pipe'
	});
	child_process.stdin.write(input);
	child_process.stdin.end();
	const [exit_code, stdout, stderr] = await Promise.all([
		child_process.exited,
		new Response(child_process.stdout).text(),
		new Response(child_process.stderr).text()
	]);
	return { exit_code, stdout, stderr };
}

afterEach(() => {
	for (const directory of temporary_directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe('administration CLI', () => {
	test('gets and sets one Updates section field without changing maintenance state', async () => {
		const database_path = fixture_database();
		const original_body = await run_admin(database_path, 'updates', 'get', 'dev-message', 'body');
		const set_title = await run_admin_with_input(database_path, 'Updated dev note\n', 'updates', 'set', 'dev-message', 'title');
		const set_body = await run_admin_with_input(database_path,
			'First paragraph.\n\nSecond paragraph.\n', 'updates', 'set', 'dev-message', 'body');
		const title = await run_admin(database_path, 'updates', 'get', 'dev-message', 'title');
		const body = await run_admin(database_path, 'updates', 'get', 'dev-message', 'body');
		const database = new Database(database_path, { readonly: true, strict: true });
		const maintenance = database.query<{ value: string }, []>(
			"SELECT `value` FROM `service_settings` WHERE `key` = 'maintenance'"
		).get();
		database.close();

		expect(original_body.exit_code).toBe(0);
		expect(original_body.stdout).toBe("{\"section_id\":\"dev-message\",\"field\":\"body\",\"value\":\"It's a tree - it's gonna have leaves. 🍃\"}\n");
		expect(set_title.exit_code).toBe(0);
		expect(set_title.stdout).toBe('Update section dev-message title updated.\n');
		expect(set_body.exit_code).toBe(0);
		expect(set_body.stdout).toBe('Update section dev-message body updated.\n');
		expect(title.stdout).toBe('{"section_id":"dev-message","field":"title","value":"Updated dev note"}\n');
		expect(body.stdout).toBe('{"section_id":"dev-message","field":"body","value":"First paragraph.\\n\\nSecond paragraph."}\n');
		expect(maintenance?.value).toBe('0');
	});

	test('validates Updates section fields and content', async () => {
		const database_path = fixture_database();
		const invalid_field = await run_admin(database_path, 'updates', 'get', 'dev-message', 'body-text');
		const missing = await run_admin(database_path, 'updates', 'get', 'missing-section', 'body');
		const empty = await run_admin_with_input(database_path, '\n', 'updates', 'set', 'dev-message', 'body');

		expect(invalid_field.exit_code).toBe(2);
		expect(invalid_field.stderr).toContain('Usage:');
		expect(missing.exit_code).toBe(1);
		expect(missing.stderr).toContain('does not exist');
		expect(empty.exit_code).toBe(1);
		expect(empty.stderr).toContain('non-whitespace');
	});

	test('sets and clears Social Only enforcement by identity and account', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.run("INSERT INTO melvor_accounts (cloud_username, playfab_id, created_at) VALUES ('Cloud', 'playfab', 1)");
		database.run('UPDATE clients SET melvor_account_id = 1 WHERE id = 1');
		database.close();
		const identity = await run_admin(database_path, 'social-mode', 'enforce', 'identity', '1');
		expect(identity.exit_code).toBe(0);
		expect(identity.stdout).toContain('affected_identities=1');
		const account = await run_admin(database_path, 'social-mode', 'enforce', 'account', '1');
		expect(account.exit_code).toBe(0);
		const cleared = await run_admin(database_path, 'social-mode', 'clear', 'identity', '1');
		expect(cleared.exit_code).toBe(0);
		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query('SELECT social_mode_enforced FROM clients WHERE id = 1').get()).toEqual({ social_mode_enforced: 0 });
		expect(verification.query('SELECT social_mode_enforced FROM melvor_accounts WHERE id = 1').get()).toEqual({ social_mode_enforced: 1 });
		verification.close();
	});

	test('enforces account Chat shadowbans and moderates Global Messages independently', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.run("INSERT INTO melvor_accounts (cloud_username, playfab_id, created_at) VALUES ('Cloud', 'shadow', 1)");
		database.run('UPDATE clients SET melvor_account_id = 1 WHERE id = 1');
		database.run("INSERT INTO global_chat_messages (sender_id, idempotency_key, content, created_at) VALUES (1, 'key', 'body', 1)");
		database.run('INSERT INTO global_chat_message_moderation (message_id, deleted_at) VALUES (1, 2)');
		database.close();
		const refused = await run_admin(database_path, 'global-chat-message', 'restore', '1');
		expect(refused.exit_code).toBe(1);
		expect(refused.stderr).toContain('unless it was sent during a Chat shadowban');
		const enforced = await run_admin(database_path, 'chat-shadowban', 'enforce', '1');
		expect(enforced.exit_code).toBe(0);
		expect(enforced.stdout).toContain('affected_identities=1');
		const writable = new Database(database_path, { strict: true });
		writable.run("INSERT INTO global_chat_messages (sender_id, idempotency_key, content, created_at, shadow_hidden) VALUES (1, 'shadow', 'shadow body', 3, 1)");
		writable.run('INSERT INTO global_chat_message_moderation (message_id, deleted_at) VALUES (2, 4)');
		writable.close();
		const restored = await run_admin(database_path, 'global-chat-message', 'restore', '2');
		expect(restored.exit_code).toBe(0);
		expect(restored.stdout).toContain('sender-account-only');
		const hidden = await run_admin(database_path, 'global-chat-message', 'hide', '1');
		expect(hidden.exit_code).toBe(0);
		expect(hidden.stdout).toContain('hidden for everyone');
		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query('SELECT chat_shadowbanned FROM melvor_accounts WHERE id = 1').get())
			.toEqual({ chat_shadowbanned: 1 });
		expect(verification.query('SELECT message_id FROM global_chat_message_moderation ORDER BY message_id').all())
			.toEqual([{ message_id: 1 }]);
		verification.close();
	});

	test('grants and revokes account-wide Chat shadow observer access', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.run("INSERT INTO melvor_accounts (cloud_username, playfab_id, created_at) VALUES ('Observer', 'observer', 1)");
		database.run('UPDATE clients SET melvor_account_id = 1 WHERE id = 1');
		const initial_revision = database.query<{ event_revision: number }, []>(
			'SELECT `event_revision` FROM `clients` WHERE `id` = 1'
		).get()?.event_revision ?? 0;
		database.close();

		const granted = await run_admin(database_path, 'chat-shadow-observer', 'grant', '1');
		expect(granted.exit_code).toBe(0);
		expect(granted.stdout).toContain('observer_added=yes');
		const repeated = await run_admin(database_path, 'chat-shadow-observer', 'grant', '1');
		expect(repeated.exit_code).toBe(0);
		expect(repeated.stdout).toContain('observer_added=already_granted');

		const granted_state = new Database(database_path, { readonly: true, strict: true });
		expect(granted_state.query('SELECT observer_account_id FROM chat_shadow_observers').all())
			.toEqual([{ observer_account_id: 1 }]);
		expect(granted_state.query<{ event_revision: number }, []>(
			'SELECT `event_revision` FROM `clients` WHERE `id` = 1'
		).get()?.event_revision).toBe(initial_revision + 2);
		granted_state.close();

		const revoked = await run_admin(database_path, 'chat-shadow-observer', 'revoke', '1');
		expect(revoked.exit_code).toBe(0);
		expect(revoked.stdout).toContain('observer_removed=yes');
		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query('SELECT observer_account_id FROM chat_shadow_observers').all()).toEqual([]);
		verification.close();
	});

	test('corrects only an unread member-authored Support Message with the expected digest', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
			'VALUES (?, ?, ?, ?, ?)'
		).run(crypto.randomUUID(), crypto.randomUUID(), '321-654-987', 'Support Member', 'melvorD:Blue_Party_Hat');
		const membership = database.query(
			'INSERT INTO `support_team_memberships` (`team_id`, `client_id`, `member_display_name`, `created_at`) ' +
			'VALUES (1, 2, ?, 1)'
		).run('Support Member');
		const conversation = database.query(
			'INSERT INTO `support_conversations` (`team_id`, `player_client_id`, `created_at`) VALUES (1, 1, 2)'
		).run();
		const original_content = 'Original support reply';
		const message = database.query(
			'INSERT INTO `support_messages` (`conversation_id`, `author_kind`, `membership_id`, `sending_client_id`, ' +
			'`idempotency_scope`, `idempotency_key`, `content`, `created_at`) VALUES (?, \'member\', ?, 2, ?, ?, ?, 3)'
		).run(Number(conversation.lastInsertRowid), Number(membership.lastInsertRowid), 'member:2', crypto.randomUUID(),
			original_content);
		const message_id = Number(message.lastInsertRowid);
		const initial_revisions = database.query<{ id: number; event_revision: number }, []>(
			'SELECT `id`, `event_revision` FROM `clients` WHERE `id` IN (1, 2) ORDER BY `id`'
		).all();
		database.close();

		const digest = createHash('sha256').update(original_content).digest('hex');
		const inspected = await run_admin(database_path, 'support-message', 'inspect', String(message_id));
		expect(inspected.exit_code).toBe(0);
		expect(inspected.stdout).toContain(`message_id=${message_id}\n`);
		expect(inspected.stdout).toContain('author_kind=member\n');
		expect(inspected.stdout).toContain('read_by_player=no\n');
		expect(inspected.stdout).toContain(`content_sha256=${digest}\n`);

		const stale = await run_admin_with_input(database_path, 'Must not apply\n', 'support-message', 'correct',
			String(message_id), '0'.repeat(64), 'confirm');
		expect(stale.exit_code).toBe(1);
		expect(stale.stderr).toContain('no longer matches the expected SHA-256');

		const corrected = await run_admin_with_input(database_path, 'Corrected support reply\n', 'support-message',
			'correct', String(message_id), digest, 'confirm');
		expect(corrected.exit_code).toBe(0);
		expect(corrected.stdout).toBe(`Support Message ${message_id} corrected.\n`);

		const verification = new Database(database_path, { strict: true });
		expect(verification.query('SELECT `content` FROM `support_messages` WHERE `id` = ?').get(message_id))
			.toEqual({ content: 'Corrected support reply' });
		expect(verification.query<{ id: number; event_revision: number }, []>(
			'SELECT `id`, `event_revision` FROM `clients` WHERE `id` IN (1, 2) ORDER BY `id`'
		).all()).toEqual(initial_revisions.map(client => ({
			id: client.id,
			event_revision: client.event_revision + 1
		})));
		expect(verification.query(
			"SELECT `event_type`, json_extract(`details_json`, '$.message_id') AS `message_id` " +
			"FROM `audit_events` WHERE `event_type` = 'support.message.corrected'"
		).get()).toEqual({ event_type: 'support.message.corrected', message_id });
		verification.query(
			'INSERT INTO `support_player_message_reads` (`message_id`, `client_id`, `read_at`) VALUES (?, 1, 4)'
		).run(message_id);
		verification.close();

		const corrected_digest = createHash('sha256').update('Corrected support reply').digest('hex');
		const read = await run_admin_with_input(database_path, 'Second correction\n', 'support-message', 'correct',
			String(message_id), corrected_digest, 'confirm');
		expect(read.exit_code).toBe(1);
		expect(read.stderr).toContain('has already been read by the player');
	});

	test('sets, reports, validates, and clears the released mod version', async () => {
		const database_path = fixture_database();
		const set = await run_admin(database_path, 'release-version', '1.3.0');
		const status = await run_admin(database_path, 'status');
		const invalid = await run_admin(database_path, 'release-version', 'backend-57');
		const clear = await run_admin(database_path, 'release-version', 'clear');
		const cleared_status = await run_admin(database_path, 'status');

		expect(set.exit_code).toBe(0);
		expect(set.stdout).toBe('Released mod version set to 1.3.0.\n');
		expect(status.stdout).toContain('released_mod_version=1.3.0\n');
		expect(invalid.exit_code).toBe(2);
		expect(invalid.stderr).toContain('Usage:');
		expect(clear.exit_code).toBe(0);
		expect(clear.stdout).toBe('Released mod version cleared.\n');
		expect(cleared_status.stdout).toContain('released_mod_version=none\n');
	});

	test('sets, reports, validates, and clears the minimum supported mod version', async () => {
		const database_path = fixture_database();
		const set = await run_admin(database_path, 'minimum-supported-version', '1.5.11');
		const status = await run_admin(database_path, 'status');
		const too_old = await run_admin(database_path, 'minimum-supported-version', '1.5.9');
		const invalid = await run_admin(database_path, 'minimum-supported-version', 'latest');
		const clear = await run_admin(database_path, 'minimum-supported-version', 'clear');
		const cleared_status = await run_admin(database_path, 'status');

		expect(set.exit_code).toBe(0);
		expect(set.stdout).toBe('Minimum supported mod version set to 1.5.11.\n');
		expect(status.stdout).toContain('minimum_supported_mod_version=1.5.11\n');
		expect(too_old.exit_code).toBe(2);
		expect(invalid.exit_code).toBe(2);
		expect(clear.exit_code).toBe(0);
		expect(clear.stdout).toBe('Minimum supported mod version cleared.\n');
		expect(cleared_status.stdout).toContain('minimum_supported_mod_version=none\n');
	});

	test('toggles and reports icon collection without accepting arbitrary values', async () => {
		const database_path = fixture_database();
		const disabled = await run_admin(database_path, 'icon-collection', 'off');
		const status = await run_admin(database_path, 'status');
		const invalid = await run_admin(database_path, 'icon-collection', 'maybe');
		const enabled = await run_admin(database_path, 'icon-collection', 'on');

		expect(disabled.exit_code).toBe(0);
		expect(disabled.stdout).toBe('Icon collection off.\n');
		expect(status.stdout).toContain('icon_collection=off\n');
		expect(invalid.exit_code).toBe(2);
		expect(invalid.stderr).toContain('Usage:');
		expect(enabled.exit_code).toBe(0);
		expect(enabled.stdout).toBe('Icon collection on.\n');
	});

	test('sets bounded icon collection limits and reports the effective settings', async () => {
		const database_path = fixture_database();
		const set = await run_admin(database_path, 'icon-collection-limit', 'catalog-bytes', '4096');
		const status = await run_admin(database_path, 'status');
		const too_large = await run_admin(database_path, 'icon-collection-limit', 'catalog-bytes', '999999999');
		const invalid = await run_admin(database_path, 'icon-collection-limit', 'manifest-items', '0');

		expect(set.exit_code).toBe(0);
		expect(set.stdout).toBe('Icon collection catalog-bytes limit set to 4096.\n');
		expect(status.stdout).toContain('icon_collection_max_catalog_bytes=4096\n');
		expect(too_large.exit_code).toBe(2);
		expect(too_large.stderr).toContain('Usage:');
		expect(invalid.exit_code).toBe(2);
	});

	test('sets and clears Global Chat throttles for the server and one identity', async () => {
		const database_path = fixture_database();
		expect((await run_admin(database_path, 'global-chat-throttle', 'server', '2', '10')).exit_code).toBe(0);
		expect((await run_admin(database_path, 'global-chat-throttle', 'client', '1', '3', '20')).exit_code).toBe(0);
		const database = new Database(database_path, { readonly: true, strict: true });
		expect(database.query('SELECT `max_messages`, `window_seconds` FROM `global_chat_server_throttle`').get())
			.toEqual({ max_messages: 2, window_seconds: 10 });
		expect(database.query('SELECT `max_messages`, `window_seconds` FROM `global_chat_client_throttles`').get())
			.toEqual({ max_messages: 3, window_seconds: 20 });
		database.close();
		expect((await run_admin(database_path, 'global-chat-throttle', 'client', '1', 'clear')).exit_code).toBe(0);
		expect((await run_admin(database_path, 'global-chat-throttle', 'server', 'clear')).exit_code).toBe(0);
		expect((await run_admin(database_path, 'global-chat-throttle', 'server', '0', '10')).exit_code).toBe(2);
		expect((await run_admin(database_path, 'global-chat-throttle', 'client', '999', '2', '10')).exit_code).toBe(1);
	});

	test('inspects one identity without exposing credentials', async () => {
		const result = await run_admin(fixture_database(), 'identity', 'inspect', '1');

		expect(result.exit_code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('identity_id=1\n');
		expect(result.stdout).toContain('display_name="Diagnostic Idler"\n');
		expect(result.stdout).toContain('active_sessions=1\n');
		expect(result.stdout).toContain('guild_name="Diagnostic Guild"\n');
		expect(result.stdout).not.toContain('secret-session');
	});

	test('inspects bounded Guild state without exposing credentials', async () => {
		const result = await run_admin(fixture_database(), 'guild', 'inspect', '2');

		expect(result.exit_code).toBe(0);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('guild_id=2\n');
		expect(result.stdout).toContain('name="Diagnostic Guild"\n');
		expect(result.stdout).toContain('"mod_version":"1.4.5"');
		expect(result.stdout).toContain('"campaign_id":"Diagnostic Campaign"');
		expect(result.stdout).toContain('"item_amount":20');
		expect(result.stdout).toContain('"event_type":"campaign_contributed"');
		expect(result.stdout).not.toContain('secret-session');
	});

	test('reports a missing Guild without accepting arbitrary SQL', async () => {
		const result = await run_admin(fixture_database(), 'guild', 'inspect', '999');

		expect(result.exit_code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('Guild 999 does not exist.\n');
	});

	test('reports a missing identity without accepting arbitrary SQL', async () => {
		const result = await run_admin(fixture_database(), 'identity', 'inspect', '999');

		expect(result.exit_code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('Multiplayer identity 999 does not exist.\n');
	});

});

test('Alliance switch controls public access while retaining identity and version eligibility', async () => {
	const database_path = fixture_database();
	const database = new Database(database_path);
	database.query("INSERT INTO melvor_accounts(id,cloud_username,playfab_id,created_at) VALUES(1,'Preview','preview-switch',0)").run();
	database.query('UPDATE clients SET melvor_account_id=NULL WHERE id=1').run();
	const initial_revision = database.query<{ event_revision: number }, []>('SELECT event_revision FROM clients WHERE id=1').get()!.event_revision;
	const access = async () => {
		const child = Bun.spawn({
			cmd: [process.execPath, '--eval', "import { has_alliance_access } from './alliances'; console.log(JSON.stringify([has_alliance_access(1,'1.6.2'),has_alliance_access(1,'development'),has_alliance_access(1,'1.6.1'),has_alliance_access(999,'development')]));"],
			cwd: join(import.meta.dir, '../..'), env: { ...Bun.env, DB_PATH: database_path }, stdout: 'pipe', stderr: 'pipe'
		});
		const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
		expect({code, stderr}).toEqual({code:0, stderr:''});
		return JSON.parse(stdout.trim());
	};
	try {
		expect(await access()).toEqual([true,true,false,false]);
		expect((await run_admin(database_path,'alliance-preview','off')).exit_code).toBe(0);
		expect(await access()).toEqual([false,false,false,false]);
		expect((await run_admin(database_path,'status')).stdout).toContain('alliance_preview=off');
		expect(database.query<{ event_revision: number }, []>('SELECT event_revision FROM clients WHERE id=1').get()!.event_revision).toBe(initial_revision+1);
		expect((await run_admin(database_path,'alliance-preview','invalid')).exit_code).toBe(2);
		expect(await access()).toEqual([false,false,false,false]);
		expect((await run_admin(database_path,'alliance-preview','on')).exit_code).toBe(0);
		expect(await access()).toEqual([true,true,false,false]);
		expect(database.query<{ event_revision: number }, []>('SELECT event_revision FROM clients WHERE id=1').get()!.event_revision).toBe(initial_revision+2);
	} finally {
		database.close();
	}
});

test('feature tester assignments are validated, idempotent and scoped to a character', async () => {
	const database_path = fixture_database();
	for (const args of [['grant', 'pending', '999'], ['grant', 'unsupported', '1'], ['grant', 'pending', '-1']])
		expect((await run_admin(database_path, 'feature-tester', ...args)).exit_code).not.toBe(0);
	for (let attempt = 0; attempt < 2; attempt++)
		expect((await run_admin(database_path, 'feature-tester', 'grant', 'pending', '1')).exit_code).toBe(0);
	const database = new Database(database_path);
	try {
		expect(database.query('SELECT * FROM character_feature_testers').all()).toEqual([{ client_id: 1, feature: 'pending' }]);
		expect((await run_admin(database_path, 'feature-tester', 'revoke', 'pending', '1')).exit_code).toBe(0);
		expect(database.query('SELECT * FROM character_feature_testers').all()).toEqual([]);
		expect((await run_admin(database_path, 'feature-tester', 'grant', 'council', '1')).exit_code).toBe(0);
		expect(database.query('SELECT * FROM character_feature_testers').all()).toEqual([{ client_id: 1, feature: 'council' }]);
		expect((await run_admin(database_path, 'feature-tester', 'revoke', 'council', '1')).exit_code).toBe(0);
		expect(database.query('SELECT * FROM character_feature_testers').all()).toEqual([]);
	} finally { database.close(); }
});
