import { expect, test } from 'bun:test';
import { post, post_json, register_client } from '../support/http';
import { register_guild_client } from '../support/fixtures';
import { db_all } from '../support/persistence';

const loaded_save = () => ({ load_id: crypto.randomUUID(), save_timestamp: Date.now() - 60_000,
	client_loaded_at: Date.now(), capture_source: 'decode' });

test('registers reported loads, reuses them on reconnect, and retains them after legacy authentication', async () => {
	const client_key = crypto.randomUUID();
	const report = loaded_save();
	const client_runtime = { mod_version: '1.6.10', active_mods: [], loaded_save: report };
	const registered = await post_json<{ client_identifier: string; chat: { client_id: number }; rollback_clock_sample: {original_handshake:boolean} }>('/api/register',
		{ client_key, display_name: 'Save Load Tracking', client_runtime });
	expect(registered.response.status).toBe(200);
	expect(registered.json.rollback_clock_sample.original_handshake).toBe(true);
	const client_id = registered.json.chat.client_id;
	const sessions = () => db_all<{ save_load_id: number | null }>('SELECT save_load_id FROM client_sessions WHERE client_id=?', [client_id]);
	const first_session = await sessions();
	expect(first_session[0]!.save_load_id).toBeNumber();
	const authenticate = (runtime?: unknown) => post('/api/authenticate', {
		client_identifier: registered.json.client_identifier, client_key,
		...(runtime === undefined ? {} : { client_runtime: runtime }) });
	const reconnect=await authenticate(client_runtime);
	expect(reconnect.status).toBe(200);
	expect((await reconnect.json() as any).rollback_clock_sample.original_handshake).toBe(false);
	expect(await sessions()).toEqual(first_session);
	expect(await db_all('SELECT save_timestamp, client_loaded_at, capture_source FROM character_save_loads WHERE client_id=?', [client_id]))
		.toEqual([{ save_timestamp: report.save_timestamp, client_loaded_at: report.client_loaded_at, capture_source: 'decode' }]);
	expect((await authenticate()).status).toBe(200);
	expect(await sessions()).toEqual([{ save_load_id: null }]);
	expect(await db_all('SELECT load_id FROM character_save_loads WHERE client_id=?', [client_id])).toEqual([{ load_id: report.load_id }]);
});

test('older loads are recorded without removing a Cast or preventing economy commands', async () => {
	const client = await register_guild_client('Save Cast Tracking', 'Save Tracking Guild', '1.6.10');
	const report = loaded_save();
	const authenticate = (loaded_save: unknown) => post_json<{ session_token: string }>('/api/authenticate', {
		client_identifier: client.client_identifier, client_key: client.client_key,
		client_runtime: { mod_version: '1.6.10', active_mods: [], loaded_save } });
	const first = await authenticate(report);
	expect(first.response.status).toBe(200);
	const cast = (token: string) => post_json<{ success: boolean }>('/api/crucible/cast', {
		command_id: crypto.randomUUID(), source: 'bank', items: [{ id: 'melvorD:GP', qty: 1_000_000_000 }]
	}, token);
	expect((await cast(first.json.session_token)).json.success).toBe(true);
	const older = { ...report, load_id: crypto.randomUUID(), save_timestamp: report.save_timestamp - 60_000 };
	const second = await authenticate(older);
	expect(second.response.status).toBe(200);
	expect(await db_all('SELECT qty FROM crucible_offerings WHERE guild_id=? AND item_id=?', [client.guild_id, 'melvorD:GP']))
		.toEqual([{ qty: 1_000_000_000 }]);
	expect(await db_all('SELECT save_timestamp FROM character_save_loads WHERE client_id=? ORDER BY id', [client.client_id]))
		.toEqual([{ save_timestamp: report.save_timestamp }, { save_timestamp: older.save_timestamp }]);
	expect((await cast(second.json.session_token)).json.success).toBe(true);
});

test('older clients remain untracked and malformed optional reports cannot create tracking rows', async () => {
	const legacy = await register_client('Legacy Save Tracking');
	expect(await db_all('SELECT save_load_id FROM client_sessions WHERE client_id=?', [legacy.client_id])).toEqual([{ save_load_id: null }]);
	expect(await db_all('SELECT id FROM character_save_loads WHERE client_id=?', [legacy.client_id])).toEqual([]);
	const response = await post('/api/authenticate', { client_identifier: legacy.client_identifier, client_key: legacy.client_key,
		client_runtime: { mod_version: '1.6.10', active_mods: [], loaded_save: { ...loaded_save(), save_timestamp: -1 } } });
	expect(response.status).toBe(400);
	expect(await db_all('SELECT id FROM character_save_loads WHERE client_id=?', [legacy.client_id])).toEqual([]);
});

