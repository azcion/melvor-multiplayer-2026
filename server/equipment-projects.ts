import { combat_unlocks } from './combat-unlocks';
import { tutorial_complete } from './combat-tutorial';
import type { JsonObject } from './http';
import { FOOD_DEFINITIONS, FOOD_TIER_COST_MICROS, food_access, food_available, FOOD_SLOTS, is_food_slot } from './combat-food';
import type { Database } from 'bun:sqlite';
import { record_audit_event } from './audit';
import { createHash } from 'node:crypto';
import { ep_balance, settle_wish_capacity } from './wish-capacity';
import { rollback_held } from './rollback-policy';
import { expedition_capture_time, EXPEDITION_FRESH_CAPTURE_MS } from './expedition-clock';
import { combat_character, combat_reset_balance } from './combat-progression';
import { COMBAT_CATALOG, WOODEN_EQUIPMENT } from './combat/catalog';
import {
	EQUIPMENT_DEFINITIONS,
	LEGACY_EQUIPMENT_TASKS,
	EQUIPMENT_SLOTS,
	EQUIPMENT_TIER_COST_MICROS,
	EQUIPMENT_TIER_NAMES,
	EQUIPMENT_UNLOCK_COST_MICROS,
	type EquipmentDefinition
} from './equipment-recipes';

// Final task keys keep saved production progress stable.
export const EQUIPMENT_PROJECTS = [...EQUIPMENT_DEFINITIONS, ...FOOD_DEFINITIONS];
export const equipment_task_key = (task: { skill_id: string; action_id: string }) => `${task.skill_id}|${task.action_id}`;
const task_keys = new Set([
	...LEGACY_EQUIPMENT_TASKS.map(equipment_task_key),
	...EQUIPMENT_PROJECTS.flatMap(project => project.stages.flat().map(equipment_task_key)),
	...FOOD_DEFINITIONS.map(food => `melvorD:Fishing|melvorD:Raw_${food.name}`)
]);
type Project = { id: number; item_id: string; progress_json: string; completed_at: number | null };
type Tracking = { project_id: number; task_id: string; started_at: number; start_clock_offset_ms: number;
	epoch: string; counter_ms: number; statistics_json: string };
export type ActionStatistics = { epoch: string; time_ms: Record<string, number> };
export function parse_action_statistics(value: unknown): ActionStatistics | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const { epoch, time_ms } = value as ActionStatistics;
	if (typeof epoch !== 'string' || !/^[0-9a-f-]{36}$/.test(epoch) || !time_ms || typeof time_ms !== 'object' || Array.isArray(time_ms)) return null;
	const entries = Object.entries(time_ms);
	if (entries.length > task_keys.size || entries.some(([key, ms]) => !task_keys.has(key) || !Number.isSafeInteger(ms) || ms < 0)) return null;
	return { epoch, time_ms };
}
export function equipment_tracking(database: Database, client: number) {
	const row = database.query<Tracking, [number]>('SELECT * FROM combat_project_tracking WHERE client_id=?').get(client);
	return row ? { ...row, source: 'equipment', session_id: `equipment:${row.project_id}:${row.started_at}` } : null;
}
function catalog_view() {
	return EQUIPMENT_PROJECTS.map(({ stages, ...entry }) => ({
		...entry,
		stages: stages.map(group => group.map(task => ({ ...task, task_id: equipment_task_key(task) })))
	}));
}
function slot_access() {
	return [...EQUIPMENT_SLOTS.map(slot => ({
		slot,
		unlock_cost_micros: EQUIPMENT_UNLOCK_COST_MICROS,
		tiers: EQUIPMENT_TIER_NAMES.map((name, index) => ({ tier: index + 1, name, cost_micros: EQUIPMENT_TIER_COST_MICROS[index + 1] }))
	})), ...FOOD_SLOTS.map(slot => ({ slot, unlock_cost_micros: 0, tiers: FOOD_DEFINITIONS.map(food => ({ tier: food.tier, name: food.name, cost_micros: FOOD_TIER_COST_MICROS })) }))];
}
// Immutable process-local definitions; the content hash invalidates client caches on any catalog change.
const equipment_catalog = { catalog: [...catalog_view(), ...WOODEN_EQUIPMENT.map(item => ({ ...item, stages: [] }))], access: slot_access() };
const catalog_revision = createHash('sha256').update(JSON.stringify(equipment_catalog)).digest('hex');
export function equipment_catalog_response(response: JsonObject, url: URL): JsonObject {
	const model = response.equipment_projects as JsonObject | undefined;
	if (!model || typeof model.catalog_revision !== 'string' || url.searchParams.get('equipment_catalog') !== model.catalog_revision) return response;
	const { catalog, access, ...dynamic } = model;
	return { ...response, equipment_projects: dynamic };
}

