import { apply_chamber_effects } from './chambers';
import { practice_selection } from './practice';
import { golbin_waves, GOLBIN_INTERVAL_OFFSETS, DUNGEONS, tidal_waves, TIDAL_PROFILES, mire_waves, MIRE_PROFILES, quarry_waves, QUARRY_PROFILES } from './raids';
import { refresh_stance, command, create_registered_arena, is_encounter, step, STEP_MS, type Arena, type Encounter, type RunState } from './engine';
import type { Registration } from './catalog';

export const RESPAWN_MS = 3000;
export type RunMode = RunState['mode'];
export function valid_run(encounter: unknown, mode: unknown): encounter is Encounter {
	if (practice_selection(encounter)) return mode === 'once';
	return is_encounter(encounter) && ((!['tidal','mire','quarry'].includes(encounter) && (mode === 'once' || mode === 'repeat')) ||
		(mode === 'raid' && !!DUNGEONS[encounter]) ||
		(mode === 'playlist' && (encounter === 'plants' || encounter === 'golbins')));
}
function wave(selection: Encounter, mode: RunMode, stage: number): { encounter: Encounter; count: number } {
	if (mode === 'playlist' && selection === 'golbins')
		return { encounter: (['golbin', 'golbin_scout', 'mind_golbin', 'golbins'] as const)[stage], count: 6 };
	return { encounter: selection, count: selection === 'plants' ? (mode === 'playlist' ? stage + 1 : mode === 'repeat' ? 1 : 6) : 6 };
}
export function create_run(registration: Registration, food: { heal: number; auto_eat?: boolean }, id: string,
	selection: Encounter, mode: RunMode, endpoint = 1): Arena {
	const first = wave(selection, mode, 0);
	const arena = create_registered_arena(registration, food, id, first.encounter, first.count);
	arena.run = { mode, selection, phase: 'respawning', stage: 0,
		stages: practice_selection(selection)?.definition.waves.length ?? (selection === 'tutorial_7' ? 2 : mode === 'playlist' ? (selection === 'plants' ? 6 : 4) : 1),
		completed: 0, respawn_ms: RESPAWN_MS, remaining_ms: RESPAWN_MS };
	if (mode === 'raid') {
		if (!Number.isInteger(endpoint) || endpoint < 1 || endpoint > DUNGEONS[selection].tiers.length) throw new RangeError('Invalid raid endpoint');
		arena.run!.raid_endpoint = endpoint;
		arena.run!.stages = DUNGEONS[selection].boundaries[endpoint - 1];
		arena.run!.total_ms = 0;
		configure_raid_wave(arena);
	}
	return arena;
}
function configure_raid_wave(arena: Arena) {
	const run = arena.run!;
	const tier = DUNGEONS[run.selection].tiers.find((_, index) => run.stage < DUNGEONS[run.selection].boundaries[index])!;
	arena.chamber_effects = tier.chamber_effects ?? [];
	if (run.selection === 'mire' || run.selection === 'quarry') {
		const quarry = run.selection === 'quarry';
		const wave = (quarry ? quarry_waves : mire_waves)(run.raid_endpoint!)[run.stage];
		const template = create_registered_arena(arena.registration!, { heal: 0 }, arena.id, 'golbins').enemies[0];
		arena.ruleset = DUNGEONS[run.selection].ruleset;
		run.tier = wave.tier;
		arena.enemies = wave.counts.flatMap((count, type) => Array.from({length: count}, (_, i) => {
			const profile = (quarry ? QUARRY_PROFILES : MIRE_PROFILES)[type], actor = structuredClone(template);
			actor.id = profile.id + '_' + (i + 1);
			actor.hp = actor.max_hp = profile.hp;
			for (const key of ['attack','strength','defence','ranged','magic'] as const) actor.levels![key] = profile.level;
			actor.levels!.attack = profile.attack_level;
			actor.base_damage = { min_hit: 1, max_hit: Math.floor(profile.max_hit * (DUNGEONS[run.selection].tiers[wave.tier - 1].damage_multiplier ?? 1)) };
			actor.interval = profile.interval;
			actor.base_interval_ticks = profile.interval / STEP_MS;
			if ('bronze_corrosion' in profile) actor.bronze_corrosion = profile.bronze_corrosion;
			if ('effect' in profile) actor.on_hit_effect = profile.effect;
			if ('on_hit_effects' in profile) actor.on_hit_effects = profile.on_hit_effects;
			return actor;
		}));
		arena.player.possible_effects = [...new Set(arena.enemies.flatMap(actor => actor.on_hit_effects?.map(entry => entry.effect) ?? (actor.on_hit_effect ? [actor.on_hit_effect] : [])))];
		arena.target = arena.enemies[0].id;
		refresh_stance(arena);
		return;
	}
	const tidal = run.selection === 'tidal';
	const wave = (tidal ? tidal_waves(run.raid_endpoint!) : golbin_waves(run.raid_endpoint!))[run.stage];
	const templates = create_registered_arena(arena.registration!, { heal: 0 }, arena.id, 'golbins').enemies;
	arena.ruleset = DUNGEONS[run.selection].ruleset;
	run.tier = wave.tier;
	arena.enemies = wave.counts.flatMap((count, type) => Array.from({ length: count }, (_, i) => {
		const actor = structuredClone(templates[tidal ? 0 : type]);
		const profile = tidal ? TIDAL_PROFILES[type] : golbin_waves(run.raid_endpoint!)[run.stage].profile;
		if (tidal) actor.id = TIDAL_PROFILES[type].id;
		actor.id += '_' + (i + 1);
		actor.hp = actor.max_hp = profile.hp;
		for (const key of ['attack','strength','defence','ranged','magic'] as const) actor.levels![key] = profile.level;
		if (tidal) for (const key of ['attack','ranged','magic'] as const) actor.levels![key] = TIDAL_PROFILES[type].attack_level;
		actor.base_damage = { min_hit: 1, max_hit: profile.max_hit };
		actor.interval = profile.interval + (tidal ? 0 : GOLBIN_INTERVAL_OFFSETS[actor.stats.attack_type]); actor.base_interval_ticks = actor.interval / STEP_MS;
		return actor;
	}));
	arena.target = arena.enemies[0].id;
	refresh_stance(arena);
}

