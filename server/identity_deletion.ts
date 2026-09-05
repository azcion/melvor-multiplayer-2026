import type { Database } from 'bun:sqlite';
import type * as db_row from './db/types/db_types';

export type DeletionExecution = {
	target_client_id: number;
	guild_id: number | null;
	dissolved: boolean;
};

function ensure_deletion_return(
	database: Database,
	request_id: number,
	client_id: number,
	source_display_name: string,
	now: number
): number {
	const row = database.query<{ id: number }, [number, number, string, number]>(
		'INSERT INTO `client_deletion_returns` (`request_id`, `client_id`, `source_display_name`, `created_at`) ' +
		'VALUES(?, ?, ?, ?) ON CONFLICT (`request_id`, `client_id`) DO UPDATE SET ' +
		'`source_display_name` = excluded.`source_display_name` RETURNING `id`'
	).get(request_id, client_id, source_display_name, now) as { id: number };
	return row.id;
}

function add_deletion_return_item(database: Database, return_id: number, item_id: string, qty: number) {
	if (qty <= 0)
		return;
	database.query(
		'INSERT INTO `client_deletion_return_items` (`return_id`, `item_id`, `qty`) VALUES(?, ?, ?) ' +
		'ON CONFLICT (`return_id`, `item_id`) DO UPDATE SET `qty` = `qty` + excluded.`qty`'
	).run(return_id, item_id, qty);
}

function cancel_deleted_client_haggles(database: Database, client_id: number, now: number): void {
	const haggles = database.query<db_row.market_haggles, [number, number]>(
		'SELECT * FROM `market_haggles` WHERE `status` = \'active\' AND (`initiator_id` = ? OR `owner_id` = ?)'
	).all(client_id, client_id);
	for (const haggle of haggles) {
		database.query(
			'UPDATE `market_haggles` SET `status` = \'cancelled\', `turn_client_id` = NULL, `expires_at` = NULL, ' +
			'`terminal_at` = ?, `updated_at` = ? WHERE `id` = ? AND `status` = \'active\''
		).run(now, now, haggle.id);
		if (haggle.listing_id !== null)
			database.query(
				'UPDATE `market_items` SET `available` = `available` + ?, `reserved` = `reserved` - ?, ' +
				'`escrow_gp` = `escrow_gp` + ? WHERE `id` = ?'
			).run(haggle.item_qty, haggle.item_qty, haggle.listing_reserved_gp, haggle.listing_id);
		if (haggle.direction === 'sell')
			database.query('INSERT OR IGNORE INTO `market_haggle_claims` (`haggle_id`, `client_id`, `gp`) VALUES(?, ?, ?)')
				.run(haggle.id, haggle.initiator_id, haggle.payer_escrow_gp);
		else {
			database.query(
				'INSERT OR IGNORE INTO `market_haggle_claims` (`haggle_id`, `client_id`, `item_id`, `item_qty`) VALUES(?, ?, ?, ?)'
			).run(haggle.id, haggle.initiator_id, haggle.item_id, haggle.item_qty);
			const extra_gp = Math.max(haggle.payer_escrow_gp - haggle.listing_reserved_gp, 0);
			if (extra_gp > 0)
				database.query('INSERT OR IGNORE INTO `market_haggle_claims` (`haggle_id`, `client_id`, `gp`) VALUES(?, ?, ?)')
					.run(haggle.id, haggle.owner_id, extra_gp);
		}
	}
}

function hide_client_chat(database: Database, client_id: number) {
	const conversations = database.query<{ id: number; latest_message_id: number }, [number, number]>(
		'SELECT conversation.`id`, COALESCE(MAX(message.`id`), 0) AS `latest_message_id` ' +
		'FROM `chat_conversations` AS conversation ' +
		'LEFT JOIN `chat_messages` AS message ON message.`conversation_id` = conversation.`id` ' +
		'WHERE conversation.`participant_low_id` = ? OR conversation.`participant_high_id` = ? ' +
		'GROUP BY conversation.`id`'
	).all(client_id, client_id);
	for (const conversation of conversations)
		database.query(
			'UPDATE `chat_participants` SET `conversation_hidden` = 1, ' +
			'`hidden_through_message_id` = MAX(`hidden_through_message_id`, ?) WHERE `conversation_id` = ?'
		).run(conversation.latest_message_id, conversation.id);
}

