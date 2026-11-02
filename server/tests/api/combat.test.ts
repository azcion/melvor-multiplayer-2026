import { expect, test } from 'bun:test';
import { register_client, post, get_json_with_session, post_json } from '../support/http';
import { get_events } from '../support/fixtures';
import { db_all, db_run } from '../support/persistence';

test('combat ticket requires a session and is disabled without explicit host configuration', async () => {
	expect((await post('/api/combat/ticket', {})).status).toBe(401);
	const client = await register_client();
	const response = await post('/api/combat/ticket', {}, client.session_token);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ available: false });
});

test('combat food custody routes are retired and preparation needs no deposit enrollment', async()=>{
	const owner=await register_client('Food Unlocks',undefined,'1.7.0');
	expect((await post_json<any>('/api/combat/prepare',{command_id:crypto.randomUUID()},owner.session_token)).json.success).toBe(true);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
	for (const action of ['deposit','withdraw','refund']) expect((await post(`/api/combat/${action}`,{command_id:crypto.randomUUID()},owner.session_token)).status).toBe(404);
	const state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.foods).toEqual([]);expect(state.food_id).toBe('');
	expect(state.inventory).toBeUndefined();expect(state.deposits_enabled).toBeUndefined();
});

test('combat levels debit EP once, serialize stale quotes and refund once without native input', async () => {
	const owner = await register_client('Combat Levels', undefined, '1.7.0');
	const other = await register_client('Unrelated Old Client', undefined, '1.6.17');
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,5000000)', [owner.client_id]);
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,7000000)', [other.client_id]);
	expect((await post('/api/combat/register', { command_id: crypto.randomUUID(), levels: { attack:99 } }, owner.session_token)).status).toBe(404);
	expect((await post('/api/v2/combat/level', { skill:'attack', revision:0 }, owner.session_token)).status).toBe(400);
	expect((await post_json<any>('/api/combat/prepare', { command_id:crypto.randomUUID(), levels:{attack:99}, gear:{Weapon:'melvorD:Dragon_Sword'} }, owner.session_token)).json.success).toBe(true);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
	const payload={command_id:crypto.randomUUID(),upgrades:{attack:1},revision:0};
	const [first,second]=await Promise.all([
		post_json<any>('/api/combat/level',payload,owner.session_token),
		post_json<any>('/api/combat/level',{command_id:crypto.randomUUID(),upgrades:{strength:1},revision:0},owner.session_token)
	]);
	expect([first.json.success,second.json.success].filter(Boolean)).toHaveLength(1);
	const winner=first.json.success?first:second;
	expect(winner.json.paid_micros).toBe(1000000);
	const winning_payload={command_id:winner.json.receipt.id,upgrades:{[first.json.success?'attack':'strength']:1},revision:0};
	const replay=(await post_json<any>('/api/combat/level',winning_payload,owner.session_token)).json;
	expect(replay).toEqual(winner.json);
	expect((await post('/api/combat/level',winning_payload,other.session_token)).status).toBe(400);
	let state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.ep_micros).toBe(4000000);expect(state.character.revision).toBe(1);
	expect(state.character.levels.strength).toBe(1);expect(state.character.gear).toEqual({});
	const reset={command_id:crypto.randomUUID(),revision:1};
	const result=(await post_json<any>('/api/combat/reset-levels',reset,owner.session_token)).json;
	expect(result).toMatchObject({success:true,refunded_micros:900000,fee_micros:100000});
	expect((await post_json<any>('/api/combat/reset-levels',reset,owner.session_token)).json).toEqual(result);
	expect((await post_json<any>('/api/combat/level',winning_payload,owner.session_token)).json).toEqual(winner.json);
	state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.ep_micros).toBe(4900000);expect(state.character.max_hp).toBe(10);
	expect(Object.values(state.character.levels)).toEqual([1,1,1,1,1,1]);
	expect(await db_all('SELECT points_micros FROM expedition_ep_balances WHERE client_id=?',[other.client_id])).toEqual([{points_micros:7000000}]);
	expect(await db_all('SELECT amount_micros FROM combat_ep_ledger WHERE client_id=? ORDER BY id',[owner.client_id])).toEqual([{amount_micros:-1000000},{amount_micros:900000}]);
});

