import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { GiftFlags, db, economy_item_effects, get_gift, gift_cache, guild_membership_exists, parse_transfer_items, remove_player_cache_entry, return_gift, run_economy_command, session_post_route } = runtime;

export function register_gifting_routes(): void {
	session_post_route('/api/gift/accept', async (req, url, client_id, json) => {
		const gift_id = json.gift_id;
		if (typeof gift_id !== 'number')
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'gift-accept', () => {
			const gift = db.query('SELECT * FROM `gifts` WHERE `gift_id` = ? LIMIT 1').get(gift_id) as db_row.gifts;
			if (gift?.client_id !== client_id)
				return { success: false };
			const items = db.query(
				'SELECT `item_id`, `qty` FROM `gift_items` WHERE `gift_id` = ?'
			).all(gift_id) as Array<{ item_id: string; qty: number }>;
			db.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift_id);
			db.query('DELETE FROM `gift_items` WHERE `gift_id` = ?').run(gift_id);
			remove_player_cache_entry(gift_cache, client_id, gift_id);
			return { success: true, effects: economy_item_effects(items, 'bank') };
		});
		return result?.success === true ? result : 400;
	});

	session_post_route('/api/gift/decline', async (req, url, client_id, json) => {
		const gift_id = json.gift_id;
		if (typeof gift_id !== 'number')
			return 400; // Bad Request

		const gift = await get_gift(gift_id);
		if (gift?.client_id !== client_id)
			return 400; // Bad Request

		// client shouldn't allow this, so no need for bespoke error
		if ((gift.flags & GiftFlags.Returned) === GiftFlags.Returned)
			return 400; // Bad Request

		await return_gift(gift);

		return { success: true };
	});

	session_post_route('/api/gift/discard', async (req, url, client_id, json) => {
		const gift_id = json.gift_id;
		if (typeof gift_id !== 'number' || !Number.isSafeInteger(gift_id))
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'gift-discard', () => {
			const gift = db.query<Pick<db_row.gifts, 'gift_id'>, [number, number, number]>(
				'SELECT `gift_id` FROM `gifts` WHERE `gift_id` = ? AND `client_id` = ? AND (`flags` & ?) <> 0'
			).get(gift_id, client_id, GiftFlags.Returned);
			if (gift === null)
				return { success: false };

			db.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift_id);
			remove_player_cache_entry(gift_cache, client_id, gift_id);
			return { success: true, effects: [] };
		});
		return result?.success === true ? result : 400;
	});

	session_post_route('/api/gift/send', async (req, url, client_id, json) => {
		const recipient_id = json.recipient_id;
		if (typeof recipient_id !== 'number')
			return 400; // Bad Request

		const items = parse_transfer_items(json.items);
		if (items === null)
			return 400; // Bad Request

		if (!(await guild_membership_exists(client_id, recipient_id)))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

		const result = run_economy_command(client_id, json.command_id, 'gift-send', () => {
			const pending = db.query(
				'SELECT 1 FROM `gifts` WHERE `client_id` = ? AND `sender_id` = ? LIMIT 1'
			).get(recipient_id, client_id);
			if (pending !== null)
				return { success: false, error_lang: 'MOD_MP_PENDING_GIFT' };
			const inserted = db.query(
				'INSERT INTO `gifts` (`client_id`, `sender_id`) VALUES(?, ?) RETURNING `gift_id`'
			).get(recipient_id, client_id) as { gift_id: number };
			for (const item of items)
				db.query(
					'INSERT INTO `gift_items` (`gift_id`, `item_id`, `qty`) VALUES(?, ?, ?)'
				).run(inserted.gift_id, item.id, item.qty);
			gift_cache.get(recipient_id)?.push(inserted.gift_id);
			return { success: true, effects: economy_item_effects(items, 'transfer', -1) };
		});
		return result ?? 400;
	});
}
