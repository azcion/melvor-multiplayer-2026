import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { db, db_execute, db_get_all, db_get_single, guild_membership_exists, parse_player_status_account_creation_date, parse_player_status_activities, parse_player_status_skills, parse_player_status_total_skill_level, session_get_route, session_post_route, status_snapshot_activities, status_snapshot_activity } = runtime;

export function register_player_status_routes(): void {
	async function get_active_mods(url: URL, client_id: number, require_guild: boolean): Promise<HandlerResult> {
		const subject_id = Number(url.searchParams.get('client_id'));
		if (!Number.isSafeInteger(subject_id) || subject_id < 1)
			return 400;
		if (require_guild && !await guild_membership_exists(client_id, subject_id))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };
		const subject = await db_get_single(
			'SELECT c.`active_mods_visible`, runtime.`active_mods` FROM `clients` AS c ' +
			'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
			'WHERE c.`id` = ? LIMIT 1', [subject_id]
		) as { active_mods_visible: number; active_mods: string | null } | null;
		if (subject?.active_mods_visible !== 1)
			return { error_lang: 'MOD_MP_ACTIVE_MODS_SHARING_DISABLED' };
		if (subject.active_mods === null)
			return { error_lang: 'MOD_MP_ACTIVE_MODS_NOT_AVAILABLE' };
		const active_mods = JSON.parse(subject.active_mods) as unknown;
		if (!Array.isArray(active_mods) || active_mods.length === 0)
			return { error_lang: 'MOD_MP_ACTIVE_MODS_NOT_AVAILABLE' };
		return { client_id: subject_id, active_mods };
	}

	async function get_status(url: URL, client_id: number, require_guild: boolean): Promise<HandlerResult> {
		const subject_id = Number(url.searchParams.get('client_id'));
		if (!Number.isSafeInteger(subject_id) || subject_id < 1)
			return 400;
		if (require_guild && !await guild_membership_exists(client_id, subject_id))
			return { error_lang: 'MOD_MP_GUILD_MEMBERSHIP_MISSING' };
		const subject = await db_get_single(
			'SELECT c.`skills_visible`, c.`skills_available`, c.`activity_visible`, c.`activity_available` ' +
				'FROM `clients` AS c WHERE c.`id` = ? LIMIT 1', [subject_id]
		);
		if (subject === null || (subject.skills_visible !== 1 && require_guild && subject.activity_visible !== 1))
			return { error_lang: 'MOD_MP_STATUS_SHARING_DISABLED' };
		const snapshot = await db_get_single(
			'SELECT `activity_type`, `activity_skill_id`, `activity_action_id`, `activity_area_id`, `activities` ' +
			'FROM `status_snapshots` WHERE `client_id` = ? LIMIT 1', [subject_id]
		) as db_row.status_snapshots;
		if (snapshot === null)
			return { error_lang: 'MOD_MP_STATUS_NOT_AVAILABLE' };
		const activity = status_snapshot_activity(snapshot);
		return {
			client_id: subject_id,
			skills: subject.skills_visible === 1 && subject.skills_available === 1 ? await db_get_all(
				'SELECT `skill_id`, `level` FROM `status_snapshot_skills` WHERE `client_id` = ? ORDER BY `skill_id`',
				[subject_id]
			) : [],
			...(require_guild ? {
				activity: subject.activity_visible === 1 && subject.activity_available === 1 ? activity : null,
				activities: subject.activity_visible === 1 && subject.activity_available === 1
					? status_snapshot_activities(snapshot, activity) : []
			} : {})
		};
	}

	session_post_route('/api/client/status/sync', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (Object.hasOwn(json, 'activity'))
			return 400; // Bad Request
		const has_skills = Object.hasOwn(json, 'skills');
		const has_activities = Object.hasOwn(json, 'activities');
		const has_account_creation_date = Object.hasOwn(json, 'account_creation_date');
		const has_total_skill_level = Object.hasOwn(json, 'total_skill_level');
		const has_gp = Object.hasOwn(json, 'gp');
		const skills = has_skills ? parse_player_status_skills(json.skills) : null;
		const activities = has_activities ? parse_player_status_activities(json.activities) : null;
		const account_creation_date = has_account_creation_date ? parse_player_status_account_creation_date(json.account_creation_date) : null;
		const total_skill_level = has_total_skill_level ? parse_player_status_total_skill_level(json.total_skill_level) : null;
		const gp = has_gp && Number.isSafeInteger(json.gp) && (json.gp as number) >= 0 ? json.gp as number : null;
		if ((!has_skills && !has_activities && !has_account_creation_date && !has_total_skill_level && !has_gp) ||
			(has_skills && skills === null) ||
			(has_activities && activities === null) || (has_account_creation_date && account_creation_date === undefined) ||
			(has_total_skill_level && total_skill_level === undefined) || (has_gp && gp === null))
			return 400; // Bad Request

		const save_snapshot = db.transaction(() => {
			if (activities !== null) {
				const activity = activities[0] ?? { type: 'idle' as const };
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
					JSON.stringify(activities)
				);
				db.query('UPDATE `clients` SET `activity_available` = 1 WHERE `id` = ?').run(client_id);
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
				db.query('UPDATE `clients` SET `skills_available` = 1 WHERE `id` = ?').run(client_id);
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
		});

		save_snapshot.immediate();
		return { success: true };
	});

	const set_split_visibility = (
		client_id: number,
		field: 'skills_visible' | 'activity_visible',
		visible: boolean
	) => {
		const set_visibility = db.transaction(() => {
			db.query(
				`UPDATE clients SET ${field} = ? WHERE id = ?`
			).run(visible ? 1 : 0, client_id);
		});
		set_visibility.immediate();
	};

	for (const [route, field] of [
		['/api/client/skills/visibility', 'skills_visible'],
		['/api/client/activity/visibility', 'activity_visible']
	] as const) {
		session_post_route(route, async (req, url, client_id, json) => {
			if (typeof json.visible !== 'boolean')
				return 400; // Bad Request
			set_split_visibility(client_id, field, json.visible);
			return { success: true, visible: json.visible };
		});
	}

	session_post_route('/api/client/gp/visibility', async (req, url, client_id, json) => {
		if (typeof json.visible !== 'boolean')
			return 400; // Bad Request

		const set_visibility = db.transaction(() => {
			db.query('UPDATE `clients` SET `gp_visible` = ? WHERE `id` = ?').run(json.visible ? 1 : 0, client_id);
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

	session_get_route('/api/guilds/active-mods', async (req, url, client_id) => get_active_mods(url, client_id, true));
	session_get_route('/api/chat/active-mods', async (req, url, client_id) => get_active_mods(url, client_id, false));

	session_get_route('/api/guilds/status', async (req, url, client_id) => get_status(url, client_id, true));
	session_get_route('/api/chat/status', async (req, url, client_id) => get_status(url, client_id, false));
}
