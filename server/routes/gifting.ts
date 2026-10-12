import { create_custody_source, move_location } from '../economy-custody';
import { record_pending_exchange } from '../transfer-history';
import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import { add_inbox_items, get_inbox_source_name } from '../inbox';
import { client_uses_legacy_transfer_protocol } from '../transfer-compatibility';
import { cap_transfer_items } from '../transfer-caps';
import { audit_command_source, audit_position_key, link_audit_events, move_audit_value_with_fallback,
	record_audit_event } from '../audit';

const { GiftFlags, db, economy_item_effects, get_gift, gift_cache, guild_membership_exists, is_social_only_client, parse_transfer_items, remove_player_cache_entry, run_economy_command, session_post_route } = runtime;

export function register_gifting_routes(): void {
	session_post_route('/api/gift/accept', async (req, url, client_id, json) => {
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
		const gift_id = json.gift_id;
		if (typeof gift_id !== 'number')
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'gift-accept', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const gift = db.query('SELECT * FROM `gifts` WHERE `gift_id` = ? LIMIT 1').get(gift_id) as db_row.gifts;
			if (gift?.client_id !== client_id)
				return { success: false };
			const items = db.query(
				'SELECT `item_id`, `qty` FROM `gift_items` WHERE `gift_id` = ?'
			).all(gift_id) as Array<{ item_id: string; qty: number }>;
			const accepted_at = Date.now();
			record_pending_exchange(db, 'gift', gift_id, 'gift.accepted', accepted_at);
			const event_id = record_audit_event({
				event_type: 'gift.accepted',
				source_key: audit_command_source('gift-accept', client_id, json.command_id),
				command_id: typeof json.command_id === 'string' ? json.command_id : undefined,
				actor: { kind: 'client', client_id, request: req },
				participants: [{ role: 'sender', client_id: gift.sender_id }],
				occurred_at: accepted_at,
				values: items.map(item => ({ object_id: item.item_id, quantity: item.qty, direction: 'move' })),
				details: { gift_id }
			});
			const sent = db.query<{ id: number }, [string]>(
				'SELECT `id` FROM `audit_events` WHERE `source_key` = ?'
			).get(`gift:${gift_id}:sent`);
			if (sent !== null)
				link_audit_events(event_id, 'accepts', sent.id);
			for (const item of items) {
				move_audit_value_with_fallback(event_id, item.item_id, item.qty, 'gift',
					audit_position_key('gift', gift_id), 'inbox',
					audit_position_key('inbox', client_id, 'gift_received', get_inbox_source_name(gift.sender_id)));
			}
			add_inbox_items(client_id, items,
				{ type: 'gift_received', name: get_inbox_source_name(gift.sender_id),
					custody: { from: item_id => `gift:${gift_id}:${item_id}`, protected: (gift.flags & GiftFlags.Returned) === 0 } });
			db.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift_id);
			db.query('DELETE FROM `gift_items` WHERE `gift_id` = ?').run(gift_id);
			remove_player_cache_entry(gift_cache, client_id, gift_id);
			return { success: true, effects: [] };
		});
		return result?.success === true || result?.error_lang !== undefined ? result : 400;
	});

	session_post_route('/api/gift/decline', async (req, url, client_id, json) => {
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
		const gift_id = json.gift_id;
		if (typeof gift_id !== 'number')
			return 400; // Bad Request

		const gift = await get_gift(gift_id);
		if (gift?.client_id !== client_id)
			return 400; // Bad Request

		// client shouldn't allow this, so no need for bespoke error
		if ((gift.flags & GiftFlags.Returned) === GiftFlags.Returned)
			return 400; // Bad Request

		if (client_uses_legacy_transfer_protocol(gift.sender_id)) {
			const returned = db.transaction(() => {
				if (is_social_only_client(client_id))
					return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' } as const;
				const current = db.query('SELECT * FROM `gifts` WHERE `gift_id` = ? LIMIT 1').get(gift_id) as db_row.gifts;
				if (current?.client_id !== client_id || (current.flags & GiftFlags.Returned) === GiftFlags.Returned)
					return null;
				record_pending_exchange(db, 'gift', gift_id, 'gift.returned');
				const updated_at = Date.now();
				db.query(
					'UPDATE `gifts` SET `client_id` = ?, `sender_id` = ?, `flags` = `flags` | ?, `updated_at` = ? WHERE `gift_id` = ?'
				).run(current.sender_id, current.client_id, GiftFlags.Returned, updated_at, current.gift_id);
				return { success: true, gift: current } as const;
			}).immediate();
			if (returned === null)
				return 400;
			if (returned.success === false)
				return { error_lang: returned.error_lang };
			remove_player_cache_entry(gift_cache, returned.gift.client_id, returned.gift.gift_id);
			gift_cache.get(returned.gift.sender_id)?.push(returned.gift.gift_id);
			return { success: true };
		}

		const result = run_economy_command(client_id, json.command_id, 'gift-decline', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const current = db.query('SELECT * FROM `gifts` WHERE `gift_id` = ? LIMIT 1').get(gift_id) as db_row.gifts;
			if (current?.client_id !== client_id || (current.flags & GiftFlags.Returned) === GiftFlags.Returned)
				return { success: false };
			const items = db.query(
				'SELECT `item_id`, `qty` FROM `gift_items` WHERE `gift_id` = ?'
			).all(gift_id) as Array<{ item_id: string; qty: number }>;
			record_pending_exchange(db, 'gift', gift_id, 'gift.returned');
			add_inbox_items(current.sender_id, items,
				{ type: 'gift_returned', name: get_inbox_source_name(client_id),
					custody: { from: item_id => `gift:${gift_id}:${item_id}`, protected: false } });
			db.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift_id);
			db.query('DELETE FROM `gift_items` WHERE `gift_id` = ?').run(gift_id);
			remove_player_cache_entry(gift_cache, client_id, gift_id);
			return { success: true, effects: [] };
		});
		return result?.success === true || result?.error_lang !== undefined ? result : 400;
	});

	session_post_route('/api/gift/discard', async (req, url, client_id, json) => {
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
		const gift_id = json.gift_id;
		if (typeof gift_id !== 'number' || !Number.isSafeInteger(gift_id))
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'gift-discard', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const gift = db.query<Pick<db_row.gifts, 'gift_id'>, [number, number, number]>(
				'SELECT `gift_id` FROM `gifts` WHERE `gift_id` = ? AND `client_id` = ? AND (`flags` & ?) <> 0'
			).get(gift_id, client_id, GiftFlags.Returned);
			if (gift === null)
				return { success: false };

			for (const item of db.query<{item_id:string},[number]>('SELECT item_id FROM gift_items WHERE gift_id=?').all(gift_id))
				move_location(db,`gift:${gift_id}:${item.item_id}`,`consumed:gift-discard:${gift_id}`,Date.now(),'gift-discarded');
			record_pending_exchange(db, 'gift', gift_id, 'gift.discarded');
			db.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift_id);
			remove_player_cache_entry(gift_cache, client_id, gift_id);
			return { success: true, effects: [] };
		});
		return result?.success === true || result?.error_lang !== undefined ? result : 400;
	});

	session_post_route('/api/gift/send', async (req, url, client_id, json) => {
		if (is_social_only_client(client_id))
			return { error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
		const recipient_id = json.recipient_id;
		if (typeof recipient_id !== 'number')
			return 400; // Bad Request

		const parsed_items = parse_transfer_items(json.items);
		if (parsed_items === null)
			return 400; // Bad Request
		const items = cap_transfer_items(parsed_items);
		const totals = new Map<string,bigint>();
		for (const item of items) totals.set(item.id,(totals.get(item.id) ?? 0n)+BigInt(item.qty));
		if ([...totals.values()].some(qty => qty>BigInt(Number.MAX_SAFE_INTEGER))) return 400;

		if (!(await guild_membership_exists(client_id, recipient_id)))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

		const result = run_economy_command(client_id, json.command_id, 'gift-send', () => {
			if (is_social_only_client(client_id) || is_social_only_client(recipient_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const pending = db.query(
				'SELECT 1 FROM `gifts` WHERE `client_id` = ? AND `sender_id` = ? LIMIT 1'
			).get(recipient_id, client_id);
			if (pending !== null)
				return { success: false, error_lang: 'MOD_MP_PENDING_GIFT' };
			const created_at = Date.now();
			const inserted = db.query(
				'INSERT INTO `gifts` (`client_id`, `sender_id`, `created_at`, `updated_at`) VALUES(?, ?, ?, ?) RETURNING `gift_id`'
			).get(recipient_id, client_id, created_at, created_at) as { gift_id: number };
			for (const item of items) {
				db.query(
					'INSERT INTO `gift_items` (`gift_id`, `item_id`, `qty`) VALUES(?, ?, ?)'
				).run(inserted.gift_id, item.id, item.qty);
			}
			for (const item of db.query<{item_id:string;qty:number},[number]>(
				'SELECT item_id,SUM(qty) qty FROM gift_items WHERE gift_id=? GROUP BY item_id').all(inserted.gift_id)) {
				if (typeof json.command_id === 'string') create_custody_source(db,{
					root_key:`gift:${inserted.gift_id}:${item.item_id}`,operation_key:`receipt:${json.command_id}`,
					client_id,object_id:item.item_id,quantity:item.qty,created_at,
					snapshot:{gift_id:inserted.gift_id,sender_id:client_id,recipient_id,item_id:item.item_id,qty:item.qty}
				},`gift:${inserted.gift_id}:${item.item_id}`);
			}
			record_pending_exchange(db, 'gift', inserted.gift_id, 'gift.sent', created_at, json.command_id);
			const event_id = record_audit_event({
				event_type: 'gift.sent',
				source_key: `gift:${inserted.gift_id}:sent`,
				command_id: typeof json.command_id === 'string' ? json.command_id : undefined,
				actor: { kind: 'client', client_id, request: req },
				participants: [{ role: 'recipient', client_id: recipient_id }],
				occurred_at: created_at,
				values: items.map(item => ({ object_id: item.id, quantity: item.qty, direction: 'move' })),
				details: { gift_id: inserted.gift_id }
			});
			for (const item of items) {
				move_audit_value_with_fallback(event_id, item.id, item.qty, 'client',
					audit_position_key('client', client_id), 'gift', audit_position_key('gift', inserted.gift_id));
			}
			gift_cache.get(recipient_id)?.push(inserted.gift_id);
			return { success: true, effects: economy_item_effects(items, 'transfer', -1) };
		});
		return result ?? 400;
	});
}
