import test from 'node:test';
import assert from 'node:assert/strict';
import { build, restore, structural_record } from './adapter.mjs';
import { corpus } from './corpus.mjs';
import { parts_text } from './source.mjs';

for (const fixture of corpus) for (const arm of ['N', 'H']) test(`${fixture.id} / ${arm}: exact source and gated Chinese restoration`, () => {
	const document = build(fixture.parts, arm);
	for (const [target, detected] of [['en', 'en'], ['zh-Hans', 'en'], ['zh-Hans', 'zh-Hans'], ['en', 'it']]) {
		const restored = restore(document, document.use_html ? document.html : document.plain, target, detected);
		const structure = structural_record(document, restored, target, detected);
		assert.equal(structure.exact_occurrences, true);
		assert.equal(structure.typed_links, true);
		if (target !== 'zh-Hans' || detected !== 'en') assert.equal(parts_text(restored), parts_text(fixture.parts));
	}
});

const fixture = corpus.find(value => value.id === 'unit-price');
test('focused terminology corpus reconstructs labels without changing adjacent source text or typed identities', () => {
	for (const id of ['bank-slot-terms', 'guild-member-terms', 'group-member-terms', 'membership-negative', 'terms-with-mods']) {
		const source = corpus.find(value => value.id === id);
		const document = build(source.parts, 'N');
		const expected = parts_text(source.parts)
			.replaceAll('Bank Slot Tokens', '仓库栏位代币')
			.replace(/(?<!\[)Bank Slot Token(?!\])/g, '仓库栏位代币')
			.replaceAll('Guild members', 'Guild 成员').replaceAll('group member', 'group 成员')
			.replace('members who joined our Guild', '成员 who joined our Guild')
			.replace('Members of this group', '成员 of this group').replace('Members of our Guild', '成员 of our Guild');
		assert.equal(parts_text(restore(document, document.html, 'zh-Hans', 'en')), expected);
		assert.equal(parts_text(restore(document, document.html, 'en', 'zh-Hans')), parts_text(source.parts));
	}
});
const doc = build(fixture.parts, 'H');
const first_amount = [...doc.amounts][0];
const amount_span = `<span id="amount-${first_amount}">175k GP</span>`;
const reject = value => assert.throws(() => restore(doc, value, 'zh-Hans', 'en'));
const mutations = {
	missing: value => value.replace(amount_span, ''),
	duplicate: value => value + amount_span,
	unknown: value => value.replace(`amount-${first_amount}`, 'amount-999'),
	'noncanonical ID': value => value.replace(`amount-${first_amount}`, `amount-0${first_amount}`),
	'negative ID': value => value.replace(`amount-${first_amount}`, 'amount--1'),
	'extra attribute': value => value.replace(amount_span, amount_span.replace('id=', 'title="bad" id=')),
	'event attribute': value => value.replace(amount_span, amount_span.replace('id=', 'onclick="bad()" id=')),
	'nested tag': value => value.replace('175k GP</span>', '<b>175k GP</b></span>'),
	'nested occurrence': value => value.replace('175k GP</span>', '<span translate="no">0</span></span>'),
	'script injection': value => value + '<script>bad()</script>',
	'unknown entity': value => value.replace('175k GP</span>', '&unknown;</span>'),
	'zero entity': value => value.replace('175k GP</span>', '&#0;</span>'),
	'surrogate entity': value => value.replace('175k GP</span>', '&#xD800;</span>'),
	'out of range entity': value => value.replace('175k GP</span>', '&#1114112;</span>'),
	'incomplete entity': value => value.replace('175k GP</span>', '&amp</span>'),
	'raw ampersand': value => value + ' & ',
	'raw angle': value => value + ' > ',
	'opaque changed to contextual': value => value.replace('<span translate="no">0</span>', '<span id="amount-0">item</span>'),
	'amount changed to opaque': value => value.replace(amount_span, `<span translate="no">${first_amount}</span>`),
	'opaque altered': value => value.replace('<span translate="no">0</span>', '<span translate="no">00</span>'),
	'root injection': value => `<div>${value}</div>`,
	'oversized HTML': value => value + 'a'.repeat(20001),
	'oversized reconstructed text': value => value + 'a'.repeat(5001)
};
for (const [name, mutate] of Object.entries(mutations)) test(`H rejects ${name}`, () => reject(mutate(doc.html)));

