import { describe, expect, test } from 'bun:test';
import { make_guild_group, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

type CharityContents = {
	items: Array<{
		id: string;
		qty: number;
		expires_at: number;
		donated_at: number;
		contributors?: Array<{ client_id: number; icon_id: string }>;
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
		const incomplete_value = await post('/api/charity/donate', {
			items: [{ id: 'melvorD:Coal_Ore', qty: 1, value_per_item: 10 }]
		}, client.session_token);
		const malformed_value = await post('/api/charity/donate', {
			items: [{ id: 'melvorD:Coal_Ore', qty: 1, value_currency_id: 'melvorD:GP', value_per_item: -1 }]
		}, client.session_token);
		const modded = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'exampleMod:Coal_Ore', qty: 1 }]
		}, client.session_token);

		expect(invalid_quantity.status).toBe(400);
		expect(fractional_quantity.status).toBe(400);
		expect(malformed_id.status).toBe(400);
		expect(incomplete_value.status).toBe(400);
		expect(malformed_value.status).toBe(400);
		expect(modded.json.success).toBe(true);
		const contents = await get_charity_contents(client.session_token);
		expect(contents.items).toHaveLength(1);
		expect(contents.items[0]).toMatchObject({ id: 'exampleMod:Coal_Ore', qty: 1 });
		expect(contents.items[0].expires_at).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000);
	});

	test('learns one stack valuation and ignores later client valuation changes', async () => {
		const client = await register_guild_client('Charity Valuation');
		const item_id = 'melvorD:Charity_Valued_Leaf';
		await post_json('/api/charity/donate', {
			items: [{ id: item_id, qty: 5 }]
		}, client.session_token);
		await post_json('/api/charity/donate', {
			items: [{ id: item_id, qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 50 }]
		}, client.session_token);
		let rows = await db_all<{ qty: number; value_currency_id: string | null; value_per_item: number | null }>(
			'SELECT `qty`, `value_currency_id`, `value_per_item` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ?',
			[client.guild_id, item_id]
		);
		expect(rows).toEqual([{ qty: 6, value_currency_id: 'melvorD:GP', value_per_item: 50 }]);

		await post_json('/api/charity/donate', {
			items: [{ id: item_id, qty: 1, value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 999 }]
		}, client.session_token);
		rows = await db_all<{ qty: number; value_currency_id: string | null; value_per_item: number | null }>(
			'SELECT `qty`, `value_currency_id`, `value_per_item` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ?',
			[client.guild_id, item_id]
		);
		expect(rows).toEqual([{ qty: 7, value_currency_id: 'melvorD:GP', value_per_item: 50 }]);
	});

	test('uses server-known valuations for transfer currencies', async () => {
		const client = await register_guild_client('Charity Currency Valuation');
		await post_json('/api/charity/donate', {
			items: [
				{ id: 'melvorD:GP', qty: 2, value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 999 },
				{ id: 'melvorD:SlayerCoins', qty: 3 },
				{ id: 'melvorItA:AbyssalPieces', qty: 4 },
				{ id: 'melvorItA:AbyssalSlayerCoins', qty: 5 }
			]
		}, client.session_token);
		expect(await db_all<{ item_id: string; value_currency_id: string | null; value_per_item: number | null }>(
			'SELECT `item_id`, `value_currency_id`, `value_per_item` FROM `charity_items` WHERE `guild_id` = ? ORDER BY `item_id`',
			[client.guild_id]
		)).toEqual([
			{ item_id: 'melvorD:GP', value_currency_id: 'melvorD:GP', value_per_item: 1 },
			{ item_id: 'melvorD:SlayerCoins', value_currency_id: 'melvorD:GP', value_per_item: 1 },
			{ item_id: 'melvorItA:AbyssalPieces', value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 },
			{ item_id: 'melvorItA:AbyssalSlayerCoins', value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 }
		]);
	});

	test('caps each currency independently in Charitree donations', async () => {
		const client = await register_guild_client('Charity Cap Donor');
		const donation = await post_json<{ receipt: { effects: unknown[] } }>('/api/v2/charity/donate', {
			items: [
				{ id: 'melvorD:GP', qty: 1_000_000_005 },
				{ id: 'melvorD:SlayerCoins', qty: 1_000_005 },
				{ id: 'melvorD:Charity_Cap_Item', qty: 2 }
			],
			donation_value: 1_000_000_012,
			command_id: crypto.randomUUID()
		}, client.session_token);
		const rows = await db_all<{ item_id: string; qty: number }>(
			'SELECT `item_id`, `qty` FROM `charity_items` WHERE `guild_id` = ? ORDER BY `item_id`', [client.guild_id]
		);

		expect(donation.json.receipt.effects).toEqual([
			{ storage: 'transfer', item_id: 'melvorD:GP', qty: -1_000_000_000 },
			{ storage: 'transfer', item_id: 'melvorD:SlayerCoins', qty: -1_000_000 },
			{ storage: 'transfer', item_id: 'melvorD:Charity_Cap_Item', qty: -2 }
		]);
		expect(rows).toEqual([
			{ item_id: 'melvorD:Charity_Cap_Item', qty: 2 },
			{ item_id: 'melvorD:GP', qty: 1_000_000_000 },
			{ item_id: 'melvorD:SlayerCoins', qty: 1_000_000 }
		]);
	});

	test('returns Bank effects for bank-originated donations and Transfer effects by default', async () => {
		const client = await register_guild_client('Bank Charity Donor');
		const item_id = 'melvorD:Bank_Charity_Item';
		const bank_command_id = crypto.randomUUID();
		const bank_donation = await post_json<{
			success: boolean;
			receipt: { effects: Array<Record<string, unknown>> };
		}>('/api/v2/charity/donate', {
			items: [{ id: item_id, qty: 2 }],
			source: 'bank',
			donation_value: 0,
			command_id: bank_command_id
		}, client.session_token);
		const transfer_donation = await post_json<{
			success: boolean;
			receipt: { effects: Array<Record<string, unknown>> };
		}>('/api/v2/charity/donate', {
			items: [{ id: item_id, qty: 1 }],
			donation_value: 0,
			command_id: crypto.randomUUID()
		}, client.session_token);

		expect(bank_donation.json).toMatchObject({
			success: true,
			receipt: { id: bank_command_id, effects: [{ storage: 'bank', item_id, qty: -2 }] }
		});
		expect(transfer_donation.json).toMatchObject({
			success: true,
			receipt: { effects: [{ storage: 'transfer', item_id, qty: -1 }] }
		});
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

	test('shows the top three surviving contributors after FIFO takes', async () => {
		const [bob, lucy, alice, eve] = await make_guild_group(
			['Charity Avatar Bob', 'Charity Avatar Lucy', 'Charity Avatar Alice', 'Charity Avatar Eve'],
			'Charity Avatar Guild'
		);
		await db_run('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', ['melvorD:Bob', bob.client_id]);
		await db_run('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', ['melvorD:Lucy', lucy.client_id]);
		await db_run('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', ['melvorD:Alice', alice.client_id]);
		await db_run('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', ['melvorD:Eve', eve.client_id]);
		const item_id = 'melvorD:Charity_Avatar_Stack';
		await post_json('/api/charity/donate', { items: [{ id: item_id, qty: 100 }] }, bob.session_token);
		await post_json('/api/charity/take', {
			item_id, qty: 75, command_id: crypto.randomUUID()
		}, alice.session_token);
		await post_json('/api/charity/donate', { items: [{ id: item_id, qty: 30 }] }, lucy.session_token);
		await post_json('/api/charity/donate', { items: [{ id: item_id, qty: 5 }] }, alice.session_token);
		await post_json('/api/charity/donate', { items: [{ id: item_id, qty: 1 }] }, eve.session_token);

		let stack = (await get_charity_contents(bob.session_token)).items.find(item => item.id === item_id);
		expect(stack).toMatchObject({
			qty: 61,
			contributors: [
				{ client_id: lucy.client_id, icon_id: 'melvorD:Lucy' },
				{ client_id: bob.client_id, icon_id: 'melvorD:Bob' },
				{ client_id: alice.client_id, icon_id: 'melvorD:Alice' }
			]
		});

		const tied_item_id = 'melvorD:Charity_Avatar_FIFO';
		await post_json('/api/charity/donate', { items: [{ id: tied_item_id, qty: 2 }] }, bob.session_token);
		await post_json('/api/charity/donate', { items: [{ id: tied_item_id, qty: 2 }] }, lucy.session_token);
		await db_run('UPDATE `clients` SET `last_charity` = 0, `last_bonus_charity` = 0 WHERE `id` = ?', [alice.client_id]);
		await post_json('/api/charity/take', {
			item_id: tied_item_id, qty: 2, command_id: crypto.randomUUID()
		}, alice.session_token);
		stack = (await get_charity_contents(bob.session_token)).items.find(item => item.id === tied_item_id);
		expect(stack).toMatchObject({
			qty: 2,
			contributors: [{ client_id: lucy.client_id, icon_id: 'melvorD:Lucy' }]
		});
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

	test('converts expiring GP value into permanent Weird Gloop and claims it normally', async () => {
		const client = await register_guild_client('Charity Gloop');
		const gloop_id = 'melvorD:Weird_Gloop';
		await post_json('/api/charity/donate', {
			items: [
				{ id: 'melvorD:Charity_Gloop_1000', qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 1000 },
				{ id: 'melvorD:Charity_Gloop_1001', qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 1001 },
				{ id: 'melvorD:Charity_Gloop_No_Value', qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 0 },
				{ id: 'melvorD:Charity_Gloop_AP_Value', qty: 1, value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 999999 },
				{ id: gloop_id, qty: 2, value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 7 }
			]
		}, client.session_token);
		await db_run(
			'UPDATE `charity_items` SET `expires_at` = ? WHERE `guild_id` = ? AND `item_id` != ?',
			[Date.now() - 1, client.guild_id, gloop_id]
		);

		const contents = await get_charity_contents(client.session_token);
		expect(contents.items[0]).toMatchObject({ id: gloop_id, qty: 5, expires_at: 0 });
		expect(contents.items.find(item => item.id === 'melvorD:Charity_Gloop_1000')).toBeUndefined();
		expect(contents.items.find(item => item.id === 'melvorD:Charity_Gloop_1001')).toBeUndefined();
		expect(contents.items.find(item => item.id === 'melvorD:Charity_Gloop_No_Value')).toBeUndefined();
		expect(contents.items.find(item => item.id === 'melvorD:Charity_Gloop_AP_Value')).toBeUndefined();
		expect(await db_all<{ value_currency_id: string | null; value_per_item: number | null }>(
			'SELECT `value_currency_id`, `value_per_item` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ?',
			[client.guild_id, gloop_id]
		)).toEqual([{ value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 7 }]);

		const claim = await post_json<{ success: boolean; item_qty: number; item_remaining_qty: number; item_expires_at: number }>(
			'/api/charity/take', { item_id: gloop_id, command_id: crypto.randomUUID() }, client.session_token
		);
		expect(claim.json).toMatchObject({ success: true, item_qty: 5, item_remaining_qty: 0, item_expires_at: 0 });
		expect((await get_charity_contents(client.session_token)).items).toEqual([]);
		expect((await get_json_with_session<{ items: Array<{ item_id: string; qty: number }> }>(
			'/api/inbox', client.session_token
		)).json.items).toEqual([{ item_id: gloop_id, qty: 5 }]);
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
			error_lang: string;
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
		expect(second.json.error_lang).toBe('MOD_MP_CHARITY_TIMEOUT');
		expect(second.json.timeout).toBe(first.json.timeout);
		expect(second.json.timeout_bonus).toBe(0);
		expect(exhausted.json.error_lang).toBe('MOD_MP_CHARITY_TIMEOUT');
		expect(exhausted.json.timeout).toBe(first.json.timeout);
		expect(exhausted.json.timeout_bonus).toBe(0);

		const contents = await get_charity_contents(taker.session_token);
		expect(contents.items).not.toContainEqual(expect.objectContaining({
			id: 'melvorD:Charity_Cooldown_A'
		}));
		expect(contents.items).toContainEqual(expect.objectContaining({
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
			items: [{ id: item_id, qty: 3, value_currency_id: 'melvorD:GP', value_per_item: 1000 }]
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
		expect((await get_charity_contents(taker.session_token)).items).toContainEqual(expect.objectContaining({
			id: item_id,
			qty: 2,
			expires_at: taken.json.item_expires_at
		}));
		await db_run(
			'UPDATE `charity_items` SET `expires_at` = ? WHERE `guild_id` = ? AND `item_id` = ?',
			[Date.now() - 1, donor.guild_id, item_id]
		);
		expect((await get_charity_contents(taker.session_token)).items).toEqual([{
			id: 'melvorD:Weird_Gloop',
			qty: 2,
			expires_at: 0,
			donated_at: 0
		}]);
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

		const missing_value = await post_json<{ success: boolean }>('/api/charity/donate', {
			items: [{ id: 'melvorD:Charity_Server_Owned', qty: 1 }],
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(missing_value.json.success).toBe(true);

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
