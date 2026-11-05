import { PRACTICE_DEFINITIONS, PRACTICE_TIERS, PRACTICE_RULESET, PRACTICE_EFFECT_COPY, practice_available, practice_selection, practice_wave } from './combat/practice';
import { combat_unlocks, raid_endpoint, raid_progress, grant_raid_tier, dungeon_available } from './combat-unlocks';
import { createHash } from 'node:crypto';
import type { JsonObject } from './http';
import { combat_leaderboard } from './combat-leaderboard';
import { DUNGEONS } from './combat/raids';
import { tutorial_state, tutorial_victory } from './combat-tutorial';
import type { Database } from 'bun:sqlite';
import { equipment_project_state } from './equipment-projects';
import { combat_character, combat_loadout } from './combat-progression';
import { ep_balance, settle_wish_capacity } from './wish-capacity';
import { FOOD_DEFINITIONS, food_access, food_available } from './combat-food';
import type { CombatAdmission } from './combat/authority-client';
import { rollback_held } from './rollback-policy';
export type Encounter = { id: string; client_id: number; controller: string; food_id: string; used: number; status: string; registration_json: string; tutorial_trial: number | null; raid_endpoint: number | null; raid_completed: number; practice_id: string | null; practice_tier: number | null; practice_completed: number; raid_ruleset: string | null; created_at: number };
// Definitions depend only on the process's ruleset, never a player's progression.
const practice_catalog = PRACTICE_DEFINITIONS.map(definition => ({
	id: definition.id, name: definition.name, category: definition.category, focus: definition.focus,
	tiers: PRACTICE_TIERS.map(tier => ({ ...tier, encounter: `practice_${definition.id}_${tier.tier}`,
		waves: definition.waves.map((_,stage) => practice_wave({definition,tier},stage).map(actor => ({
			...actor, effect: actor.effect ?? null, effect_info: (actor.effect ? PRACTICE_EFFECT_COPY[actor.effect] : '') ?? ''
		})))
	}))
}));
const practice_catalog_revision = createHash('sha256').update(JSON.stringify(practice_catalog)).digest('hex');
export function combat_inventory_response(response: JsonObject, url: URL): JsonObject {
	if (url.searchParams.get('practice_catalog') !== practice_catalog_revision || !Array.isArray(response.practice)) return response;
	return { ...response, practice: (response.practice as JsonObject[]).map(entry => ({ ...entry,
		tiers: (entry.tiers as JsonObject[]).map(({ waves, ...dynamic }) => dynamic)
	})) };
}
type DungeonActivity = { client_id: number; display_name: string; icon_id: string; status: string; tier: number; occurred_at: number };
const dungeon_activity_page_size = 20;
type DungeonActivityCursor = { occurred_at: number; id: string };

export function parse_dungeon_activity_cursor(value: string | null): DungeonActivityCursor | null {
	const match = value?.match(/^(0|[1-9]\d{0,15}):([a-zA-Z0-9-]{1,64})$/);
	if (!match || !Number.isSafeInteger(Number(match[1]))) return null;
	return { occurred_at: Number(match[1]), id: match[2] };
}

