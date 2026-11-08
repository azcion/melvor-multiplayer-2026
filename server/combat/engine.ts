import type { ChamberEffect } from './chambers';
import { apply_effect, clear_effects, trigger_effects, type EffectActor, type EffectID } from './effects';
import { favorable_damage_order } from './damage';
import { COMBAT_CATALOG, registration_stats, type Registration } from './catalog';
import { standard_stat, standard_melee_max_hit, hit_chance, apply_player_outgoing_damage, apply_player_incoming_damage } from './melee-math';
export const RULESET = 'arena-1';
export const STEP_MS = 100;
export const SNAPSHOT_MS = 200;
export const LOADOUTS = {
	sword: { interval: 2400, damage: 12 },
	bow: { interval: 1800, damage: 9 },
	staff: { interval: 3000, damage: 18 }
} as const;
type Loadout = keyof typeof LOADOUTS;
type CombatStats = { attack_type: 'melee' | 'ranged' | 'magic'; min_hit: number; max_hit: number; hit_chance: number };
export type EnemyLevels = { defence: number; strength: number; ranged: number; magic: number; attack: number; hitpoints: number };
export const ENCOUNTERS = ['golbin', 'golbin_scout', 'mind_golbin', 'golbins', 'tidal', 'mire', 'quarry', 'plants', 'tutorial_1', 'tutorial_2', 'tutorial_3', 'tutorial_4', 'tutorial_5', 'tutorial_6', 'tutorial_7'] as const;
export type Encounter = typeof ENCOUNTERS[number];
export const SUPPORTED_ENCOUNTERS = [...ENCOUNTERS];
export function is_encounter(value: unknown): value is Encounter { return typeof value === 'string' && ENCOUNTERS.some(id => id === value); }
// Effects this actor can receive during this battle, from opponents or itself.
export type Actor = EffectActor & { possible_effects: EffectID[]; on_hit_effect?: EffectID; on_hit_effects?: readonly { effect: EffectID; chance: number }[]; bronze_corrosion?: boolean; player_max_hit?: number; levels?: EnemyLevels; base_damage?: { min_hit: number; max_hit: number }; id: string; hp: number; max_hp: number; interval: number; next_attack: number; stats: CombatStats };
const BRONZE_ITEMS = new Set(Object.entries(COMBAT_CATALOG.items)
	.filter(([id, item]) => item.supported && id.startsWith('melvorD:Bronze_')).map(([id]) => id));
// Corrosion is Bronze-specific, independent of purchased access or other material ranks.
function player_damage(arena: Arena, target: Actor, raw: number) {
	const amount = arena.registration ? apply_player_outgoing_damage(raw, 'melee', target.stats.attack_type, 0) : raw;
	return target.bronze_corrosion && BRONZE_ITEMS.has(arena.registration?.gear.Weapon ?? '') ? Math.min(1, amount) : amount;
}
const effect_defaults = (interval_ticks: number) => ({ effects: [], possible_effects: [] as EffectID[], base_interval_ticks: interval_ticks,
	effect_resistance: 0, effect_cap_percent: 0, effect_cap_tick: -1, effect_damage_this_tick: 0 });
const FOOD_POLICY = { heal: 45, auto_eat_percent: 40, cooldown_ticks: 10 } as const;
export type Build = { loadout: Loadout; attack: number; strength: number; defence: number; hitpoints: number };
export type RunState = {
	mode: 'once' | 'repeat' | 'playlist' | 'raid'; selection: Encounter; phase: 'respawning' | 'fighting';
	raid_endpoint?: number; tier?: number; total_ms?: number;
	stage: number; stages: number; completed: number; respawn_ms: number; remaining_ms: number;
};
export type Arena = {
	run?: RunState; chamber_effects?: readonly ChamberEffect[];
	id: string; ruleset: string; elapsed_ms: number; step_ms: number; status: 'active' | 'victory' | 'defeat' | 'draw' | 'fled' | 'expired';
	build: Build; player: Actor; enemies: Actor[]; target: string; food: number; food_used: number; food_id: string; next_eat: number; food_policy: { heal: number; auto_eat_percent: number; cooldown_ticks: number };
	log: Array<{ id: number; elapsed_ms: number; kind: string; actor: string; target: string; amount: number }>;
	encounter?: Encounter; event_id: number; stance: string; registration?: Registration;
};

export function parse_build(value: unknown): Build | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const input = value as Record<string, unknown>;
	if (!Object.hasOwn(LOADOUTS, String(input.loadout))) return null;
	const build = { loadout: input.loadout } as Build;
	for (const key of ['attack', 'strength', 'defence', 'hitpoints'] as const) {
		const level = input[key];
		if (typeof level !== 'number' || !Number.isSafeInteger(level) || level < 1) return null;
		build[key] = Math.min(level, 99);
	}
	return build;
}