test('bulk level command and free reset replay commit once and unavailable skills cannot spend', async () => {
	const owner=await register_client('Bulk Reset',undefined,'1.7.0');
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,100000000)',[owner.client_id]);
	await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
	const buy={command_id:crypto.randomUUID(),upgrades:{attack:19,strength:2},revision:0};
	const purchased=(await post_json<any>('/api/combat/level',buy,owner.session_token)).json;
	expect(purchased).toMatchObject({success:true,levels:{attack:20,strength:3},paid_micros:33000000});
	expect((await post_json<any>('/api/combat/level',buy,owner.session_token)).json).toEqual(purchased);
	for(const skill of ['ranged','magic']) expect((await post_json<any>('/api/combat/level',{command_id:crypto.randomUUID(),upgrades:{[skill]:1},revision:1},owner.session_token)).json.success).toBe(false);
	await db_run('INSERT INTO combat_reset_balances(client_id,resets) VALUES(?,1)',[owner.client_id]);
	const reset={command_id:crypto.randomUUID(),revision:1};
	const refunded=(await post_json<any>('/api/combat/reset-levels',reset,owner.session_token)).json;
	expect(refunded).toMatchObject({success:true,refunded_micros:33000000,fee_micros:0});
	expect((await post_json<any>('/api/combat/reset-levels',reset,owner.session_token)).json).toEqual(refunded);
	const state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.ep_micros).toBe(100000000);expect(state.character.banked_resets).toBe(0);
	expect(state.character.levels.attack).toBe(1);
	expect(await db_all('SELECT amount_micros FROM combat_ep_ledger WHERE client_id=? ORDER BY id',[owner.client_id])).toEqual([{amount_micros:-33000000},{amount_micros:33000000}]);
});

