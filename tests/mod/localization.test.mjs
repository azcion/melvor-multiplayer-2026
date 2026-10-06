import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
	MULTIPLAYER_PAGE_LANG_IDS,
	MULTIPLAYER_SUPPORTED_LANGUAGES,
	create_localized_language_fetch,
	localize_multiplayer_page_names,
	localize_raid_content,
	resolve_multiplayer_language
} from '../../mod/localization.mjs';

const root = new URL('../../', import.meta.url);

function placeholder_signature(value) {
	return value.match(/%s/g)?.length ?? 0;
}

test('declares every packaged locale and falls back unsupported languages to English', async () => {
	const files = await readdir(new URL('mod/data/lang/', root));
	const packaged_languages = files
		.filter(file => file.endsWith('.json'))
		.map(file => file.slice(0, -'.json'.length))
		.sort();

	assert.deepEqual([...MULTIPLAYER_SUPPORTED_LANGUAGES].sort(), packaged_languages);
	assert.deepEqual([...MULTIPLAYER_SUPPORTED_LANGUAGES],
		['en', 'zh-CN', 'zh-TW', 'fr', 'de', 'pt', 'pt-br', 'it', 'ko', 'ja', 'es', 'ru', 'tr']);
	for (const language of MULTIPLAYER_SUPPORTED_LANGUAGES)
		assert.equal(resolve_multiplayer_language(language), language);
	assert.equal(resolve_multiplayer_language('pt-BR'), 'en');
	assert.equal(resolve_multiplayer_language('zh-TW'), 'zh-TW');
	assert.equal(resolve_multiplayer_language('unsupported'), 'en');
});

test('translated locales preserve formatting placeholders and inherit missing English entries', async () => {
	const english = await readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse);

	for (const language of MULTIPLAYER_SUPPORTED_LANGUAGES) {
		const translations = await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8').then(JSON.parse);
		for (const key of Object.keys(translations)) {
			assert.equal(typeof english[key], 'string', `${language}:${key} must exist in English`);
			assert.equal(typeof translations[key], 'string', `${language}:${key} must be text`);
			assert.notEqual(translations[key].trim(), '', `${language}:${key} must not be empty`);
			assert.equal(placeholder_signature(translations[key]), placeholder_signature(english[key]),
				`${language}:${key} placeholders must match English`);
		}
	}
});

test('every packaged locale labels both Raid reward groups and the tier', async () => {
	for (const language of MULTIPLAYER_SUPPORTED_LANGUAGES) {
		const translations = await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8').then(JSON.parse);
		for (const key of ['MOD_MP_INBOX_SOURCE_RAID', 'MOD_MP_INBOX_SOURCE_RAID_ASSAULT', 'MOD_MP_RAID_TIER'])
			assert.ok(translations[key]?.trim(), `${language}:${key} must be translated`);
		assert.equal(placeholder_signature(translations.MOD_MP_INBOX_SOURCE_RAID_ASSAULT), 1);
		assert.equal(placeholder_signature(translations.MOD_MP_RAID_TIER), 1);
	}
});

