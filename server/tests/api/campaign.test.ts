import { describe, expect, test } from 'bun:test';
import { round_campaign_estimate } from '../../campaign';
import { AVAILABLE_CAMPAIGNS } from '../../campaign_data';
import { get_events, make_guild_group, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_run } from '../support/persistence';
import { SHADOWED_AFTER } from '../../shadowed';

type ActiveCampaign = {
	active: true;
	history: unknown[];
	rankings: Record<string, number>;
	campaign_id: string;
	contribution: number;
	item_id: string;
	item_total: number;
	max_contribution: number;
};

async function get_campaign_info(session_token: string): Promise<ActiveCampaign> {
	const { response, json } = await get_json_with_session<ActiveCampaign>(
		'/api/campaign/info',
		session_token
	);
	if (!response.ok)
		throw new Error(`Campaign info failed with ${response.status}`);

	return json;
}

describe('campaign API', () => {
	test('exposes active campaign and initial player progress', async () => {
		const client = await register_guild_client('Campaign Info');
		const info = await get_campaign_info(client.session_token);
		const events = await get_events(client);

		expect(info.active).toBe(true);
		expect(info.campaign_id).toMatch(/^campaign_/);
		expect(info.item_id).toMatch(/^melvor/);
		expect(info.item_total).toBeGreaterThan(0);
		expect(info.contribution).toBe(0);
		expect(info.history).toEqual([]);
		expect(info.rankings).toEqual({});
		expect(events.campaign.active).toBe(true);
		expect(events.campaign.pct).toBeGreaterThanOrEqual(0);
	});

	test('validates contributions and enforces the cumulative player cap', async () => {
		const [client] = await make_guild_group([
			'Campaign Contributor',
			'Campaign Member Two',
			'Campaign Member Three',
			'Campaign Member Four'
		], 'Campaign Cap');
		const before = await get_campaign_info(client.session_token);
		const invalid = await post('/api/campaign/contribute', {
			item_amount: 0
		}, client.session_token);
		const first = await post_json<{
			success: boolean;
			item_id: string;
			item_loss: number;
			campaign_pct: number;
		}>('/api/campaign/contribute', {
			item_amount: before.item_total
		}, client.session_token);
		const second = await post_json<{
			success: boolean;
			item_id: string;
			item_loss: number;
			campaign_pct: number;
		}>('/api/campaign/contribute', {
			item_amount: before.item_total
		}, client.session_token);
		const after = await get_campaign_info(client.session_token);

		expect(invalid.status).toBe(400);
		expect(first.json.success).toBe(true);
		expect(first.json.item_id).toBe(before.item_id);
		expect(before.max_contribution).toBe(before.item_total * 0.5);
		expect(first.json.item_loss).toBe(before.max_contribution);
		expect(first.json.campaign_pct).toBeGreaterThan(0);
		expect(second.json.item_loss).toBe(0);
		expect(second.json.campaign_pct).toBe(first.json.campaign_pct);
		expect(after.contribution).toBe(before.max_contribution);
	});

	test('scales the selected item goal for the starting Guild size', async () => {
		const [client] = await make_guild_group([
			'Campaign Scale One',
			'Campaign Scale Two',
			'Campaign Scale Three',
			'Campaign Scale Four',
			'Campaign Scale Five',
			'Campaign Scale Six'
		], 'Campaign Scale');
		const campaign = await get_campaign_info(client.session_token);
		const selected_item = AVAILABLE_CAMPAIGNS
			.flatMap(entry => entry.items)
			.find(item => item.id === campaign.item_id);

		expect(selected_item).toBeDefined();
		expect(campaign.item_total).toBe(
			round_campaign_estimate(selected_item?.estimated_12h_output ?? 0) * 3
		);
		expect(campaign.max_contribution).toBe(campaign.item_total / 3);
	});

	test('excludes Shadowed members from sizing without resizing when they return', async () => {
		const founder = await register_guild_client('Campaign Shadow Founder', 'Campaign Shadows');
		const applicants = await Promise.all([
			register_client('Campaign Active Two'),
			register_client('Campaign Active Three'),
			register_client('Campaign Active Four'),
			register_client('Campaign Shadow Five'),
			register_client('Campaign Shadow Six')
		]);
		await Promise.all(applicants.map(applicant => post_json('/api/guilds/apply', {
			guild_id: founder.guild_id
		}, applicant.session_token)));
		await db_run(
			'UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` IN (?, ?)',
			[Date.now() - SHADOWED_AFTER - 1_000, applicants[3].client_id, applicants[4].client_id]
		);
		const guild = await get_json_with_session<{
			applicants: Array<{ application_id: number }>;
		}>('/api/guilds/state', founder.session_token);
		for (const application of guild.json.applicants) {
			await post_json('/api/guilds/application/decide', {
				application_id: application.application_id,
				approve: true
			}, founder.session_token);
		}

		const before_return = await get_campaign_info(founder.session_token);
		const selected_item = AVAILABLE_CAMPAIGNS
			.flatMap(entry => entry.items)
			.find(item => item.id === before_return.item_id);
		expect(before_return.item_total).toBe(
			round_campaign_estimate(selected_item?.estimated_12h_output ?? 0) * 2
		);
		expect(before_return.max_contribution).toBe(before_return.item_total / 2);

		await db_run(
			'UPDATE `clients` SET `last_multiplayer_active_at` = ? WHERE `id` = ?',
			[Date.now(), applicants[3].client_id]
		);
		await get_campaign_info(applicants[3].session_token);
		const after_return = await get_campaign_info(founder.session_token);
		expect(after_return.item_total).toBe(before_return.item_total);
		expect(after_return.max_contribution).toBe(before_return.max_contribution);
	});

	test('rejects malformed and unavailable campaign claims', async () => {
		const client = await register_guild_client('Campaign Claim');
		const malformed = await post('/api/campaign/claim', {
			campaign_id: 'not-a-number',
			value: 1
		}, client.session_token);
		const unavailable = await post('/api/campaign/claim', {
			campaign_id: -1,
			value: 1
		}, client.session_token);

		expect(malformed.status).toBe(400);
		expect(unavailable.status).toBe(400);
	});

	test('isolates campaign progress between guilds and rejects guildless access', async () => {
		const first = await register_guild_client('First Campaign Member', 'Campaign One');
		const second = await register_guild_client('Second Campaign Member', 'Campaign Two');
		const guildless = await register_client('Guildless Campaign Player');
		const second_before = await get_events(second);

		await post_json('/api/campaign/contribute', {
			item_amount: 10
		}, first.session_token);
		const first_after = await get_events(first);
		const second_after = await get_events(second);
		const unavailable = await get_json_with_session<{ error_lang: string }>(
			'/api/campaign/info',
			guildless.session_token
		);

		expect(first_after.campaign.pct).toBeGreaterThan(0);
		expect(second_after.campaign.pct).toBe(second_before.campaign.pct);
		expect(unavailable.json.error_lang).toBe('MOD_MP_GUILD_REQUIRED');
	});
});
