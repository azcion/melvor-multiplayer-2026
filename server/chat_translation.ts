import { attach_chat_parts, translation_html, translated_parts, parts_text, type ChatPart } from './chat_parts';
import { readFileSync } from 'node:fs';
import type { Database } from 'bun:sqlite';
import { db } from './db';
import { report_error, write_log } from './log';

export const CHAT_TRANSLATION_LANGUAGES = ['en', 'zh-CN'] as const;
export const CHAT_TRANSLATION_REQUEST_INTERVAL_MS = 1_000;
export const CHAT_TRANSLATION_REQUEST_TIMEOUT_MS = 10_000;
export const CHAT_TRANSLATION_MAX_ATTEMPTS = 4;
export const CHAT_TRANSLATION_PENDING_MS = 10_000;

type ChatTranslationLanguage = typeof CHAT_TRANSLATION_LANGUAGES[number];
type TranslationJob = { id: number; content: string; attempts: number; available_at: number };
type AzureTranslationResponse = Array<{
	detectedLanguage?: { language?: string };
	translations?: Array<{ text?: string; to?: string }>;
}>;

const azure_language: Record<ChatTranslationLanguage, string> = { en: 'en', 'zh-CN': 'zh-Hans' };
const client_language: Record<string, ChatTranslationLanguage | undefined> = { en: 'en', 'zh-Hans': 'zh-CN' };

function read_key(path: string | undefined): string | null {
	if (!path)
		return null;
	try {
		const key = readFileSync(path, 'utf8').trim();
		return key.length > 0 ? key : null;
	} catch (error) {
		if ((error as { code?: string }).code !== 'ENOENT')
			report_error('Azure Translator key could not be read', error);
		return null;
	}
}

export type ChatTranslationWorkerOptions = {
	key?: string | null;
	region?: string;
	endpoint?: string;
	fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	now?: () => number;
	set_timer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	clear_timer?: (timer: ReturnType<typeof setTimeout>) => void;
	request_timeout_ms?: number;
	database?: Database;
};

export class ChatTranslationWorker {
	private readonly key: string | null;
	private readonly region: string;
	private readonly endpoint: string;
	private readonly fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	private readonly now: () => number;
	private readonly set_timer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	private readonly clear_timer: (timer: ReturnType<typeof setTimeout>) => void;
	private readonly request_timeout_ms: number;
	private readonly database: Database;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private running = false;
	private stopped = true;
	private next_request_at = 0;

	constructor(options: ChatTranslationWorkerOptions = {}) {
		this.key = options.key === undefined
			? read_key(process.env.AZURE_TRANSLATOR_KEY_FILE ?? '/app/config/azure-translator.key')
			: options.key;
		this.region = options.region ?? process.env.AZURE_TRANSLATOR_REGION ?? 'northeurope';
		this.endpoint = options.endpoint ?? process.env.AZURE_TRANSLATOR_ENDPOINT ??
			'https://api.cognitive.microsofttranslator.com';
		this.fetcher = options.fetcher ?? fetch;
		this.now = options.now ?? Date.now;
		this.set_timer = options.set_timer ?? setTimeout;
		this.clear_timer = options.clear_timer ?? clearTimeout;
		this.request_timeout_ms = options.request_timeout_ms ?? CHAT_TRANSLATION_REQUEST_TIMEOUT_MS;
		this.database = options.database ?? db;
	}

	start(): void {
		if (!this.key) {
			write_log('info', 'Azure Translator is disabled because no key is configured');
			return;
		}
		this.stopped = false;
		this.database.query("UPDATE `chat_translation_jobs` SET `state` = 'queued' WHERE `state` = 'processing'").run();
		this.schedule(0);
	}

	stop(): void {
		this.stopped = true;
		if (this.timer !== null)
			this.clear_timer(this.timer);
		this.timer = null;
	}

	wake(): void {
		if (!this.stopped && !this.running)
			this.schedule(0);
	}

	private schedule(delay: number): void {
		if (this.stopped)
			return;
		if (this.timer !== null)
			this.clear_timer(this.timer);
		this.timer = this.set_timer(() => {
			this.timer = null;
			void this.run_once();
		}, Math.max(0, delay));
	}

