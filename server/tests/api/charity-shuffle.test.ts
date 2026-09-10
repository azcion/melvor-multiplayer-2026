import { expect, test } from 'bun:test';
import { make_guild_group, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, post } from '../support/http';
import { db_all, db_run } from '../support/persistence';

type Contents = {
	shuffled_at: number | null;
	shuffle_count: number;
	currency_locks: Array<{ currency_id: string; locked_until: number }>;
	items: Array<{ id: string; qty: number; donated_at: number; expires_at: number }>;
};
const contents = async (token: string) => (await get_json_with_session<Contents>('/api/charity/contents', token)).json;

test('shuffle donates once, shares its timestamp and currency lock with siblings, and leaves others free to claim', async () => {
	const [bob, sibling, lucy] = await make_guild_group(['Shuffle Bob', 'Shuffle Bob2', 'Shuffle Lucy'], 'Shuffle Shared');
	const playfab_id = crypto.randomUUID();
	await db_run('INSERT INTO melvor_accounts (cloud_username, playfab_id, created_at) VALUES (?, ?, ?)', ['shuffle', playfab_id, Date.now()]);
	const [account] = await db_all<{ id: number }>('SELECT id FROM melvor_accounts WHERE playfab_id = ?', [playfab_id]);
	const other_guild = await register_guild_client('Shuffle Other Guild', 'Shuffle Other');
	await db_run('UPDATE clients SET melvor_account_id = ? WHERE id IN (?, ?, ?)', [account.id, bob.client_id, sibling.client_id, other_guild.client_id]);
	const before = Date.now() - 10000;
	for (const [id, qty] of [['melvorD:GP', 100], ['melvorD:SlayerCoins', 100], ['test:OldLeaves', 5]] as const)
		await db_run('INSERT INTO charity_items (guild_id, item_id, qty, expires_at, donated_at) VALUES (?, ?, ?, ?, ?)',
			[bob.guild_id, id, qty, before + 345600000, before]);
	const command_id = crypto.randomUUID();
	const payload = { command_id, currency_id: 'melvorD:GP', balance: 10000 };
	const result = await post_json<{ success: boolean; shuffled_at: number; receipt: { id: string; effects: unknown[] } }>('/api/v2/charity/shuffle', payload, bob.session_token);
	expect(result.json.success).toBe(true);
	expect(result.json.receipt.effects).toEqual([{ storage: 'gp', qty: -10 }]);
	const bob_state = await contents(bob.session_token);
	expect(bob_state.shuffled_at).toBeGreaterThan(before);
	expect(bob_state.shuffle_count).toBe(1);
	expect(bob_state.items.find(i => i.id === 'melvorD:GP')?.qty).toBe(110);
	expect(bob_state.currency_locks).toEqual([{ currency_id: 'melvorD:GP', locked_until: result.json.shuffled_at + 14400000 }]);
	expect((await contents(sibling.session_token)).shuffled_at).toBe(bob_state.shuffled_at);
	expect((await contents(sibling.session_token)).shuffle_count).toBe(1);
	expect((await contents(other_guild.session_token)).shuffled_at).toBeNull();
	expect((await contents(other_guild.session_token)).shuffle_count).toBe(1);
	expect((await contents(lucy.session_token)).shuffled_at).toBeNull();
	expect((await contents(lucy.session_token)).shuffle_count).toBe(0);
	const active_event_time = Date.now();
	for (let index = 0; index < 19; index++)
		await db_run('INSERT INTO charity_shuffle_events (owner_key, shuffled_at) VALUES (?, ?)', [`account:${account.id}`, active_event_time - index - 1]);
	await db_run('INSERT INTO charity_shuffle_events (owner_key, shuffled_at) VALUES (?, ?)',
		[`account:${account.id}`, active_event_time - 7 * 24 * 60 * 60 * 1000 - 1]);
	expect((await contents(other_guild.session_token)).shuffle_count).toBe(20);
	expect((await contents(lucy.session_token)).currency_locks).toEqual([]);
	const replay = await post_json('/api/v2/charity/shuffle', { command_id }, bob.session_token);
	expect(replay.json).toEqual(result.json);
	expect((await contents(bob.session_token)).items.find(i => i.id === 'melvorD:GP')?.qty).toBe(110);
	for (const client of [bob, sibling]) {
		const take = await post_json<{ error_lang: string }>('/api/charity/take', { item_id: 'melvorD:GP', qty: 1 }, client.session_token);
		expect(take.json.error_lang).toBe('MOD_MP_CHARITY_SHUFFLE_LOCK');
	}
	const other_currency = await post_json<{ success: boolean }>('/api/charity/take', { item_id: 'melvorD:SlayerCoins', qty: 1 }, sibling.session_token);
	expect(other_currency.json.success).toBe(true);
	const lucy_take = await post_json<{ success: boolean }>('/api/charity/take', { item_id: 'melvorD:GP', qty: 1 }, lucy.session_token);
	expect(lucy_take.json.success).toBe(true);
	const wrong_ack = await post('/api/economy/receipts/acknowledge', { receipt_id: command_id }, lucy.session_token);
	expect(wrong_ack.status).toBe(404);
	const pending = await get_json_with_session<{ economy_receipts: Array<{ id: string }> }>('/api/events', bob.session_token);
	expect(pending.json.economy_receipts.some(r => r.id === command_id)).toBe(true);
	await post_json('/api/economy/receipts/acknowledge', { receipt_id: command_id }, bob.session_token);
	const acknowledged = await post_json<{ receipt: null }>('/api/v2/charity/shuffle', { command_id }, bob.session_token);
	expect(acknowledged.json.receipt).toBeNull();
	await db_run('UPDATE charity_currency_locks SET locked_until = ? WHERE guild_id = ?', [Date.now() - 1, bob.guild_id]);
	const unlocked = await post_json<{ success: boolean }>('/api/charity/take', { item_id: 'melvorD:GP', qty: 1 }, bob.session_token);
	expect(unlocked.json.success).toBe(true);
	await db_run('UPDATE charity_items SET donated_at = ? WHERE guild_id = ?', [result.json.shuffled_at + 1, bob.guild_id]);
	expect((await contents(bob.session_token)).shuffled_at).toBeNull();
	expect((await contents(sibling.session_token)).shuffled_at).toBeNull();
});

