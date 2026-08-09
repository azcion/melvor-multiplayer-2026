import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOG_DIRECTORY = process.env.FILE_OPERATIONAL_LOGS === '1'
	? process.env.LOG_DIR
	: undefined;
const RETENTION_DAYS = 7;
let current_day = '';
const pending_lines = new Map<string, string[]>();
let flush_timer: ReturnType<typeof setTimeout> | null = null;
let flush_in_flight: Promise<void> | null = null;

async function flush_pending_logs(): Promise<void> {
	flush_timer = null;
	const batches = [...pending_lines.entries()];
	pending_lines.clear();
	for (const [path, lines] of batches) {
		try {
			await appendFile(path, lines.join(''), { encoding: 'utf8', mode: 0o600 });
		} catch (error) {
			console.error('Failed to write the operational log', error);
		}
	}
}

function schedule_log_flush(): void {
	if (flush_timer !== null || flush_in_flight !== null)
		return;
	flush_timer = setTimeout(() => {
		flush_in_flight = flush_pending_logs().finally(() => {
			flush_in_flight = null;
			if (pending_lines.size > 0)
				schedule_log_flush();
		});
	}, 100);
}

export async function flush_logs(): Promise<void> {
	if (flush_timer !== null) {
		clearTimeout(flush_timer);
		flush_timer = null;
	}
	if (flush_in_flight !== null)
		await flush_in_flight;
	if (pending_lines.size > 0)
		await flush_pending_logs();
}

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
		const day = timestamp.slice(0, 10);
		if (day !== current_day) {
			mkdirSync(LOG_DIRECTORY, { recursive: true, mode: 0o700 });
			prune_logs(day);
			current_day = day;
		}
		const path = join(LOG_DIRECTORY, `server-${day}.log`);
		const lines = pending_lines.get(path) ?? [];
		lines.push(`${line}\n`);
		pending_lines.set(path, lines);
		schedule_log_flush();
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
