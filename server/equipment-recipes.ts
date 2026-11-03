import { readFileSync } from 'node:fs';
import { COMBAT_CATALOG } from './combat/catalog';

const recipe_data = JSON.parse(readFileSync(new URL('./equipment-recipes-v1.json', import.meta.url), 'utf8')) as {
	source: { snapshot: string; sha256: string };
	items: EquipmentDefinition[];
};
const TIER_NAMES = ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'] as const;

export type EquipmentTaskDefinition = { skill_id: string; action_id: string; target_ms: number };
export type EquipmentDefinition = {
	item_id: string;
	name: string;
	unlock_only?: boolean;
	slot: string;
	tier: number;
	occupies: string[];
	requirements: Array<{ type: string; skillID?: string; level?: number }>;
	stats: Array<{ key: string; value: number }>;
	stages: EquipmentTaskDefinition[][];
};

// Tutorial recipes keep their native ingredient quantities at 45 seconds per ingredient.
const tutorial_items = new Set(['melvorD:Bronze_Sword', 'melvorD:Bronze_Helmet', 'melvorD:Bronze_Shield', 'melvorD:Iron_Shield']);
export const EQUIPMENT_DEFINITIONS = recipe_data.items.map(item => tutorial_items.has(item.item_id) ? {
	...item, stages: item.stages.map(stage => stage.map(task => ({ ...task, target_ms: task.target_ms / 300_000 * 45_000 })))
} : item);
export const EQUIPMENT_SLOTS = ['Weapon', 'Shield', 'Helmet', 'Platebody', 'Platelegs', 'Boots', 'Gloves', 'Quiver'];
export const EQUIPMENT_TIER_NAMES = TIER_NAMES;
export const EQUIPMENT_UNLOCK_COST_MICROS = 1_000_000;
export const EQUIPMENT_TIER_COST_MICROS = [0, 1_000_000, 2_000_000, 3_000_000, 4_000_000, 5_000_000, 6_000_000] as const;

for (const item of EQUIPMENT_DEFINITIONS) {
	const native = COMBAT_CATALOG.items[item.item_id];
	if (!(item.unlock_only ? native?.project_supported : native?.supported) || native.name !== item.name || native.slots?.[0] !== item.slot ||
		JSON.stringify(native.occupies ?? []) !== JSON.stringify(item.occupies) ||
		JSON.stringify(native.requirements ?? []) !== JSON.stringify(item.requirements) ||
		JSON.stringify(native.stats ?? []) !== JSON.stringify(item.stats))
		throw new Error(`Equipment project data differs from combat catalog for ${item.item_id}`);
}
