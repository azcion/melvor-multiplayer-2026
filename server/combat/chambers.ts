import { COMBAT_CATALOG, type Registration } from './catalog';
import { apply_effect, remove_effect_source, type EffectActor, type EffectID } from './effects';

// Data-only, server-owned definitions. Omit equipment to apply an unconditional chamber effect.
export type ChamberEffect = {
	id: string; effect: EffectID;
	equipment?: { material: string; slots: readonly string[] };
};
export function chamber_effect_matches(definition: ChamberEffect, registration: Registration): boolean {
	const condition = definition.equipment;
	return !condition || condition.slots.some(slot => {
		const id = registration.gear[slot];
		return !!id && COMBAT_CATALOG.items[id]?.supported === true && id.startsWith('melvorD:' + condition.material + '_');
	});
}
export function chamber_source(definition: ChamberEffect) { return 'chamber:' + definition.id; }
export function apply_chamber_effects(actor: EffectActor, definitions: readonly ChamberEffect[], registration: Registration, tick: number, step_ms: number) {
	for (const definition of definitions) {
		const source = chamber_source(definition);
		if (chamber_effect_matches(definition, registration)) apply_effect(actor, definition.effect, source, tick, step_ms, 'persistent');
		else remove_effect_source(actor, source, tick, step_ms);
	}
}
