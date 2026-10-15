import { test, expect } from 'bun:test';
import { make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json, register_client } from '../support/http';
import { db_all, db_run } from '../support/persistence';

test('informational categories preserve legacy API, Interdict admission and private roster disclosure', async () => {
	const pair = await make_guildmates('Category Subject','Category Viewer');
	await db_run('UPDATE guilds SET cheat_restriction_enabled=1 WHERE id=?',[pair.guild_id]);
	await db_run('UPDATE clients SET active_mods_visible=0 WHERE id=?',[pair.first_id]);
	const auth = await post_json<{ session_token: string; social_mode: string; social_mode_enforcement: string | null }>('/api/authenticate', {
		client_identifier: pair.first.client_identifier, client_key: pair.first.client_key,
		client_runtime: { mod_version: '1.6.12', active_mods: ['Time Skip','Remove Consumptions','Private Unflagged Mod'] }
	});
	expect(auth.json.social_mode).toBe('full');
	expect(auth.json.social_mode_enforcement).toBeNull();
	const roster = await get_json_with_session<{ members: Record<string, any>[] }>('/api/guilds/state',pair.second.session_token);
	const member = roster.json.members.find(m => m.client_id === pair.first_id)!;
	expect(member).toMatchObject({ using_cheats: false, cheats_detected_at: null, cheat_mods: [], social_mode: 'full', active_mods_visible: false, active_mods_available: false });
	expect(member.cheat_categories.map((c: any) => c.id)).toEqual(['time','resources']);
	expect(JSON.stringify(member)).not.toContain('Private Unflagged Mod');
	const directory = await get_json_with_session<{ members: Record<string, any>[] }>('/api/guilds/members?page=0',pair.second.session_token);
	expect(directory.json.members.find(m => m.client_id === pair.first_id)!.cheat_categories).toEqual(member.cheat_categories);
	const events = await get_json_with_session<{ social_mode: string }>('/api/events',auth.json.session_token);
	expect(events.json.social_mode).toBe('full');
	const legacy = await post_json<{ session_token: string; social_mode: string; social_mode_enforcement: string }>('/api/authenticate', {
		client_identifier: pair.first.client_identifier, client_key: pair.first.client_key,
		client_runtime: { mod_version: '1.6.12', active_mods: ['Add Items'], active_mod_details: [{name:'Add Items',id:null}] }
	});
	expect(legacy.json).toMatchObject({social_mode:'social',social_mode_enforcement:'guild'});
	const after = await get_json_with_session<{ members: Record<string, any>[] }>('/api/guilds/state',pair.second.session_token);
	const marked = after.json.members.find(m => m.client_id === pair.first_id)!;
	expect(marked.using_cheats).toBe(true);
	expect(marked.cheat_mods).toEqual(['Add Items']);
	expect(marked.cheat_categories.map((c: any) => c.id)).toEqual(['time','items','resources']);
	expect(marked.cheat_categories.find((c: any) => c.id==='items').mods[0].name).toBe('Add Items');
	// Informational categories do not write Item Cheats policy fields.
	expect(await db_all('SELECT mod_name FROM client_cheat_mod_detections WHERE client_id=?',[pair.first_id])).toEqual([{mod_name:'Add Items'}]);
	const outside = await register_client('Category Outsider');
	const outsiders = await get_json_with_session<Record<string, any>>('/api/guilds/state',outside.session_token);
	expect(JSON.stringify(outsiders.json)).not.toContain('cheat_categories');
});

test('applicant category details remain visible independently of ordinary mod sharing', async () => {
	const owner = await register_guild_client('Category Inspector','Category Applicants');
	const applicant = await register_client('Category Applicant');
	await post_json('/api/guilds/apply',{guild_id:owner.guild_id},applicant.session_token);
	await post_json('/api/authenticate', {
		client_identifier: applicant.client_identifier,client_key:applicant.client_key,
		client_runtime:{mod_version:'1.6.12',active_mods:['Multitasking','Hidden Mod']}
	});
	await db_run('UPDATE clients SET active_mods_visible=0 WHERE id=?',[applicant.client_id]);
	const state = await get_json_with_session<{applicants: Record<string, any>[]}>('/api/guilds/state',owner.session_token);
	expect(state.json.applicants[0].cheat_categories.map((c: any) => c.id)).toEqual(['multitasking']);
	expect(state.json.applicants[0].active_mods_visible).toBe(false);
	expect(JSON.stringify(state.json.applicants)).not.toContain('Hidden Mod');
});

