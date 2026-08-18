import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import {
	CAMPAIGN_AUTO_CONTRIBUTION_CAP,
	CAMPAIGN_AUTO_PROGRESS_SQL,
	get_campaign_auto_advance,
	get_campaign_item_total,
	get_required_campaign_contributors,
	round_campaign_estimate
} from '../../campaign';
import { AVAILABLE_CAMPAIGNS } from '../../campaign_data';
import { migrations } from '../../db/schema';

const campaign_item_fixture = JSON.parse(readFileSync(
	new URL('../fixtures/campaign-item-ids-v1.3.1.json', import.meta.url),
	'utf8'
)) as { game_version: string; item_ids: string[] };

describe('campaign balancing', () => {
	test('rounds estimates upward to the coarsest increment within fifteen percent', () => {
		expect(round_campaign_estimate(8888)).toBe(9000);
		expect(round_campaign_estimate(6087)).toBe(7000);
		expect(round_campaign_estimate(11111)).toBe(12000);
		expect(round_campaign_estimate(388800)).toBe(400000);
	});

	test('requires half of the starting Guild membership rounded upward', () => {
		expect([0, 1, 2, 3, 4, 5, 6].map(get_required_campaign_contributors)).toEqual([
			1, 1, 1, 2, 2, 3, 3
		]);
	});

	test('scales the rounded per-player estimate by the required contributors', () => {
		expect(get_campaign_item_total(388800, 1)).toBe(400000);
		expect(get_campaign_item_total(388800, 2)).toBe(800000);
		expect(get_campaign_item_total(388800, 3)).toBe(1200000);
	});

	test('defines a positive twelve-hour estimate for every campaign item', () => {
		const items = AVAILABLE_CAMPAIGNS.flatMap(campaign => campaign.items);

		expect(items.length).toBeGreaterThan(0);
		expect(new Set(items.map(item => item.id)).size).toBe(items.length);
		for (const item of items) {
			expect(item.estimated_12h_output).toBeInteger();
			expect(item.estimated_12h_output).toBeGreaterThan(0);
		}
	});

	test('uses item IDs present in the v1.3.1 game data packages', () => {
		const items = AVAILABLE_CAMPAIGNS.flatMap(campaign => campaign.items);

		expect(campaign_item_fixture.game_version).toBe('1.3.1');
		expect(items.map(item => item.id)).toEqual(campaign_item_fixture.item_ids);
	});

	test('repairs persisted pre-fix urn IDs during schema migration', () => {
		const database = new Database(':memory:', { strict: true });
		database.run('CREATE TABLE campaign_state (id INTEGER PRIMARY KEY, item_id TEXT NOT NULL)');
		database.run('INSERT INTO campaign_state VALUES (?, ?), (?, ?), (?, ?)', [
			1, 'melvorD:Small_Urn',
			2, 'melvorD:Medium_Urn',
			3, 'melvorD:Topaz'
		]);

		const migration = migrations.find(entry => entry.version === 17);
		expect(migration).toBeDefined();
		database.run(migration?.sql ?? '');

		expect(database.query('SELECT id, item_id FROM campaign_state ORDER BY id').all()).toEqual([
			{ id: 1, item_id: 'melvorF:Small_Urn' },
			{ id: 2, item_id: 'melvorF:Medium_Urn' },
			{ id: 3, item_id: 'melvorD:Topaz' }
		]);
		database.close();
	});

	test('backfills only completed contributions into identity-owned history that survives Guild deletion', () => {
		const database = new Database(':memory:', { strict: true });
		database.run('PRAGMA foreign_keys = ON');
		for (const migration of migrations.filter(entry => entry.version < 33)) {
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = OFF');
			database.transaction(() => database.run(migration.sql)).immediate();
			if (migration.foreign_keys_disabled)
				database.run('PRAGMA foreign_keys = ON');
		}
		database.query(
			'INSERT INTO `clients` (`id`, `client_identifier`, `client_key`, `friend_code`, `display_name`, `icon_id`) ' +
			'VALUES(1, ?, ?, ?, ?, ?)'
		).run('campaign-migration-client', 'key', 'friend', 'Campaign Migration', 'melvorD:Plant');
		database.query(
			'INSERT INTO `guilds` (`id`, `name`, `icon_id`) VALUES(2, ?, ?)'
		).run('Campaign Migration Guild', 'melvorD:Farmlands');
		database.query(
			'INSERT INTO `campaign_state` ' +
			'(`id`, `guild_id`, `campaign_id`, `item_id`, `item_amount`, `item_current`, `complete`, `campaign_next`) ' +
			'VALUES(101, 2, ?, ?, 20, 20, 1, 1000), (102, 2, ?, ?, 30, 5, 0, 0)'
		).run('campaign_jungle', 'melvorD:Logs', 'campaign_snow', 'melvorD:Coal_Ore');
		database.query(
			'INSERT INTO `campaign_contributions` (`campaign_id`, `client_id`, `item_amount`, `taken`) ' +
			'VALUES(101, 1, 20, 321), (102, 1, 5, 0)'
		).run();

		const migration = migrations.find(entry => entry.version === 33);
		expect(migration?.foreign_keys_disabled).not.toBe(true);
		database.transaction(() => database.run(migration?.sql ?? '')).immediate();

		expect(database.query(
			'SELECT `source_campaign_state_id`, `source_guild_id`, `client_id`, `campaign_id`, `item_id`, ' +
			'`item_amount`, `taken` FROM `campaign_completions`'
		).all()).toEqual([{
			source_campaign_state_id: 101,
			source_guild_id: 2,
			client_id: 1,
			campaign_id: 'campaign_jungle',
			item_id: 'melvorD:Logs',
			item_amount: 20,
			taken: 321
		}]);

		database.query('DELETE FROM `guilds` WHERE `id` = 2').run();
		expect(database.query('SELECT COUNT(*) AS `count` FROM `campaign_state`').get()).toEqual({ count: 0 });
		expect(database.query('SELECT COUNT(*) AS `count` FROM `campaign_contributions`').get()).toEqual({ count: 0 });
		expect(database.query('SELECT COUNT(*) AS `count` FROM `campaign_completions`').get()).toEqual({ count: 1 });
		expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
		database.close();
	});

	test('advances five to fifteen percent without exceeding the automatic allowance', () => {
		expect(get_campaign_auto_advance(1000, 0, 0)).toBe(50);
		expect(get_campaign_auto_advance(1000, 0, 0.5)).toBe(100);
		expect(get_campaign_auto_advance(1000, 0, 1)).toBe(150);
		expect(get_campaign_auto_advance(1000, 750, 0.5)).toBe(50);
		expect(get_campaign_auto_advance(1000, 800, 0.5)).toBe(0);
		expect(CAMPAIGN_AUTO_CONTRIBUTION_CAP).toBe(0.8);
	});

	test('preserves the full automatic allowance after an early player contribution', () => {
		const item_total = 1000;
		const player_contribution = 200;
		let auto_contribution = 0;

		for (let tick = 0; tick < 8; tick++)
			auto_contribution += get_campaign_auto_advance(item_total, auto_contribution, 0.5);

		expect(auto_contribution).toBe(800);
		expect(player_contribution + auto_contribution).toBe(item_total);
	});

	test('persists automatic progress independently from an early player contribution', () => {
		const database = new Database(':memory:', { strict: true });
		database.run(
			'CREATE TABLE campaign_state (' +
			'id INTEGER PRIMARY KEY, guild_id INTEGER, item_amount INTEGER, ' +
			'item_current INTEGER, auto_contribution INTEGER)'
		);
		database.run(
			'INSERT INTO campaign_state VALUES (?, ?, ?, ?, ?)',
			[1, 1, 1000, 200, 0]
		);
		const update = database.query(CAMPAIGN_AUTO_PROGRESS_SQL);

		for (let tick = 0; tick < 8; tick++)
			update.get(100, 800, 100, 800, 1, 1);

		expect(database.query(
			'SELECT item_current, auto_contribution FROM campaign_state'
		).get()).toEqual({
			item_current: 1000,
			auto_contribution: 800
		});
		expect(update.get(100, 800, 100, 800, 1, 1)).toEqual({
			item_current: 1000,
			auto_contribution: 800
		});

		database.close();
	});
});
