import { expect, test } from 'bun:test';
import { get_events, make_guildmates, register_guild_client } from '../support/fixtures';
import { get_json_with_session, post_json } from '../support/http';
import { db_run } from '../support/persistence';
import { restart_state_path } from '../support/restart-state';
import type { RestartState } from '../support/restart-state';
import { wait_for } from '../support/wait';

test('creates representative state before a server restart', async () => {
	const pair = await make_guildmates('Restart First', 'Restart Second');
	await post_json('/api/gift/send', {
		recipient_id: pair.second_id,
		items: [{ id: 'melvorD:Restart_Gift', qty: 7 }]
	}, pair.first.session_token);
	const gift_id = (await get_events(pair.second)).gifts[0];

	const offered = await post_json<{
		trade_id: number;
	}>('/api/trade/offer', {
		recipient_id: pair.second_id,
		items: [{ id: 'melvorD:Restart_Trade', qty: 8 }]
	}, pair.first.session_token);

	const market_item_id = 'melvorD:Restart_Market';
	await post_json('/api/market/sell', {
		item_id: market_item_id,
		item_qty: 9,
		item_sell_price: 10
	}, pair.first.session_token);
	const market = await wait_for(
		async () => (await get_json_with_session<{
			items: Array<{
				id: number;
				item_id: string;
			}>;
		}>('/api/market/listings', pair.first.session_token)).json,
		listings => listings.items.some(item => item.item_id === market_item_id)
	);
	const market_lot_id = market.items.find(item => item.item_id === market_item_id)?.id as number;

	const charity_item_id = 'melvorD:Restart_Charity';
	await post_json('/api/charity/donate', {
		items: [{ id: charity_item_id, qty: 11 }]
	}, pair.first.session_token);

	const campaign_contribution = 7;
	await post_json('/api/campaign/contribute', {
		item_amount: campaign_contribution
	}, pair.first.session_token);

	const active_petition = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', {
		type: 'appellation',
		name: 'Restart Council Name'
	}, pair.first.session_token);
	const retry_petition = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', {
		type: 'heraldry',
		icon_id: 'melvorF:Penumbra'
	}, pair.first.session_token);
	await post_json('/api/guilds/petitions/vote', {
		petition_id: retry_petition.json.petition_id,
		choice: 'aye'
	}, pair.first.session_token);
	await db_run("UPDATE `guilds` SET `icon_id` = 'melvorD:Farmlands' WHERE `id` = ?", [pair.guild_id]);
	await db_run(
		"UPDATE `guild_petitions` SET `execution_state` = 'running', `execution_last_attempt_at` = 0, " +
		'`subject_locked` = 1 WHERE `id` = ?',
		[retry_petition.json.petition_id]
	);

	const banished = await register_guild_client('Restart Banished', 'Restart Banish Guild');
	const banishment_item_id = 'melvorD:Restart_Banishment';
	await post_json('/api/market/sell', {
		item_id: banishment_item_id,
		item_qty: 13,
		item_sell_price: 2
	}, banished.session_token);
	const banishment = await post_json<{ petition_id: number }>('/api/guilds/petitions/raise', {
		type: 'banishment',
		target_client_id: banished.client_id
	}, banished.session_token);
	await post_json('/api/guilds/petitions/vote', {
		petition_id: banishment.json.petition_id,
		choice: 'aye'
	}, banished.session_token);

	const state: RestartState = {
		...pair,
		gift_id,
		trade_id: offered.json.trade_id,
		market_item_id,
		market_lot_id,
		charity_item_id,
		campaign_contribution,
		active_petition_id: active_petition.json.petition_id,
		retry_petition_id: retry_petition.json.petition_id,
		banished,
		banishment_petition_id: banishment.json.petition_id,
		banishment_item_id
	};
	await Bun.write(restart_state_path, JSON.stringify(state));

	expect(gift_id).toBeNumber();
	expect(offered.json.trade_id).toBeNumber();
	expect(market_lot_id).toBeNumber();
	expect(active_petition.json.petition_id).toBeNumber();
	expect(retry_petition.json.petition_id).toBeNumber();
	expect(banishment.json.petition_id).toBeNumber();
});
