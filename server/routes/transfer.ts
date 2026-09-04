import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { db_get_all, is_social_only_client, parse_number_array, query_placeholders, session_post_route } = runtime;

export function register_transfer_routes(): void {
	session_post_route('/api/transfers/get_contents', async (req, url, client_id, json) => {
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
		const gift_ids = parse_number_array(json.gift_ids);
		const trade_ids = parse_number_array(json.trade_ids);
		const resolved_trade_ids = parse_number_array(json.resolved_trade_ids);
		if (gift_ids === null || trade_ids === null || resolved_trade_ids === null)
			return 400; // Bad Request

		type GiftContentRow = { gift_id: number; flags: number; display_name: string; icon_id: string };
		type TradeContentRow = { trade_id: number; display_name: string; icon_id: string };
		type ResolvedTradeContentRow = TradeContentRow & { declined: number };
		type GiftItemRow = { gift_id: number; id: number; item_id: string; qty: number };
		type TradeItemRow = { trade_id: number; id: number; item_id: string; qty: number; counter: number };

		const [gifts, gift_items, trades, trade_items, resolved_trades, resolved_trade_items] = await Promise.all([
			gift_ids.length === 0 ? [] : db_get_all(
				'SELECT gift.`gift_id`, gift.`flags`, sender.`display_name`, sender.`icon_id` ' +
				'FROM `gifts` AS gift JOIN `clients` AS sender ON sender.`id` = gift.`sender_id` ' +
				`WHERE gift.\`client_id\` = ? AND gift.\`gift_id\` IN (${query_placeholders(gift_ids)})`,
				[client_id, ...gift_ids]
			) as Promise<GiftContentRow[]>,
			gift_ids.length === 0 ? [] : db_get_all(
				'SELECT item.`gift_id`, item.`id`, item.`item_id`, item.`qty` FROM `gift_items` AS item ' +
				'JOIN `gifts` AS gift ON gift.`gift_id` = item.`gift_id` ' +
				`WHERE gift.\`client_id\` = ? AND gift.\`gift_id\` IN (${query_placeholders(gift_ids)}) ORDER BY item.\`id\``,
				[client_id, ...gift_ids]
			) as Promise<GiftItemRow[]>,
			trade_ids.length === 0 ? [] : db_get_all(
				'SELECT trade.`trade_id`, other.`display_name`, other.`icon_id` FROM `trade_offers` AS trade ' +
				'JOIN `clients` AS other ON other.`id` = CASE WHEN trade.`sender_id` = ? ' +
				'THEN trade.`recipient_id` ELSE trade.`sender_id` END ' +
				`WHERE (trade.\`sender_id\` = ? OR trade.\`recipient_id\` = ?) ` +
				`AND trade.\`trade_id\` IN (${query_placeholders(trade_ids)})`,
				[client_id, client_id, client_id, ...trade_ids]
			) as Promise<TradeContentRow[]>,
			trade_ids.length === 0 ? [] : db_get_all(
				'SELECT item.`trade_id`, item.`id`, item.`item_id`, item.`qty`, item.`counter` FROM `trade_items` AS item ' +
				'JOIN `trade_offers` AS trade ON trade.`trade_id` = item.`trade_id` ' +
				`WHERE (trade.\`sender_id\` = ? OR trade.\`recipient_id\` = ?) ` +
				`AND trade.\`trade_id\` IN (${query_placeholders(trade_ids)}) ORDER BY item.\`id\``,
				[client_id, client_id, ...trade_ids]
			) as Promise<TradeItemRow[]>,
			resolved_trade_ids.length === 0 ? [] : db_get_all(
				'SELECT trade.`trade_id`, trade.`declined`, other.`display_name`, other.`icon_id` ' +
				'FROM `resolved_trade_offers` AS trade JOIN `clients` AS other ON other.`id` = trade.`sender_id` ' +
				`WHERE trade.\`client_id\` = ? AND trade.\`trade_id\` IN (${query_placeholders(resolved_trade_ids)})`,
				[client_id, ...resolved_trade_ids]
			) as Promise<ResolvedTradeContentRow[]>,
			resolved_trade_ids.length === 0 ? [] : db_get_all(
				'SELECT item.`trade_id`, item.`id`, item.`item_id`, item.`qty`, item.`counter` FROM `trade_items` AS item ' +
				'JOIN `resolved_trade_offers` AS trade ON trade.`trade_id` = item.`trade_id` ' +
				`WHERE trade.\`client_id\` = ? AND trade.\`trade_id\` IN (${query_placeholders(resolved_trade_ids)}) ` +
				'ORDER BY item.`id`',
				[client_id, ...resolved_trade_ids]
			) as Promise<TradeItemRow[]>
		]);

		const gift_items_by_id = Map.groupBy(gift_items, item => item.gift_id);
		const trade_items_by_id = Map.groupBy(trade_items, item => item.trade_id);
		const resolved_trade_items_by_id = Map.groupBy(resolved_trade_items, item => item.trade_id);
		const gift_results = Object.fromEntries(gifts.map(gift => [gift.gift_id, {
			items: (gift_items_by_id.get(gift.gift_id) ?? []).map(item => ({
				id: item.id, item_id: item.item_id, qty: item.qty
			})),
			sender: { display_name: gift.display_name, icon_id: gift.icon_id },
			flags: gift.flags
		}]));
		const trade_results = Object.fromEntries(trades.map(trade => [trade.trade_id, {
			items: (trade_items_by_id.get(trade.trade_id) ?? []).map(item => ({
				id: item.id, item_id: item.item_id, qty: item.qty, counter: item.counter
			})),
			other_player: { display_name: trade.display_name, icon_id: trade.icon_id }
		}]));
		const resolved_trade_results = Object.fromEntries(resolved_trades.map(trade => [trade.trade_id, {
			items: (resolved_trade_items_by_id.get(trade.trade_id) ?? []).map(item => ({
				id: item.id, item_id: item.item_id, qty: item.qty, counter: item.counter
			})),
			declined: trade.declined === 1,
			other_player: { display_name: trade.display_name, icon_id: trade.icon_id }
		}]));

		return {
			gifts: gift_results,
			trades: trade_results,
			resolved_trades: resolved_trade_results
		} as JsonSerializable;
	});
}
