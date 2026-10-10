// Opt-in synthetic-only Azure experiment. No worker, database, Pi, or arbitrary input path.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { corpus } from './corpus.mjs';
import { build, restore, structural_record } from './adapter.mjs';
import { parts_text, source_hashes } from './source.mjs';

const args = process.argv.slice(2);
const live = args.includes('--azure');
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index < 0 ? fallback : args[index + 1];
};
const selected = option('--cases', corpus.map(value => value.id).join(',')).split(',');
if (selected.some(id => !corpus.some(value => value.id === id))) throw Error('Unknown synthetic case');
const repeats = Number(option('--repeats', '1'));
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw Error('Repeats must be 1..3');
const output = option('--output', 'test-results/translation-eval.json');
const report = { date: new Date().toISOString(), source_hashes, mode: live ? 'azure' : 'offline',
	protocol: { targets: ['en', 'zh-Hans'], from: null, interval_ms: 1000, timeout_ms: 10000,
		retries: 0, repeats, synthetic_only: true }, results: [] };
let key;
if (live) key = (await readFile(process.env.AZURE_TRANSLATOR_KEY_FILE ??
	new URL('../../config/azure-translator.key', import.meta.url), 'utf8')).trim();
if (live && !key) throw Error('Missing Azure key');
let next_start = 0;
await mkdir(dirname(output), { recursive: true });
for (let repeat = 1; repeat <= repeats; repeat++) for (const fixture of corpus.filter(value => selected.includes(value.id))) {
	// Alternate order in repeat runs to reduce fixed order confounding.
	for (const arm of repeat % 2 ? ['N', 'H'] : ['H', 'N']) {
		const document = build(fixture.parts, arm);
		const input = document.use_html ? document.html : document.plain;
		const row = { case: fixture.id, arm, repeat, categories: fixture.categories, input,
			input_characters: [...input].length, exposed_amounts: [...document.amounts].map(id => document.markers[id].text),
			use_html: document.use_html, targets: [] };
		const started = Date.now();
		try {
			let result;
			if (live) {
				await delay(Math.max(0, next_start - Date.now()));
				next_start = Date.now() + 1000;
				const url = new URL('/translate', process.env.AZURE_TRANSLATOR_ENDPOINT ?? 'https://api.cognitive.microsofttranslator.com');
				if (url.protocol !== 'https:') throw Error('HTTPS endpoint required');
				url.searchParams.set('api-version', '3.0');
				if (document.use_html) url.searchParams.set('textType', 'html');
				for (const target of report.protocol.targets) url.searchParams.append('to', target);
				const response = await fetch(url, { method: 'POST', headers: {
					'Ocp-Apim-Subscription-Key': key,
					'Ocp-Apim-Subscription-Region': process.env.AZURE_TRANSLATOR_REGION ?? 'northeurope',
					'Content-Type': 'application/json; charset=UTF-8'
				}, body: JSON.stringify([{ Text: input }]), signal: AbortSignal.timeout(10000) });
				if (!response.ok) throw Error(`Azure HTTP ${response.status}`); // Never log provider error bodies/headers.
				const body = await response.text();
				if (body.length > 100000) throw Error('Oversized provider envelope');
				const envelope = JSON.parse(body);
				if (!Array.isArray(envelope) || envelope.length !== 1) throw Error('Invalid provider envelope');
				result = envelope[0];
			} else result = { detectedLanguage: { language: 'en' }, translations: ['en', 'zh-Hans'].map(to => ({ to, text: input })) };
			if (typeof result.detectedLanguage?.language !== 'string' || !Array.isArray(result.translations) ||
				result.translations.length !== 2 || new Set(result.translations.map(value => value.to)).size !== 2 ||
				result.translations.some(value => !report.protocol.targets.includes(value.to) || typeof value.text !== 'string'))
				throw Error('Invalid targets/detection');
			row.detected = result.detectedLanguage.language;
			for (const translation of result.translations) {
				const target = { language: translation.to, raw: translation.text,
					production_omits_source: translation.to === row.detected,
					semantic: { status: 'unreviewed', failures: [], note: '' } };
				try {
					const restored = restore(document, translation.text, translation.to, row.detected);
					target.parts = restored;
					target.text = parts_text(restored);
					target.structure = structural_record(document, restored, translation.to, row.detected);
				} catch {
					target.structure = { accepted: false };
				}
				row.targets.push(target);
			}
		} catch (error) {
			// Only locally authored error categories; do not serialize a fetch exception or config.
			row.error = error.name === 'TimeoutError' ? 'request_timeout' :
				/^Azure HTTP [0-9]+$/.test(error.message) ? error.message : 'request_or_response_failed';
		}
		row.elapsed_ms = Date.now() - started;
		report.results.push(row);
		await writeFile(output, JSON.stringify(report, null, 2) + '\n');
		console.log(`${fixture.id} ${arm} repeat=${repeat}: ${row.error ?? row.targets.map(target => `${target.language}=${target.structure.accepted ? 'accepted' : 'rejected'}`).join(' ')}`);
		if (row.error) {
			console.error('Stopped after request failure; completed observations were saved.');
			process.exit(1);
		}
	}
}
console.log(`Saved ${report.results.length} observations to ${output}; semantic review remains explicit.`);
if (report.results.some(row => row.error)) process.exitCode = 1;
