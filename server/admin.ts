import { revoke_installation } from './installations';
import { db, get_service_setting } from './db';
import {
	ICON_CATALOG_SETTING_KEYS,
	MAX_ICON_CATALOG_BYTES,
	MAX_ICON_CATALOG_ICON_BYTES,
	MAX_ICON_CATALOG_MANIFEST_COUNT,
	MAX_ICON_CATALOG_OBSERVATIONS
} from './icon-catalog';

type AdminOutput = {
	log: (message: string) => void;
	error: (message: string) => void;
};

const console_output: AdminOutput = {
	log: message => console.log(message),
	error: message => console.error(message)
};

const MAX_GUILD_DIAGNOSTIC_MEMBERS = 512;
const MAX_GUILD_DIAGNOSTIC_CONTRIBUTIONS = 512;
const MAX_GUILD_DIAGNOSTIC_ACTIVITY = 20;

function usage(output: AdminOutput): number {
	output.error(`Usage:
  bun run admin.ts status
  bun run admin.ts registrations open|close
  bun run admin.ts maintenance on|off
  bun run admin.ts icon-collection on|off
  bun run admin.ts icon-collection-limit icon-bytes|manifest-items|catalog-bytes|observations VALUE
  bun run admin.ts release-version VERSION|clear
  bun run admin.ts installation revoke CLIENT_ID INSTALLATION_ID
  bun run admin.ts guild inspect GUILD_ID
  bun run admin.ts identity find DISPLAY_NAME
  bun run admin.ts identity inspect CLIENT_ID
  bun run admin.ts identity enable|disable CLIENT_ID
  bun run admin.ts charity reset CLIENT_ID
  bun run admin.ts charity reset-all`);
	return 2;
}

function parse_positive_integer(value: string | undefined): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function parse_icon_collection_limit(kind: string | undefined, value: string | undefined): {
	key: string;
	value: number;
} | null {
	const maximums: Record<string, { key: string; maximum: number }> = {
		'icon-bytes': { key: ICON_CATALOG_SETTING_KEYS.max_icon_bytes, maximum: MAX_ICON_CATALOG_ICON_BYTES },
		'manifest-items': { key: ICON_CATALOG_SETTING_KEYS.max_manifest_items, maximum: MAX_ICON_CATALOG_MANIFEST_COUNT },
		'catalog-bytes': { key: ICON_CATALOG_SETTING_KEYS.max_catalog_bytes, maximum: MAX_ICON_CATALOG_BYTES },
		observations: { key: ICON_CATALOG_SETTING_KEYS.max_observations, maximum: MAX_ICON_CATALOG_OBSERVATIONS }
	};
	const definition = maximums[kind ?? ''];
	const parsed = Number(value);
	if (definition === undefined || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > definition.maximum)
		return null;
	return { key: definition.key, value: parsed };
}

function set_setting(key: string, value: string): void {
	db.query('UPDATE `service_settings` SET `value` = ? WHERE `key` = ?').run(value, key);
}

function is_release_version(value: string | undefined): value is string {
	return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value) && value.length <= 64;
}