test('shuffle validates prices, supports each currency and blocks unavailable trees', async () => {
	const client = await register_guild_client('Shuffle Bounds', 'Shuffle Bounds', '1.5.5');
	for (const balance of [0, 1000, -1, Number.MAX_SAFE_INTEGER + 1])
		expect((await post('/api/v2/charity/shuffle', { currency_id: 'melvorD:GP', balance, command_id: crypto.randomUUID() }, client.session_token)).status).toBe(400);
	expect((await post('/api/v2/charity/shuffle', { currency_id: 'test:Currency', balance: 10000, command_id: crypto.randomUUID() }, client.session_token)).status).toBe(400);
	expect((await post('/api/v2/charity/shuffle', { currency_id: 'melvorD:GP', balance: 10000 }, client.session_token)).status).toBe(400);
	for (const currency_id of ['melvorD:SlayerCoins', 'melvorItA:AbyssalPieces', 'melvorItA:AbyssalSlayerCoins']) {
		const result = await post_json<{ success: boolean; receipt: { effects: unknown[] } }>('/api/v2/charity/shuffle',
			{ currency_id, balance: 1999.5, command_id: crypto.randomUUID() }, client.session_token);
		expect(result.json.success).toBe(true);
		expect(result.json.receipt.effects).toEqual([{ storage: 'bank', item_id: currency_id, qty: -1 }]);
	}
	expect(await db_all<{ item_id: string; value_currency_id: string | null; value_per_item: number | null }>(
		'SELECT `item_id`, `value_currency_id`, `value_per_item` FROM `charity_items` WHERE `guild_id` = ? ORDER BY `item_id`',
		[client.guild_id]
	)).toEqual([
		{ item_id: 'melvorD:SlayerCoins', value_currency_id: 'melvorD:GP', value_per_item: 1 },
		{ item_id: 'melvorItA:AbyssalPieces', value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 },
		{ item_id: 'melvorItA:AbyssalSlayerCoins', value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 }
	]);
	expect((await contents(client.session_token)).currency_locks).toHaveLength(3);
	await db_run('UPDATE guilds SET charitree_enabled = 0 WHERE id = ?', [client.guild_id]);
	const disabled = await post_json<{ error_lang: string }>('/api/v2/charity/shuffle',
		{ currency_id: 'melvorD:GP', balance: 10000, command_id: crypto.randomUUID() }, client.session_token);
	expect(disabled.json.error_lang).toBe('MOD_MP_CHARITY_DISABLED');
});

test('caps Shuffle Leaves by the requested currency', async () => {
	const client = await register_guild_client('Shuffle Cap', 'Shuffle Cap Guild', '1.5.7');
	const gp = await post_json<{ receipt: { effects: unknown[] } }>('/api/v2/charity/shuffle', {
		currency_id: 'melvorD:GP', balance: 2_000_000_000_000, command_id: crypto.randomUUID()
	}, client.session_token);
	const slayer = await post_json<{ receipt: { effects: unknown[] } }>('/api/v2/charity/shuffle', {
		currency_id: 'melvorD:SlayerCoins', balance: 2_000_000_000, command_id: crypto.randomUUID()
	}, client.session_token);

	expect(gp.json.receipt.effects).toEqual([{ storage: 'gp', qty: -1_000_000_000 }]);
	expect(slayer.json.receipt.effects).toEqual([{ storage: 'bank', item_id: 'melvorD:SlayerCoins', qty: -1_000_000 }]);
});
