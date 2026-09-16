import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ChatTranslationWorker } from '../../chat_translation';

function translation_database(): Database {
	const database = new Database(':memory:', { strict: true });
	database.run(`
		CREATE TABLE chat_message_bodies (job_id INTEGER PRIMARY KEY, parts TEXT, translations TEXT);
		CREATE TABLE chat_translation_jobs (
			id INTEGER PRIMARY KEY,
			content TEXT NOT NULL,
			detected_language TEXT,
			state TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			enqueued_at INTEGER NOT NULL,
			available_at INTEGER NOT NULL,
			last_attempt_at INTEGER,
			completed_at INTEGER,
			last_error_code TEXT
		);
		CREATE TABLE chat_message_translations (
			job_id INTEGER NOT NULL,
			language TEXT NOT NULL,
			content TEXT NOT NULL,
			translated_at INTEGER NOT NULL,
			PRIMARY KEY (job_id, language)
		);
		CREATE TABLE poll_translation_jobs (
			id INTEGER PRIMARY KEY,
			content TEXT NOT NULL,
			detected_language TEXT,
			state TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			enqueued_at INTEGER NOT NULL,
			available_at INTEGER NOT NULL,
			last_attempt_at INTEGER,
			completed_at INTEGER,
			last_error_code TEXT
		);
		CREATE TABLE poll_translations (
			job_id INTEGER NOT NULL,
			language TEXT NOT NULL,
			content TEXT NOT NULL,
			translated_at INTEGER NOT NULL,
			PRIMARY KEY (job_id, language)
		);
	`);
	return database;
}

function inert_timer() {
	return 1 as unknown as ReturnType<typeof setTimeout>;
}

describe('Chat translation worker', () => {
	test('shares the worker rate boundary with isolated Poll translation jobs', async () => {
		const database = translation_database();
		database.run("INSERT INTO poll_translation_jobs VALUES (1, 'Poll question', NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)");
		const worker = new ChatTranslationWorker({
			key: 'test-key', region: 'northeurope', database, now: () => 1_000,
			set_timer: inert_timer,
			fetcher: async () => Response.json([{ detectedLanguage: { language: 'en' }, translations: [
				{ to: 'en', text: 'Poll question' }, { to: 'zh-Hans', text: '投票问题' }
			] }])
		});
		worker.start();
		await worker.run_once();
		expect(database.query('SELECT state, detected_language FROM poll_translation_jobs').get()).toEqual({
			state: 'complete', detected_language: 'en'
		});
		expect(database.query('SELECT language, content FROM poll_translations').all()).toEqual([
			{ language: 'zh-CN', content: '投票问题' }
		]);
		expect(database.query('SELECT * FROM chat_message_translations').all()).toEqual([]);
	});

	test('auto-detects once, requests both presets, and omits the detected source translation', async () => {
		const database = translation_database();
		database.run("INSERT INTO chat_translation_jobs VALUES (1, 'Hello', NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)");
		const requests: Request[] = [];
		const worker = new ChatTranslationWorker({
			key: 'test-key', region: 'northeurope', database, now: () => 1_000,
			set_timer: inert_timer,
			fetcher: async (input, init) => {
				requests.push(input instanceof Request ? new Request(input, init) : new Request(input.toString(), init));
				return Response.json([{ detectedLanguage: { language: 'en', score: 1 }, translations: [
					{ text: 'Hello', to: 'en' }, { text: '你好', to: 'zh-Hans' }
				] }]);
			}
		});
		worker.start();
		await worker.run_once();

		const request = requests[0]!;
		expect(request.url).toContain('api-version=3.0');
		expect(new URL(request.url).searchParams.getAll('to')).toEqual(['en', 'zh-Hans']);
		expect(request.headers.get('Ocp-Apim-Subscription-Region')).toBe('northeurope');
		expect(await request.json()).toEqual([{ Text: 'Hello' }]);
		expect(database.query('SELECT state, attempts, detected_language FROM chat_translation_jobs').get()).toEqual({
			state: 'complete', attempts: 1, detected_language: 'en'
		});
		expect(database.query('SELECT language, content FROM chat_message_translations').all()).toEqual([
			{ language: 'zh-CN', content: '你好' }
		]);
		worker.stop();
		database.close();
	});

	test('honors Azure retry timing and dead-letters after the fourth failure', async () => {
		const database = translation_database();
		database.run("INSERT INTO chat_translation_jobs VALUES (1, 'Hello', NULL, 'queued', 0, 0, 0, NULL, NULL, NULL)");
		let now = 0;
		const worker = new ChatTranslationWorker({
			key: 'test-key', database, now: () => now, set_timer: inert_timer,
			fetcher: async () => new Response('', { status: 429, headers: { 'Retry-After': '3' } })
		});
		worker.start();
		for (let attempt = 1; attempt <= 4; attempt++) {
			await worker.run_once();
			const job = database.query<{ state: string; attempts: number; available_at: number }, []>(
				'SELECT state, attempts, available_at FROM chat_translation_jobs'
			).get()!;
			expect(job.attempts).toBe(attempt);
			expect(job.state).toBe(attempt === 4 ? 'dead' : 'queued');
			expect(job.available_at).toBe(now + 3_000);
			now = job.available_at;
		}
		worker.stop();
		database.close();
	});

	test('times out a stalled request and returns the job to the retry queue', async () => {
		const database = translation_database();
		database.run("INSERT INTO chat_translation_jobs VALUES (1, 'Hello', NULL, 'queued', 0, 0, 0, NULL, NULL, NULL)");
		const worker = new ChatTranslationWorker({
			key: 'test-key', database, now: () => 0, set_timer: inert_timer, request_timeout_ms: 1,
			fetcher: async (input, init) => new Promise((resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
			})
		});
		worker.start();
		await worker.run_once();

		expect(database.query('SELECT state, attempts, last_error_code FROM chat_translation_jobs').get()).toEqual({
			state: 'queued', attempts: 1, last_error_code: 'request_timeout'
		});
		worker.stop();
		database.close();
	});
});