function parse_stored_json(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

function inspect_guild(guild_id: number, output: AdminOutput): number {
	const guild = db.query<{
		id: number;
		name: string;
		icon_id: string;
		type: string;
		charitree_enabled: number;
	}, [number]>(
		'SELECT `id`, `name`, `icon_id`, `type`, `charitree_enabled` FROM `guilds` WHERE `id` = ? LIMIT 1'
	).get(guild_id);
	if (guild === null) {
		output.error(`Guild ${guild_id} does not exist.`);
		return 1;
	}

	const members = db.query<{
		membership_id: number;
		client_id: number;
		display_name: string;
		disabled: number;
		deleted_at: number | null;
		last_multiplayer_active_at: number;
		mod_version: string | null;
		active_mods: string | null;
		game_mode_id: string | null;
		language: string | null;
		reported_at: number | null;
	}, [number, number]>(
		'SELECT m.`id` AS `membership_id`, c.`id` AS `client_id`, c.`display_name`, c.`disabled`, c.`deleted_at`, ' +
		'c.`last_multiplayer_active_at`, runtime.`mod_version`, runtime.`active_mods`, runtime.`game_mode_id`, ' +
		'runtime.`language`, runtime.`reported_at` FROM `guild_memberships` AS m ' +
		'JOIN `clients` AS c ON c.`id` = m.`client_id` ' +
		'LEFT JOIN `client_runtime_snapshots` AS runtime ON runtime.`client_id` = c.`id` ' +
		'WHERE m.`guild_id` = ? ORDER BY m.`id` LIMIT ?'
	).all(guild_id, MAX_GUILD_DIAGNOSTIC_MEMBERS).map(member => ({
		membership_id: member.membership_id,
		client_id: member.client_id,
		display_name: member.display_name,
		disabled: member.disabled === 1,
		deleted: member.deleted_at !== null,
		last_multiplayer_active_at: member.last_multiplayer_active_at,
		runtime: member.mod_version === null ? null : {
			mod_version: member.mod_version,
			active_mods: member.active_mods === null ? null : parse_stored_json(member.active_mods),
			game_mode_id: member.game_mode_id,
			language: member.language,
			reported_at: member.reported_at
		}
	}));

	const campaign = db.query<{
		id: number;
		campaign_id: string;
		item_id: string;
		item_amount: number;
		item_current: number;
		required_contributors: number;
		auto_contribution: number;
		campaign_next: number;
		complete: number;
	}, [number]>(
		'SELECT `id`, `campaign_id`, `item_id`, `item_amount`, `item_current`, `required_contributors`, ' +
		'`auto_contribution`, `campaign_next`, `complete` FROM `campaign_state` ' +
		'WHERE `guild_id` = ? ORDER BY `id` DESC LIMIT 1'
	).get(guild_id);
	const contributions = campaign === null ? [] : db.query<{
		client_id: number;
		display_name: string;
		item_amount: number;
		taken: number;
	}, [number, number]>(
		'SELECT contribution.`client_id`, client.`display_name`, contribution.`item_amount`, contribution.`taken` ' +
		'FROM `campaign_contributions` AS contribution JOIN `clients` AS client ON client.`id` = contribution.`client_id` ' +
		'WHERE contribution.`campaign_id` = ? ORDER BY contribution.`client_id` LIMIT ?'
	).all(campaign.id, MAX_GUILD_DIAGNOSTIC_CONTRIBUTIONS);

	const activity = db.query<{
		id: number;
		event_type: string;
		actor_client_id: number | null;
		actor_display_name: string | null;
		metadata: string;
		created_at: number;
		buyer_client_id: number | null;
		buyer_display_name: string | null;
		seller_client_id: number | null;
		seller_display_name: string | null;
		item_id: string | null;
		quantity: number | null;
	}, [number, number]>(
		'SELECT `id`, `event_type`, `actor_client_id`, `actor_display_name`, `metadata`, `created_at`, ' +
		'`buyer_client_id`, `buyer_display_name`, `seller_client_id`, `seller_display_name`, `item_id`, `quantity` ' +
		'FROM `guild_activity_events` WHERE `guild_id` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT ?'
	).all(guild_id, MAX_GUILD_DIAGNOSTIC_ACTIVITY).map(event => ({
		id: event.id,
		event_type: event.event_type,
		actor_client_id: event.actor_client_id,
		actor_display_name: event.actor_display_name,
		metadata: parse_stored_json(event.metadata),
		created_at: event.created_at,
		buyer_client_id: event.buyer_client_id,
		buyer_display_name: event.buyer_display_name,
		seller_client_id: event.seller_client_id,
		seller_display_name: event.seller_display_name,
		item_id: event.item_id,
		quantity: event.quantity
	}));

	output.log(`guild_id=${guild.id}`);
	output.log(`name=${JSON.stringify(guild.name)}`);
	output.log(`type=${guild.type}`);
	output.log(`icon_id=${JSON.stringify(guild.icon_id)}`);
	output.log(`charitree_enabled=${guild.charitree_enabled === 1 ? 'yes' : 'no'}`);
	output.log(`members=${JSON.stringify(members)}`);
	output.log(`latest_campaign=${campaign === null ? 'none' : JSON.stringify(campaign)}`);
	output.log(`campaign_contributions=${JSON.stringify(contributions)}`);
	output.log(`recent_activity=${JSON.stringify(activity)}`);
	return 0;
}

function find_identities(display_name: string, output: AdminOutput): number {
	const identities = db.query<{
		id: number;
		display_name: string;
		guild_id: number | null;
		guild_name: string | null;
	}, [string]>(
		'SELECT c.`id`, c.`display_name`, m.`guild_id`, g.`name` AS `guild_name` ' +
		'FROM `clients` AS c ' +
		'LEFT JOIN `guild_memberships` AS m ON m.`client_id` = c.`id` ' +
		'LEFT JOIN `guilds` AS g ON g.`id` = m.`guild_id` ' +
		'WHERE c.`display_name` = ? ORDER BY c.`id` LIMIT 32'
	).all(display_name);
	output.log(`identities=${JSON.stringify(identities.map(identity => ({
		id: identity.id,
		display_name: identity.display_name,
		guild_id: identity.guild_id,
		guild_name: identity.guild_name
	})))}`);
	return 0;
}

function reset_charity_timers(client_id: number, output: AdminOutput): number {
	const result = db.transaction(() => {
		const identity = db.query<{
			id: number;
			display_name: string;
			last_charity: number;
			last_bonus_charity: number;
			charitree_take_available_at: number | null;
		}, [number]>(
			'SELECT c.`id`, c.`display_name`, c.`last_charity`, c.`last_bonus_charity`, ' +
			'm.`charitree_take_available_at` ' +
			'FROM `clients` AS c LEFT JOIN `guild_memberships` AS m ON m.`client_id` = c.`id` ' +
			'WHERE c.`id` = ? LIMIT 1'
		).get(client_id);
		if (identity === null)
			return null;

		db.query('UPDATE `clients` SET `last_charity` = 0, `last_bonus_charity` = 0 WHERE `id` = ?').run(client_id);
		db.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = 0 WHERE `client_id` = ?').run(client_id);
		return identity;
	}).immediate();

	if (result === null) {
		output.error(`Multiplayer identity ${client_id} does not exist.`);
		return 1;
	}

	output.log(`identity_id=${result.id}`);
	output.log(`display_name=${JSON.stringify(result.display_name)}`);
	output.log(`previous_last_charity=${result.last_charity}`);
	output.log(`previous_last_bonus_charity=${result.last_bonus_charity}`);
	output.log(`previous_charitree_take_available_at=${result.charitree_take_available_at ?? 'none'}`);
	output.log('last_charity=0');
	output.log('last_bonus_charity=0');
	output.log('charitree_take_available_at=0');
	return 0;
}

function reset_all_charity_timers(output: AdminOutput): number {
	const result = db.transaction(() => {
		const client_count = db.query<{ count: number }, []>(
			' SELECT COUNT(*) AS `count` FROM `clients`'
		).get()?.count ?? 0;
		const membership_count = db.query<{ count: number }, []>(
			' SELECT COUNT(*) AS `count` FROM `guild_memberships`'
		).get()?.count ?? 0;

		db.query('UPDATE `clients` SET `last_charity` = 0, `last_bonus_charity` = 0').run();
		db.query('UPDATE `guild_memberships` SET `charitree_take_available_at` = 0').run();
		return { client_count, membership_count };
	}).immediate();

	output.log(`charity_clients_reset=${result.client_count}`);
	output.log(`charity_memberships_reset=${result.membership_count}`);
	return 0;
}

export function run_admin(args: string[], output: AdminOutput = console_output): number {
	const [command, action, argument] = args;

	switch (command) {
		case 'status': {
			if (args.length !== 1)
				return usage(output);

			const identity_count = db.query<{ count: number }, []>(
				'SELECT COUNT(*) AS `count` FROM `clients`'
			).get()?.count ?? 0;
			const disabled_count = db.query<{ count: number }, []>(
				'SELECT COUNT(*) AS `count` FROM `clients` WHERE `disabled` = 1'
			).get()?.count ?? 0;

			output.log(`registrations=${get_service_setting('registrations_open') === '1' ? 'open' : 'closed'}`);
			output.log(`maintenance=${get_service_setting('maintenance') === '1' ? 'on' : 'off'}`);
			output.log(`icon_collection=${get_service_setting('icon_collection_enabled') === '1' ? 'on' : 'off'}`);
			output.log(`icon_collection_max_icon_bytes=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_icon_bytes)}`);
			output.log(`icon_collection_max_manifest_items=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_manifest_items)}`);
			output.log(`icon_collection_max_catalog_bytes=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_catalog_bytes)}`);
			output.log(`icon_collection_max_observations=${get_service_setting(ICON_CATALOG_SETTING_KEYS.max_observations)}`);
			output.log(`released_mod_version=${get_service_setting('released_mod_version') || 'none'}`);
			output.log(`identities=${identity_count}`);
			output.log(`disabled_identities=${disabled_count}`);
			return 0;
		}
		case 'installation': {
			const client_id = parse_positive_integer(argument);
			if (action !== 'revoke' || args.length !== 4 || client_id === null) return usage(output);
			if (!revoke_installation(client_id, args[3]!)) { output.error('Installation not found.'); return 1; }
			output.log('Installation revoked. Other installation credentials remain valid.');
			return 0;
		}
		case 'registrations':
			if (args.length !== 2 || (action !== 'open' && action !== 'close'))
				return usage(output);
			set_setting('registrations_open', action === 'open' ? '1' : '0');
			output.log(`Registrations ${action}.`);
			return 0;
		case 'maintenance':
			if (args.length !== 2 || (action !== 'on' && action !== 'off'))
				return usage(output);
			set_setting('maintenance', action === 'on' ? '1' : '0');
			output.log(`Maintenance mode ${action}.`);
			return 0;
		case 'icon-collection':
			if (args.length !== 2 || (action !== 'on' && action !== 'off'))
				return usage(output);
			set_setting('icon_collection_enabled', action === 'on' ? '1' : '0');
			output.log(`Icon collection ${action}.`);
			return 0;
		case 'icon-collection-limit': {
			if (args.length !== 3)
				return usage(output);
			const limit = parse_icon_collection_limit(action, argument);
			if (limit === null)
				return usage(output);
			set_setting(limit.key, String(limit.value));
			output.log(`Icon collection ${action} limit set to ${limit.value}.`);
			return 0;
		}
		case 'release-version':
			if (args.length !== 2 || (action !== 'clear' && !is_release_version(action)))
				return usage(output);
			set_setting('released_mod_version', action === 'clear' ? '' : action);
			output.log(action === 'clear'
				? 'Released mod version cleared.'
				: `Released mod version set to ${action}.`);
			return 0;
		case 'guild': {
			if (action !== 'inspect' || args.length !== 3)
				return usage(output);
			const guild_id = parse_positive_integer(argument);
			return guild_id === null ? usage(output) : inspect_guild(guild_id, output);
		}
		case 'charity': {
			if (action === 'reset-all' && args.length === 2)
				return reset_all_charity_timers(output);
			if (action !== 'reset' || args.length !== 3)
				return usage(output);
			const client_id = parse_positive_integer(argument);
			return client_id === null ? usage(output) : reset_charity_timers(client_id, output);
		}
		case 'identity': {
			if (args.length !== 3 || !['find', 'inspect', 'enable', 'disable'].includes(action ?? ''))
				return usage(output);

			if (action === 'find') {
				if (typeof argument !== 'string' || argument.length === 0 || argument.length > 20)
					return usage(output);
				return find_identities(argument, output);
			}

			const client_id = parse_positive_integer(argument);
			if (client_id === null)
				return usage(output);

			if (action === 'inspect') {
				const identity = db.query<{
					id: number;
					display_name: string;
					disabled: number;
					deleted_at: number | null;
					last_multiplayer_active_at: number;
					melvor_account_id: number | null;
					manual_melvor_account_link: number;
					session_count: number;
					guild_id: number | null;
					guild_name: string | null;
					guild_type: string | null;
				}, [number]>(
					'SELECT c.`id`, c.`display_name`, c.`disabled`, c.`deleted_at`, ' +
					'c.`last_multiplayer_active_at`, c.`melvor_account_id`, c.`manual_melvor_account_link`, ' +
					'(SELECT COUNT(*) FROM `client_sessions` AS s WHERE s.`client_id` = c.`id`) AS `session_count`, ' +
					'm.`guild_id`, g.`name` AS `guild_name`, g.`type` AS `guild_type` ' +
					'FROM `clients` AS c ' +
					'LEFT JOIN `guild_memberships` AS m ON m.`client_id` = c.`id` ' +
					'LEFT JOIN `guilds` AS g ON g.`id` = m.`guild_id` ' +
					'WHERE c.`id` = ? LIMIT 1'
				).get(client_id);
				if (identity === null) {
					output.error(`Multiplayer identity ${client_id} does not exist.`);
					return 1;
				}

				output.log(`identity_id=${identity.id}`);
				const installations = db.query(`SELECT i.installation_id, i.device_diagnostics, i.mod_version,
					first_seen_at, last_seen_at, c.revoked_at, (c.credential_hash IS NOT NULL) AS credential_enrolled
					FROM client_installations i LEFT JOIN installation_credentials c
					ON c.client_id=i.client_id AND c.installation_id=i.installation_id WHERE i.client_id = ?
					ORDER BY last_seen_at DESC LIMIT 32`).all(client_id);
				output.log(`installations=${JSON.stringify(installations)}`);
				const credential_installations = db.query(`SELECT installation_id, revoked_at FROM installation_credentials
					WHERE client_id = ? LIMIT 32`).all(client_id);
				output.log(`credential_installations=${JSON.stringify(credential_installations)}`);
				output.log(`display_name=${JSON.stringify(identity.display_name)}`);
				output.log(`disabled=${identity.disabled === 1 ? 'yes' : 'no'}`);
				output.log(`deleted=${identity.deleted_at === null ? 'no' : 'yes'}`);
				output.log(`active_sessions=${identity.session_count}`);
				output.log(`last_multiplayer_active_at=${identity.last_multiplayer_active_at}`);
				output.log(`melvor_account_linked=${identity.melvor_account_id === null ? 'no' : 'yes'}`);
				output.log(`manual_account_link=${identity.manual_melvor_account_link === 1 ? 'yes' : 'no'}`);
				output.log(`guild_id=${identity.guild_id ?? 'none'}`);
				output.log(`guild_name=${identity.guild_name === null ? 'none' : JSON.stringify(identity.guild_name)}`);
				output.log(`guild_type=${identity.guild_type ?? 'none'}`);
				return 0;
			}

			const result = db.transaction(() => {
				const updated = db.query('UPDATE `clients` SET `disabled` = ? WHERE `id` = ?')
					.run(action === 'disable' ? 1 : 0, client_id);
				if (action === 'disable')
					db.query('DELETE FROM `client_sessions` WHERE `client_id` = ?').run(client_id);
				return updated.changes;
			}).immediate();

			if (result !== 1) {
				output.error(`Multiplayer identity ${client_id} does not exist.`);
				return 1;
			}

			output.log(`Multiplayer identity ${client_id} ${action}d.`);
			return 0;
		}
		default:
			return usage(output);
	}
}

if (import.meta.main) {
	process.exitCode = run_admin(Bun.argv.slice(2));
	db.close();
}
