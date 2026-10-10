// Offline evidence replay: structural validation only, never an automatic meaning score.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { corpus } from './corpus.mjs';
import { build, restore, structural_record } from './adapter.mjs';
import { source_hashes, parts_text } from './source.mjs';
const report = JSON.parse(await readFile(process.argv[2] ?? new URL('./observations/2026-10-09.json', import.meta.url), 'utf8'));
assert.deepEqual(report.source_hashes, source_hashes, 'Source changed: evidence replay needs an explicit source review');
const seen = new Map();
let accepted = 0, rejected = 0, reviewed = 0;
for (const row of report.results) {
	const fixture = corpus.find(value => value.id === row.case);
	assert.ok(fixture, 'Only the known synthetic corpus may be replayed');
	const document = build(fixture.parts, row.arm);
	assert.equal(row.input, document.use_html ? document.html : document.plain);
	for (const target of row.targets) {
		let restored;
		try { restored = restore(document, target.raw, target.language, row.detected); } catch { /* fail closed */ }
		assert.equal(!!restored, target.structure.accepted);
		if (restored) {
			assert.deepEqual(structural_record(document, restored, target.language, row.detected), target.structure);
			assert.equal(parts_text(restored), target.text);
			accepted++;
		} else rejected++;
		if (target.semantic.status !== 'unreviewed') reviewed++;
		const key = `${row.case}/${row.arm}/${target.language}`;
		if (!seen.has(key)) seen.set(key, new Set());
		seen.get(key).add(target.text ?? target.raw);
	}
}
console.log(`${report.results.length} requests; ${accepted} accepted targets, ${rejected} rejected; ${reviewed} explicit semantic reviews.`);
console.log(`${[...seen.values()].filter(values => values.size > 1).length} case/arm/target groups varied across repetitions.`);
console.log('Semantic verdicts are recorded reviewer judgments, independent of parser acceptance.');
console.log(report.recommendation ?? 'No recommendation recorded.');