describe('Structured item translations', () => {
	test('persists reconstructed tags and legacy text in one job', async () => {
		const database = translation_database();
		database.run("INSERT INTO chat_translation_jobs VALUES (1, 'Use [Bronze Sword]', NULL, 'queued', 0, 0, 0, NULL, NULL, NULL)");
		const parts = [{ type: 'text', text: 'Use ' }, { type: 'item', item_id: 'melvorD:Bronze_Sword' }];
		database.query('INSERT INTO chat_message_bodies (job_id, parts) VALUES (1, ?)').run(JSON.stringify(parts));
		const worker = new ChatTranslationWorker({ key: 'test', database, set_timer: inert_timer,
			fetcher: async (input, init) => {
				expect(String(input)).toContain('textType=html');
				expect(JSON.parse(String(init?.body))).toEqual([{ Text: 'Use <span translate="no">0</span>' }]);
				return Response.json([{ detectedLanguage: { language: 'en' }, translations: [
					{ to: 'zh-Hans', text: '使用<span translate="no">0</span>' }
				] }]);
			} });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT content FROM chat_message_translations').get()).toEqual({ content: '使用[Bronze Sword]' });
		const body = database.query<{ translations: string }, []>('SELECT translations FROM chat_message_bodies').get()!;
		expect(JSON.parse(body.translations)['zh-CN']).toEqual([{ type: 'text', text: '使用' }, parts[1]]);
		database.close();
	});
	test('does not publish damaged tags and skips Azure entirely for item-only messages', async () => {
		const database = translation_database();
		database.run("INSERT INTO chat_translation_jobs VALUES (1, 'Use sword', NULL, 'queued', 0, 0, 0, NULL, NULL, NULL)");
		const item = { type: 'item', item_id: 'melvorD:Bronze_Sword' };
		database.query('INSERT INTO chat_message_bodies (job_id, parts) VALUES (1, ?)').run(JSON.stringify([{ type: 'text', text: 'Use ' }, item]));
		let requests = 0;
		const worker = new ChatTranslationWorker({ key: 'test', database, set_timer: inert_timer,
			fetcher: async () => { requests++; return Response.json([{ detectedLanguage: { language: 'en' },
				translations: [{ to: 'zh-Hans', text: '使用' }] }]); } });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT state FROM chat_translation_jobs').get()).toEqual({ state: 'queued' });
		expect(database.query('SELECT * FROM chat_message_translations').all()).toEqual([]);
		database.query('UPDATE chat_message_bodies SET parts = ?').run(JSON.stringify([item]));
		database.run('UPDATE chat_translation_jobs SET available_at = 0');
		const worker2 = new ChatTranslationWorker({ key: 'test', database, set_timer: inert_timer,
			fetcher: async () => { requests++; throw Error('must not translate'); } });
		worker2.start(); await worker2.run_once(); worker2.stop();
		expect(requests).toBe(1);
		expect(database.query('SELECT state FROM chat_translation_jobs').get()).toEqual({ state: 'complete' });
		database.close();
	});
});
