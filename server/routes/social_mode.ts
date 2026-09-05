import * as runtime from '../app-runtime';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject } from '../http';
import { add_inbox_gp, add_inbox_items } from '../inbox';
import { cancel_client_haggles } from './haggle';

const {
	GiftFlags,
	db,
	get_client_social_mode,
	gift_cache,
	market_completed_cached,
	remove_player_cache_entry,
	resolved_trade_cache,
	run_economy_command,
	session_post_route,
	trade_cache,
	trade_player_cache,
	is_valid_uuid
} = runtime;

type ModeChange = {
	success: true;
	social_mode: runtime.SocialMode;
	cancelled: {
		marketplace: number;
		gifts: number;
		trades: number;
		resolved_trades: number;
	};
	forfeited_raid_caches: number;
	effects: [];
};

function cancel_owned_exchanges(client_id: number): Omit<ModeChange, 'success' | 'social_mode' | 'effects'> {
	cancel_client_haggles(client_id);
	const haggle_claims = db.query<db_row.market_haggle_claims, [number]>(
		'SELECT * FROM `market_haggle_claims` WHERE `client_id` = ? AND `claimed_at` IS NULL'
	).all(client_id);
	for (const claim of haggle_claims) {
		if (claim.item_id !== null)
			add_inbox_items(client_id, [{ item_id: claim.item_id, qty: claim.item_qty }]);
		if (claim.gp > 0)
			add_inbox_gp(client_id, claim.gp);
		db.query('UPDATE `market_haggle_claims` SET `claimed_at` = ? WHERE `haggle_id` = ? AND `client_id` = ?')
			.run(Date.now(), claim.haggle_id, client_id);
	}
	const market_items = db.query('SELECT * FROM `market_items` WHERE `client_id` = ?').all(client_id) as db_row.market_items[];
	for (const lot of market_items) {
		if (lot.direction === 'buy') {
			add_inbox_gp(client_id, lot.escrow_gp);
		} else {
			add_inbox_items(client_id, [{ item_id: lot.item_id, qty: lot.available }]);
			add_inbox_gp(client_id, (lot.qty - lot.available - lot.reserved - lot.haggled) * lot.price - lot.payout);
		}
		remove_player_cache_entry(market_completed_cached, client_id, lot.id);
	}
	db.query('DELETE FROM `market_items` WHERE `client_id` = ?').run(client_id);

	const gifts = db.query(
		'SELECT * FROM `gifts` WHERE `client_id` = ? OR (`sender_id` = ? AND (`flags` & ?) = 0)'
	).all(client_id, client_id, GiftFlags.Returned) as db_row.gifts[];
	for (const gift of gifts) {
		const items = db.query('SELECT `item_id`, `qty` FROM `gift_items` WHERE `gift_id` = ?').all(gift.gift_id) as Array<{ item_id: string; qty: number }>;
		const recipient = gift.sender_id === client_id ||
			(gift.client_id === client_id && (gift.flags & GiftFlags.Returned) !== 0)
			? client_id : gift.sender_id;
		add_inbox_items(recipient, items);
		db.query('DELETE FROM `gift_items` WHERE `gift_id` = ?').run(gift.gift_id);
		db.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift.gift_id);
		remove_player_cache_entry(gift_cache, gift.client_id, gift.gift_id);
		remove_player_cache_entry(gift_cache, gift.sender_id, gift.gift_id);
	}

	const trades = db.query('SELECT * FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?').all(client_id, client_id) as db_row.trade_offers[];
	for (const trade of trades) {
		const items = db.query('SELECT `item_id`, `qty`, `counter` FROM `trade_items` WHERE `trade_id` = ?').all(trade.trade_id) as Array<{ item_id: string; qty: number; counter: number }>;
		add_inbox_items(trade.sender_id, items.filter(item => item.counter === 0));
		if (trade.state === 1)
			add_inbox_items(trade.recipient_id, items.filter(item => item.counter === 1));
		db.query('DELETE FROM `trade_items` WHERE `trade_id` = ?').run(trade.trade_id);
		db.query('DELETE FROM `trade_offers` WHERE `trade_id` = ?').run(trade.trade_id);
		trade_cache.delete(trade.trade_id);
		remove_player_cache_entry(trade_player_cache, trade.sender_id, trade.trade_id);
		remove_player_cache_entry(trade_player_cache, trade.recipient_id, trade.trade_id);
	}

	const resolved_trades = db.query('SELECT * FROM `resolved_trade_offers` WHERE `client_id` = ?').all(client_id) as db_row.resolved_trade_offers[];
	for (const trade of resolved_trades) {
		const items = db.query('SELECT `item_id`, `qty` FROM `trade_items` WHERE `trade_id` = ?').all(trade.trade_id) as Array<{ item_id: string; qty: number }>;
		add_inbox_items(client_id, items);
		db.query('DELETE FROM `trade_items` WHERE `trade_id` = ?').run(trade.trade_id);
		db.query('DELETE FROM `resolved_trade_offers` WHERE `trade_id` = ?').run(trade.trade_id);
		remove_player_cache_entry(resolved_trade_cache, client_id, trade.trade_id);
	}

	const forfeited_raid_caches = db.query<{ count: number }, [number]>(
		'SELECT COUNT(*) AS `count` FROM `guild_raid_victory_caches` WHERE `client_id` = ? AND `acknowledged_at` IS NULL'
	).get(client_id)?.count ?? 0;
	db.query(
		'DELETE FROM `guild_raid_victory_caches` WHERE `client_id` = ? AND `acknowledged_at` IS NULL'
	).run(client_id);

	return {
		cancelled: { marketplace: market_items.length, gifts: gifts.length, trades: trades.length, resolved_trades: resolved_trades.length },
		forfeited_raid_caches
	};
}

