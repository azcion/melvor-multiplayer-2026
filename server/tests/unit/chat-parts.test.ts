import { describe, expect, test } from 'bun:test';
import { compatible_chat_parts, normalize_chat_parts, parts_text, translation_html, translated_parts, type ChatPart } from '../../chat_parts';

const source: ChatPart[] = [{ type: 'text', text: 'Compare <this> & "that" ' },
	{ type: 'item', item_id: 'melvorD:Bronze_Sword' }, { type: 'text', text: ' with ' },
	{ type: 'item', item_id: 'melvorTotH:Golden_Stardust' }];

describe('Chat item translation format', () => {
	test('escapes player markup and sends only short protected occurrence numbers', () => {
		expect(translation_html(source)).toBe('Compare &lt;this&gt; &amp; &quot;that&quot; <span translate="no">0</span> with <span translate="no">1</span>');
	});
	test('reconstructs reordered and repeated item references while decoding text exactly once', () => {
		expect(translated_parts('<span translate="no">1</span> &amp;lt; &lt; &#128512; <span translate="no">0</span>', source))
			.toEqual([source[3], { type: 'text', text: ' &lt; < 😀 ' }, source[1]]);
		const repeated = [source[1]!, source[1]!];
		expect(translated_parts(translation_html(repeated), repeated)).toEqual(repeated);
	});
	test.each([
		'<span translate="no">0</span>',
		'<span translate="no">0</span><span translate="no">0</span>',
		'<span translate="no">0</span><span translate="no">2</span>',
		'<span translate="no">0</span><span translate="no">01</span>',
		'<img src=x><span translate="no">0</span><span translate="no">1</span>',
		'<span translate="no">zero</span><span translate="no">1</span>',
		'<span onclick="x" translate="no">0</span><span translate="no">1</span>'
	])('rejects damaged or unexpected translation markup: %s', html => {
		expect(() => translated_parts(html, source)).toThrow();
	});
	test('normalizes text and rejects unofficial, malformed, oversized, and excessive tags', () => {
		expect(normalize_chat_parts([{ type: 'text', text: ' hi ' }, { type: 'text', text: 'there ' }]))
			.toEqual([{ type: 'text', text: 'hi there' }]);
		for (const item_id of ['mod:Thing', 'multiplayer:Thing', 'melvorD:<img>', 'melvorD:'])
			expect(normalize_chat_parts([{ type: 'item', item_id }])).toBeNull();
		expect(normalize_chat_parts(Array(21).fill(source[1]))).toBeNull();
		expect(normalize_chat_parts([{ type: 'text', text: 'a'.repeat(1001) }])).toBeNull();
		for (const namespace of ['melvorD', 'melvorF', 'melvorTotH', 'melvorAoD', 'melvorItA'])
			expect(normalize_chat_parts([{ type: 'item', item_id: `${namespace}:Item` }])).not.toBeNull();
	});

	test('feature tags preserve IDs, translation markers, and legacy readable text', () => {
		const tagged: ChatPart[] = [{ type: 'text', text: 'Open ' },
			{ type: 'feature', feature_id: 'multiplayer:Guild_Raid' },
			{ type: 'text', text: ' or ' }, { type: 'feature', feature_id: 'melvorD:Cooking' }];
		expect(normalize_chat_parts(tagged)).toEqual(tagged);
		expect(parts_text(tagged)).toBe('Open $Raid or $Cooking');
		expect(translated_parts(translation_html(tagged), tagged)).toEqual(tagged);
		expect(normalize_chat_parts([{ type: 'feature', feature_id: 'mod:Fake' }])).toBeNull();
		expect(normalize_chat_parts([{ type: 'feature', feature_id: 'multiplayer:Fake' }])).toBeNull();
		expect(normalize_chat_parts(Array(21).fill(tagged[1]))).toBeNull();
		const older = compatible_chat_parts({ parts: tagged, translation_parts: { en: tagged } }, false);
		expect(older.parts).toBeUndefined();
		expect(older.translation_parts).toBeUndefined();
		expect(compatible_chat_parts({ parts: tagged }, true).parts).toEqual(tagged);
	});
});
