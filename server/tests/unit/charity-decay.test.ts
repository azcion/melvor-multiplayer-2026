import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	CHARITY_DECAY_MINIMUM_REMAINING_MS,
	get_charity_decay_context,
	get_effective_charity_expiry
} from '../../charity-decay';
import { migrations } from '../../db/schema';

const HOUR_MS = 60 * 60 * 1000;
const temporary_directories: string[] = [];

function fixture_database(): Database {
	const directory = mkdtempSync(join(tmpdir(), 'melvor-charity-decay-test-'));
	temporary_directories.push(directory);
	const database = new Database(join(directory, 'database.sqlite'), { create: true, strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations) {
		database.run(migration.sql);
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
	return database;
}

function add_wish(database: Database, created_at: number, progress_gp = 0): number {
	const account = database.query(
		'INSERT INTO `melvor_accounts` (`cloud_username`, `playfab_id`, `created_at`) VALUES(?, ?, ?)'
	).run(crypto.randomUUID(), crypto.randomUUID(), created_at);
	const client = database.query(
		'INSERT INTO `clients` (`client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`, `melvor_account_id`) ' +
		'VALUES(?, ?, ?, ?, ?, ?)'
	).run(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), 'melvorD:Plant', account.lastInsertRowid);
	return Number(database.query(
		'INSERT INTO `charity_wishes` (`guild_id`, `owner_client_id`, `melvor_account_id`, `item_id`, `qty`, ' +
		'`required_gp`, `progress_gp`, `created_at`, `matures_at`) VALUES(1, ?, ?, ?, 1, 100, ?, ?, ?)'
	).run(client.lastInsertRowid, account.lastInsertRowid, `test:${crypto.randomUUID()}`, progress_gp, created_at,
		created_at + 4 * 24 * HOUR_MS).lastInsertRowid);
}

afterEach(() => {
	for (const directory of temporary_directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe('Charitree decay acceleration', () => {
	test('computes accelerated deadlines from a canonical expiry with a fixed two-hour activation floor', () => {
		const database = fixture_database();
		const now = 1_800_000_000_000;
		add_wish(database, now);

		const context = get_charity_decay_context(1, database, now);
		expect(context).not.toBeNull();
		expect(get_effective_charity_expiry(now + 90 * HOUR_MS, context)).toBe(now + 14 * HOUR_MS);
		expect(get_effective_charity_expiry(now + 10 * HOUR_MS, context))
			.toBe(now + CHARITY_DECAY_MINIMUM_REMAINING_MS);
		expect(get_effective_charity_expiry(now + HOUR_MS, context)).toBe(now + HOUR_MS);
		database.close();
	});

	test('keeps one activation through overlapping Wishes and restores canonical expiry when none remain', () => {
		const database = fixture_database();
		const now = 1_800_000_000_000;
		const first_id = add_wish(database, now - HOUR_MS);
		const second_id = add_wish(database, now);

		const first_context = get_charity_decay_context(1, database, now);
		expect(first_context?.activation_at).toBe(now - HOUR_MS);
		database.query('UPDATE `charity_wishes` SET `progress_gp` = `required_gp` WHERE `id` = ?').run(first_id);
		expect(get_charity_decay_context(1, database, now + HOUR_MS)?.activation_at).toBe(now - HOUR_MS);
		database.query('UPDATE `charity_wishes` SET `progress_gp` = `required_gp` WHERE `id` = ?').run(second_id);
		expect(get_charity_decay_context(1, database, now + HOUR_MS)).toBeNull();
		expect(database.query('SELECT 1 FROM `charity_decay_activations` WHERE `guild_id` = 1').get()).toBeNull();
		expect(get_effective_charity_expiry(now + 10 * HOUR_MS, null)).toBe(now + 10 * HOUR_MS);
		database.close();
	});
});
