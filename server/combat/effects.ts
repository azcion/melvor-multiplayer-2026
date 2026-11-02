export const EFFECT_IDS = ['poison', 'bleed', 'burn', 'slow', 'freeze'] as const;
export type EffectID = typeof EFFECT_IDS[number];
export type ActiveEffect = { id: EffectID; source: string; lifetime?: 'persistent'; expires_tick: number | null; remaining_attacks: number | null; next_pulse_tick: number | null; remainder: number };
export type EffectActor = {
	hp: number; max_hp: number; stats: { max_hit: number }; effects: ActiveEffect[];
	base_interval_ticks: number; interval: number; next_attack: number;
	effect_resistance: number; effect_cap_percent: number; effect_cap_tick: number; effect_damage_this_tick: number;
};
export function is_effect(value: unknown): value is EffectID { return EFFECT_IDS.some(id => id === value); }

// Millisecond fields are snapshot/animation compatibility projections; mechanics use ticks.
export function update_speed(actor: EffectActor, tick: number, step_ms: number) {
	const rate = 1 + [...new Set(actor.effects.map(effect => effect.id))].reduce((sum, id) => sum + ({ poison: 0, bleed: 0, burn: .25, slow: -.25, freeze: -.1 })[id], 0);
	const interval = Math.ceil(actor.base_interval_ticks / Math.max(.1, rate)) * step_ms;
	if (interval === actor.interval) return;
	const remaining = Math.max(0, actor.next_attack / step_ms - tick);
	actor.next_attack = (tick + Math.ceil(remaining * interval / actor.interval)) * step_ms;
	actor.interval = interval;
}
export function apply_effect(actor: EffectActor, id: EffectID, source: string, tick: number, step_ms: number, lifetime?: 'persistent'): boolean {
	if (actor.hp <= 0 || actor.effects.some(effect => effect.id === id &&
		(lifetime === 'persistent' ? effect.lifetime === lifetime && effect.source === source : effect.lifetime !== 'persistent'))) return false;
	actor.effects.push({ id, source, ...(lifetime ? { lifetime } : {}), expires_tick: !lifetime && id === 'poison' ? tick + 50 : null,
		remaining_attacks: lifetime || id === 'poison' ? null : 2,
		next_pulse_tick: id === 'poison' || id === 'burn' ? tick + 5 : null, remainder: 0 });
	update_speed(actor, tick, step_ms);
	return true;
}

// Current victim stats are used at each trigger. Fractional damage carries within an application.
// Resistance applies before the shared per-tick boss cap. Capped damage is discarded, never banked.
export function effect_damage(actor: EffectActor, effect: ActiveEffect, raw: number, tick: number): number {
	const exact = raw * (1 - actor.effect_resistance) + effect.remainder;
	const whole = Math.floor(exact + 1e-9);
	effect.remainder = Math.max(0, exact - whole);
	if (actor.effect_cap_tick !== tick) { actor.effect_cap_tick = tick; actor.effect_damage_this_tick = 0; }
	const cap = actor.effect_cap_percent > 0 ? Math.floor(actor.max_hp * actor.effect_cap_percent / 100) : Infinity;
	const amount = Math.max(0, Math.min(whole, cap - actor.effect_damage_this_tick));
	actor.effect_damage_this_tick += amount;
	return amount;
}
export type EffectPacket = { kind: string; actor: string; amount: number };
export function trigger_effects(actor: EffectActor, tick: number, attack: boolean, step_ms: number): EffectPacket[] {
	const packets: EffectPacket[] = [];
	const damaged = new Set<EffectID>();
	for (const effect of actor.effects) {
		let raw = 0;
		if (attack) {
			if (effect.id === 'bleed') raw = actor.stats.max_hit * .1;
			if (effect.id === 'freeze') raw = actor.max_hp * .1;
			if (effect.remaining_attacks !== null) effect.remaining_attacks--;
		} else if (effect.next_pulse_tick !== null && tick >= effect.next_pulse_tick) {
			raw = (effect.id === 'poison' ? actor.max_hp : actor.hp) * .01;
			effect.next_pulse_tick += 5;
		}
		const primary = actor.effects.find(other => other.id === effect.id && other.lifetime === 'persistent') ?? actor.effects.find(other => other.id === effect.id);
		if (raw > 0 && effect === primary && !damaged.has(effect.id)) {
			damaged.add(effect.id);
			packets.push({ kind: effect.id, actor: effect.source, amount: effect_damage(actor, effect, raw, tick) });
		}
	}
	// Poison includes its final pulse on tick 50. Attack effects include the second attack.
	actor.effects = actor.effects.filter(effect => effect.remaining_attacks !== 0 && (effect.expires_tick === null || tick < effect.expires_tick));
	update_speed(actor, tick, step_ms);
	return packets;
}
export function clear_effects(actor: EffectActor, tick: number, step_ms: number) {
	actor.effects = [];
	update_speed(actor, tick, step_ms);
}

// Removing an environmental source leaves independent attack-inflicted effects intact.
export function remove_effect_source(actor: EffectActor, source: string, tick: number, step_ms: number) {
	actor.effects = actor.effects.filter(effect => effect.source !== source);
	update_speed(actor, tick, step_ms);
}
