import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import { record_guild_activity } from '../guild-activity';
import { add_inbox_items } from '../inbox';
import { is_legacy_transfer_request } from '../transfer-compatibility';

const { CHARITY_ITEM_LIFETIME, CHARITY_TIMEOUT, db, db_get_all, db_get_single, economy_item_effects, expire_charity_items, get_client_guild_id, is_social_only_client, is_valid_item_id, parse_transfer_items, run_economy_command, session_get_route, session_post_route } = runtime;

export function register_charity_routes(): void {
	session_get_route('/api/charity/contents', async (req, url, client_id): Promise<HandlerResult> => {
		if (is_social_only_client(client_id))
			return { enabled: false, items: [] };
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		expire_charity_items(Date.now(), guild_id);
		const guild = await db_get_single('SELECT `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1', [guild_id]) as {
			charitree_enabled: number;
		} | null;
		if (guild?.charitree_enabled !== 1)
			return { enabled: false, items: [] };

		return {
			enabled: true,
			items: await db_get_all(
				'SELECT `item_id` as `id`, `qty`, `expires_at` FROM `charity_items` ' +
				'WHERE `guild_id` = ? ORDER BY `expires_at`, `item_id` LIMIT 156',
				[guild_id]
			)
		};
	});

	session_post_route('/api/charity/take', async (req, url, client_id, json) => {
		const membership = await db_get_single(
			'SELECT `guild_id`, `charitree_take_available_at` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1',
			[client_id]
		) as Pick<db_row.guild_memberships, 'guild_id' | 'charitree_take_available_at'> | null;
		if (membership === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		const guild_id = membership.guild_id;

		const item_id = json.item_id;
		if (!is_valid_item_id(item_id))
			return 400; // Bad Request
		const requested_qty = json.qty;
		if (requested_qty !== undefined && (typeof requested_qty !== 'number' ||
			!Number.isSafeInteger(requested_qty) || requested_qty <= 0))
			return 400; // Bad Request

		const current_time = Date.now();
		if (membership.charitree_take_available_at > current_time)
			return {
				error_lang: 'MOD_MP_CHARITY_JOIN_LOCK',
				available_at: membership.charitree_take_available_at
			};
		expire_charity_items(current_time, guild_id);
		const guild = await db_get_single('SELECT `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1', [guild_id]) as {
			charitree_enabled: number;
		} | null;
		if (guild?.charitree_enabled !== 1)
			return { error_lang: 'MOD_MP_CHARITY_DISABLED' };
		const client_row = await db_get_single('SELECT `last_charity`, `last_bonus_charity` FROM `clients` WHERE `id` = ?', [client_id]) as db_row.clients;
		if (client_row === null)
			return 400; // Bad Request

		const last_charity_cooling_down = client_row.last_charity + CHARITY_TIMEOUT > current_time;
		const last_charity_bonus_cooling_down = client_row.last_bonus_charity + CHARITY_TIMEOUT > current_time;

		if (last_charity_cooling_down && last_charity_bonus_cooling_down)
			return { error_lang: 'MOD_MP_CHARITY_TIMEOUT', timeout: client_row.last_charity, timeout_bonus: client_row.last_bonus_charity };

		const result = run_economy_command(client_id, json.command_id, 'charity-take', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const item_entry = db.query(
				'SELECT `qty` FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ? LIMIT 1'
			).get(guild_id, item_id) as Pick<db_row.charity_items, 'qty'> | null;
			if (item_entry === null || (requested_qty !== undefined && requested_qty > item_entry.qty))
				return { success: false, error_lang: 'MOD_MP_CHARITY_TAKEN' };

			const item_qty = requested_qty ?? item_entry.qty;
			const item_remaining_qty = item_entry.qty - item_qty;
			let item_expires_at = 0;
			if (item_remaining_qty === 0) {
				db.query('DELETE FROM `charity_items` WHERE `guild_id` = ? AND `item_id` = ?').run(guild_id, item_id);
			} else {
				const active_clearing = db.query(
					'SELECT MAX(`charitree_expires_before`) AS `cutoff` FROM `guild_petitions` ' +
					"WHERE `guild_id` = ? AND `type` = 'charitree_ingratitude' AND `subject_locked` = 1"
				).get(guild_id) as { cutoff: number | null };
				item_expires_at = Math.max(
					current_time + CHARITY_ITEM_LIFETIME,
					(active_clearing.cutoff ?? -1) + 1
				);
				db.query(
					'UPDATE `charity_items` SET `qty` = ?, `expires_at` = ? WHERE `guild_id` = ? AND `item_id` = ?'
				).run(item_remaining_qty, item_expires_at, guild_id, item_id);
			}

			if (last_charity_cooling_down) {
				db.query('UPDATE `clients` SET `last_bonus_charity` = ? WHERE `id` = ?').run(current_time, client_id);
				client_row.last_bonus_charity = current_time;
			} else {
				db.query('UPDATE `clients` SET `last_charity` = ? WHERE `id` = ?').run(current_time, client_id);
				client_row.last_charity = current_time;
			}

			const legacy = is_legacy_transfer_request(req);
			if (!legacy)
				add_inbox_items(client_id, [{ item_id, qty: item_qty }]);
			return {
				success: true,
				item_qty,
				item_remaining_qty,
				item_expires_at,
				timeout: client_row.last_charity,
				timeout_bonus: client_row.last_bonus_charity,
				effects: legacy ? economy_item_effects([{ id: item_id, qty: item_qty }], 'bank') : []
			};
		});
		return result ?? 400;
	});

	session_post_route('/api/charity/donate', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const items = parse_transfer_items(json.items);
		if (items === null)
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'charity-donate', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const now = Date.now();
			expire_charity_items(now, guild_id);
			const guild = db.query('SELECT `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1').get(
				guild_id
			) as { charitree_enabled: number } | null;
			if (guild?.charitree_enabled !== 1)
				return { success: false, error_lang: 'MOD_MP_CHARITY_DISABLED' };
			const active_clearing = db.query(
				'SELECT MAX(`charitree_expires_before`) AS `cutoff` FROM `guild_petitions` ' +
				"WHERE `guild_id` = ? AND `type` = 'charitree_ingratitude' AND `subject_locked` = 1"
			).get(guild_id) as { cutoff: number | null };
			const expires_at = Math.max(now + CHARITY_ITEM_LIFETIME, (active_clearing.cutoff ?? -1) + 1);
			for (const item of items)
				db.query(
					'INSERT INTO `charity_items` (`guild_id`, `item_id`, `qty`, `expires_at`) VALUES(?, ?, ?, ?) ' +
					'ON CONFLICT (`guild_id`, `item_id`) DO UPDATE SET ' +
					'`qty` = `qty` + excluded.`qty`, `expires_at` = excluded.`expires_at`'
				).run(guild_id, item.id, item.qty, expires_at);
			record_guild_activity({ guild_id, event_type: 'charitree_donated', actor_client_id: client_id,
				source_key: `charitree-donation:${json.command_id}`, created_at: now, throttled: true });
			return { success: true, effects: economy_item_effects(items, 'transfer', -1) };
		});
		return result ?? 400;
	});
}
