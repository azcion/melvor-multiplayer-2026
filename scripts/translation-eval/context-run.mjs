// Fixed synthetic corpus only. No worker, database, history, Pi or arbitrary-text inputs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { prepare, decode, echo, completion_content, model } from './context.mjs';
import { context_corpus } from './context-corpus.mjs';
import { build, restore, structural_record } from './adapter.mjs';
import { source_hashes, parts_text } from './source.mjs';
const args = process.argv.slice(2);
const live = args.includes('--live');
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = option('--output', 'test-results/translation-context.json');
const repeats = Number(option('--repeats', '1'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw Error('Repeats must be 1..3');
if (args.some((arg, i) => !['--live', '--output', '--repeats'].includes(arg) && !['--output', '--repeats'].includes(args[i - 1]))) throw Error('Unknown option');
const files = ['context.mjs', 'context-corpus.mjs', 'corpus.mjs', 'adapter.mjs', 'context-run.mjs', 'source.mjs'];
const harness_hashes = Object.fromEntries(await Promise.all(files.map(async file => [file,
	createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex')])));
let openai_key, azure_key;
if (live) {
	// Only dedicated API credentials; never use Codex/ChatGPT authentication material.
	openai_key = process.env.OPENAI_API_KEY?.trim() ?? (process.env.OPENAI_API_KEY_FILE ?
		(await readFile(process.env.OPENAI_API_KEY_FILE, 'utf8')).trim() : '');
	if (!openai_key) throw Error('OpenAI API credential unavailable; no requests sent');
	azure_key = (await readFile(process.env.AZURE_TRANSLATOR_KEY_FILE ?? new URL('../../config/azure-translator.key', import.meta.url), 'utf8')).trim();
	if (!azure_key) throw Error('Azure credential unavailable; no requests sent');
}
const report = { date: new Date().toISOString(), mode: live ? 'paired-live' : 'offline-plumbing', source_hashes, harness_hashes,
	protocol: { model, targets: ['en', 'zh-Hans'], repeats, interval_ms: 1000, timeout_ms: 10000, retries: 0,
		synthetic_only: true, semantic_scoring: 'explicit review only', live_credentials: live ? 'configured' : 'not used' }, results: [] };
await mkdir(dirname(output), { recursive: true });
let next_start = 0;
async function request(url, headers, body) {
	await delay(Math.max(0, next_start - Date.now()));
	next_start = Date.now() + 1000;
	const start = performance.now();
	const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
		body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
	if (!response.ok) throw Error(`Provider HTTP ${response.status}`);
	let bytes = 0, chunks = [];
	for await (const chunk of response.body) {
		bytes += chunk.byteLength;
		if (bytes > 100000) { await response.body.cancel().catch(() => {}); throw Error('Oversized envelope'); }
		chunks.push(Buffer.from(chunk));
	}
	return { envelope: JSON.parse(Buffer.concat(chunks).toString('utf8')), request_ms: performance.now() - start };
}
for (let repeat = 1; repeat <= repeats; repeat++) for (const fixture of context_corpus) {
	for (const arm of repeat % 2 ? ['N', 'C'] : ['C', 'N']) {
		const prepared = prepare(fixture.parts), document = build(fixture.parts, 'N');
		const input = arm === 'C' ? prepared.request : document.use_html ? document.html : document.plain;
		const row = { case: fixture.id, categories: fixture.categories, meaning: fixture.meaning ?? null, arm, repeat, input, targets: [] };
		try {
			if (arm === 'C') {
				let raw;
				if (live) {
					const response = await request('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${openai_key}` }, input);
					row.request_ms = response.request_ms;
					row.provider_model = response.envelope.model;
					row.usage = response.envelope.usage;
					row.completion = response.envelope.choices;
					raw = completion_content(response.envelope);
				} else raw = echo(prepared);
				row.raw = raw;
				row.detected = raw.detected;
				try { row.targets = decode(prepared, raw); }
				catch { row.structure_error = 'invalid_context_result'; row.raw_semantic = { status: 'unreviewed', failures: [], note: '' }; }
			} else {
				let raw;
				if (live) {
					const url = new URL('/translate', process.env.AZURE_TRANSLATOR_ENDPOINT ?? 'https://api.cognitive.microsofttranslator.com');
					if (url.protocol !== 'https:') throw Error('HTTPS required');
					url.searchParams.set('api-version', '3.0');
					if (document.use_html) url.searchParams.set('textType', 'html');
					for (const target of report.protocol.targets) url.searchParams.append('to', target);
					const response = await request(url, { 'Ocp-Apim-Subscription-Key': azure_key,
						'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION ?? 'northeurope' }, [{ Text: input }]);
					row.request_ms = response.request_ms;
					if (!Array.isArray(response.envelope) || response.envelope.length !== 1) throw Error('Invalid envelope');
					raw = response.envelope[0];
				} else raw = { detectedLanguage: { language: 'en' }, translations: ['en', 'zh-Hans'].map(to => ({ to, text: input })) };
				row.raw = raw;
				if (typeof raw.detectedLanguage?.language !== 'string' || !Array.isArray(raw.translations) || raw.translations.length !== 2 ||
					new Set(raw.translations.map(t => t.to)).size !== 2 || raw.translations.some(t => !report.protocol.targets.includes(t.to) || typeof t.text !== 'string')) throw Error('Invalid detection/targets');
				row.detected = raw.detectedLanguage.language;
				row.input_characters = [...input].length;
				for (const translation of raw.translations) {
					const target = { language: translation.to, production_omits_source: translation.to === row.detected,
						semantic: { status: 'unreviewed', failures: [], note: '' } };
					try {
						target.parts = restore(document, translation.text, translation.to, row.detected);
						target.text = parts_text(target.parts);
						target.structure = structural_record(document, target.parts, translation.to, row.detected);
					} catch { target.structure = { accepted: false }; }
					row.targets.push(target);
				}
			}
		} catch (error) {
			row.error = error.name === 'TimeoutError' ? 'request_timeout' : /^Provider HTTP [0-9]+$/.test(error.message) ? error.message : 'request_or_response_failed';
		}
		report.results.push(row);
		await writeFile(output, JSON.stringify(report, null, 2) + '\n');
		console.log(`${fixture.id} ${arm} repeat=${repeat}: ${row.error ?? row.structure_error ?? 'recorded; semantics unreviewed'}`);
		if (row.error) process.exit(1);
	}
}
console.log(`Saved ${report.results.length} observations (${report.mode}); no automatic semantic passes.`);
