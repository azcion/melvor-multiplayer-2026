import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { translation_document, translated_parts, parts_text, type ChatPart } from '../../chat_parts';
import { ChatTranslationWorker } from '../../chat_translation';
import { chinese_term_ranges } from '../../translation_terms';

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
		CREATE TABLE update_section_translations (
			id INTEGER PRIMARY KEY,
			source_content TEXT NOT NULL,
			content TEXT,
			language TEXT NOT NULL,
			detected_language TEXT,
			state TEXT NOT NULL,
			attempts INTEGER NOT NULL,
			enqueued_at INTEGER NOT NULL,
			available_at INTEGER NOT NULL,
			last_attempt_at INTEGER,
			completed_at INTEGER,
			last_error_code TEXT
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

	test('stores Updates translations in their dedicated table', async () => {
		const database = translation_database();
		database.run("INSERT INTO update_section_translations VALUES (1, 'Dev note', NULL, 'zh-CN', NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)");
		const worker = new ChatTranslationWorker({
			key: 'test-key', region: 'northeurope', database, now: () => 1_000,
			set_timer: inert_timer,
			fetcher: async () => Response.json([{ detectedLanguage: { language: 'en' }, translations: [
				{ to: 'en', text: 'Dev note' }, { to: 'zh-Hans', text: '开发者说明' }
			] }])
		});
		worker.start();
		await worker.run_once();
		expect(database.query(
			'SELECT content, state, detected_language, attempts FROM update_section_translations'
		).get()).toEqual({ content: '开发者说明', state: 'complete', detected_language: 'en', attempts: 1 });
		expect(database.query('SELECT * FROM chat_message_translations').all()).toEqual([]);
		expect(database.query('SELECT * FROM poll_translations').all()).toEqual([]);
		worker.stop();
		database.close();
	});

	test('preserves symbol-only Updates content without calling Azure', async () => {
		const database = translation_database();
		database.run("INSERT INTO update_section_translations VALUES (1, '🍋', NULL, 'zh-CN', NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)");
		const worker = new ChatTranslationWorker({
			key: 'test-key', database, now: () => 1_000, set_timer: inert_timer,
			fetcher: async () => { throw Error('must not translate'); }
		});
		worker.start();
		await worker.run_once();
		expect(database.query('SELECT content, state, detected_language FROM update_section_translations').get())
			.toEqual({ content: '🍋', state: 'complete', detected_language: 'und' });
		worker.stop();
		database.close();
	});

	test('does not publish an Updates translation after its source changes', async () => {
		const database = translation_database();
		database.run("INSERT INTO update_section_translations VALUES (1, 'Old note', NULL, 'zh-CN', NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)");
		const worker = new ChatTranslationWorker({
			key: 'test-key', database, now: () => 1_000, set_timer: inert_timer,
			fetcher: async () => {
				database.run("UPDATE update_section_translations SET source_content = 'New note', content = NULL, " +
					"state = 'queued', attempts = 0 WHERE id = 1");
				return Response.json([{ detectedLanguage: { language: 'en' }, translations: [
					{ to: 'zh-Hans', text: '旧说明' }
				] }]);
			}
		});
		worker.start();
		await worker.run_once();
		expect(database.query(
			'SELECT source_content, content, state, attempts FROM update_section_translations'
		).get()).toEqual({ source_content: 'New note', content: null, state: 'queued', attempts: 0 });
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


describe('terminology worker transport', () => {
	test.each(['en', 'zh-Hans'])('keeps multiline list transport auto-detected from %s', async detected => {
		const database = translation_database();
		const content = 'Installed mods:\n- add items\n- GOD MODE';
		database.query("INSERT INTO chat_translation_jobs VALUES (1, ?, NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)").run(content);
		const doc = translation_document([{ type: 'text', text: content }]);
		const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
			fetcher: async (input, init) => {
				const url = new URL(input.toString());
				expect(url.searchParams.has('from')).toBe(false);
				expect(url.searchParams.getAll('to')).toEqual(['en', 'zh-Hans']);
				expect(url.searchParams.get('textType')).toBe('html');
				expect(JSON.parse(init!.body as string)).toEqual([{ Text: doc.html }]);
				return Response.json([{ detectedLanguage: { language: detected }, translations: [
					{ to: 'en', text: doc.html }, { to: 'zh-Hans', text: doc.html }
				] }]);
			} });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT state, detected_language FROM chat_translation_jobs').get())
			.toEqual({ state: 'complete', detected_language: detected });
		expect(database.query('SELECT language, content FROM chat_message_translations').all())
			.toEqual([{ language: detected === 'en' ? 'zh-CN' : 'en', content }]);
		database.close();
	});
	test.each(['en', 'zh-Hans'])('persists exact list bodies after provider separator loss or movement (%s)', async detected => {
		for (const body of ['\nAdd Items\nGod Mode', '\r\n  - add items\r\n  * GOD MODE']) {
			for (const moved of [false, true]) {
				const database = translation_database();
				const content = 'Please check.\nInstalled mods:' + body + '\n\nThanks.';
				database.query("INSERT INTO chat_translation_jobs VALUES (1, ?, NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)").run(content);
				const expected = (moved ? '\n' : '') + '检查。模组：' + body + '谢谢。';
				const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
					fetcher: async (input, init) => {
						const url = new URL(input.toString());
						expect(url.searchParams.has('from')).toBe(false);
						expect(url.searchParams.getAll('to')).toEqual(['en', 'zh-Hans']);
						const sent = JSON.parse(init!.body as string)[0].Text as string;
						expect(sent).toBe('Please check.\nInstalled mods:<span translate="no">0</span>\n\nThanks.');
						const output = (moved ? '\n' : '') + sent.replace(/\r?\n/g, '')
							.replace('Please check.', '检查。').replace('Installed mods:', '模组：').replace('Thanks.', '谢谢。');
						return Response.json([{ detectedLanguage: { language: detected }, translations: [
							{ to: 'en', text: output }, { to: 'zh-Hans', text: output }
						] }]);
					} });
				worker.start(); await worker.run_once(); worker.stop();
				expect(database.query('SELECT state, detected_language FROM chat_translation_jobs').get())
					.toEqual({ state: 'complete', detected_language: detected });
				expect(database.query('SELECT language, content FROM chat_message_translations').all())
					.toEqual([{ language: detected === 'en' ? 'zh-CN' : 'en', content: expected }]);
				expect(database.query('SELECT * FROM chat_message_bodies').all()).toEqual([]);
				database.close();
			}
		}
	});
	test('keeps ordinary moderator prose on the plain transport', async () => {
		const database = translation_database();
		const content = 'The moderator lets me add items to the shopping list';
		database.query("INSERT INTO chat_translation_jobs VALUES (1, ?, NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)").run(content);
		const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
			fetcher: async (input, init) => {
				expect(new URL(input.toString()).searchParams.has('textType')).toBe(false);
				expect(JSON.parse(init!.body as string)).toEqual([{ Text: content }]);
				return Response.json([{ detectedLanguage: { language: 'en' }, translations: [{ to: 'zh-Hans', text: '普通句子' }] }]);
			} });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT state FROM chat_translation_jobs').get()).toEqual({ state: 'complete' });
		database.close();
	});
	test.each([false, true])('protects text without adding public part kinds (structured=%s)', async structured => {
		const database = translation_database();
		const parts: ChatPart[] = [{ type: 'text', text: 'Use dev.console for 850m GP at ' },
			{ type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' },
			{ type: 'text', text: ' with ' }, { type: 'item', item_id: 'melvorD:Bank_Slot_Token' }];
		const content = structured ? parts_text(parts) : 'Use dev.console for 850m GP.';
		database.query("INSERT INTO chat_translation_jobs VALUES (1, ?, NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)").run(content);
		if (structured) database.query("INSERT INTO chat_message_bodies VALUES (1, ?, NULL)").run(JSON.stringify(parts));
		const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
			fetcher: async (input, init) => {
				const url = new URL(input.toString());
				expect(url.searchParams.get('textType')).toBe('html');
				expect(url.searchParams.has('from')).toBe(false);
				const doc = translation_document(structured ? parts : [{ type: 'text', text: content }]);
				expect(JSON.parse(init!.body as string)).toEqual([{ Text: doc.html }]);
				return Response.json([{ detectedLanguage: { language: 'en' }, translations: [
					{ to: 'zh-Hans', text: '使用 ' + doc.markers.map((_, i) => `<span translate="no">${i}</span>`).join('，') }
				] }]);
			} });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT state FROM chat_translation_jobs').get()).toEqual({ state: 'complete' });
		expect(database.query('SELECT content FROM chat_message_translations').get()).toEqual({
			content: structured ? '使用 dev.console，850m GP，$Marketplace，[Bank Slot Token]' : '使用 dev.console，850m GP'
		});
		const body = database.query<{ translations: string }, []>('SELECT translations FROM chat_message_bodies').get();
		if (structured) {
			const translated = JSON.parse(body!.translations)['zh-CN'] as ChatPart[];
			expect(translated.filter(part => part.type !== 'text')).toEqual(parts.filter(part => part.type !== 'text'));
		} else expect(body).toBeNull();
		database.close();
	});
	test('rejects missing protected text markers through the existing retry contract', async () => {
		const database = translation_database();
		database.run("INSERT INTO chat_translation_jobs VALUES (1, 'Use dev.Console.', NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)");
		const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
			fetcher: async () => Response.json([{ detectedLanguage: { language: 'en' }, translations: [{ to: 'zh-Hans', text: '使用控制台。' }] }]) });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT state, attempts, last_error_code FROM chat_translation_jobs').get()).toEqual({
			state: 'queued', attempts: 1, last_error_code: 'invalid_translation_markers'
		});
		expect(database.query('SELECT * FROM chat_message_translations').all()).toEqual([]);
		database.close();
	});
	test('restores source spelling when Chinese is detected and English is requested', async () => {
		const database = translation_database();
		database.run("INSERT INTO chat_translation_jobs VALUES (1, '启用 dev.console，花 100k gp。', NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)");
		const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
			fetcher: async () => Response.json([{ detectedLanguage: { language: 'zh-Hans' }, translations: [{ to: 'en',
				text: 'Enable <span translate="no">0</span>, spend <span translate="no">1</span>.' }] }]) });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT language, content FROM chat_message_translations').get()).toEqual({
			language: 'en', content: 'Enable dev.console, spend 100k gp.'
		});
		database.close();
	});
});

