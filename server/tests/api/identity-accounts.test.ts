import { describe, expect, test } from 'bun:test';
import {
	get_json_with_session,
	get_with_session,
	post,
	post_json,
	register_client,
	type MelvorAccountFixture,
	type RegisteredClient
} from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

function account(cloud_username: string, playfab_id: string): MelvorAccountFixture {
	return { cloud_username, playfab_id };
}

type IdentityList = {
	identities: Array<{
		client_id: number;
		display_name: string;
		icon_id: string;
		deletion: null | { requested_at: number; execute_at: number; can_cancel: boolean };
	}>;
};

async function authenticate(client: RegisteredClient, account?: MelvorAccountFixture) {
	return post_json<{
		session_token?: string;
		identity_status?: string;
		deletion_cancelled?: null | { requester_display_name: string; requested_at: number };
		identity_recovered?: boolean;
	}>('/api/authenticate', {
		client_identifier: client.client_identifier,
		client_key: client.client_key,
		...account
	});
}

async function identities(client: RegisteredClient) {
	return get_json_with_session<IdentityList>('/api/identities', client.session_token);
}

async function claim_return(client: RegisteredClient, existing_item_ids: string[] = [], available_slots = 32) {
	return post_json<{
		claim: null | { claim_id: string; items: Array<{ id: string; qty: number }>; gp: number; banished: null };
	}>('/api/banishment/returns/claim', { existing_item_ids, available_slots }, client.session_token);
}

