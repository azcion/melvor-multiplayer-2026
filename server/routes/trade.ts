import * as runtime from '../app-runtime';
import type { ActiveTrade } from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { create_resolved_trade, db, db_execute, economy_item_effects, get_trade_offer, guild_membership_exists, parse_transfer_items, remove_player_cache_entry, resolved_trade_cache, run_economy_command, session_post_route, trade_cache, trade_player_cache } = runtime;

export function register_trade_routes(): void {
	session_post_route('/api/trade/resolve', async (req, url, client_id, json) => {
		const trade_id = json.trade_id;
		if (typeof trade_id !== 'number')
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'trade-resolve', () => {
			const trade = db.query('SELECT * FROM `resolved_trade_offers` WHERE `trade_id` = ? LIMIT 1').get(
				trade_id
			) as db_row.resolved_trade_offers;
			if (!trade || trade.client_id !== client_id)
				return { success: false };
			const items = db.query(
				'SELECT `item_id`, `qty` FROM `trade_items` WHERE `trade_id` = ?'
			).all(trade_id) as Array<{ item_id: string; qty: number }>;
			db.query('DELETE FROM `resolved_trade_offers` WHERE `trade_id` = ?').run(trade_id);
			db.query('DELETE FROM `trade_items` WHERE `trade_id` = ?').run(trade_id);
			remove_player_cache_entry(resolved_trade_cache, client_id, trade_id);
			return { success: true, effects: economy_item_effects(items, 'bank') };
		});
		return result?.success === true ? result : 400;
	});

	session_post_route('/api/trade/counter', async (req, url, client_id, json) => {
		const trade_id = json.trade_id;
		if (typeof trade_id !== 'number')
			return 400; // Bad Request

		const items = parse_transfer_items(json.items);
		if (items === null)
			return 400; // Bad Request;
		const result = run_economy_command(client_id, json.command_id, 'trade-counter', () => {
			const trade = db.query('SELECT * FROM `trade_offers` WHERE `trade_id` = ? LIMIT 1').get(
				trade_id
			) as db_row.trade_offers;
			if (!trade || trade.recipient_id !== client_id)
				return { success: false };
			for (const item of items)
				db.query(
					'INSERT INTO `trade_items` (trade_id, item_id, qty, counter) VALUES(?, ?, ?, 1)'
				).run(trade_id, item.id, item.qty);
			db.query('UPDATE `trade_offers` SET `state` = 1, `attending_id` = ? WHERE `trade_id` = ?').run(
				trade.sender_id,
				trade_id
			);
			const cached_meta = trade_cache.get(trade_id);
			if (cached_meta) {
				cached_meta.attending_id = trade.sender_id;
				cached_meta.state = 1;
			}
			return { success: true, effects: economy_item_effects(items, 'transfer', -1) };
		});
		return result?.success === true ? result : 400;
	});

	session_post_route('/api/trade/accept', async (req, url, client_id, json) => {
		const trade_id = json.trade_id;
		if (typeof trade_id !== 'number')
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'trade-accept', () => {
			const trade = db.query('SELECT * FROM `trade_offers` WHERE `trade_id` = ? LIMIT 1').get(
				trade_id
			) as db_row.trade_offers;
			if (!trade || trade.state !== 1 || trade.sender_id !== client_id)
				return { success: false };
			const items = db.query(
				'SELECT `item_id`, `qty` FROM `trade_items` WHERE `trade_id` = ? AND `counter` = 1'
			).all(trade_id) as Array<{ item_id: string; qty: number }>;
			db.query('DELETE FROM `trade_items` WHERE `trade_id` = ? AND `counter` = 1').run(trade_id);
			db.query('DELETE FROM `trade_offers` WHERE `trade_id` = ?').run(trade_id);
			db.query(
				'INSERT INTO `resolved_trade_offers` (trade_id, client_id, sender_id, declined) VALUES(?, ?, ?, 0)'
			).run(trade_id, trade.recipient_id, trade.sender_id);
			trade_cache.delete(trade_id);
			remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);
			remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);
			resolved_trade_cache.get(trade.recipient_id)?.push(trade_id);
			return { success: true, effects: economy_item_effects(items, 'bank') };
		});
		return result?.success === true ? result : 400;
	});

	session_post_route('/api/trade/cancel', async (req, url, client_id, json) => {
		const trade_id = json.trade_id;
		if (typeof trade_id !== 'number')
			return 400; // Bad Request

		const trade = await get_trade_offer(trade_id);
		if (!trade)
			return 400; // Bad Request

		if (trade.state === 0 && trade.sender_id !== client_id)
			return 400; // Bad Request

		if (trade.state === 1 && trade.recipient_id !== client_id)
			return 400; // Bad Request

		if (trade.state === 1)
			await db_execute('DELETE FROM `trade_items` WHERE `trade_id` = ? AND `counter` = 1', [trade_id]);

		await create_resolved_trade(trade_id, trade.sender_id, trade.recipient_id, true);

		await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);

		trade_cache.delete(trade_id);

		remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);
		remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);

		return { success: true };
	});

	session_post_route('/api/trade/decline', async (req, url, client_id, json) => {
		const trade_id = json.trade_id;
		if (typeof trade_id !== 'number')
			return 400; // Bad Request

		const trade = await get_trade_offer(trade_id);
		if (!trade || trade.recipient_id !== client_id)
			return 400; // Bad Request

		await db_execute('DELETE FROM `trade_offers` WHERE `trade_id` = ?', [trade_id]);
		trade_cache.delete(trade_id);

		remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade_id);
		remove_player_cache_entry(trade_player_cache, trade.sender_id, trade_id);

		// return items to original sender
		await create_resolved_trade(trade_id, trade.sender_id, trade.recipient_id, true);

		return { success: true };
	});

	session_post_route('/api/trade/offer', async (req, url, client_id, json) => {
		const recipient_id = json.recipient_id;
		if (typeof recipient_id !== 'number')
			return 400; // Bad Request

		const items = parse_transfer_items(json.items);
		if (items === null)
			return 400; // Bad Request

		if (!(await guild_membership_exists(client_id, recipient_id)))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

		const result = run_economy_command(client_id, json.command_id, 'trade-offer', () => {
			const exists = db.query(
				'SELECT 1 FROM `trade_offers` WHERE `sender_id` = ? AND `recipient_id` = ? LIMIT 1'
			).get(client_id, recipient_id);
			if (exists !== null)
				return { success: false, error_lang: 'MOD_MP_TRADE_EXISTS' };
			const inserted = db.query(
				'INSERT INTO `trade_offers` (sender_id, recipient_id, attending_id) VALUES(?, ?, ?) RETURNING `trade_id`'
			).get(client_id, recipient_id, recipient_id) as { trade_id: number };
			for (const item of items)
				db.query(
					'INSERT INTO `trade_items` (trade_id, item_id, qty, counter) VALUES(?, ?, ?, 0)'
				).run(inserted.trade_id, item.id, item.qty);
			const trade_entry: ActiveTrade = { trade_id: inserted.trade_id, state: 0, attending_id: recipient_id };
			trade_cache.set(inserted.trade_id, trade_entry);
			trade_player_cache.get(client_id)?.push(inserted.trade_id);
			trade_player_cache.get(recipient_id)?.push(inserted.trade_id);
			return {
				success: true,
				trade_id: inserted.trade_id,
				effects: economy_item_effects(items, 'transfer', -1)
			};
		});
		return result ?? 400;
	});
}