test('guildless personal equipment commands replay without Bank effects and exact work remains private without EP', async () => {
	const owner = await register_client('Personal Equipment', undefined, '1.7.0');
	const other = await register_client('Other Equipment', undefined, '1.7.0');
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,5000000)', [owner.client_id]);
	await post_json('/api/combat/prepare', { command_id: crypto.randomUUID() }, owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
	for (const [revision, action] of ['unlock-slot', 'unlock-tier', 'start-project'].entries()) {
		const payload = { command_id: crypto.randomUUID(), revision, slot: 'Weapon', item_id: 'melvorD:Bronze_Dagger', discovered: true };
		const result = (await post_json<any>(`/api/combat/${action}`, payload, owner.session_token)).json;
		expect(result.success).toBe(true); expect(result.receipt.effects).toEqual([]);
		expect((await post_json<any>(`/api/combat/${action}`, payload, owner.session_token)).json).toEqual(result);
	}
	const personal = (await get_json_with_session<any>('/api/expedition/personal', owner.session_token)).json;
	expect(personal.equipment_projects.project.item_id).toBe('melvorD:Bronze_Dagger');
	const task = personal.equipment_projects.project.stages[0][0];
	const key = task.task_id, epoch = crypto.randomUUID();
	const payload = { source: 'equipment', project_id: personal.equipment_projects.project.id, task_id: key,
		operation_id: crypto.randomUUID(), captured_at: Date.now(), actions: { epoch, time_ms: { [key]: 0 } },
		activities: [{ type: 'skill', skill_id: task.skill_id, action_id: task.action_id }], statistics: { version: 1, time_ms: { [task.skill_id]: 0 } } };
	expect((await post('/api/expedition/task/start', { ...payload, actions: { epoch, time_ms: { [key]: -1 } } }, owner.session_token)).status).toBe(400);
	expect((await post_json<any>('/api/expedition/task/start', payload, other.session_token)).json.success).toBe(false);
	const started = (await post_json<any>('/api/expedition/task/start', payload, owner.session_token)).json;
	expect(started.tracking.source).toBe('equipment');
	const catalog_revision = personal.equipment_projects.catalog_revision;
	const compact_route = '/api/expedition/task/check-in?equipment_catalog=' + catalog_revision;
	const check = { ...payload, operation_id:crypto.randomUUID(), captured_at:Date.now() };
	const current = (await post_json<any>(compact_route, check, owner.session_token)).json;
	expect(current.equipment_work_current).toBe(true);
	expect(current.equipment_projects.catalog).toBeUndefined();
	const repeated = (await post_json<any>(compact_route, check, owner.session_token)).json;
	expect(repeated.equipment_work_current).toBe(false);
	expect({ ...repeated, equipment_work_current:true }).toEqual(current);
	const legacy_report = (await post_json<any>('/api/expedition/task/check-in', check, owner.session_token)).json;
	expect(legacy_report.equipment_work_current).toBeUndefined();
	expect(legacy_report.equipment_projects.catalog).toEqual(personal.equipment_projects.catalog);
	expect((await post_json<any>('/api/expedition/task/start', payload, owner.session_token)).json).toEqual(started);
	expect((await post_json<any>('/api/expedition/task/start', { ...payload, operation_id: crypto.randomUUID() }, owner.session_token)).json.error).toBe('tracking_busy');
	await db_run('UPDATE combat_project_tracking SET started_at=started_at-300000,start_clock_offset_ms=0 WHERE client_id=?', [owner.client_id]);
	const stop = { ...payload, operation_id: crypto.randomUUID(), captured_at: Date.now(), actions: { epoch, time_ms: { [key]: 300000 } }, statistics: { version: 1, time_ms: { [task.skill_id]: 300000 } } };
	const settled = (await post_json<any>('/api/expedition/task/stop', stop, owner.session_token)).json;
	expect(settled.settlement.credited_ms).toBe(300000); expect(settled.tracking).toBeNull();
	expect((await post_json<any>('/api/expedition/task/stop', stop, owner.session_token)).json).toEqual(settled);
	expect((await get_json_with_session<any>('/api/expedition/personal', other.session_token)).json.equipment_projects.project).toBeNull();
	expect(await db_all('SELECT points_micros FROM expedition_ep_balances WHERE client_id=?', [owner.client_id])).toEqual([{ points_micros: 3000000 }]);
	for (const table of ['expedition_ep_ledger', 'expedition_work_sessions', 'expedition_work_claims', 'combat_reset_balances'])
		expect(await db_all(`SELECT * FROM ${table} WHERE client_id=?`, [owner.client_id])).toEqual([]);
	const before_cancel = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	const cancel = { command_id: crypto.randomUUID(), revision: before_cancel.character.revision, project_id: personal.equipment_projects.project.id };
	const cancelled = (await post_json<any>('/api/combat/cancel-project', cancel, owner.session_token)).json;
	expect(cancelled.success).toBe(true);
	expect(cancelled.receipt.effects).toEqual([]);
	const after_cancel = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect(after_cancel.equipment_projects.project).toBeNull();
	expect((await post_json<any>('/api/combat/start-project', { command_id: crypto.randomUUID(), revision: after_cancel.character.revision, item_id: 'melvorD:Bronze_Dagger', discovered: true }, owner.session_token)).json.success).toBe(true);
	expect((await post_json<any>('/api/combat/cancel-project', cancel, owner.session_token)).json).toEqual(cancelled);
	const restarted = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json.equipment_projects.project;
	expect(restarted.id).not.toBe(cancel.project_id);
	expect(restarted.stages.flat().every((task: any) => task.player_ms === 0)).toBe(true);

});