export function equipment_project_state(database: Database, client: number) {
	const projects = database.query<Project, [number]>('SELECT * FROM combat_equipment_projects WHERE client_id=? ORDER BY id').all(client);
	const active = projects.find(row => row.completed_at === null);
	const definition = EQUIPMENT_PROJECTS.find(entry => entry.item_id === active?.item_id);
	const progress = active ? JSON.parse(active.progress_json) as Record<string, number> : {};
	const stage = definition?.stages.findIndex(tasks => tasks.some(task => (progress[equipment_task_key(task)] ?? 0) < task.target_ms)) ?? -1;
	const slots = database.query<{ slot: string; tier: number; equipped_item: string | null }, [number]>('SELECT slot,tier,equipped_item FROM combat_equipment_slots WHERE client_id=? ORDER BY slot').all(client);
	const foods = FOOD_SLOTS.flatMap(slot => { const owned = food_access(database, client, slot); return owned ? [{ slot, ...owned }] : []; });
	const food_invested = foods.reduce((sum, food) => sum + food.tier * FOOD_TIER_COST_MICROS, 0);
	const equipment_invested = slots.reduce((total, slot) => total + EQUIPMENT_UNLOCK_COST_MICROS +
		EQUIPMENT_TIER_COST_MICROS.slice(1, slot.tier + 1).reduce<number>((sum, cost) => sum + cost, 0), 0);
	const banked_resets = combat_reset_balance(database, client);
	const test_profile = !!database.query('SELECT 1 FROM combat_test_profiles WHERE client_id=?').get(client);
	const reset_quote = (invested_micros: number) => ({ invested_micros: test_profile ? 0 : invested_micros, banked_resets,
		fee_micros: banked_resets ? 0 : invested_micros / 10,
		refund_micros: test_profile ? 0 : banked_resets ? invested_micros : invested_micros * 9 / 10 });
	slots.push(...foods);
	const gear = combat_character(database, client)?.gear ?? {};
	return { ...equipment_catalog, catalog_revision, caps: combat_unlocks(database, client), slots: slots.map(slot => ({ ...slot,
		upgrade_ready: is_food_slot(slot.slot) ? slot.equipped_item === FOOD_DEFINITIONS[slot.tier - 1].item_id && item_is_unlocked(database, client, slot.equipped_item) : slot.tier === 0 || EQUIPMENT_PROJECTS.some(item => item.item_id === slot.equipped_item &&
			item.slot === slot.slot && item.tier === slot.tier && gear[slot.slot] === item.item_id) })),
		reset: reset_quote(equipment_invested + food_invested),
		resets: { equipment: reset_quote(equipment_invested), consumables: reset_quote(food_invested) },
		unlocked: projects.filter(row => row.completed_at !== null).map(row => row.item_id),
		project: active && definition ? { id: active.id, item_id: active.item_id, stage, stages: definition.stages.map((tasks, index) => tasks.map(task =>
			({ ...task, task_id: equipment_task_key(task), player_ms: progress[equipment_task_key(task)] ?? 0, available: index === stage }))) } : null };
}
function chamber_tracking(database: Database, client: number) {
	return !!database.query('SELECT 1 FROM expedition_work_sessions WHERE client_id=? AND ended_at IS NULL').get(client) ||
		!!database.query('SELECT 1 FROM expedition_work_claims WHERE client_id=? AND settled_at IS NULL').get(client);
}
function blocked(database: Database, client: number) {
	return rollback_held(database, client) || !!database.query("SELECT 1 FROM combat_encounters WHERE client_id=? AND status='active'").get(client);
}
function pay_equipment_cost(database: Database, client: number, command: string, cost: number, now: number) {
	settle_wish_capacity(database, client, now);
	if (ep_balance(database, client) < cost) return false;
	database.query('UPDATE expedition_ep_balances SET points_micros=points_micros-? WHERE client_id=?').run(cost, client);
	database.query('INSERT INTO combat_ep_ledger(client_id,command_id,amount_micros,created_at) VALUES(?,?,?,?)').run(client, command, -cost, now);
	return true;
}
function item_is_unlocked(database: Database, client: number, item_id: string) {
	return !!database.query('SELECT 1 FROM combat_equipment_projects WHERE client_id=? AND item_id=? AND completed_at IS NOT NULL').get(client, item_id);
}
function previous_tier_definition(definition: EquipmentDefinition) {
	if (definition.tier <= 1) return null;
	if (definition.slot === 'Food') return FOOD_DEFINITIONS[definition.tier - 2];
	const [namespace, slug] = definition.item_id.split(':', 2);
	const tier_name = EQUIPMENT_TIER_NAMES[definition.tier - 1];
	if (!namespace || !tier_name || !slug.startsWith(`${tier_name}_`)) return undefined;
	const previous_item_id = `${namespace}:${EQUIPMENT_TIER_NAMES[definition.tier - 2]}_${slug.slice(tier_name.length + 1)}`;
	return EQUIPMENT_PROJECTS.find(entry => entry.item_id === previous_item_id && entry.slot === definition.slot && entry.tier === definition.tier - 1);
}
function equip_item(database: Database, client: number, slot: string, item_id: string | null) {
	if (is_food_slot(slot)) {
		if (item_id !== null && (FOOD_DEFINITIONS.find(food => food.item_id === item_id)?.tier ?? Infinity) > combat_unlocks(database, client).food_cap) return 'cap_locked';
		if (!food_access(database, client, slot) || (item_id !== null && !food_available(database, client, item_id, slot))) return 'project_unavailable';
		database.query('UPDATE combat_food_access SET equipped_item=? WHERE client_id=? AND slot=?').run(item_id, client, slot);
		return null;
	}
	const owned_slot = database.query<{ tier: number }, [number, string]>('SELECT tier FROM combat_equipment_slots WHERE client_id=? AND slot=?').get(client, slot);
	if (!owned_slot) return 'slot_locked';
	if (item_id === null) {
		database.query('UPDATE combat_equipment_slots SET equipped_item=NULL WHERE client_id=? AND slot=?').run(client, slot);
		return null;
	}
	const definition = [...EQUIPMENT_PROJECTS, ...WOODEN_EQUIPMENT].find(entry => entry.item_id === item_id);
	const catalog_item = COMBAT_CATALOG.items[item_id];
	if (definition && definition.tier > combat_unlocks(database, client).material_caps[slot]) return 'cap_locked';
	if (definition?.unlock_only) return 'project_unavailable';
	if (!definition || !catalog_item?.supported || definition.slot !== slot || !catalog_item.slots?.includes(slot) ||
		owned_slot.tier < definition.tier || !item_is_unlocked(database, client, item_id)) return 'project_unavailable';
	const levels = database.query<Record<string, number>, [number]>('SELECT attack,strength,defence,hitpoints,ranged,magic FROM combat_characters WHERE client_id=?').get(client);
	if (!levels || (catalog_item.requirements ?? []).some(requirement => {
		const skill = requirement.skillID?.split(':').at(-1)?.toLowerCase();
		return requirement.type !== 'SkillLevel' || !skill || !Number.isSafeInteger(requirement.level) || levels[skill] < requirement.level!;
	})) return 'requirements_unmet';
	for (const occupied of definition.occupies) {
		const current = database.query<{ equipped_item: string | null }, [number, string]>('SELECT equipped_item FROM combat_equipment_slots WHERE client_id=? AND slot=?').get(client, occupied)?.equipped_item;
		if (current) database.query('UPDATE combat_equipment_slots SET equipped_item=NULL WHERE client_id=? AND slot=?').run(client, occupied);
	}
	for (const row of database.query<{ slot: string; equipped_item: string }, [number, string]>('SELECT slot,equipped_item FROM combat_equipment_slots WHERE client_id=? AND equipped_item IS NOT NULL AND slot<>?').all(client, slot)) {
		if (COMBAT_CATALOG.items[row.equipped_item]?.occupies?.includes(slot)) return 'slot_conflict';
	}
	database.query('UPDATE combat_equipment_slots SET equipped_item=? WHERE client_id=? AND slot=?').run(item_id, client, slot);
	return null;
}
// Called within the existing command transaction. No Bank effect, no equipment refund in the level ledger.
export function change_equipment(database: Database, client: number, command: string, action: string,
	input: { slot?: unknown; item_id?: unknown; revision?: unknown; discovered?: unknown; project_id?: unknown }, now = Date.now()) {
	const character = database.query<{ revision: number }, [number]>('SELECT revision FROM combat_characters WHERE client_id=?').get(client);
	if (!character || character.revision !== input.revision) return { success: false, error: 'quote_changed' };
	if (blocked(database, client)) return { success: false, error: 'active' };
	if ((action === 'unlock-tier' || action === 'unlock-slot') && input.slot === 'Food2') return { success: false, error: 'slot_locked' };
	if (action === 'unlock-tier' && is_food_slot(input.slot)) {
		const owned = food_access(database, client, input.slot);
		const tier = owned?.tier ?? 0;
		if (tier >= combat_unlocks(database, client).food_cap) return { success: false, error: 'cap_locked' };
		if (tier >= FOOD_DEFINITIONS.length) return { success: false, error: 'max_tier' };
		if (tier && (owned?.equipped_item !== FOOD_DEFINITIONS[tier - 1].item_id || !item_is_unlocked(database, client, owned.equipped_item))) return { success: false, error: 'equip_current_tier' };
		if (!pay_equipment_cost(database, client, command, FOOD_TIER_COST_MICROS, now)) return { success: false, error: 'insufficient_ep' };
		database.query('INSERT INTO combat_food_access(client_id,slot,tier) VALUES(?,?,?) ON CONFLICT(client_id,slot) DO UPDATE SET tier=excluded.tier').run(client, input.slot, tier + 1);
	} else if (action === 'unlock-slot' || action === 'unlock-tier') {
		if (typeof input.slot !== 'string' || !EQUIPMENT_SLOTS.includes(input.slot)) return { success: false, error: 'rejected' };
		const slot = database.query<{ tier: number; equipped_item: string | null }, [number, string]>('SELECT tier,equipped_item FROM combat_equipment_slots WHERE client_id=? AND slot=?').get(client, input.slot);
		if (action === 'unlock-slot') {
			if (slot) return { success: false, error: 'quote_changed' };
			if (!pay_equipment_cost(database, client, command, EQUIPMENT_UNLOCK_COST_MICROS, now)) return { success: false, error: 'insufficient_ep' };
			database.query('INSERT INTO combat_equipment_slots(client_id,slot,tier) VALUES(?,?,0)').run(client, input.slot);
			const wooden = WOODEN_EQUIPMENT.find(item => item.slot === input.slot);
			if (wooden) database.query("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,'{}',?,?) ON CONFLICT DO NOTHING").run(client, wooden.item_id, now, now);

		} else {
			if (!slot) return { success: false, error: 'slot_locked' };
			if (slot.tier >= EQUIPMENT_TIER_NAMES.length) return { success: false, error: 'max_tier' };
			if (slot.tier > 0) {
				const equipped = EQUIPMENT_PROJECTS.find(item => item.item_id === slot.equipped_item && item.slot === input.slot && item.tier === slot.tier);
				if (!equipped || !item_is_unlocked(database, client, equipped.item_id) ||
					combat_character(database, client)?.gear[input.slot] !== equipped.item_id) return { success: false, error: 'equip_current_tier' };
			}
			const next_tier = slot.tier + 1;
			if (next_tier > combat_unlocks(database, client).material_caps[input.slot]) return { success: false, error: 'cap_locked' };
			if (!pay_equipment_cost(database, client, command, EQUIPMENT_TIER_COST_MICROS[next_tier], now)) return { success: false, error: 'insufficient_ep' };
			database.query('UPDATE combat_equipment_slots SET tier=? WHERE client_id=? AND slot=?').run(next_tier, client, input.slot);
		}
	} else if (action === 'start-project') {
		const definition = EQUIPMENT_PROJECTS.find(entry => entry.item_id === input.item_id);
		if (definition && definition.tier > (definition.slot === 'Food' ? combat_unlocks(database, client).food_cap : combat_unlocks(database, client).material_caps[definition.slot])) return { success: false, error: 'cap_locked' };
		if (!definition) return { success: false, error: 'project_unavailable' };
		const tier = definition.slot === 'Food' ? Math.max(...FOOD_SLOTS.map(slot => food_access(database, client, slot)?.tier ?? -1)) : database.query<{ tier: number }, [number, string]>('SELECT tier FROM combat_equipment_slots WHERE client_id=? AND slot=?').get(client, definition.slot)?.tier ?? -1;
		const previous = previous_tier_definition(definition);
		if (tier < definition.tier || (previous !== null && (!previous || !item_is_unlocked(database, client, previous.item_id))) ||
			database.query('SELECT 1 FROM combat_equipment_projects WHERE client_id=? AND (completed_at IS NULL OR item_id=?)').get(client, definition.item_id)) return { success: false, error: 'project_unavailable' };
		database.query('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at) VALUES(?,?,?,?)').run(client, definition.item_id, '{}', now);
	} else if (action === 'cancel-project') {
		if (!Number.isSafeInteger(input.project_id)) return { success: false, error: 'project_unavailable' };
		const row = database.query<Project, [number, number]>('SELECT * FROM combat_equipment_projects WHERE id=? AND client_id=? AND completed_at IS NULL').get(input.project_id as number, client);
		if (!row) return { success: false, error: 'project_unavailable' };
		// Tracking cascades away with this exact project; permanent unlocks are untouched.
		database.query('DELETE FROM combat_equipment_projects WHERE id=? AND client_id=? AND completed_at IS NULL').run(row.id, client);
	} else if (action === 'equip') {
		if (typeof input.slot !== 'string' || (input.item_id !== null && typeof input.item_id !== 'string')) return { success: false, error: 'rejected' };
		const error = equip_item(database, client, input.slot, input.item_id as string | null);
		if (error) return { success: false, error };
	} else return { success: false, error: 'rejected' };
	database.query('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?').run(client);
	return { success: true };
}

