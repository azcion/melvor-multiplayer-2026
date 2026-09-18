import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations } from '../../db/schema';

const temporary_directories: string[] = [];

function fixture_database(): string {
	const directory = mkdtempSync(join(tmpdir(), 'melvor-admin-test-'));
	temporary_directories.push(directory);
	const database_path = join(directory, 'database.sqlite');
	const database = new Database(database_path, { create: true, strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations) {
		database.run(migration.sql);
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
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

	test('backfills only unknown Charitree stack values from a bounded catalog', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `value_currency_id`, `value_per_item`) VALUES ' +
			'(2, \'melvorD:Backfill_Leaf\', 5, 1700001000000, NULL, NULL), ' +
			'(2, \'melvorD:GP\', 5, 1700001000000, NULL, NULL), ' +
			'(2, \'melvorD:SlayerCoins\', 5, 1700001000000, NULL, NULL), ' +
			'(2, \'melvorItA:AbyssalPieces\', 5, 1700001000000, NULL, NULL), ' +
			'(2, \'melvorItA:AbyssalSlayerCoins\', 5, 1700001000000, NULL, NULL), ' +
			'(2, \'melvorD:Known_Stone\', 5, 1700001000000, \'melvorItA:AbyssalPieces\', 7), ' +
			'(2, \'mod:Unknown\', 1, 1700001000000, NULL, NULL)'
		).run();
		database.close();

		const catalog = JSON.stringify([
			{ id: 'melvorD:Backfill_Leaf', value_currency_id: 'melvorD:GP', value_per_item: 50 },
			{ id: 'melvorD:Known_Stone', value_currency_id: 'melvorD:GP', value_per_item: 999 },
			{ id: 'melvorD:Unused', value_currency_id: null, value_per_item: 0 }
		]);
		const result = await run_admin_with_input(database_path, catalog, 'charity', 'backfill-values');
		expect(result.exit_code).toBe(0);
		expect(result.stdout).toBe(
			'catalog_items=3\ncharitree_stacks_updated=5\ncharitree_stacks_remaining_unknown=1\n' +
			'charitree_value_backfill_pending=0\n'
		);
		expect(result.stderr).toBe('');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			'SELECT `item_id`, `value_currency_id`, `value_per_item` FROM `charity_items` ORDER BY `item_id`'
		).all()).toEqual([
			{ item_id: 'melvorD:Backfill_Leaf', value_currency_id: 'melvorD:GP', value_per_item: 50 },
			{ item_id: 'melvorD:GP', value_currency_id: 'melvorD:GP', value_per_item: 1 },
			{ item_id: 'melvorD:Known_Stone', value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 7 },
			{ item_id: 'melvorD:SlayerCoins', value_currency_id: 'melvorD:GP', value_per_item: 1 },
			{ item_id: 'melvorItA:AbyssalPieces', value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 },
			{ item_id: 'melvorItA:AbyssalSlayerCoins', value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 },
			{ item_id: 'mod:Unknown', value_currency_id: null, value_per_item: null }
		]);
		expect(verification.query(
			"SELECT `value` FROM `service_settings` WHERE `key` = 'charity_value_backfill_pending'"
		).get()).toEqual({ value: '0' });
		verification.close();
	});

	test('does not clear the Charitree backfill gate for an empty catalog with unknown stacks', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES (2, 'mod:Unknown', 1, 1700001000000, NULL, NULL)"
		).run();
		database.query(
			"UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'charity_value_backfill_pending'"
		).run();
		database.close();

		const result = await run_admin_with_input(database_path, '[]', 'charity', 'backfill-values');
		expect(result.exit_code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('empty while unknown stacks remain');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			"SELECT `value` FROM `service_settings` WHERE `key` = 'charity_value_backfill_pending'"
		).get()).toEqual({ value: '1' });
		expect(verification.query(
			"SELECT `value_per_item` FROM `charity_items` WHERE `item_id` = 'mod:Unknown'"
		).get()).toEqual({ value_per_item: null });
		verification.close();
	});

	test('repairs one pending bank Charity receipt without changing its committed stock', async () => {
		const database_path = fixture_database();
		const receipt_id = crypto.randomUUID();
		const item_id = 'melvorD:Bank_Repair_Item';
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `value_currency_id`, `value_per_item`) ' +
			'VALUES (2, ?, 2, 1700001000000, \'melvorD:GP\', 250000)'
		).run(item_id);
		database.query(
			'INSERT INTO `economy_receipts` (`id`, `client_id`, `kind`, `response_json`, `created_at`) VALUES (?, 1, \'charity-donate\', ?, 1700000000000)'
		).run(receipt_id, JSON.stringify({
			success: true,
			receipt: { id: receipt_id, kind: 'charity-donate', effects: [{ storage: 'transfer', item_id, qty: -1 }] }
		}));
		database.close();

		const result = await run_admin(database_path, 'charity', 'repair-bank-receipt', '1', receipt_id, item_id, '1', 'confirm');
		expect(result.exit_code).toBe(0);
		expect(result.stdout).toContain('receipt_effect_storage=bank\n');
		expect(result.stdout).toContain('receipt_acknowledged=no\n');
		expect(result.stderr).toBe('');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			' SELECT json_extract(`response_json`, \'$.receipt.effects[0].storage\') AS `storage`, ' +
			'json_extract(`response_json`, \'$.receipt.effects[0].item_id\') AS `item_id`, ' +
			'json_extract(`response_json`, \'$.receipt.effects[0].qty\') AS `qty` ' +
			'FROM `economy_receipts` WHERE `id` = ?'
		).get(receipt_id)).toEqual({ storage: 'bank', item_id, qty: -1 });
		expect(verification.query(
			'SELECT `qty` FROM `charity_items` WHERE `guild_id` = 2 AND `item_id` = ?',
		).get(item_id)).toEqual({ qty: 2 });
		verification.close();
	});

	test('sets one exact Charitree stack expiry without changing its quantity', async () => {
		const database_path = fixture_database();
		const item_id = 'melvorD:Expiry_Test_Item';
		const donated_at = 1700000000000;
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			'VALUES (2, ?, 2, 1700001000000, ?, \'melvorD:GP\', 250000)'
		).run(item_id, donated_at);
		database.close();

		const started_at = Date.now();
		const result = await run_admin(database_path, 'charity', 'set-expiry', '2', item_id, '2', '60', 'confirm');
		expect(result.exit_code).toBe(0);
		expect(result.stdout).toContain('qty=2\n');
		expect(result.stdout).toContain('expires_in_seconds=60\n');
		expect(result.stderr).toBe('');

		const verification = new Database(database_path, { readonly: true, strict: true });
		const row = verification.query(
			' SELECT `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item` ' +
			'FROM `charity_items` WHERE `guild_id` = 2 AND `item_id` = ?'
		).get(item_id) as { qty: number; expires_at: number; donated_at: number; value_currency_id: string; value_per_item: number };
		expect(row.qty).toBe(2);
		expect(row.expires_at).toBeGreaterThanOrEqual(started_at + 59000);
		expect(row.expires_at).toBeLessThanOrEqual(Date.now() + 60000);
		expect(row.donated_at).toBe(donated_at);
		expect(row.value_currency_id).toBe('melvorD:GP');
		expect(row.value_per_item).toBe(250000);
		verification.close();
	});

	test('refuses to set expiry when the exact Charitree stack quantity changed', async () => {
		const database_path = fixture_database();
		const item_id = 'melvorD:Expiry_Guard_Item';
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`) VALUES (2, ?, 1, 1700001000000)'
		).run(item_id);
		database.close();

		const result = await run_admin(database_path, 'charity', 'set-expiry', '2', item_id, '2', '60', 'confirm');
		expect(result.exit_code).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('expected 2, found 1');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			' SELECT `expires_at` FROM `charity_items` WHERE `guild_id` = 2 AND `item_id` = ?'
		).get(item_id)).toEqual({ expires_at: 1700001000000 });
		verification.close();
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

	test('finds an identity by exact display name and resets its Charitree timers', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.query('UPDATE `clients` SET `display_name` = ?, `last_charity` = ?, `last_bonus_charity` = ? WHERE `id` = 1')
			.run('Briar', 1700000000000, 1700000001000);
		database.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = ? WHERE `client_id` = 1')
			.run(1700000002000);
		database.close();

		const found = await run_admin(database_path, 'identity', 'find', 'Briar');
		const reset = await run_admin(database_path, 'charity', 'reset', '1');
		expect(found.exit_code).toBe(0);
		expect(found.stdout).toContain('"id":1');
		expect(found.stdout).toContain('"display_name":"Briar"');
		expect(reset.exit_code).toBe(0);
		expect(reset.stdout).toContain('previous_last_charity=1700000000000\n');
		expect(reset.stdout).toContain('previous_last_bonus_charity=1700000001000\n');
		expect(reset.stdout).toContain('previous_charitree_take_available_at=1700000002000\n');
		expect(reset.stdout).toContain('last_charity=0\n');
		expect(reset.stdout).toContain('last_bonus_charity=0\n');
		expect(reset.stdout).toContain('charitree_take_available_at=0\n');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			'SELECT `last_charity`, `last_bonus_charity` FROM `clients` WHERE `id` = 1'
		).get()).toEqual({ last_charity: 0, last_bonus_charity: 0 });
		expect(verification.query(
			'SELECT `charitree_take_available_at` FROM `guild_memberships` WHERE `client_id` = 1'
		).get()).toEqual({ charitree_take_available_at: 0 });
		verification.close();
	});

	test('resets every identity cooldown and membership lock in one transaction', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		database.query(
			'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, ' +
			'`last_charity`, `last_bonus_charity`) VALUES (?, ?, ?, ?, ?, ?, ?)'
		).run(crypto.randomUUID(), crypto.randomUUID(), '987-654-321', 'Second Idler', 'melvorD:Plant',
			1700000010000, 1700000011000);
		database.query('INSERT INTO `guild_memberships` (`client_id`, `guild_id`, `charitree_take_available_at`) VALUES (?, ?, ?)')
			.run(2, 2, 1700000012000);
		database.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = ? WHERE `client_id` = 1')
			.run(1700000013000);
		database.query('UPDATE `clients` SET `last_charity` = ?, `last_bonus_charity` = ? WHERE `id` = 1')
			.run(1700000014000, 1700000015000);
		database.close();

		const reset = await run_admin(database_path, 'charity', 'reset-all');
		expect(reset.exit_code).toBe(0);
		expect(reset.stdout).toBe('charity_clients_reset=2\ncharity_memberships_reset=2\n');
		expect(reset.stderr).toBe('');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			'SELECT COUNT(*) AS `count` FROM `clients` WHERE `last_charity` <> 0 OR `last_bonus_charity` <> 0'
		).get()).toEqual({ count: 0 });
		expect(verification.query(
			'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `charitree_take_available_at` <> 0'
		).get()).toEqual({ count: 0 });
		verification.close();
	});

	test('rolls back and acknowledges one duplicate pending Charity receipt only with its acknowledged twin', async () => {
		const database_path = fixture_database();
		const database = new Database(database_path, { strict: true });
		const duplicate_id = crypto.randomUUID();
		const acknowledged_id = crypto.randomUUID();
		const response = (id: string) => JSON.stringify({
			success: true,
			receipt: {
				id,
				kind: 'charity-donate',
				effects: [
					{ storage: 'transfer', item_id: 'melvorD:Leather_Vambraces', qty: -1 },
					{ storage: 'transfer', item_id: 'melvorD:Black_Dhide_Chaps', qty: -1 },
					{ storage: 'transfer', item_id: 'melvorD:Green_Dhide_Vambraces', qty: -1 }
				]
			}
		});
		database.query(
			'INSERT INTO `economy_receipts` (`id`, `client_id`, `kind`, `response_json`, `created_at`, `acknowledged_at`) ' +
			'VALUES (?, 1, \'charity-donate\', ?, ?, NULL), (?, 1, \'charity-donate\', ?, ?, ?)'
		).run(duplicate_id, response(duplicate_id), 1700000000100, acknowledged_id, response(acknowledged_id), 1700000000200, 1700000000300);
		database.query(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`) VALUES ' +
			'(2, \'melvorD:Leather_Vambraces\', 3, 1700001000000), ' +
			'(2, \'melvorD:Black_Dhide_Chaps\', 3, 1700001000000), ' +
			'(2, \'melvorD:Green_Dhide_Vambraces\', 3, 1700001000000)'
		).run();
		const initial_event_revision = database.query('SELECT `event_revision` FROM `clients` WHERE `id` = 1').get() as { event_revision: number };
		database.close();

		const repaired = await run_admin(database_path, 'economy-receipt', 'rollback-duplicate-charity', '1', duplicate_id, 'confirm');
		expect(repaired.exit_code).toBe(0);
		expect(repaired.stdout).toContain(`receipt_id=${duplicate_id}\n`);
		expect(repaired.stdout).toContain(`duplicate_receipt_id=${acknowledged_id}\n`);
		expect(repaired.stderr).toBe('');

		const verification = new Database(database_path, { readonly: true, strict: true });
		expect(verification.query(
			'SELECT `acknowledged_at` IS NOT NULL AS `acknowledged` FROM `economy_receipts` WHERE `id` = ?'
		).get(duplicate_id)).toEqual({ acknowledged: 1 });
		expect(verification.query(
			'SELECT `item_id`, `qty` FROM `charity_items` WHERE `guild_id` = 2 ORDER BY `item_id`'
		).all()).toEqual([
			{ item_id: 'melvorD:Black_Dhide_Chaps', qty: 2 },
			{ item_id: 'melvorD:Green_Dhide_Vambraces', qty: 2 },
			{ item_id: 'melvorD:Leather_Vambraces', qty: 2 }
		]);
		expect(verification.query('SELECT `event_revision` FROM `clients` WHERE `id` = 1').get()).toEqual({
			event_revision: initial_event_revision.event_revision + 1
		});
		verification.close();
	});
});
