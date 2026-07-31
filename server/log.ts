import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const LOG_DIRECTORY = process.env.FILE_OPERATIONAL_LOGS === '1'
	? process.env.LOG_DIR
	: undefined;
const RETENTION_DAYS = 7;
let current_day = '';

function prune_logs(today: string): void {
	if (LOG_DIRECTORY === undefined)
		return;

	const cutoff = new Date(`${today}T00:00:00.000Z`);
	cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1));

	for (const filename of readdirSync(LOG_DIRECTORY)) {
		const match = /^server-(\d{4}-\d{2}-\d{2})\.log$/.exec(filename);
		if (match !== null && new Date(`${match[1]}T00:00:00.000Z`) < cutoff)
			rmSync(join(LOG_DIRECTORY, filename));
	}
}

export function write_log(level: 'info' | 'error', message: string): void {
	const now = new Date();
	const timestamp = now.toISOString();
	const line = `time=${timestamp} level=${level} ${message}`;

	if (LOG_DIRECTORY === undefined) {
		if (level === 'error')
			console.error(line);
		else
			console.log(line);
		return;
	}

	try {
		mkdirSync(LOG_DIRECTORY, { recursive: true, mode: 0o700 });
		const day = timestamp.slice(0, 10);
		if (day !== current_day) {
			prune_logs(day);
			current_day = day;
		}
		appendFileSync(join(LOG_DIRECTORY, `server-${day}.log`), `${line}\n`, {
			encoding: 'utf8',
			mode: 0o600
		});
	} catch (error) {
		console.error('Failed to write the operational log', error);
	}
}

export function report_error(message: string, error?: unknown): void {
	if (error === undefined) {
		write_log('error', `message=${JSON.stringify(message)}`);
		return;
	}

	if (error instanceof Error) {
		write_log('error', `message=${JSON.stringify(message)} error=${JSON.stringify({
			name: error.name,
			message: error.message,
			stack: error.stack?.split('\n')
		})}`);
		return;
	}

	write_log('error', `message=${JSON.stringify(message)} error=${JSON.stringify(String(error))}`);
}
