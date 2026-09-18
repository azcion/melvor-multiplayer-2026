import { afterEach, describe, expect, test } from 'bun:test';
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

afterEach(async () => {
	await db_run('DELETE FROM `charity_decay_activations`');
});

describe('Charitree Wishes', () => {
	test('gives every new Wish a 20-hour maturation timer', async () => {
		const active = await register_guild_client('Wish Owner', 'Wish Guild', '1.5.7');
		await attach_account(active.client_id, 'Wish Account');
		const made = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, active.session_token);
		expect(made.json.success).toBe(true);
		const wishes = await db_all<{ created_at: number; matures_at: number }>(
			'SELECT `created_at`, `matures_at` FROM `charity_wishes` WHERE `id` = ?', [made.json.wish_id]
		);
		expect(wishes[0]!.matures_at - wishes[0]!.created_at).toBe(20 * 60 * 60 * 1000);
	});

	test('presents accelerated item expiry only while a non-Ripe Wish keeps the Guild eligible', async () => {
		const client = await register_guild_client('Decay Promo Owner', 'Decay Promo Guild', '1.5.7');
		await attach_account(client.client_id, 'Decay Promo Account');
		const now = Date.now();
		const made = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, client.session_token);
		expect(made.json.success).toBe(true);
		const canonical_expires_at = now + 10 * 60 * 60 * 1000;
		await db_run(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES(?, 'test:Decay_Promo_Item', 1, ?, ?, 'melvorD:GP', 1)",
			[client.guild_id, canonical_expires_at, now]
		);

		const accelerated = await get_json_with_session<{ items: Array<{ id: string; expires_at: number }> }>(
			'/api/charity/contents', client.session_token
		);
		const effective = accelerated.json.items.find(item => item.id === 'test:Decay_Promo_Item')?.expires_at;
		expect(effective).toBeGreaterThanOrEqual(now + 2 * 60 * 60 * 1000);
		expect(effective).toBeLessThan(now + 2 * 60 * 60 * 1000 + 5000);
		expect((await db_all<{ expires_at: number }>(
			"SELECT `expires_at` FROM `charity_items` WHERE `item_id` = 'test:Decay_Promo_Item'"
		))[0]?.expires_at).toBe(canonical_expires_at);

		expect((await post_json<{ success: boolean }>('/api/charity/wish/forsake', {
			command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
		const restored = await get_json_with_session<{ items: Array<{ id: string; expires_at: number }> }>(
			'/api/charity/contents', client.session_token
		);
		expect(restored.json.items.find(item => item.id === 'test:Decay_Promo_Item')?.expires_at)
			.toBe(canonical_expires_at);
	});

	test('expires accelerated items into a Ripening Wish and ignores a Ripe Wish', async () => {
		const client = await register_guild_client('Decay Ripening Owner', 'Decay Ripening Guild', '1.5.7');
		await attach_account(client.client_id, 'Decay Ripening Account');
		const now = Date.now();
		const made = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
		}, client.session_token);
		await db_run('UPDATE `charity_wishes` SET `created_at` = 0, `matures_at` = 0 WHERE `id` = ?', [made.json.wish_id]);
		await db_run('UPDATE `charity_decay_activations` SET `activated_at` = ? WHERE `guild_id` = ?',
			[now - 3 * 60 * 60 * 1000, client.guild_id]);
		const canonical_expires_at = now + 10 * 60 * 60 * 1000;
		await db_run(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES(?, 'test:Accelerated_Fuel', 10, ?, ?, 'melvorD:GP', 1)",
			[client.guild_id, canonical_expires_at, now]
		);

		const ripening = await get_json_with_session<{
			items: Array<{ id: string }>;
			wishes: Array<{ progress_gp: number }>;
		}>('/api/charity/contents', client.session_token);
		expect(ripening.json.items.some(item => item.id === 'test:Accelerated_Fuel')).toBe(false);
		expect(ripening.json.wishes[0]?.progress_gp).toBe(10);

		await db_run('UPDATE `charity_wishes` SET `progress_gp` = `required_gp` WHERE `id` = ?', [made.json.wish_id]);
		await db_run(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES(?, 'test:Ripe_Ignored_Fuel', 1, ?, ?, 'melvorD:GP', 1)",
			[client.guild_id, canonical_expires_at, now]
		);
		const ripe = await get_json_with_session<{ items: Array<{ id: string; expires_at: number }> }>(
			'/api/charity/contents', client.session_token
		);
		expect(ripe.json.items.find(item => item.id === 'test:Ripe_Ignored_Fuel')?.expires_at)
			.toBe(canonical_expires_at);
		expect((await post_json<{ success: boolean }>('/api/charity/wish/pick', {
			command_id: crypto.randomUUID()
		}, client.session_token)).json.success).toBe(true);
	});

	test('prioritizes each stack\'s contributors before other Wishes and converts the final overflow to Gloop', async () => {
		const pair = await make_guildmates('Priority Wish Alice', 'Priority Wish Bob', 'Priority Wish Guild', {
			first: '1.5.7', second: '1.5.7'
		});
		const carol = await register_client('Priority Wish Carol', undefined, '1.5.7');
		await db_run('INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)', [carol.client_id, pair.guild_id]);
		await attach_account(pair.first_id, 'Priority Wish Alice Account');
		await attach_account(pair.second_id, 'Priority Wish Bob Account');
		await attach_account(carol.client_id, 'Priority Wish Carol Account');

		for (const client of [pair.first, pair.second, carol])
			expect((await post_json<{ success: boolean }>('/api/charity/wish/make', {
				item_id: 'melvorAoD:Torn_Parchment', qty: 1, command_id: crypto.randomUUID()
			}, client.session_token)).json.success).toBe(true);
		await db_run(
			'UPDATE `charity_wishes` SET `created_at` = 0, `matures_at` = 0, ' +
			'`required_gp` = CASE WHEN `owner_client_id` = ? THEN 10 WHEN `owner_client_id` = ? THEN 2 ELSE 100 END ' +
			'WHERE `guild_id` = ?',
			[pair.second_id, carol.client_id, pair.guild_id]
		);

		const alice_stack_id = 'exampleMod:Priority_Alice_Stack';
		const shared_stack_id = 'exampleMod:Priority_Shared_Stack';
		await post_json('/api/charity/donate', {
			items: [{ id: alice_stack_id, qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 5 }], donation_value: 0
		}, pair.first.session_token);
		await post_json('/api/charity/donate', {
			items: [{ id: shared_stack_id, qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 15 }], donation_value: 0
		}, pair.first.session_token);
		await post_json('/api/charity/donate', {
			items: [{ id: shared_stack_id, qty: 1, value_currency_id: 'melvorD:GP', value_per_item: 15 }], donation_value: 0
		}, pair.second.session_token);
		await db_run('UPDATE `charity_items` SET `expires_at` = 0 WHERE `guild_id` = ?', [pair.guild_id]);

		await get_json_with_session('/api/charity/contents', carol.session_token);
		const progress = await db_all<{ owner_client_id: number; progress_gp: number }>(
			'SELECT `owner_client_id`, `progress_gp` FROM `charity_wishes` WHERE `guild_id` = ? ORDER BY `owner_client_id`',
			[pair.guild_id]
		);
		expect(progress).toEqual([
			{ owner_client_id: pair.first_id, progress_gp: 20 },
			{ owner_client_id: pair.second_id, progress_gp: 10 },
			{ owner_client_id: carol.client_id, progress_gp: 2 }
		]);
		expect(await db_all<{ item_id: string; qty: number }>(
			"SELECT `item_id`, `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = 'melvorD:Weird_Gloop'",
			[pair.guild_id]
		)).toEqual([{ item_id: 'melvorD:Weird_Gloop', qty: 1 }]);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_items` WHERE `guild_id` = ?', [pair.guild_id])).toBe(1);
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
		expect((await db_all<{ ripe_at: number | null }>(
			' SELECT `ripe_at` FROM `charity_wishes` WHERE `id` = ?', [made.json.wish_id]
		))[0]?.ripe_at).toBeGreaterThanOrEqual(Date.now() - 5000);

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

	test('auto-claims a ripe Wish after 96 hours into the owner Inbox', async () => {
		const client = await register_guild_client('Auto Claim Wish Owner', 'Auto Claim Guild', '1.5.7');
		await attach_account(client.client_id, 'Auto Claim Wish Account');
		const made = await post_json<{ success: boolean; wish_id: number }>('/api/charity/wish/make', {
			item_id: 'melvorAoD:Torn_Parchment', qty: 2, command_id: crypto.randomUUID()
		}, client.session_token);
		const now = Date.now();
		await db_run(
			'UPDATE `charity_wishes` SET `progress_gp` = `required_gp`, `ripe_at` = ? WHERE `id` = ?',
			[now, made.json.wish_id]
		);

		await get_json_with_session('/api/charity/contents', client.session_token);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `charity_wishes` WHERE `id` = ?', [made.json.wish_id])).toBe(1);
		expect(await db_count(
			"SELECT COUNT(*) AS `count` FROM `inbox_items` WHERE `client_id` = ? AND `source_type` = 'wish_granted'",
			[client.client_id]
		)).toBe(0);

		await db_run('UPDATE `charity_wishes` SET `ripe_at` = ? WHERE `id` = ?', [now - 96 * 60 * 60 * 1000, made.json.wish_id]);
		const contents = await get_json_with_session<{ wishes: unknown[] }>('/api/charity/contents', client.session_token);
		expect(contents.json.wishes).toEqual([]);
		expect(await db_all<{ item_id: string; qty: number }>(
			"SELECT `item_id`, `qty` FROM `inbox_items` WHERE `client_id` = ? AND `source_type` = 'wish_granted'",
			[client.client_id]
		)).toEqual([{ item_id: 'melvorAoD:Torn_Parchment', qty: 2 }]);
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
		await db_run('UPDATE `charity_wishes` SET `created_at` = 0, `matures_at` = 0, `required_gp` = CASE WHEN `owner_client_id` = ? THEN 1 ELSE 10 END WHERE `guild_id` = ?',
			[pair.first_id, pair.guild_id]);
		await db_run(
			'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`, `donated_at`, `value_currency_id`, `value_per_item`) ' +
			"VALUES(?, 'test:Rounded_Wish_Fuel', 5, 0, 0, 'melvorD:GP', 1)",
			[pair.guild_id]
		);
		await db_run('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', ['melvorD:Wish_Owner', pair.first_id]);
		const contents = await get_json_with_session<{
			wishes: Array<{
				progress_gp: number;
				owned: boolean;
				contributors: Array<{ client_id: number; icon_id: string }>;
			}>;
		}>(
			'/api/charity/contents', pair.first.session_token
		);
		expect(contents.json.wishes.map(wish => wish.progress_gp).sort((a, b) => a - b)).toEqual([1, 4]);
		expect(contents.json.wishes.find(wish => wish.owned)?.contributors).toEqual([
			{ client_id: pair.first_id, icon_id: 'melvorD:Wish_Owner' }
		]);
		const current_client = await register_client('Wish Current Viewer', undefined, '1.5.9');
		await db_run('INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?)',
			[current_client.client_id, pair.guild_id]);
		const current = await get_json_with_session<Record<string, unknown>>('/api/charity/contents', current_client.session_token);
		expect(current.json.wishes).toBeDefined();
		expect(current.json.wish_catalog).toBeDefined();
		expect(current.json.active_wish).toBeDefined();
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
		await db_run('UPDATE `charity_wishes` SET `created_at` = 0, `matures_at` = 0, `required_gp` = 10, `progress_gp` = CASE WHEN `owner_client_id` = ? THEN 3 ELSE 0 END WHERE `guild_id` = ?',
			[pair.second_id, pair.guild_id]);
		expect((await post('/api/guilds/leave', {}, pair.second.session_token)).status).toBe(200);
		const remaining = await db_all<{ owner_client_id: number; progress_gp: number }>(
			'SELECT `owner_client_id`, `progress_gp` FROM `charity_wishes` WHERE `guild_id` = ?', [pair.guild_id]
		);
		expect(remaining).toEqual([{ owner_client_id: pair.first_id, progress_gp: 3 }]);
	});
});