// Caller owns the replay-safe command transaction; access purchases alone fund this refund.
export function reset_equipment(database: Database, client: number, command: string, revision: unknown, now = Date.now(), group: unknown = 'all') {
	if (!tutorial_complete(database, client)) return { success: false, error: 'tutorial_required' };
	if (group !== 'all' && group !== 'equipment' && group !== 'consumables') return { success: false, error: 'rejected' };
	const character = combat_character(database, client);
	if (!character || character.revision !== revision) return { success: false, error: 'quote_changed' };
	if (blocked(database, client)) return { success: false, error: 'active' };
	settle_wish_capacity(database, client, now);
	const model = equipment_project_state(database, client);
	const quote = group === 'all' ? model.reset : model.resets[group];
	if (!quote.invested_micros) return { success: false, error: 'nothing_to_reset' };
	if (!Number.isSafeInteger(ep_balance(database, client) + quote.refund_micros)) return { success: false, error: 'rejected' };
	database.query('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET points_micros=points_micros+excluded.points_micros')
		.run(client, quote.refund_micros);
	if (quote.banked_resets) database.query('UPDATE combat_reset_balances SET resets=resets-1 WHERE client_id=? AND resets>0').run(client);
	if (group !== 'consumables') database.query('DELETE FROM combat_equipment_slots WHERE client_id=?').run(client);
	if (group !== 'equipment') database.query('DELETE FROM combat_food_access WHERE client_id=?').run(client);
	database.query('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?').run(client);
	database.query('INSERT INTO combat_ep_ledger(client_id,command_id,amount_micros,created_at) VALUES(?,?,?,?)').run(client, command, quote.refund_micros, now);
	return { success: true, refunded_micros: quote.refund_micros, fee_micros: quote.fee_micros };
}

