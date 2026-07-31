import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

test('registers Guild as a Multiplayer page instead of a modal', async () => {
	const [data, templates, main] = await Promise.all([
		readFile(new URL('mod/data.json', root), 'utf8').then(JSON.parse),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'),
		readFile(new URL('mod/main.mjs', root), 'utf8')
	]);

	const guild_page = data.data.pages.find(page => page.id === 'Guild');
	assert.equal(guild_page.containerID, 'mp-guild-page');
	assert.equal(guild_page.sidebarItem.categoryID, 'Multiplayer');
	assert.match(templates, /template-mp-guild-page/);
	assert.doesNotMatch(templates, /template-mp-guild-modal/);
	assert.doesNotMatch(templates, /template-mp-guild-browser-modal/);
	assert.match(main, /changePage\(game\.pages\.getObjectByID\('multiplayer:Guild'\)\)/);
});

test('keeps Guild styling on Melvor typography', async () => {
	const style = await readFile(new URL('mod/ui/style.css', root), 'utf8');

	assert.match(style, /\.mp-guild-page-layout/);
	assert.match(style, /\.mp-guild-summary h3,[\s\S]*color: inherit !important/);
	assert.doesNotMatch(style, /font-family|@font-face|fonts?\.google/i);
});
