import type { Database } from 'bun:sqlite';
import { EQUIPMENT_DEFINITIONS } from './equipment-recipes';
import { FOOD_DEFINITIONS } from './combat-food';
import { WOODEN_EQUIPMENT } from './combat/catalog';
import { record_audit_event } from './audit';
import { rollback_held } from './rollback-policy';

export const TUTORIAL_TRIALS = [
	{ id: 'tutorial_1', name: 'Training Partner', slot: 'Weapon', tier: 0, item: 'multiplayer:Wooden_Sword', reward: 1 },
	{ id: 'tutorial_2', name: 'Sparring Partner', slot: 'Shield', tier: 0, item: 'multiplayer:Wooden_Shield', reward: 1 },
	{ id: 'tutorial_3', name: 'Armoured Squire', slot: 'Weapon', tier: 1, item: 'melvorD:Bronze_Sword', reward: 2 },
	{ id: 'tutorial_4', name: 'Practice Partner', slot: 'Helmet', tier: 1, item: 'melvorD:Bronze_Helmet', reward: 1 },
	{ id: 'tutorial_5', name: 'Endurance Bout', slot: 'Food', tier: 1, item: 'melvorD:Shrimp', reward: 1 },
	{ id: 'tutorial_6', name: 'Heavy Hitter', slot: 'Shield', tier: 1, item: 'melvorD:Bronze_Shield', reward: 2 },
	{ id: 'tutorial_7', name: 'Final Assessment', slot: 'Shield', tier: 2, item: 'melvorD:Iron_Shield', reward: 0 }
] as const;
const tutorial_allowance = 1_000_000;

function remaining_ep_micros(victories: number, prepared: boolean) {
	return TUTORIAL_TRIALS.slice(victories).reduce((amount, trial) => amount + trial.reward * 1_000_000,
		prepared ? 0 : tutorial_allowance);
}

// The receipt transaction serializes this with battle settlement and admission.
export function skip_tutorial(database: Database, client: number, quote: unknown) {
	const row = database.query<{ victories: number }, [number]>('SELECT victories FROM combat_tutorial WHERE client_id=?').get(client);
	const victories = row?.victories ?? 0;
	if (victories === TUTORIAL_TRIALS.length || rollback_held(database, client)) return { success: false, error: 'rejected' };
	const amount = remaining_ep_micros(victories, !!row);
	if (quote !== amount) return { success: false, error: 'quote_changed' };
	if (!reward_fits(database, client, amount)) return { success: false, error: 'rejected' };
	database.query(`DELETE FROM combat_recovery WHERE client_id=? AND encounter_id IN
		(SELECT id FROM combat_encounters WHERE client_id=? AND tutorial_trial IS NOT NULL)`).run(client, client);
	database.query("UPDATE combat_encounters SET status='interrupted' WHERE client_id=? AND tutorial_trial IS NOT NULL AND status='active'").run(client);
	database.query('INSERT INTO combat_tutorial(client_id,victories) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET victories=excluded.victories')
		.run(client, TUTORIAL_TRIALS.length);
	database.query('INSERT INTO combat_characters(client_id,revision) VALUES(?,0) ON CONFLICT(client_id) DO UPDATE SET revision=revision+1').run(client);
	if (amount) database.query('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET points_micros=points_micros+excluded.points_micros').run(client, amount);
	return { success: true };
}

