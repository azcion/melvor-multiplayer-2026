import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { db, db_execute, db_get_all, db_get_single, guild_membership_exists, legacy_status_activities, parse_player_status_account_creation_date, parse_player_status_activities, parse_player_status_activity, parse_player_status_skills, parse_player_status_total_skill_level, session_get_route, session_post_route, status_snapshot_activities, status_snapshot_activity } = runtime;

export function register_player_status_routes(): void {
	session_post_route('/api/client/status/sync', async (req, url, client_id, json): Promise<HandlerResult> => {
		const has_skills = Object.hasOwn(json, 'skills');
		const has_activity = Object.hasOwn(json, 'activity');
		const has_activities = Object.hasOwn(json, 'activities');
		const has_account_creation_date = Object.hasOwn(json, 'account_creation_date');
		const has_total_skill_level = Object.hasOwn(json, 'total_skill_level');
		const has_gp = Object.hasOwn(json, 'gp');
		const skills = has_skills ? parse_player_status_skills(json.skills) : null;
		const activity = has_activity ? parse_player_status_activity(json.activity) : null;
		const activities = has_activities ? parse_player_status_activities(json.activities) : null;
		const account_creation_date = has_account_creation_date ? parse_player_status_account_creation_date(json.account_creation_date) : null;
		const total_skill_level = has_total_skill_level ? parse_player_status_total_skill_level(json.total_skill_level) : null;
		const gp = has_gp && Number.isSafeInteger(json.gp) && (json.gp as number) >= 0 ? json.gp as number : null;
		if ((!has_skills && !has_activity && !has_activities && !has_account_creation_date && !has_total_skill_level && !has_gp) ||
			(has_skills && skills === null) || (has_activity && activity === null) ||
			(has_activities && activities === null) || (has_account_creation_date && account_creation_date === undefined) ||
			(has_total_skill_level && total_skill_level === undefined) || (has_gp && gp === null))
			return 400; // Bad Request

		const save_snapshot = db.transaction(() => {
			const client = db.query(
				'SELECT `status_visible`, `gp_visible` FROM `clients` WHERE `id` = ? LIMIT 1'
			).get(client_id) as Pick<db_row.clients, 'status_visible' | 'gp_visible'>;
			if ((has_skills || has_activity || has_activities || has_account_creation_date || has_total_skill_level) && client.status_visible !== 1)
				return 'status_disabled';
			if (has_gp && client.gp_visible !== 1)
				return 'gp_disabled';

			if (activity !== null) {
				const persisted_activities = activities ?? legacy_status_activities(activity);
				db.query(
					'INSERT INTO `status_snapshots` ' +
					'(`client_id`, `activity_type`, `activity_skill_id`, `activity_action_id`, `activity_area_id`, `activities`) ' +
					'VALUES(?, ?, ?, ?, ?, ?) ' +
					'ON CONFLICT(`client_id`) DO UPDATE SET `activity_type` = excluded.`activity_type`, ' +
					'`activity_skill_id` = excluded.`activity_skill_id`, `activity_action_id` = excluded.`activity_action_id`, ' +
					'`activity_area_id` = excluded.`activity_area_id`, `activities` = excluded.`activities`'
				).run(
					client_id,
					activity.type,
					activity.type === 'skill' ? activity.skill_id : null,
					activity.type === 'skill' ? activity.action_id : null,
					activity.type === 'combat' ? activity.area_id : null,
					JSON.stringify(persisted_activities)
				);
			} else if (activities !== null) {
				db.query(
					"INSERT INTO `status_snapshots` (`client_id`, `activity_type`, `activities`) VALUES(?, 'idle', ?) " +
					'ON CONFLICT(`client_id`) DO UPDATE SET `activities` = excluded.`activities`'
				).run(client_id, JSON.stringify(activities));
			}
			if (skills !== null) {
				db.query(
					"INSERT INTO `status_snapshots` (`client_id`, `activity_type`) VALUES(?, 'idle') " +
					'ON CONFLICT(`client_id`) DO NOTHING'
				).run(client_id);
				db.query('DELETE FROM `status_snapshot_skills` WHERE `client_id` = ?').run(client_id);
				const insert = db.query(
					'INSERT INTO `status_snapshot_skills` (`client_id`, `skill_id`, `level`) VALUES(?, ?, ?)'
				);
				for (const skill of skills)
					insert.run(client_id, skill.skill_id, skill.level);
			}
			if (has_account_creation_date || has_total_skill_level) {
				db.query(
					"INSERT INTO `status_snapshots` (`client_id`, `activity_type`) VALUES(?, 'idle') " +
					'ON CONFLICT(`client_id`) DO NOTHING'
				).run(client_id);
				if (has_account_creation_date)
					db.query('UPDATE `status_snapshots` SET `account_creation_date` = ? WHERE `client_id` = ?')
					.run(account_creation_date as number | null, client_id);
				if (has_total_skill_level)
					db.query('UPDATE `status_snapshots` SET `total_skill_level` = ? WHERE `client_id` = ?')
					.run(total_skill_level as number | null, client_id);
			}
			if (gp !== null)
				db.query(
					'INSERT INTO `gp_snapshots` (`client_id`, `amount`) VALUES(?, ?) ' +
					'ON CONFLICT(`client_id`) DO UPDATE SET `amount` = excluded.`amount`'
				).run(client_id, gp);
			return 'saved';
		});

		const result = save_snapshot.immediate();
		if (result === 'status_disabled')
			return { error_lang: 'MOD_MP_STATUS_SHARING_DISABLED' };
		if (result === 'gp_disabled')
			return { error_lang: 'MOD_MP_GP_SHARING_DISABLED' };
		return { success: true };
	});

	session_post_route('/api/client/status/visibility', async (req, url, client_id, json) => {
		if (typeof json.visible !== 'boolean')
			return 400; // Bad Request

		const set_visibility = db.transaction(() => {
			db.query('UPDATE `clients` SET `status_visible` = ? WHERE `id` = ?').run(
				json.visible ? 1 : 0,
				client_id
			);
			if (!json.visible)
				db.query('DELETE FROM `status_snapshots` WHERE `client_id` = ?').run(client_id);
		});
		set_visibility.immediate();

		return { success: true, visible: json.visible };
	});

	session_post_route('/api/client/gp/visibility', async (req, url, client_id, json) => {
		if (typeof json.visible !== 'boolean')
			return 400; // Bad Request

		const set_visibility = db.transaction(() => {
			db.query('UPDATE `clients` SET `gp_visible` = ? WHERE `id` = ?').run(json.visible ? 1 : 0, client_id);
			if (!json.visible)
				db.query('DELETE FROM `gp_snapshots` WHERE `client_id` = ?').run(client_id);
		});
		set_visibility.immediate();

		return { success: true, visible: json.visible };
	});

	session_post_route('/api/client/game-mode/visibility', async (req, url, client_id, json) => {
		if (typeof json.visible !== 'boolean')
			return 400; // Bad Request

		await db_execute('UPDATE `clients` SET `game_mode_visible` = ? WHERE `id` = ?', [
			json.visible ? 1 : 0,
			client_id
		]);

		return { success: true, visible: json.visible };
	});

	session_post_route('/api/client/active-mods/visibility', async (req, url, client_id, json) => {
		if (typeof json.visible !== 'boolean')
			return 400; // Bad Request

		await db_execute('UPDATE `clients` SET `active_mods_visible` = ? WHERE `id` = ?', [
			json.visible ? 1 : 0,
			client_id
		]);

		return { success: true, visible: json.visible };
	});

	session_get_route('/api/guilds/active-mods', async (req, url, client_id): Promise<HandlerResult> => {
		const subject_id = Number(url.searchParams.get('client_id'));
		if (!Number.isSafeInteger(subject_id) || subject_id < 1)
			return 400; // Bad Request

		if (!await guild_membership_exists(client_id, subject_id))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

		const subject = await db_get_single(
			'SELECT c.`active_mods_visible`, runtime.`active_mods` FROM `clients` AS c ' +
			'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
			'WHERE c.`id` = ? LIMIT 1',
			[subject_id]
		) as { active_mods_visible: number; active_mods: string | null } | null;
		if (subject?.active_mods_visible !== 1)
			return { error_lang: 'MOD_MP_ACTIVE_MODS_SHARING_DISABLED' };
		if (subject.active_mods === null)
			return { error_lang: 'MOD_MP_ACTIVE_MODS_NOT_AVAILABLE' };

		const active_mods = JSON.parse(subject.active_mods) as unknown;
		if (!Array.isArray(active_mods) || active_mods.length === 0)
			return { error_lang: 'MOD_MP_ACTIVE_MODS_NOT_AVAILABLE' };

		return { client_id: subject_id, active_mods };
	});

	session_get_route('/api/guilds/status', async (req, url, client_id): Promise<HandlerResult> => {
		const subject_id = Number(url.searchParams.get('client_id'));
		if (!Number.isSafeInteger(subject_id) || subject_id < 1)
			return 400; // Bad Request

		if (!await guild_membership_exists(client_id, subject_id))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };

		const subject = await db_get_single(
			'SELECT c.`status_visible`, EXISTS(' +
				'SELECT 1 FROM `status_snapshots` AS ss WHERE ss.`client_id` = c.`id`' +
			') AS `status_available` FROM `clients` AS c WHERE c.`id` = ? LIMIT 1',
			[subject_id]
		);
		if (subject === null || subject.status_visible !== 1)
			return { error_lang: 'MOD_MP_STATUS_SHARING_DISABLED' };
		if (subject.status_available !== 1)
			return { error_lang: 'MOD_MP_STATUS_NOT_AVAILABLE' };

		const snapshot = await db_get_single(
			'SELECT `activity_type`, `activity_skill_id`, `activity_action_id`, `activity_area_id`, `activities` ' +
			'FROM `status_snapshots` WHERE `client_id` = ? LIMIT 1',
			[subject_id]
		) as db_row.status_snapshots;
		if (snapshot === null)
			return { error_lang: 'MOD_MP_STATUS_NOT_AVAILABLE' };

		const activity = status_snapshot_activity(snapshot);

		return {
			client_id: subject_id,
			skills: await db_get_all(
				'SELECT `skill_id`, `level` FROM `status_snapshot_skills` WHERE `client_id` = ? ORDER BY `skill_id`',
				[subject_id]
			),
			activity,
			activities: status_snapshot_activities(snapshot, activity)
		};
	});
}