test('1.6.11 clients keep their original runtime and Guild Interdict contract', async () => {
	const pair = await make_guildmates('Legacy Subject', 'Legacy Viewer', 'Legacy Contract', { first: '1.6.11', second: '1.6.11' });
	await db_run('UPDATE guilds SET cheat_restriction_enabled=1 WHERE id=?', [pair.guild_id]);
	const informational = await post_json<{ session_token: string; social_mode: string }>('/api/authenticate', {
		client_identifier: pair.first.client_identifier, client_key: pair.first.client_key,
		client_runtime: { mod_version: '1.6.11', active_mods: ['Time Skip'] }
	});
	expect(informational.response.status).toBe(200);
	expect(informational.json.social_mode).toBe('full');
	let roster = await get_json_with_session<{ members: Record<string, any>[] }>('/api/guilds/state', pair.second.session_token);
	let member = roster.json.members.find(row => row.client_id === pair.first_id)!;
	expect(member).toMatchObject({ using_cheats: false, cheats_detected_at: null, cheat_mods: [], social_mode: 'full' });
	expect(member.cheat_categories.map((row: any) => row.id)).toEqual(['time']);
	const interdict = await post_json<{ session_token: string; social_mode: string; social_mode_enforcement: string }>('/api/authenticate', {
		client_identifier: pair.first.client_identifier, client_key: pair.first.client_key,
		client_runtime: { mod_version: '1.6.11', active_mods: ['Add Items'] }
	});
	expect(interdict.response.status).toBe(200);
	expect(interdict.json).toMatchObject({ social_mode: 'social', social_mode_enforcement: 'guild' });
	roster = await get_json_with_session<{ members: Record<string, any>[] }>('/api/guilds/state', pair.second.session_token);
	member = roster.json.members.find(row => row.client_id === pair.first_id)!;
	expect(member.using_cheats).toBe(true);
	expect(member.cheats_detected_at).toBeGreaterThan(0);
	expect(member.cheat_mods).toEqual(['Add Items']);
	expect(member.cheat_categories.map((row: any) => row.id)).toEqual(['time', 'items']);
	const events = await get_json_with_session<{ social_mode: string; social_mode_enforcement: string }>('/api/events', interdict.json.session_token);
	expect(events.response.status).toBe(200);
	expect(events.json).toMatchObject({ social_mode: 'social', social_mode_enforcement: 'guild' });
});

test('reviewed Item Cheats set enforces Interdict while God Mode remains informational', async () => {
	for (const name of ['X  Auto Manger','Requirement Filler']) {
		const pair = await make_guildmates('Reviewed Subject','Reviewed Viewer');
		await db_run('UPDATE guilds SET cheat_restriction_enabled=1 WHERE id=?',[pair.guild_id]);
		const god = await post_json<{session_token:string;social_mode:string;social_mode_enforcement:string|null}>('/api/authenticate',{
			client_identifier:pair.first.client_identifier,client_key:pair.first.client_key,
			client_runtime:{mod_version:'1.6.12',active_mods:['God Mode']}
		});
		expect(god.json).toMatchObject({social_mode:'full',social_mode_enforcement:null});
		let roster = await get_json_with_session<{members:Record<string,any>[]}>('/api/guilds/state',pair.second.session_token);
		let member = roster.json.members.find(row=>row.client_id===pair.first_id)!;
		expect(member.cheat_categories.map((c:any)=>c.id)).toEqual(['resources','loot_rng']);
		expect(member.using_cheats).toBe(false);
		const flagged = await post_json<{session_token:string;social_mode:string;social_mode_enforcement:string}>('/api/authenticate',{
			client_identifier:pair.first.client_identifier,client_key:pair.first.client_key,
			client_runtime:{mod_version:'1.6.12',active_mods:[name]}
		});
		expect(flagged.json).toMatchObject({social_mode:'social',social_mode_enforcement:'guild'});
		roster = await get_json_with_session<{members:Record<string,any>[]}>('/api/guilds/state',pair.second.session_token);
		member = roster.json.members.find(row=>row.client_id===pair.first_id)!;
		expect(member.cheat_mods).toEqual([name]);
		expect(member.cheat_categories.map((c:any)=>c.id)).toEqual(['items','resources','loot_rng']);
		const clock = member.cheats_detected_at;
		await post_json('/api/authenticate',{
			client_identifier:pair.first.client_identifier,client_key:pair.first.client_key,
			client_runtime:{mod_version:'1.6.12',active_mods:[]}
		});
		const clocks = await db_all('SELECT cheats_detected_at FROM clients WHERE id=?',[pair.first_id]);
		expect(clocks).toEqual([{cheats_detected_at:clock}]);
	}
});