test('every locale covers Raid copy and native content with matching placeholders', async () => {
	const english = JSON.parse(await readFile(new URL('mod/data/lang/en.json', root), 'utf8'));
	const keys = Object.keys(english).filter(key => key.startsWith('MOD_MP_RAID_'));
	for (const language of MULTIPLAYER_SUPPORTED_LANGUAGES) {
		const strings = JSON.parse(await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8'));
		for (const key of keys) {
			assert.ok(strings[key]?.trim(), `${language}:${key} must be translated`);
			assert.equal(placeholder_signature(strings[key]), placeholder_signature(english[key]));
		}
		assert.match(strings.MOD_MP_RAID_FORTIFIED_DESCRIPTION, /95%/);
		assert.doesNotMatch(strings.MOD_MP_RAID_FORTIFIED_DESCRIPTION, /99%/);
	}
});

test('native Raid names and attack text follow language changes with optional content absent', async () => {
	const dictionaries = {};
	for (const language of ['en', 'zh-CN'])
		dictionaries[language] = JSON.parse(await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8'));
	let language = 'en';
	const fear = { id: 'melvorD:Fear', get name() { return language === 'en' ? 'Fear' : '恐惧'; } };
	const poison = { id: 'melvorD:Poison', get name() { return language === 'en' ? 'Poison' : '中毒'; } };
	const monster = { name: 'English boss' };
	const strike = { id: 'multiplayer:Raid_Tier_1_FullDamage', name: 'English strike' };
	const fortified = { name: 'English buff' };
	const area = { name: 'English area' };
	const attack = { name: 'English attack', description: 'English description',
		onhitEffects: [strike, fear, poison].map(effect => ({ effect })) };
	const registry = entries => ({ getObjectByID: id => entries[id] });
	const game = {
		monsters: registry({ 'multiplayer:Raid_Tier_1': monster }),
		combatAreas: registry({ 'multiplayer:Guild_Raid': area }),
		combatEffects: registry({ 'multiplayer:Raid_Tier_1_FullDamage': strike, 'multiplayer:Raid_Boss_Fortified': fortified }),
		specialAttacks: registry({ 'multiplayer:Raid_Tier_1_Assault': attack })
	};
	localize_raid_content({ game, getLangString: key => dictionaries[language][key] });
	assert.equal(monster.name, 'The Mossbound Hollow');
	assert.match(attack.description, /15% otherwise\. Applies: Fear, Poison\./);
	assert.equal(attack.modifiedDescription, attack.description);
	language = 'zh-CN';
	assert.equal(monster.name, dictionaries[language].MOD_MP_RAID_BOSS_1);
	assert.equal(attack.name, dictionaries[language].MOD_MP_RAID_ATTACK_NAME);
	assert.match(attack.description, /恐惧, 中毒/);
	assert.equal(strike.name, dictionaries[language].MOD_MP_RAID_FULL_HEALTH_STRIKE.replace('%s', '1'));
	assert.equal(fortified.name, dictionaries[language].MOD_MP_RAID_FORTIFICATION);
	assert.equal(area.name, dictionaries[language].MOD_MP_PAGE_RAID);
});

test('every shipped locale covers the Crucible feature strings', async () => {
	const english = await readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse);
	const crucible_keys = Object.keys(english).filter(key => key.includes('CRUCIBLE'));
	assert.ok(crucible_keys.length > 60);
	for (const language of MULTIPLAYER_SUPPORTED_LANGUAGES) {
		const translations = await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8').then(JSON.parse);
		for (const key of crucible_keys)
			assert.ok(translations[key]?.trim(), `${language}:${key} must be translated`);
	}
});

test('routes Multiplayer sidebar page names and text badges through localization', async () => {
	const [data, language] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse)
	]);
	const pages = data.data.pages.filter(page => page.sidebarItem?.categoryID === 'Multiplayer');

	assert.equal(pages.length, 8);
	for (const page of pages) {
		assert.match(page.customName, /^MOD_MP_PAGE_/);
		assert.equal(typeof language[page.customName], 'string');
	}

	assert.equal(language.MOD_MP_MENU_HEADER, 'Multiplayer');
	assert.equal(language.MOD_MP_PAGE_EXPEDITION, 'Expedition');
	assert.equal(language.MOD_MP_PAGE_EXPEDITION_HEADER, 'Expedition (beta)');
	for (const locale of MULTIPLAYER_SUPPORTED_LANGUAGES.filter(locale => locale !== 'en')) {
		const translations = await readFile(new URL(`mod/data/lang/${locale}.json`, root), 'utf8').then(JSON.parse);
		for (const key of ['MOD_MP_PAGE_EXPEDITION', 'MOD_MP_PAGE_EXPEDITION_HEADER', 'MOD_MP_PAGE_RAID', 'MOD_MP_PAGE_RAID_HEADER'])
			assert.ok(translations[key]?.trim(), `${locale}:${key} must be translated`);
	}
	assert.equal(pages.find(page => page.id === 'Crucible').sidebarItem.asideClass,
		'badge mp-crucible-nav');
	const raid_page = pages.find(page => page.id === 'Guild_Raid');
	assert.equal(raid_page.sidebarItem.aside, '0');
	assert.equal(raid_page.sidebarItem.asideLangID, undefined);
	assert.deepEqual(Object.keys(MULTIPLAYER_PAGE_LANG_IDS), pages.map(page => page.id));
});

test('removes the Campaign feature while retaining Campaign pet options', async () => {
	const [data, pets] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/pets.json', root), 'utf8').then(JSON.parse)
	]);
	assert.equal(data.data.pages.some(page => page.id === 'Campaign_Effort'), false);
	await assert.rejects(access(new URL('mod/data/campaigns.json', root)));

	const campaign_pets = pets.filter(pet => pet.id.includes('_Campaign_'));
	assert.equal(campaign_pets.length, 6);
	for (const pet of campaign_pets) {
		assert.match(pet.media, /^assets\/pet_/);
		await access(new URL(`mod/${pet.media}`, root));
	}
});

