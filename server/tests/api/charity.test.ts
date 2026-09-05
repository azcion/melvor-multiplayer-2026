import { describe, expect, test } from 'bun:test';
import { make_guild_group, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_count, db_run } from '../support/persistence';

type CharityContents = {
	items: Array<{
		id: string;
		qty: number;
		expires_at: number;
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
	test('returns server-authoritative Charitree eligibility during save-load authentication and Guild refresh', async () => {
		const client = await register_guild_client('Charity State', 'Charity State Guild', '1.5.3');
		const last_charity = Date.now();
		await db_run('UPDATE `clients` SET `last_charity` = ? WHERE `id` = ?', [last_charity, client.client_id]);

		const authenticated = await post_json<{
			session_token: string;
			charity: { enabled: boolean; eligible: boolean; next_opportunity_at: number };
		}>('/api/authenticate', {
			client_identifier: client.client_identifier,
			client_key: client.client_key,
			client_runtime: { mod_version: '1.5.3', active_mods: [] }
		});
		expect(authenticated.response.status).toBe(200);
		expect(authenticated.json.charity.enabled).toBe(true);
		expect(authenticated.json.charity.eligible).toBe(false);
		expect(authenticated.json.charity.next_opportunity_at).toBeGreaterThan(last_charity);
		expect(authenticated.json.charity.next_opportunity_at - last_charity).toBe(20 * 60 * 60 * 1000);

		const guild_state = await get_json_with_session<{
			charity: { enabled: boolean; eligible: boolean; next_opportunity_at: number };
		}>('/api/guilds/state', authenticated.json.session_token);
		expect(guild_state.json.charity).toEqual(authenticated.json.charity);
	});

	test('rejects invalid donations and accepts modded donations', async () => {
		const client = await register_guild_client('Charity Validation');
		const invalid_quantity = await post('/api/charity/donate', {
			items: [{ id: 'melvorD:Coal_Ore', qty: 0 }]
		}, client.session_token);
		const fractional_quantity = await post('/api/charity/donate', {
			items: [{ id: 'melvorD:Coal_Ore', qty: 0.5 }]
		}, client.session_token);
		const malformed_id = await post('/api/charity/donate', {
			items: [{ id: 'exampleMod', qty: 1 }]
		}, client.session_token);
		const modded = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'exampleMod:Coal_Ore', qty: 1 }]
		}, client.session_token);

		expect(invalid_quantity.status).toBe(400);
		expect(fractional_quantity.status).toBe(400);
		expect(malformed_id.status).toBe(400);
		expect(modded.json.success).toBe(true);
		const contents = await get_charity_contents(client.session_token);
		expect(contents.items).toHaveLength(1);
		expect(contents.items[0]).toMatchObject({ id: 'exampleMod:Coal_Ore', qty: 1 });
		expect(contents.items[0].expires_at).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000);
	});

	test('merges positive integer donations', async () => {
		const client = await register_guild_client('Charity Donor', 'Test Guild', '1.5.2');
		await post_json('/api/charity/donate', {
			items: [
				{ id: 'melvorD:Charity_Test_A', qty: 10 },
				{ id: 'melvorD:Charity_Test_B', qty: 5 }
			]
		}, client.session_token);
		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Test_A', qty: 2 }]
		}, client.session_token);
		const contents = await get_charity_contents(client.session_token);

		expect(contents.items).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: 'melvorD:Charity_Test_A', qty: 12 }),
			expect.objectContaining({ id: 'melvorD:Charity_Test_B', qty: 5 })
		]));
	});

	test('accepts at most 32 distinct donation entries', async () => {
		const client = await register_guild_client('Charity Entry Limit');
		const maximum = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: Array.from({ length: 32 }, (_, index) => ({ id: `melvorD:Charity_Limit_${index}`, qty: 1 }))
		}, client.session_token);
		const too_many = await post('/api/charity/donate', {
			items: Array.from({ length: 33 }, (_, index) => ({ id: `melvorD:Charity_Extra_${index}`, qty: 1 }))
		}, client.session_token);

		expect(maximum.json.success).toBe(true);
		expect(too_many.status).toBe(400);
		expect((await get_charity_contents(client.session_token)).items).toHaveLength(32);
	});

	test('resets a merged stack expiry and removes expired stacks during reads', async () => {
		const client = await register_guild_client('Charity Expiry Donor');
		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Expiry_A', qty: 3 }]
		}, client.session_token);
		await db_run(
			'UPDATE `charity_items` SET `expires_at` = ? WHERE `guild_id` = ? AND `item_id` = ?',
			[Date.now() + 1000, client.guild_id, 'melvorD:Charity_Expiry_A']
		);

		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Expiry_A', qty: 2 }]
		}, client.session_token);
		let contents = await get_charity_contents(client.session_token);
		expect(contents.items[0]).toMatchObject({ id: 'melvorD:Charity_Expiry_A', qty: 5 });
		expect(contents.items[0].expires_at).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000);

		await db_run(
			'UPDATE `charity_items` SET `expires_at` = ? WHERE `guild_id` = ? AND `item_id` = ?',
			[Date.now() - 1, client.guild_id, 'melvorD:Charity_Expiry_A']
		);
		contents = await get_charity_contents(client.session_token);
		expect(contents.items).toEqual([]);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `charity_items` WHERE `guild_id` = ?',
			[client.guild_id]
		)).toBe(0);
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
		expect(contents.items).toContainEqual(expect.objectContaining({
			id: 'melvorD:Charity_Cooldown_C',
			qty: 13
		}));
	});

	test('takes one item from a stack and refreshes the remaining stack expiry', async () => {
		const [donor, taker] = await make_guild_group([
			'Charity Partial Donor',
			'Charity Partial Taker'
		]);
		const item_id = 'melvorD:Charity_Partial_Take';
		await post_json('/api/charity/donate', {
			items: [{ id: item_id, qty: 3 }]
		}, donor.session_token);
		await db_run(
			'UPDATE `charity_items` SET `expires_at` = ? WHERE `guild_id` = ? AND `item_id` = ?',
			[Date.now() + 1000, donor.guild_id, item_id]
		);
		expect((await post('/api/charity/take', { item_id, qty: 0 }, taker.session_token)).status).toBe(400);

		const taken = await post_json<{
			success: boolean;
			item_qty: number;
			item_remaining_qty: number;
			item_expires_at: number;
		}>('/api/charity/take', { item_id, qty: 1 }, taker.session_token);

		expect(taken.json).toMatchObject({
			success: true,
			item_qty: 1,
			item_remaining_qty: 2
		});
		expect(taken.json.item_expires_at).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000);
		expect((await get_charity_contents(taker.session_token)).items).toContainEqual({
			id: item_id,
			qty: 2,
			expires_at: taken.json.item_expires_at
		});
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', taker.session_token
		)).json.items).toEqual([{ item_id, qty: 1 }]);
	});

	test('isolates donated inventory between guilds', async () => {
		const first = await register_guild_client('First Charity Donor', 'First Charity Guild');
		const second = await register_guild_client('Second Charity Browser', 'Second Charity Guild');
		await post_json('/api/charity/donate', {
			items: [{ id: 'melvorD:Isolated_Charity_Item', qty: 17 }]
		}, first.session_token);

		expect((await get_charity_contents(first.session_token)).items).toContainEqual(expect.objectContaining({
			id: 'melvorD:Isolated_Charity_Item',
			qty: 17
		}));
		expect((await get_charity_contents(second.session_token)).items).toEqual([]);
	});

	test('uses the 1.5.3 server-owned flow and disables the second daily take', async () => {
		const client = await register_guild_client('Pet Charity', 'Pet Charity Guild', '1.5.3');
		const empty_donation = await post('/api/charity/donate', {
			items: [],
			donation_value: 0,
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(empty_donation.status).toBe(400);

		const missing_value = await post('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Server_Owned', qty: 1 }],
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(missing_value.status).toBe(400);

		const command_id = crypto.randomUUID();
		const donation = await post_json<{
			success: boolean;
			receipt: { id: string; kind: string; effects: Array<Record<string, unknown>> };
		}>('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Server_Owned', qty: 1 }],
			donation_value: 200,
			command_id
		}, client.session_token);
		expect(donation.json.success).toBe(true);
		expect(donation.json.receipt).toMatchObject({ id: command_id, kind: 'charity-donate' });
		const replay = await post_json<typeof donation.json>('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Server_Owned', qty: 1 }],
			donation_value: 200,
			command_id
		}, client.session_token);
		expect(replay.json).toEqual(donation.json);

		await db_run('UPDATE `clients` SET `last_charity` = ? WHERE `id` = ?', [Date.now(), client.client_id]);
		const take = await post_json<{ error_lang: string }>('/api/charity/take', {
			item_id: 'melvorD:Charity_Server_Owned',
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(take.json.error_lang).toBe('MOD_MP_CHARITY_TIMEOUT');
	});
});
