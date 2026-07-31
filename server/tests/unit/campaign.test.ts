import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
	CAMPAIGN_AUTO_CONTRIBUTION_CAP,
	CAMPAIGN_AUTO_PROGRESS_SQL,
	get_campaign_auto_advance,
	get_campaign_item_total,
	get_required_campaign_contributors,
	round_campaign_estimate
} from '../../campaign';
import { AVAILABLE_CAMPAIGNS } from '../../campaign_data';

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
