import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	MULTIPLAYER_PAGE_LANG_IDS,
	create_localized_language_fetch,
	localize_multiplayer_page_names
} from '../../mod/localization.mjs';

const root = new URL('../../', import.meta.url);

test('routes Multiplayer sidebar page names and text badges through localization', async () => {
	const [data, language] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse)
	]);
	const pages = data.data.pages.filter(page => page.sidebarItem?.categoryID === 'Multiplayer');

	assert.equal(pages.length, 7);
	for (const page of pages) {
		assert.match(page.customName, /^MOD_MP_PAGE_/);
		assert.equal(typeof language[page.customName], 'string');
	}

	assert.equal(language.MOD_MP_MENU_HEADER, 'Multiplayer');
	assert.equal(pages.find(page => page.id === 'Campaign_Effort').sidebarItem.asideLangID,
		'MOD_MP_SIDEBAR_CAMPAIGN_INACTIVE');
	assert.equal(pages.find(page => page.id === 'Guild_Raid').sidebarItem.asideLangID,
		'MOD_MP_SIDEBAR_RAID_PREVIEW');
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
