import { db, get_or_create_melvor_account, type MelvorAccountInput } from './db';
import type * as db_row from './db/types/db_types';

export type { MelvorAccountInput } from './db';

export const CLIENT_DELETION_DELAY = 72 * 60 * 60 * 1000;
export const CLIENT_DELETION_MAINTENANCE_INTERVAL = 60 * 1000;

const MAX_CLOUD_USERNAME_LENGTH = 64;
const MAX_PLAYFAB_ID_LENGTH = 128;

export type DeletionExecution = {
	target_client_id: number;
	guild_id: number | null;
	dissolved: boolean;
};

export function parse_melvor_account(value: Record<string, unknown>): MelvorAccountInput | null | undefined {
	const cloud_username = value.cloud_username;
	const playfab_id = value.playfab_id;
	if (cloud_username === undefined && playfab_id === undefined)
		return null;
	if (typeof cloud_username !== 'string' || typeof playfab_id !== 'string')
		return undefined;
	const username = cloud_username.trim();
	const id = playfab_id.trim();
	if (username.length === 0 || username.length > MAX_CLOUD_USERNAME_LENGTH ||
		id.length === 0 || id.length > MAX_PLAYFAB_ID_LENGTH)
		return undefined;
	return { cloud_username: username, playfab_id: id };
}

export { get_or_create_melvor_account } from './db';

export function associate_client_with_melvor_account(
	client_id: number,
	current_account_id: number | null,
	account: MelvorAccountInput | null
): 'associated' | 'matching' | 'mismatch' | 'required' {
	if (account === null)
		return current_account_id === null ? 'matching' : 'required';
	if (current_account_id !== null) {
		const matching = db.query<{ id: number }, [number, string, string]>(
			'SELECT `id` FROM `melvor_accounts` WHERE `id` = ? AND `cloud_username` = ? AND `playfab_id` = ?'
		).get(current_account_id, account.cloud_username, account.playfab_id);
		return matching === null ? 'mismatch' : 'matching';
	}
	const account_id = get_or_create_melvor_account(account);
	const updated = db.query(
		'UPDATE `clients` SET `melvor_account_id` = ? WHERE `id` = ? AND `melvor_account_id` IS NULL'
	).run(account_id, client_id);
	if (updated.changes === 1)
		return 'associated';
	const current = db.query<{ melvor_account_id: number | null }, [number]>(
		'SELECT `melvor_account_id` FROM `clients` WHERE `id` = ?'
	).get(client_id);
	return current?.melvor_account_id === account_id ? 'matching' : 'mismatch';
}

export function cancel_deletion_on_authentication(client_id: number, now = Date.now()) {
	const cancel = db.transaction(() => {
		const request = db.query<db_row.client_deletion_requests & { requester_display_name: string }, [number]>(
			'SELECT request.*, requester.`display_name` AS `requester_display_name` ' +
			'FROM `client_deletion_requests` AS request ' +
			'JOIN `clients` AS requester ON requester.`id` = request.`requester_client_id` ' +
			'WHERE request.`target_client_id` = ? AND request.`cancelled_at` IS NULL ' +
			'AND request.`executed_at` IS NULL LIMIT 1'
		).get(client_id);
		if (request === null)
			return null;
		db.query('UPDATE `client_deletion_requests` SET `cancelled_at` = ? WHERE `id` = ?').run(now, request.id);
		return {
			requester_display_name: request.requester_display_name,
			requested_at: request.requested_at
		};
	});
	return cancel.immediate();
}

export function recover_deleted_client(client_id: number): boolean {
	return db.query('UPDATE `clients` SET `deleted_at` = NULL WHERE `id` = ? AND `deleted_at` IS NOT NULL')
		.run(client_id).changes === 1;
}