test('authenticated clock sample stays bound to its original load and receipt replay remains valid', async () => {
	const client = await register_guild_client('Rollback Clock API', 'Rollback Clock Guild', '1.6.10');
	const authenticate = (report: unknown) => post_json<{ session_token:string;
		rollback_clock_sample:{server_admitted_at:number;load_id:string} }>('/api/authenticate', {
		client_identifier:client.client_identifier,client_key:client.client_key,
		client_runtime:{mod_version:'1.6.10',active_mods:[],loaded_save:report,
			device:{installation_id:'cccccccc-1111-4111-8111-aaaaaaaaaaaa'}} });
	const report=loaded_save();
	const sent=Date.now();const first=await authenticate(report);const received=Date.now();
	const sample={...first.json.rollback_clock_sample,client_sent_at:sent,client_received_at:received,elapsed_ms:received-sent};
	expect((await post('/api/save-load/clock',sample,first.json.session_token)).status).toBe(200);
	const command_id=crypto.randomUUID();
	const payload={command_id,source:'bank',items:[{id:'melvorD:GP',qty:1_000_000}]};
	const cast=await post_json<{success:boolean;receipt:{id:string}}>('/api/crucible/cast',payload,first.json.session_token);
	expect(cast.json.success).toBe(true);
	const before=await db_all('SELECT source_key,save_load_id,local_effect FROM economy_operations WHERE client_id=? AND source_key=?',
		[client.client_id,`receipt:${command_id}`]);
	expect(before).toEqual([expect.objectContaining({source_key:`receipt:${command_id}`,local_effect:'outgoing',save_load_id:expect.any(Number)})]);
	const older={...report,load_id:crypto.randomUUID(),save_timestamp:report.save_timestamp!-60_000};
	const restored=await authenticate(older);
	const replay=await post_json<{success:boolean;receipt:{id:string}}>('/api/crucible/cast',payload,restored.json.session_token);
	expect(replay.json.receipt.id).toBe(cast.json.receipt.id);
	expect((await post('/api/economy/receipts/acknowledge',{receipt_id:command_id},restored.json.session_token)).status).toBe(200);
	expect((await post('/api/economy/receipts/acknowledge',{receipt_id:command_id},restored.json.session_token)).status).toBe(200);
	expect(await db_all('SELECT kind,local_effect FROM economy_operations WHERE source_key=?',[`receipt-ack:${command_id}`]))
		.toEqual([{kind:'receipt-acknowledge',local_effect:'server_only'}]);
	expect(await db_all('SELECT source_key,save_load_id,local_effect FROM economy_operations WHERE client_id=? AND source_key=?',
		[client.client_id,`receipt:${command_id}`])).toEqual(before);
	expect((await post('/api/save-load/clock',sample,restored.json.session_token)).status).toBe(400);
	expect(await db_all('SELECT state FROM economy_incident_decisions d JOIN economy_incidents i ON i.id=d.incident_id JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.client_id=?', [client.client_id]))
		.toEqual([{state:'suspected'}]);
	expect(JSON.stringify(restored.json)).not.toContain('incident');
	const reconnect=await authenticate(older);
	expect(await db_all('SELECT i.id FROM economy_incidents i JOIN economy_load_observations l ON l.id=i.save_load_id WHERE l.client_id=?',[client.client_id])).toHaveLength(1);
	expect((await post('/api/save-load/clock',{...sample,...reconnect.json.rollback_clock_sample},reconnect.json.session_token)).status).toBe(200);
});

test('rollback protocol capability is explicit, persisted and cleared when omitted',async()=>{
	const client_key=crypto.randomUUID();
	const runtime={mod_version:'1.6.10',active_mods:[],capabilities:['save-rollback-v1','future-protocol']};
	const registered=await post_json<{client_identifier:string;session_token:string;chat:{client_id:number}}>('/api/register',
		{client_key,display_name:'Rollback Capability',client_runtime:runtime});
	expect(registered.response.status).toBe(200);
	const client_id=registered.json.chat.client_id;
	expect(await db_all('SELECT rollback_capable FROM client_sessions WHERE client_id=?',[client_id])).toEqual([{rollback_capable:1}]);
	expect(await db_all('SELECT capabilities FROM client_runtime_snapshots WHERE client_id=?',[client_id])).toEqual([{capabilities:'["save-rollback-v1"]'}]);
	const authenticate=(client_runtime:unknown)=>post('/api/authenticate',{client_key,client_identifier:registered.json.client_identifier,client_runtime});
	expect((await authenticate({...runtime,capabilities:undefined})).status).toBe(200);
	expect(await db_all('SELECT rollback_capable FROM client_sessions WHERE client_id=?',[client_id])).toEqual([{rollback_capable:0}]);
	expect((await authenticate({...runtime,capabilities:[42]})).status).toBe(400);
	expect(await db_all('SELECT rollback_capable FROM client_sessions WHERE client_id=?',[client_id])).toEqual([{rollback_capable:0}]);
});
