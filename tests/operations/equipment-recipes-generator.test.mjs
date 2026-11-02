import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { build_equipment_recipes } from '../../scripts/build-equipment-recipes.mjs';

const official = JSON.parse(readFileSync(new URL('../../server/tests/fixtures/melvor-equipment-recipes-subset.json', import.meta.url), 'utf8'));

test('generates official Demo recipes with ingredient-based work targets', () => {
	const generated = build_equipment_recipes(official, 'fixture-sha256', {
		tiers: ['Bronze'], families: ['Dagger', '2H_Sword']
	});
	assert.equal(generated.source.snapshot, 'Official Melvor Demo 12097');
	assert.equal(generated.source.sha256, 'fixture-sha256');
	assert.equal(generated.items.length, 2);
	const dagger = generated.items.find(item => item.item_id === 'melvorD:Bronze_Dagger');
	assert.deepEqual(dagger.stages[0], [
		{ skill_id: 'melvorD:Mining', action_id: 'melvorD:Copper_Ore', target_ms: 300000 },
		{ skill_id: 'melvorD:Mining', action_id: 'melvorD:Tin_Ore', target_ms: 300000 }
	]);
	assert.deepEqual(dagger.stages[1], [{ skill_id: 'melvorD:Smithing', action_id: 'melvorD:Bronze_Bar', target_ms: 300000 }]);
	assert.deepEqual(dagger.stages[2], [{ skill_id: 'melvorD:Smithing', action_id: 'melvorD:Bronze_Dagger', target_ms: 300000 }]);
	const two_handed = generated.items.find(item => item.item_id === 'melvorD:Bronze_2H_Sword');
	assert.equal(two_handed.stages[1][0].target_ms, 900000);
	assert.equal(two_handed.stages[2][0].target_ms, 900000);
	const rune_gloves = build_equipment_recipes(official, 'fixture-sha256', { tiers: ['Rune'], families: ['Gloves'] }).items[0];
	assert.deepEqual(rune_gloves.stages[0], [
		{ skill_id: 'melvorD:Mining', action_id: 'melvorD:Runite_Ore', target_ms: 600000 },
		{ skill_id: 'melvorD:Mining', action_id: 'melvorD:Coal_Ore', target_ms: 4800000 }
	]);
	assert.equal(rune_gloves.stages[1][0].target_ms, 600000);
	assert.equal(rune_gloves.stages[2][0].target_ms, 600000);
});

test('official arrow chains retain batch quantities with quantity-scaled Mining and 75-minute final work', async () => {
	const { build_arrow_recipes } = await import('../../scripts/build-equipment-recipes.mjs');
	const arrows = build_arrow_recipes(official, official, 'full-fixture').items;
	assert.equal(arrows.length, 6);
	for (const arrow of arrows) {
		assert.equal(arrow.slot, 'Quiver'); assert.equal(arrow.unlock_only, true);
		assert.ok(arrow.stages.slice(1, -1).flat().every(task => task.target_ms === 300000));
		assert.equal(arrow.stages.at(-1)[0].target_ms, 4500000);
		assert.equal(arrow.stages[0].at(-1).action_id, 'multiplayer:Any_Woodcutting');
		assert.equal(arrow.native_recipes[1].quantity, 15);
		assert.equal(arrow.native_recipes.at(-1).quantity, 15);
		assert.equal(arrow.stages[1][1].action_id, 'melvorF:Arrow_Shafts');
		assert.equal(arrow.stages[2][1].action_id, 'melvorF:Headless_Arrows');
	}
	assert.deepEqual(arrows.map(arrow => arrow.native_recipes[0].costs.map(cost => [cost.id, cost.quantity])), [
		[['melvorD:Copper_Ore',1],['melvorD:Tin_Ore',1]], [['melvorD:Iron_Ore',1]],
		[['melvorD:Iron_Ore',1],['melvorD:Coal_Ore',2]], [['melvorD:Mithril_Ore',1],['melvorD:Coal_Ore',4]],
		[['melvorD:Adamantite_Ore',1],['melvorD:Coal_Ore',6]], [['melvorD:Runite_Ore',1],['melvorD:Coal_Ore',8]]
	]);
	assert.deepEqual(arrows.map(arrow => arrow.stages[0].filter(task => task.skill_id === 'melvorD:Mining').map(task => task.target_ms / 60000)), [[5, 5], [5], [5, 10], [5, 20], [5, 30], [5, 40]]);
	const changed = structuredClone(official);
	changed.skillData.find(skill => skill.skillID === 'melvorD:Fletching').data.recipes.find(recipe => recipe.id === 'Headless_Arrows').baseQuantity = 1;
	assert.throws(() => build_arrow_recipes(official, changed, 'bad'), /Unexpected official arrow recipe/);
});
