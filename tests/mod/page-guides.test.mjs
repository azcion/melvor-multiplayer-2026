import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PAGE_GUIDES, find_visible_page_guide, get_wiki_page_url, install_page_guide_actions, setup_page_guide_button } from '../../mod/page-guides.mjs';

const root = new URL('../../', import.meta.url);
const page = hidden => ({ classList: { contains: name => name === 'd-none' && hidden } });

test('covers supported Multiplayer pages and their localized guide strings', async () => {
	const data = JSON.parse(await readFile(new URL('mod/data.json', root), 'utf8'));
	const english = JSON.parse(await readFile(new URL('mod/data/lang/en.json', root), 'utf8'));
	const pages = data.data.pages.map(entry => entry.containerID).filter(id => !['mp-updates-page', 'mp-chat-page'].includes(id)).sort();
	assert.deepEqual(PAGE_GUIDES.map(entry => entry.page_id).sort(), pages);
	for (const entry of PAGE_GUIDES) {
		const definition = data.data.pages.find(candidate => candidate.containerID === entry.page_id);
		assert.equal(entry.icon, definition.media);
		assert.equal(entry.title_lang, definition.customName);
		for (const key of [entry.summary_lang, entry.how_to_lang]) assert.equal(typeof english[key], 'string', key);
	}
	for (const filename of await readdir(new URL('mod/data/lang/', root))) {
		if (!filename.endsWith('.json')) continue;
		const language = JSON.parse(await readFile(new URL('mod/data/lang/' + filename, root), 'utf8'));
		for (const key of ['MOD_MP_GUIDE_BUTTON', 'MOD_MP_GUIDE_HOW_TO', 'MOD_MP_GUIDE_OPEN_WIKI',
			...PAGE_GUIDES.flatMap(entry => [entry.summary_lang, entry.how_to_lang])])
			assert.ok(typeof language[key] === 'string' && language[key].trim(), `${filename}: ${key}`);
		assert.ok(language.MOD_MP_GUIDE_RAID_SUMMARY.includes(language.MOD_MP_PAGE_RAID),
			`${filename}: Raid guide should use the page label`);
	}
});

test('appends a page to an HTTP wiki base path while preserving query and fragment', () => {
	for (const base of ['https://wiki.example/docs', 'https://wiki.example/docs/'])
		assert.equal(get_wiki_page_url(base, 'raids'), 'https://wiki.example/docs/raids/');
	assert.equal(get_wiki_page_url('http://localhost:3000/docs?lang=fr#top', 'raids'), 'http://localhost:3000/docs/raids/?lang=fr#top');
	for (const base of ['javascript:alert(1)', 'https://user:pass@example.com/', 'invalid']) assert.equal(get_wiki_page_url(base, 'raids'), null);
	assert.equal(get_wiki_page_url('https://wiki.example/', ''), null);
});

test('opens a modal only for a supported visible page and uses the current server at click time', () => {
	const modals = [], links = [], state = { wiki_url: 'https://one.example/wiki' };
	let visible = 'mp-crucible-page';
	Object.assign(state, install_page_guide_actions({ state, queue_modal: (...args) => modals.push(args),
		get_element: id => page(id !== visible), openLink: url => links.push(url) }));
	state.open_page_guide_wiki();
	assert.deepEqual(links, []);
	state.show_page_guide();
	assert.equal(modals[0][0], 'MOD_MP_PAGE_CRUCIBLE');
	assert.equal(modals[0][1], 'page-guide-modal');
	assert.equal(modals[0][5], true);
	state.open_page_guide_wiki();
	state.wiki_url = 'https://two.example/custom?lang=fr#section';
	state.open_page_guide_wiki();
	assert.deepEqual(links, ['https://one.example/wiki/crucible/', 'https://two.example/custom/crucible/?lang=fr#section']);
	for (visible of ['mp-chat-page', 'mp-updates-page', 'outside']) {
		assert.equal(find_visible_page_guide(id => page(id !== visible)), null);
		state.show_page_guide();
	}
	assert.equal(modals.length, 1);
	visible = 'mp-combat-page';
	state.show_page_guide();
	state.open_page_guide_wiki();
	assert.equal(modals.length, 2);
	assert.equal(links.length, 2);
});

test('header installation clones once and dispatches guide clicks', () => {
	let inserted, clicked = 0, prevented = 0;
	const label = { classList: { add() {} } }, removed = [], classes = new Set(['d-none']);
	const clone = { querySelector: () => label, querySelectorAll: () => [{ removeAttribute: key => removed.push(key) }],
		classList: { remove: name => classes.delete(name), add: name => classes.add(name) },
		removeAttribute: key => removed.push(key), addEventListener: (_name, callback) => { clone.click = callback; } };
	const native = { cloneNode: () => clone, after: link => { inserted = link; } };
	const document = { getElementById: id => id === 'game-guide-header-link' ? native : inserted ?? null };
	const options = { document, state: { show_page_guide: () => clicked++ }, getLangString: () => 'Guide' };
	setup_page_guide_button(options);
	setup_page_guide_button({ ...options, getLangString: () => 'Guía' });
	assert.equal(inserted, clone);
	assert.equal(label.textContent, 'Guía');
	assert.equal(clone.id, 'mp-page-guide-link');
	assert.equal(classes.has('d-none'), false);
	assert.equal(classes.has('mp-page-guide-link'), true);
	assert.deepEqual(removed, ['id', 'onclick']);
	clone.click({ preventDefault: () => prevented++ });
	assert.equal(clicked, 1);
	assert.equal(prevented, 1);
});

test('header visibility excludes Chat and Info and modal keeps actions outside its mobile scroll surface', async () => {
	const css = await readFile(new URL('mod/ui/style.css', root), 'utf8');
	const templates = await readFile(new URL('mod/ui/templates.html', root), 'utf8');
	const selector = css.match(/#page-header:not\(([^)]*)\)\s*\.mp-page-guide-link/)[1];
	assert.doesNotMatch(selector, /mp-(?:chat|updates)-bg/);
	for (const name of ['guild', 'transfer', 'market', 'crucible', 'expedition', 'raid', 'combat']) assert.match(selector, new RegExp(`mp-${name}-bg`));
	const surface = css.match(/\.mp-page-guide \{([^}]*)\}/)[1];
	for (const rule of ['max-height:', 'overflow-y: scroll', '-webkit-overflow-scrolling: touch', 'touch-action: pan-y', 'overscroll-behavior-y: contain']) assert.ok(surface.includes(rule));
	const modal = templates.match(/<template id="template-mp-page-guide-modal">([\s\S]*?)<\/template>/)[1];
	assert.match(modal, /@touchmove="state.stop_icon_scroll_propagation\(\$event\)"/);
	assert.match(modal, /<\/div>\s*<div class="mp-page-guide-actions">/);
});