export function execute_client_deletion(
	database: Database,
	request: db_row.client_deletion_requests,
	now: number
): DeletionExecution {
	const target = database.query<{ display_name: string; deleted_at: number | null }, [number]>(
		'SELECT `display_name`, `deleted_at` FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(request.target_client_id) as { display_name: string; deleted_at: number | null };
	if (target.deleted_at !== null) {
		database.query('UPDATE `client_deletion_requests` SET `executed_at` = ? WHERE `id` = ?').run(now, request.id);
		return { target_client_id: request.target_client_id, guild_id: null, dissolved: false };
	}

	const membership = database.query<{ id: number; guild_id: number; guild_name: string; guild_type: string }, [number]>(
		'SELECT membership.`id`, membership.`guild_id`, guild.`name` AS `guild_name`, guild.`type` AS `guild_type` ' +
		'FROM `guild_memberships` AS membership JOIN `guilds` AS guild ON guild.`id` = membership.`guild_id` ' +
		'WHERE membership.`client_id` = ? LIMIT 1'
	).get(request.target_client_id);
	const target_return_id = () => ensure_deletion_return(
		database,
		request.id,
		request.target_client_id,
		target.display_name,
		now
	);
	cancel_deleted_client_haggles(database, request.target_client_id, now);
	const haggle_claims = database.query<db_row.market_haggle_claims, [number]>(
		'SELECT * FROM `market_haggle_claims` WHERE `client_id` = ? AND `claimed_at` IS NULL'
	).all(request.target_client_id);
	let haggle_gp = 0;
	for (const claim of haggle_claims) {
		if (claim.item_id !== null)
			add_deletion_return_item(database, target_return_id(), claim.item_id, claim.item_qty);
		haggle_gp += claim.gp;
		database.query('UPDATE `market_haggle_claims` SET `claimed_at` = ? WHERE `haggle_id` = ? AND `client_id` = ?')
			.run(now, claim.haggle_id, request.target_client_id);
	}
	if (haggle_gp > 0)
		database.query('UPDATE `client_deletion_returns` SET `gp` = `gp` + ? WHERE `id` = ?')
			.run(haggle_gp, target_return_id());

	const market_items = database.query<db_row.market_items, [number]>(
		'SELECT * FROM `market_items` WHERE `client_id` = ?'
	).all(request.target_client_id);
	let market_gp = 0;
	for (const item of market_items) {
		if (item.direction === 'buy')
			market_gp += item.escrow_gp;
		else {
			add_deletion_return_item(database, target_return_id(), item.item_id, item.available);
			market_gp += Math.max((item.qty - item.available - item.reserved - item.haggled) * item.price - item.payout, 0);
		}
	}
	if (market_gp > 0)
		database.query('UPDATE `client_deletion_returns` SET `gp` = `gp` + ? WHERE `id` = ?')
			.run(market_gp, target_return_id());
	database.query('DELETE FROM `market_items` WHERE `client_id` = ?').run(request.target_client_id);

	const trades = database.query<db_row.trade_offers, [number, number]>(
		'SELECT * FROM `trade_offers` WHERE `sender_id` = ? OR `recipient_id` = ?'
	).all(request.target_client_id, request.target_client_id);
	for (const trade of trades) {
		const items = database.query<db_row.trade_items, [number]>(
			'SELECT * FROM `trade_items` WHERE `trade_id` = ?'
		).all(trade.trade_id);
		for (const item of items) {
			const owner_id = item.counter === 0 ? trade.sender_id : trade.recipient_id;
			const return_id = ensure_deletion_return(database, request.id, owner_id, target.display_name, now);
			add_deletion_return_item(database, return_id, item.item_id, item.qty);
		}
		database.query('DELETE FROM `trade_items` WHERE `trade_id` = ?').run(trade.trade_id);
		database.query('DELETE FROM `trade_offers` WHERE `trade_id` = ?').run(trade.trade_id);
	}

	const gifts = database.query<db_row.gifts, [number, number]>(
		'SELECT * FROM `gifts` WHERE `client_id` = ? OR `sender_id` = ?'
	).all(request.target_client_id, request.target_client_id);
	for (const gift of gifts) {
		const owner_id = (gift.flags & 1) === 1 ? gift.client_id : gift.sender_id;
		const return_id = ensure_deletion_return(database, request.id, owner_id, target.display_name, now);
		const items = database.query<db_row.gift_items, [number]>(
			'SELECT * FROM `gift_items` WHERE `gift_id` = ?'
		).all(gift.gift_id);
		for (const item of items)
			add_deletion_return_item(database, return_id, item.item_id, item.qty);
		database.query('DELETE FROM `gift_items` WHERE `gift_id` = ?').run(gift.gift_id);
		database.query('DELETE FROM `gifts` WHERE `gift_id` = ?').run(gift.gift_id);
	}

	database.query('DELETE FROM `guild_applications` WHERE `client_id` = ?').run(request.target_client_id);
	let dissolved = false;
	if (membership !== null) {
		database.query('DELETE FROM `guild_memberships` WHERE `id` = ?').run(membership.id);
		const remaining = database.query<{ count: number }, [number]>(
			'SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `guild_id` = ?'
		).get(membership.guild_id) as { count: number };
		if (remaining.count === 0 && membership.guild_type !== 'free_fellowship') {
			database.query('DELETE FROM `guilds` WHERE `id` = ?').run(membership.guild_id);
			dissolved = true;
		}
	}

	hide_client_chat(database, request.target_client_id);
	database.query('DELETE FROM `client_sessions` WHERE `client_id` = ?').run(request.target_client_id);
	database.query('DELETE FROM `client_installations` WHERE `client_id` = ?').run(request.target_client_id);
	database.query('UPDATE `clients` SET `deleted_at` = ? WHERE `id` = ?').run(now, request.target_client_id);
	database.query('UPDATE `client_deletion_requests` SET `executed_at` = ? WHERE `id` = ?').run(now, request.id);
	return {
		target_client_id: request.target_client_id,
		guild_id: membership?.guild_id ?? null,
		dissolved
	};
}
