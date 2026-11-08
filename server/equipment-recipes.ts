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

// Retain legacy evidence keys so queued reports from older clients remain parseable.
export const LEGACY_EQUIPMENT_TASKS = recipe_data.items.flatMap(item => item.stages.flat());
export const EQUIPMENT_DEFINITIONS = recipe_data.items.map(item => ({
	...item, stages: [item.stages.at(-1)!.map(task => ({ ...task, target_ms: 30_000 }))]
}));
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