export type EquipmentWorkRequest = { kind: 'start' | 'check-in' | 'stop'; project_id: number; task_id: string | null;
	captured_at: number; actions: ActionStatistics; activities: Array<{ type: string; skill_id?: string; action_id?: string }>;
	statistics: { time_ms: Record<string, number> } };
export function change_equipment_work(database: Database, client: number, operation: string, request: EquipmentWorkRequest, now = Date.now(), include_freshness = false) {
	return database.transaction(() => {
		const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
		const replay = database.query<{ request_hash: string; response: string }, [number, string]>('SELECT request_hash,response FROM combat_project_reports WHERE client_id=? AND operation_id=?').get(client, operation);
		if (replay) {
			if (replay.request_hash !== hash) return { success: false, error: 'operation_conflict' };
			const response = JSON.parse(replay.response);
			// Keep the original settlement and player snapshot; static definitions need not be copied per report.
			if (response.equipment_projects) {
				if (!response.equipment_projects.catalog || !response.equipment_projects.access) {
					Object.assign(response.equipment_projects, equipment_catalog, { catalog_revision });
				}
			}
			return include_freshness ? { ...response, equipment_work_current: false } : response;
		}
		const row = database.query<Project, [number, number]>('SELECT * FROM combat_equipment_projects WHERE id=? AND client_id=?').get(request.project_id, client);
		const definition = EQUIPMENT_PROJECTS.find(entry => entry.item_id === row?.item_id);
		if (!row || !definition) return { success: false, error: 'task_unavailable' };
		const existing = equipment_tracking(database, client);
		if (existing && existing.project_id !== row.id) return { success: false, error: 'tracking_identity_mismatch' };
		if (request.kind === 'start' && (existing || chamber_tracking(database, client))) return { success: false, error: 'tracking_busy' };
		if (request.kind !== 'start' && !existing) return { success: false, error: 'no_active_tracking' };
		const progress = JSON.parse(row.progress_json) as Record<string, number>;
		let credited_ms = 0;
		if (existing) {
			const capture = expedition_capture_time(request.captured_at, now, existing);
			const elapsed = capture - existing.started_at;
			const delta = request.actions.epoch === existing.epoch ? (request.actions.time_ms[existing.task_id] ?? -1) - existing.counter_ms : -1;
			const start = JSON.parse(existing.statistics_json) as Record<string, number>;
			const total = Object.entries(request.statistics.time_ms).reduce((sum, [skill, ms]) => sum + Math.min(elapsed + Math.max(30000, elapsed * .02), Math.max(0, ms - (start[skill] ?? ms))), 0);
			const concurrency = elapsed > 0 ? Math.max(1, total / elapsed) : 1;
			const task = definition.stages.flat().find(task => equipment_task_key(task) === existing.task_id);
			credited_ms = task && elapsed <= 4 * 86400000 && delta >= 0 && !rollback_held(database, client)
				? Math.max(0, Math.min(task.target_ms - (progress[existing.task_id] ?? 0), Math.floor(Math.min(elapsed, delta) / concurrency))) : 0;
			progress[existing.task_id] = (progress[existing.task_id] ?? 0) + credited_ms;
			database.query('DELETE FROM combat_project_tracking WHERE client_id=?').run(client);
			database.query('UPDATE combat_equipment_projects SET progress_json=? WHERE id=?').run(JSON.stringify(progress), row.id);
		}
		const stage = definition.stages.find(tasks => tasks.some(task => (progress[equipment_task_key(task)] ?? 0) < task.target_ms));
		if (!stage && row.completed_at === null) {
			database.query('UPDATE combat_equipment_projects SET completed_at=? WHERE id=?').run(now, row.id);
			database.query('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?').run(client);
		}
		const task_id = request.kind === 'start' ? request.task_id : existing?.task_id;
		const task = stage?.find(task => equipment_task_key(task) === task_id && (progress[equipment_task_key(task)] ?? 0) < task.target_ms);
		const matches = task && request.activities.some(activity => activity.type === 'skill' && activity.skill_id === task.skill_id && (activity.action_id === task.action_id || task.skill_id === 'melvorD:Woodcutting' && task.action_id === 'multiplayer:Any_Woodcutting'));
		// Native skill work continues during Online Combat, including paused encounters.
		// Only equipment mutations need the active-encounter guard.
		const may_start = matches && !rollback_held(database, client) && request.actions.time_ms[task_id!] !== undefined;
		if (request.kind === 'start' && !may_start) return { success: false, error: 'activity_required' };
		// Delayed saved reports settle their old interval, but never attribute the transport gap to a new one.
		const fresh = !existing || now - expedition_capture_time(request.captured_at, now, existing) <= EXPEDITION_FRESH_CAPTURE_MS;
		if (request.kind !== 'stop' && may_start && fresh) database.query('INSERT INTO combat_project_tracking(client_id,project_id,task_id,started_at,start_clock_offset_ms,epoch,counter_ms,statistics_json) VALUES(?,?,?,?,?,?,?,?)')
			.run(client, row.id, task_id!, now, request.captured_at - now, request.actions.epoch, request.actions.time_ms[task_id!], JSON.stringify(request.statistics.time_ms));
		const response = { success: true, settlement: existing ? { credited_ms, reason: credited_ms ? 'settled' : 'unverified' } : null,
			tracking: equipment_tracking(database, client), equipment_projects: equipment_project_state(database, client) };
		database.query('INSERT INTO combat_project_reports(client_id,operation_id,request_hash,response) VALUES(?,?,?,?)').run(client, operation, hash, JSON.stringify({ ...response,
				equipment_projects: { ...response.equipment_projects, catalog: undefined, access: undefined } }));
		return include_freshness ? { ...response, equipment_work_current: true } : response;
	}).immediate();
}

