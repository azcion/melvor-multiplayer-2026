import { describe, expect, test } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post, post_json, register_client } from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

async function attach_account(client_id: number, label: string): Promise<void> {
	await db_run(
		'INSERT INTO `melvor_accounts` (`cloud_username`, `playfab_id`, `created_at`) VALUES(?, ?, ?)',
		[label, `wish-${crypto.randomUUID()}`, Date.now()]
	);
	const [account] = await db_all<{ id: number }>('SELECT `id` FROM `melvor_accounts` WHERE `cloud_username` = ?', [label]);
	await db_run('UPDATE `clients` SET `melvor_account_id` = ? WHERE `id` = ?', [account?.id, client_id]);
}

async function add_shuffle_events(owner_key: string, count: number, now = Date.now()): Promise<void> {
	for (let index = 0; index < count; index++)
		await db_run(
			'INSERT INTO `charity_shuffle_events` (`owner_key`, `shuffled_at`) VALUES(?, ?)',
			[owner_key, now - index - 1]
		);
}

describe('Charitree Wishes', () => {
	test('uses the timed promo duration only while the operator window is active', async () => {
		const active = await register_guild_client('Promo Wish Owner', 'Promo Wish Guild', '1.5.7');
		await attach_account(active.client_id, 'Promo Wish Account');
		const before = Date.now();
		await db_run("UPDATE `service_settings` SET `value` = ? WHERE `key` = 'charity_wish_promo_ends_at'", [before + 24 * 60 * 60 * 1000]);
		const made = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, active.session_token);
		expect(made.json.success).toBe(true);
		const promoted = await db_all<{ created_at: number; matures_at: number }>(
			'SELECT `created_at`, `matures_at` FROM `charity_wishes` WHERE `id` = ?', [made.json.wish_id]
		);
		expect(promoted[0]!.matures_at - promoted[0]!.created_at).toBe(60 * 60 * 1000);

		await db_run("UPDATE `service_settings` SET `value` = ? WHERE `key` = 'charity_wish_promo_ends_at'", [before - 1]);
		const normal = await register_guild_client('Normal Wish Owner', 'Normal Wish Guild', '1.5.7');
		await attach_account(normal.client_id, 'Normal Wish Account');
		const ordinary = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, normal.session_token);
		const unpromoted = await db_all<{ created_at: number; matures_at: number }>(
			'SELECT `created_at`, `matures_at` FROM `charity_wishes` WHERE `id` = ?', [ordinary.json.wish_id]
		);
		expect(unpromoted[0]!.matures_at - unpromoted[0]!.created_at).toBe(4 * 24 * 60 * 60 * 1000);
	});

	test('makes, ripens, picks, and replays one Wish without an Economy Receipt', async () => {
		const client = await register_guild_client('Wish Owner', 'Wish Lifecycle', '1.5.7');
		await attach_account(client.client_id, 'Wish Lifecycle Account');
		const command_id = crypto.randomUUID();
		const made = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id
		}, client.session_token);
		expect(made.json.success).toBe(true);
		const replay = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id
		}, client.session_token);
		expect(replay.json).toEqual(made.json);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_wishes` WHERE `owner_client_id` = ?', [client.client_id])).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `economy_receipts` WHERE `client_id` = ?', [client.client_id])).toBe(0);

		const initial = await get_json_with_session<{
			wishes: Array<{ phase: string; progress_gp: number; required_gp: number; owned: boolean }>;
			wish_catalog: Array<{ id: string; max_item_value: number }>;
		}>('/api/charity/contents', client.session_token);
		expect(initial.json.wishes).toEqual([expect.objectContaining({
			phase: 'maturing', progress_gp: 0, required_gp: 500, owned: true
		})]);
		expect(initial.json.wish_catalog).toContainEqual({ id: 'melvorAoD:Torn_Parchment', max_item_value: 100 });

		await db_run('UPDATE `charity_wishes` SET `created_at` = 0, `matures_at` = 0 WHERE `id` = ?', [made.json.wish_id]);
		await db_run(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES(?, 'test:Wish_Fuel', 499, 0, 0, 'melvorD:GP', 1)",
			[client.guild_id]
		);
		const ripening = await get_json_with_session<{ wishes: Array<{ phase: string; progress_gp: number }> }>(
			'/api/charity/contents', client.session_token
		);
		expect(ripening.json.wishes[0]).toEqual(expect.objectContaining({ phase: 'ripening', progress_gp: 499 }));

		await db_run(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES(?, 'test:Wish_Fuel_Final', 1, 0, 0, 'melvorD:GP', 1)",
			[client.guild_id]
		);
		const ripe = await get_json_with_session<{ wishes: Array<{ phase: string; progress_gp: number }> }>(
			'/api/charity/contents', client.session_token
		);
		expect(ripe.json.wishes[0]).toEqual(expect.objectContaining({ phase: 'ripe', progress_gp: 500 }));

		const picked = await post_json<{ success: boolean }>('/api/charity/wish/pick', {
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(picked.json.success).toBe(true);
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `inbox_items` WHERE `client_id` = ? AND `source_type` = 'wish_granted' " +
			"AND `item_id` = 'melvorAoD:Torn_Parchment' AND `qty` = 1",
			[client.client_id]
		)).toBe(1);
	});

	test('forsakes only a Maturing Wish and releases the account-group lock', async () => {
		const client = await register_guild_client('Wish Forsaker', 'Wish Forsaking', '1.5.7');
		await attach_account(client.client_id, 'Wish Forsaking Account');
		const make = () => post_json<{ success: boolean }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 2, command_id: crypto.randomUUID()
		}, client.session_token);
		expect((await make()).json.success).toBe(true);
		expect((await post_json<{ success: boolean }>('/api/charity/wish/forsake', {
			command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		expect((await make()).json.success).toBe(true);
	});

	test('caps the effective Shuffle Bonus while preserving Wish headroom and discarding overflow', async () => {
		const client = await register_guild_client('Shuffle Wish Owner', 'Shuffle Wish Guild', '1.5.7');
		await attach_account(client.client_id, 'Shuffle Wish Account');
		const [account] = await db_all<{ melvor_account_id: number }>(
			'SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?', [client.client_id]
		);
		const owner_key = `account:${account?.melvor_account_id}`;
		await add_shuffle_events(owner_key, 16);
		const contents = () => get_json_with_session<{ shuffle_count: number }>('/api/charity/contents', client.session_token);
		expect((await contents()).json.shuffle_count).toBe(16);

		expect((await post_json<{ success: boolean }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		expect((await contents()).json.shuffle_count).toBe(6);
		await add_shuffle_events(owner_key, 5);
		expect((await contents()).json.shuffle_count).toBe(11);

		expect((await post_json<{ success: boolean }>('/api/charity/wish/forsake', {
			command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		expect((await contents()).json.shuffle_count).toBe(20);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_shuffle_events` WHERE `owner_key` = ?', [owner_key])).toBe(20);
		const wasted_no_wish_shuffle = await post_json<{ success: boolean; shuffle_count: number }>('/api/v2/charity/shuffle', {
			currency_id: 'melvorD:GP', balance: 10000, command_id: crypto.randomUUID()
		}, client.session_token);
		expect(wasted_no_wish_shuffle.json).toMatchObject({ success: true, shuffle_count: 20 });
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_shuffle_events` WHERE `owner_key` = ?', [owner_key])).toBe(20);

		expect((await post_json<{ success: boolean }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		expect((await contents()).json.shuffle_count).toBe(10);
		await add_shuffle_events(owner_key, 10);
		expect((await contents()).json.shuffle_count).toBe(20);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_shuffle_events` WHERE `owner_key` = ?', [owner_key])).toBe(30);
		const wasted_wish_shuffle = await post_json<{ success: boolean; shuffle_count: number }>('/api/v2/charity/shuffle', {
			currency_id: 'melvorD:SlayerCoins', balance: 10000, command_id: crypto.randomUUID()
		}, client.session_token);
		expect(wasted_wish_shuffle.json).toMatchObject({ success: true, shuffle_count: 20 });
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_shuffle_events` WHERE `owner_key` = ?', [owner_key])).toBe(30);

		expect((await post_json<{ success: boolean }>('/api/charity/wish/forsake', {
			command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		expect((await contents()).json.shuffle_count).toBe(20);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_shuffle_events` WHERE `owner_key` = ?', [owner_key])).toBe(20);
		expect((await post_json<{ success: boolean }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		expect((await contents()).json.shuffle_count).toBe(10);
	});

	test('allows the active Wish penalty to reach -10 at zero Shuffle Bonus', async () => {
		const client = await register_guild_client('Negative Shuffle Owner', 'Negative Shuffle', '1.5.7');
		await attach_account(client.client_id, 'Negative Shuffle Account');
		expect((await post_json<{ success: boolean }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		const contents = await get_json_with_session<{ shuffle_count: number }>('/api/charity/contents', client.session_token);
		expect(contents.json.shuffle_count).toBe(-10);
	});

	test('rejects Wish mutations while the owner is in Social Only mode', async () => {
		const client = await register_guild_client('Wish Social Only', 'Wish Social Guild', '1.5.7');
		await attach_account(client.client_id, 'Wish Social Only Account');
		const make = () => post_json<{ success: boolean }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, client.session_token);

		await make();
		const social = await post_json<{ success: boolean; social_mode: string }>('/api/social-mode/set', {
			mode: 'social', command_id: crypto.randomUUID()
		}, client.session_token);
		expect(social.json).toMatchObject({ success: true, social_mode: 'social' });
		const forsaken = await post_json<{ success: boolean; error_lang: string }>('/api/charity/wish/forsake', {
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(forsaken.json).toEqual({ success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' });

		await post_json('/api/social-mode/set', { mode: 'full', command_id: crypto.randomUUID() }, client.session_token);
		const wish = await db_all<{ id: number }>(
			'SELECT `id` FROM `charity_wishes` WHERE `owner_client_id` = ?', [client.client_id]
		);
		await db_run('UPDATE `charity_wishes` SET `progress_gp` = `required_gp` WHERE `id` = ?', [wish[0]?.id]);
		await post_json('/api/social-mode/set', { mode: 'social', command_id: crypto.randomUUID() }, client.session_token);
		const picked = await post_json<{ success: boolean; error_lang: string }>('/api/charity/wish/pick', {
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(picked.json).toEqual({ success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' });
		await post_json('/api/social-mode/set', { mode: 'full', command_id: crypto.randomUUID() }, client.session_token);
		const cleanup = await post_json<{ success: boolean }>('/api/charity/wish/pick', {
			command_id: crypto.randomUUID()
		}, client.session_token);
		expect(cleanup.json.success).toBe(true);
	});

	test('shares rounded progress, redistributes capped value, and hides Wishes from older clients', async () => {
		const pair = await make_guildmates('Wish Sharer One', 'Wish Sharer Two', 'Wish Sharing', {
			first: '1.5.7', second: '1.5.7'
		});
		await attach_account(pair.first_id, 'Wish Sharing Account One');
		await attach_account(pair.second_id, 'Wish Sharing Account Two');
		for (const client of [pair.first, pair.second]) {
			const response = await post_json<{ success: boolean }>('/api/charity/wish/make', {
				item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
			}, client.session_token);
			expect(response.response.status).toBe(200);
		}
		const wishes = await db_all<{ id: number; owner_client_id: number }>(
			'SELECT `id`, `owner_client_id` FROM `charity_wishes` WHERE `guild_id` = ? ORDER BY `owner_client_id`',
			[pair.guild_id]
		);
		expect(wishes).toHaveLength(2);
		await db_run('UPDATE `charity_wishes` SET `created_at` = 0, `matures_at` = 0, `required_gp` = CASE WHEN `owner_client_id` = ? THEN 1 ELSE 10 END',
			[pair.first_id]);
		await db_run(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES(?, 'test:Rounded_Wish_Fuel', 5, 0, 0, 'melvorD:GP', 1)",
			[pair.guild_id]
		);
		const contents = await get_json_with_session<{ wishes: Array<{ progress_gp: number }> }>(
			'/api/charity/contents', pair.first.session_token
		);
		expect(contents.json.wishes.map(wish => wish.progress_gp).sort((a, b) => a - b)).toEqual([1, 4]);
		const legacy_client = await register_client('Wish Legacy Viewer', undefined, '1.5.6');
		await db_run('INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)',
			[legacy_client.client_id, pair.guild_id]);
		const legacy = await get_json_with_session<Record<string, unknown>>('/api/charity/contents', legacy_client.session_token);
		expect(legacy.json.wishes).toBeUndefined();
		expect(legacy.json.wish_catalog).toBeUndefined();
		expect(legacy.json.active_wish).toBeUndefined();
	});

	test('enforces the active Wish lock across an account group', async () => {
		const pair = await make_guildmates('Wish Account One', 'Wish Account Two', 'Wish Account Group', {
			first: '1.5.7', second: '1.5.7'
		});
		await attach_account(pair.first_id, 'Shared Wish Account');
		const [account] = await db_all<{ melvor_account_id: number }>(
			'SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?', [pair.first_id]
		);
		await db_run('UPDATE `clients` SET `melvor_account_id` = ? WHERE `id` = ?',
			[account?.melvor_account_id, pair.second_id]);
		expect((await post_json<{ success: boolean }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, pair.first.session_token)).json.success).toBe(true);
		const blocked = await post_json<{ success: boolean; error_lang: string }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, pair.second.session_token);
		expect(blocked.json).toEqual({ success: false, error_lang: 'MOD_MP_CHARITY_WISH_ACTIVE' });
	});

	test('dissolves a departing Ripening Wish into the remaining Wishes', async () => {
		const pair = await make_guildmates('Wish Keeper', 'Wish Leaver', 'Wish Departure', {
			first: '1.5.7', second: '1.5.7'
		});
		await attach_account(pair.first_id, 'Wish Keeper Account');
		await attach_account(pair.second_id, 'Wish Leaver Account');
		for (const client of [pair.first, pair.second])
			await post_json('/api/charity/wish/make', {
				item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
			}, client.session_token);
		await db_run('UPDATE `charity_wishes` SET `created_at` = 0, `matures_at` = 0, `required_gp` = 10, `progress_gp` = CASE WHEN `owner_client_id` = ? THEN 3 ELSE 0 END',
			[pair.second_id]);
		expect((await post('/api/guilds/leave', {}, pair.second.session_token)).status).toBe(200);
		const remaining = await db_all<{ owner_client_id: number; progress_gp: number }>(
			'SELECT `owner_client_id`, `progress_gp` FROM `charity_wishes` WHERE `guild_id` = ?', [pair.guild_id]
		);
		expect(remaining).toEqual([{ owner_client_id: pair.first_id, progress_gp: 3 }]);
	});
});