test('all Bronze through Rune equipment recipes are server catalog data and equip enforces owned slot and tier', async () => {
	const owner = await register_client('Equipment Catalog', undefined, '1.7.0');
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,50000000)', [owner.client_id]);
	await post_json('/api/combat/prepare', { command_id: crypto.randomUUID() }, owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
	let state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect(state.equipment_projects.catalog).toHaveLength(82);
	const two_handed = state.equipment_projects.catalog.find((item: any) => item.item_id === 'melvorD:Bronze_2H_Sword');
	expect(two_handed).toMatchObject({ slot: 'Weapon', tier: 1, occupies: ['Shield'] });
	expect(two_handed.stats).toContainEqual({ key: 'attackSpeed', value: 3600 });
	expect(state.equipment_projects.catalog.find((item: any) => item.item_id === 'melvorD:Rune_Gloves').stages[1][0]).toMatchObject({
		action_id: 'melvorD:Runite_Bar', target_ms: 600000
	});
	expect(state.equipment_projects.access.find((entry: any) => entry.slot === 'Gloves')).toEqual({
		slot: 'Gloves', unlock_cost_micros: 1000000,
		tiers: [1, 2, 3, 4, 5, 6].map((tier: number) => ({
			tier, name: ['Bronze', 'Iron', 'Steel', 'Mithril', 'Adamant', 'Rune'][tier - 1], cost_micros: tier * 1000000
		}))
	});
	const equip = (slot: string, tier: number, action: 'unlock-slot' | 'unlock-tier') => post_json<any>(`/api/combat/${action}`, {
		command_id: crypto.randomUUID(), revision: state.character.revision, slot, tier
	}, owner.session_token);
	expect((await equip('Weapon', 1, 'unlock-slot')).json.success).toBe(true);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await equip('Weapon', 1, 'unlock-tier')).json.success).toBe(true);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await equip('Shield', 1, 'unlock-slot')).json.success).toBe(true);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await equip('Shield', 1, 'unlock-tier')).json.success).toBe(true);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await post_json<any>('/api/combat/equip', { command_id: crypto.randomUUID(), revision: state.character.revision,
		slot: 'Weapon', item_id: 'melvorD:Bronze_Dagger' }, owner.session_token)).json.error).toBe('project_unavailable');
	await db_run('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,?,?,?)',
		[owner.client_id, 'melvorD:Bronze_Dagger', '{}', Date.now(), Date.now()]);
	await db_run('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,?,?,?)',
		[owner.client_id, 'melvorD:Bronze_Shield', '{}', Date.now(), Date.now()]);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await post_json<any>('/api/combat/equip', { command_id: crypto.randomUUID(), revision: state.character.revision,
		slot: 'Shield', item_id: 'melvorD:Bronze_Dagger' }, owner.session_token)).json.error).toBe('project_unavailable');
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await post_json<any>('/api/combat/equip', { command_id: crypto.randomUUID(), revision: state.character.revision,
		slot: 'Shield', item_id: 'melvorD:Bronze_Shield' }, owner.session_token)).json.success).toBe(true);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await post_json<any>('/api/combat/equip', { command_id: crypto.randomUUID(), revision: state.character.revision,
		slot: 'Weapon', item_id: 'melvorD:Bronze_Dagger' }, owner.session_token)).json.success).toBe(true);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	await db_run('INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,?,?,?,?)',
		[owner.client_id, 'melvorD:Bronze_2H_Sword', '{}', Date.now(), Date.now()]);
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await post_json<any>('/api/combat/equip', { command_id: crypto.randomUUID(), revision: state.character.revision,
		slot: 'Weapon', item_id: 'melvorD:Bronze_2H_Sword' }, owner.session_token)).json.success).toBe(true);
	expect((await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json.equipment_projects.slots.find((slot: any) => slot.slot === 'Shield').equipped_item).toBeNull();
	state = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	expect((await post_json<any>('/api/combat/equip', { command_id: crypto.randomUUID(), revision: state.character.revision,
		slot: 'Shield', item_id: 'melvorD:Bronze_Shield' }, owner.session_token)).json.error).toBe('slot_conflict');
});