export function list_sibling_identities(client_id: number) {
	return db.query<{
		client_id: number;
		display_name: string;
		icon_id: string;
		deletion_request_id: number | null;
		deletion_requester_id: number | null;
		deletion_requested_at: number | null;
		deletion_execute_at: number | null;
	}, [number]>(
		'SELECT sibling.`id` AS `client_id`, sibling.`display_name`, sibling.`icon_id`, ' +
		'request.`id` AS `deletion_request_id`, request.`requester_client_id` AS `deletion_requester_id`, ' +
		'request.`requested_at` AS `deletion_requested_at`, request.`execute_at` AS `deletion_execute_at` ' +
		'FROM `clients` AS current JOIN `clients` AS sibling ' +
		'ON sibling.`melvor_account_id` = current.`melvor_account_id` ' +
		'LEFT JOIN `client_deletion_requests` AS request ON request.`target_client_id` = sibling.`id` ' +
		'AND request.`cancelled_at` IS NULL AND request.`executed_at` IS NULL ' +
		'WHERE current.`id` = ? AND current.`melvor_account_id` IS NOT NULL ' +
		'AND sibling.`id` != current.`id` AND sibling.`deleted_at` IS NULL ' +
		'ORDER BY sibling.`display_name` COLLATE NOCASE, sibling.`id`'
	).all(client_id).map(identity => ({
		client_id: identity.client_id,
		display_name: identity.display_name,
		icon_id: identity.icon_id,
		deletion: identity.deletion_request_id === null ? null : {
			requested_at: identity.deletion_requested_at,
			execute_at: identity.deletion_execute_at,
			can_cancel: identity.deletion_requester_id === client_id
		}
	}));
}

export function schedule_client_deletion(requester_client_id: number, target_client_id: number, now = Date.now()) {
	if (!Number.isSafeInteger(target_client_id) || target_client_id < 1 || target_client_id === requester_client_id)
		return 'bad_request' as const;
	const schedule = db.transaction(() => {
		const sibling = db.query<{ id: number }, [number, number]>(
			'SELECT target.`id` FROM `clients` AS requester JOIN `clients` AS target ' +
			'ON target.`melvor_account_id` = requester.`melvor_account_id` ' +
			'WHERE requester.`id` = ? AND target.`id` = ? AND requester.`melvor_account_id` IS NOT NULL ' +
			'AND requester.`deleted_at` IS NULL AND target.`deleted_at` IS NULL LIMIT 1'
		).get(requester_client_id, target_client_id);
		if (sibling === null)
			return 'missing' as const;
		const existing = db.query<{ id: number }, [number]>(
			'SELECT `id` FROM `client_deletion_requests` WHERE `target_client_id` = ? ' +
			'AND `cancelled_at` IS NULL AND `executed_at` IS NULL LIMIT 1'
		).get(target_client_id);
		if (existing !== null)
			return 'pending' as const;
		const execute_at = now + CLIENT_DELETION_DELAY;
		db.query(
			'INSERT INTO `client_deletion_requests` (`target_client_id`, `requester_client_id`, `requested_at`, ' +
			'`execute_at`) VALUES(?, ?, ?, ?)'
		).run(target_client_id, requester_client_id, now, execute_at);
		return { requested_at: now, execute_at };
	});
	return schedule.immediate();
}

export function cancel_scheduled_client_deletion(
	requester_client_id: number,
	target_client_id: number,
	now = Date.now()
) {
	if (!Number.isSafeInteger(target_client_id) || target_client_id < 1 || target_client_id === requester_client_id)
		return 'bad_request' as const;
	const updated = db.query(
		'UPDATE `client_deletion_requests` SET `cancelled_at` = ? WHERE `target_client_id` = ? ' +
		'AND `requester_client_id` = ? AND `cancelled_at` IS NULL AND `executed_at` IS NULL ' +
		'AND `execute_at` > ?'
	).run(now, target_client_id, requester_client_id, now);
	return updated.changes === 1 ? 'cancelled' as const : 'missing' as const;
}

function ensure_deletion_return(
	request_id: number,
	client_id: number,
	source_display_name: string,
	now: number
): number {
	const row = db.query<{ id: number }, [number, number, string, number]>(
		'INSERT INTO `client_deletion_returns` (`request_id`, `client_id`, `source_display_name`, `created_at`) ' +
		'VALUES(?, ?, ?, ?) ON CONFLICT (`request_id`, `client_id`) DO UPDATE SET ' +
		'`source_display_name` = excluded.`source_display_name` RETURNING `id`'
	).get(request_id, client_id, source_display_name, now) as { id: number };
	return row.id;
}

