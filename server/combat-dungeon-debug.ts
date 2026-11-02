import type { Database } from 'bun:sqlite';
import { DUNGEONS } from './combat/raids';
import { EQUIPMENT_DEFINITIONS, EQUIPMENT_SLOTS } from './equipment-recipes';
import { FOOD_DEFINITIONS } from './combat-food';
import { WOODEN_EQUIPMENT, parse_registration } from './combat/catalog';
import { combat_unlocks, grant_raid_tier } from './combat-unlocks';
import { rollback_held } from './rollback-policy';
import { record_audit_event } from './audit';

const equipment = [...WOODEN_EQUIPMENT, ...EQUIPMENT_DEFINITIONS.filter(item => !item.unlock_only && item.tier <= 3 && item.slot !== 'Quiver')];
function dungeon_preceding(id: string, tier: number) {
	const preceding: Array<{raid:string;tier:number}> = [];
	const dungeon = DUNGEONS[id];
	if (dungeon.requires) preceding.push(...dungeon_preceding(dungeon.requires,DUNGEONS[dungeon.requires].tiers.length+1));
	for (let previous=1;previous<tier;previous++) preceding.push({raid:id,tier:previous});
	return preceding;
}
export function dungeon_debug_options() {
	return { targets: ['golbins','tidal','mire','quarry'].flatMap(id => DUNGEONS[id].tiers.map((tier,index) => ({
		id: `${id}:${index+1}`, dungeon: id, tier: index+1,
		level: Math.max(1,...dungeon_preceding(id,index+1).map(({raid,tier}) => DUNGEONS[raid].tiers[tier-1].cap)),
		material: Math.max(2,...dungeon_preceding(id,index+1).map(({raid,tier}) => DUNGEONS[raid].tiers[tier-1].material_cap ?? 0)),
		food_tier: Math.max(1,...dungeon_preceding(id,index+1).map(({raid,tier}) => DUNGEONS[raid].tiers[tier-1].food_cap ?? 1)), title: `${DUNGEONS[id].name} · ${index+1} · ${tier.name ?? 'Tier '+(index+1)}`
	}))), equipment: equipment.map(({item_id,name,slot,tier}) => ({item_id,name,slot,tier})),
		foods: FOOD_DEFINITIONS.slice(0,2).map(({item_id,name}) => ({item_id,name})) };
}
// Caller owns administrator authorization and the synchronous command/receipt transaction.
// No target Client, arbitrary SQL, EP grants, native inventory or shared Guild changes.
export function debug_dungeon(database: Database, client: number, command: string,
	input: { target?: unknown; revision?: unknown; levels?: unknown; gear?: unknown; food?: unknown; confirm?: unknown }, now = Date.now()) {
	const target = dungeon_debug_options().targets.find(target => target.id === input.target);
	if (!target || input.confirm !== true || rollback_held(database,client)) return {success:false,error:'rejected'};
	const character = database.query<{revision:number},[number]>('SELECT revision FROM combat_characters WHERE client_id=?').get(client);
	if ((character?.revision ?? null) !== input.revision) return {success:false,error:'quote_changed'};
	if (database.query("SELECT 1 FROM combat_encounters WHERE client_id=? AND status='active'").get(client)) return {success:false,error:'active'};
	if (database.query('SELECT 1 FROM combat_project_tracking WHERE client_id=?').get(client)) return {success:false,error:'tracking_busy'};
	const registration = parse_registration({levels:input.levels,gear:input.gear});
	if (!registration || !input.levels || Object.values(input.levels).some(value => !Number.isSafeInteger(value) || Number(value)<1 || Number(value)>25)) return {success:false,error:'rejected'};
	const selected = Object.entries(registration.gear).map(([slot,id]) => equipment.find(item => item.slot===slot && item.item_id===id));
	const food = FOOD_DEFINITIONS.slice(0,2).find(food => food.item_id === input.food);
	if (selected.some(item => !item) || !food) return {success:false,error:'rejected'};
	const revision = Math.max(now,(character?.revision ?? 0)+1);
	if (!Number.isSafeInteger(revision)) return {success:false,error:'rejected'};
	// Validate caps against a read-only projection before replacing anything.
	const preceding = dungeon_preceding(target.dungeon,target.tier);
	const cap = Math.max(1,...preceding.map(({raid,tier}) => DUNGEONS[raid].tiers[tier-1].cap));
	const material = Math.max(2,...preceding.map(({raid,tier}) => DUNGEONS[raid].tiers[tier-1].material_cap ?? 0));
	const food_cap = Math.max(1,...preceding.map(({raid,tier}) => DUNGEONS[raid].tiers[tier-1].food_cap ?? 1));
	if (Object.entries(registration.levels).some(([skill,level]) => level>Math.max(cap,skill==='hitpoints'?3:1)) || selected.some(item => item!.tier>material) || food.tier>food_cap) return {success:false,error:'cap_locked'};
	// Same replacement boundary as tutorial presets; encounter/receipt/report journals survive.
	database.query('DELETE FROM combat_characters WHERE client_id=?').run(client);
	database.query('INSERT INTO combat_characters(client_id,attack,strength,defence,hitpoints,revision) VALUES(?,?,?,?,?,?)').run(client,registration.levels.attack,registration.levels.strength,registration.levels.defence,registration.levels.hitpoints,revision);
	database.query('INSERT INTO combat_test_profiles(client_id) VALUES(?)').run(client);
	database.query('INSERT INTO combat_tutorial(client_id,victories) VALUES(?,7) ON CONFLICT(client_id) DO UPDATE SET victories=7').run(client);
	database.query('DELETE FROM combat_raid_progress WHERE client_id=?').run(client);
	database.query('DELETE FROM combat_unlocks WHERE client_id=?').run(client);
	for (const {raid,tier} of preceding) for (let win=0;win<DUNGEONS[raid].tiers[tier-1].wins_required;win++) grant_raid_tier(database,client,tier,raid);
	const unlocks = combat_unlocks(database,client);
	for (const slot of EQUIPMENT_SLOTS.filter(slot => slot!=='Quiver')) {
		const item = selected.find(item => item!.slot===slot);
		database.query('INSERT INTO combat_equipment_slots(client_id,slot,tier,equipped_item) VALUES(?,?,?,?)').run(client,slot,unlocks.material_caps[slot],item?.item_id ?? null);
	}
	database.query("INSERT INTO combat_food_access(client_id,slot,tier,equipped_item) VALUES(?,'Food',?,?)").run(client,unlocks.food_cap,food.item_id);
	// Complete every legal choice so the ordinary equipment picker can swap material conditions.
	for (const item of [...equipment.filter(item => item.tier<=unlocks.material_caps[item.slot]),...FOOD_DEFINITIONS.filter(food => food.tier<=unlocks.food_cap)])
		database.query("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,'{}',?,?)").run(client,item.item_id,now,now);
	record_audit_event({event_type:'combat-dungeon-test',source_key:`combat-dungeon-test:${client}:${command}`,actor:{kind:'client',client_id:client},command_id:command,occurred_at:now,details:{target:target.id,registration_json:JSON.stringify(registration),food:food.item_id}},database);
	return {success:true};
}
