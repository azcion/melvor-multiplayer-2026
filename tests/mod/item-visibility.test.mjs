import assert from 'node:assert/strict';
import test from 'node:test';

import {
	filter_items_for_owned_dlc,
	filter_resolved_items,
	get_item_namespace,
	get_resolved_item_namespaces,
	has_unresolved_item,
	is_item_available_for_owned_dlc,
	is_item_resolved
} from '../../mod/item-visibility.mjs';

const known_items = new Set(['melvorD:Coal_Ore', 'exampleMod:Bright_Gem']);
const resolve_item = item_id => known_items.has(item_id) ? {} : undefined;
const is_resolved = item_id => is_item_resolved(item_id, resolve_item);

test('resolves base, modded, and GP item IDs through the local item registry', () => {
	assert.equal(is_item_resolved('melvorD:Coal_Ore', resolve_item), true);
	assert.equal(is_item_resolved('exampleMod:Bright_Gem', resolve_item), true);
	assert.equal(is_item_resolved('melvorD:GP', resolve_item), true);
	assert.equal(is_item_resolved('missingMod:Unknown', resolve_item), false);
});

test('filters unresolved items without changing the stored item records', () => {
	const items = [
		{ id: 'melvorD:Coal_Ore', qty: 2 },
		{ id: 'missingMod:Unknown', qty: 3 },
		{ id: 'exampleMod:Bright_Gem', qty: 4 }
	];

	assert.deepEqual(
		filter_resolved_items(items, item => item.id, is_resolved),
		[items[0], items[2]]
	);
	assert.equal(has_unresolved_item(items, item => item.id, is_resolved), true);
});

test('extracts namespaces from registered game items', () => {
	assert.equal(get_item_namespace('exampleMod:Bright_Gem'), 'exampleMod');
	assert.equal(get_item_namespace('not-namespaced'), null);
	assert.deepEqual(
		get_resolved_item_namespaces([
			['melvorD:Coal_Ore', { id: 'melvorD:Coal_Ore' }],
			['exampleMod:Bright_Gem', { id: 'exampleMod:Bright_Gem' }],
			{ id: 'exampleMod:Another_Gem' }
		]),
		['melvorD', 'exampleMod']
	);
});

test('restricts only official DLC namespaces that the player does not own', () => {
	const owned_dlc = ['melvorAoD'];

	assert.equal(is_item_available_for_owned_dlc('melvorTotH:Corundumite_Ore', owned_dlc), false);
	assert.equal(is_item_available_for_owned_dlc('melvorAoD:Torn_Parchment', owned_dlc), true);
	assert.equal(is_item_available_for_owned_dlc('melvorItA:Abyssal_Pieces', owned_dlc), false);
	assert.equal(is_item_available_for_owned_dlc('melvorD:Coal_Ore', owned_dlc), true);
	assert.equal(is_item_available_for_owned_dlc('melvorF:Normal_Log', owned_dlc), true);
	assert.equal(is_item_available_for_owned_dlc('exampleMod:Bright_Gem', owned_dlc), true);
	assert.equal(is_item_available_for_owned_dlc('not-namespaced', owned_dlc), true);
});

test('filters unavailable official DLC items without changing source records', () => {
	const items = [
		{ id: 'melvorD:Coal_Ore', qty: 2 },
		{ id: 'melvorTotH:Corundumite_Ore', qty: 3 },
		{ id: 'melvorAoD:Torn_Parchment', qty: 4 },
		{ id: 'exampleMod:Bright_Gem', qty: 5 }
	];

	assert.deepEqual(
		filter_items_for_owned_dlc(items, item => item.id, ['melvorAoD']),
		[items[0], items[2], items[3]]
	);
});