describe('Melvor account identity lifecycle', () => {
	test('silently groups matching account pairs and never reassigns an associated Client', async () => {
		const jared = account('Grouping Jared', 'A1B2C3D4E5F60708');
		const mary_account = account('Grouping Mary', '1020304050607080');
		const bob = await register_client('Bob', jared);
		const cob = await register_client('Cob', jared);
		const mary = await register_client('Mary Character', mary_account);

		expect((await identities(bob)).json.identities).toEqual([
			expect.objectContaining({ client_id: cob.client_id, display_name: 'Cob', deletion: null })
		]);
		expect((await identities(mary)).json.identities).toEqual([]);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `melvor_accounts`')).toBe(2);

		const matching = await authenticate(bob, jared);
		expect(matching.response.status).toBe(200);
		bob.session_token = matching.json.session_token as string;
		const mismatch = await authenticate(bob, mary_account);
		expect(mismatch.response.status).toBe(409);
		expect(mismatch.json.identity_status).toBe('melvor_account_mismatch');
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `melvor_accounts`')).toBe(2);
		expect((await identities(bob)).json.identities.map(identity => identity.client_id)).toEqual([cob.client_id]);
	});

	test('binds a legacy Client once and requires its stable Melvor account afterward', async () => {
		const jared = account('Legacy Jared', 'B1B2C3D4E5F60708');
		const legacy = await register_client('Legacy Bob');
		const associated = await authenticate(legacy, jared);
		expect(associated.response.status).toBe(200);
		const missing_account = await authenticate(legacy);
		expect(missing_account.response.status).toBe(409);
		expect(missing_account.json.identity_status).toBe('melvor_account_required');
		const rows = await db_all<{ cloud_username: string; playfab_id: string }>(
			'SELECT account.`cloud_username`, account.`playfab_id` FROM `clients` AS client ' +
			'JOIN `melvor_accounts` AS account ON account.`id` = client.`melvor_account_id` ' +
			'WHERE client.`client_identifier` = ?',
			[legacy.client_identifier]
		);
		expect(rows).toEqual([jared]);
	});

	test('does not create an account group when registration is closed', async () => {
		const closed_account = account('Closed Registration', 'CLOSED123456789');
		const before = await db_count('SELECT COUNT(*) AS `count` FROM `melvor_accounts`');
		await db_run("UPDATE `service_settings` SET `value` = '0' WHERE `key` = 'registrations_open'");
		try {
			const response = await post('/api/register', {
				client_key: crypto.randomUUID(),
				display_name: 'Closed Registration',
				...closed_account
			});

			expect(response.status).toBe(503);
			expect(await db_count('SELECT COUNT(*) AS `count` FROM `melvor_accounts`')).toBe(before);
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'registrations_open'");
		}
	});

	test('schedules for 72 hours, lets the requester cancel, and auto-cancels target login', async () => {
		const jared = account('Deletion Jared', 'C1B2C3D4E5F60708');
		const bob = await register_client('Deletion Bob', jared);
		const cob = await register_client('Deletion Cob', jared);
		const scheduled = await post_json<{ success: boolean; deletion: { requested_at: number; execute_at: number } }>(
			'/api/identities/delete', { client_id: cob.client_id }, bob.session_token
		);
		expect(scheduled.json.success).toBe(true);
		expect(scheduled.json.deletion.execute_at - scheduled.json.deletion.requested_at).toBe(72 * 60 * 60 * 1000);
		expect((await identities(bob)).json.identities[0].deletion).toMatchObject({ can_cancel: true });

		const cancelled = await post_json<{ success: boolean }>(
			'/api/identities/delete/cancel', { client_id: cob.client_id }, bob.session_token
		);
		expect(cancelled.json.success).toBe(true);
		expect((await identities(bob)).json.identities[0].deletion).toBeNull();

		await post_json('/api/identities/delete', { client_id: cob.client_id }, bob.session_token);
		const target_login = await authenticate(cob, jared);
		expect(target_login.response.status).toBe(200);
		expect(target_login.json.deletion_cancelled).toMatchObject({
			requester_display_name: 'Deletion Bob'
		});
		expect((await identities(bob)).json.identities[0].deletion).toBeNull();
	});

	test('does not cancel a deletion after its deadline', async () => {
		const jared = account('Deadline Jared', 'E1B2C3D4E5F60708');
		const bob = await register_client('Deadline Bob', jared);
		const cob = await register_client('Deadline Cob', jared);
		await post_json('/api/identities/delete', { client_id: cob.client_id }, bob.session_token);
		await db_run(
			'UPDATE `client_deletion_requests` SET `execute_at` = ? WHERE `target_client_id` = ?',
			[Date.now() - 1, cob.client_id]
		);

		const cancelled = await post('/api/identities/delete/cancel', { client_id: cob.client_id }, bob.session_token);
		expect(cancelled.status).toBe(404);
		const recovered = await authenticate(cob, jared);
		expect(recovered.response.status).toBe(200);
		expect(recovered.json.identity_recovered).toBe(true);
	});

	test('executes cleanup, hides the Client, returns escrow, and recovers it as Guildless', async () => {
		const jared = account('Cleanup Jared', 'D1B2C3D4E5F60708');
		const mary = account('Cleanup Mary', '2020304050607080');
		const bob = await register_client('Cleanup Bob', jared);
		const cob = await register_client('Cleanup Cob', jared);
		const trader = await register_client('Cleanup Trader', mary);
		const created = await post_json<{ guild: { guild_id: number } }>('/api/guilds/create', {
			name: 'Cleanup Guild',
			icon_id: 'melvorD:Farmlands'
		}, bob.session_token);
		for (const client of [cob, trader]) {
			await post_json('/api/guilds/apply', { guild_id: created.json.guild.guild_id }, client.session_token);
			const state = await get_json_with_session<{
				applicants: Array<{ application_id: number; client_id: number }>;
			}>('/api/guilds/state', bob.session_token);
			const application = state.json.applicants.find(candidate => candidate.client_id === client.client_id);
			expect(application).toBeDefined();
			await post_json('/api/guilds/application/decide', {
				application_id: application!.application_id,
				approve: true
			}, bob.session_token);
		}

		await post_json('/api/market/sell', {
			item_id: 'melvorD:Cleanup_Market',
			item_qty: 4,
			item_sell_price: 10
		}, cob.session_token);
		const trade = await post_json<{ trade_id: number }>('/api/trade/offer', {
			recipient_id: trader.client_id,
			items: [{ id: 'melvorD:Cleanup_Offer', qty: 2 }]
		}, cob.session_token);
		await post_json('/api/trade/counter', {
			trade_id: trade.json.trade_id,
			items: [{ id: 'melvorD:Cleanup_Counter', qty: 3 }]
		}, trader.session_token);
		await post_json('/api/gift/send', {
			recipient_id: bob.client_id,
			items: [{ id: 'melvorD:Cleanup_Gift', qty: 5 }]
		}, cob.session_token);
		const conversation = await post_json<{ conversation: { conversation_id: number } }>(
			'/api/chat/conversations/start', { client_id: cob.client_id }, bob.session_token
		);
		await post_json('/api/chat/messages/send', {
			conversation_id: conversation.json.conversation.conversation_id,
			idempotency_key: crypto.randomUUID(),
			content: 'Before deletion'
		}, bob.session_token);

		await get_with_session('/api/events', cob.session_token);
		await post_json('/api/identities/delete', { client_id: cob.client_id }, bob.session_token);
		await db_run(
			'UPDATE `client_deletion_requests` SET `requested_at` = 0, `execute_at` = 0 ' +
			'WHERE `target_client_id` = ? AND `executed_at` IS NULL AND `cancelled_at` IS NULL',
			[cob.client_id]
		);
		await identities(bob);

		expect((await get_with_session('/api/events', cob.session_token)).status).toBe(401);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `clients` WHERE `id` = ? AND `deleted_at` IS NOT NULL',
			[cob.client_id]
		)).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `guild_memberships` WHERE `client_id` = ?', [cob.client_id]))
			.toBe(0);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `market_items` WHERE `client_id` = ?', [cob.client_id]))
			.toBe(0);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `trade_offers` WHERE `trade_id` = ?', [trade.json.trade_id]))
			.toBe(0);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `gifts` WHERE `sender_id` = ?', [cob.client_id]))
			.toBe(0);
		expect((await get_json_with_session<{ conversations: unknown[] }>(
			'/api/chat/conversations', bob.session_token
		)).json.conversations).toEqual([]);
		expect((await identities(bob)).json.identities).toEqual([]);

		const recovered = await authenticate(cob, jared);
		expect(recovered.response.status).toBe(200);
		expect(recovered.json.identity_recovered).toBe(true);
		cob.session_token = recovered.json.session_token as string;
		expect((await get_json_with_session<{ affiliation: string }>(
			'/api/guilds/state', cob.session_token
		)).json.affiliation).toBe('none');
		const returned = await claim_return(cob);
		expect(returned.json.claim?.items).toEqual(expect.arrayContaining([
			{ id: 'melvorD:Cleanup_Gift', qty: 5 },
			{ id: 'melvorD:Cleanup_Market', qty: 4 },
			{ id: 'melvorD:Cleanup_Offer', qty: 2 }
		]));
		expect((await get_json_with_session<{ conversations: unknown[] }>(
			'/api/chat/conversations', cob.session_token
		)).json.conversations).toEqual([]);

		const trader_return = await claim_return(trader);
		expect(trader_return.json.claim?.items).toEqual([
			{ id: 'melvorD:Cleanup_Counter', qty: 3 }
		]);
		await db_run('DELETE FROM `guilds` WHERE `id` = ?', [created.json.guild.guild_id]);
	});
});
