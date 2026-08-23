import { describe, expect, test } from 'bun:test';
import { get_events, make_guildmates } from '../support/fixtures';
import { post_json } from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

describe('SQLite persistence probe', () => {
	test('initializes every application table', async () => {
		const rows = await db_all<{ name: string }>(
			"SELECT `name` FROM `sqlite_schema` WHERE `type` = 'table' AND `name` NOT LIKE 'sqlite_%'"
		);
		const tables = rows.map(row => row.name).sort();

		expect(tables).toEqual([
			'banishment_return_claim_items',
			'banishment_return_claims',
			'banishment_return_items',
			'banishment_returns',
			'campaign_completions',
			'campaign_contributions',
			'campaign_state',
			'charity_items',
			'chat_blocks',
			'chat_conversations',
			'chat_message_deletions',
			'chat_message_reads',
			'chat_messages',
			'chat_participants',
			'client_deletion_requests',
			'client_deletion_return_claim_items',
			'client_deletion_return_claims',
			'client_deletion_return_items',
			'client_deletion_returns',
			'client_runtime_snapshots',
			'client_sessions',
			'clients',
			'economy_receipts',
			'equipment_snapshot_items',
			'equipment_snapshots',
			'friend_requests',
			'friends',
			'gift_items',
			'gifts',
			'gp_snapshots',
			'guild_activity_events',
			'guild_applications',
			'guild_chat_message_moderation',
			'guild_chat_messages',
			'guild_chat_read_state',
			'guild_memberships',
			'guild_petition_voters',
			'guild_petition_votes',
			'guild_petition_winnowing_targets',
			'guild_petitions',
			'guild_raid_assaults',
			'guild_raid_roster',
			'guild_raid_victory_caches',
			'guild_raids',
			'guilds',
			'icon_catalog_blobs',
			'icon_catalog_observations',
			'market_items',
			'melvor_accounts',
			'resolved_trade_offers',
			'service_settings',
			'status_snapshot_skills',
			'status_snapshots',
			'support_conversations',
			'support_member_message_reads',
			'support_message_moderation',
			'support_messages',
			'support_player_message_reads',
			'support_team_memberships',
			'support_teams',
			'support_virtual_welcomes',
			'trade_items',
			'trade_offers'
		]);
	});

	test('enforces canonical conversations, idempotency, and participant-owned visibility state', async () => {
		const pair = await make_guildmates('Chat Storage First', 'Chat Storage Second');
		await db_run(
			'INSERT INTO `chat_conversations` (`participant_low_id`, `participant_high_id`, `created_at`) VALUES(?, ?, ?)',
			[Math.min(pair.first_id, pair.second_id), Math.max(pair.first_id, pair.second_id), 1]
		);
		const conversation = (await db_all<{ id: number }>(
			' SELECT `id` FROM `chat_conversations` WHERE `participant_low_id` = ? AND `participant_high_id` = ?',
			[Math.min(pair.first_id, pair.second_id), Math.max(pair.first_id, pair.second_id)]
		))[0];
		for (const client_id of [pair.first_id, pair.second_id])
			await db_run(
				'INSERT INTO `chat_participants` (`conversation_id`, `client_id`) VALUES(?, ?)',
				[conversation.id, client_id]
			);
		await db_run(
			'INSERT INTO `chat_messages` (`conversation_id`, `sender_id`, `idempotency_key`, `content`, `created_at`) ' +
			'VALUES(?, ?, ?, ?, ?)',
			[conversation.id, pair.first_id, 'storage-message', 'Hello', 2]
		);
		const message = (await db_all<{ id: number }>(
			'SELECT `id` FROM `chat_messages` WHERE `idempotency_key` = ?',
			['storage-message']
		))[0];
		await db_run(
			'INSERT INTO `chat_message_deletions` (`message_id`, `client_id`, `deleted_at`) VALUES(?, ?, ?)',
			[message.id, pair.first_id, 3]
		);

		expect(await db_count('SELECT COUNT(*) AS count FROM `chat_conversations` WHERE `id` = ?', [conversation.id]))
			.toBe(1);
		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `chat_message_deletions` WHERE `message_id` = ? AND `client_id` = ?',
			[message.id, pair.first_id]
		)).toBe(1);
		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `chat_message_deletions` WHERE `message_id` = ? AND `client_id` = ?',
			[message.id, pair.second_id]
		)).toBe(0);
	});

	test('removes accepted gifts and all item rows', async () => {
		const pair = await make_guildmates('Gift Cleanup Sender', 'Gift Cleanup Recipient');
		await post_json('/api/gift/send', {
			recipient_id: pair.second_id,
			items: [
				{ id: 'melvorD:Cleanup_A', qty: 1 },
				{ id: 'melvorD:Cleanup_B', qty: 2 }
			]
		}, pair.first.session_token);
		const gift_id = (await get_events(pair.second)).gifts[0];

		expect(await db_count('SELECT COUNT(*) AS count FROM `gifts` WHERE `gift_id` = ?', [gift_id])).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS count FROM `gift_items` WHERE `gift_id` = ?', [gift_id])).toBe(2);

		await post_json('/api/gift/accept', { gift_id }, pair.second.session_token);

		expect(await db_count('SELECT COUNT(*) AS count FROM `gifts` WHERE `gift_id` = ?', [gift_id])).toBe(0);
		expect(await db_count('SELECT COUNT(*) AS count FROM `gift_items` WHERE `gift_id` = ?', [gift_id])).toBe(0);
	});

	test('removes resolved trades, offers, and all item rows', async () => {
		const pair = await make_guildmates('Trade Cleanup Sender', 'Trade Cleanup Recipient');
		const offered = await post_json<{
			trade_id: number;
		}>('/api/trade/offer', {
			recipient_id: pair.second_id,
			items: [{ id: 'melvorD:Cleanup_Offer', qty: 3 }]
		}, pair.first.session_token);
		const trade_id = offered.json.trade_id;
		await post_json('/api/trade/counter', {
			trade_id,
			items: [{ id: 'melvorD:Cleanup_Counter', qty: 4 }]
		}, pair.second.session_token);
		await post_json('/api/trade/accept', {
			trade_id
		}, pair.first.session_token);

		expect(await db_count('SELECT COUNT(*) AS count FROM `trade_offers` WHERE `trade_id` = ?', [trade_id])).toBe(0);
		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `resolved_trade_offers` WHERE `trade_id` = ?',
			[trade_id]
		)).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS count FROM `trade_items` WHERE `trade_id` = ?', [trade_id])).toBe(1);

		await post_json('/api/trade/resolve', {
			trade_id
		}, pair.second.session_token);

		expect(await db_count(
			'SELECT COUNT(*) AS count FROM `resolved_trade_offers` WHERE `trade_id` = ?',
			[trade_id]
		)).toBe(0);
		expect(await db_count('SELECT COUNT(*) AS count FROM `trade_items` WHERE `trade_id` = ?', [trade_id])).toBe(0);
	});
});
