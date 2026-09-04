import * as runtime from '../app-runtime';
import {
	acknowledge_inbox_claim,
	create_inbox_claim,
	get_inbox,
	get_inbox_claim_view,
	MAX_INBOX_EXISTING_ITEM_IDS,
	parse_inbox_existing_item_ids
} from '../inbox';
import type { HandlerResult } from '../http';

const { is_valid_uuid, session_get_route, session_post_route } = runtime;

export function register_inbox_routes(): void {
	session_get_route('/api/inbox', async (req, url, client_id) => get_inbox(client_id) as HandlerResult);

	session_post_route('/api/inbox/claim', async (req, url, client_id, json): Promise<HandlerResult> => {
		const existing_item_ids = parse_inbox_existing_item_ids(json.existing_item_ids);
		const available_slots = json.available_slots;
		if (existing_item_ids === null || typeof available_slots !== 'number' ||
			!Number.isSafeInteger(available_slots) || available_slots < 0)
			return 400;

		const claim_id = create_inbox_claim(client_id, existing_item_ids, available_slots);
		return { claim: claim_id === null ? null : get_inbox_claim_view(claim_id, client_id) };
	});

	session_post_route('/api/inbox/acknowledge', async (req, url, client_id, json): Promise<HandlerResult> => {
		if (typeof json.claim_id !== 'string' || !is_valid_uuid(json.claim_id))
			return 400;
		return acknowledge_inbox_claim(client_id, json.claim_id) ? { success: true } : 404;
	});
}
