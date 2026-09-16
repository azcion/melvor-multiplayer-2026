import { describe, expect, test } from 'bun:test';
import { make_guild_group } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';

describe('durable audit log', () => {
	test('traces a FIFO Charitree lot through a Gift and acknowledged Inbox claim', async () => {
		const [donor, picker, recipient] = await make_guild_group(
			['Bob', 'Picker', 'Recipient'],
			'Audit Guild'
		);
		const item_id = 'melvorD:Audit_Apple';
		const donate_command = crypto.randomUUID();
		await post_json('/api/charity/donate', {
			command_id: donate_command,
			items: [{ id: item_id, qty: 6, value_currency_id: 'melvorD:GP', value_per_item: 1 }]
		}, donor.session_token);
		await db_run('UPDATE `clients` SET `last_charity` = 0, `last_bonus_charity` = 0 WHERE `id` = ?', [picker.client_id]);
		const take_command = crypto.randomUUID();
		await post_json('/api/charity/take', {
			command_id: take_command,
			item_id,
			qty: 1
		}, picker.session_token);
		const claimed_from_tree = await post_json<{ claim: { claim_id: string } }>('/api/inbox/claim', {
			existing_item_ids: [], available_slots: 1
		}, picker.session_token);
		await post_json('/api/inbox/acknowledge', {
			claim_id: claimed_from_tree.json.claim.claim_id
		}, picker.session_token);

		await post_json('/api/gift/send', {
			command_id: crypto.randomUUID(),
			recipient_id: recipient.client_id,
			items: [{ id: item_id, qty: 1 }]
		}, picker.session_token);
		const gift_id = (await get_json_with_session<{ gifts: number[] }>(
			'/api/events', recipient.session_token
		)).json.gifts[0];
		await post_json('/api/gift/accept', {
			command_id: crypto.randomUUID(), gift_id
		}, recipient.session_token);
		const recipient_claim = await post_json<{ claim: { claim_id: string } }>('/api/inbox/claim', {
			existing_item_ids: [], available_slots: 1
		}, recipient.session_token);
		await post_json('/api/inbox/acknowledge', {
			claim_id: recipient_claim.json.claim.claim_id
		}, recipient.session_token);

		const events = await db_all<{
			id: number; event_type: string; actor_client_id: number; actor_display_name: string;
			guild_id: number | null; guild_name: string | null;
		}>(
			' SELECT `id`, `event_type`, `actor_client_id`, `actor_display_name`, `guild_id`, `guild_name` ' +
			'FROM `audit_event_timeline` WHERE `event_type` IN ' +
			"('charitree.donated', 'charitree.taken', 'gift.sent', 'gift.accepted', " +
			"'inbox.claim_created', 'inbox.claim_acknowledged') AND (`guild_id` = ? OR `actor_client_id` IN (?, ?)) ORDER BY `id`",
			[donor.guild_id, picker.client_id, recipient.client_id]
		);
		expect(events.map(event => event.event_type)).toEqual([
			'charitree.donated',
			'charitree.taken',
			'inbox.claim_created',
			'inbox.claim_acknowledged',
			'gift.sent',
			'gift.accepted',
			'inbox.claim_created',
			'inbox.claim_acknowledged'
		]);
		expect(events[0]).toMatchObject({
			actor_client_id: donor.client_id,
			actor_display_name: 'Bob',
			guild_id: donor.guild_id,
			guild_name: 'Audit Guild'
		});
		const donor_lot = await db_all<{ lot_id: number; quantity: number }>(
			' SELECT movement.`lot_id`, movement.`quantity` FROM `audit_value_movements` AS movement ' +
			'JOIN `audit_events` AS event ON event.`id` = movement.`event_id` ' +
			'WHERE event.`event_type` = \'charitree.donated\' AND movement.`to_kind` = \'charitree\' ' +
			'AND movement.`object_id` = ?', [item_id]
		);
		expect(donor_lot).toHaveLength(1);
		expect(donor_lot[0].quantity).toBe(6);
		const lineage = await db_all<{ event_type: string; quantity: number }>(
			' SELECT event.`event_type`, movement.`quantity` FROM `audit_value_movements` AS movement ' +
			'JOIN `audit_events` AS event ON event.`id` = movement.`event_id` ' +
			'WHERE movement.`lot_id` = ? ORDER BY event.`id`, movement.`ordinal`', [donor_lot[0].lot_id]
		);
		expect(lineage.map(row => row.event_type)).toEqual([
			'charitree.donated', 'charitree.taken', 'inbox.claim_created', 'gift.sent',
			'gift.accepted', 'inbox.claim_created'
		]);
		expect(lineage.every(row => row.quantity === 1 || row.quantity === 6)).toBe(true);
		const final_position = await db_all<{ position_kind: string; position_key: string; quantity: number }>(
			'SELECT `position_kind`, `position_key`, `quantity` FROM `audit_value_lot_positions` WHERE `lot_id` = ?',
			[donor_lot[0].lot_id]
		);
		expect(final_position).toContainEqual({
			position_kind: 'client', position_key: String(recipient.client_id), quantity: 1
		});
		expect(final_position).toContainEqual({
			position_kind: 'charitree', position_key: String(donor.guild_id), quantity: 5
		});
	});

	test('retains semantic events without generic request mutation events', async () => {
		const [client] = await make_guild_group(['Coverage Auditor'], 'Coverage Audit Guild');
		const before = await db_all<{ count: number }>(
			'SELECT COUNT(*) AS `count` FROM `audit_events` WHERE `actor_client_id` = ? AND `event_type` = \'api.friends.add\'',
			[client.client_id]
		);
		await post_json('/api/friends/add', { friend_code: 'not-a-real-code' }, client.session_token);
		const after = await db_all<{ count: number }>(
			'SELECT COUNT(*) AS `count` FROM `audit_events` WHERE `actor_client_id` = ? AND `event_type` = \'api.friends.add\'',
			[client.client_id]
		);
		expect(after[0].count).toBe(before[0].count);
		await post_json('/api/client/status/sync', { gp: 123 }, client.session_token);
		expect(await db_all(
			'SELECT 1 FROM `audit_events` WHERE `actor_client_id` = ? AND `event_type` = \'api.client.status.sync\'',
			[client.client_id]
		)).toEqual([]);
	});

	test('records automatic Charitree expiry as a system event and closes its lots', async () => {
		const [client] = await make_guild_group(['Expiry Auditor'], 'Expiry Audit Guild');
		const item_id = 'melvorD:Audit_Expired';
		await post_json('/api/charity/donate', {
			items: [{ id: item_id, qty: 3, value_currency_id: null, value_per_item: 0 }]
		}, client.session_token);
		await db_run('UPDATE `charity_items` SET `expires_at` = 1 WHERE `guild_id` = ? AND `item_id` = ?',
			[client.guild_id, item_id]);
		await get_json_with_session('/api/charity/contents', client.session_token);
		const expiry = await db_all<{ id: number; actor_kind: string; guild_name: string }>(
			'SELECT `id`, `actor_kind`, `guild_name` FROM `audit_events` WHERE `event_type` = \'charitree.expired\' ' +
			'AND `guild_id` = ?', [client.guild_id]
		);
		expect(expiry).toHaveLength(1);
		expect(expiry[0]).toMatchObject({ actor_kind: 'system', guild_name: 'Expiry Audit Guild' });
		expect(await db_all(
			'SELECT position.* FROM `audit_value_lot_positions` AS position ' +
			'JOIN `audit_value_lots` AS lot ON lot.`id` = position.`lot_id` WHERE lot.`object_id` = ?', [item_id]
		)).toEqual([]);
	});
});
