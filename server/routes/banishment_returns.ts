import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';

const { MAX_TRANSFER_ITEM_COUNT, acknowledge_deletion_return_claim, create_banishment_claim, create_deletion_return_claim, db, get_banishment_claim_view, get_deletion_claim_view, is_valid_uuid, parse_existing_item_ids, session_post_route } = runtime;

export function register_banishment_returns_routes(): void {
	session_post_route('/api/banishment/returns/claim', async (req, url, client_id, json): Promise<HandlerResult> => {
		const existing_item_ids = parse_existing_item_ids(json.existing_item_ids);
		if (existing_item_ids === null)
			return 400; // Bad Request
		const available_slots = json.available_slots;
		if (typeof available_slots !== 'number' || !Number.isSafeInteger(available_slots) ||
			available_slots < 0 || available_slots > MAX_TRANSFER_ITEM_COUNT)
			return 400; // Bad Request

		const banishment_claim_id = create_banishment_claim(client_id, existing_item_ids, available_slots);
		if (banishment_claim_id !== null)
			return { claim: get_banishment_claim_view(banishment_claim_id, client_id) };
		const deletion_claim_id = create_deletion_return_claim(client_id, existing_item_ids, available_slots);
		return { claim: deletion_claim_id === null ? null : get_deletion_claim_view(deletion_claim_id, client_id) };
	});

	session_post_route('/api/banishment/returns/acknowledge', async (req, url, client_id, json): Promise<HandlerResult> => {
		const claim_id = json.claim_id;
		if (typeof claim_id !== 'string' || !is_valid_uuid(claim_id))
			return 400; // Bad Request

		const acknowledge = db.transaction(() => {
			const claim = db.query(
				'SELECT * FROM `banishment_return_claims` WHERE `id` = ? AND `client_id` = ? LIMIT 1'
			).get(claim_id, client_id) as db_row.banishment_return_claims;
			if (claim === null)
				return 'missing';
			if (claim.acknowledged_at === null)
				db.query(
					'UPDATE `banishment_return_claims` SET `acknowledged_at` = ? WHERE `id` = ?'
				).run(Date.now(), claim_id);

			const pending = db.query(
				'SELECT returned.`gp`, returned.`notice_pending`, ' +
				'EXISTS(SELECT 1 FROM `banishment_return_items` WHERE `return_id` = returned.`id`) AS `has_items`, ' +
				'EXISTS(SELECT 1 FROM `banishment_return_claims` WHERE `return_id` = returned.`id` ' +
				'AND `acknowledged_at` IS NULL) AS `has_claims` ' +
				'FROM `banishment_returns` AS returned WHERE returned.`id` = ?'
			).get(claim.return_id) as { gp: number; notice_pending: number; has_items: number; has_claims: number };
			if (pending.gp === 0 && pending.notice_pending === 0 && pending.has_items === 0 && pending.has_claims === 0)
				db.query(
					'UPDATE `banishment_returns` SET `completed_at` = COALESCE(`completed_at`, ?) WHERE `id` = ?'
				).run(Date.now(), claim.return_id);
			return 'acknowledged';
		});

		if (acknowledge.immediate() !== 'missing')
			return { success: true };
		return acknowledge_deletion_return_claim(client_id, claim_id) === null
			? { error_lang: 'MOD_MP_BANISHMENT_CLAIM_MISSING' }
			: { success: true };
	});
}
