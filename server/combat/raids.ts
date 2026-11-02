import type { ChamberEffect } from './chambers';
// Authored challenges share one version with permanent grants and completion records.
export const GOLBIN_RULESET = 'golbin-2';
export const GOLBIN_TIERS = [
	{ waves: [[1,0,0],[0,1,0],[0,0,1],[1,1,1]], cap: 3, wins_required: 1, hp: 28, max_hit: 7, interval: 4000, level: 1 },
	{ waves: [[3,0,0],[0,3,0],[0,0,3],[2,2,2]], cap: 6, wins_required: 1, hp: 38, max_hit: 4, interval: 4200, level: 3 },
	{ waves: [[3,3,0],[0,6,0],[6,0,0]], cap: 9, wins_required: 1, hp: 60, max_hit: 8, interval: 4000, level: 6 }
] as const;
export const golbin_waves = (endpoint: number) => GOLBIN_TIERS.slice(0, endpoint).flatMap((tier, index) => tier.waves.map(counts => ({ counts, tier: index + 1, profile: tier })));
export const golbin_boundaries = GOLBIN_TIERS.map((_, i) => golbin_waves(i + 1).length);

// Small style offsets retain the tier's middle attack speed.
export const GOLBIN_INTERVAL_OFFSETS = { melee: -200, ranged: 0, magic: 200 } as const;

export const TIDAL_RULESET = 'tidal-2';
export const TIDAL_TIERS = [
	{ name: 'Nesting Ledges', cap: 12, wins_required: 1, food_cap: 2, waves: [[8,0,0],[6,2,0],[10,1,0]] },
	{ name: 'The Undertow', cap: 15, wins_required: 1, waves: [[12,0,0],[6,3,0],[0,0,8]] }
] as const;
export const TIDAL_PROFILES = [
	{ id: 'saltwing', hp: 20, max_hit: 6, interval: 2400, level: 7, attack_level: 50 },
	{ id: 'reefbreaker', hp: 85, max_hit: 22, interval: 3600, level: 9, attack_level: 65 },
	{ id: 'undertide_tendril', hp: 90, max_hit: 12, interval: 3600, level: 12, attack_level: 70 }
] as const;
export const tidal_waves = (endpoint: number) => TIDAL_TIERS.slice(0,endpoint).flatMap((tier,index) => tier.waves.map(counts => ({counts,tier:index+1})));
export const tidal_boundaries = TIDAL_TIERS.map((_,i) => tidal_waves(i+1).length);

export const MIRE_RULESET = 'mire-1';
export const MIRE_TIERS = [
	{ name: 'Shallow Pools', cap: 17, wins_required: 1, waves: [[3,0,0,0],[2,1,0,0]] },
	{ name: 'Feeding Ground', cap: 19, wins_required: 1, waves: [[3,0,1,0],[2,2,0,0]] },
	{ name: 'Drowned Root', cap: 21, wins_required: 1, waves: [[0,1,2,0],[2,1,0,1]] }
] as const;
export const MIRE_PROFILES = [
	{ id: 'blob', hp: 75, max_hit: 10, interval: 1400, level: 10, attack_level: 28, bronze_corrosion: true },
	{ id: 'bittertoad', hp: 65, max_hit: 8, interval: 2000, level: 15, attack_level: 35, effect: 'poison' as const },
	{ id: 'bogmaw', hp: 110, max_hit: 32, interval: 3200, level: 18, attack_level: 45 },
	{ id: 'drowned_root', hp: 200, max_hit: 20, interval: 1800, level: 20, attack_level: 45 }
] as const;
export const mire_waves = (endpoint: number) => MIRE_TIERS.slice(0,endpoint).flatMap((tier,index) => tier.waves.map(counts => ({counts,tier:index+1})));
export const mire_boundaries = MIRE_TIERS.map((_,i) => mire_waves(i+1).length);

export const QUARRY_RULESET = 'quarry-1';
export const IRON_HEAT: ChamberEffect = { id: 'iron_heat', effect: 'slow',
	equipment: { material: 'Iron', slots: ['Helmet','Platebody','Platelegs','Boots','Gloves','Shield'] } };
export const QUARRY_TIERS = [
	{ name: 'Cinder Approach', cap: 21, material_cap: 3, wins_required: 1, waves: [[2,1,0,0],[1,0,1,0]] },
	{ name: 'Furnace Galleries', cap: 23, damage_multiplier: 1.3, wins_required: 1, chamber_effects: [IRON_HEAT], waves: [[2,2,0,0],[1,1,1,0],[0,0,2,0]] },
	{ name: 'Molten Heart', cap: 25, damage_multiplier: 1.5, wins_required: 1, chamber_effects: [IRON_HEAT], waves: [[0,2,2,0],[2,0,1,0],[0,1,1,1]] }
] as const;
export const QUARRY_PROFILES = [
	{ id: 'cinder_snail', hp: 100, max_hit: 13, interval: 1800, level: 18, attack_level: 48 },
	{ id: 'kiln_wisp', hp: 55, max_hit: 12, interval: 1200, level: 15, attack_level: 50 },
	{ id: 'embercoil', hp: 130, max_hit: 22, interval: 2200, level: 20, attack_level: 52,
		on_hit_effects: [{ effect: 'poison' as const, chance: .20 }, { effect: 'burn' as const, chance: .15 }] },
	{ id: 'slagheart', hp: 280, max_hit: 55, interval: 3600, level: 24, attack_level: 60 }
] as const;
export const quarry_waves = (endpoint: number) => QUARRY_TIERS.slice(0,endpoint).flatMap((tier,index) => tier.waves.map(counts => ({counts,tier:index+1})));
export const quarry_boundaries = QUARRY_TIERS.map((_,i) => quarry_waves(i+1).length);

export type DungeonTier = { name?: string; cap: number; wins_required: number; food_cap?: number; material_cap?: number; damage_multiplier?: number; chamber_effects?: readonly ChamberEffect[] };
export type DungeonDefinition = { id: string; name: string; ruleset: string; requires?: string; tiers: readonly DungeonTier[]; boundaries: number[] };
export const DUNGEONS: Record<string, DungeonDefinition> = {
	quarry: { id: 'quarry', name: 'Cinder Quarry', ruleset: QUARRY_RULESET, requires: 'mire', tiers: QUARRY_TIERS, boundaries: quarry_boundaries },
	mire: { id: 'mire', name: 'Sinking Mire', ruleset: MIRE_RULESET, requires: 'tidal', tiers: MIRE_TIERS, boundaries: mire_boundaries },
	tidal: { id: 'tidal', name: 'Tidal Caverns', ruleset: TIDAL_RULESET, requires: 'golbins', tiers: TIDAL_TIERS, boundaries: tidal_boundaries },
	golbins: { id: 'golbins', name: 'Golbin Horde', ruleset: GOLBIN_RULESET, tiers: GOLBIN_TIERS, boundaries: golbin_boundaries }
};
