#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export const EQUIPMENT_TIERS = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'];
export const EQUIPMENT_FAMILIES = ['Dagger', 'Sword', 'Battleaxe', '2H_Sword', 'Helmet', 'Boots', 'Platelegs', 'Platebody', 'Shield', 'Scimitar', 'Gloves'];
const MS_PER_INGREDIENT = 300_000;
const id = value => value.includes(':') ? value : `melvorD:${value}`;

export function build_equipment_recipes(data, source_sha256, selection = {}) {
	const smithing = data.skillData?.find(skill => skill.skillID === 'melvorD:Smithing')?.data;
	if (!smithing || !Array.isArray(smithing.recipes)) throw new Error('Official Demo is missing Smithing recipes');
	const recipes = new Map(smithing.recipes.map(recipe => [recipe.productID, recipe]));
	const items = new Map(data.items.map(item => [id(item.id), item]));
	const result = [];
	const tiers = selection.tiers ?? EQUIPMENT_TIERS;
	const families = selection.families ?? EQUIPMENT_FAMILIES;
	for (const tier_name of tiers) {
		const tier = EQUIPMENT_TIERS.indexOf(tier_name);
		if (tier < 0) throw new Error(`Unknown equipment tier ${tier_name}`);
		for (const family of families) {
			if (!EQUIPMENT_FAMILIES.includes(family)) throw new Error(`Unknown equipment family ${family}`);
			const item_id = `melvorD:${tier_name}_${family}`;
			const native_item = items.get(item_id);
			const recipe = recipes.get(item_id);
			if (!native_item || !recipe || recipe.baseQuantity !== 1 || !Array.isArray(recipe.itemCosts) || recipe.itemCosts.length !== 1)
				throw new Error(`Official Demo is missing a single-bar recipe for ${item_id}`);
			const bar_cost = recipe.itemCosts[0];
			const bar_recipe = recipes.get(id(bar_cost.id));
			if (!Number.isSafeInteger(bar_cost.quantity) || bar_cost.quantity < 1 || !bar_recipe || bar_recipe.baseQuantity !== 1 ||
				!Array.isArray(bar_recipe.itemCosts) || !bar_recipe.itemCosts.length ||
				bar_recipe.itemCosts.some(cost => !Number.isSafeInteger(cost.quantity) || cost.quantity < 1))
				throw new Error(`Official Demo is missing a bar recipe for ${id(bar_cost.id)}`);
			const stages = [
				bar_recipe.itemCosts.map(cost => ({ skill_id: 'melvorD:Mining', action_id: id(cost.id), target_ms: cost.quantity * bar_cost.quantity * MS_PER_INGREDIENT })),
				[{ skill_id: 'melvorD:Smithing', action_id: bar_recipe.id.startsWith('melvorD:') ? bar_recipe.id : id(bar_recipe.id), target_ms: bar_cost.quantity * MS_PER_INGREDIENT }],
				[{ skill_id: 'melvorD:Smithing', action_id: id(recipe.id), target_ms: bar_cost.quantity * MS_PER_INGREDIENT }]
			];
			result.push({
				item_id,
				name: native_item.name,
				slot: native_item.validSlots?.[0],
				tier: tier + 1,
				occupies: native_item.occupiesSlots ?? [],
				requirements: native_item.equipRequirements ?? [],
				stats: native_item.equipmentStats ?? [],
				stages
			});
		}
	}
	if (result.length !== tiers.length * families.length || result.some(entry => !entry.slot))
		throw new Error('Official Demo equipment recipes are incomplete');
	return { source: { snapshot: 'Official Melvor Demo 12097', sha256: source_sha256 }, items: result };
}