export function tutorial_complete(database: Database, client: number) {
	return database.query<{ victories: number }, [number]>('SELECT victories FROM combat_tutorial WHERE client_id=?').get(client)?.victories === 7;
}
// Called inside character preparation's command transaction. The initial allowance is never replayed.
export function prepare_tutorial(database: Database, client: number) {
	if (database.query('SELECT 1 FROM combat_tutorial WHERE client_id=?').get(client)) return true;
	if (!reward_fits(database, client, tutorial_allowance)) return false;
	if (!database.query('INSERT INTO combat_tutorial(client_id) VALUES(?) ON CONFLICT DO NOTHING').run(client).changes) return true;
	database.query('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET points_micros=points_micros+excluded.points_micros').run(client, tutorial_allowance);
	return true;
}
function reward_fits(database: Database, client: number, amount: number) {
	const balance = database.query<{ points_micros: number }, [number]>('SELECT points_micros FROM expedition_ep_balances WHERE client_id=?').get(client)?.points_micros ?? 0;
	return Number.isSafeInteger(balance) && balance >= 0 && balance <= Number.MAX_SAFE_INTEGER - amount;
}
type TutorialState = { victories: number; ready: boolean } & (
	{ complete: true; trial: null; next: null } |
	{ complete: false; trial: typeof TUTORIAL_TRIALS[number]; next: string; skip_ep_micros: number }
);
export function tutorial_state(database: Database, client: number): TutorialState {
	const row = database.query<{ victories: number }, [number]>('SELECT victories FROM combat_tutorial WHERE client_id=?').get(client);
	const victories = row?.victories ?? 0;
	if (victories === 7) return { complete: true, victories, trial: null, ready: false, next: null };
	const trial = TUTORIAL_TRIALS[victories];
	const food = trial.slot === 'Food';
	const access = database.query<{ tier: number; equipped_item: string | null }, [number, string]>(
		`SELECT tier,equipped_item FROM ${food ? 'combat_food_access' : 'combat_equipment_slots'} WHERE client_id=? AND slot=?`).get(client, trial.slot);
	const unlocked = !!database.query('SELECT 1 FROM combat_equipment_projects WHERE client_id=? AND item_id=? AND completed_at IS NOT NULL').get(client, trial.item);
	const project = database.query<{ item_id: string }, [number]>('SELECT item_id FROM combat_equipment_projects WHERE client_id=? AND completed_at IS NULL').get(client);
	const next = !access ? (food ? 'unlock-tier' : 'unlock-slot') : access.tier < trial.tier ? 'unlock-tier' :
		!unlocked ? project?.item_id === trial.item ? 'work' : project ? 'finish-project' : 'start-project' : access.equipped_item !== trial.item ? 'equip' : 'battle';
	// Retain every earlier preparation requirement, allowing the same-slot replacement taught by this trial.
	const expected = new Map<string, string>();
	for (const step of TUTORIAL_TRIALS.slice(0, victories + 1)) expected.set(step.slot, step.item);
	const character = database.query<{ attack: number; strength: number; defence: number; hitpoints: number }, [number]>('SELECT attack,strength,defence,hitpoints FROM combat_characters WHERE client_id=?').get(client);
	const equipped = database.query<{ slot: string; equipped_item: string }, [number]>('SELECT slot,equipped_item FROM combat_equipment_slots WHERE client_id=? AND equipped_item IS NOT NULL').all(client);
	const ready = equipped.every(row => expected.get(row.slot) === row.equipped_item) && !!character && Object.values(character).every(level => level === 1) && [...expected].every(([slot, item]) => !!database.query(
		`SELECT 1 FROM ${slot === 'Food' ? 'combat_food_access' : 'combat_equipment_slots'} s WHERE client_id=? AND slot=? AND equipped_item=? AND EXISTS(SELECT 1 FROM combat_equipment_projects p WHERE p.client_id=s.client_id AND p.item_id=s.equipped_item AND p.completed_at IS NOT NULL)`
	).get(client, slot, item));
	return { complete: false, victories, skip_ep_micros: remaining_ep_micros(victories, !!row), trial, ready, next: next === 'battle' && !ready ? 'restore-loadout' : next };
}
// The encounter row is the settlement journal. Caller commits status and award in the same transaction.
export function tutorial_victory(database: Database, client: number, trial: number) {
	if (!Number.isInteger(trial) || trial < 0 || trial >= 7) return false;
	const amount = TUTORIAL_TRIALS[trial].reward * 1_000_000;
	if (!reward_fits(database, client, amount)) return false;
	if (!database.query('UPDATE combat_tutorial SET victories=victories+1 WHERE client_id=? AND victories=?').run(client, trial).changes) return false;
	if (amount) database.query('UPDATE expedition_ep_balances SET points_micros=points_micros+? WHERE client_id=?').run(amount, client);
	database.query('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?').run(client);
	return true;
}

