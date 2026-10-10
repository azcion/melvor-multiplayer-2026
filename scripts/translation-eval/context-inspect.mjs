// Verify reproducibility, never infer sentence meaning from plumbing records.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { context_corpus } from './context-corpus.mjs';
import { prepare, decode } from './context.mjs';
import { build, restore, structural_record } from './adapter.mjs';
import { source_hashes, parts_text } from './source.mjs';
const report = JSON.parse(await readFile(process.argv[2] ?? new URL('observations/2026-10-09-context-offline.json', import.meta.url), 'utf8'));
assert.deepEqual(report.source_hashes, source_hashes);
for (const [file, hash] of Object.entries(report.harness_hashes)) {
	assert.ok(['context.mjs', 'context-corpus.mjs', 'corpus.mjs', 'adapter.mjs', 'context-run.mjs', 'source.mjs'].includes(file));
	assert.equal(createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex'), hash);
}
let accepted = 0, reviewed = 0;
const seen = new Set();
for (const row of report.results) {
	const fixture = context_corpus.find(f => f.id === row.case);
	assert.ok(fixture);
	const identity = `${row.case}/${row.arm}/${row.repeat}`;
	assert.ok(!seen.has(identity)); seen.add(identity);
	assert.ok(['N', 'C'].includes(row.arm));
	assert.ok(row.repeat >= 1 && row.repeat <= report.protocol.repeats);
	const prepared = prepare(fixture.parts), doc = build(fixture.parts, 'N');
	assert.deepEqual(row.input, row.arm === 'C' ? prepared.request : doc.use_html ? doc.html : doc.plain);
	if (row.error) continue;
	if (row.arm === 'C') {
		let reconstructed;
		try { reconstructed = decode(prepared, row.raw); } catch { assert.equal(row.structure_error, 'invalid_context_result'); continue; }
		assert.equal(row.structure_error, undefined);
		assert.equal(row.targets.length, 2);
		for (let i = 0; i < 2; i++) {
			assert.deepEqual(row.targets[i].parts, reconstructed[i].parts);
			assert.deepEqual(row.targets[i].structure, reconstructed[i].structure);
			assert.equal(row.targets[i].text, reconstructed[i].text);
		}
	} else {
		assert.equal(row.targets.length, 2);
		for (const target of row.targets) {
			let parts;
			try { parts = restore(doc, row.raw.translations.find(t => t.to === target.language).text, target.language, row.detected); }
			catch { assert.equal(target.structure.accepted, false); continue; }
			assert.deepEqual(target.parts, parts);
			assert.equal(target.text, parts_text(parts));
			assert.deepEqual(target.structure, structural_record(doc, parts, target.language, row.detected));
		}
	}
	for (const target of row.targets) {
		assert.ok(['unreviewed', 'faithful', 'ambiguous', 'failed', 'unassessable'].includes(target.semantic.status));
		if (target.structure.accepted) accepted++;
		if (target.semantic.status !== 'unreviewed') reviewed++;
	}
}
if (!report.results.some(row => row.error)) assert.equal(seen.size, context_corpus.length * 2 * report.protocol.repeats);
console.log(`${report.mode}: ${report.results.length} rows; ${accepted} structurally accepted targets; ${reviewed} explicitly reviewed targets. No inferred semantic passes.`);
