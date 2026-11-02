export type MeleeStyle = 'accurate' | 'aggressive' | 'defensive';
export type AttackType = 'melee' | 'ranged' | 'magic';
export type MeleeLevels = { attack: number; strength: number; defence: number };
export type EffectiveMeleeLevels = MeleeLevels;
export type CombatTriangle = {
	damageModifier: Record<AttackType, Record<AttackType, number>>;
	reductionModifier: Record<AttackType, Record<AttackType, number>>;
};

// melvorDemo.json (build 12097): Stab adds +6 Attack, Slash +6 Strength, Block +6 Defence.
export const MELEE_STYLE_LEVEL_BONUS: Record<MeleeStyle, Partial<MeleeLevels>> = {
	accurate: { attack: 6 },
	aggressive: { strength: 6 },
	defensive: { defence: 6 }
};

// CombatTriangleSet.normalSetData.Standard from combatTriangle.js (build 12097).
export const STANDARD_COMBAT_TRIANGLE: CombatTriangle = {
	damageModifier: {
		melee: { melee: 1, ranged: 1.1, magic: 0.85 },
		ranged: { melee: 0.85, ranged: 1, magic: 1.1 },
		magic: { melee: 1.1, ranged: 0.85, magic: 1 }
	},
	reductionModifier: {
		melee: { melee: 1, ranged: 1.25, magic: 0.75 },
		ranged: { melee: 0.95, ranged: 1, magic: 1.25 },
		magic: { melee: 1.25, ranged: 0.85, magic: 1 }
	}
};

export function effective_melee_levels(levels: MeleeLevels, style: MeleeStyle): EffectiveMeleeLevels {
	const bonus = MELEE_STYLE_LEVEL_BONUS[style];
	return {
		attack: levels.attack + (bonus.attack ?? 0),
		strength: levels.strength + (bonus.strength ?? 0),
		defence: levels.defence + (bonus.defence ?? 0)
	};
}

export function standard_stat(effective_level: number, equipment_bonus: number): number {
	return (effective_level + 9) * (equipment_bonus + 64);
}

export function standard_melee_max_hit(strength_level: number, strength_bonus: number, number_multiplier = 10): number {
	const effective_level = strength_level + 9;
	return Math.floor(number_multiplier * (
		1.3 + effective_level / 10 + strength_bonus / 80 + (effective_level * strength_bonus) / 640
	));
}

export function standard_evasion(defence_level: number, defence_bonus: number): number {
	return standard_stat(defence_level, defence_bonus);
}

export function standard_magic_evasion(defence_level: number, magic_level = 1, magic_bonus = 0): number {
	const effective_level = Math.floor(defence_level * 0.3 + magic_level * 0.7);
	return standard_stat(effective_level, magic_bonus);
}

export function hit_chance(accuracy: number, evasion: number): number {
	if (accuracy <= 0) return 0;
	if (evasion <= 0) return 1;
	const chance = accuracy < evasion
		? 0.5 * accuracy / evasion
		: 1 - (0.5 * evasion) / accuracy;
	return Math.max(0, Math.min(1, chance));
}

export function native_attack_interval(attack_speed: number | undefined, tick_interval = 50): number {
	const interval = attack_speed || 4000;
	// Native roundToTickInterval floors to the 50ms game tick before the 250ms minimum.
	return Math.max(250, Math.floor(interval / tick_interval) * tick_interval);
}

function clamp_resistance(resistance: number, cap = 95): number {
	return Math.max(0, Math.min(cap, resistance));
}

/** Player hits get the player-side triangle multiplier; resistance is applied before the final floor. */
export function apply_player_outgoing_damage(
	raw_damage: number,
	player_attack_type: AttackType,
	target_attack_type: AttackType,
	target_resistance: number,
	triangle: CombatTriangle = STANDARD_COMBAT_TRIANGLE
): number {
	const after_triangle = raw_damage * triangle.damageModifier[player_attack_type][target_attack_type];
	return Math.floor(after_triangle * (1 - clamp_resistance(target_resistance) / 100));
}

/** Enemy damage has no outgoing triangle multiplier. Player resistance is scaled by player-vs-enemy types. */
export function apply_player_incoming_damage(
	raw_damage: number,
	player_attack_type: AttackType,
	enemy_attack_type: AttackType,
	player_resistance: number,
	triangle: CombatTriangle = STANDARD_COMBAT_TRIANGLE
): number {
	const effective_resistance = clamp_resistance(
		player_resistance * triangle.reductionModifier[player_attack_type][enemy_attack_type]
	);
	return Math.floor(raw_damage * (1 - effective_resistance / 100));
}
