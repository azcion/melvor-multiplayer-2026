// Fixed synthetic comparison; isolated Git blobs, no checkout changes or worker imports.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { corpus } from './corpus.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trimEnd();
const output = 'scripts/translation-eval/observations/2026-10-09-crucible-rollback.json';
const revisions = { pre: git('rev-parse', '3a6a281a^'), post: git('rev-parse', '3a6a281a') };
const modules = {}, sources = {};
for (const [arm, revision] of Object.entries(revisions)) {
	const urls = new Map();
	sources[arm] = {};
	for (const file of ['mod_names.ts', 'translation_terms.ts', 'chat_parts.ts', 'chat_translation.ts']) {
		let source = execFileSync('git', ['show', `${revision}:server/${file}`], { encoding: 'utf8' });
		sources[arm][file] = hash(source);
		if (file === 'chat_translation.ts') continue; // Provenance only; never start a worker.
		if (file === 'chat_parts.ts') {
			const seam = "import { db } from './db';";
			if (!source.startsWith(seam)) throw Error('Isolation seam changed');
			source = source.replace(seam, 'const db = new Proxy({}, { get() { throw Error("Database forbidden"); } });');
		}
		for (const [name, url] of urls) source = source.replaceAll(`'./${name.slice(0, -3)}'`, `'${url}'`);
		if (/\bimport\s.*\bfrom\s+['"]\.\//.test(source)) throw Error('Unexpected dependency');
		urls.set(file, `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
	}
	modules[arm] = await import(urls.get('chat_parts.ts'));
}
for (const file of ['mod_names.ts', 'chat_parts.ts', 'chat_translation.ts'])
	if (sources.pre[file] !== sources.post[file]) throw Error('Unexpected transport drift');
const fixtures = [
	{ id: 'historical-until-after', parts: [{ type: 'text', text: 'Do not spend 850m GP until 24h after voting closes on Crucible page.' }] },
	...['negation', 'after'].map(id => corpus.find(value => value.id === id))
];
const plan = [];
for (let trial = 1; trial <= 2; trial++) for (const fixture of fixtures)
	for (const arm of trial === 1 ? ['pre', 'post'] : ['post', 'pre']) {
		const document = modules[arm].translation_document(fixture.parts);
		const input = document.html;
		if (!document.markers.length) throw Error('Expected actual HTML transport');
		plan.push({ trial, case: fixture.id, arm, source_parts: fixture.parts, document, input,
			request_body: JSON.stringify([{ Text: input }]),
			input_codepoints: [...input].length, input_utf16_units: input.length,
			character_units: Math.max([...input].length, input.length) * 2 });
	}
const total = plan.reduce((sum, row) => sum + row.character_units, 0);
if (plan.length !== 12 || total > 10000) throw Error('Budget exceeded');
const harness_hashes = {};
for (const file of ['crucible-rollback.mjs', 'corpus.mjs'])
	harness_hashes[file] = hash(await readFile(new URL(file, import.meta.url)));
const report = { date: new Date().toISOString(), revisions, source_hashes: sources, harness_hashes,
	protocol: { provider: 'Azure only', targets: ['en', 'zh-Hans'], from: null, textType: 'html',
		trials: 2, requests: 12, retries: 0, interval_ms: 1000, timeout_ms: 10000,
		cap_character_units: 10000, precomputed_character_units: total,
		reviewer: 'single agent; not independent bilingual review', no_output_repair: true }, plan, results: [] };
if (process.argv.includes('--verify')) {
	const { default: assert } = await import('node:assert/strict');
	const recorded = JSON.parse(await readFile(output, 'utf8'));
	assert.deepEqual(recorded.revisions, revisions);
	assert.deepEqual(recorded.source_hashes, sources);
	assert.deepEqual(recorded.harness_hashes, harness_hashes);
	assert.deepEqual(recorded.plan, plan);
	assert.equal(recorded.results.length, 12);
	for (const [index, row] of recorded.results.entries()) {
		const planned = plan[index];
		assert.equal(row.arm, planned.arm);
		assert.equal(row.case, planned.case);
		assert.equal(row.trial, planned.trial);
		assert.equal(row.error, undefined);
		const provider = JSON.parse(row.raw_body)[0];
		assert.deepEqual(row.detection, provider.detectedLanguage);
		for (const target of row.targets) {
			assert.equal(target.raw, provider.translations.find(t => t.to === target.language).text);
			const markers = target.language === 'zh-Hans' && row.detection.language === 'en'
				? planned.document.chinese_markers : planned.document.markers;
			const parts = modules[row.arm].translated_parts(target.raw, planned.source_parts, markers);
			assert.deepEqual(parts, target.parts);
			assert.equal(modules[row.arm].parts_text(parts), target.text);
			assert.equal(target.structure.accepted, true);
			assert.equal(target.structure.exact_occurrences, true);
			assert.ok(['faithful', 'ambiguous', 'failed', 'unassessable'].includes(target.semantic.status));
		}
	}
	console.log('Verified 12 requests / 24 targets: hashes, plan, raw envelopes and actual revision reconstruction; semantic judgments remain manual.');
	process.exit(0);
}
if (!process.argv.includes('--azure')) {
	console.log(JSON.stringify({ requests: plan.length, character_units: total, plan }, null, 2));
	process.exit(0);
}
// Require a locally recorded read-only F0/quota preflight, before any provider call.
const quota = JSON.parse(await readFile('agents/temp/crucible-quota.json', 'utf8'));
if (quota.sku !== 'F0' || quota.remaining < total || Date.now() - Date.parse(quota.checked_at) > 3600000)
	throw Error('Fresh sufficient F0 quota required');
report.resource_preflight = quota;
try { await readFile(output); throw Error('Evidence already exists; refusing overwrite'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const key = (await readFile(process.env.AZURE_TRANSLATOR_KEY_FILE ?? new URL('../../config/azure-translator.key', import.meta.url), 'utf8')).trim();
if (!key) throw Error('Missing existing key');
let next = 0;
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
for (const planned of plan) {
	await delay(Math.max(0, next - Date.now()));
	next = Date.now() + 1000;
	const row = { trial: planned.trial, case: planned.case, arm: planned.arm, started_at: new Date().toISOString(), targets: [] };
	try {
		const url = new URL('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&textType=html&to=en&to=zh-Hans');
		const response = await fetch(url, { method: 'POST', headers: {
			'Ocp-Apim-Subscription-Key': key, 'Ocp-Apim-Subscription-Region': 'northeurope',
			'Content-Type': 'application/json; charset=UTF-8'
		}, body: planned.request_body, signal: AbortSignal.timeout(10000) });
		if (!response.ok) throw Error(`Azure HTTP ${response.status}`);
		row.raw_body = await response.text();
		if (row.raw_body.length > 100000) throw Error('Oversized envelope');
		const envelope = JSON.parse(row.raw_body);
		const result = envelope[0];
		if (envelope.length !== 1 || typeof result?.detectedLanguage?.language !== 'string' ||
			result.translations?.length !== 2 || new Set(result.translations.map(t => t.to)).size !== 2 ||
			result.translations.some(t => !['en', 'zh-Hans'].includes(t.to) || typeof t.text !== 'string')) throw Error('Invalid envelope');
		row.detection = result.detectedLanguage;
		for (const translation of result.translations) {
			const target = { language: translation.to, raw: translation.text,
				production_omits_source: translation.to === row.detection.language,
				semantic: { status: 'unreviewed' } };
			const markers = translation.to === 'zh-Hans' && row.detection.language === 'en'
				? planned.document.chinese_markers : planned.document.markers;
			try {
				target.parts = modules[planned.arm].translated_parts(translation.text, planned.source_parts, markers);
				target.text = modules[planned.arm].parts_text(target.parts);
				target.structure = { accepted: true,
					exact_occurrences: markers.every(part => target.parts.filter(p => p === part).length === 1),
					typed_ids: 'not applicable: all three sources are plain text; numeric span indices are occurrence IDs' };
			} catch { target.structure = { accepted: false }; }
			row.targets.push(target);
		}
	} catch (error) {
		row.error = /^Azure HTTP \d+$/.test(error.message) ? error.message : 'request_or_envelope_failed';
	}
	report.results.push(row);
	await writeFile(output, JSON.stringify(report, null, 2) + '\n');
	console.log(`${row.trial} ${row.case} ${row.arm}: ${row.error ?? 'saved'}`);
	if (row.error) process.exit(1); // No retries, including failed or ambiguous delivery.
}