test('page names and rendered sidebar labels follow the active language', () => {
	let active_language = 'English';
	const page = { id: 'multiplayer:Chat', name: 'MOD_MP_PAGE_CHAT' };
	const rendered = [];
	const nav_item = { nameEl: { replaceChildren: child => rendered.push(child) } };

	localize_multiplayer_page_names({
		game: { pages: { getObjectByID: id => id === page.id ? page : undefined } },
		sidebar: { category: () => ({ item: () => nav_item }) },
		getLangString: () => active_language,
		createElement: (tag, options) => ({ tag, options })
	});

	assert.equal(page.name, 'English');
	active_language = 'Translated';
	assert.equal(page.name, 'Translated');
	assert.deepEqual(rendered, [{
		tag: 'lang-string',
		options: { attributes: [['lang-id', 'MOD_MP_PAGE_CHAT']] }
	}]);
});

test('Expedition and Raid keep localized beta headers separate from sidebar labels across language changes', async () => {
	const dictionaries = {};
	for (const locale of MULTIPLAYER_SUPPORTED_LANGUAGES)
		dictionaries[locale] = JSON.parse(await readFile(new URL(`mod/data/lang/${locale}.json`, root), 'utf8'));
	let active_language = 'en';
	const pages = ['Expedition', 'Guild_Raid'].map(id => ({ id: 'multiplayer:' + id }));
	const sidebar_labels = new Map();
	localize_multiplayer_page_names({
		game: { pages: { getObjectByID: id => pages.find(page => page.id === id) } },
		sidebar: { category: () => ({ item: id => ({
			nameEl: { replaceChildren: child => sidebar_labels.set(id, child.options.attributes[0][1]) }
		}) }) },
		getLangString: key => dictionaries[active_language][key],
		createElement: (tag, options) => ({ tag, options })
	});
	assert.deepEqual(pages.map(page => page.name), ['Expedition (beta)', 'Raid (beta)']);
	for (const locale of MULTIPLAYER_SUPPORTED_LANGUAGES) {
		active_language = locale;
		for (const page of pages) {
			const sidebar_key = sidebar_labels.get(page.id);
			const label = dictionaries[locale][sidebar_key];
			assert.doesNotMatch(label, /[（()）]/u, `${locale}:${sidebar_key} must have no suffix`);
			assert.equal(page.name, dictionaries[locale][sidebar_key + '_HEADER']);
			assert.ok(page.name.startsWith(label));
			assert.notEqual(page.name, label);
		}
	}
});