test('equipment test completion is allowlisted, owner-only and replay-safe without Bank effects', async () => {
	const owner = await register_client('Equipment Admin', undefined, '1.7.0');
	const other = await register_client('Equipment Nonadmin', undefined, '1.7.0');
	const debug_identifier = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
	const previous = await db_all<{id:number}>('SELECT id FROM clients WHERE client_identifier=?',[debug_identifier]);
	for (const row of previous) await db_run('UPDATE clients SET client_identifier=? WHERE id=?',[crypto.randomUUID(),row.id]);
	try {
		await db_run('UPDATE clients SET client_identifier=? WHERE id=?',[debug_identifier,owner.client_id]);
		await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,5000000) ON CONFLICT(client_id) DO UPDATE SET points_micros=excluded.points_micros',[owner.client_id]);
		await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
		for (const [revision,action] of ['unlock-slot','unlock-tier','start-project'].entries()) {
			expect((await post_json<any>(`/api/combat/${action}`,{command_id:crypto.randomUUID(),revision,slot:'Weapon',item_id:'melvorD:Bronze_Dagger',discovered:true},owner.session_token)).json.success).toBe(true);
		}
		const inventory = (await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
		const payload = {command_id:crypto.randomUUID(),project_id:inventory.equipment_projects.project.id,task_id:null,revision:inventory.character.revision};
		expect((await post('/api/combat/debug-project',payload)).status).toBe(401);
		expect((await post('/api/combat/debug-project',payload,other.session_token)).status).toBe(403);
		const result = (await post_json<any>('/api/combat/debug-project',payload,owner.session_token)).json;
		expect(result.success).toBe(true); expect(result.receipt.effects).toEqual([]);
		expect((await post_json<any>('/api/combat/debug-project',payload,owner.session_token)).json).toEqual(result);
		const after = (await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
		expect(after.equipment_projects.unlocked).toContain('melvorD:Bronze_Dagger');
		expect(after.equipment_projects.project).toBeNull(); expect(after.ep_micros).toBe(inventory.ep_micros);
		expect((await db_all<{n:number}>("SELECT COUNT(*) AS n FROM audit_events WHERE actor_client_id=? AND event_type='combat-project-test'",[owner.client_id]))[0].n).toBe(1);
	} finally {
		await db_run('UPDATE clients SET client_identifier=? WHERE id=?',[owner.client_identifier,owner.client_id]);
		for (const row of previous) await db_run('UPDATE clients SET client_identifier=? WHERE id=?',[debug_identifier,row.id]);
	}
});

test('equipment reset refunds once, shares free resets with levels and preserves unlocks and active projects', async () => {
	const owner=await register_client('Equipment Reset',undefined,'1.7.0');
	await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,5000000) ON CONFLICT(client_id) DO UPDATE SET points_micros=excluded.points_micros',[owner.client_id]);
	let state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	for(const action of ['unlock-slot','unlock-tier']) {
		expect((await post_json<any>(`/api/combat/${action}`,{command_id:crypto.randomUUID(),revision:state.character.revision,slot:'Weapon'},owner.session_token)).json.success).toBe(true);
		state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	}
	const stale=state.character.revision;
	await db_run('INSERT INTO combat_reset_balances(client_id,resets) VALUES(?,1)',[owner.client_id]);
	await db_run('UPDATE combat_characters SET revision=revision+1 WHERE client_id=?',[owner.client_id]);
	expect((await post_json<any>('/api/combat/reset-equipment',{command_id:crypto.randomUUID(),revision:stale},owner.session_token)).json.error).toBe('quote_changed');
	state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.equipment_projects.reset).toEqual({invested_micros:2000000,banked_resets:1,fee_micros:0,refund_micros:2000000});
	await db_run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,'melvorD:Bronze_Sword','{}',0,1)",[owner.client_id]);
	await db_run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at) VALUES(?,'melvorD:Bronze_Dagger','{}',0)",[owner.client_id]);
	const payload={command_id:crypto.randomUUID(),revision:state.character.revision};
	expect((await post('/api/combat/reset-equipment',{revision:payload.revision},owner.session_token)).status).toBe(400);
	const reset=(await post_json<any>('/api/combat/reset-equipment',payload,owner.session_token)).json;
	expect(reset).toMatchObject({success:true,refunded_micros:2000000,fee_micros:0});
	expect((await post_json<any>('/api/combat/reset-equipment',payload,owner.session_token)).json).toEqual(reset);
	state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.ep_micros).toBe(5000000); expect(state.character.banked_resets).toBe(0);
	expect(state.equipment_projects.slots).toEqual([]);
	expect(state.equipment_projects.unlocked).toContain('melvorD:Bronze_Sword');
	expect(state.equipment_projects.project.item_id).toBe('melvorD:Bronze_Dagger');
	expect((await post_json<any>('/api/combat/reset-equipment',{command_id:crypto.randomUUID(),revision:state.character.revision},owner.session_token)).json.error).toBe('nothing_to_reset');
	expect((await get_events(owner)).economy_receipts).toContainEqual(reset.receipt);
	expect((await post('/api/economy/receipts/acknowledge',{receipt_id:payload.command_id},owner.session_token)).status).toBe(200);
	expect((await post_json<any>('/api/combat/reset-equipment',payload,owner.session_token)).json.receipt).toBeNull();
	expect((await db_all<{points_micros:number}>('SELECT points_micros FROM expedition_ep_balances WHERE client_id=?',[owner.client_id]))[0].points_micros).toBe(5000000);
});

