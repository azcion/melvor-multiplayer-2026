import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { cancel_scheduled_client_deletion, execute_due_client_deletions, get_client_deletion_status, list_sibling_identities, schedule_client_deletion, session_get_route, session_post_route } = runtime;

export function register_identities_routes(): void {
	session_get_route('/api/identities', async (req, url, client_id) => {
		execute_due_client_deletions();
		return {
			identities: list_sibling_identities(client_id),
			self_deletion: get_client_deletion_status(client_id)
		};
	});

	session_post_route('/api/identities/delete', async (req, url, client_id, json) => {
		const target_client_id = json.client_id;
		if (typeof target_client_id !== 'number')
			return 400; // Bad Request
		const result = schedule_client_deletion(client_id, target_client_id);
		if (result === 'bad_request')
			return 400; // Bad Request
		if (result === 'missing')
			return 404; // Not Found
		if (result === 'pending')
			return Response.json({ identity_status: 'deletion_pending' }, { status: 409 });
		return { success: true, deletion: result };
	});

	session_post_route('/api/identities/delete/cancel', async (req, url, client_id, json) => {
		const target_client_id = json.client_id;
		if (typeof target_client_id !== 'number')
			return 400; // Bad Request
		const result = cancel_scheduled_client_deletion(client_id, target_client_id);
		if (result === 'bad_request')
			return 400; // Bad Request
		if (result === 'missing')
			return 404; // Not Found
		return { success: true };
	});
}
