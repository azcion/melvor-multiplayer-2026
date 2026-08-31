import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { load_changelog, normalize_changelog_entries } from '../../mod/changelog.mjs';

const root = new URL('../../', import.meta.url);

test('normalizes stable mod.io file history and omits prerelease duplicates', () => {
	const entries = normalize_changelog_entries({ data: [
		{ id: 4, version: '1.4.0', changelog: 'New feature\n\nMore details &amp; polish.' },
		{ id: 3, version: '0.1.0-public-test.1', changelog: 'Test build' },
		{ id: 2, version: '1.4.0', changelog: 'Older duplicate' },
		{ id: 1, version: '1.3.0', changelog: 'Previous release' },
		{ id: 0, version: '1.2.0', changelog: '' }
	] });

	assert.deepEqual(entries, [
		{
			version: '1.4.0',
			changelog: 'New feature\n\nMore details & polish.',
			lines: ['New feature', 'More details & polish.']
		},
		{
			version: '1.3.0',
			changelog: 'Previous release',
			lines: ['Previous release']
		}
	]);
});

test('loads changelog history directly from mod.io without a bundled data file', async () => {
	let requested_url = '';
	const entries = await load_changelog(async url => {
		requested_url = url;
		return {
			ok: true,
			json: async () => ({ data: [{ version: '1.0.0', changelog: 'Jolly cooperation.' }] })
		};
	});

	assert.match(requested_url, /g-2869\.modapi\.io\/v1\/games\/2869\/mods\/6267659\/files/);
	assert.match(requested_url, /_sort=-id/);
	assert.match(requested_url, /_limit=100/);
	assert.match(requested_url, /api_key=/);
	assert.deepEqual(entries.map(entry => entry.version), ['1.0.0']);

	const mod_files = await (await import('node:fs/promises')).readdir(new URL('../../mod/', import.meta.url));
	assert.ok(!mod_files.includes('changelog-raw.json'));
});

test('wires the Updates page to the bottom of the Multiplayer sidebar', async () => {
	const [data, main, templates, localization, english] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/main.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/localization.mjs', root), 'utf8'),
		readFile(new URL('mod/data/lang/en.json', root), 'utf8').then(JSON.parse)
	]);
	const page = data.data.pages.find(entry => entry.id === 'Updates');
	const raid_index = data.data.pages.findIndex(entry => entry.id === 'Guild_Raid');
	const updates_index = data.data.pages.findIndex(entry => entry.id === 'Updates');

	assert.equal(page.sidebarItem.categoryID, 'Multiplayer');
	assert.equal(page.sidebarItem.icon, 'https://cdn2-main.melvor.net/assets/media/main/announcement.png');
	assert.equal(updates_index, raid_index + 1);
	assert.match(templates, /template-mp-updates-page/);
	const state_actions = main.slice(main.indexOf('Object.assign('), main.indexOf('modal_queue_guard =', main.indexOf('Object.assign(')));
	assert.match(state_actions, /format_guild_activity_time,\s*set_updates_mobile_tab/);
	assert.match(templates, /state\.changelog_entries/);
	assert.match(templates, /state\.updates_sections/);
	assert.match(localization, /Updates: 'MOD_MP_PAGE_UPDATES'/);
	assert.equal(english.MOD_MP_PAGE_UPDATES, 'Updates');
	assert.equal(english.MOD_MP_UPDATES_CHANGELOG, 'Changelog');
});
