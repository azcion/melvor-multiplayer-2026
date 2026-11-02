import { test, expect } from 'bun:test';
import { create_arena, create_registered_arena, command, step, STEP_MS } from '../../combat/engine';
import { apply_effect, trigger_effects, clear_effects, type EffectID } from '../../combat/effects';
const build = { loadout: 'sword' as const, attack: 99, strength: 99, defence: 99, hitpoints: 99 };
function actor() {
	const value = create_arena(build).player;
	value.hp = value.max_hp = 1000; value.stats.max_hit = 100;
	return value;
}

test('Poison pulses ten times, never refreshes, carries fractional damage and includes tick 50', () => {
	const target = actor(); target.hp = target.max_hp = 33;
	expect(apply_effect(target, 'poison', 'a', 0, STEP_MS)).toBe(true);
	let total = 0, pulses = 0;
	for (let tick = 1; tick <= 50; tick++) {
		if (tick === 25) expect(apply_effect(target, 'poison', 'b', tick, STEP_MS)).toBe(false);
		const packets = trigger_effects(target, tick, false, STEP_MS);
		total += packets.reduce((sum, packet) => sum + packet.amount, 0); pulses += packets.length;
	}
	expect(total).toBe(3); expect(pulses).toBe(10); expect(target.effects).toHaveLength(0);
});

test('Bleed and Freeze use current victim stats for exactly two attacks including misses', () => {
	for (const id of ['bleed', 'freeze'] as EffectID[]) {
		const target = actor(); apply_effect(target, id, 'a', 0, STEP_MS);
		expect(trigger_effects(target, 1, false, STEP_MS)).toHaveLength(0);
		expect(trigger_effects(target, 2, true, STEP_MS)[0].amount).toBe(id === 'bleed' ? 10 : 100);
		target.stats.max_hit = 200;
		expect(trigger_effects(target, 3, true, STEP_MS)[0].amount).toBe(id === 'bleed' ? 20 : 100);
		expect(trigger_effects(target, 4, true, STEP_MS)).toHaveLength(0);
	}
	const arena = create_arena(build); apply_effect(arena.player, 'bleed', 'a', 0, STEP_MS);
	arena.player.next_attack = 100; arena.enemies.forEach(enemy => enemy.next_attack = 99999);
	step(arena, () => .999); expect(arena.player.effects[0].remaining_attacks).toBe(1);
});

test('Burn pulses current HP and speed modifiers preserve attack progress, combine and expire', () => {
	const target = actor(); target.next_attack = 2400;
	apply_effect(target, 'burn', 'a', 12, STEP_MS);
	expect(target.interval).toBe(2000); expect(target.next_attack).toBe(2200);
	expect(trigger_effects(target, 17, false, STEP_MS)[0].amount).toBe(10);
	target.hp = 500;
	expect(trigger_effects(target, 22, false, STEP_MS)[0].amount).toBe(5);
	apply_effect(target, 'slow', 'b', 22, STEP_MS); expect(target.interval).toBe(2400);
	apply_effect(target, 'freeze', 'c', 22, STEP_MS); expect(target.interval).toBe(2700);
	trigger_effects(target, 23, true, STEP_MS); trigger_effects(target, 24, true, STEP_MS);
	expect(target.effects).toHaveLength(0); expect(target.interval).toBe(2400);
});

test('configured effect resistance and shared tick cap constrain different effects and sources', () => {
	const target = actor(); target.effect_resistance = .5; target.effect_cap_percent = 1;
	apply_effect(target, 'freeze', 'a', 0, STEP_MS); apply_effect(target, 'bleed', 'b', 0, STEP_MS);
	const packets = trigger_effects(target, 1, true, STEP_MS);
	expect(packets.map(packet => packet.amount)).toEqual([10, 0]);
	expect(trigger_effects(target, 2, true, STEP_MS).reduce((sum, p) => sum + p.amount, 0)).toBe(10);
	clear_effects(target, 2, STEP_MS); expect(target.interval).toBe(2400);
});

test('training encounters do not proc combat effects and native stance changes recompute stats', () => {
	const arena = create_registered_arena({ levels: build, gear: {} }, { heal: 30 }, 'test', 'golbin');
	expect(arena.ruleset).toBe('native-melee-1');
	expect(arena.enemies.map(enemy => enemy.id)).toEqual(['golbin']);
	arena.player.next_attack = 99999;
	arena.enemies[0].next_attack = 100;
	step(arena, () => 0);
	expect(arena.player.effects).toHaveLength(0);
	expect(arena.enemies[0].effects).toHaveLength(0);
	expect(arena.log.some(event => event.kind.startsWith('apply_'))).toBe(false);
	expect(command(arena, 'stance', 'forged')).toBe(false);
	const previous = arena.player.stats.max_hit;
	expect(command(arena, 'stance', 'aggressive')).toBe(true);
	expect(arena.player.stats.max_hit).toBeGreaterThan(previous);
	expect(arena.player.next_attack).toBe(arena.elapsed_ms + arena.player.interval);
	expect(command(arena, 'flee', null)).toBe(true);
	expect(arena.player.effects).toHaveLength(0);
});