export function run_command(arena: Arena, kind: unknown, target: unknown): boolean {
	// Stance, eating and stopping remain available between enemies; targeting waits for a spawn.
	if (arena.run?.phase === 'respawning' && kind === 'target') return false;
	return command(arena, kind, target);
}

export function step_run(arena: Arena, random = Math.random): void {
	if (arena.status !== 'active') return;
	const run = arena.run;
	if (!run) { step(arena, random); return; }
	if (run.mode === 'raid') run.total_ms = (run.total_ms ?? 0) + STEP_MS;
	if (run.phase === 'respawning') {
		arena.elapsed_ms += STEP_MS;
		run.remaining_ms = Math.max(0, run.remaining_ms - STEP_MS);
		if (run.remaining_ms === 0) {
			run.phase = 'fighting';
			apply_chamber_effects(arena.player, arena.chamber_effects ?? [], arena.registration!, arena.elapsed_ms / STEP_MS, STEP_MS);
			// Neither actor gets a partially charged attack during the respawn countdown.
			for (const [index, actor] of [arena.player, ...arena.enemies].entries())
				actor.next_attack = arena.elapsed_ms + actor.interval + ((['tidal','mire','quarry'].includes(run.selection) || practice_selection(run.selection)) && index ? (index - 1) * 200 : 0);
		}
		return;
	}
	step(arena, random);
	if ((arena.status as Arena['status']) !== 'victory') return;
	run.completed++;
	if (run.mode === 'raid' && run.completed === run.stages) return;
	if (run.mode === 'once' && run.completed === run.stages) return;
	const stage = (run.stage + 1) % run.stages;
	const next = wave(run.selection, run.mode, stage);
	const fresh = create_registered_arena(arena.registration!, { heal: arena.food_policy.heal, auto_eat: arena.food_policy.auto_eat_percent > 0 }, arena.id, next.encounter, next.count, stage);
	fresh.player.hp = arena.player.hp;
	if (run.selection === 'tutorial_7') {
		const opponent = fresh.enemies[0];
		opponent.id = 'tutorial_7_2'; opponent.levels!.defence = 1;
		opponent.base_damage = { min_hit: 0, max_hit: 4 };
		opponent.interval = 6500; opponent.base_interval_ticks = 65;
		fresh.target = opponent.id;
		refresh_stance(fresh);
	}
	fresh.food_used = arena.food_used;
	fresh.food_id = arena.food_id;
	// Carry any remaining eating cooldown; elapsed time resets for each bounded fight.
	fresh.next_eat = Math.max(0, arena.next_eat - arena.elapsed_ms / STEP_MS);
	command(fresh, 'stance', arena.stance);
	fresh.run = { ...run, stage, phase: 'respawning', remaining_ms: RESPAWN_MS };
	if (run.mode === 'raid') configure_raid_wave(fresh);
	Object.assign(arena, fresh);
}
