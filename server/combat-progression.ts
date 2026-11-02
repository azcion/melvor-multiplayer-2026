import { combat_unlocks } from './combat-unlocks';
import { prepare_tutorial, tutorial_complete } from './combat-tutorial';
import type { Database } from 'bun:sqlite';
import { ep_balance, settle_wish_capacity } from './wish-capacity';
import { rollback_held } from './rollback-policy';
import { parse_registration } from './combat/catalog';
import type { Registration } from './combat/catalog';

export const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic'] as const;
export const AVAILABLE_COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'] as const;
export type CombatSkill = typeof COMBAT_SKILLS[number];
type Character = Record<CombatSkill, number> & { revision: number; invested_micros: number };
export const EP_MICROS = 1_000_000;

export function level_price(level: number): number {
	if (!Number.isSafeInteger(level) || level < 2 || level > 99) throw new RangeError('Invalid combat level');
	return (Math.floor(level / 10) + 1) * EP_MICROS;
}

export function combat_character(database: Database, client: number) {
	const row = database.query<Character, [number]>('SELECT * FROM combat_characters WHERE client_id=?').get(client);
	if (!row) return null;
	const levels = Object.fromEntries(COMBAT_SKILLS.map(skill => [skill, row[skill]])) as Record<CombatSkill, number>;
	const banked_resets = combat_reset_balance(database, client);
	const caps = combat_unlocks(database, client).skill_caps;
	return { levels, caps, banked_resets, revision: row.revision, invested_micros: row.invested_micros,
		reset_fee_micros: banked_resets ? 0 : row.invested_micros / 10, reset_refund_micros: banked_resets ? row.invested_micros : row.invested_micros * 9 / 10,
		max_hp: levels.hitpoints * 10, gear: equipped_gear(database, client, levels),
		next_costs: Object.fromEntries(COMBAT_SKILLS.map(skill => [skill, levels[skill] < caps[skill] ? level_price(levels[skill] + 1) : null])) };
}

export function prepare_combat(database: Database, client: number) {
	const restarting = !!database.query('SELECT 1 FROM combat_tutorial WHERE client_id=?').get(client);
	if (!prepare_tutorial(database, client)) return { success: false, error: 'rejected' };
	database.query('INSERT INTO combat_characters(client_id,revision) VALUES(?,?) ON CONFLICT DO NOTHING').run(client, restarting ? Date.now() : 0);
	return { success: true };
}

// The arena receives only server-owned melee stats. Ranged/Magic progression is retained for later attack styles.
export function combat_loadout(database: Database, client: number): Registration | null {
	const character = combat_character(database, client);
	if (!character) return null;
	const { attack, strength, defence, hitpoints } = character.levels;
	return { levels: { attack, strength, defence, hitpoints }, gear: character.gear };
}

function ep_entry(database: Database, client: number, command: string, amount: number, now: number) {
	database.query('INSERT INTO combat_ep_ledger(client_id,command_id,amount_micros,created_at) VALUES(?,?,?,?)')
		.run(client, command, amount, now);
}

// Caller owns the command transaction: EP, levels, audit and replay commit together.
export function purchase_combat_levels(database: Database, client: number, command: string,
	upgrades: unknown, revision: unknown, now = Date.now()) {
	if (!tutorial_complete(database, client)) return { success: false, error: 'tutorial_required' };
	if (!upgrades || typeof upgrades !== 'object' || Array.isArray(upgrades) || rollback_held(database, client)) return { success: false, error: 'rejected' };
	const entries = Object.entries(upgrades);
	if (!entries.length || entries.length > AVAILABLE_COMBAT_SKILLS.length || entries.some(([skill, quantity]) =>
		!AVAILABLE_COMBAT_SKILLS.includes(skill as typeof AVAILABLE_COMBAT_SKILLS[number]) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 98)) return { success: false, error: 'rejected' };
	if (database.query("SELECT 1 FROM combat_encounters WHERE client_id=? AND status='active'").get(client)) return { success: false, error: 'active' };
	settle_wish_capacity(database, client, now);
	const character = combat_character(database, client);
	if (!character || character.revision !== revision) return { success: false, error: 'quote_changed' };
	const levels: Partial<Record<CombatSkill, number>> = {};
	let cost = 0;
	for (const [skill, quantity] of entries) {
		const start = character.levels[skill as CombatSkill];
		const target = start + quantity;
		if (target > 99) return { success: false, error: 'max_level' };
		if (target > character.caps[skill]) return { success: false, error: 'cap_locked' };
		levels[skill as CombatSkill] = target;
		for (let level = start + 1; level <= target; level++) cost += level_price(level);
	}
	if (!database.query('UPDATE expedition_ep_balances SET points_micros=points_micros-? WHERE client_id=? AND points_micros>=?')
		.run(cost, client, cost).changes) return { success: false, error: 'insufficient_ep' };
	// Identifiers come from the skill allowlist above; one revision and ledger entry cover the entire order.
	database.query(`UPDATE combat_characters SET ${Object.keys(levels).map(skill => `${skill}=?`).join(',')},invested_micros=invested_micros+?,revision=revision+1 WHERE client_id=?`)
		.run(...Object.values(levels), cost, client);
	ep_entry(database, client, command, -cost, now);
	return { success: true, levels, paid_micros: cost };
}

