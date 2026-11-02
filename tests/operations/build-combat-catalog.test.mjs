import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build_combat_catalog } from '../../scripts/build-combat-catalog.mjs';

const tiers = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'];
const pieces = ['Dagger', 'Sword', 'Scimitar', 'Battleaxe', '2H_Sword', 'Helmet', 'Boots', 'Platelegs', 'Platebody', 'Shield', 'Gloves'];
const effect_fields = ['modifiers', 'conditionalModifiers', 'specialAttacks', 'combatEffects', 'consumesOn', 'consumesChargesOn', 'consumesItemOn', 'providedRunes'];

test('official catalog enables exactly the ordinary Bronze through Rune melee families', async () => {
	const catalog = JSON.parse(await readFile(new URL('../../server/combat/catalog-v1.json', import.meta.url), 'utf8'));
	const expected = tiers.flatMap(tier => pieces.map(piece => `melvorD:${tier}_${piece}`)).sort();
	const supported = Object.entries(catalog.items).filter(([, item]) => item.supported && item.kind !== 'Food').map(([id]) => id).sort();
	assert.deepEqual(supported, expected);
	for (const id of expected) {
		const item = catalog.items[id];
		assert.ok(item.slots?.length, `${id} must retain native slots`);
		assert.ok(Array.isArray(item.requirements), `${id} must retain native requirements`);
		assert.ok(Array.isArray(item.stats), `${id} must retain native stats`);
	}
});

test('extractor rejects every recognized effect-bearing field and Raid-exclusive gear', () => {
	for (const field of effect_fields) {
		const item = { id: 'Bronze_Dagger', name: 'Bronze Dagger', itemType: 'Weapon', validSlots: ['Weapon'], [field]: { effect: true } };
		const catalog = build_combat_catalog(JSON.stringify({ namespace: 'melvorD', data: { items: [item] } }));
		assert.equal(catalog.items['melvorD:Bronze_Dagger'].supported, false, field);
	}
	const raid_catalog = build_combat_catalog(JSON.stringify({ namespace: 'melvorD', data: { items: [
		{ id: 'Bronze_Dagger', name: 'Bronze Dagger', itemType: 'Weapon', validSlots: ['Weapon'], golbinRaidExclusive: true }
	] } }));
	assert.equal(raid_catalog.items['melvorD:Bronze_Dagger'].supported, false);
});

test('extractor preserves native slots, occupied slots, requirements, and combat stats', () => {
	const item = { id: 'Bronze_2H_Sword', name: 'Bronze 2H Sword', itemType: 'Weapon', validSlots: ['Weapon'],
		occupiesSlots: ['Shield'], equipRequirements: [{ type: 'SkillLevel', skillID: 'melvorD:Attack', level: 1 }],
		equipmentStats: [{ key: 'attackSpeed', value: 3000 }, { key: 'meleeStrengthBonus', value: 10 }] };
	const catalog = build_combat_catalog(JSON.stringify({ namespace: 'melvorD', data: { items: [item] } }));
	assert.deepEqual(catalog.items['melvorD:Bronze_2H_Sword'], {
		name: item.name, kind: item.itemType, supported: true, slots: item.validSlots, occupies: item.occupiesSlots,
		requirements: item.equipRequirements, stats: item.equipmentStats
	});
});

test('arrows retain project metadata while every arrow stays excluded from combat admission', () => {
	const item = { id: 'Bronze_Arrows', name: 'Bronze Arrows', itemType: 'Equipment', validSlots: ['Quiver'], equipmentStats: [{ key: 'rangedStrengthBonus', value: 7 }] };
	const build = value => build_combat_catalog(JSON.stringify({ namespace: 'melvorD', data: { items: [value] } })).items['melvorD:Bronze_Arrows'];
	assert.equal(build(item).supported, false);
	assert.equal(build(item).project_supported, true);
	assert.deepEqual(build(item).slots, ['Quiver']);
	for (const field of effect_fields) assert.equal(build({ ...item, [field]: { effect: true } }).project_supported, undefined);
	assert.equal(build({ ...item, golbinRaidExclusive: true }).project_supported, undefined);
});
