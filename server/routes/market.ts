import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonSerializable } from '../http';
import { record_guild_activity } from '../guild-activity';

const { MARKET_ITEMS_PER_PAGE, db, db_get_all, db_get_single, get_client_guild_id, is_valid_item_id, is_valid_uuid, market_completed_cached, parse_market_excluded_item_ids, parse_market_namespaces, remove_player_cache_entry, run_economy_command, session_get_route, session_post_route } = runtime;

type MarketDirection = 'sell' | 'buy';

function parse_market_direction(value: unknown): MarketDirection | null {
	if (value === undefined)
		return 'sell';
	return value === 'sell' || value === 'buy' ? value : null;
}

function safe_market_total(quantity: number, price: number): number | null {
	const total = quantity * price;
	return Number.isSafeInteger(total) ? total : null;
}

function safe_market_sum(left: number, right: number): number | null {
	const total = left + right;
	return Number.isSafeInteger(total) ? total : null;
}

function create_market_buyer_receipt(client_id: number, item_id: string, item_qty: number): void {
	const id = crypto.randomUUID();
	const receipt = {
		id,
		kind: 'market-fulfill',
		effects: [{ storage: 'bank' as const, item_id, qty: item_qty }]
	};
	db.query(
		'INSERT INTO `economy_receipts` (`id`, `client_id`, `kind`, `response_json`, `created_at`) VALUES(?, ?, ?, ?, ?)'
	).run(id, client_id, receipt.kind, JSON.stringify({ success: true, receipt }), Date.now());
	db.query('UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` = ?').run(client_id);
}