// Server-authorized test shortcut; called inside the command transaction, never from normal work reports.
export function debug_equipment_project(database: Database, client: number, command: string,
	input: { revision?: unknown; project_id?: unknown; task_id?: unknown }, now = Date.now()) {
	const character = database.query<{ revision: number }, [number]>('SELECT revision FROM combat_characters WHERE client_id=?').get(client);
	if (!character || character.revision !== input.revision) return { success: false, error: 'quote_changed' };
	if (blocked(database, client)) return { success: false, error: 'active' };
	if (equipment_tracking(database, client)) return { success: false, error: 'tracking_busy' };
	if (!Number.isSafeInteger(input.project_id) || (input.task_id !== null && typeof input.task_id !== 'string')) return { success: false, error: 'rejected' };
	const row = database.query<Project, [number, number]>('SELECT * FROM combat_equipment_projects WHERE id=? AND client_id=? AND completed_at IS NULL').get(input.project_id as number, client);
	const definition = EQUIPMENT_PROJECTS.find(entry => entry.item_id === row?.item_id);
	if (!row || !definition) return { success: false, error: 'project_unavailable' };
	const progress = JSON.parse(row.progress_json) as Record<string, number>;
	const stage = definition.stages.find(tasks => tasks.some(task => (progress[equipment_task_key(task)] ?? 0) < task.target_ms));
	const tasks = input.task_id === null ? definition.stages.flat() : stage?.filter(task => equipment_task_key(task) === input.task_id && (progress[equipment_task_key(task)] ?? 0) < task.target_ms);
	if (!tasks?.length) return { success: false, error: 'task_unavailable' };
	for (const task of tasks) progress[equipment_task_key(task)] = task.target_ms;
	const complete = definition.stages.flat().every(task => (progress[equipment_task_key(task)] ?? 0) >= task.target_ms);
	database.query('UPDATE combat_equipment_projects SET progress_json=?,completed_at=? WHERE id=?').run(JSON.stringify(progress), complete ? now : null, row.id);
	database.query('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?').run(client);
	record_audit_event({ event_type: 'combat-project-test', source_key: `combat-project-test:${client}:${command}`,
		actor: { kind: 'client', client_id: client }, command_id: command, occurred_at: now,
		details: { project_id: row.id, item_id: row.item_id, task_id: input.task_id as string | null, completed: complete } }, database);
	return { success: true };
}
