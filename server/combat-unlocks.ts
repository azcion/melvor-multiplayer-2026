import type { Database } from 'bun:sqlite';
import { DUNGEONS } from './combat/raids';
import { EQUIPMENT_SLOTS } from './equipment-recipes';
const skills = ['attack','strength','defence','hitpoints','ranged','magic'] as const;
type Unlocks = { skill_caps_json: string; material_caps_json: string; food_cap: number; auto_eat: number };
export function combat_unlocks(database: Database, client: number) {
	const saved = database.query<Unlocks, [number]>('SELECT * FROM combat_unlocks WHERE client_id=?').get(client);
	const permanent = JSON.parse(saved?.skill_caps_json ?? '{}');
	const materials = JSON.parse(saved?.material_caps_json ?? '{}');
	const graduated = database.query<{ victories: number }, [number]>('SELECT victories FROM combat_tutorial WHERE client_id=?').get(client)?.victories === 7;
	return { skill_caps: Object.fromEntries(skills.map(skill => [skill, Math.max(permanent[skill] ?? 1, graduated && skill === 'hitpoints' ? 3 : 1)])),
		material_caps: Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, Math.max(materials[slot] ?? 0, slot === 'Quiver' ? 0 : 2)])),
		food_cap: saved?.food_cap ?? 1, auto_eat: saved?.auto_eat === 1 };
}
export function raid_progress(database: Database, client: number, raid = 'golbins') {
	return database.query<{ tier: number; wins: number }, [number, string]>('SELECT tier,wins FROM combat_raid_progress WHERE client_id=? AND raid=?').all(client, raid);
}
export function dungeon_available(database: Database, client: number, raid: string) {
	const required = DUNGEONS[raid].requires;
	const progress = required ? raid_progress(database, client, required) : [];
	return !required || DUNGEONS[required].tiers.every((tier, i) =>
		(progress.find(row => row.tier === i + 1)?.wins ?? 0) >= tier.wins_required);
}
export function raid_endpoint(database: Database, client: number, raid = 'golbins') {
	const progress = raid_progress(database, client, raid), tiers = DUNGEONS[raid].tiers;
	return tiers.findIndex((tier, i) => (progress.find(row => row.tier === i + 1)?.wins ?? 0) < tier.wins_required) + 1 || tiers.length;
}
// Caller commits each boundary and encounter progress together. Already earned access survives resets/failure.
export function grant_raid_tier(database: Database, client: number, tier: number, raid = 'golbins') {
	const definition = DUNGEONS[raid].tiers[tier - 1];
	database.query(`INSERT INTO combat_raid_progress(client_id,raid,tier,wins) VALUES(?,?,?,1)
		ON CONFLICT(client_id,raid,tier) DO UPDATE SET wins=MIN(wins+1,?)`).run(client, raid, tier, definition.wins_required);
	const wins = raid_progress(database, client, raid).find(row => row.tier === tier)!.wins;
	if (wins < definition.wins_required) return;
	const unlocks = combat_unlocks(database, client), caps = unlocks.skill_caps;
	for (const skill of ['attack','strength','defence','hitpoints']) caps[skill] = Math.max(caps[skill], definition.cap);
	const materials = unlocks.material_caps;
	if (definition.material_cap) for (const slot of EQUIPMENT_SLOTS) {
		if (slot !== 'Quiver') materials[slot] = Math.max(materials[slot], definition.material_cap);
	}
	database.query(`INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,?)
		ON CONFLICT(client_id) DO UPDATE SET skill_caps_json=excluded.skill_caps_json,material_caps_json=excluded.material_caps_json,food_cap=MAX(combat_unlocks.food_cap,excluded.food_cap)`)
		.run(client, JSON.stringify(caps), JSON.stringify(materials), Math.max(unlocks.food_cap, definition.food_cap ?? 1));
	database.query('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?').run(client);
}