export function register_market_routes(): void {
	session_post_route('/api/market/sell', async (req, url, client_id, json) => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const item_qty = json.item_qty;
		const item_sell_price = json.item_sell_price;
		if (typeof item_qty !== 'number' || typeof item_sell_price !== 'number' ||
			!Number.isSafeInteger(item_qty) || !Number.isSafeInteger(item_sell_price))
			return 400; // Bad Request
		if (item_qty <= 0)
			return { error_lang: 'MOD_MP_MARKET_CANNOT_SELL_NOTHING' };
		if (item_sell_price <= 0)
			return { error_lang: 'MOD_MP_MARKET_CANNOT_SELL_FREE' };

		const item_id = json.item_id;
		if (!is_valid_item_id(item_id))
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'market-sell', () => {
			const published_at = Date.now();
			const existing = db.query(
				' SELECT `id` FROM `market_items` WHERE `guild_id` = ? AND `client_id` = ? AND `direction` = \'sell\' AND `item_id` = ? AND `price` = ?'
			).get(guild_id, client_id, item_id, item_sell_price);
			const lot = db.query<{ id: number }, [number, number, string, number, number, number, number]>(
				'INSERT INTO `market_items` (`guild_id`, `client_id`, `direction`, `item_id`, `qty`, `price`, `available`, `published_at`) ' +
				'VALUES(?, ?, \'sell\', ?, ?, ?, ?, ?) ON CONFLICT (`guild_id`, `client_id`, `direction`, `item_id`, `price`) DO UPDATE SET ' +
				'`qty` = `qty` + excluded.`qty`, `available` = `available` + excluded.`available` RETURNING `id`'
			).get(guild_id, client_id, item_id, item_qty, item_sell_price, item_qty, published_at) as { id: number };
			remove_player_cache_entry(market_completed_cached, client_id, lot.id);
			if (existing === null)
				record_guild_activity({ guild_id, event_type: 'market_listing_created', actor_client_id: client_id,
					source_key: `market-listing:${lot.id}`, throttled: true, metadata: { direction: 'sell' } });
			return { success: true, effects: [{ storage: 'bank' as const, item_id, qty: -item_qty }] };
		});
		return result ?? 400;
	});

	session_post_route('/api/market/buy-order', async (req, url, client_id, json) => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (typeof json.command_id !== 'string' || !is_valid_uuid(json.command_id))
			return 400;

		const item_qty = json.item_qty;
		const item_buy_price = json.item_buy_price;
		if (typeof item_qty !== 'number' || typeof item_buy_price !== 'number' ||
			!Number.isSafeInteger(item_qty) || !Number.isSafeInteger(item_buy_price))
			return 400; // Bad Request
		if (item_qty <= 0)
			return { error_lang: 'MOD_MP_MARKET_CANNOT_BUY_NOTHING' };
		if (item_buy_price <= 0)
			return { error_lang: 'MOD_MP_MARKET_CANNOT_BUY_FREE' };

		const escrow_gp = safe_market_total(item_qty, item_buy_price);
		if (escrow_gp === null)
			return { error_lang: 'MOD_MP_MARKET_VALUE_TOO_LARGE' };

		const item_id = json.item_id;
		if (!is_valid_item_id(item_id))
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'market-buy-order', () => {
			const published_at = Date.now();
			const existing = db.query<Pick<db_row.market_items, 'id' | 'qty' | 'escrow_gp'>, [number, number, string, number]>(
				' SELECT `id`, `qty`, `escrow_gp` FROM `market_items` WHERE `guild_id` = ? AND `client_id` = ? AND `direction` = \'buy\' AND `item_id` = ? AND `price` = ?'
			).get(guild_id, client_id, item_id, item_buy_price);
			if (existing !== null &&
				(safe_market_sum(existing.qty, item_qty) === null || safe_market_sum(existing.escrow_gp, escrow_gp) === null))
				return { error_lang: 'MOD_MP_MARKET_VALUE_TOO_LARGE' };

			const lot = db.query<{ id: number }, [number, number, string, number, number, number, number, number]>(
				'INSERT INTO `market_items` (`guild_id`, `client_id`, `direction`, `item_id`, `qty`, `price`, `available`, `escrow_gp`, `published_at`) ' +
				'VALUES(?, ?, \'buy\', ?, ?, ?, ?, ?, ?) ON CONFLICT (`guild_id`, `client_id`, `direction`, `item_id`, `price`) DO UPDATE SET ' +
				'`qty` = `qty` + excluded.`qty`, `available` = `available` + excluded.`available`, ' +
				'`escrow_gp` = `escrow_gp` + excluded.`escrow_gp` RETURNING `id`'
			).get(guild_id, client_id, item_id, item_qty, item_buy_price, item_qty, escrow_gp, published_at) as { id: number };
			if (existing === null)
				record_guild_activity({ guild_id, event_type: 'market_listing_created', actor_client_id: client_id,
					source_key: `market-listing:${lot.id}`, throttled: true, metadata: { direction: 'buy' } });
			return { success: true, effects: [{ storage: 'gp' as const, qty: -escrow_gp }] };
		});
		return result ?? 400;
	});

	session_post_route('/api/market/buy', async (req, url, client_id, json) => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const lot_id = json.id;
		if (typeof lot_id !== 'number')
			return 400; // Bad Request

		const buy_qty = json.qty;
		if (typeof buy_qty !== 'number' || !Number.isSafeInteger(buy_qty) || buy_qty <= 0)
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'market-buy', () => {
			const lot = db.query('SELECT * FROM `market_items` WHERE `id` = ? AND `guild_id` = ? AND `direction` = \'sell\' LIMIT 1')
				.get(lot_id, guild_id) as db_row.market_items | null;
			if (lot === null || lot.available <= 0)
				return { error_lang: 'MOD_MP_MARKET_BUY_ERROR_INVALID' };
			if (lot.client_id === client_id)
				return { error_lang: 'MOD_MP_MARKET_BUY_ERROR_SELF' };
			const final_qty = Math.min(lot.available, buy_qty);
			const final_cost = safe_market_total(final_qty, lot.price);
			if (final_cost === null)
				return { error_lang: 'MOD_MP_MARKET_VALUE_TOO_LARGE' };
			const updated = db.query(
				'UPDATE `market_items` SET `available` = `available` - ? WHERE `id` = ? AND `direction` = \'sell\' AND `available` = ?'
			).run(final_qty, lot_id, lot.available);
			if (updated.changes === 0)
				return { error_lang: 'MOD_MP_MARKET_BUY_ERROR_INVALID' };
			const new_item_qty = Math.max(lot.available - final_qty, 0);
			if (new_item_qty === 0)
				market_completed_cached.get(lot.client_id)?.push(lot.id);
			record_guild_activity({ guild_id, event_type: 'market_purchased', actor_client_id: client_id,
				buyer_client_id: client_id, seller_client_id: lot.client_id, item_id: lot.item_id,
				quantity: final_qty, source_key: `market-purchase:${json.command_id ?? crypto.randomUUID()}` });
			return { success: true, item_id: lot.item_id, item_qty: final_qty, gp_loss: final_cost,
				new_item_qty, effects: [
					{ storage: 'bank' as const, item_id: lot.item_id, qty: final_qty },
					{ storage: 'gp' as const, qty: -final_cost }
				] };
		});
		return result ?? 400;
	});

	session_post_route('/api/market/fulfill', async (req, url, client_id, json) => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (typeof json.command_id !== 'string' || !is_valid_uuid(json.command_id))
			return 400;

		const lot_id = json.id;
		const sell_qty = json.qty;
		if (typeof lot_id !== 'number' || typeof sell_qty !== 'number' ||
			!Number.isSafeInteger(sell_qty) || sell_qty <= 0)
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'market-fulfill', () => {
			const lot = db.query('SELECT * FROM `market_items` WHERE `id` = ? AND `guild_id` = ? AND `direction` = \'buy\' LIMIT 1')
				.get(lot_id, guild_id) as db_row.market_items | null;
			if (lot === null || lot.available <= 0 || lot.client_id === client_id)
				return { error_lang: 'MOD_MP_MARKET_FULFILL_ERROR_INVALID' };
			const final_qty = Math.min(lot.available, sell_qty);
			const final_cost = safe_market_total(final_qty, lot.price);
			if (final_cost === null || final_cost > lot.escrow_gp)
				return { error_lang: 'MOD_MP_MARKET_FULFILL_ERROR_INVALID' };
			const new_item_qty = Math.max(lot.available - final_qty, 0);
			const updated = new_item_qty === 0
				? db.query(
					'DELETE FROM `market_items` WHERE `id` = ? AND `direction` = \'buy\' AND `available` = ? AND `escrow_gp` = ?'
				).run(lot_id, lot.available, lot.escrow_gp)
				: db.query(
					'UPDATE `market_items` SET `available` = `available` - ?, `escrow_gp` = `escrow_gp` - ? ' +
					'WHERE `id` = ? AND `direction` = \'buy\' AND `available` = ? AND `escrow_gp` = ?'
				).run(final_qty, final_cost, lot_id, lot.available, lot.escrow_gp);
			if (updated.changes === 0)
				return { error_lang: 'MOD_MP_MARKET_FULFILL_ERROR_INVALID' };

			create_market_buyer_receipt(lot.client_id, lot.item_id, final_qty);
			record_guild_activity({ guild_id, event_type: 'market_fulfilled', actor_client_id: client_id,
				buyer_client_id: lot.client_id, seller_client_id: client_id, item_id: lot.item_id,
				quantity: final_qty, source_key: `market-fulfillment:${json.command_id}` });
			return { success: true, item_id: lot.item_id, item_qty: final_qty, gp_gain: final_cost,
				new_item_qty, effects: [
					{ storage: 'bank' as const, item_id: lot.item_id, qty: -final_qty },
					{ storage: 'gp' as const, qty: final_cost }
				] };
		});
		return result ?? 400;
	});

	session_get_route('/api/market/listings', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const results = await db_get_all(
			'SELECT * FROM `market_items` WHERE `guild_id` = ? AND `client_id` = ?',
			[guild_id, client_id]
		);
		const items = Array<JsonSerializable>(results.length);

		for (let i = 0; i < results.length; i++) {
			const row = results[i] as db_row.market_items;
			items[i] = row.direction === 'buy'
				? { id: row.id, direction: row.direction, item_id: row.item_id, available: row.available,
					qty: row.qty, price: row.price, escrow_gp: row.escrow_gp }
				: { id: row.id, item_id: row.item_id, available: row.available, qty: row.qty,
					price: row.price, payout: row.payout };
		}

		return { success: true, items };
	});

	session_post_route('/api/market/payout', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const lot_id = json.id;
		if (typeof lot_id !== 'number')
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'market-payout', () => {
			const lot = db.query('SELECT * FROM `market_items` WHERE `id` = ? AND `guild_id` = ? AND `direction` = \'sell\' LIMIT 1')
				.get(lot_id, guild_id) as db_row.market_items | null;
			if (lot?.client_id !== client_id)
				return { success: false };
			const payout_available = (lot.qty - lot.available) * lot.price - lot.payout;
			const ended = lot.available === 0;
			if (ended) {
				db.query('DELETE FROM `market_items` WHERE `id` = ?').run(lot.id);
				remove_player_cache_entry(market_completed_cached, client_id, lot.id);
			} else {
				db.query('UPDATE `market_items` SET `payout` = `payout` + ? WHERE `id` = ?')
					.run(payout_available, lot.id);
			}
			return { success: true, payout: payout_available, ended,
				effects: payout_available > 0 ? [{ storage: 'gp' as const, qty: payout_available }] : [] };
		});
		return result?.success === false ? 400 : result ?? 400;
	});

	session_post_route('/api/market/cancel', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const lot_id = json.id;
		if (typeof lot_id !== 'number')
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'market-cancel', () => {
			const lot = db.query(
				'DELETE FROM `market_items` WHERE `id` = ? AND `guild_id` = ? AND `client_id` = ? RETURNING *'
			).get(lot_id, guild_id, client_id) as db_row.market_items | null;
			if (lot === null)
				return { success: false };
			remove_player_cache_entry(market_completed_cached, client_id, lot.id);
			if (lot.direction === 'buy')
				return { success: true, direction: lot.direction, item_id: lot.item_id, item_qty: lot.available,
					payout: 0, gp_refund: lot.escrow_gp,
					effects: lot.escrow_gp > 0 ? [{ storage: 'gp' as const, qty: lot.escrow_gp }] : [] };
			const payout = (lot.qty - lot.available) * lot.price - lot.payout;
			return { success: true, item_id: lot.item_id, item_qty: lot.available, payout, effects: [
				...(lot.available > 0 ? [{ storage: 'bank' as const, item_id: lot.item_id, qty: lot.available }] : []),
				...(payout > 0 ? [{ storage: 'gp' as const, qty: payout }] : [])
			] };
		});
		return result?.success === false ? 400 : result ?? 400;
	});

	session_post_route('/api/market/destroy', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const lot_id = json.id;
		if (typeof lot_id !== 'number')
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'market-destroy', () => {
			const lot = db.query(
				'DELETE FROM `market_items` WHERE `id` = ? AND `guild_id` = ? AND `client_id` = ? AND `direction` = \'sell\' RETURNING *'
			).get(lot_id, guild_id, client_id) as db_row.market_items | null;
			if (lot === null)
				return { success: false };
			const payout = (lot.qty - lot.available) * lot.price - lot.payout;
			remove_player_cache_entry(market_completed_cached, client_id, lot.id);
			return { success: true, item_id: lot.item_id, item_qty: lot.available, payout, effects: [
				...(lot.available > 0 ? [{ storage: 'transfer' as const, item_id: lot.item_id, qty: lot.available,
					destroyable: true }] : []),
				...(payout > 0 ? [{ storage: 'gp' as const, qty: payout }] : [])
			] };
		});
		return result?.success === false ? 400 : result ?? 400;
	});

	session_post_route('/api/market/catalog', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		const direction = parse_market_direction(json.direction);
		if (direction === null)
			return 400; // Bad Request
		const namespace_parameters = parse_market_namespaces(json.item_namespaces);
		if (namespace_parameters === null)
			return 400; // Bad Request
		if (namespace_parameters.length === 0)
			return { success: true, item_ids: [] };

		const item_ids = await db_get_all(
			'SELECT DISTINCT `item_id` FROM `market_items` WHERE `guild_id` = ? AND `client_id` != ? AND `direction` = ? ' +
			'AND `available` > 0 AND (' + namespace_parameters.map(() => '`item_id` LIKE ? ESCAPE \'\\\'').join(' OR ') +
			') ORDER BY `item_id`',
			[guild_id, client_id, direction, ...namespace_parameters]
		);
		return { success: true, item_ids: item_ids.map(row => row.item_id) };
	});

	session_post_route('/api/market/search', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const direction = parse_market_direction(json.direction);
		if (direction === null)
			return 400; // Bad Request
		const query_parameters: SQLQueryBindings[] = [guild_id, client_id, direction];

		let item_filter = '';
		if (json.item_id !== undefined && !is_valid_item_id(json.item_id))
			return 400; // Bad Request
		if (typeof json.item_id === 'string') {
			item_filter = ' AND m.`item_id` = ?';
			query_parameters.push(json.item_id);
		}
		let has_namespace_filter = false;
		if (json.item_namespaces !== undefined) {
			const namespace_parameters = parse_market_namespaces(json.item_namespaces);
			if (namespace_parameters === null)
				return 400; // Bad Request

			if (namespace_parameters.length === 0)
				item_filter += ' AND 0';
			else {
				has_namespace_filter = true;
				item_filter += ' AND (' + namespace_parameters.map(() => 'm.`item_id` LIKE ? ESCAPE \'\\\'').join(' OR ') + ')';
				query_parameters.push(...namespace_parameters);
			}
		}
		let has_exact_item_filter = false;
		if (json.unresolved_item_ids !== undefined) {
			const unresolved_item_ids = parse_market_excluded_item_ids(json.unresolved_item_ids);
			if (unresolved_item_ids === null || json.item_namespaces === undefined)
				return 400; // Bad Request
			has_exact_item_filter = true;
			if (unresolved_item_ids.length > 0) {
				item_filter += ' AND m.`item_id` NOT IN (SELECT `value` FROM json_each(?))';
				query_parameters.push(JSON.stringify(unresolved_item_ids));
			}
		}

		const recent = json.sort === 'recent';
		const price_sort = typeof json.sort === 'number'
			? (json.sort === 0 ? 'DESC' : 'ASC')
			: (direction === 'sell' ? 'ASC' : 'DESC');
		const where = ' FROM `market_items` AS m JOIN `clients` AS owner ON owner.`id` = m.`client_id` ' +
			'WHERE m.`guild_id` = ? AND m.`client_id` != ? AND m.`direction` = ? ' +
			'AND m.`available` > 0' + item_filter;
		const paginate = !has_namespace_filter || has_exact_item_filter;
		const requested_page = typeof json.page === 'number' && Number.isSafeInteger(json.page)
			? Math.max(json.page, 1)
			: 1;
		const count = await db_get_single('SELECT COUNT(*) AS `count`' + where, query_parameters);
		const total_items = count?.count ?? 0;
		const page_count = Math.max(Math.ceil(total_items / MARKET_ITEMS_PER_PAGE), 1);
		const page = Math.min(requested_page, page_count);
		const page_clause = paginate
			? ' LIMIT ' + MARKET_ITEMS_PER_PAGE + ' OFFSET ' + ((page - 1) * MARKET_ITEMS_PER_PAGE)
			: '';
		const result = await db_get_all(
			'SELECT m.`id`, m.`item_id`, m.`available`, m.`price`, owner.`display_name`, owner.`icon_id`' +
			where + ' ORDER BY ' + (recent
				? 'm.`published_at` DESC, m.`id` DESC'
				: 'm.`price` ' + price_sort + ', m.`id` ' + price_sort) + page_clause,
			query_parameters
		);
		const items: JsonSerializable[] = result.map(row => direction === 'buy'
			? ({
				id: row.id,
				item_id: row.item_id,
				available: row.available,
				price: row.price,
				direction,
				buyer: { display_name: row.display_name, icon_id: row.icon_id }
			} as JsonSerializable)
			: ({
				id: row.id,
				item_id: row.item_id,
				available: row.available,
				price: row.price,
				direction,
				seller: { display_name: row.display_name, icon_id: row.icon_id }
			} as JsonSerializable));

		return { success: true, total_items, page, items };
	});
}