export function dungeon_activity(database: Database, ruleset: string, cursor: DungeonActivityCursor | null = null) {
	// Ruleset versions for the same dungeon share their prefix; older encounters predate completion timestamps.
	const prefix = ruleset.slice(0, ruleset.lastIndexOf('-') + 1);
	const minimum = prefix === 'golbin-' || prefix === 'tidal-' ? 2 : 1;
	const rows = database.query<DungeonActivity & { id: string }, (string | number)[]>(`SELECT e.id,e.client_id,c.display_name,c.icon_id,e.status,
		e.raid_endpoint AS tier,COALESCE(e.completed_at,e.created_at) AS occurred_at
		FROM combat_encounters e JOIN clients c ON c.id=e.client_id
		WHERE e.raid_ruleset GLOB ? AND CAST(substr(e.raid_ruleset,length(?) + 1) AS INTEGER)>=? AND e.raid_endpoint IS NOT NULL AND e.status IN ('victory','defeat')
		AND c.deleted_at IS NULL AND c.disabled=0
		AND NOT EXISTS (SELECT 1 FROM combat_activity_exclusions x WHERE x.client_id=e.client_id)
		${cursor ? 'AND (COALESCE(e.completed_at,e.created_at),e.id) < (?,?)' : ''}
		ORDER BY occurred_at DESC,e.id DESC LIMIT ?`).all(prefix + '*', prefix, minimum,
			...(cursor ? [cursor.occurred_at, cursor.id] : []), dungeon_activity_page_size + 1);
	const page = rows.slice(0, dungeon_activity_page_size);
	const last = page.at(-1);
	return {
		activity: page.map(({ id, ...entry }) => entry),
		activity_next_cursor: last && rows.length > dungeon_activity_page_size ? `${last.occurred_at}:${last.id}` : null
	};
}
export function combat_state(database: Database, client: number, raid_page = 0, include_activity = false) {
	settle_wish_capacity(database, client);
	const food_slot = food_access(database, client);
	const completed_foods = new Set(database.query<{item_id:string}, [number]>(
		'SELECT item_id FROM combat_equipment_projects WHERE client_id=? AND completed_at IS NOT NULL').all(client).map(row => row.item_id));
	const foods = FOOD_DEFINITIONS.filter(food => (food_slot?.tier ?? 0) >= food.tier && completed_foods.has(food.item_id))
		.map(food => ({ id: food.item_id, name: food.name, heal: food.heal, tier: food.tier })).reverse();
	const selected = food_slot?.equipped_item;
	const history = database.query<Encounter, [number]>('SELECT * FROM combat_encounters WHERE client_id=? ORDER BY created_at DESC LIMIT 30').all(client)
		.map(row => ({ id: row.id, food_id: row.food_id, used: row.used, status: row.status }));
	const unlocks = combat_unlocks(database, client), caps = unlocks.skill_caps;
	const tutorial = tutorial_state(database, client), graduated = tutorial.complete;
	const completions = database.query<{practice_id:string;tier:number},[number,string]>(
		'SELECT practice_id,tier FROM combat_practice_completions WHERE client_id=? AND ruleset=?').all(client,PRACTICE_RULESET);
	const practice = (graduated ? practice_catalog : []).map(definition => ({ ...definition,
		tiers: definition.tiers.map(tier => ({ ...tier,
			available: graduated && practice_available(caps,tier),
			complete: completions.some(row => row.practice_id === definition.id && row.tier === tier.tier)
		}))
	}));
	const progress = new Map(Object.values(DUNGEONS).map(dungeon => [dungeon.id, raid_progress(database,client,dungeon.id)]));
	const complete = (raid: string, index: number) => (progress.get(raid)?.find(row => row.tier === index+1)?.wins ?? 0) >= DUNGEONS[raid].tiers[index].wins_required;
	const endpoint = (raid: string) => DUNGEONS[raid].tiers.findIndex((_,i) => !complete(raid,i)) + 1 || DUNGEONS[raid].tiers.length;
	const dungeons = Object.values(DUNGEONS).map(dungeon => ({
			id: dungeon.id, name: dungeon.name, available: !dungeon.requires || DUNGEONS[dungeon.requires].tiers.every((_,i) => complete(dungeon.requires!,i)), endpoint: endpoint(dungeon.id),
			tiers: dungeon.tiers.map((tier,i) => ({ ...tier, chamber_effects: (tier.chamber_effects ?? []).map(effect => ({...effect, equipment: effect.equipment ? {...effect.equipment, slots: [...effect.equipment.slots]} : null})), complete: complete(dungeon.id,i) })),
			leaderboard: combat_leaderboard(database,raid_page,dungeon.id),
			...(include_activity ? dungeon_activity(database,dungeon.ruleset) : null),
			best: database.query<{elapsed_ms:number;achieved_at:number},[number,string,string]>('SELECT elapsed_ms,achieved_at FROM combat_raid_records WHERE client_id=? AND raid=? AND ruleset=?').get(client,dungeon.id,dungeon.ruleset)
		}));
	const golbins = dungeons.find(dungeon => dungeon.id === 'golbins')!;
	return { test_profile: !!database.query('SELECT 1 FROM combat_test_profiles WHERE client_id=?').get(client), practice_catalog_revision, practice, character: combat_character(database, client), equipment_projects: equipment_project_state(database, client),
		unlocks, dungeons, raid: { endpoint: golbins.endpoint, leaderboard: golbins.leaderboard, best: golbins.best },
		tutorial, ep_micros: ep_balance(database, client), foods, food_id: selected && foods.some(food => food.id === selected) ? selected : '', history };
}
// Admission freezes the server-owned selection and healing. There is no inventory reservation.
export function reserve_combat(database: Database, client: number, controller: string, id: string, selection?: string, mode = 'once'): CombatAdmission | null {
	return database.transaction(() => {
		// Share the write lock with the operator drain so an admission cannot slip past its zero-battle check.
		if (database.query("SELECT 1 FROM combat_availability WHERE drain_at IS NOT NULL UNION ALL SELECT 1 FROM service_settings WHERE key='maintenance' AND value='1'").get()) return null;
		if (rollback_held(database, client) || database.query('SELECT 1 FROM combat_recovery WHERE client_id=?').get(client) || database.query("SELECT 1 FROM combat_encounters WHERE client_id=? AND status='active'").get(client)) return null;
		const tutorial = tutorial_state(database, client);
		if (!tutorial.complete && (!tutorial.ready || selection !== tutorial.trial?.id || mode !== 'once')) return null;
		if (tutorial.complete && selection?.startsWith('tutorial_')) return null;
		if (mode === 'raid' && (!Object.hasOwn(DUNGEONS, selection ?? '') || !tutorial.complete)) return null;
		if (selection && DUNGEONS[selection]?.requires && (mode !== 'raid' || !dungeon_available(database,client,selection))) return null;
		const practice = practice_selection(selection);
		if (selection?.startsWith('practice_') && (!practice || mode !== 'once' || !tutorial.complete ||
			!practice_available(combat_unlocks(database,client).skill_caps,practice.tier))) return null;
		const endpoint = mode === 'raid' ? raid_endpoint(database, client, selection) : null;
		const registration = combat_loadout(database, client);
		if (!registration) return null;
		const item = food_access(database, client)?.equipped_item;
		if (item && !food_available(database, client, item)) return null;
		const food = FOOD_DEFINITIONS.find(food => food.item_id === item);
		database.query('INSERT INTO combat_encounters(id,client_id,controller,food_id,used,status,registration_json,created_at,tutorial_trial,raid_endpoint,raid_ruleset,practice_id,practice_tier) VALUES(?,?,?,?,0,?,?,?,?,?,?,?,?)')
			.run(id, client, controller, food?.item_id ?? '', 'active', JSON.stringify(registration), Date.now(), tutorial.complete ? null : tutorial.victories, endpoint, endpoint ? DUNGEONS[selection!].ruleset : practice ? PRACTICE_RULESET : null, practice?.definition.id ?? null, practice?.tier.tier ?? null);
		return { registration, food_id: food?.item_id ?? '', heal: food?.heal ?? 0, auto_eat: combat_unlocks(database, client).auto_eat, ...(endpoint ? { raid_endpoint: endpoint } : {}) };
	}).immediate();
}
export function update_combat(database: Database, controller: string, id: string, used: number, status: string, completed?: number, now = Date.now(), active_ms?: number) {
	return database.transaction(() => {
		const row = database.query<Encounter, [string]>('SELECT * FROM combat_encounters WHERE id=?').get(id);
		if (!row || row.controller !== controller || !Number.isSafeInteger(used) || used < row.used || (!row.food_id && used > 0) ||
			!['active','victory','defeat','draw','fled','expired','interrupted'].includes(status)) return false;
		if (row.status !== 'active') return row.used === used && row.status === status;
		if (rollback_held(database, row.client_id)) status = 'interrupted';
		if (row.raid_endpoint !== null && status !== 'interrupted') {
			const dungeon = Object.values(DUNGEONS).find(dungeon => dungeon.ruleset === row.raid_ruleset);
			if (!dungeon) return false;
			const boundaries = dungeon.boundaries;
			if (status === 'victory' && (!Number.isSafeInteger(now - row.created_at) || now <= row.created_at)) return false;
			if (!Number.isSafeInteger(completed) || completed! < row.raid_completed || completed! > row.raid_completed + 1 ||
				completed! > boundaries[row.raid_endpoint - 1] || row.raid_ruleset !== dungeon.ruleset ||
				(status === 'victory' && completed !== boundaries[row.raid_endpoint - 1]) ||
				(status !== 'victory' && completed === boundaries[row.raid_endpoint - 1])) return false;
			if (completed! > row.raid_completed) {
				// A non-victory terminal outcome must never manufacture a wave or tier clear.
				if (!['active','victory'].includes(status)) return false;
				const tier = boundaries.indexOf(completed!) + 1;
				if (tier) grant_raid_tier(database, row.client_id, tier, dungeon.id);
				database.query('UPDATE combat_encounters SET raid_completed=? WHERE id=?').run(completed!, id);
			}
			if (status === 'victory' && row.raid_endpoint === dungeon.tiers.length && !database.query('SELECT 1 FROM combat_test_profiles WHERE client_id=?').get(row.client_id)) {
				const elapsed = active_ms ?? now - row.created_at;
				if (!Number.isSafeInteger(elapsed) || elapsed <= 0) return false;
				database.query(`INSERT INTO combat_raid_records(client_id,raid,ruleset,elapsed_ms,achieved_at) VALUES(?,?,?,?,?)
					ON CONFLICT(client_id,raid,ruleset) DO UPDATE SET elapsed_ms=excluded.elapsed_ms,achieved_at=excluded.achieved_at
					WHERE excluded.elapsed_ms<combat_raid_records.elapsed_ms`).run(row.client_id,dungeon.id,dungeon.ruleset,elapsed,now);
			}
		}
		if (row.practice_id !== null && status !== 'interrupted') {
			const practice = practice_selection(`practice_${row.practice_id}_${row.practice_tier}`);
			if (!practice || row.raid_ruleset !== PRACTICE_RULESET || !Number.isSafeInteger(completed) ||
				completed! < row.practice_completed || completed! > row.practice_completed + 1 || completed! > practice.definition.waves.length ||
				(status === 'victory' && completed !== practice.definition.waves.length) ||
				(status !== 'victory' && completed === practice.definition.waves.length) ||
				(completed! > row.practice_completed && !['active','victory'].includes(status))) return false;
			database.query('UPDATE combat_encounters SET practice_completed=? WHERE id=?').run(completed!,id);
			if (status === 'victory') database.query(`INSERT OR IGNORE INTO combat_practice_completions(client_id,practice_id,tier,ruleset)
				VALUES(?,?,?,?)`).run(row.client_id,row.practice_id,row.practice_tier,PRACTICE_RULESET);
		}
		if (status === 'victory' && row.tutorial_trial !== null && !tutorial_victory(database, row.client_id, row.tutorial_trial)) return false;
		database.query('UPDATE combat_encounters SET used=?,status=?,completed_at=? WHERE id=?').run(used, status, status === 'active' ? null : now, id);
		return status !== 'interrupted';
	}).immediate();
}
export function interrupt_combats(database: Database, controller?: string) {
	for (const row of database.query<Encounter, []>("SELECT * FROM combat_encounters WHERE status='active' AND id NOT IN (SELECT encounter_id FROM combat_recovery)").all())
		if (!controller || row.controller === controller) update_combat(database, row.controller, row.id, row.used, 'interrupted');
}