function add_deletion_return_item(return_id: number, item_id: string, qty: number) {
	if (qty <= 0)
		return;
	db.query(
		'INSERT INTO `client_deletion_return_items` (`return_id`, `item_id`, `qty`) VALUES(?, ?, ?) ' +
		'ON CONFLICT (`return_id`, `item_id`) DO UPDATE SET `qty` = `qty` + excluded.`qty`'
	).run(return_id, item_id, qty);
}

function hide_client_chat(client_id: number) {
	const conversations = db.query<{ id: number; latest_message_id: number }, [number, number]>(
		'SELECT conversation.`id`, COALESCE(MAX(message.`id`), 0) AS `latest_message_id` ' +
		'FROM `chat_conversations` AS conversation ' +
		'LEFT JOIN `chat_messages` AS message ON message.`conversation_id` = conversation.`id` ' +
		'WHERE conversation.`participant_low_id` = ? OR conversation.`participant_high_id` = ? ' +
		'GROUP BY conversation.`id`'
	).all(client_id, client_id);
	for (const conversation of conversations)
		db.query(
			'UPDATE `chat_participants` SET `conversation_hidden` = 1, ' +
			'`hidden_through_message_id` = MAX(`hidden_through_message_id`, ?) WHERE `conversation_id` = ?'
		).run(conversation.latest_message_id, conversation.id);
}

function execute_client_deletion(request: db_row.client_deletion_requests, now: number): DeletionExecution {
	const target = db.query<{ display_name: string; deleted_at: number | null }, [number]>(
		'SELECT `display_name`, `deleted_at` FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(request.target_client_id) as { display_name: string; deleted_at: number | null };
	if (target.deleted_at !== null) {
		db.query('UPDATE `client_deletion_requests` SET `executed_at` = ? WHERE `id` = ?').run(now, request.id);
		return { target_client_id: request.target_client_id, guild_id: null, dissolved: false };
	}

	const membership = db.query<{ id: number; guild_id: number; guild_name: string; guild_type: string }, [number]>(
		'SELECT membership.`id`, membership.`guild_id`, guild.`name` AS `guild_name`, guild.`type` AS `guild_type` ' +
		'FROM `guild_memberships` AS membership JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` ' +
		'WHERE membership.`client_id` = ? LIMIT 1'
	).get(request.target_client_id);
	const target_return_id = () => ensure_deletion_return(
		request.id,
		request.target_client_id,
		target.display_name,
		now
	);

	const market_items = db.query<db_row.market_items, [number]>(
		'SELECT * FROM `market_items` WHERE `client_id` = ?'
	).all(request.target_client_id);
	let market_gp = 0;
	for (const item of market_items) {
		add_deletion_return_item(target_return_id(), item.item_id, item.available);
		market_gp += Math.max((item.qty - item.available) * item.price - item.payout, 0);
	}
	if (market_gp > 0)
		db.query('UPDATE `client_deletion_returns` SET `gp` = `gp` + ? WHERE `id` = ?')
			.run(market_gp, target_return_id());
	db.query('DELETE FROM `market_items` WHERE `client_id` = ?').run(request.target_client_id);

	const trades = db.query<db_row.trade_offers, [number, number]>(
		'SELECT * FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?'
	).all(request.target_client_id, request.target_client_id);
	for (const trade of trades) {
		const items = db.query<db_row.trade_items, [number]>(
			'SELECT * FROM `trade_items` WHERE `trade_id` = ?'
		).all(trade.trade_id);
		for (const item of items) {
			const owner_id = item.counter === 0 ? trade.sender_id : trade.recipient_id;
			const return_id = ensure_deletion_return(request.id, owner_id, target.display_name, now);
			add_deletion_return_item(return_id, item.item_id, item.qty);
		}
		db.query('DELETE FROM `trade_items` WHERE `trade_id` = ?').run(trade.trade_id);
		db.query('DELETE FROM `trade_offers` WHERE `trade_id` = ?').run(trade.trade_id);
	}

	const gifts = db.query<db_row.gifts, [number, number]>(
		'SELECT * FROM `gifts` WHERE `client_id` = ? OR `sender_id` = ?'
	).all(request.target_client_id, request.target_client_id);
	for (const gift of gifts) {
		const owner_id = (gift.flags & 1) === 1 ? gift.client_id : gift.sender_id;
		const return_id = ensure_deletion_return(request.id, owner_id, target.display_name, now);
		const items = db.query<db_row.gift_items, [number]>(
			'SELECT * FROM `gift_items` WHERE `gift_id` = ?'
		).all(gift.gift_id);
		for (const item of items)
			add_deletion_return_item(return_id, item.item_id, item.qty);
		db.query('DELETE FROM `gift_items` WHERE `gift_id` = ?').run(gift.gift_id);
		db.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift.gift_id);
	}

	db.query('DELETE FROM `guild_applications` WHERE `client_id` = ?').run(request.target_client_id);
	let dissolved = false;
	if (membership !== null) {
		db.query('DELETE FROM `guild_memberships` WHERE `id` = ?').run(membership.id);
		const remaining = db.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `guild_id` = ?'
		).get(membership.guild_id) as { count: number };
		if (remaining.count === 0 && membership.guild_type !== 'free_fellowship') {
			db.query('DELETE FROM `guilds` WHERE `id` = ?').run(membership.guild_id);
			dissolved = true;
		}
	}

	hide_client_chat(request.target_client_id);
	db.query('DELETE FROM `client_sessions` WHERE `client_id` = ?').run(request.target_client_id);
	db.query('UPDATE `clients` SET `deleted_at` = ? WHERE `id` = ?').run(now, request.target_client_id);
	db.query('UPDATE `client_deletion_requests` SET `executed_at` = ? WHERE `id` = ?').run(now, request.id);
	return {
		target_client_id: request.target_client_id,
		guild_id: membership?.guild_id ?? null,
		dissolved
	};
}