// Arrow batch quantities describe native recipes, not Online custody or intermediate work multipliers.
export function build_arrow_recipes(demo, full, source_sha256) {
	const smithing = new Map(demo.skillData.find(skill => skill.skillID === 'melvorD:Smithing').data.recipes.map(recipe => [recipe.productID, recipe]));
	const fletching = new Map(full.skillData.find(skill => skill.skillID === 'melvorD:Fletching').data.recipes.map(recipe => [recipe.productID, recipe]));
	const items = new Map(demo.items.map(item => [id(item.id), item]));
	const native_recipe = (map, product, quantity, costs) => {
		const recipe = map.get(product);
		if (!recipe || recipe.baseQuantity !== quantity || JSON.stringify(recipe.itemCosts) !== JSON.stringify(costs))
			throw new Error(`Unexpected official arrow recipe for ${product}`);
		return recipe;
	};
	const shafts = fletching.get('melvorF:Arrow_Shafts');
	if (shafts?.baseQuantity !== 15 || !shafts.alternativeCosts?.some(cost => cost.quantityMultiplier === 1 &&
		cost.itemCosts?.[0]?.id === 'melvorD:Normal_Logs' && cost.itemCosts[0].quantity === 1)) throw new Error('Missing official shaft recipe');
	const headless = native_recipe(fletching, 'melvorD:Headless_Arrows', 15, [
		{ id: 'melvorF:Arrow_Shafts', quantity: 15 }, { id: 'melvorD:Feathers', quantity: 15 }
	]);
	const task = (skill_id, action_id, target_ms = MS_PER_INGREDIENT) => ({ skill_id, action_id, target_ms });
	return { source: { snapshot: 'Official Melvor Full 12097', sha256: source_sha256 }, items: EQUIPMENT_TIERS.map((tier, index) => {
		const item_id = `melvorD:${tier}_Arrows`, tips_id = `melvorD:${tier}_Arrowtips`;
		const arrow = native_recipe(fletching, item_id, 15, [{ id: tips_id, quantity: 15 }, { id: 'melvorD:Headless_Arrows', quantity: 15 }]);
		const tips = smithing.get(tips_id);
		if (tips?.baseQuantity !== 15 || tips.itemCosts?.length !== 1 || tips.itemCosts[0].quantity !== 1) throw new Error(`Unexpected arrowtip recipe ${tips_id}`);
		const bar = smithing.get(tips.itemCosts[0].id);
		if (bar?.baseQuantity !== 1 || !bar.itemCosts?.length || bar.itemCosts.some(cost => !Number.isSafeInteger(cost.quantity) || cost.quantity < 1)) throw new Error(`Missing bar recipe ${tips_id}`);
		const item = items.get(item_id);
		if (item?.validSlots?.[0] !== 'Quiver' || item.ammoType !== 'Arrows') throw new Error(`Missing native arrows ${item_id}`);
		return { item_id, name: item.name, slot: 'Quiver', tier: index + 1, occupies: item.occupiesSlots ?? [],
			requirements: item.equipRequirements ?? [], stats: item.equipmentStats ?? [], unlock_only: true,
			native_recipes: [bar, tips, shafts, headless, arrow].map(recipe => ({ action_id: `${recipe === bar || recipe === tips ? 'melvorD' : 'melvorF'}:${recipe.id}`, product_id: recipe.productID,
				quantity: recipe.baseQuantity, costs: recipe.itemCosts, ...(recipe.alternativeCosts ? { alternative_costs: recipe.alternativeCosts } : {}) })),
			stages: [
				[...bar.itemCosts.map(cost => task('melvorD:Mining', cost.id, cost.quantity * MS_PER_INGREDIENT)), task('melvorD:Woodcutting', 'multiplayer:Any_Woodcutting')],
				[task('melvorD:Smithing', id(bar.id)), task('melvorD:Fletching', `melvorF:${shafts.id}`)],
				[task('melvorD:Smithing', id(tips.id)), task('melvorD:Fletching', `melvorF:${headless.id}`)],
				[task('melvorD:Fletching', `melvorF:${arrow.id}`, 15 * MS_PER_INGREDIENT)]
			] };
	}) };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	const [source_path, output_path, full_path] = process.argv.slice(2);
	if (!source_path || !output_path || !full_path) throw new Error('Usage: build-equipment-recipes.mjs DEMO_JSON OUTPUT_JSON FULL_JSON');
	const source = readFileSync(source_path);
	const source_sha256 = createHash('sha256').update(source).digest('hex');
	const generated = build_equipment_recipes(JSON.parse(source.toString('utf8')).data, source_sha256);
	if (full_path) {
		const full = readFileSync(full_path);
		const arrows = build_arrow_recipes(JSON.parse(source).data, JSON.parse(full).data, createHash('sha256').update(full).digest('hex'));
		generated.arrow_source = arrows.source; generated.items.push(...arrows.items);
	}
	writeFileSync(output_path, `${JSON.stringify(generated, null, '\t')}\n`);
	process.stdout.write(`Generated ${generated.items.length} recipes from official Demo ${source_sha256}\n`);
}