export function reset_combat_levels(database: Database, client: number, command: string, revision: unknown, now = Date.now()) {
	if (rollback_held(database, client)) return { success: false, error: 'rejected' };
	if (database.query("SELECT 1 FROM combat_encounters WHERE client_id=? AND status='active'").get(client)) return { success: false, error: 'active' };
	settle_wish_capacity(database, client, now);
	const character = combat_character(database, client);
	if (!character || character.revision !== revision) return { success: false, error: 'quote_changed' };
	if (!character.invested_micros) return { success: false, error: 'nothing_to_reset' };
	const refund = character.reset_refund_micros;
	if (!Number.isSafeInteger(ep_balance(database, client) + refund)) return { success: false, error: 'rejected' };
	database.query('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET points_micros=points_micros+excluded.points_micros')
		.run(client, refund);
	if (character.banked_resets) database.query('UPDATE combat_reset_balances SET resets=resets-1 WHERE client_id=? AND resets>0').run(client);
	database.query(`UPDATE combat_characters SET ${COMBAT_SKILLS.map(skill => `${skill}=1`).join(',')},invested_micros=0,revision=revision+1 WHERE client_id=?`).run(client);
	ep_entry(database, client, command, refund, now);
	return { success: true, refunded_micros: refund, fee_micros: character.reset_fee_micros };
}

export function combat_reset_balance(database: Database, client: number): number {
	return database.query<{ resets: number }, [number]>('SELECT resets FROM combat_reset_balances WHERE client_id=?').get(client)?.resets ?? 0;
}

// Operator-only, idempotent grants also work before an Online character is created.
export function grant_combat_resets(database: Database, client: number, quantity: number, command: string, now = Date.now()) {
	if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(command)) return false;
	return database.transaction(() => {
		const prior = database.query<{ client_id: number; quantity: number }, [string]>('SELECT client_id,quantity FROM combat_reset_grants WHERE command_id=?').get(command);
		if (prior) return prior.client_id === client && prior.quantity === quantity;
		if (!database.query('SELECT 1 FROM clients WHERE id=? AND deleted_at IS NULL AND disabled=0').get(client) || combat_reset_balance(database, client) + quantity > 1000000) return false;
		database.query('INSERT INTO combat_reset_balances(client_id,resets) VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET resets=resets+excluded.resets').run(client, quantity);
		database.query('INSERT INTO combat_reset_grants(command_id,client_id,quantity,created_at) VALUES(?,?,?,?)').run(command, client, quantity, now);
		database.query('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?').run(client);
		return true;
	}).immediate();
}

function equipped_gear(database: Database, client: number, levels: Record<CombatSkill, number>): Record<string, string> {
	const rows = database.query<{ slot: string; equipped_item: string }, [number, number]>(
		'SELECT slot,equipped_item FROM combat_equipment_slots WHERE client_id=? AND equipped_item IS NOT NULL AND EXISTS(SELECT 1 FROM combat_equipment_projects WHERE client_id=? AND item_id=equipped_item AND completed_at IS NOT NULL) ORDER BY slot'
	).all(client, client);
	let gear: Record<string, string> = {};
	for (const row of rows) {
		// A now-over-level item must not make valid equipment in other slots disappear.
		// Incremental validation also ignores malformed historical occupancy conflicts
		// deterministically while retaining each compatible item.
		const registration = parse_registration({ levels, gear: { ...gear, [row.slot]: row.equipped_item } });
		if (registration) gear = registration.gear;
	}
	return gear;
}
