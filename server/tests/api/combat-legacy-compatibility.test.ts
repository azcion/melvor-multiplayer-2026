import { expect, test } from 'bun:test';
import { register_client, post_json, get_json_with_session, post } from '../support/http';
for (const version of ['1.6.14', '1.6.15', '1.6.16', '1.6.17', '1.7.0'])
test(`${version} bootstrap communicates the floor and only supported clients receive ordinary state`, async () => {
	const client=await register_client('Released Compatibility',undefined,version);
	const auth=await post_json<any>('/api/authenticate',{
		client_identifier:client.client_identifier,client_key:client.client_key,
		client_runtime:{mod_version:version,active_mods:[]}
	});
	expect(auth.response.status).toBe(200);
	expect(auth.json.session_token).toBeString();
	expect(auth.json.api_version).toBe(2);
	expect(auth.json.minimum_supported_mod_version).toBe('1.7.0');
	const supported = version === '1.7.0';
	const session=auth.json.session_token;
	const events=await get_json_with_session<any>('/api/events',session);
	expect(events.response.status).toBe(200);
	if (supported) {
		for(const field of ['gifts','trades','resolved_trades','economy_receipts']) expect(Array.isArray(events.json[field])).toBe(true);
	} else {
		expect(events.json).toEqual({ revision: 0, unchanged: true, minimum_supported_mod_version: '1.7.0' });
	}
	expect((await post('/api/client/status/sync', { activities: [] }, session)).status).toBe(supported ? 200 : 426);
	for(const path of ['/api/updates','/api/inbox','/api/market/listings','/api/expedition/state','/api/raids/state','/api/chat/conversations','/api/chat/messages?conversation_kind=announcements&conversation_id=1']) {
		const result=await get_json_with_session<any>(path,session);
		expect(result.response.status,path).toBe(supported || path === '/api/updates' ? 200 : 426);
	}
});
