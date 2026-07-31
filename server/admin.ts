import { db, get_service_setting } from './db';

function usage(): never {
	console.error(`Usage:
  bun run admin.ts status
  bun run admin.ts registrations open|close
  bun run admin.ts maintenance on|off
  bun run admin.ts identity enable|disable CLIENT_ID
  bun run admin.ts capacity MAX_IDENTITIES`);
	process.exit(2);
}

function parse_positive_integer(value: string | undefined): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		usage();
	return parsed;
}

function set_setting(key: string, value: string): void {
	db.query('UPDATE `service_settings` SET `value` = ? WHERE `key` = ?').run(value, key);
}

const [command, action, argument] = Bun.argv.slice(2);

switch (command) {
	case 'status': {
		if (action !== undefined)
			usage();

		const identity_count = db.query<{ count: number }, []>(
			'SELECT COUNT(*) AS `count` FROM `clients`'
		).get()?.count ?? 0;
		const disabled_count = db.query<{ count: number }, []>(
			'SELECT COUNT(*) AS `count` FROM `clients` WHERE `disabled` = 1'
		).get()?.count ?? 0;

		console.log(`registrations=${get_service_setting('registrations_open') === '1' ? 'open' : 'closed'}`);
		console.log(`maintenance=${get_service_setting('maintenance') === '1' ? 'on' : 'off'}`);
		console.log(`identities=${identity_count}/${get_service_setting('max_identities')}`);
		console.log(`disabled_identities=${disabled_count}`);
		break;
	}
	case 'registrations':
		if (argument !== undefined || (action !== 'open' && action !== 'close'))
			usage();
		set_setting('registrations_open', action === 'open' ? '1' : '0');
		console.log(`Registrations ${action}.`);
		break;
	case 'maintenance':
		if (argument !== undefined || (action !== 'on' && action !== 'off'))
			usage();
		set_setting('maintenance', action === 'on' ? '1' : '0');
		console.log(`Maintenance mode ${action}.`);
		break;
	case 'identity': {
		if (action !== 'enable' && action !== 'disable')
			usage();
		const client_id = parse_positive_integer(argument);
		const result = db.transaction(() => {
			const updated = db.query('UPDATE `clients` SET `disabled` = ? WHERE `id` = ?')
				.run(action === 'disable' ? 1 : 0, client_id);
			if (action === 'disable')
				db.query('DELETE FROM `client_sessions` WHERE `client_id` = ?').run(client_id);
			return updated.changes;
		}).immediate();

		if (result !== 1) {
			console.error(`Multiplayer identity ${client_id} does not exist.`);
			process.exitCode = 1;
			break;
		}

		console.log(`Multiplayer identity ${client_id} ${action}d.`);
		break;
	}
	case 'capacity':
		if (argument !== undefined)
			usage();
		set_setting('max_identities', String(parse_positive_integer(action)));
		console.log(`Identity capacity set to ${action}.`);
		break;
	default:
		usage();
}

db.close();
