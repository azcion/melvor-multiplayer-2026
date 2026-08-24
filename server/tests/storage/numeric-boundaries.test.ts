import { describe, expect, test } from 'bun:test';
import { register_guild_client } from '../support/fixtures';
import { post_json } from '../support/http';
import { db_all } from '../support/persistence';
import { wait_for } from '../support/wait';

describe('database numeric boundaries', () => {
	test('rejects buy-order escrow products above the safe integer range', async () => {
		const buyer = await register_guild_client('Unsafe Buy Order Buyer');
		const response = await post_json<{ error_lang: string }>('/api/market/buy-order', {
			command_id: crypto.randomUUID(),
			item_id: `melvorD:Unsafe_Buy_Order_${crypto.randomUUID()}`,
			item_qty: Number.MAX_SAFE_INTEGER,
			item_buy_price: 2
		}, buyer.session_token);

		expect(response.json.error_lang).toBe('MOD_MP_MARKET_VALUE_TOO_LARGE');
	});

	test('preserves positive quantities above the signed 32-bit range', async () => {
		const seller = await register_guild_client('Large Quantity Seller');
		const item_id = `melvorD:Large_Quantity_${crypto.randomUUID()}`;
		const quantity = 2_147_483_648;
		const response = await post_json<{ success: boolean }>('/api/market/sell', {
			item_id,
			item_qty: quantity,
			item_sell_price: 1
		}, seller.session_token);
		const rows = await wait_for(
			() => db_all<{ qty: number; available: number }>(
				'SELECT `qty`, `available` FROM `market_items` WHERE `item_id` = ?',
				[item_id]
			),
			value => value.length === 1
		);

		expect(response.json.success).toBe(true);
		expect(rows).toEqual([{ qty: quantity, available: quantity }]);
	});
});
