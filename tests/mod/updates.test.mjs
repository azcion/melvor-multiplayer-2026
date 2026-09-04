import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { has_unseen_mod_version, load_updates, normalize_updates } from '../../mod/updates.mjs';
import { read_release_changelog } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('detects an unseen current mod version, including a first visit', () => {
	assert.equal(has_unseen_mod_version('1.5.0', undefined), true);
	assert.equal(has_unseen_mod_version('1.5.0', '1.4.5'), true);
	assert.equal(has_unseen_mod_version('1.5.0', '1.5.0'), false);
	assert.equal(has_unseen_mod_version('', '1.4.5'), false);
});

test('renders the new badge on the Updates sidebar item and mobile Changelog tab', async () => {
	const [data, main, templates, style, changelog, english, chinese] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		read_release_changelog(root),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/data/lang/zh-CN.json', root), 'utf8').then(JSON.parse)
	]);
	const updates = data.data.pages.find(page => page.id === 'Updates');

	assert.equal(updates.sidebarItem.asideClass, 'badge mp-updates-nav');
	assert.equal(updates.sidebarItem.asideLangID, 'MOD_MP_SIDEBAR_NEW');
	assert.match(templates, /class="badge mp-updates-tab-badge" v-show="state\.updates_new"/);
	assert.match(main, /get_character_storage_item\(UPDATES_LAST_SEEN_MOD_VERSION_KEY\)/);
	assert.match(main, /set_character_storage_item\(UPDATES_LAST_SEEN_MOD_VERSION_KEY, MOD_VERSION\)/);
	assert.match(main, /tab === 'changelog' && is_mobile_layout\(\)/);
	assert.match(main, /is_visible && !is_mobile_layout\(\)/);
	assert.match(style, /\.mp-updates-tabs \.btn \{\s*position: relative;\s*\}/);
	assert.match(style, /\.mp-updates-tab-badge \{[\s\S]*background: #30c78d;/);
	assert.equal(english.MOD_MP_SIDEBAR_NEW, 'new');
	assert.equal(chinese.MOD_MP_SIDEBAR_NEW, '新');
	assert.match(changelog, /## 1\.5\.0[\s\S]*per-save new-version badge/);
});

test('normalizes server update sections and drops malformed entries', () => {
	assert.deepEqual(normalize_updates({ sections: [
		{ id: ' dev-message ', title: ' Message from the devs ', paragraphs: [' Notice ', '', 42] },
		{ id: 'missing-body', title: 'Missing body', paragraphs: [] },
		{ id: 'missing-title', title: '', paragraphs: ['ignored'] }
	] }), [{
		id: 'dev-message',
		title: 'Message from the devs',
		paragraphs: ['Notice']
	}]);
});

test('fetches updates from the configured multiplayer server', async () => {
	let requested_url = '';
	const sections = [{ id: 'working-on', title: "What we're working on", paragraphs: ['A server notice.'] }];
	const result = await load_updates(async url => {
		requested_url = url;
		return { ok: true, json: async () => ({ sections }) };
	}, 'https://multiplayer.example/');

	assert.equal(requested_url, 'https://multiplayer.example/api/updates');
	assert.deepEqual(result, sections);
});
