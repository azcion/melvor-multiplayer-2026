import { describe, expect, test } from 'bun:test';
import { compatible_chat_parts, normalize_chat_parts, parts_text, translation_html, translation_document, translated_parts, type ChatPart } from '../../chat_parts';

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

	test('new feature concepts and Alt. Magic preserve labels and translation markers', () => {
		const entries = [['melvorD:AltMagic', 'Alt. Magic'], ['multiplayer:Alliance', 'alliance'],
			['multiplayer:Alliance_Member_Guild', 'alliance member guild'], ['multiplayer:Guild_Member', 'guild member'],
			['multiplayer:Petition', 'petition'], ['multiplayer:Policy', 'policy'],
			['multiplayer:Buy_Order', 'buy order'], ['multiplayer:Sell_Listing', 'sell listing'],
			['multiplayer:Trade', 'trade'], ['multiplayer:Gift', 'gift'], ['multiplayer:Wish', 'wish'],
			['multiplayer:Haggle', 'haggle'], ['multiplayer:Chamber', 'chamber']];
		for (const [feature_id, label] of entries) {
			const parts: ChatPart[] = [{ type: 'feature', feature_id: feature_id! }];
			expect(normalize_chat_parts(parts)).toEqual(parts);
			expect(parts_text(parts)).toBe('$' + label);
			expect(translated_parts(translation_html(parts), parts)).toEqual(parts);
		}
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

// Newly authored examples only; no player Chat content.
describe('protected translation terminology', () => {
	const protected_strings = (text: string) => translation_document([{ type: 'text', text }], false).markers
		.map(part => part.type === 'text' ? part.text : 'link');
	test.each([
		['Installed mods: Add Items, God Mode, dev.console.', ['Add Items, God Mode, dev.console.']],
		['Mods: [Creative Mode] God mode w/ Loot + XP Multipliers, Melvor Cheat Suite.',
			['[Creative Mode] God mode w/ Loot + XP Multipliers, Melvor Cheat Suite.']],
		['Cheat Chest, Universal Item Spawner and Loot Chests are installed mods.',
			['Cheat Chest', 'Universal Item Spawner', 'Loot Chests']],
		['Try “God Mode” or the Add Items mod.', ['God Mode', 'Add Items']],
		['Installed mods: Multitasking, Speedup.', ['Multitasking, Speedup.']],
		['The bank holds 850m GP, 100k gp, 1,000 GP and 2.5BGP.', ['850m GP', '100k gp', '1,000 GP', '2.5BGP']],
		['Gain 20XP and 10 hp; spend 5 SC, 6 AP, 7 EP.', ['20XP', '10 hp', '5 SC', '6 AP', '7 EP']],
		['In Melvor, GP, SC, AP, EP, XP and HP are game units.', ['GP', 'SC', 'AP', 'EP', 'XP', 'HP']],
		['启用dev.Console，然后花100k gp。', ['dev.Console', '100k gp']],
		['dev.Console costs 850m GP.\nDisable dev.Console.', ['dev.Console', '850m GP', 'dev.Console']],
		['See https://example.org/mod?v=1 and `game.bank` on v1.6.2.',
			['https://example.org/mod?v=1', '`game.bank`', 'v1.6.2']]
	])('recognizes bounded source expressions: %s', (text, expected) => {
		expect(protected_strings(text as string)).toEqual(expected);
	});
	test.each([
		['Installed mods:\nAdd Items\nGod Mode', ['\nAdd Items\nGod Mode']],
		['My active mods:\r\n  - add items\r\n  * GOD MODE\r\n  • Speedup', ['\r\n  - add items\r\n  * GOD MODE\r\n  • Speedup']],
		['Mod list =\n1. Add Items\n2) God Mode', ['\n1. Add Items\n2) God Mode']],
		['Mod manager: Add Items\nGod Mode', ['Add Items\nGod Mode']],
		['Mods:\nAdd Items, God Mode and Multitasking\nSpeedup.', ['\nAdd Items, God Mode and Multitasking\nSpeedup.']],
		['Mods:\nAdd Items\n\nGod Mode', ['\nAdd Items']],
		['Mods:\nAdd Items\nI add items to the shopping list.\nGod Mode', ['\nAdd Items']],
		['Mods:\n- Add Items\nOther notes:\n- God Mode', ['\n- Add Items']],
		['Mods:\nAdd Items\nUnknown Title\nGod Mode', ['\nAdd Items']],
		['Mods:\nAdd Items\nGod Mode is a phrase here.\nSpeedup', ['\nAdd Items']],
		['Mods:\n- Add Items\n-\nGod Mode', ['\n- Add Items']],
		['Mods:\nAdd Items\n\nOrdinary prose.\nEnabled mods:\nGod Mode', ['\nAdd Items', '\nGod Mode']],
		['Try mod Add Items, then the God Mode mod.', ['Add Items', 'God Mode']]
	])('recognizes and terminates explicit mod lists: %s', (text, expected) => {
		expect(protected_strings(text as string)).toEqual(expected);
	});
	test('bounds list context by line and character counts', () => {
		expect(protected_strings('Mods:\n' + 'Add Items\n'.repeat(15) + 'God Mode\nSpeedup'))
			.toEqual(['\n' + Array(15).fill('Add Items').join('\n')]);
		expect(protected_strings('Mods:\n' + ' '.repeat(1005) + 'Add Items\nGod Mode'))
			.toEqual(['\n' + ' '.repeat(1005) + 'Add Items']);
		expect(protected_strings('Mods:\n' + ' '.repeat(1015) + 'Add Items\nGod Mode')).toEqual([]);
	});
	test.each([
		'My mod manager lets me add items to the shopping list',
		'The mod list reminds me to add items to my shopping list.',
		'My mod manager makes god mode sound impressive.',
		'My mod titles discuss multitasking and speedup in ordinary prose.',
		'The mod add items to the shopping list instruction is confusing.',
		'Mods: I add items, and god mode sounds dramatic.',
		'Mods: Add Itemsand God Mode',
		'Mods: Add Items, then add items to the shopping list.',
		'Mod manager:\nAdd items to the shopping list\nGod Mode',
		'Mods:\n\nAdd Items\nGod Mode',
		'My mod manager lets me\nadd items to the shopping list.',
		'Please add items to the list and switch on god mode.',
		'Multitasking needs practice; a speedup would help.',
		'The mod said add items to the agenda.',
		'Mods: add items to the shopping list.',
		'Installed mods need updating; add items to my shopping list.',
		'The amount is malformed: 1,23 GP.',
		'Installed mods are ready. Add items to my shopping list.',
		'Mods: unknown.\nGod mode is an ordinary phrase here.',
		'My GP is a doctor; I booked 2 GP appointments.',
		'The GP race starts tomorrow; AP reported the news.',
		'The car has 100 HP and the printer is an HP.',
		'The road is 850m long; 100k people spent $1,000 or €20.',
		'GP SC AP EP XP HP',
		'Notdev.ConsoleX and 100k gpx are different tokens.',
		'“Random Title” [Ordinary bracket] Aye, I wish to raid and transfer things.',
		'Super Awesome Expansion! and XP Township Mod need verified metadata.'
	])('leaves ambiguous or unrelated prose unprotected: %s', text => {
		expect(protected_strings(text)).toEqual([]);
	});
	test.each([
		'\nadd items\nGOD MODE',
		'\r\n  - add items \r\n\t* GOD MODE!\r\n  • dev.console',
		'add items,  GOD MODE and dev.console.',
		'\n1. add items\n2) GOD MODE'
	])('restores list separators when the provider removes or moves exposed separators: %s', body => {
		const parts: ChatPart[] = [{ type: 'text', text: 'Please check.\nInstalled mods: ' + body + '\n\nOpen ' },
			{ type: 'item', item_id: 'melvorD:Bank_Slot_Token' },
			{ type: 'text', text: ' at ' }, { type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' }];
		const doc = translation_document(parts);
		expect(doc.markers).toEqual([{ type: 'text', text: body }, parts[1], parts[3]]);
		expect(doc.html).toStartWith('Please check.\nInstalled mods: <span');
		// Azure is allowed to translate prose and reorder occurrences. Delimiters inside
		// the list never reach it; collapsing or relocating its exposed newlines is harmless.
		for (const html of [
			'请检查。已安装模组：<span translate="no">0</span>打开<span translate="no">1</span>于<span translate="no">2</span>',
			'\n请检查。已安装模组：<span translate="no">0</span>\n打开<span translate="no">2</span>和<span translate="no">1</span>'
		]) {
			const restored = translated_parts(html, parts, doc.markers);
			expect(parts_text(restored)).toContain('已安装模组：' + body);
			expect(restored.filter(part => part.type !== 'text')).toHaveLength(2);
		}
	});
	test('round-trips multiline title spelling with structured links and strict markers', () => {
		const parts: ChatPart[] = [{ type: 'text', text: 'Installed mods:\n- add items\n- GOD MODE\n\nOpen ' },
			{ type: 'item', item_id: 'melvorD:Bank_Slot_Token' },
			{ type: 'text', text: ' at ' }, { type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' }];
		const doc = translation_document(parts);
		expect(doc.markers).toEqual([{ type: 'text', text: '\n- add items\n- GOD MODE' }, parts[1], parts[3]]);
		const restored = translated_parts(doc.html, parts, doc.markers);
		expect(parts_text(restored)).toBe(parts_text(parts));
		expect(restored.filter(part => part.type !== 'text')).toEqual(parts.filter(part => part.type !== 'text'));
		for (const broken of [doc.html.replace('>0<', '>1<'), doc.html.replace('>0<', '>9<'),
			doc.html.replace('<span translate="no">0</span>', '')])
			expect(() => translated_parts(broken, parts, doc.markers)).toThrow();
	});
	test('composes internal text occurrences with structured links and literal HTML', () => {
		const parts: ChatPart[] = [{ type: 'text', text: '<b>dev.console & 850m GP</b> ' },
			{ type: 'item', item_id: 'melvorD:Bank_Slot_Token' },
			{ type: 'text', text: ' at ' }, { type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' }];
		const doc = translation_document(parts);
		expect(doc.markers).toEqual([{ type: 'text', text: 'dev.console' }, { type: 'text', text: '850m GP' }, parts[1], parts[3]]);
		expect(doc.html).toStartWith('&lt;b&gt;<span translate="no">0</span> &amp;');
		const reordered = '<span translate="no">3</span>：<span translate="no">2</span>，<span translate="no">1</span>，<span translate="no">0</span>';
		expect(parts_text(translated_parts(reordered, parts))).toBe('$Marketplace：[Bank Slot Token]，850m GP，dev.console');
		for (const broken of [reordered.replace('>0<', '>1<'), reordered.replace('>0<', '>4<'),
			reordered.replace('<span translate="no">0</span>', ''), reordered + '<script>x</script>'])
			expect(() => translated_parts(broken, parts)).toThrow();
	});
});

describe('conservative English to Chinese glossary', () => {
	const document_for = (text: string) => translation_document([{ type: 'text', text }]);
	test.each([
		['Free Fellowship\'s Guild Raid', "自由同盟's 公会突袭"],
		['social only mode; Petition of Interdict; Interdict petition', '社交模式; 禁令请愿; 禁令请愿'],
		['Guild Raid and Multiplayer Expedition', '公会突袭 and 远征'],
		['cheat mods; mod manager; chat reactions', '作弊模组; 模组管理器; 表情回应'],
		['Crucible page, Expedition tab, Raid feature, Marketplace page, Transfers tab, Transfer Items page',
			'熔炉 page, 远征 tab, 突袭 feature, 市场 page, 转移 tab, 转移 page'],
		['打开Guild Raid，然后查看Raid page。', '打开公会突袭，然后查看突袭 page。']
	])('restores curated labels only through the target occurrence table: %s', (text, chinese) => {
		const doc = document_for(text);
		expect(parts_text(translated_parts(doc.html, [], doc.chinese_markers))).toBe(chinese);
		expect(parts_text(translated_parts(doc.html, [], doc.markers))).toBe(text);
	});
	test.each([
		'Aye, I wish the bank would transfer items tomorrow.',
		'The police raid the marketplace; a crucible holds hot metal.',
		'The expedition transfers samples. My reaction was surprise.',
		'The moderator and mods review a cheating report.',
		'Social Only; Using Cheats; vote Aye or Nay; petitions and Wishes.',
		'Raid pagesize; Marketplace tabular data; Guild Raidhouse; Free Fellowshipship',
		'Raid\npage; Expedition is discussed on another page.'
	])('leaves ambiguous prose and substrings provider-owned: %s', text => {
		const doc = document_for(text);
		expect(doc.markers).toEqual([]);
		expect(doc.html).toBe(text);
	});
	test.each(['page', 'tab', 'feature'])('restores qualified Crucible %s through the Chinese occurrence table', qualifier => {
		const text = `Do not spend 640m GP until 24 hours after voting closes on the Crucible ${qualifier}.`;
		const doc = document_for(text);
		expect(doc.markers).toEqual([{ type: 'text', text: '640m GP' }, { type: 'text', text: 'Crucible' }]);
		expect(doc.chinese_markers).toEqual([{ type: 'text', text: '640m GP' }, { type: 'text', text: '熔炉' }]);
		expect(doc.html).toBe(text.replace('640m GP', '<span translate="no">0</span>')
			.replace('Crucible', '<span translate="no">1</span>'));
		// Synthetic provider text establishes restoration, not Azure sentence quality.
		const output = '提供方措辞 <span translate="no">0</span> <span translate="no">1</span>';
		expect(parts_text(translated_parts(output, [], doc.chinese_markers)))
			.toBe('提供方措辞 640m GP 熔炉');
		expect(parts_text(translated_parts(doc.html, [], doc.markers))).toBe(text);
	});
	test('protects code and URLs before glossary matching and does not infer ambiguous mod titles', () => {
		const text = '`Crucible` https://example.org/Free-Fellowship My mod manager lets me add items to the shopping list.';
		const doc = document_for(text);
		expect(doc.markers).toEqual([{ type: 'text', text: '`Crucible`' },
			{ type: 'text', text: 'https://example.org/Free-Fellowship' }, { type: 'text', text: 'mod manager' }]);
		expect(parts_text(translated_parts(doc.html, [], doc.chinese_markers)))
			.toBe(text.replace('mod manager', '模组管理器'));
	});
	test('composes labels with exact list bodies, names, quantities, literal HTML and typed links', () => {
		const parts: ChatPart[] = [{ type: 'text', text: 'Crucible page, Crucible tab, Crucible feature; Guild Raid <test> 100k gp dev.Console\nMods:\r\n  - Add Items\r\n  * GOD MODE\n' },
			{ type: 'item', item_id: 'melvorD:Bank_Slot_Token' },
			{ type: 'feature', feature_id: 'multiplayer:Multiplayer_Market' }];
		const doc = translation_document(parts);
		const restored = translated_parts(doc.html, parts, doc.chinese_markers);
		expect(parts_text(restored)).toBe(parts_text(parts).replaceAll('Crucible', '熔炉').replace('Guild Raid', '公会突袭'));
		expect(restored.slice(-2)).toEqual(parts.slice(-2));
		const tokens = doc.html.match(/<span translate="no">\d+<\/span>/g)!;
		expect(translated_parts(tokens.toReversed().join(' '), parts, doc.chinese_markers)
			.filter(part => part.type !== 'text')).toEqual(parts.filter(part => part.type !== 'text').toReversed());
		for (const damaged of [doc.html.replace(tokens[0]!, ''), doc.html + tokens[0],
			doc.html.replace(tokens[0]!, '<span translate="no">999</span>'), '<b>' + doc.html])
			expect(() => translated_parts(damaged, parts, doc.chinese_markers)).toThrow();
	});
});

test('person occurrences survive translation and fall back for older clients', () => {
	const person: ChatPart = { type: 'person', client_id: 2, display_name: 'Lucy', icon_id: 'multiplayer' };
	const parts: ChatPart[] = [{ type: 'text', text: 'Hi ' }, person, person];
	const html = translation_html(parts);
	expect(html).toBe('Hi <span translate="no">0</span><span translate="no">1</span>');
	expect(translated_parts(html, parts)).toEqual(parts);
	expect(parts_text(parts)).toBe('Hi @Lucy@Lucy');
	expect(compatible_chat_parts({ parts, translation_parts: { en: parts } }, true).parts).toBeUndefined();
	expect(compatible_chat_parts({ parts, translation_parts: { en: parts } }, true, true).parts).toEqual(parts);
});