test('food EP purchase and selection use authenticated replay-safe commands and server revision gates', async () => {
	const owner = await register_client('Food EP', undefined, '1.7.0');
	await post_json('/api/combat/prepare', { command_id: crypto.randomUUID() }, owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO expedition_ep_balances(client_id,points_micros) VALUES(?,2000000) ON CONFLICT(client_id) DO UPDATE SET points_micros=excluded.points_micros', [owner.client_id]);
	const read = async () => (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
	let state = await read();
	const buy = { command_id: crypto.randomUUID(), slot: 'Food', revision: state.character.revision, tier: 1, cost_micros: 0 };
	const result = (await post_json<any>('/api/combat/unlock-tier', buy, owner.session_token)).json;
	expect(result.success).toBe(true); expect(result.receipt.effects).toEqual([]);
	expect((await post_json<any>('/api/combat/unlock-tier', buy, owner.session_token)).json).toEqual(result);
	state = await read(); expect(state.ep_micros).toBe(1000000);
	expect((await post_json<any>('/api/combat/unlock-tier', { ...buy, command_id: crypto.randomUUID(), revision: state.character.revision }, owner.session_token)).json.success).toBe(false);
	expect((await post_json<any>('/api/combat/equip', { command_id: crypto.randomUUID(), slot: 'Food', revision: state.character.revision, item_id: 'melvorD:Shrimp' }, owner.session_token)).json.success).toBe(false);
	await db_run("INSERT INTO combat_equipment_projects(client_id,item_id,progress_json,created_at,completed_at) VALUES(?,'melvorD:Shrimp','{}',0,1)", [owner.client_id]);
	const choose = { command_id: crypto.randomUUID(), slot: 'Food', revision: state.character.revision, item_id: 'melvorD:Shrimp' };
	expect((await post_json<any>('/api/combat/equip', choose, owner.session_token)).json.success).toBe(true);
	expect((await read()).food_id).toBe('melvorD:Shrimp');
	expect((await read()).ep_micros).toBe(1000000);
	expect((await db_all<{amount_micros:number}>('SELECT amount_micros FROM combat_ep_ledger WHERE client_id=?', [owner.client_id]))).toEqual([{ amount_micros: -1000000 }]);
});

test('card reset API carries the selected group and replays without resetting the other card', async () => {
	for (const group of ['equipment','consumables']) {
		const owner=await register_client('Card Reset',undefined,'1.7.0');
		await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?',[owner.client_id]);
	await db_run('INSERT INTO combat_unlocks(client_id,skill_caps_json,material_caps_json,food_cap) VALUES(?,?,?,8)',[owner.client_id,JSON.stringify({attack:99,strength:99,defence:99,hitpoints:99}),JSON.stringify(Object.fromEntries(['Weapon','Shield','Helmet','Platebody','Platelegs','Boots','Gloves','Quiver'].map(slot=>[slot,6])))]);
	await db_run('UPDATE expedition_ep_balances SET points_micros=points_micros-1000000 WHERE client_id=?',[owner.client_id]);
		await db_run("INSERT INTO combat_equipment_slots(client_id,slot,tier) VALUES(?,'Weapon',1)",[owner.client_id]);
		await db_run("INSERT INTO combat_food_access(client_id,slot,tier) VALUES(?,'Food',2)",[owner.client_id]);
		let state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
		expect(state.equipment_projects.resets[group]).toMatchObject({invested_micros:2000000,refund_micros:1800000});
		const payload={command_id:crypto.randomUUID(),revision:state.character.revision,group};
		const reset=(await post_json<any>('/api/combat/reset-equipment',payload,owner.session_token)).json;
		expect(reset).toMatchObject({success:true,refunded_micros:1800000,fee_micros:200000});
		expect((await post_json<any>('/api/combat/reset-equipment',payload,owner.session_token)).json).toEqual(reset);
		state=(await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
		expect(state.equipment_projects.slots.map((slot:any)=>slot.slot)).toEqual(group==='equipment'?['Food']:['Weapon']);
		expect(state.ep_micros).toBe(1800000);
	}
});

test('1.6.17 retains full equipment responses; compact clients negotiate hashes across all reads', async () => {
	const legacy = await register_client('Legacy Catalog', undefined, '1.6.17');
	const modern = await register_client('Compact Catalog', undefined, '1.7.0');
	for (const owner of [legacy, modern]) {
		const first = (await get_json_with_session<any>('/api/combat/inventory', owner.session_token)).json;
		const revision = first.equipment_projects.catalog_revision;
		expect(revision).toMatch(/^[a-f0-9]{64}$/);
		expect(first.equipment_projects.catalog.length).toBeGreaterThan(60);
		for (const route of ['/api/combat/inventory', '/api/expedition/personal']) {
			const full = (await get_json_with_session<any>(route, owner.session_token)).json;
			const compact = (await get_json_with_session<any>(route + '?equipment_catalog=' + revision, owner.session_token)).json;
			expect(compact.equipment_projects.catalog).toBeUndefined(); expect(compact.equipment_projects.access).toBeUndefined();
			expect({ ...compact.equipment_projects, catalog:full.equipment_projects.catalog, access:full.equipment_projects.access }).toEqual(full.equipment_projects);
			expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 5);
			const outdated = (await get_json_with_session<any>(route + '?equipment_catalog=old', owner.session_token)).json;
			expect(outdated.equipment_projects.catalog).toEqual(full.equipment_projects.catalog);
		}
		expect((await get_json_with_session<any>('/api/events', owner.session_token)).response.status).toBe(200);
	}
});

test('new characters receive one tutorial allowance and cannot buy levels before graduating', async () => {
	const owner = await register_client('Training Gates', undefined, '1.7.0');
	const payload = { command_id:crypto.randomUUID() };
	const prepared = (await post_json<any>('/api/combat/prepare',payload,owner.session_token)).json;
	expect(prepared.success).toBe(true);
	expect((await post_json<any>('/api/combat/prepare',payload,owner.session_token)).json).toEqual(prepared);
	await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},owner.session_token);
	let state = (await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.ep_micros).toBe(1_000_000);
	expect(state.tutorial).toMatchObject({complete:false,victories:0,next:'unlock-slot'});
	expect((await post_json<any>('/api/combat/level',{command_id:crypto.randomUUID(),upgrades:{attack:1},revision:0},owner.session_token)).json).toMatchObject({success:false,error:'tutorial_required'});
	const unlock = {command_id:crypto.randomUUID(),slot:'Weapon',revision:0};
	expect((await post_json<any>('/api/combat/unlock-slot',unlock,owner.session_token)).json.success).toBe(true);
	state = (await get_json_with_session<any>('/api/combat/inventory',owner.session_token)).json;
	expect(state.equipment_projects.unlocked).toContain('multiplayer:Wooden_Sword');
	expect(state.tutorial.next).toBe('equip');
	expect(state.ep_micros).toBe(0);
});

