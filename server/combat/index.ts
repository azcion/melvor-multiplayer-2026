import { start_combat_service } from './service';
import { read_combat_key } from './tickets';
const key = read_combat_key();
if (!key) throw new Error('Combat requires a valid COMBAT_TICKET_KEY_FILE (64–128 hex characters).');
const port = Number(process.env.COMBAT_PORT ?? 3002);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid COMBAT_PORT');
const service = start_combat_service({ key, port, authority_url: process.env.COMBAT_AUTHORITY_URL,
	origins: process.env.COMBAT_ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) });
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { service.stop(); process.exit(0); });
