import { expect, test } from 'bun:test';
import { get_json_with_session, register_client, request } from '../support/http';

test('leaderboard requires authentication but no Guild and validates pages', async () => {
	const anonymous = await request('/api/expedition/leaderboard');
	expect(anonymous.status).toBe(401);
	const client = await register_client('Leaderboard reader');
	const result = await get_json_with_session('/api/expedition/leaderboard', client.session_token);
	expect(result.response.status).toBe(200);
	expect(result.json).toMatchObject({page:0});
	for (const value of ['-1','1.5','NaN','9007199254740992','']) {
		const invalid = await request('/api/expedition/leaderboard?page=' + value, {headers:{'X-Session-Token':client.session_token}});
		expect(invalid.status).toBe(400);
	}
});