test('actual tutorial controls require admin, stay self-scoped and replay without repeated resets', async () => {
	const admin = await register_client('Tutorial Phase Admin', undefined, '1.7.0');
	const other = await register_client('Tutorial Phase Other', undefined, '1.7.0');
	await db_run('UPDATE clients SET client_identifier=? WHERE id=?',['TEST-ADMIN-COMBAT-TUTORIAL',admin.client_id]);
	await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},admin.session_token);
	await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},other.session_token);
	const inventory = () => get_json_with_session<any>('/api/combat/inventory',admin.session_token).then(result=>result.json);
	const before = await inventory();
	expect(before.tutorial_debug_targets).toContainEqual(expect.objectContaining({id:'4:battle'}));
	expect((await get_json_with_session<any>('/api/combat/inventory',other.session_token)).json.tutorial_debug_targets).toEqual([]);
	const payload = {command_id:crypto.randomUUID(),target:'4:battle',revision:before.character.revision,client_id:other.client_id};
	expect((await post('/api/combat/debug-tutorial',payload)).status).toBe(401);
	expect((await post('/api/combat/debug-tutorial',payload,other.session_token)).status).toBe(403);
	const result = (await post_json<any>('/api/combat/debug-tutorial',payload,admin.session_token)).json;
	expect(result.success).toBe(true);expect(result.receipt.effects).toEqual([]);
	const after = await inventory();
	expect(after.tutorial).toMatchObject({victories:4,ready:true});expect(after.ep_micros).toBe(before.ep_micros);
	expect((await get_json_with_session<any>('/api/combat/inventory',other.session_token)).json.tutorial.victories).toBe(0);
	const reset = {command_id:crypto.randomUUID(),target:'start',revision:after.character.revision};
	expect((await post_json<any>('/api/combat/debug-tutorial',reset,admin.session_token)).json.success).toBe(true);
	expect((await inventory()).character).toBeNull();
	// Replaying a prior phase command must not bring the fighter back after a later reset.
	expect((await post_json<any>('/api/combat/debug-tutorial',payload,admin.session_token)).json).toEqual(result);
	expect((await inventory()).character).toBeNull();
	await post_json('/api/combat/prepare',{command_id:crypto.randomUUID()},admin.session_token);
	expect((await inventory()).ep_micros).toBe(before.ep_micros);
	const setup = {command_id:crypto.randomUUID(),target:'tidal:2',confirm:true,revision:(await inventory()).character.revision,
		levels:{attack:12,strength:12,defence:12,hitpoints:12},gear:{Weapon:'melvorD:Iron_Sword',Shield:'melvorD:Iron_Shield'},food:'melvorD:Herring',client_id:other.client_id};
	expect((await post('/api/combat/debug-dungeon',setup)).status).toBe(401);
	expect((await post('/api/combat/debug-dungeon',setup,other.session_token)).status).toBe(403);
	expect((await get_json_with_session<any>('/api/combat/inventory',other.session_token)).json.dungeon_debug_options).toBeNull();
	const applied=(await post_json<any>('/api/combat/debug-dungeon',setup,admin.session_token)).json;
	expect(applied.success).toBe(true); expect(applied.receipt.effects).toEqual([]);
	const prepared=await inventory();
	expect(prepared.test_profile).toBe(true);
	expect(prepared.dungeons.find((d:any)=>d.id==='tidal')).toMatchObject({endpoint:2,available:true});
	expect(prepared.ep_micros).toBe(before.ep_micros);
	expect((await get_json_with_session<any>('/api/combat/inventory',other.session_token)).json.tutorial.victories).toBe(0);
	const second={...setup,command_id:crypto.randomUUID(),target:'mire:1',revision:prepared.character.revision};
	expect((await post_json<any>('/api/combat/debug-dungeon',second,admin.session_token)).json.success).toBe(true);
	expect((await post_json<any>('/api/combat/debug-dungeon',setup,admin.session_token)).json).toEqual(applied);
	expect((await inventory()).dungeons.find((d:any)=>d.id==='mire')).toMatchObject({endpoint:1,available:true});

	expect((await db_all<{n:number}>("SELECT COUNT(*) AS n FROM audit_events WHERE actor_client_id=? AND event_type='combat-tutorial-test'",[admin.client_id]))[0].n).toBe(2);
});