export function process_due_client_deletions(now = Date.now(), maximum = 20): DeletionExecution[] {
	const executed: DeletionExecution[] = [];
	while (executed.length < maximum) {
		const execute = db.transaction(() => {
			const request = db.query<db_row.client_deletion_requests, [number]>(
				'SELECT * FROM `client_deletion_requests` WHERE `cancelled_at` IS NULL AND `executed_at` IS NULL ' +
				'AND `execute_at` <= ? ORDER BY `execute_at`, `id` LIMIT 1'
			).get(now);
			return request === null ? null : execute_client_deletion(request, now);
		});
		const result = execute.immediate();
		if (result === null)
			break;
		executed.push(result);
	}
	return executed;
}

export function get_deletion_claim_view(claim_id: string, client_id: number) {
	const claim = db.query<db_row.client_deletion_return_claims, [string, number]>(
		'SELECT * FROM `client_deletion_return_claims` WHERE `id` = ? AND `client_id` = ? ' +
		'AND `acknowledged_at` IS NULL LIMIT 1'
	).get(claim_id, client_id);
	if (claim === null)
		return null;
	const items = db.query<{ id: string; qty: number }, [string]>(
		'SELECT `item_id` AS `id`, `qty` FROM `client_deletion_return_claim_items` ' +
		'WHERE `claim_id` = ? ORDER BY `item_id`'
	).all(claim_id);
	return { claim_id: claim.id, items, gp: claim.gp, banished: null };
}

