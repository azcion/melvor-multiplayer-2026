import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import { has_pending_inbox } from '../inbox';

const { acknowledge_economy_receipt, db, db_execute, db_exists, display_name_cache, friend_request_cache, get_campaign_progress, get_client_gifts, get_client_resolved_trades, get_client_trades, get_friend_requests, get_guild_applicants, get_guild_chat_unread_count, get_guild_member_social_modes, get_market_completed, get_support_unread_count, get_trade_offer_meta, get_unread_chat_count, has_deletion_returns, has_guild_chat_capability, is_valid_avatar_icon_id, parse_display_name, pending_economy_receipts, session_get_route, session_post_route } = runtime;

export function register_general_routes(): void {
	session_get_route('/api/events', async (req, url, client_id): Promise<HandlerResult> => {
		const known_revision_value = url.searchParams.get('revision');
		const known_revision = known_revision_value === null ? null : Number(known_revision_value);
		if (known_revision !== null && (!Number.isSafeInteger(known_revision) || known_revision < 0))
			return 400;
		const client = db.query('SELECT `event_revision` FROM `clients` WHERE `id` = ? LIMIT 1')
			.get(client_id) as Pick<db_row.clients, 'event_revision'>;
		if (known_revision === client.event_revision)
			return { revision: client.event_revision, unchanged: true };
		const trade_ids = await get_client_trades(client_id);
		const trade_meta = [];

		for (const trade_id of trade_ids) {
			const meta = await get_trade_offer_meta(trade_id);
			if (!meta)
				continue;

			trade_meta.push({
				trade_id,
				attending: meta.attending_id === client_id,
				state: meta.state
			});
		}

		return {
			revision: client.event_revision,
			friend_requests: await get_friend_requests(client_id),
			guild_applicants: await get_guild_applicants(client_id),
			gifts: await get_client_gifts(client_id),
			trades: trade_meta,
			resolved_trades: await get_client_resolved_trades(client_id),
			guild_member_social_modes: get_guild_member_social_modes(client_id),
			economy_receipts: pending_economy_receipts(client_id),
			campaign: await get_campaign_progress(client_id),
			market_completed: await get_market_completed(client_id),
			haggle_pending: (db.query<{ count: number }, [number, number, number]>(
				'SELECT COUNT(*) AS `count` FROM `market_haggles` WHERE (`initiator_id` = ? OR `owner_id` = ?) ' +
				'AND (`status` = \'active\' OR EXISTS(SELECT 1 FROM `market_haggle_claims` AS claim ' +
				'WHERE claim.`haggle_id` = `market_haggles`.`id` AND claim.`client_id` = ? AND claim.`claimed_at` IS NULL))'
			).get(client_id, client_id, client_id)?.count ?? 0),
			banishment_return_pending: await db_exists(
				'SELECT 1 FROM `banishment_returns` WHERE `client_id` = ? AND `completed_at` IS NULL LIMIT 1',
				[client_id]
			) || has_deletion_returns(client_id),
			inbox_pending: has_pending_inbox(client_id),
			chat_unread: get_unread_chat_count(client_id) + get_support_unread_count(client_id) +
				(has_guild_chat_capability(url) ? get_guild_chat_unread_count(client_id) : 0)
		};
	});

	session_post_route('/api/economy/receipts/acknowledge', async (req, url, client_id, json) => {
		const acknowledged = acknowledge_economy_receipt(client_id, json.receipt_id);
		if (acknowledged === null)
			return 400;
		return acknowledged ? { success: true } : 404;
	});

	session_post_route('/api/client/set_icon', async (req, url, client_id, json) => {
		const icon_id = json.icon_id;
		if (!is_valid_avatar_icon_id(icon_id))
			return 400; // Bad Request

		await db_execute('UPDATE `clients` SET `icon_id` = ? WHERE `id` = ?', [icon_id, client_id]);

		return { success: true };
	});

	session_post_route('/api/client/set_display_name', async (req, url, client_id, json) => {
		const display_name = parse_display_name(json.display_name);
		if (display_name === null)
			return 400; // Bad Request

		await db_execute('UPDATE `clients` SET `display_name` = ? WHERE `id` = ?', [display_name, client_id]);
		display_name_cache.set(client_id, display_name);
		friend_request_cache.clear();

		return { success: true, display_name };
	});
}