// Fixed, server-owned presets for inspecting real tutorial UI. Never accepts another Client ID.
const project_definitions = [...EQUIPMENT_DEFINITIONS, ...FOOD_DEFINITIONS];
export function tutorial_debug_targets() {
	const targets = [{ id: 'start', title: 'Start · Create fighter', victories: 0, phase: 'prepare', stage: -1 }];
	for (const [victories, trial] of TUTORIAL_TRIALS.entries()) {
		const add = (phase: string, title: string, stage = -1) => targets.push({
			id: `${victories}:${phase}${stage < 0 ? '' : `:${stage}`}`, title: `${victories + 1} · ${trial.name} · ${title}`, victories, phase, stage });
		if (trial.slot !== 'Food' && !TUTORIAL_TRIALS.slice(0, victories).some(previous => previous.slot === trial.slot)) add('unlock-slot', 'Unlock slot');
		if (trial.tier > 0) {
			add('unlock-tier', 'Upgrade');
			add('start-project', 'Start project');
			project_definitions.find(item => item.item_id === trial.item)!.stages.forEach((_tasks, stage) => add('work', `Project stage ${stage + 1}`, stage));
		}
		add('equip', 'Equip');
		add('battle', 'Ready for battle');
	}
	targets.push({ id: 'complete', title: 'Training complete', victories: 7, phase: 'complete', stage: -1 });
	return targets;
}
// Caller owns the receipt transaction and admin authorization. No EP grants, charges or refunds.
export function debug_tutorial(database: Database, client: number, command: string,
	input: { target?: unknown; revision?: unknown }, now = Date.now()) {
	const target = tutorial_debug_targets().find(target => target.id === input.target);
	if (!target || rollback_held(database, client)) return { success: false, error: 'rejected' };
	const character = database.query<{ revision: number } , [number]>('SELECT revision FROM combat_characters WHERE client_id=?').get(client);
	if ((character?.revision ?? null) !== input.revision) return { success: false, error: 'quote_changed' };
	if (database.query("SELECT 1 FROM combat_encounters WHERE client_id=? AND status='active'").get(client)) return { success: false, error: 'active' };
	if (database.query('SELECT 1 FROM combat_project_tracking WHERE client_id=?').get(client)) return { success: false, error: 'tracking_busy' };
	const revision = Math.max(now, (character?.revision ?? 0) + 1);
	if (!Number.isSafeInteger(revision)) return { success: false, error: 'rejected' };
	if (database.query('SELECT 1 FROM combat_test_profiles WHERE client_id=?').get(client)) {
		database.query('DELETE FROM combat_raid_progress WHERE client_id=?').run(client);
		database.query('DELETE FROM combat_unlocks WHERE client_id=?').run(client);
	}
	// Keep encounter/receipt/report journals and shared Expedition data intact.
	database.query('DELETE FROM combat_characters WHERE client_id=?').run(client);
	database.query('INSERT INTO combat_tutorial(client_id,victories) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET victories=excluded.victories').run(client, target.victories);
	if (target.phase !== 'prepare') {
		database.query('INSERT INTO combat_characters(client_id,revision) VALUES(?,?)').run(client, revision);
		const unlock = (item: string, completed = true, progress: Record<string, number> = {}) => database.query(
			'INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,?,?,?) ON CONFLICT(client_id,item_id) DO UPDATE SET progress_json=excluded.progress_json,completed_at=excluded.completed_at'
		).run(client, item, JSON.stringify(progress), now, completed ? now : null);
		const access = (slot: string, tier: number, item: string | null) => {
			const table = slot === 'Food' ? 'combat_food_access' : 'combat_equipment_slots';
			database.query(`INSERT INTO ${table}(client_id,slot,tier,equipped_item) VALUES(?,?,?,?) ON CONFLICT(client_id,slot) DO UPDATE SET tier=excluded.tier,equipped_item=excluded.equipped_item`).run(client, slot, tier, item);
			const wooden = WOODEN_EQUIPMENT.find(item => item.slot === slot);
			if (wooden) unlock(wooden.item_id);
		};
		for (const trial of TUTORIAL_TRIALS.slice(0, target.victories)) {
			access(trial.slot, trial.tier, trial.item);
			unlock(trial.item);
		}
		if (target.victories < 7) {
			const trial = TUTORIAL_TRIALS[target.victories];
			const previous = TUTORIAL_TRIALS.slice(0, target.victories).findLast(item => item.slot === trial.slot);
			if (target.phase !== 'unlock-slot') {
				const tier = target.phase === 'unlock-tier' ? trial.tier - 1 : trial.tier;
				// Food has no tier zero access row.
				if (trial.slot !== 'Food' || tier > 0) access(trial.slot, tier, previous?.item ?? null);
			}
			if (target.phase === 'work') {
				const definition = project_definitions.find(item => item.item_id === trial.item)!;
				const progress = Object.fromEntries(definition.stages.slice(0, target.stage).flat().map(task => [`${task.skill_id}|${task.action_id}`, task.target_ms]));
				unlock(trial.item, false, progress);
			}
			if (['equip', 'battle'].includes(target.phase)) unlock(trial.item);
			if (target.phase === 'battle') access(trial.slot, trial.tier, trial.item);
		}
	}
	record_audit_event({ event_type: 'combat-tutorial-test', source_key: `combat-tutorial-test:${client}:${command}`,
		actor: { kind: 'client', client_id: client }, command_id: command, occurred_at: now,
		details: { target: target.id } }, database);
	return { success: true };
}
