import { describe, expect, test } from 'bun:test';
import { make_guildmates } from '../support/fixtures';
import { get_json_with_session, post, post_json } from '../support/http';
import { db_all, db_run } from '../support/persistence';

const shrimp = { item_id: 'melvorD:Shrimp', value_currency_id: 'melvorD:GP', value_per_item: 2 };

describe('Expedition Entrance supplies', () => {
	test('accepts catalog-matched food once with an Economy Receipt and cumulative EP', async () => {
		const guild = await make_guildmates('Supply One', 'Supply Two', 'Supply Guild');
		const registered = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		const command_id = crypto.randomUUID();
		const payload = { command_id, expedition_id: registered.json.expedition_id, ...shrimp, qty: 1000, source: 'bank' };
		const first = await post_json<any>('/api/expedition/supply/donate', payload, guild.first.session_token);
		expect(first.json.success).toBe(true);
		expect(first.json.receipt.kind).toBe('expedition-supply-donate');
		expect(first.json.receipt.effects).toEqual([{ storage: 'bank', item_id: shrimp.item_id, qty: -1000 }]);
		expect(first.json.added_value).toBe(2000);
		expect(first.json.delta_micros).toBe(Math.floor(10 * Math.log10(3) * 1_000_000));
		const replay = await post_json<any>('/api/expedition/supply/donate',
			{ command_id, expedition_id: -1, item_id: 'unknown', qty: 0 }, guild.first.session_token);
		expect(replay.json).toEqual(first.json);
		expect((await db_all<{ qty: number }>('SELECT qty FROM expedition_supplies WHERE expedition_id = ?',
			[registered.json.expedition_id]))[0].qty).toBe(1000);
		expect((await db_all('SELECT id FROM expedition_ep_ledger WHERE source_kind = ?', ['supply'])).length).toBe(1);
		const pending = (await get_json_with_session<any>('/api/events', guild.first.session_token)).json;
		expect(pending.economy_receipts).toContainEqual(first.json.receipt);
		const foreign_ack = await post('/api/economy/receipts/acknowledge',
			{ receipt_id: command_id }, guild.second.session_token);
		expect(foreign_ack.status).toBe(404);
		expect((await get_json_with_session<any>('/api/events', guild.first.session_token)).json.economy_receipts)
			.toContainEqual(first.json.receipt);
		await post_json('/api/economy/receipts/acknowledge', { receipt_id: command_id }, guild.first.session_token);
		expect((await get_json_with_session<any>('/api/events', guild.first.session_token)).json.economy_receipts)
			.not.toContainEqual(first.json.receipt);
		const after_ack = await post_json<any>('/api/expedition/supply/donate', payload, guild.first.session_token);
		expect(after_ack.json.receipt).toBeNull();
		expect((await db_all('SELECT id FROM expedition_ep_ledger WHERE source_kind = ?', ['supply'])).length).toBe(1);
		const state = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(state.supply_score.value_gp_equiv).toBe(2000);
		expect(state.points_display).toBe(4);
	});

	test('rejects unregistered, social-only, mismatched and late donations without moving value', async () => {
		const guild = await make_guildmates('Supply Three', 'Supply Four', 'Food Guild');
		const registered = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		const payload = { command_id: crypto.randomUUID(), expedition_id: registered.json.expedition_id,
			...shrimp, qty: 5, source: 'transfer' };
		const unregistered = await post_json<any>('/api/expedition/supply/donate', payload, guild.second.session_token);
		expect(unregistered.json.error).toBe('not_registered');
		const mismatch = await post_json<any>('/api/expedition/supply/donate',
			{ ...payload, command_id: crypto.randomUUID(), value_per_item: 200 }, guild.first.session_token);
		expect(mismatch.json.error).toBe('catalog_mismatch');
		await db_run("UPDATE clients SET social_mode = 'social' WHERE id = ?", [guild.first_id]);
		const social = await post_json<any>('/api/expedition/supply/donate',
			{ ...payload, command_id: crypto.randomUUID() }, guild.first.session_token);
		expect(social.json.error).toBe('social_only');
		await db_run("UPDATE clients SET social_mode = 'full' WHERE id = ?", [guild.first_id]);
		await db_run('UPDATE expeditions SET registration_ends_at = ? WHERE id = ?',
			[Date.now() - 1, registered.json.expedition_id]);
		const late = await post_json<any>('/api/expedition/supply/donate',
			{ ...payload, command_id: crypto.randomUUID() }, guild.first.session_token);
		expect(late.json.error).toBe('registration_closed');
		expect(await db_all('SELECT * FROM expedition_supplies WHERE expedition_id = ?',
			[registered.json.expedition_id])).toEqual([]);
	});

	test('treats a catalogued DLC non-GP sale as one GP equivalent per item', async () => {
		const guild = await make_guildmates('Abyss Supply', 'Abyss Witness', 'Abyss Guild');
		const registration = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		const result = await post_json<any>('/api/expedition/supply/donate', {
			command_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id,
			item_id: 'melvorItA:Crimson_Biter', qty: 100, source: 'transfer',
			value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 20
		}, guild.first.session_token);
		expect(result.json.success).toBe(true);
		expect(result.json.added_value).toBe(100);
		expect(result.json.delta_micros).toBe(Math.floor(10 * Math.log10(1.1) * 1_000_000));
		expect(result.json.receipt.effects).toEqual([{ storage: 'transfer',
			item_id: 'melvorItA:Crimson_Biter', qty: -100 }]);
	});

	test('starts a new cumulative supply score for the same character in a later Expedition', async () => {
		const guild = await make_guildmates('Repeat Supply', 'Repeat Witness', 'Repeat Guild');
		const first_run = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		const first = await post_json<any>('/api/expedition/supply/donate', {
			command_id: crypto.randomUUID(), expedition_id: first_run.json.expedition_id,
			...shrimp, qty: 1000, source: 'bank'
		}, guild.first.session_token);
		expect(first.json.success).toBe(true);
		await db_run("UPDATE expeditions SET status = 'inactive', ended_at = ? WHERE id = ?",
			[Date.now(), first_run.json.expedition_id]);
		const second_run = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		expect(second_run.json.expedition_id).not.toBe(first_run.json.expedition_id);
		const state_before = (await get_json_with_session<any>('/api/expedition/state', guild.first.session_token)).json;
		expect(state_before.supply_score).toEqual({ value_gp_equiv: 0, score_micros: 0 });
		const second = await post_json<any>('/api/expedition/supply/donate', {
			command_id: crypto.randomUUID(), expedition_id: second_run.json.expedition_id,
			...shrimp, qty: 1000, source: 'bank'
		}, guild.first.session_token);
		expect(second.json.success).toBe(true);
		expect(second.json.delta_micros).toBe(first.json.delta_micros);
		expect(second.json.value_gp_equiv).toBe(2000);
		expect(await db_all('SELECT expedition_id, value_gp_equiv FROM expedition_supply_scores WHERE client_id = ? ORDER BY expedition_id',
			[guild.first_id])).toEqual([
			{ expedition_id: first_run.json.expedition_id, value_gp_equiv: 2000 },
			{ expedition_id: second_run.json.expedition_id, value_gp_equiv: 2000 }
		]);
	});
});

describe('Expedition personal rewards', () => {
	test('retains awarded supply EP and source-run history after Guild dissolution', async () => {
		const guild = await make_guildmates('Supply Five', 'Supply Six', 'Last Guild');
		const registration = await post_json<{ expedition_id: number }>(
			'/api/expedition/register', { operation_id: crypto.randomUUID() }, guild.first.session_token);
		const donated = await post_json<any>('/api/expedition/supply/donate', {
			command_id: crypto.randomUUID(), expedition_id: registration.json.expedition_id,
			...shrimp, qty: 1000, source: 'bank'
		}, guild.first.session_token);
		expect(donated.json.success).toBe(true);
		await post_json('/api/guilds/leave', {}, guild.first.session_token);
		await post_json('/api/guilds/leave', {}, guild.second.session_token);
		const personal = (await get_json_with_session<any>('/api/expedition/personal', guild.first.session_token)).json;
		expect(personal.history[0].status).toBe('dissolved');
		expect(personal.history[0].earned_points_micros).toBe(donated.json.delta_micros);
		expect(personal.points_micros).toBe(donated.json.delta_micros);
	});
});
