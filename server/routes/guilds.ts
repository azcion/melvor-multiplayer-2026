import * as runtime from '../app-runtime';
import type { GuildSummary, GuildType } from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import { get_guild_activity, parse_guild_activity_cursor } from '../guild-activity';
import { record_guild_activity } from '../guild-activity';

const { DIRECT_JOIN_CHARITREE_LOCK, FREE_FELLOWSHIP_TYPE, GiftFlags, PETITION_LIFETIME, PUBLIC_GUILD_TYPE, db, db_get_all, db_get_single, db_run, ensure_guild_campaign, expire_charity_items, expire_petitions, forget_guild_campaign, get_client_display, get_client_guild_id, get_council_petitions, get_guild_applicants, get_guild_capabilities, get_guild_member_directory, get_guild_members, get_guild_summary, get_guild_type, get_petition_conflict_subject, get_petition_resolution, guild_summary_from_row, has_guild_departure_blocker, is_petition_choice, is_petition_type, is_valid_guild_icon_id, parse_guild_name, process_council_actions, resize_unprogressed_campaign, session_get_route, session_post_route, shadowed_cutoff, unlock_winnowing_targets } = runtime;

export function register_guilds_routes(): void {
	session_get_route('/api/guilds/activity', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		const cursor = parse_guild_activity_cursor(url.searchParams.get('cursor'));
		if (cursor === false)
			return 400;
		return get_guild_activity(guild_id, client_id, cursor);
	});
	session_get_route('/api/guilds/council', async (req, url, client_id) => {
		expire_petitions();
		process_council_actions();
		const membership = await db_get_single(
			'SELECT `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1',
			[client_id]
		) as db_row.guild_memberships;
		if (membership === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (await get_guild_type(membership.guild_id) === FREE_FELLOWSHIP_TYPE)
			return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };

		const raw_page = url.searchParams.get('page');
		const resolved_page = raw_page === null ? 0 : Number(raw_page);
		if (!Number.isSafeInteger(resolved_page) || resolved_page < 0)
			return 400; // Bad Request

		return await get_council_petitions(membership.guild_id, client_id, resolved_page);
	});

	session_post_route('/api/guilds/petitions/raise', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (!is_petition_type(json.type))
			return 400; // Bad Request

		const petition_type = json.type;
		const proposed_name = petition_type === 'appellation' ? parse_guild_name(json.name) : null;
		const proposed_icon_id = petition_type === 'heraldry' && is_valid_guild_icon_id(json.icon_id) ? json.icon_id : null;
		let target_client_id: number | null = null;
		if (petition_type === 'banishment') {
			if (typeof json.target_client_id !== 'number' || !Number.isSafeInteger(json.target_client_id) || json.target_client_id < 1)
				return 400; // Bad Request
			target_client_id = json.target_client_id;
		}
		if (petition_type === 'appellation' && proposed_name === null)
			return 400; // Bad Request
		if (petition_type === 'heraldry' && proposed_icon_id === null)
			return 400; // Bad Request

		const now = Date.now();
		const raise_petition = db.transaction(() => {
			expire_petitions(now);
			const membership = db.query(
				'SELECT `id`, `guild_id` FROM `guild_memberships` WHERE `client_id` = ? LIMIT 1'
			).get(client_id) as db_row.guild_memberships;
			if (membership === null)
				return { status: 'forbidden' as const };

			const guild = db.query(
				'SELECT `type`, `name`, `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1'
			).get(
				membership.guild_id
			) as { type: GuildType; name: string; charitree_enabled: number } | null;
			if (guild === null)
				return { status: 'forbidden' as const };
			if (guild.type === FREE_FELLOWSHIP_TYPE)
				return { status: 'unavailable' as const };
			if ((petition_type === 'fellowship' && guild.type !== 'private') ||
				(petition_type === 'enclosure' && guild.type !== PUBLIC_GUILD_TYPE))
				return { status: 'admission_unavailable' as const };
			expire_charity_items(now, membership.guild_id);
			if (petition_type === 'charitree_ingratitude') {
				const has_items = db.query(
					'SELECT 1 FROM `charity_items` WHERE `guild_id` = ? LIMIT 1'
				).get(membership.guild_id);
				if (guild.charitree_enabled !== 1 || has_items === null)
					return { status: 'charitree_unavailable' as const };
			} else if (petition_type === 'charitree_sacrilege' && guild.charitree_enabled !== 1) {
				return { status: 'charitree_unavailable' as const };
			} else if (petition_type === 'charitree_beneficence' && guild.charitree_enabled !== 0) {
				return { status: 'charitree_unavailable' as const };
			}

			let target_membership_id: number | null = null;
			let winnowing_targets: Array<{ id: number; client_id: number }> = [];
			if (petition_type === 'banishment') {
				if (target_client_id === null)
					return { status: 'target_missing' as const };
				const target_membership = db.query(
					'SELECT `id` FROM `guild_memberships` WHERE `client_id` = ? AND `guild_id` = ? LIMIT 1'
				).get(target_client_id, membership.guild_id) as { id: number } | null;
				if (target_membership === null)
					return { status: 'target_missing' as const };
				target_membership_id = target_membership.id;
				const winnowing_conflict = db.query(
					'SELECT 1 FROM `guild_petition_winnowing_targets` WHERE `membership_id` = ? ' +
					'AND `subject_locked` = 1 LIMIT 1'
				).get(target_membership_id);
				if (winnowing_conflict !== null)
					return { status: 'conflict' as const };
			} else if (petition_type === 'winnowing') {
				winnowing_targets = db.query(
					'SELECT membership.`id`, membership.`client_id` FROM `guild_memberships` AS membership ' +
					'JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
					'WHERE membership.`guild_id` = ? AND client.`last_multiplayer_active_at` < ? ' +
					'ORDER BY membership.`id`'
				).all(membership.guild_id, shadowed_cutoff(now)) as Array<{ id: number; client_id: number }>;
				if (winnowing_targets.length === 0)
					return { status: 'winnowing_empty' as const };
				const banishment_conflict = db.query(
					'SELECT 1 FROM `guild_petitions` AS petition ' +
					'WHERE petition.`guild_id` = ? AND petition.`type` = \'banishment\' ' +
					'AND petition.`subject_locked` = 1 AND petition.`target_membership_id` IN (' +
					winnowing_targets.map(() => '?').join(', ') + ') LIMIT 1'
				).get(membership.guild_id, ...winnowing_targets.map(target => target.id));
				if (banishment_conflict !== null)
					return { status: 'conflict' as const };
			}

			const conflict_subject = get_petition_conflict_subject(petition_type, target_membership_id ?? undefined);
			const conflict = db.query(
				'SELECT 1 FROM `guild_petitions` WHERE `guild_id` = ? AND `conflict_subject` = ? ' +
				'AND `subject_locked` = 1 LIMIT 1'
			).get(membership.guild_id, conflict_subject);
			if (conflict !== null)
				return { status: 'conflict' as const };
			const charitree_expires_before = petition_type === 'charitree_ingratitude'
				? (db.query(
					'SELECT MAX(`expires_at`) AS `expires_at` FROM `charity_items` WHERE `guild_id` = ?'
				).get(membership.guild_id) as { expires_at: number | null }).expires_at ?? now
				: null;

			const petition = db.query(
				'INSERT INTO `guild_petitions` (`guild_id`, `guild_name`, `type`, `conflict_subject`, ' +
				'`petitioner_id`, `proposed_name`, `proposed_icon_id`, `target_client_id`, `target_membership_id`, ' +
				'`charitree_expires_before`, `created_at`, `expires_at`) ' +
				'VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING `id`'
			).get(
				membership.guild_id,
				guild.name,
				petition_type,
				conflict_subject,
				client_id,
				proposed_name,
				proposed_icon_id,
				target_client_id,
				target_membership_id,
				charitree_expires_before,
				now,
				now + PETITION_LIFETIME
			) as { id: number };
			record_guild_activity({ guild_id: membership.guild_id, event_type: 'petition_raised',
				source_key: `petition:${petition.id}:raised`, actor_client_id: client_id,
				metadata: { petition_type }, created_at: now });
			if (petition_type === 'winnowing') {
				const insert_target = db.query(
					'INSERT INTO `guild_petition_winnowing_targets` ' +
					'(`petition_id`, `membership_id`, `client_id`) VALUES(?, ?, ?)'
				);
				for (const target of winnowing_targets)
					insert_target.run(petition.id, target.id, target.client_id);
			}
			db.query(
				'INSERT INTO `guild_petition_voters` (`petition_id`, `client_id`) ' +
				'SELECT ?, membership.`client_id` FROM `guild_memberships` AS membership ' +
				'JOIN `clients` AS client ON client.`id` = membership.`client_id` ' +
				'WHERE membership.`guild_id` = ? AND client.`last_multiplayer_active_at` >= ?'
			).run(petition.id, membership.guild_id, shadowed_cutoff(now));
			return { status: 'created' as const, petition_id: petition.id };
		});

		const result = raise_petition.immediate();
		if (result.status === 'forbidden')
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (result.status === 'target_missing')
			return { error_lang: 'MOD_MP_COUNCIL_TARGET_MISSING' };
		if (result.status === 'winnowing_empty')
			return { error_lang: 'MOD_MP_COUNCIL_WINNOWING_EMPTY' };
		if (result.status === 'conflict')
			return { error_lang: 'MOD_MP_COUNCIL_CONFLICT' };
		if (result.status === 'unavailable')
			return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };
		if (result.status === 'charitree_unavailable')
			return { error_lang: 'MOD_MP_COUNCIL_CHARITREE_UNAVAILABLE' };
		if (result.status === 'admission_unavailable')
			return { error_lang: 'MOD_MP_COUNCIL_ADMISSION_UNAVAILABLE' };
		return { success: true, petition_id: result.petition_id };
	});

	session_post_route('/api/guilds/petitions/vote', async (req, url, client_id, json): Promise<HandlerResult> => {
		const petition_id = json.petition_id;
		const choice = json.choice;
		if (typeof petition_id !== 'number' || !Number.isSafeInteger(petition_id) || petition_id < 1 ||
			!is_petition_choice(choice))
			return 400; // Bad Request

		const now = Date.now();
		const cast_vote = db.transaction(() => {
			const petition = db.query('SELECT * FROM `guild_petitions` WHERE `id` = ? LIMIT 1').get(
				petition_id
			) as db_row.guild_petitions;
			if (petition === null)
				return { status: 'missing' as const };
			const guild = db.query('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1').get(
				petition.guild_id
			) as { type: GuildType } | null;
			if (guild?.type === FREE_FELLOWSHIP_TYPE)
				return { status: 'unavailable' as const };
			if (petition.lifecycle === 'active' && petition.expires_at <= now) {
				unlock_winnowing_targets(petition_id);
				db.query(
					"UPDATE `guild_petitions` SET `lifecycle` = 'lapsed', `resolved_at` = `expires_at`, " +
					"`subject_locked` = 0 WHERE `id` = ? AND `lifecycle` = 'active'"
				).run(petition_id);
				return { status: 'final' as const };
			}
			if (petition.lifecycle !== 'active')
				return { status: 'final' as const };

			const membership = db.query(
				'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? AND `guild_id` = ? LIMIT 1'
			).get(client_id, petition.guild_id);
			if (membership === null)
				return { status: 'forbidden' as const };
			const eligible = db.query(
				'SELECT 1 FROM `guild_petition_voters` WHERE `petition_id` = ? AND `client_id` = ? LIMIT 1'
			).get(petition_id, client_id);
			if (eligible === null)
				return { status: 'ineligible' as const };
			const existing = db.query(
				'SELECT 1 FROM `guild_petition_votes` WHERE `petition_id` = ? AND `client_id` = ? LIMIT 1'
			).get(petition_id, client_id);
			if (existing !== null)
				return { status: 'duplicate' as const };

			db.query(
				'INSERT INTO `guild_petition_votes` (`petition_id`, `client_id`, `choice`, `submitted_at`) ' +
				'VALUES(?, ?, ?, ?)'
			).run(petition_id, client_id, choice, now);
			const tally = db.query(
				'SELECT (SELECT COUNT(*) FROM `guild_petition_voters` WHERE `petition_id` = ?) AS `eligible`, ' +
				"SUM(CASE WHEN `choice` = 'aye' THEN 1 ELSE 0 END) AS `aye`, " +
				"SUM(CASE WHEN `choice` = 'nay' THEN 1 ELSE 0 END) AS `nay` " +
				'FROM `guild_petition_votes` WHERE `petition_id` = ?'
			).get(petition_id, petition_id) as { eligible: number; aye: number; nay: number };
			const lifecycle = get_petition_resolution(tally.eligible, tally.aye, tally.nay);
			if (lifecycle !== null) {
				db.query(
					'UPDATE `guild_petitions` SET `lifecycle` = ?, `resolved_at` = ?, `execution_state` = ?, ' +
					'`subject_locked` = ? WHERE `id` = ?'
				).run(
					lifecycle,
					now,
					lifecycle === 'granted' ? 'pending' : 'not_applicable',
					lifecycle === 'granted' ? 1 : 0,
					petition_id
				);
				if (lifecycle !== 'granted')
					unlock_winnowing_targets(petition_id);
				record_guild_activity({ guild_id: petition.guild_id,
					event_type: lifecycle === 'granted' ? 'petition_carried' : 'petition_defeated',
					source_key: `petition:${petition_id}:${lifecycle}`,
					metadata: { petition_type: petition.type }, created_at: now });
			}
			return { status: 'accepted' as const, lifecycle: lifecycle ?? 'active' };
		});

		const result = cast_vote.immediate();
		if (result.status === 'missing')
			return { error_lang: 'MOD_MP_COUNCIL_PETITION_MISSING' };
		if (result.status === 'final')
			return { error_lang: 'MOD_MP_COUNCIL_PETITION_FINAL' };
		if (result.status === 'unavailable')
			return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };
		if (result.status === 'forbidden')
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (result.status === 'ineligible')
			return { error_lang: 'MOD_MP_COUNCIL_INELIGIBLE' };
		if (result.status === 'duplicate')
			return { error_lang: 'MOD_MP_COUNCIL_ALREADY_VOTED' };
		if (result.lifecycle === 'granted')
			process_council_actions();
		return { success: true, lifecycle: result.lifecycle };
	});

	session_post_route('/api/guilds/petitions/withdraw', async (req, url, client_id, json): Promise<HandlerResult> => {
		const petition_id = json.petition_id;
		if (typeof petition_id !== 'number' || !Number.isSafeInteger(petition_id) || petition_id < 1)
			return 400; // Bad Request

		const now = Date.now();
		const withdraw_petition = db.transaction(() => {
			const petition = db.query('SELECT * FROM `guild_petitions` WHERE `id` = ? LIMIT 1').get(
				petition_id
			) as db_row.guild_petitions;
			if (petition === null)
				return 'missing';
			const guild = db.query('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1').get(
				petition.guild_id
			) as { type: GuildType } | null;
			if (guild?.type === FREE_FELLOWSHIP_TYPE)
				return 'unavailable';
			if (petition.lifecycle === 'active' && petition.expires_at <= now) {
				unlock_winnowing_targets(petition_id);
				db.query(
					"UPDATE `guild_petitions` SET `lifecycle` = 'lapsed', `resolved_at` = `expires_at`, " +
					"`subject_locked` = 0 WHERE `id` = ? AND `lifecycle` = 'active'"
				).run(petition_id);
				return 'final';
			}
			if (petition.lifecycle !== 'active')
				return 'final';
			if (petition.petitioner_id !== client_id)
				return 'forbidden';
			const membership = db.query(
				'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? AND `guild_id` = ? LIMIT 1'
			).get(client_id, petition.guild_id);
			if (membership === null)
				return 'forbidden';
			unlock_winnowing_targets(petition_id);
			db.query(
				"UPDATE `guild_petitions` SET `lifecycle` = 'withdrawn', `resolved_at` = ?, `subject_locked` = 0 " +
				"WHERE `id` = ? AND `lifecycle` = 'active'"
			).run(now, petition_id);
			return 'withdrawn';
		});

		const result = withdraw_petition.immediate();
		if (result === 'missing')
			return { error_lang: 'MOD_MP_COUNCIL_PETITION_MISSING' };
		if (result === 'final')
			return { error_lang: 'MOD_MP_COUNCIL_PETITION_FINAL' };
		if (result === 'unavailable')
			return { error_lang: 'MOD_MP_GUILD_COUNCIL_UNAVAILABLE' };
		if (result === 'forbidden')
			return { error_lang: 'MOD_MP_COUNCIL_WITHDRAW_FORBIDDEN' };
		return { success: true };
	});

	session_get_route('/api/guilds/list', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		const application = await db_get_single(
			'SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1',
			[client_id]
		);
		if (guild_id !== null || application !== null)
			return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };

		const guilds = await db_get_all(
			'SELECT g.`id` AS `guild_id`, g.`type`, g.`name`, g.`icon_id`, COUNT(m.`client_id`) AS `member_count` ' +
			'FROM `guilds` AS g LEFT JOIN `guild_memberships` AS m ON m.`guild_id` = g.`id` ' +
			'LEFT JOIN `clients` AS c ON c.`id` = m.`client_id` GROUP BY g.`id` ' +
			"HAVING g.`type` = 'free_fellowship' OR " +
			'SUM(CASE WHEN c.`last_multiplayer_active_at` >= ? THEN 1 ELSE 0 END) > 0 ' +
			"ORDER BY CASE WHEN g.`type` = 'free_fellowship' THEN 0 WHEN g.`type` = 'public' THEN 1 ELSE 2 END, " +
			'MAX(c.`last_multiplayer_active_at`) DESC, ' +
			'g.`name` COLLATE NOCASE, g.`id`',
			[shadowed_cutoff()]
		) as Array<GuildSummary & { type: GuildType }>;
		return { guilds: guilds.map(guild_summary_from_row) };
	});

	session_get_route('/api/guilds/members', async (req, url, client_id) => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const raw_page = url.searchParams.get('page');
		const page = raw_page === null ? 0 : Number(raw_page);
		const search = url.searchParams.get('search') ?? '';
		if (!Number.isSafeInteger(page) || page < 0 || search.length > 64)
			return 400; // Bad Request

		return await get_guild_member_directory(guild_id, page, search);
	});

	session_get_route('/api/guilds/members/shadowed', async (req, url, client_id) => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const raw_page = url.searchParams.get('page');
		const page = raw_page === null ? 0 : Number(raw_page);
		const search = url.searchParams.get('search') ?? '';
		if (!Number.isSafeInteger(page) || page < 0 || search.length > 64)
			return 400; // Bad Request

		return await get_guild_member_directory(guild_id, page, search, true);
	});

	session_get_route('/api/guilds/state', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id !== null) {
			const guild = await get_guild_summary(guild_id);
			if (guild === null)
				return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
			const guild_type = guild.is_free_fellowship === true
				? FREE_FELLOWSHIP_TYPE
				: guild.is_public === true ? PUBLIC_GUILD_TYPE : 'private';
			const member_directory = guild_type === FREE_FELLOWSHIP_TYPE
				? await get_guild_member_directory(guild_id, 0, '')
				: null;
			const charitree = await db_get_single(
				'SELECT `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1',
				[guild_id]
			) as { charitree_enabled: number } | null;
			return {
				affiliation: 'member',
				current_client_id: client_id,
				guild: {
					...guild,
					charitree_enabled: charitree?.charitree_enabled === 1,
					capabilities: get_guild_capabilities(guild_type)
				},
				members: member_directory?.members ?? await get_guild_members(guild_id),
				...(member_directory === null ? {} : { member_directory }),
				applicants: await get_guild_applicants(client_id)
			};
		}

		const application = await db_get_single(
			'SELECT a.`id` AS `application_id`, g.`id` AS `guild_id`, g.`name`, g.`icon_id`, ' +
			'COUNT(m.`client_id`) AS `member_count` FROM `guild_applications` AS a ' +
			'JOIN `guilds` AS g ON g.`id` = a.`guild_id` ' +
			'LEFT JOIN `guild_memberships` AS m ON m.`guild_id` = g.`id` ' +
			'WHERE a.`client_id` = ? GROUP BY a.`id`',
			[client_id]
		);

		return application === null
			? { affiliation: 'none' }
			: { affiliation: 'applicant', application };
	});

	session_post_route('/api/guilds/create', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_name = parse_guild_name(json.name);
		const icon_id = json.icon_id;
		if (guild_name === null || !is_valid_guild_icon_id(icon_id))
			return 400; // Bad Request

		const create_guild = db.transaction(() => {
			const affiliation = db.query(
				'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? ' +
				'UNION ALL SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1'
			).get(client_id, client_id);
			if (affiliation !== null)
				return null;

			const guild = db.query(
				'INSERT INTO `guilds` (`name`, `icon_id`) VALUES(?, ?) RETURNING `id`'
			).get(guild_name, icon_id) as { id: number };
			const membership = db.query(
				'INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?) RETURNING `id`'
			).get(client_id, guild.id) as { id: number };
			record_guild_activity({ guild_id: guild.id, event_type: 'joined', actor_client_id: client_id,
				source_key: `membership:${membership.id}:joined` });
			return guild.id;
		});

		const guild_id = create_guild.immediate();
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };

		await ensure_guild_campaign(guild_id);
		return { success: true, guild: await get_guild_summary(guild_id) };
	});

	session_post_route('/api/guilds/apply', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = json.guild_id;
		if (typeof guild_id !== 'number' || !Number.isSafeInteger(guild_id))
			return 400; // Bad Request

		const create_application = db.transaction(() => {
			const affiliation = db.query(
				'SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? ' +
				'UNION ALL SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1'
			).get(client_id, client_id);
			if (affiliation !== null)
				return 'affiliated';

			const guild = db.query('SELECT `type` FROM `guilds` WHERE `id` = ? LIMIT 1').get(guild_id) as {
				type: GuildType;
			} | null;
			if (guild === null)
				return 'missing';
			if (guild.type !== 'private')
				return 'direct_join';

			db.query(
				'INSERT INTO `guild_applications` (`client_id`, `guild_id`) VALUES(?, ?)'
			).run(client_id, guild_id);
			return 'created';
		});

		const result = create_application.immediate();
		if (result === 'affiliated')
			return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };
		if (result === 'missing')
			return { error_lang: 'MOD_MP_GUILD_NOT_FOUND' };
		if (result === 'direct_join')
			return { error_lang: 'MOD_MP_GUILD_APPLICATION_FORBIDDEN' };

		return { success: true };
	});

	async function join_open_guild(client_id: number, requested_guild_id: number | null): Promise<HandlerResult> {
		const join_guild = db.transaction(() => {
			const affiliation = db.query(
				' SELECT 1 FROM `guild_memberships` WHERE `client_id` = ? ' +
				'UNION ALL SELECT 1 FROM `guild_applications` WHERE `client_id` = ? LIMIT 1'
			).get(client_id, client_id);
			if (affiliation !== null)
				return { status: 'affiliated' as const };

			const guild = requested_guild_id === null
				? db.query("SELECT `id`, `type` FROM `guilds` WHERE `type` = 'free_fellowship' LIMIT 1").get()
				: db.query('SELECT `id`, `type` FROM `guilds` WHERE `id` = ? LIMIT 1').get(requested_guild_id);
			if (guild === null)
				return { status: 'missing' as const };
			const open_guild = guild as { id: number; type: GuildType };
			if (open_guild.type !== PUBLIC_GUILD_TYPE && open_guild.type !== FREE_FELLOWSHIP_TYPE)
				return { status: 'private' as const };

			const now = Date.now();
			const membership = db.query(
				'INSERT INTO `guild_memberships` (`client_id`, `guild_id`, `charitree_take_available_at`) VALUES(?, ?, ?) RETURNING `id`'
			).get(client_id, open_guild.id, now + DIRECT_JOIN_CHARITREE_LOCK) as { id: number };
			record_guild_activity({ guild_id: open_guild.id, event_type: 'joined', actor_client_id: client_id,
				source_key: `membership:${membership.id}:joined`, created_at: now });
			return { status: 'joined' as const, guild_id: open_guild.id };
		});

		const result = join_guild.immediate();
		if (result.status === 'affiliated')
			return { error_lang: 'MOD_MP_GUILD_AFFILIATION_EXISTS' };
		if (result.status === 'missing')
			return { error_lang: 'MOD_MP_GUILD_NOT_FOUND' };
		if (result.status === 'private')
			return { error_lang: 'MOD_MP_GUILD_JOIN_FORBIDDEN' };

		await ensure_guild_campaign(result.guild_id);
		return { success: true, guild: await get_guild_summary(result.guild_id) };
	}

	session_post_route('/api/guilds/join', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = json.guild_id;
		if (typeof guild_id !== 'number' || !Number.isSafeInteger(guild_id) || guild_id < 1)
			return 400; // Bad Request
		return join_open_guild(client_id, guild_id);
	});

	session_post_route('/api/guilds/join-free', async (req, url, client_id): Promise<HandlerResult> => {
		return join_open_guild(client_id, null);
	});

	session_post_route('/api/guilds/withdraw', async (req, url, client_id): Promise<HandlerResult> => {
		const result = await db_run('DELETE FROM `guild_applications` WHERE `client_id` = ?', [client_id]);
		return result.changes === 1
			? { success: true }
			: { error_lang: 'MOD_MP_GUILD_APPLICATION_MISSING' };
	});

	session_post_route('/api/guilds/application/decide', async (req, url, client_id, json): Promise<HandlerResult> => {
		const application_id = json.application_id;
		const approve = json.approve;
		if (typeof application_id !== 'number' || !Number.isSafeInteger(application_id) || typeof approve !== 'boolean')
			return 400; // Bad Request

		const decide_application = db.transaction(() => {
			const membership = db.query(
				'SELECT m.`guild_id`, g.`type` FROM `guild_memberships` AS m ' +
				'JOIN `guilds` AS g ON g.`id` = m.`guild_id` WHERE m.`client_id` = ? LIMIT 1'
			).get(client_id) as db_row.guild_memberships;
			if (membership === null)
				return 'forbidden';

			const application = db.query(
				'DELETE FROM `guild_applications` WHERE `id` = ? AND `guild_id` = ? RETURNING `client_id`'
			).get(application_id, membership.guild_id) as { client_id: number } | null;
			if (application === null)
				return 'missing';

			if (approve) {
				const inserted = db.query(
					'INSERT INTO `guild_memberships` (`client_id`, `guild_id`) VALUES(?, ?) RETURNING `id`'
				).get(application.client_id, membership.guild_id) as { id: number };
				record_guild_activity({ guild_id: membership.guild_id, event_type: 'joined',
					actor_client_id: application.client_id, source_key: `membership:${inserted.id}:joined` });
			}

			return application.client_id;
		});

		const applicant_id = decide_application.immediate();
		if (applicant_id === 'forbidden')
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (applicant_id === 'missing')
			return { error_lang: 'MOD_MP_GUILD_APPLICATION_MISSING' };

		if (approve) {
			const guild_id = await get_client_guild_id(applicant_id);
			if (guild_id !== null)
				await resize_unprogressed_campaign(guild_id);
		}

		return {
			success: true,
			approved: approve,
			applicant: await get_client_display(applicant_id)
		};
	});

	session_post_route('/api/guilds/leave', async (req, url, client_id): Promise<HandlerResult> => {
		const current_guild_id = await get_client_guild_id(client_id);
		if (await has_guild_departure_blocker(client_id))
			return { error_lang: 'MOD_MP_GUILD_DEPARTURE_BLOCKED' };

		const leave_guild = db.transaction(() => {
			const membership = db.query(
				'SELECT m.`guild_id`, g.`type` FROM `guild_memberships` AS m ' +
				'JOIN `guilds` AS g ON g.`id` = m.`guild_id` WHERE m.`client_id` = ? LIMIT 1'
			).get(client_id) as (db_row.guild_memberships & { type: GuildType }) | null;
			if (membership === null)
				return 'missing';

			const blocker = db.query(
				'SELECT ' +
				'EXISTS(SELECT 1 FROM `market_items` WHERE `client_id` = ?) OR ' +
				'EXISTS(SELECT 1 FROM `gifts` WHERE `client_id` = ? OR (`sender_id` = ? AND (`flags` & ?) = 0)) OR ' +
				'EXISTS(SELECT 1 FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?) OR ' +
				'EXISTS(SELECT 1 FROM `resolved_trade_offers` WHERE `client_id` = ?) AS `blocked`'
			).get(client_id, client_id, client_id, GiftFlags.Returned, client_id, client_id, client_id) as { blocked: number };
			if (blocker.blocked === 1)
				return 'blocked';

			record_guild_activity({ guild_id: membership.guild_id, event_type: 'left', actor_client_id: client_id,
				source_key: `membership:${membership.id}:left` });
			db.query('DELETE FROM `guild_memberships` WHERE `client_id` = ?').run(client_id);
			const remaining = db.query(
				'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `guild_id` = ?'
			).get(membership.guild_id) as { count: number };
			if (remaining.count === 0 && membership.type !== FREE_FELLOWSHIP_TYPE)
				db.query('DELETE FROM `guilds` WHERE `id` = ?').run(membership.guild_id);

			return remaining.count === 0 && membership.type !== FREE_FELLOWSHIP_TYPE ? 'dissolved' : 'left';
		});

		const result = leave_guild.immediate();
		if (result === 'missing')
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };
		if (result === 'blocked')
			return { error_lang: 'MOD_MP_GUILD_DEPARTURE_BLOCKED' };

		if (result === 'dissolved' && current_guild_id !== null)
			forget_guild_campaign(current_guild_id);
		else if (result === 'left' && current_guild_id !== null)
			await resize_unprogressed_campaign(current_guild_id);

		return { success: true, dissolved: result === 'dissolved' };
	});
}