function change_mode(client_id: number, requested_mode: runtime.SocialMode, command_id: unknown, kind: string): JsonObject | null {
	return run_economy_command(client_id, command_id, kind, (): ModeChange => {
		const current_mode = get_client_social_mode(client_id);
		const cancelled = current_mode === 'full' && requested_mode === 'social'
			? cancel_owned_exchanges(client_id)
			: { cancelled: { marketplace: 0, gifts: 0, trades: 0, resolved_trades: 0 }, forfeited_raid_caches: 0 };
		db.query('UPDATE `clients` SET `social_mode` = ? WHERE `id` = ?').run(requested_mode, client_id);
		if (current_mode !== requested_mode) {
			db.query(
				'UPDATE `clients` SET `event_revision` = `event_revision` + 1 WHERE `id` IN (' +
				'SELECT member.`client_id` FROM `guild_memberships` AS own ' +
				'JOIN `guild_memberships` AS member ON member.`guild_id` = own.`guild_id` ' +
				'WHERE own.`client_id` = ?)'
			).run(client_id);
		}
		return { success: true, social_mode: requested_mode, ...cancelled, effects: [] };
	});
}

export function register_social_mode_routes(): void {
	session_post_route('/api/social-mode/set', async (_req, _url, client_id, json): Promise<HandlerResult> => {
		if (json.mode !== 'full' && json.mode !== 'social')
			return 400;
		if (typeof json.command_id !== 'string' || !is_valid_uuid(json.command_id))
			return 400;
		const result = change_mode(client_id, json.mode, json.command_id, 'social-mode-set');
		return result?.success === true ? result : 400;
	});

	// Retain the old route for already-installed development clients. It now also
	// persists Social Only mode, so cleanup can never succeed without the state change.
	session_post_route('/api/social-mode/cancel', async (_req, _url, client_id, json): Promise<HandlerResult> => {
		const result = change_mode(client_id, 'social', json.command_id, 'social-mode-cancel');
		return result?.success === true ? result : 400;
	});
}