test('Practice preview negotiation keeps progression fresh and falls back to full definitions for old revisions', async () => {
	const owner = await register_client('Practice Cache', undefined, '1.7.0');
	await post_json('/api/combat/prepare', {command_id:crypto.randomUUID()}, owner.session_token);
	await db_run('UPDATE combat_tutorial SET victories=7 WHERE client_id=?', [owner.client_id]);
	const read = (query = '') => get_json_with_session<any>('/api/combat/inventory' + query, owner.session_token).then(result => result.json);
	const full = await read();
	expect(full.practice_catalog_revision).toMatch(/^[a-f0-9]{64}$/);
	expect(full.practice[0].tiers[0].waves.length).toBeGreaterThan(0);
	const compact = await read('?practice_catalog=' + full.practice_catalog_revision + '&equipment_catalog=' + full.equipment_projects.catalog_revision);
	expect(compact.practice[0].tiers[0].waves).toBeUndefined();
	expect(compact.equipment_projects.catalog).toBeUndefined();
	const restored = compact.practice.map((entry:any,index:number) => ({...entry, tiers:entry.tiers.map((tier:any,i:number) => ({...tier,waves:full.practice[index].tiers[i].waves}))}));
	expect(restored).toEqual(full.practice);
	expect(JSON.stringify(compact.practice).length).toBeLessThan(JSON.stringify(full.practice).length / 2);
	await db_run('INSERT INTO combat_practice_completions(client_id,practice_id,tier,ruleset) VALUES(?,?,?,?)', [owner.client_id,'recruit',1,'practice-1']);
	const changed = await read('?practice_catalog=' + full.practice_catalog_revision);
	expect(changed.practice[0].tiers[0].complete).toBe(true);
	expect(changed.practice[0].tiers[1].complete).toBe(false);
	const outdated = await read('?practice_catalog=outdated');
	expect(outdated.practice[0].tiers[0].waves).toEqual(full.practice[0].tiers[0].waves);
	const legacy = await read();
	expect(legacy.practice[0].tiers[0].waves).toEqual(full.practice[0].tiers[0].waves);
	await db_run('UPDATE combat_tutorial SET victories=0 WHERE client_id=?', [owner.client_id]);
	expect((await read('?practice_catalog=' + full.practice_catalog_revision)).practice).toEqual([]);
});
