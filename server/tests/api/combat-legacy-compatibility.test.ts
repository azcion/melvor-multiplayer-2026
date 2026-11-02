import { expect, test } from 'bun:test';
import { register_client, post_json, get_json_with_session } from '../support/http';
// Wire shapes checked against the released 1.6.17 client (public source 560b281).
// That client has no Online Combat controller; its Guild Raid and other v2 APIs remain independent.
test('released 1.6.17 registration, authentication, events and unrelated reads survive combat rollout', async () => {
	const client=await register_client('Released Compatibility',undefined,'1.6.17');
	const auth=await post_json<any>('/api/authenticate',{
		client_identifier:client.client_identifier,client_key:client.client_key,
		client_runtime:{mod_version:'1.6.17',active_mods:[]}
	});
	expect(auth.response.status).toBe(200);
	expect(auth.json.session_token).toBeString();
	expect(auth.json.api_version).toBe(2);
	const session=auth.json.session_token;
	const events=await get_json_with_session<any>('/api/events',session);
	expect(events.response.status).toBe(200);
	for(const field of ['gifts','trades','resolved_trades','economy_receipts']) expect(Array.isArray(events.json[field])).toBe(true);
	for(const path of ['/api/updates','/api/inbox','/api/market/listings','/api/expedition/state','/api/raids/state']) {
		const result=await get_json_with_session<any>(path,session);
		expect(result.response.status,path).toBe(200);
	}
});