test('H accepts translated child text/entities and restores distinct repeated amounts by ID', () => {
	const response = doc.html.replaceAll('175k GP</span>', '175,000金币 &amp; &#x4e00;</span>');
	const restored = restore(doc, response, 'zh-Hans', 'en');
	assert.equal(restored.filter(part => part.text === '175k GP').length, 2);
	assert.equal(structural_record(doc, restored, 'zh-Hans', 'en').exact_occurrences, true);
});
test('whole occurrence reordering retains repeated typed identities and exact list CRLF', () => {
	for (const id of ['repeated-links', 'exact-list']) {
		const document = build(corpus.find(value => value.id === id).parts, 'H');
		const spans = [...document.html.matchAll(/<span[^>]*>[^<>]*<\/span>/g)].map(match => match[0]);
		const restored = restore(document, spans.reverse().join(' then '), 'en', 'en');
		assert.equal(structural_record(document, restored, 'en', 'en').exact_occurrences, true);
		assert.equal(structural_record(document, restored, 'en', 'en').typed_links, true);
	}
});
test('only full recognized amount occurrences are exposed; names/units/URLs/code/version/glossary/list stay opaque', () => {
	const document = build([{ type: 'text', text: 'Enabled mods:\r\n - God Mode\r\n - dev.Console\r\n\r\nCrucible page: 1,000 GP, 2.5mSC, 12 AP, 3 EP, 5 XP, 6 HP. In-game GP. https://example.com/100kGP `amount850mGP` v1.6.9' }], 'H');
	assert.deepEqual([...document.amounts].map(index => document.markers[index].text), ['1,000 GP', '2.5mSC', '12 AP', '3 EP', '5 XP', '6 HP']);
	for (const [index, part] of document.markers.entries()) if (!document.amounts.has(index))
		assert.ok(document.html.includes(`<span translate="no">${index}</span>`), JSON.stringify(part));
});
test('unsupported amount forms and non-game GP remain provider text', () => {
	for (const value of ['Doctor appointments cost 10 GP.', '1,00 GP', '$50', '850m', '10 dollars'])
		assert.equal(build([{ type: 'text', text: value }], 'H').amounts.size, 0);
});
test('unchanged controls have byte-identical N/H requests', () => {
	for (const value of corpus) {
		const current = build(value.parts, 'N'), hybrid = build(value.parts, 'H');
		if (!hybrid.amounts.size) assert.equal(current.html, hybrid.html);
	}
});
for (const name of ['missing', 'duplicate', 'unknown', 'noncanonical ID', 'nested tag', 'script injection', 'oversized HTML'])
	test(`actual N strict parser rejects ${name}`, () => {
		const current = build(fixture.parts, 'N');
		const marker = '<span translate="no">0</span>';
		const invalid = {
			missing: current.html.replace(marker, ''), duplicate: current.html + marker,
			unknown: current.html.replace(marker, '<span translate="no">999</span>'),
			'noncanonical ID': current.html.replace(marker, '<span translate="no">00</span>'),
			'nested tag': current.html.replace(marker, '<span translate="no"><b>0</b></span>'),
			'script injection': current.html + '<script/>', 'oversized HTML': 'a'.repeat(20001)
		}[name];
		assert.throws(() => restore(current, invalid, 'en', 'en'));
	});
test('structural preservation cannot detect a price digit leaked outside an amount span', () => {
	const document = build(corpus.find(value => value.id === 'repeated-links').parts, 'H');
	const id = [...document.amounts][0];
	const response = document.html.replace(`<span id="amount-${id}">`, `8<span id="amount-${id}">`);
	const restored = restore(document, response, 'zh-Hans', 'en');
	assert.equal(structural_record(document, restored, 'zh-Hans', 'en').exact_occurrences, true);
	assert.equal(structural_record(document, restored, 'zh-Hans', 'en').typed_links, true);
	assert.ok(parts_text(restored).includes('880k GP'));
});