export function create_deletion_return_claim(
	client_id: number,
	existing_item_ids: string[],
	available_slots: number
): string | null {
	const create = db.transaction(() => {
		const outstanding = db.query<{ id: string }, [number]>(
			'SELECT `id` FROM `client_deletion_return_claims` WHERE `client_id` = ? ' +
			'AND `acknowledged_at` IS NULL LIMIT 1'
		).get(client_id);
		if (outstanding !== null)
			return outstanding.id;
		const returns = db.query<db_row.client_deletion_returns, [number]>(
			'SELECT * FROM `client_deletion_returns` WHERE `client_id` = ? AND `completed_at` IS NULL ORDER BY `id`'
		).all(client_id);
		const existing = new Set(existing_item_ids);
		for (const returned of returns) {
			let remaining_slots = available_slots;
			let claimed_gp = 0;
			if (returned.gp > 0 && (existing.has('melvorD:GP') || remaining_slots > 0)) {
				claimed_gp = returned.gp;
				if (!existing.has('melvorD:GP'))
					remaining_slots--;
			}
			const available_items = db.query<db_row.client_deletion_return_items, [number]>(
				'SELECT * FROM `client_deletion_return_items` WHERE `return_id` = ? ORDER BY `item_id`'
			).all(returned.id);
			const selected = available_items.filter(item => {
				if (existing.has(item.item_id))
					return true;
				if (remaining_slots < 1)
					return false;
				remaining_slots--;
				return true;
			});
			if (claimed_gp === 0 && selected.length === 0)
				continue;
			const claim_id = crypto.randomUUID();
			db.query(
				'INSERT INTO `client_deletion_return_claims` (`id`, `return_id`, `client_id`, `gp`, `created_at`) ' +
				'VALUES(?, ?, ?, ?, ?)'
			).run(claim_id, returned.id, client_id, claimed_gp, Date.now());
			for (const item of selected) {
				db.query(
					'INSERT INTO `client_deletion_return_claim_items` (`claim_id`, `item_id`, `qty`) VALUES(?, ?, ?)'
				).run(claim_id, item.item_id, item.qty);
				db.query('DELETE FROM `client_deletion_return_items` WHERE `return_id` = ? AND `item_id` = ?')
					.run(returned.id, item.item_id);
			}
			db.query('UPDATE `client_deletion_returns` SET `gp` = `gp` - ? WHERE `id` = ?')
				.run(claimed_gp, returned.id);
			return claim_id;
		}
		return null;
	});
	return create.immediate();
}

export function acknowledge_deletion_return_claim(client_id: number, claim_id: string): boolean | null {
	const acknowledge = db.transaction(() => {
		const claim = db.query<db_row.client_deletion_return_claims, [string, number]>(
			'SELECT * FROM `client_deletion_return_claims` WHERE `id` = ? AND `client_id` = ? LIMIT 1'
		).get(claim_id, client_id);
		if (claim === null)
			return null;
		if (claim.acknowledged_at === null)
			db.query('UPDATE `client_deletion_return_claims` SET `acknowledged_at` = ? WHERE `id` = ?')
				.run(Date.now(), claim_id);
		const pending = db.query<{ gp: number; has_items: number; has_claims: number }, [number]>(
			'SELECT returned.`gp`, ' +
			'EXISTS(SELECT 1 FROM `client_deletion_return_items` WHERE `return_id` = returned.`id`) AS `has_items`, ' +
			'EXISTS(SELECT 1 FROM `client_deletion_return_claims` WHERE `return_id` = returned.`id` ' +
			'AND `acknowledged_at` IS NULL) AS `has_claims` ' +
			'FROM `client_deletion_returns` AS returned WHERE returned.`id` = ?'
		).get(claim.return_id) as { gp: number; has_items: number; has_claims: number };
		if (pending.gp === 0 && pending.has_items === 0 && pending.has_claims === 0)
			db.query('UPDATE `client_deletion_returns` SET `completed_at` = COALESCE(`completed_at`, ?) WHERE `id` = ?')
				.run(Date.now(), claim.return_id);
		return true;
	});
	return acknowledge.immediate();
}

export function has_deletion_returns(client_id: number): boolean {
	return db.query<{ pending: number }, [number]>(
		'SELECT EXISTS(SELECT 1 FROM `client_deletion_returns` WHERE `client_id` = ? ' +
		'AND `completed_at` IS NULL) AS `pending`'
	).get(client_id)?.pending === 1;
}