describe('glossary source detection and persistence', () => {
	test.each([
		['Buy 2 Bank Slot Tokens; do not sell the last bank slot token.', ['Bank Slot Tokens', 'bank slot token']],
		['Guild members and group member may vote.', ['members', 'member']],
		['Members of our Guild and members in this group may vote.', ['Members', 'members']],
		['Only members who joined Free Fellowship at least 20 hours ago may vote.', ['members', 'Free Fellowship']],
		['The Guild discussed VIP members, subscription members and paid members of our Guild.', []],
		['Members must renew; the Guild has a subscription. Group. Members wait.', []],
		['Financial banks issue tokens; slot machines accept tokens.', []],
		['Bank Slot Tokenizer and Bank Slot TokensExtra are identifiers; guild membership matters.', []],
		['Guild\nmembers wait. Members of\na group wait.', []],
		['Guild non-members and members-only discounts are unrelated.', []]
	] as Array<[string, string[]]>)('recognizes only scoped noun phrases: %s', (text, expected) => {
		expect(chinese_term_ranges(text).map(range => text.slice(range.start, range.end))).toEqual(expected);
	});

	test('reconstructs terminology beside exact amounts, mod titles/list bodies and native typed links', () => {
		const text = 'Installed Mods:\r\n  - God Mode\r\n  - Add Items\r\n\r\n' +
			'Guild members must not sell 2 Bank Slot Tokens for 80k GP with the Multitasking mod. ' +
			'Keep 1,000 GP, 2.5mSC and 3b AP; VIP members wait. Open ';
		const parts: ChatPart[] = [{ type: 'text', text }, { type: 'item', item_id: 'melvorD:Bank_Slot_Token' },
			{ type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' }];
		const doc = translation_document(parts);
		const restored = translated_parts(doc.html, parts, doc.chinese_markers);
		expect(parts_text(restored)).toBe(text.replace('Guild members', 'Guild 成员')
			.replace('Bank Slot Tokens', '仓库栏位代币') + '[Bank Slot Token]$Marketplace');
		expect(restored.filter(part => part.type !== 'text')).toEqual(parts.filter(part => part.type !== 'text'));
		expect(parts_text(translated_parts(doc.html, parts, doc.markers))).toBe(parts_text(parts));
		for (const broken of [doc.html.replace('<span translate="no">0</span>', ''),
			doc.html + '<span translate="no">0</span>'])
			expect(() => translated_parts(broken, parts, doc.chinese_markers)).toThrow();
	});

	for (const structured of [false, true]) test.each(['en', 'zh-Hans', 'fr'])(
		`persists scoped terminology only for English source (structured=${structured}, detected=%s)`, async detected => {
		const database = translation_database();
		const text = 'Only members who joined our Guild at least 20 hours ago may vote; ' +
			'newer Guild members cannot vote. Do not sell 2 Bank Slot Tokens for 175k GP each. VIP members wait.';
		const translated = text.replace('members who', '成员 who').replace('Guild members', 'Guild 成员')
			.replace('Bank Slot Tokens', '仓库栏位代币');
		const parts: ChatPart[] = [{ type: 'text', text },
			...(structured ? [{ type: 'item', item_id: 'melvorD:Bank_Slot_Token' } as ChatPart] : [])];
		const content = parts_text(parts);
		database.query("INSERT INTO chat_translation_jobs VALUES (1, ?, NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)").run(content);
		if (structured) database.query('INSERT INTO chat_message_bodies VALUES (1, ?, NULL)').run(JSON.stringify(parts));
		const doc = translation_document(parts);
		const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
			fetcher: async (input, init) => {
				expect(new URL(input.toString()).searchParams.get('textType')).toBe('html');
				expect(JSON.parse(init!.body as string)).toEqual([{ Text: doc.html }]);
				// Source echo verifies transport/persistence, not Azure sentence meaning.
				return Response.json([{ detectedLanguage: { language: detected }, translations: [
					{ to: 'en', text: doc.html }, { to: 'zh-Hans', text: doc.html }
				] }]);
			} });
		worker.start(); await worker.run_once(); worker.stop();
		expect(database.query('SELECT state, attempts FROM chat_translation_jobs').get())
			.toEqual({ state: 'complete', attempts: 1 });
		expect(database.query('SELECT language, content FROM chat_message_translations ORDER BY language').all()).toEqual([
			...(detected !== 'en' ? [{ language: 'en', content }] : []),
			...(detected !== 'zh-Hans' ? [{ language: 'zh-CN', content: detected === 'en' ?
				translated + (structured ? '[Bank Slot Token]' : '') : content }] : [])
		]);
		if (structured) {
			const body = database.query<{ translations: string }, []>('SELECT translations FROM chat_message_bodies').get()!;
			for (const restored of Object.values(JSON.parse(body.translations)) as ChatPart[][])
				expect(restored.filter(part => part.type !== 'text')).toEqual(parts.filter(part => part.type !== 'text'));
		}
		database.close();
	});

	test.each(['en', 'zh-Hans', 'fr'])('uses Chinese labels only for detected English (%s)', async detected => {
		const database = translation_database();
		const parts: ChatPart[] = [{ type: 'text', text: 'Crucible page, Crucible tab, Crucible feature; Free Fellowship uses Guild Raid with 100k gp and dev.Console at ' },
			{ type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' },
			{ type: 'item', item_id: 'melvorD:Bank_Slot_Token' }];
		const content = parts_text(parts);
		database.query("INSERT INTO chat_translation_jobs VALUES (1, ?, NULL, 'queued', 0, 1000, 1000, NULL, NULL, NULL)").run(content);
		database.query('INSERT INTO chat_message_bodies VALUES (1, ?, NULL)').run(JSON.stringify(parts));
		const doc = translation_document(parts);
		expect(doc.html).toStartWith('<span translate="no">0</span> page, <span translate="no">1</span> tab, <span translate="no">2</span> feature; ');
		const worker = new ChatTranslationWorker({ key: 'test-key', database, now: () => 1000, set_timer: inert_timer,
			fetcher: async (input, init) => {
				const url = new URL(input.toString());
				expect(url.searchParams.has('from')).toBe(false);
				expect(url.searchParams.getAll('to')).toEqual(['en', 'zh-Hans']);
				expect(JSON.parse(init!.body as string)).toEqual([{ Text: doc.html }]);
				return Response.json([{ detectedLanguage: { language: detected }, translations: [
					{ to: 'en', text: doc.html }, { to: 'zh-Hans', text: doc.html }
				] }]);
			} });
		worker.start(); await worker.run_once(); worker.stop();
		const rows = database.query<{ language: string; content: string }, []>(
			'SELECT language, content FROM chat_message_translations ORDER BY language').all();
		expect(rows).toEqual([
			...(detected !== 'en' ? [{ language: 'en', content }] : []),
			...(detected !== 'zh-Hans' ? [{ language: 'zh-CN', content: detected === 'en' ?
				content.replaceAll('Crucible', '熔炉').replace('Free Fellowship', '自由同盟').replace('Guild Raid', '公会突袭') : content }] : [])
		]);
		expect(database.query('SELECT state, detected_language FROM chat_translation_jobs').get())
			.toEqual({ state: 'complete', detected_language: detected });
		const body = database.query<{ translations: string }, []>('SELECT translations FROM chat_message_bodies').get()!;
		for (const translated of Object.values(JSON.parse(body.translations)) as ChatPart[][])
			expect(translated.filter(part => part.type !== 'text')).toEqual(parts.filter(part => part.type !== 'text'));
		database.close();
	});
});
