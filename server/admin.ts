import { db, get_service_setting } from './db';

type AdminOutput = {
	log: (message: string) => void;
	error: (message: string) => void;
};

const console_output: AdminOutput = {
	log: message => console.log(message),
	error: message => console.error(message)
};

function usage(output: AdminOutput): number {
	output.error(`Usage:
  bun run admin.ts status
  bun run admin.ts registrations open|close
  bun run admin.ts maintenance on|off
  bun run admin.ts release-version VERSION|clear
  bun run admin.ts identity inspect CLIENT_ID
  bun run admin.ts identity enable|disable CLIENT_ID`);
	return 2;
}

function parse_positive_integer(value: string | undefined): number | null {
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}

function set_setting(key: string, value: string): void {
	db.query('UPDATE `service_settings` SET `value` = ? WHERE `key` = ?').run(value, key);
}

function is_release_version(value: string | undefined): value is string {
	return typeof value === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(value) && value.length <= 64;
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
			output.log(`released_mod_version=${get_service_setting('released_mod_version') || 'none'}`);
			output.log(`identities=${identity_count}`);
			output.log(`disabled_identities=${disabled_count}`);
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
		case 'release-version':
			if (args.length !== 2 || (action !== 'clear' && !is_release_version(action)))
				return usage(output);
			set_setting('released_mod_version', action === 'clear' ? '' : action);
			output.log(action === 'clear'
				? 'Released mod version cleared.'
				: `Released mod version set to ${action}.`);
			return 0;
		case 'identity': {
			if (args.length !== 3 || !['inspect', 'enable', 'disable'].includes(action ?? ''))
				return usage(output);
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
