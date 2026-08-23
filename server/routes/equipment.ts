import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { db, db_get_all, db_get_single, guild_membership_exists, parse_equipment_snapshot, session_get_route, session_post_route } = runtime;

export function register_equipment_routes(): void {
	session_post_route('/api/client/equipment/sync', async (req, url, client_id, json): Promise<HandlerResult> => {
		const slots = parse_equipment_snapshot(json.slots);
		if (slots === null)
			return 400; // Bad Request

		const save_snapshot = db.transaction(() => {
			const client = db.query(
				'SELECT `equipment_visible` FROM `clients` WHERE `id` = ? LIMIT 1'
			).get(client_id) as Pick<db_row.clients, 'equipment_visible'>;
			if (client.equipment_visible !== 1)
				return false;

			db.query('INSERT INTO `equipment_snapshots` (`client_id`) VALUES(?) ON CONFLICT DO NOTHING').run(client_id);
			db.query('DELETE FROM `equipment_snapshot_items` WHERE `client_id` = ?').run(client_id);
			const insert = db.query(
				'INSERT INTO `equipment_snapshot_items` (`client_id`, `slot_id`, `item_id`) VALUES(?, ?, ?)'
			);
			for (const slot of slots)
				insert.run(client_id, slot.slot_id, slot.item_id);
			return true;
		});

		if (!save_snapshot.immediate())
			return { error_lang: 'MOD_MP_EQUIPMENT_SHARING_DISABLED' };
		return { success: true };
	});

	session_post_route('/api/client/equipment/visibility', async (req, url, client_id, json) => {
		if (typeof json.visible !== 'boolean')
			return 400; // Bad Request

		const set_visibility = db.transaction(() => {
			db.query('UPDATE `clients` SET `equipment_visible` = ? WHERE `id` = ?').run(
				json.visible ? 1 : 0,
				client_id
			);
			if (!json.visible)
				db.query('DELETE FROM `equipment_snapshots` WHERE `client_id` = ?').run(client_id);
		});
		set_visibility.immediate();

		return { success: true, visible: json.visible };
	});

	session_get_route('/api/guilds/equipment', async (req, url, client_id): Promise<HandlerResult> => {
		const subject_id = Number(url.searchParams.get('client_id'));
		if (!Number.isSafeInteger(subject_id) || subject_id < 1)
			return 400; // Bad Request

		if (!await guild_membership_exists(client_id, subject_id))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

		const subject = await db_get_single(
			'SELECT c.`equipment_visible`, EXISTS(' +
				'SELECT 1 FROM `equipment_snapshots` AS es WHERE es.`client_id` = c.`id`' +
			') AS `equipment_available` FROM `clients` AS c WHERE c.`id` = ? LIMIT 1',
			[subject_id]
		);
		if (subject?.equipment_visible !== 1)
			return { error_lang: 'MOD_MP_EQUIPMENT_SHARING_DISABLED' };
		if (subject.equipment_available !== 1)
			return { error_lang: 'MOD_MP_EQUIPMENT_NOT_AVAILABLE' };

		return {
			client_id: subject_id,
			slots: await db_get_all(
				'SELECT `slot_id`, `item_id` FROM `equipment_snapshot_items` WHERE `client_id` = ? ORDER BY `slot_id`',
				[subject_id]
			)
		};
	});
}
