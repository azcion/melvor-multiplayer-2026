import { readFileSync } from 'node:fs';
import {
	effective_melee_levels,
	native_attack_interval,
	standard_evasion,
	standard_magic_evasion,
	standard_melee_max_hit,
	standard_stat,
	type MeleeStyle
} from './melee-math';
const catalog = JSON.parse(readFileSync(new URL('./catalog-v1.json',import.meta.url),'utf8'));
export type Equipment = { slots: string[]; occupies: string[]; requirements: Array<{ type: string; skillID?: string; level?: number }>; stats: Array<{ key: string; value: number }> };
export type CatalogItem = { name: string; kind: string; supported: boolean; project_supported?: boolean; heal?: number } & Partial<Equipment>;
export const COMBAT_CATALOG = catalog as { version: number; sha256: string; hp_multiplier: number; items: Record<string, CatalogItem> };
export const WOODEN_EQUIPMENT = [
	{ item_id: 'multiplayer:Wooden_Sword', name: 'Wooden Sword', slot: 'Weapon', tier: 0, unlock_only: false,
		occupies: [], requirements: [], stats: [{ key: 'attackSpeed', value: 2400 }, { key: 'stabAttackBonus', value: 1 }, { key: 'slashAttackBonus', value: 1 }, { key: 'blockAttackBonus', value: 1 }] },
	{ item_id: 'multiplayer:Wooden_Shield', name: 'Wooden Shield', slot: 'Shield', tier: 0, unlock_only: false,
		occupies: [], requirements: [], stats: [{ key: 'meleeDefenceBonus', value: 2 }] }
];
for (const item of WOODEN_EQUIPMENT) COMBAT_CATALOG.items[item.item_id] = {
	name: item.name, kind: 'Equipment', supported: true, slots: [item.slot], occupies: item.occupies,
	requirements: item.requirements, stats: item.stats
};
export type Registration = { levels: { attack: number; strength: number; defence: number; hitpoints: number }; gear: Record<string, string> };
export function parse_registration(value: unknown): Registration | null {
	if (!value || typeof value !== 'object') return null;
	const input = value as Registration;
	const levels = {} as Registration['levels'];
	for (const skill of ['attack', 'strength', 'defence', 'hitpoints'] as const) {
		const level = input.levels?.[skill];
		if (!Number.isSafeInteger(level) || level < 1) return null;
		levels[skill] = Math.min(99, level);
	}
	if (!input.gear || typeof input.gear !== 'object' || Array.isArray(input.gear)) return null;
	const gear: Record<string, string> = {};
	const occupied = new Set<string>();
	for (const [slot, id] of Object.entries(input.gear)) {
		const item = typeof id === 'string' ? COMBAT_CATALOG.items[id] : undefined;
		if (!item?.supported || !item.slots?.includes(slot) || occupied.has(slot)) return null;
		for (const requirement of item.requirements ?? []) {
			const skill = requirement.skillID?.split(':')[1]?.toLowerCase() as keyof typeof levels;
			if (requirement.type !== 'SkillLevel' || !Number.isFinite(requirement.level) || !(skill in levels) || levels[skill] < requirement.level!) return null;
		}
		gear[slot] = id;
		occupied.add(slot);
	}
	for (const [slot, id] of Object.entries(gear)) for (const blocked of COMBAT_CATALOG.items[id].occupies ?? []) {
		if (blocked !== slot && occupied.has(blocked)) return null;
	}
	return { levels, gear };
}
export function registration_stats(registration: Registration, stance = 'accurate') {
	const stats: Record<string, number> = {};
	for (const id of Object.values(registration.gear)) for (const stat of COMBAT_CATALOG.items[id].stats ?? []) stats[stat.key] = (stats[stat.key] ?? 0) + stat.value;
	const style: MeleeStyle = stance === 'aggressive' || stance === 'defensive' ? stance : 'accurate';
	const levels = effective_melee_levels(registration.levels, style);
	const accuracyBonus = style === 'aggressive' ? stats.slashAttackBonus ?? 0 :
		style === 'defensive' ? stats.blockAttackBonus ?? 0 : stats.stabAttackBonus ?? 0;
	const numberMultiplier = COMBAT_CATALOG.hp_multiplier;
	const resistance = Math.max(0, Math.min(95, stats.resistance ?? 0));
	return {
		attack_type: 'melee' as const,
		interval: native_attack_interval(stats.attackSpeed),
		min_hit: 1,
		max_hit: standard_melee_max_hit(levels.strength, stats.meleeStrengthBonus ?? 0, numberMultiplier),
		accuracy: standard_stat(levels.attack, accuracyBonus),
		evasion: {
			melee: standard_evasion(levels.defence, stats.meleeDefenceBonus ?? 0),
			ranged: standard_evasion(levels.defence, stats.rangedDefenceBonus ?? 0),
			magic: standard_magic_evasion(levels.defence, 1, stats.magicDefenceBonus ?? 0)
		},
		resistance
	};
}
