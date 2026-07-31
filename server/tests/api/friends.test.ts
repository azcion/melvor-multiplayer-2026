import { describe, expect, test } from 'bun:test';
import { get_events, make_friends } from '../support/fixtures';
import { get_json_with_session, post_json, register_client } from '../support/http';
import type { Friend } from '../support/fixtures';

describe('friends API', () => {
	test('validates friend codes and prevents self requests', async () => {
		const client = await register_client('Friend Validation');
		const invalid = await post_json<{ error_lang: string }>('/api/friends/add', {
			friend_code: 'invalid'
		}, client.session_token);
		const unknown = await post_json<{ error_lang: string }>('/api/friends/add', {
			friend_code: '000-000-000'
		}, client.session_token);
		const self = await post_json<{ error_lang: string }>('/api/friends/add', {
			friend_code: client.friend_code
		}, client.session_token);

		expect(invalid.response.status).toBe(200);
		expect(invalid.json.error_lang).toBe('MOD_MP_INVALID_FRIEND_CODE_ERR');
		expect(unknown.json.error_lang).toBe('MOD_MP_UNKNOWN_FRIEND_CODE_ERR');
		expect(self.json.error_lang).toBe('MOD_MP_NO_SELF_LOVE_ERR');
	});

	test('creates only one visible request and enforces acceptance ownership', async () => {
		const [sender, recipient, stranger] = await Promise.all([
			register_client('  Request Sender  '),
			register_client('Request Recipient'),
			register_client('Request Stranger')
		]);

		const first = await post_json<{ success: boolean }>('/api/friends/add', {
			friend_code: recipient.friend_code
		}, sender.session_token);
		const duplicate = await post_json<{ success: boolean }>('/api/friends/add', {
			friend_code: recipient.friend_code
		}, sender.session_token);
		const requests = (await get_events(recipient)).friend_requests;
		const unauthorized = await post_json<{ success: boolean }>('/api/friends/accept', {
			request_id: requests[0].request_id
		}, stranger.session_token);

		expect(first.json.success).toBe(true);
		expect(duplicate.json.success).toBe(true);
		expect(requests).toHaveLength(1);
		expect(requests[0].friend.display_name).toBe('Request Sender');
		expect(unauthorized.json.success).toBe(false);
		expect((await get_events(recipient)).friend_requests).toHaveLength(1);
	});

	test('refreshes cached friend requests after a display name change', async () => {
		const [sender, recipient] = await Promise.all([
			register_client('Original Sender'),
			register_client('Request Recipient')
		]);
		await post_json('/api/friends/add', {
			friend_code: recipient.friend_code
		}, sender.session_token);

		const before = await get_events(recipient);
		const updated = await post_json<{
			success: boolean;
			display_name: string;
		}>('/api/client/set_display_name', {
			display_name: 'Custom Sender'
		}, sender.session_token);
		const after = await get_events(recipient);

		expect(before.friend_requests[0].friend.display_name).toBe('Original Sender');
		expect(updated.json.display_name).toBe('Custom Sender');
		expect(after.friend_requests[0].friend.display_name).toBe('Custom Sender');
	});

	test('accepts, lists, rejects duplicates, and removes friendships symmetrically', async () => {
		const pair = await make_friends('Friends Alice', 'Friends Bob');
		const first_listing = await get_json_with_session<{
			friends: Friend[];
		}>('/api/friends/get', pair.first.session_token);
		const second_listing = await get_json_with_session<{
			friends: Friend[];
		}>('/api/friends/get', pair.second.session_token);
		const existing = await post_json<{ error_lang: string }>('/api/friends/add', {
			friend_code: pair.second.friend_code
		}, pair.first.session_token);

		expect(first_listing.json.friends).toEqual([{
			friend_id: pair.second_id,
			display_name: 'Friends Bob',
			icon_id: pair.second.icon_id
		}]);
		expect(second_listing.json.friends).toEqual([{
			friend_id: pair.first_id,
			display_name: 'Friends Alice',
			icon_id: pair.first.icon_id
		}]);
		expect(existing.json.error_lang).toBe('MOD_MP_FRIENDSHIP_EXISTS');

		const removed = await post_json<{ success: boolean }>('/api/friends/remove', {
			friend_id: pair.second_id
		}, pair.first.session_token);
		const first_after = await get_json_with_session<{
			friends: Friend[];
		}>('/api/friends/get', pair.first.session_token);
		const second_after = await get_json_with_session<{
			friends: Friend[];
		}>('/api/friends/get', pair.second.session_token);

		expect(removed.json.success).toBe(true);
		expect(first_after.json.friends).toEqual([]);
		expect(second_after.json.friends).toEqual([]);
	});

	test('ignores and removes a pending request', async () => {
		const [sender, recipient] = await Promise.all([
			register_client('Ignored Sender'),
			register_client('Ignoring Recipient')
		]);

		await post_json('/api/friends/add', {
			friend_code: recipient.friend_code
		}, sender.session_token);
		const request = (await get_events(recipient)).friend_requests[0];
		const ignored = await post_json<{ success: boolean }>('/api/friends/ignore', {
			request_id: request.request_id
		}, recipient.session_token);

		expect(ignored.json.success).toBe(true);
		expect((await get_events(recipient)).friend_requests).toEqual([]);
	});
});
