import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';

test('keeps revision triggers for every database-backed event snapshot source', () => {
	const database = new Database(':memory:', { strict: true });
	for (const migration of migrations) {
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = OFF');
		database.transaction(() => database.run(migration.sql)).immediate();
		if (migration.foreign_keys_disabled)
			database.run('PRAGMA foreign_keys = ON');
	}

	const triggers = new Set(database.query<{ name: string }, []>(
		"SELECT `name` FROM `sqlite_schema` WHERE `type` = 'trigger' AND `name` LIKE 'event_%'"
	).all().map(row => row.name));
	for (const name of [
		'event_friend_insert', 'event_friend_delete',
		'event_gift_insert', 'event_gift_update', 'event_gift_delete',
		'event_trade_insert', 'event_trade_update', 'event_trade_delete',
		'event_resolved_trade_insert', 'event_resolved_trade_update', 'event_resolved_trade_delete',
		'event_market_insert', 'event_market_update', 'event_market_delete',
		'event_campaign_insert', 'event_campaign_update', 'event_campaign_delete',
		'event_application_insert', 'event_application_delete',
		'event_membership_insert', 'event_membership_delete',
		'event_banishment_insert', 'event_banishment_update',
		'event_deletion_return_insert', 'event_deletion_return_update',
		'event_chat_message_insert', 'event_chat_read_insert', 'event_chat_delete_insert',
		'event_guild_chat_message_insert', 'event_guild_chat_read_insert', 'event_guild_chat_read_update',
		'event_guild_chat_moderation_insert', 'event_guild_chat_participation_update',
		'event_support_conversation_insert', 'event_support_conversation_delete',
		'event_support_message_insert', 'event_support_player_read_insert',
		'event_support_member_read_insert', 'event_support_moderation_insert'
	])
		expect(triggers.has(name), `missing event revision trigger ${name}`).toBe(true);

	database.close();
});
