import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { accept_friend_request, create_friend_request, delete_friend, delete_friend_request, friend_request_exists, friendship_exists, get_client_display_name, get_friend_request, get_friends, get_user_id_from_friend_code, is_valid_friend_code, session_get_route, session_post_route } = runtime;

export function register_friends_routes(): void {
	session_post_route('/api/friends/remove', async (req, url, client_id, json) => {
		const friend_id = json.friend_id;
		if (typeof friend_id !== 'number')
			return 400; // Bad Request

		await delete_friend(client_id, friend_id);

		return { success: true };
	});

	session_get_route('/api/friends/get', async (req, url, client_id, json) => {
		return {
			friends: await get_friends(client_id)
		}
	});

	session_post_route('/api/friends/accept', async (req, url, client_id, json) => {
		const request_id = json.request_id;
		if (typeof request_id !== 'number')
			return 400; // Bad Request;

		const friend_id = accept_friend_request(client_id, request_id);
		if (friend_id !== null) {
			return {
				success: true,
				friend: {
					friend_id,
					display_name: await get_client_display_name(friend_id)
				}
			};
		}

		return { success: false } as JsonSerializable;
	});

	session_post_route('/api/friends/ignore', async (req, url, client_id, json) => {
		const request_id = json.request_id;
		if (typeof request_id !== 'number')
			return 400; // Bad Request

		const request = await get_friend_request(request_id);
		if (request !== null && request.client_id === client_id)
			await delete_friend_request(request);

		return { success: true };
	});

	session_post_route('/api/friends/add', async (req, url, client_id, json) => {
		const friend_code = json.friend_code;
		if (typeof friend_code !== 'string')
			return 400; // Bad Request

		if (!is_valid_friend_code(friend_code))
			return { error_lang: 'MOD_MP_INVALID_FRIEND_CODE_ERR' };

		const friend_user_id = await get_user_id_from_friend_code(friend_code);
		if (friend_user_id === -1)
			return { error_lang: 'MOD_MP_UNKNOWN_FRIEND_CODE_ERR' };

		if (friend_user_id === client_id)
			return { error_lang: 'MOD_MP_NO_SELF_LOVE_ERR' };

		if (await friendship_exists(client_id, friend_user_id))
			return { error_lang: 'MOD_MP_FRIENDSHIP_EXISTS' };

		// note: client_id and friend_id are swapped when inserting, as it makes logical sense to look up
		// client_id for requests, then add the friend_id, rather than looking up friend_id.
		if (!(await friend_request_exists(friend_user_id, client_id)))
			await create_friend_request(friend_user_id, client_id);

		return { success: true } as JsonSerializable;
	});
}
