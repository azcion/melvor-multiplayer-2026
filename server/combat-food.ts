import type { Database } from 'bun:sqlite';
import type { EquipmentDefinition } from './equipment-recipes';

export const FOOD_TIER_COST_MICROS = 1_000_000;
export const FOOD_DEFINITIONS: (EquipmentDefinition & { heal: number })[] = [
	['Shrimp', 30], ['Herring', 50], ['Trout', 70], ['Salmon', 90],
	['Lobster', 110], ['Swordfish', 130], ['Crab', 150], ['Carp', 180]
].map(([name, heal], index) => ({
	item_id: `melvorD:${name}`, name: String(name), heal: Number(heal), slot: 'Food', tier: index + 1,
	occupies: [], requirements: [], stats: [],
	stages: [[{ skill_id: 'melvorD:Cooking', action_id: `melvorD:${name}`, target_ms: 30_000 }]]
}));
export function food_access(database: Database, client: number, slot = 'Food') {
	return database.query<{ tier: number; equipped_item: string | null }, [number, string]>(
		'SELECT tier,equipped_item FROM combat_food_access WHERE client_id=? AND slot=?').get(client, slot);
}
export function food_available(database: Database, client: number, item: string, slot = 'Food') {
	const definition = FOOD_DEFINITIONS.find(food => food.item_id === item);
	return !!definition && (food_access(database, client, slot)?.tier ?? 0) >= definition.tier &&
		!!database.query('SELECT 1 FROM combat_equipment_projects WHERE client_id=? AND item_id=? AND completed_at IS NOT NULL').get(client, item);
}

export const FOOD_SLOTS = ['Food', 'Food2'];
export const is_food_slot = (slot: unknown): slot is string => typeof slot === 'string' && FOOD_SLOTS.includes(slot);
