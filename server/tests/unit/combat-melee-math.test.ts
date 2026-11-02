import { test, expect } from 'bun:test';
import {
	apply_player_incoming_damage,
	apply_player_outgoing_damage,
	effective_melee_levels,
	hit_chance,
	native_attack_interval,
	standard_evasion,
	standard_magic_evasion,
	standard_melee_max_hit,
	standard_stat,
	STANDARD_COMBAT_TRIANGLE
} from '../../combat/melee-math';

test('native melee styles add six hidden levels to the selected skill', () => {
	const levels = { attack: 99, strength: 80, defence: 60 };
	expect(effective_melee_levels(levels, 'accurate')).toEqual({ attack: 105, strength: 80, defence: 60 });
	expect(effective_melee_levels(levels, 'aggressive')).toEqual({ attack: 99, strength: 86, defence: 60 });
	expect(effective_melee_levels(levels, 'defensive')).toEqual({ attack: 99, strength: 80, defence: 66 });
});

test('native standard accuracy, evasion and melee max-hit formulas preserve their rounding', () => {
	expect(standard_stat(105, 9)).toBe(8322);
	expect(standard_evasion(105, 0)).toBe(7296);
	expect(standard_magic_evasion(105, 1, 0)).toBe(2624);
	expect(standard_melee_max_hit(105, 5, 10)).toBe(136);
	expect(standard_melee_max_hit(99, 0, 10)).toBe(121);
});

test('native hit chance is returned as a 0..1 probability', () => {
	expect(hit_chance(50, 100)).toBe(0.25);
	expect(hit_chance(100, 50)).toBe(0.75);
	expect(hit_chance(100, 100)).toBe(0.5);
	expect(hit_chance(0, 100)).toBe(0);
	expect(hit_chance(100, 0)).toBe(1);
});

test('native attack intervals floor to 50ms ticks and clamp to 250ms', () => {
	expect(native_attack_interval(undefined)).toBe(4000);
	expect(native_attack_interval(2410)).toBe(2400);
	expect(native_attack_interval(230)).toBe(250);
});

test('standard combat triangle matches the official Standard matrix', () => {
	expect(STANDARD_COMBAT_TRIANGLE.damageModifier.melee).toEqual({ melee: 1, ranged: 1.1, magic: 0.85 });
	expect(STANDARD_COMBAT_TRIANGLE.reductionModifier.melee).toEqual({ melee: 1, ranged: 1.25, magic: 0.75 });
	expect(STANDARD_COMBAT_TRIANGLE.damageModifier.magic).toEqual({ melee: 1.1, ranged: 0.85, magic: 1 });
	expect(STANDARD_COMBAT_TRIANGLE.reductionModifier.ranged).toEqual({ melee: 0.95, ranged: 1, magic: 1.25 });
});

test('player outbound triangle and inbound resistance use distinct native paths', () => {
	// Player melee damage is triangle-modified, then target resistance is applied, then damage is floored.
	expect(apply_player_outgoing_damage(5, 'melee', 'ranged', 10)).toBe(4);
	// Enemy damage has no outgoing triangle multiplier; the player's resistance is modified instead.
	expect(apply_player_incoming_damage(5, 'melee', 'ranged', 10)).toBe(4);
	expect(apply_player_incoming_damage(5, 'melee', 'melee', 10)).toBe(4);
	// The standard resistance cap is 95%, even when a triangle multiplier would exceed it.
	expect(apply_player_incoming_damage(100, 'melee', 'ranged', 90)).toBe(5);
});