export function create_arena(build: Build, id: string = crypto.randomUUID()): Arena {
	const hp = 100 + build.hitpoints * 2;
	const player_stats: CombatStats = {
		attack_type: ({ sword: 'melee', bow: 'ranged', staff: 'magic' } as const)[build.loadout],
		min_hit: 1, max_hit: LOADOUTS[build.loadout].damage + Math.floor(build.strength / 4),
		hit_chance: Math.min(0.95, 0.65 + build.attack / 330)
	};
	const enemy_stats: CombatStats = { attack_type: 'melee', min_hit: 5, max_hit: 19, hit_chance: Math.max(0.35, 0.85 - build.defence / 220) };
	return {
		id, ruleset: RULESET, elapsed_ms: 0, step_ms: STEP_MS, status: 'active', build: { ...build },
		player: { ...effect_defaults(LOADOUTS[build.loadout].interval / STEP_MS), id: 'player', hp, max_hp: hp, interval: LOADOUTS[build.loadout].interval, next_attack: LOADOUTS[build.loadout].interval, stats: player_stats },
		enemies: [
			{ ...effect_defaults(24), id: 'sentinel', hp: 240, max_hp: 240, interval: 2400, next_attack: 2400, stats: { ...enemy_stats } },
			{ ...effect_defaults(18), id: 'scout', hp: 160, max_hp: 160, interval: 1800, next_attack: 1800, stats: { ...enemy_stats } }
		], target: 'sentinel', food: 1, food_used: 0, food_id: '', food_policy: { ...FOOD_POLICY }, next_eat: 0, log: [], event_id: 0, stance: 'accurate'
	};
}

function record(arena: Arena, kind: string, actor: string, target: string, amount = 0) {
	arena.log.push({ id: ++arena.event_id, elapsed_ms: arena.elapsed_ms, kind, actor, target, amount });
	if (arena.log.length > 12) arena.log.shift();
}

function eat(arena: Arena, manual: boolean) {
	if (arena.food <= 0 || arena.player.hp <= 0 || (!manual && arena.player.hp >= arena.player.max_hp)) return false;
	const amount = Math.min(arena.food_policy.heal, arena.player.max_hp - arena.player.hp);
	arena.player.hp += amount;
	arena.food_used++;
	if (manual) arena.player.next_attack = arena.elapsed_ms + arena.player.interval;
	record(arena, 'heal', 'player', 'player', amount);
	return true;
}

export function command(arena: Arena, kind: unknown, target: unknown): boolean {
	if (arena.status !== 'active') return false;
	if (kind === 'target' && arena.enemies.some(enemy => enemy.id === target && enemy.hp > 0)) {
		arena.target = target as string;
		refresh_stance(arena);
		return true;
	}
	if (kind === 'eat' && arena.elapsed_ms / STEP_MS >= arena.next_eat) {
		if (!eat(arena, true)) return false;
		arena.next_eat = arena.elapsed_ms / STEP_MS + arena.food_policy.cooldown_ticks;
		return true;
	}
	if (kind === 'stance' && arena.registration && ['accurate', 'aggressive', 'defensive'].includes(String(target))) {
		if (arena.stance === target) return false;
		arena.stance = String(target);
		refresh_stance(arena);
		// Switching costs a full attack cycle; repeated switches cannot grant free attacks.
		arena.player.next_attack = arena.elapsed_ms + arena.player.interval;
		return true;
	}
	if (kind === 'flee') { arena.status = 'fled'; cleanup(arena); return true; }
	return false;
}

export type DamagePacket = { kind: string; actor: string; amount: number };
export function resolve_player_damage(arena: Arena, packets: DamagePacket[]) {
	const tick = arena.elapsed_ms / STEP_MS;
	const threshold = Math.floor(arena.player.max_hp * arena.food_policy.auto_eat_percent / 100);
	const auto_eat = () => {
		if (tick < arena.next_eat || arena.player.hp <= 0 || arena.player.hp > threshold || arena.food <= 0 || arena.food_policy.heal <= 0) return;
		eat(arena, false);
		arena.next_eat = tick + arena.food_policy.cooldown_ticks;
	};
	const order = favorable_damage_order(arena.player.hp, arena.player.max_hp, packets.map(packet => packet.amount), arena.food,
		arena.food_policy.heal, tick >= arena.next_eat, arena.food_policy.auto_eat_percent);
	for (const index of order) {
		auto_eat();
		const packet = packets[index];
		const amount = Math.min(arena.player.hp, packet.amount);
		arena.player.hp -= amount;
		record(arena, packet.kind, packet.actor, 'player', amount);
		if (arena.player.hp <= 0) { arena.status = 'defeat'; return; }
	}
	auto_eat();
}