test('mobile title font size covers every registered Multiplayer page within its media query', async () => {
	const data = JSON.parse(await readFile(new URL('mod/data.json', root), 'utf8'));
	const style = await readFile(new URL('mod/ui/style.css', root), 'utf8');
	const rule = style.match(/@media \(max-width: 767\.98px\) \{\s*:is\(([^)]+)\)\s*#header-title\s*\{\s*font-size: 1rem !important;\s*\}\s*\}/);
	assert.ok(rule, 'title font size must be scoped to mobile Multiplayer headers');
	for (const page of data.data.pages)
		assert.ok(rule[1].split(',').map(selector => selector.trim()).includes('.' + page.headerBgClass), page.id);
});

test('language fetch preserves the base dictionary and adds mod translations', async () => {
	const base_language = { BASE_KEY: 'Base value' };
	const fetch_language = create_localized_language_fetch(
		async () => base_language,
		async (lang, language) => { language.MOD_KEY = lang === 'en' ? 'English value' : 'Mod value'; }
	);

	assert.equal(await fetch_language('en'), base_language);
	assert.deepEqual(base_language, { BASE_KEY: 'Base value', MOD_KEY: 'English value' });
	await fetch_language('de');
	assert.deepEqual(base_language, { BASE_KEY: 'Base value', MOD_KEY: 'Mod value' });
});

test('templates contain no static English placeholders or reviewed text literals', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	assert.match(templates, /<template id="template-mp-expedition-page">/);
	// Expedition's preview page and modals intentionally use English copy with locale fallback.
	const localized_templates = templates.replace(/<template id="template-mp-expedition-[^"]+">[\s\S]*?<\/template>/g, '');
	assert.doesNotMatch(localized_templates, /\splaceholder="[A-Za-z]/);
	assert.doesNotMatch(localized_templates, /\s(?:aria-label|title)="[A-Za-z]/);
	assert.doesNotMatch(localized_templates, />\s*(?:Loading\.\.\.|Load more|Space:)\s*</);
	assert.doesNotMatch(localized_templates, />\s*[A-Za-z][^<{]*\{\{/);
});

async function runtime_sources(directory) {
	const entries = await readdir(new URL(directory, root), { withFileTypes: true });
	const chunks = await Promise.all(entries.map(async entry => {
		if (['lang', 'tests', 'node_modules'].includes(entry.name))
			return '';
		const path = `${directory}/${entry.name}`;
		if (entry.isDirectory())
			return runtime_sources(path);
		return /\.(?:mjs|js|ts|html|json)$/.test(entry.name)
			? readFile(new URL(path, root), 'utf8') : '';
	}));
	return chunks.join('\n');
}

test('localization inventory covers runtime and server errors without unused entries', async () => {
	const [english, client, server] = await Promise.all([
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		runtime_sources('mod'), runtime_sources('server')
	]);
	const sources = client + '\n' + server;
	const literals = new Set([...sources.matchAll(/['"](MOD_MP_[A-Z0-9_]+)['"]/g)].map(match => match[1]));
	// Keep historical English keys paired with shipped Charitree translations for 1.5.16.
	const legacy = new Set(Object.keys(await readFile(new URL('mod/data/lang/zh-CN.json', root), 'utf8').then(JSON.parse)));
	// These families are assembled at runtime, including inside HTML bindings.
	const dynamic = new Set();
	for (const kind of ['FOUND', 'CONSIDER', 'APPLY', 'JOIN', 'LEAVE', 'REMOVE', 'WITHDRAW', 'MARKET_ENABLE', 'MARKET_DISABLE', 'BALLOT']) {
		dynamic.add('MOD_MP_ALLIANCE_HEADING_' + kind);
		dynamic.add('MOD_MP_ALLIANCE_DESCRIPTION_' + kind);
	}
	for (const state of ['ACTIVE', 'ACCEPTED', 'CLAIMED', 'CANCELLED', 'REJECTED', 'EXPIRED'])
		dynamic.add('MOD_MP_MARKET_HAGGLE_STATUS_' + state);
	for (const state of ['ACTIVE', 'GRANTED', 'DENIED', 'LAPSED', 'WITHDRAWN'])
		dynamic.add('MOD_MP_COUNCIL_OUTCOME_' + state);
	for (const state of ['ACCEPTED', 'DENIED', 'LAPSED', 'WITHDRAWN', 'CANCELLED'])
		dynamic.add('MOD_MP_ALLIANCE_OUTCOME_' + state);
	for (const action of ['WINNOWING', 'FELLOWSHIP', 'ENCLOSURE', 'INTERDICT', 'HERESY', 'TEMPERANCE', 'INDULGENCE',
		'INGRATITUDE', 'SACRILEGE', 'BENEFICENCE', 'CRUCIBLE_PURGING', 'CRUCIBLE_SEALING',
		'CRUCIBLE_UNSEALING']) {
		for (const suffix of ['CONFIRM', 'PROPOSAL'])
			dynamic.add(`MOD_MP_COUNCIL_${action}_${suffix}`);
	}
	for (const event of ['JOINED', 'LEFT', 'BANISHED', 'CHARITREE_DONATED', 'RAID_STARTED', 'RAID_BOSS_DEFEATED',
		'RAID_COMPLETED', 'MARKET_LISTING_CREATED', 'MARKET_BOUGHT', 'MARKET_BOUGHT_BY', 'MARKET_SOLD',
		'MARKET_SOLD_TO', 'PETITION_RAISED', 'PETITION_CARRIED', 'PETITION_DEFEATED'])
		dynamic.add('MOD_MP_GUILD_ACTIVITY_' + event);
	for (const key of [...literals, ...dynamic]) {
		if (!key.endsWith('_'))
			assert.equal(typeof english[key], 'string', `Missing runtime key: ${key}`);
	}
	for (const key of Object.keys(english))
		assert.ok(literals.has(key) || dynamic.has(key) || legacy.has(key), `Unused localization key: ${key}`);
});

test('Chinese Marketplace activity keeps quantity item and counterparty in source order', async () => {
	for (const language of ['zh-CN', 'zh-TW']) {
		const dictionary = await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8').then(JSON.parse);
		for (const action of ['BOUGHT', 'SOLD']) {
			const values = ['17', 'ITEM', 'PLAYER'];
			const rendered = dictionary['MOD_MP_GUILD_ACTIVITY_MARKET_' + action].replace(/%s/g, () => values.shift());
			assert.match(rendered, /17件ITEM/);
			assert.match(rendered, action === 'BOUGHT' ? /[卖賣]家[为為]PLAYER/ : /[买買]家[为為]PLAYER/);
		}
	}
});
