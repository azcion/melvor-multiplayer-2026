import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import {
	MULTIPLAYER_PAGE_LANG_IDS,
	MULTIPLAYER_SUPPORTED_LANGUAGES,
	create_localized_language_fetch,
	localize_multiplayer_page_names,
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

test('translated locales preserve every English key and formatting placeholder', async () => {
	const english = await readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse);
	const english_keys = Object.keys(english);

	for (const language of MULTIPLAYER_SUPPORTED_LANGUAGES) {
		const translations = await readFile(new URL(`mod/data/lang/${language}.json`, root), 'utf8').then(JSON.parse);
		assert.deepEqual(Object.keys(translations), english_keys, `${language} keys must match English`);
		for (const key of english_keys) {
			assert.equal(typeof translations[key], 'string', `${language}:${key} must be text`);
			assert.notEqual(translations[key].trim(), '', `${language}:${key} must not be empty`);
			assert.equal(placeholder_signature(translations[key]), placeholder_signature(english[key]),
				`${language}:${key} placeholders must match English`);
		}
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
	assert.equal(pages.find(page => page.id === 'Charity_Tree').sidebarItem.asideLangID,
		'MOD_MP_SIDEBAR_CHARITY_PICK');
	assert.equal(pages.find(page => page.id === 'Campaign_Effort').sidebarItem.asideLangID,
		'MOD_MP_SIDEBAR_CAMPAIGN_INACTIVE');
	const raid_page = pages.find(page => page.id === 'Guild_Raid');
	assert.equal(raid_page.sidebarItem.aside, '0');
	assert.equal(raid_page.sidebarItem.asideLangID, undefined);
	assert.deepEqual(Object.keys(MULTIPLAYER_PAGE_LANG_IDS), pages.map(page => page.id));
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

test('language fetch preserves the base dictionary and adds mod translations', async () => {
	const base_language = { BASE_KEY: 'Base value' };
	const fetch_language = create_localized_language_fetch(
		async () => base_language,
		async (_lang, language) => { language.MOD_KEY = 'Mod value'; }
	);

	assert.equal(await fetch_language('en'), base_language);
	assert.deepEqual(base_language, { BASE_KEY: 'Base value', MOD_KEY: 'Mod value' });
});

test('templates contain no static English placeholders or reviewed text literals', async () => {
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	assert.doesNotMatch(templates, /\splaceholder="[A-Za-z]/);
	assert.doesNotMatch(templates, /\s(?:aria-label|title)="[A-Za-z]/);
	assert.doesNotMatch(templates, />\s*(?:Loading\.\.\.|Load more|Space:)\s*</);
	assert.doesNotMatch(templates, />\s*[A-Za-z][^<{]*\{\{/);
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
	// These families are assembled at runtime, including inside HTML bindings.
	const dynamic = new Set();
	for (const state of ['ACTIVE', 'ACCEPTED', 'CLAIMED', 'CANCELLED', 'REJECTED', 'EXPIRED'])
		dynamic.add('MOD_MP_MARKET_HAGGLE_STATUS_' + state);
	for (const state of ['ACTIVE', 'GRANTED', 'DENIED', 'LAPSED', 'WITHDRAWN'])
		dynamic.add('MOD_MP_COUNCIL_OUTCOME_' + state);
	for (const action of ['WINNOWING', 'FELLOWSHIP', 'ENCLOSURE', 'INTERDICT', 'HERESY', 'TEMPERANCE', 'INDULGENCE',
		'INGRATITUDE', 'SACRILEGE', 'BENEFICENCE']) {
		for (const suffix of ['CONFIRM', 'PROPOSAL'])
			dynamic.add(`MOD_MP_COUNCIL_${action}_${suffix}`);
	}
	for (const event of ['JOINED', 'LEFT', 'BANISHED', 'CHARITREE_DONATED', 'RAID_STARTED', 'RAID_BOSS_DEFEATED',
		'RAID_COMPLETED', 'MARKET_LISTING_CREATED', 'MARKET_BOUGHT', 'MARKET_BOUGHT_BY', 'MARKET_SOLD',
		'MARKET_SOLD_TO', 'PETITION_RAISED', 'PETITION_CARRIED', 'PETITION_DEFEATED', 'CAMPAIGN_STARTED',
		'CAMPAIGN_COMPLETED', 'CAMPAIGN_CONTRIBUTED'])
		dynamic.add('MOD_MP_GUILD_ACTIVITY_' + event);
	for (const key of [...literals, ...dynamic]) {
		if (!key.endsWith('_'))
			assert.equal(typeof english[key], 'string', `Missing runtime key: ${key}`);
	}
	for (const key of Object.keys(english))
		assert.ok(literals.has(key) || dynamic.has(key), `Unused localization key: ${key}`);
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
