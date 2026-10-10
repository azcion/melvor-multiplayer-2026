import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, decode, echo, completion_content } from './context.mjs';
import { context_corpus } from './context-corpus.mjs';
import { parts_text } from './source.mjs';
for (const fixture of context_corpus) test(`${fixture.id}: context roundtrip and authoritative restoration`, () => {
	const prepared = prepare(fixture.parts), result = decode(prepared, echo(prepared));
	assert.equal(result[0].text, parts_text(fixture.parts));
	for (const target of result) {
		assert.equal(target.structure.exact_occurrences, true);
		assert.equal(target.structure.typed_links, true);
		assert.equal(target.semantic.status, 'unreviewed');
	}
	assert.equal(prepared.payload.occurrences.length, prepared.document.markers.length);
	assert.equal(JSON.stringify(prepared.request).includes('meaning accuracy score'), false);
});
const prepared = prepare(context_corpus.find(row => row.id === 'repeated-links').parts);
const mutations = {
	missing: value => value.translations[0].segments.splice(value.translations[0].segments.findIndex(s => s.occurrence >= 0), 1),
	duplicate: value => value.translations[0].segments.push({ occurrence: 0, text: '' }),
	unknown: value => value.translations[0].segments.push({ occurrence: 999, text: '' }),
	fraction: value => value.translations[0].segments.push({ occurrence: 0.5, text: '' }),
	string: value => value.translations[0].segments.push({ occurrence: '0', text: '' }),
	'negative id': value => value.translations[0].segments.push({ occurrence: -2, text: '' }),
	'changed child': value => value.translations[0].segments.find(s => s.occurrence >= 0).text = 'changed',
	'nested content': value => value.translations[0].segments.push({ occurrence: -1, text: { html: 'bad' } }),
	'extra field': value => value.translations[0].segments[0].item_id = 'changed',
	'target duplicate': value => value.translations[0].language = 'zh-Hans',
	'missing target': value => value.translations.pop(),
	'unknown detection': value => value.detected = 'bad',
	'oversized text': value => value.translations[0].segments.push({ occurrence: -1, text: 'a'.repeat(5001) }),
	'null byte': value => value.translations[0].segments.push({ occurrence: -1, text: '\0' })
};
for (const [name, mutate] of Object.entries(mutations)) test(`reject ${name}`, () => {
	const value = echo(prepared); mutate(value); assert.throws(() => decode(prepared, value));
});
test('reorder whole occurrences, retaining distinct repeated-link occurrences', () => {
	const value = echo(prepared);
	for (const row of value.translations) row.segments.reverse();
	assert.ok(decode(prepared, value).every(row => row.structure.exact_occurrences && row.structure.typed_links));
});
test('literal markup in prose is text, never a new link or HTML element', () => {
	const value = echo(prepared); value.translations[0].segments.unshift({ occurrence: -1, text: '<script>&bad;</script>' });
	assert.ok(decode(prepared, value)[0].text.startsWith('<script>&bad;</script>'));
});
test('valid IDs can still invent price digits: semantic score stays unreviewed', () => {
	const value = echo(prepared), amount = prepared.document.markers.findIndex(p => p.text === '80k GP');
	const index = value.translations[1].segments.findIndex(s => s.occurrence === amount);
	value.translations[1].segments.splice(index, 0, { occurrence: -1, text: '8' });
	const target = decode(prepared, value)[1];
	assert.equal(target.structure.exact_occurrences, true);
	assert.ok(target.text.includes('880k GP'));
	assert.equal(target.semantic.status, 'unreviewed');
});
for (const [name, value] of Object.entries({ refusal: { finish_reason: 'stop', message: { refusal: 'no' } },
	truncated: { finish_reason: 'length', message: { content: '{}' } }, invalid: { finish_reason: 'stop', message: { content: 'bad' } } }))
	test(`reject completion ${name}`, () => assert.throws(() => completion_content({ choices: [value] })));
test('mixed Chinese detection preserves existing glossary gate', () => {
	const value = echo(prepared); value.detected = 'zh-Hans';
	assert.equal(decode(prepared, value)[1].text, parts_text(prepared.document.parts));
});
test('successful completion parses strict JSON content', () => {
	const value = echo(prepared);
	assert.deepEqual(completion_content({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), value);
});
test('zero-marker prose has the same output bound and remains literal text', () => {
	const plain = prepare([{ type: 'text', text: 'Hello.' }]), value = echo(plain);
	value.translations[0].segments = [{ occurrence: -1, text: '<b>&hello;</b>' }];
	assert.equal(decode(plain, value)[0].text, '<b>&hello;</b>');
	value.translations[0].segments[0].text = 'x'.repeat(5001);
	assert.throws(() => decode(plain, value));
});
