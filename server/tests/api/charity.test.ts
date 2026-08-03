import { describe, expect, test } from 'bun:test';
import { make_guild_group, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';

type CharityContents = {
	items: Array<{
		id: string;
		qty: number;
	}>;
};

async function get_charity_contents(session_token: string): Promise<CharityContents> {
	const { response, json } = await get_json_with_session<CharityContents>(
		'/api/charity/contents',
		session_token
	);
	if (!response.ok)
		throw new Error(`Charity contents failed with ${response.status}`);

	return json;
}

describe('charity API', () => {
	test('rejects invalid donations and accepts modded donations', async () => {
		const client = await register_guild_client('Charity Validation');
		const invalid_quantity = await post('/api/charity/donate', {
			items: [{ id: 'melvorD:Coal_Ore', qty: 0 }]
		}, client.session_token);
		const malformed_id = await post('/api/charity/donate', {
			items: [{ id: 'exampleMod', qty: 1 }]
		}, client.session_token);
		const modded = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'exampleMod:Coal_Ore', qty: 1 }]
		}, client.session_token);

		expect(invalid_quantity.status).toBe(400);
		expect(malformed_id.status).toBe(400);
		expect(modded.json.success).toBe(true);
		expect(await get_charity_contents(client.session_token)).toEqual({
			items: [{ id: 'exampleMod:Coal_Ore', qty: 1 }]
		});
	});

	test('merges donations and exposes their truncated quantities', async () => {
		const client = await register_guild_client('Charity Donor');
		await post_json('/api/charity/donate', {
			items: [
				{ id: 'melvorD:Charity_Test_A', qty: 10.9 },
				{ id: 'melvorD:Charity_Test_B', qty: 5 }
			]
		}, client.session_token);
		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Test_A', qty: 2 }]
		}, client.session_token);
		const contents = await get_charity_contents(client.session_token);

		expect(contents.items).toEqual(expect.arrayContaining([
			{ id: 'melvorD:Charity_Test_A', qty: 12 },
			{ id: 'melvorD:Charity_Test_B', qty: 5 }
		]));
	});

	test('uses normal and bonus cooldown slots before rejecting another take', async () => {
		const [donor, taker, missing_taker] = await make_guild_group([
			'Charity Cooldown Donor',
			'Charity Cooldown Taker',
			'Charity Missing Taker'
		]);
		await post_json('/api/charity/donate', {
			items: [
				{ id: 'melvorD:Charity_Cooldown_A', qty: 11 },
				{ id: 'melvorD:Charity_Cooldown_B', qty: 12 },
				{ id: 'melvorD:Charity_Cooldown_C', qty: 13 }
			]
		}, donor.session_token);

		const missing = await post_json<{ error_lang: string }>('/api/charity/take', {
			item_id: 'melvorD:Charity_Does_Not_Exist'
		}, missing_taker.session_token);
		const first = await post_json<{
			success: boolean;
			item_qty: number;
			timeout: number;
			timeout_bonus: number;
		}>('/api/charity/take', {
			item_id: 'melvorD:Charity_Cooldown_A'
		}, taker.session_token);
		const second = await post_json<{
			success: boolean;
			item_qty: number;
			timeout: number;
			timeout_bonus: number;
		}>('/api/charity/take', {
			item_id: 'melvorD:Charity_Cooldown_B'
		}, taker.session_token);
		const exhausted = await post_json<{
			error_lang: string;
			timeout: number;
			timeout_bonus: number;
		}>('/api/charity/take', {
			item_id: 'melvorD:Charity_Cooldown_C'
		}, taker.session_token);

		expect(missing.json.error_lang).toBe('MOD_MP_CHARITY_TAKEN');
		expect(first.json.success).toBe(true);
		expect(first.json.item_qty).toBe(11);
		expect(first.json.timeout).toBeGreaterThan(0);
		expect(first.json.timeout_bonus).toBe(0);
		expect(second.json.success).toBe(true);
		expect(second.json.item_qty).toBe(12);
		expect(second.json.timeout).toBe(first.json.timeout);
		expect(second.json.timeout_bonus).toBeGreaterThan(0);
		expect(exhausted.json.error_lang).toBe('MOD_MP_CHARITY_TIMEOUT');
		expect(exhausted.json.timeout).toBe(first.json.timeout);
		expect(exhausted.json.timeout_bonus).toBe(second.json.timeout_bonus);

		const contents = await get_charity_contents(taker.session_token);
		expect(contents.items).not.toContainEqual(expect.objectContaining({
			id: 'melvorD:Charity_Cooldown_A'
		}));
		expect(contents.items).not.toContainEqual(expect.objectContaining({
			id: 'melvorD:Charity_Cooldown_B'
		}));
		expect(contents.items).toContainEqual({
			id: 'melvorD:Charity_Cooldown_C',
			qty: 13
		});
	});

	test('isolates donated inventory between guilds', async () => {
		const first = await register_guild_client('First Charity Donor', 'First Charity Guild');
		const second = await register_guild_client('Second Charity Browser', 'Second Charity Guild');
		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Isolated_Charity_Item', qty: 17 }]
		}, first.session_token);

		expect((await get_charity_contents(first.session_token)).items).toContainEqual({
			id: 'melvorD:Isolated_Charity_Item',
			qty: 17
		});
		expect((await get_charity_contents(second.session_token)).items).toEqual([]);
	});
});