	private next_job(): TranslationJob | null {
		return this.database.query<TranslationJob, []>(
			"SELECT `id`, `content`, `attempts`, `available_at` FROM `chat_translation_jobs` " +
			"WHERE `state` = 'queued' ORDER BY `id` LIMIT 1"
		).get();
	}

	async run_once(): Promise<void> {
		if (this.stopped || this.running || !this.key)
			return;
		const job = this.next_job();
		if (!job)
			return;
		const started_at = this.now();
		const wait = Math.max(job.available_at, this.next_request_at) - started_at;
		if (wait > 0) {
			this.schedule(wait);
			return;
		}
		this.running = true;
		this.next_request_at = started_at + CHAT_TRANSLATION_REQUEST_INTERVAL_MS;
		this.database.query("UPDATE `chat_translation_jobs` SET `state` = 'processing', `attempts` = `attempts` + 1, " +
			'`last_attempt_at` = ? WHERE `id` = ?').run(started_at, job.id);
		try {
			const body = this.database.query<{ parts: string }, [number]>('SELECT parts FROM chat_message_bodies WHERE job_id = ?').get(job.id);
			const parts = body ? JSON.parse(body.parts) as ChatPart[] : undefined;
			const result = parts && !parts.some(part => part.type === 'text' && /[\p{L}\p{N}]/u.test(part.text))
				? { detected_language: 'und', translations: [] } : await this.translate(job.content, parts);
			const completed_at = this.now();
			this.database.transaction(() => {
				for (const translation of result.translations)
					this.database.query('INSERT INTO `chat_message_translations` (`job_id`, `language`, `content`, `translated_at`) ' +
						'VALUES (?, ?, ?, ?) ON CONFLICT (`job_id`, `language`) DO UPDATE SET ' +
						'`content` = excluded.`content`, `translated_at` = excluded.`translated_at`')
						.run(job.id, translation.language, translation.content, completed_at);
				if (parts) this.database.query('UPDATE chat_message_bodies SET translations = ? WHERE job_id = ?')
					.run(JSON.stringify(Object.fromEntries(result.translations.map(translation => [translation.language, translation.parts]))), job.id);
				this.database.query("UPDATE `chat_translation_jobs` SET `state` = 'complete', `detected_language` = ?, " +
					'`completed_at` = ?, `last_error_code` = NULL WHERE `id` = ?')
					.run(result.detected_language, completed_at, job.id);
			}).immediate();
		} catch (error) {
			const failure = error as { retry_after_ms?: number; code?: string };
			const attempts = job.attempts + 1;
			const dead = attempts >= CHAT_TRANSLATION_MAX_ATTEMPTS;
			const retry_after_ms = Math.max(1_000, failure.retry_after_ms ?? 2 ** attempts * 1_000);
			const available_at = this.now() + retry_after_ms;
			if (failure.retry_after_ms !== undefined)
				this.next_request_at = Math.max(this.next_request_at, available_at);
			this.database.query("UPDATE `chat_translation_jobs` SET `state` = ?, `available_at` = ?, `last_error_code` = ? " +
				'WHERE `id` = ?').run(dead ? 'dead' : 'queued', available_at,
				failure.code ?? 'request_failed', job.id);
			write_log('error', `message=${JSON.stringify('Azure Translator request failed')} ` +
				`job_id=${job.id} code=${JSON.stringify(failure.code ?? 'request_failed')} attempt=${attempts}`);
		} finally {
			this.running = false;
			const next = this.next_job();
			if (next)
				this.schedule(Math.max(0, Math.max(next.available_at, this.next_request_at) - this.now()));
		}
	}

