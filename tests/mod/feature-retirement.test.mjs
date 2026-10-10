import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);

test('Crucible client has no retired Charitree handlers, styles, templates or tree assets', async () => {
	const [client, crucible, css, templates, assets] = await Promise.all([
		read_client_source(root), readFile(new URL('mod/client-crucible.mjs', root), 'utf8'),
		readFile(new URL('mod/ui/style.css', root), 'utf8'),
		readFile(new URL('mod/ui/templates.html', root), 'utf8'), readdir(new URL('mod/assets/', root))
	]);
	for (const source of [client, crucible, css, templates])
		assert.doesNotMatch(source, /charitree|charity/i);
	assert.equal(assets.includes('charity_tree.svg'), false);
	assert.ok(assets.includes('pet_charity_spirit.svg'));
	const pets = JSON.parse(await readFile(new URL('mod/data/pets.json', root), 'utf8'));
	assert.ok(pets.some(pet => pet.id === 'Multiplayer_Pet_Charity' && pet.media === 'assets/pet_charity_spirit.svg'));
	assert.ok(pets.some(pet => pet.id === 'Multiplayer_Pet_Crucible'));
});

test('every locale removes the retired feature vocabulary while preserving pet names', async () => {
	for (const filename of await readdir(new URL('mod/data/lang/', root))) {
		if (!filename.endsWith('.json')) continue;
		const dictionary = JSON.parse(await readFile(new URL('mod/data/lang/' + filename, root), 'utf8'));
		for (const [key, value] of Object.entries(dictionary)) {
			assert.doesNotMatch(value, /Charitree/i, filename + ': ' + key);
			if (/CHARITY|CHARITREE/.test(key)) assert.match(key, /^MOD_MP_PET_/, filename + ': ' + key);
		}
		assert.equal(typeof dictionary.MOD_MP_SIDEBAR_CRUCIBLE_WISH, 'string');
		assert.equal(typeof dictionary.MOD_MP_PET_NAME_CHARITY, 'string');
	}
});