// Only the service scheduler calls this. Client messages cannot supply ticks, HP or damage.
export function step(arena: Arena, random = Math.random): void {
	if (arena.status !== 'active') return;
	const now = arena.elapsed_ms += STEP_MS;
	if (now / STEP_MS >= 3000) { arena.status = 'expired'; cleanup(arena); return; }
	const tick = now / STEP_MS;
	// Freeze eligibility before any damage: every living actor gets its due attack.
	const living = arena.enemies.filter(enemy => enemy.hp > 0);
	const outgoing: { enemy: Actor; packet: DamagePacket }[] = [];
	const incoming: DamagePacket[] = trigger_effects(arena.player, tick, false, STEP_MS);
	for (const enemy of living) {
		for (const packet of trigger_effects(enemy, tick, false, STEP_MS)) outgoing.push({ enemy, packet });
	}
	const target = living.find(enemy => enemy.id === arena.target) ?? living[0];
	if (target && arena.target !== target.id) { arena.target = target.id; refresh_stance(arena); }
	if (target && now >= arena.player.next_attack) {
		arena.player.next_attack = now + arena.player.interval;
		const stats = arena.player.stats;
		const hit = random() < stats.hit_chance;
		const raw = arena.player.base_damage ?? stats;
		const rolled = hit ? raw.min_hit + Math.floor(random() * (raw.max_hit - raw.min_hit + 1)) : 0;
		const amount = Math.min(target.hp, player_damage(arena, target, rolled));
		outgoing.push({ enemy: target, packet: { kind: 'attack', actor: 'player', amount } });
		incoming.push(...trigger_effects(arena.player, tick, true, STEP_MS));

	}
	for (const enemy of living) {
		if (now < enemy.next_attack) continue;
		enemy.next_attack = now + enemy.interval;
		const stats = enemy.stats;
		const hit = random() < stats.hit_chance;
		const raw = enemy.base_damage ?? stats;
		const rolled = hit ? raw.min_hit + Math.floor(random() * (raw.max_hit - raw.min_hit + 1)) : 0;
		const amount = arena.registration ? apply_player_incoming_damage(rolled, 'melee', stats.attack_type, registration_stats(arena.registration, arena.stance).resistance) : rolled;
		incoming.push({ kind: 'attack', actor: enemy.id, amount });
		if (hit) {
			// One categorical roll: a blocked/non-refreshing result never rerolls into another effect.
			const effects = enemy.on_hit_effects ?? (enemy.on_hit_effect ? [{ effect: enemy.on_hit_effect, chance: .35 }] : []);
			if (effects.length) {
				let roll = random();
				for (const { effect, chance } of effects) {
					if (roll < chance) {
						if (apply_effect(arena.player, effect, enemy.id, tick, STEP_MS)) record(arena, 'apply_' + effect, enemy.id, 'player');
						break;
					}
					roll -= chance;
				}
			}
		}
		for (const packet of trigger_effects(enemy, tick, true, STEP_MS)) outgoing.push({ enemy, packet });
	}
	for (const { enemy, packet } of outgoing) damage_enemy(arena, enemy, packet);
	resolve_player_damage(arena, incoming);
	if (arena.enemies.every(enemy => enemy.hp <= 0)) arena.status = arena.player.hp <= 0 ? 'draw' : 'victory';
	if (arena.status !== 'active') cleanup(arena);
}