	private async translate(content: string, parts?: ChatPart[]): Promise<{
		detected_language: string;
		translations: Array<{ language: ChatTranslationLanguage; content: string; parts?: ChatPart[] }>;
	}> {
		const url = new URL('/translate', this.endpoint);
		url.searchParams.set('api-version', '3.0');
		if (parts) url.searchParams.set('textType', 'html');
		for (const language of CHAT_TRANSLATION_LANGUAGES)
			url.searchParams.append('to', azure_language[language]);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.request_timeout_ms);
		let response: Response;
		try {
			response = await this.fetcher(url, {
				method: 'POST',
				headers: {
					'Ocp-Apim-Subscription-Key': this.key as string,
					'Ocp-Apim-Subscription-Region': this.region,
					'Content-Type': 'application/json; charset=UTF-8'
				},
				body: JSON.stringify([{ Text: parts ? translation_html(parts) : content }]),
				signal: controller.signal
			});
		} catch (error) {
			if (controller.signal.aborted)
				throw { code: 'request_timeout' };
			throw error;
		} finally {
			clearTimeout(timeout);
		}
		if (!response.ok) {
			const retry_seconds = Number(response.headers.get('Retry-After'));
			const retry_ms = Number(response.headers.get('x-ms-retry-after-ms'));
			throw {
				code: `http_${response.status}`,
				...(Number.isFinite(retry_ms) && retry_ms > 0 ? { retry_after_ms: retry_ms } :
					Number.isFinite(retry_seconds) && retry_seconds > 0 ? { retry_after_ms: retry_seconds * 1_000 } : {})
			};
		}
		const body = await response.json() as AzureTranslationResponse;
		const result = body[0];
		const detected_language = result?.detectedLanguage?.language;
		if (typeof detected_language !== 'string' || !Array.isArray(result?.translations))
			throw { code: 'invalid_response' };
		const detected_client_language = client_language[detected_language];
		const translations = result.translations.flatMap(translation => {
			const language = typeof translation.to === 'string' ? client_language[translation.to] : undefined;
			if (!language || language === detected_client_language || typeof translation.text !== 'string' || !translation.text.length) return [];
			const translated = parts ? translated_parts(translation.text, parts) : undefined;
			return [{ language, content: translated ? parts_text(translated) : translation.text, ...(translated ? { parts: translated } : {}) }];
		});
		return { detected_language, translations };
	}
}

export function attach_translations<T extends { message_id: number; sender_id?: number | null }>(
	source_kind: string,
	viewer_id: number,
	messages: T[]
): Array<T & { translations: Partial<Record<ChatTranslationLanguage, string>>; translation_status: string;
	translation_enqueued_at: number | null; parts?: ChatPart[]; translation_parts?: Record<string, ChatPart[]> }> {
	if (messages.length === 0)
		return [];
	const placeholders = messages.map(() => '?').join(', ');
	const jobs = db.query<{ id: number; message_id: number; state: string; enqueued_at: number }, Array<string | number>>(
		'SELECT `id`, `message_id`, `state`, `enqueued_at` FROM `chat_translation_jobs` ' +
		`WHERE \`source_kind\` = ? AND \`message_id\` IN (${placeholders})`
	).all(source_kind, ...messages.map(message => message.message_id));
	const by_message = new Map(jobs.map(job => [job.message_id, job]));
	const translations = jobs.length === 0 ? [] : db.query<{
		job_id: number; language: ChatTranslationLanguage; content: string
	}, number[]>(
		`SELECT \`job_id\`, \`language\`, \`content\` FROM \`chat_message_translations\` ` +
		`WHERE \`job_id\` IN (${jobs.map(() => '?').join(', ')})`
	).all(...jobs.map(job => job.id));
	const by_job = new Map<number, Partial<Record<ChatTranslationLanguage, string>>>();
	for (const translation of translations)
		by_job.set(translation.job_id,
			{ ...(by_job.get(translation.job_id) ?? {}), [translation.language]: translation.content });
	const bodies = jobs.length === 0 ? [] : db.query<{ job_id: number; translations: string }, number[]>(
		`SELECT job_id, translations FROM chat_message_bodies WHERE job_id IN (${jobs.map(() => '?').join(',')})`
	).all(...jobs.map(job => job.id));
	const body_by_job = new Map(bodies.map(body => [body.job_id, JSON.parse(body.translations) as Record<string, ChatPart[]>]));
	return attach_chat_parts(source_kind, messages).map(message => {
		const job = by_message.get(message.message_id);
		return {
			...message,
			...(job && body_by_job.has(job.id) && message.sender_id !== viewer_id ? { translation_parts: body_by_job.get(job.id)! } : {}),
			translations: message.sender_id === viewer_id || !job ? {} : by_job.get(job.id) ?? {},
			translation_status: message.sender_id === viewer_id ? 'original' : job?.state ?? 'unavailable',
			translation_enqueued_at: job?.enqueued_at ?? null
		};
	});
}

export const chat_translation_worker = new ChatTranslationWorker();