function damage_enemy(arena: Arena, enemy: Actor, packet: DamagePacket) {
	const amount = Math.min(enemy.hp, packet.amount);
	enemy.hp -= amount;
	record(arena, packet.kind, packet.actor, enemy.id, amount);
	if (enemy.hp <= 0) clear_effects(enemy, arena.elapsed_ms / STEP_MS, STEP_MS);
}
function cleanup(arena: Arena) {
	for (const actor of [arena.player, ...arena.enemies]) clear_effects(actor, arena.elapsed_ms / STEP_MS, STEP_MS);
}
export function refresh_stance(arena: Arena) {
	if (!arena.registration) return;
	const stats = registration_stats(arena.registration, arena.stance);
	const without_bronze_armor = arena.enemies.some(enemy => enemy.bronze_corrosion) ? registration_stats({
		...arena.registration, gear: Object.fromEntries(Object.entries(arena.registration.gear)
			.filter(([slot, id]) => slot === 'Weapon' || !BRONZE_ITEMS.has(id)))
	}, arena.stance) : stats;
	arena.player.base_damage = { min_hit: stats.min_hit, max_hit: stats.max_hit };
	for (const enemy of arena.enemies) {
		const levels = enemy.levels!;
		const offensive = levels[enemy.stats.attack_type === 'melee' ? 'attack' : enemy.stats.attack_type];
		const evasion = enemy.bronze_corrosion ? without_bronze_armor.evasion : stats.evasion;
		enemy.stats.hit_chance = hit_chance(standard_stat(offensive, 0), evasion[enemy.stats.attack_type]);
		enemy.player_max_hit = player_damage(arena, enemy, stats.max_hit);
		const raw = enemy.base_damage!;
		enemy.stats.min_hit = apply_player_incoming_damage(raw.min_hit, 'melee', enemy.stats.attack_type, stats.resistance);
		enemy.stats.max_hit = apply_player_incoming_damage(raw.max_hit, 'melee', enemy.stats.attack_type, stats.resistance);
	}
	const target = arena.enemies.find(enemy => enemy.id === arena.target)!;
	arena.player.stats.hit_chance = hit_chance(stats.accuracy, standard_stat(target.levels!.defence, 0));
	arena.player.stats.min_hit = player_damage(arena, target, stats.min_hit);
	arena.player.stats.max_hit = player_damage(arena, target, stats.max_hit);
}

// Training actors have authored levels/timers and no equipment bonuses. Magic retains an authored
// spell maximum until spell support exists; melee and ranged use the native standard max-hit formula.
export function create_registered_arena(registration: Registration, food: { heal: number; auto_eat?: boolean }, id: string, encounter: Encounter = 'golbin', plant_count = 6): Arena {
	const arena = create_arena({ ...registration.levels, loadout: 'sword' }, id);
	const stats = registration_stats(registration);
	arena.ruleset = 'native-melee-1';
	arena.encounter = encounter;
	arena.registration = structuredClone(registration);
	arena.player.hp = arena.player.max_hp = registration.levels.hitpoints * 10;
	arena.player.interval = arena.player.next_attack = Math.ceil(stats.interval / STEP_MS) * STEP_MS;
	arena.player.base_interval_ticks = arena.player.interval / STEP_MS;
	arena.food = food.heal > 0 ? 1 : 0;
	arena.food_policy = { ...arena.food_policy, heal: food.heal, auto_eat_percent: food.auto_eat === true ? FOOD_POLICY.auto_eat_percent : 0 };
	const levels = (defence: number, strength: number, ranged: number, magic: number, attack: number, hitpoints: number): EnemyLevels => ({ defence, strength, ranged, magic, attack, hitpoints });
	const training = (id: string, attack_type: CombatStats['attack_type'], ticks: number, levels: EnemyLevels): Actor => {
		const power = levels[attack_type === 'melee' ? 'strength' : attack_type];
		const max_hit = attack_type === 'magic' ? power + 9 : standard_melee_max_hit(power, 0);
		return { ...effect_defaults(ticks), id, levels, hp: levels.hitpoints * 10, max_hp: levels.hitpoints * 10,
			interval: ticks * STEP_MS, next_attack: ticks * STEP_MS, base_damage: { min_hit: 1, max_hit },
			stats: { attack_type, min_hit: 1, max_hit, hit_chance: 0 } };
	};
	const golbins = [training('golbin', 'melee', 24, levels(1,1,1,1,2,2)),
		training('golbin_scout', 'ranged', 26, levels(3,1,3,1,1,2)),
		training('mind_golbin', 'magic', 28, levels(3,1,1,4,1,2))];
	arena.enemies = encounter === 'plants' ? Array.from({ length: Math.max(1, Math.min(6, Math.trunc(plant_count))) }, (_, i) => training('plant_' + (i + 1), 'melee', 100, levels(1,1,1,1,1,1))) :
		golbins.filter(enemy => (encounter === 'golbins' || encounter === 'tidal' || encounter === 'mire' || encounter === 'quarry') || enemy.id === encounter);
	if (encounter.startsWith('tutorial_')) {
		const index = Number(encounter.slice(9)) - 1;
		// HP controls teaching time without importing native monster progression.
		const hp = [95, 95, 95, 110, 110, 110, 95][index];
		const count = 1;
		arena.enemies = Array.from({ length: count }, (_, i) => {
			const actor = training(encounter, 'melee', index === 5 ? 65 : 55,
				levels(index === 2 || index === 6 ? 4 : 1, 1, 1, 1, 1, 1));
			actor.hp = actor.max_hp = hp;
			actor.base_damage = { min_hit: 0, max_hit: index === 0 ? 0 : index < 4 ? 1 : index === 5 ? 4 : 2 };
			return actor;
		});
	}
	arena.target = arena.enemies[0].id;
	refresh_stance(arena);
	return arena;
}
