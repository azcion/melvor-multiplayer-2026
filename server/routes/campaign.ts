import * as runtime from '../app-runtime';
import type { SQLQueryBindings } from 'bun:sqlite';
import type * as db_row from '../db/types/db_types';
import type { HandlerResult, JsonObject, JsonSerializable } from '../http';
import type { PetitionType } from '../council';
import { record_guild_activity } from '../guild-activity';
import { add_inbox_gp } from '../inbox';

const { apply_campaign_completion, db, db_get_single, ensure_guild_campaign, get_campaign_history, get_campaign_item_gp_value, get_campaign_pet_id, get_campaign_rankings, get_client_guild_id, get_owned_pet_ids, get_request_mod_version, has_owned_pet, is_server_owned_pets_client, is_social_only_client, persist_campaign_completion, run_economy_command, session_get_route, session_post_route } = runtime;

export function register_campaign_routes(): void {
	session_get_route('/api/campaign/info', async (req, url, client_id): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const campaign = await ensure_guild_campaign(guild_id);
		if (campaign === null)
			return 400; // Bad Request

		const rankings = await get_campaign_rankings(client_id);
		const history = await get_campaign_history(client_id);

		if (campaign.active_id > 0) {
			const contribution = await db_get_single(
				'SELECT `item_amount` FROM `campaign_contributions` WHERE `client_id` = ? AND `campaign_id` = ?',
				[client_id, campaign.active_id]
			) as db_row.campaign_contributions;

			return {
				active: true,
				history, rankings,
				owned_pet_ids: get_owned_pet_ids(client_id),
				campaign_id: campaign.campaign_id,
				contribution: contribution?.item_amount ?? 0,
				item_id: campaign.item_id,
				item_total: campaign.item_total,
				max_contribution: campaign.item_total / campaign.required_contributors
			} as JsonSerializable;
		} else {
			return {
				active: false,
				history, rankings,
				owned_pet_ids: get_owned_pet_ids(client_id),
				next_campaign: campaign.next_active_timestamp
			} as JsonSerializable;
		}
	});

	session_post_route('/api/campaign/claim', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const campaign_id = json.campaign_id;
		if (typeof campaign_id !== 'number')
			return 400; // Bad Request

		const server_owned_pets = is_server_owned_pets_client(get_request_mod_version(req));
		const value = json.value;
		if (server_owned_pets && value !== undefined)
			return 400; // Bad Request
		if (!server_owned_pets && (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0))
			return 400; // Bad Request

		const result = run_economy_command(client_id, json.command_id, 'campaign-claim', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const completion = db.query(
				'SELECT `source_campaign_state_id`, `campaign_id`, `item_id`, `item_amount` ' +
				'FROM `campaign_completions` WHERE `source_campaign_state_id` = ? AND `client_id` = ? AND `taken` = 0'
			).get(campaign_id, client_id) as Pick<db_row.campaign_completions, 'source_campaign_state_id' | 'campaign_id' | 'item_id' | 'item_amount'> | null;
			if (completion === null)
				return { success: false };

			let reward_value = value as number;
			if (server_owned_pets) {
				const item_gp_value = get_campaign_item_gp_value(completion.item_id);
				if (item_gp_value === null)
					return { success: false };
				const reward_multiplier = get_campaign_pet_id(completion.campaign_id) !== null &&
					has_owned_pet(client_id, get_campaign_pet_id(completion.campaign_id)!) ? 15 : 10;
				reward_value = item_gp_value * completion.item_amount * reward_multiplier;
				if (!Number.isSafeInteger(reward_value) || reward_value <= 0)
					return { success: false };
			}

			const updated_at = Date.now();
			db.query(
				'UPDATE `campaign_completions` SET `taken` = ?, `updated_at` = ? ' +
				'WHERE `source_campaign_state_id` = ? AND `client_id` = ? AND `taken` = 0'
			).run(reward_value, updated_at, completion.source_campaign_state_id, client_id);
			db.query(
				'UPDATE `campaign_contributions` SET `taken` = ? WHERE `client_id` = ? AND `campaign_id` = ?'
			).run(reward_value, client_id, completion.source_campaign_state_id);
			add_inbox_gp(client_id, reward_value);
			return {
				success: true,
				...(server_owned_pets ? { reward_value } : {}),
				effects: []
			};
		});
		return result?.success === true || result?.error_lang !== undefined ? result : 400;
	});

	session_post_route('/api/campaign/contribute', async (req, url, client_id, json): Promise<HandlerResult> => {
		const guild_id = await get_client_guild_id(client_id);
		if (guild_id === null)
			return { error_lang: 'MOD_MP_GUILD_REQUIRED' };

		const campaign = await ensure_guild_campaign(guild_id);
		if (campaign === null)
			return 400; // Bad Request

		const item_amount = json.item_amount;
		if (typeof item_amount !== 'number' || !Number.isSafeInteger(item_amount))
			return 400; // Bad Request

		if (campaign.active_id === 0)
			return 400; // Bad Request

		if (item_amount <= 0)
			return 400; // Bad Request

		const max_solo_contrib = campaign.item_total / campaign.required_contributors;
		let contributing_amount = Math.min(item_amount, max_solo_contrib);

		let completed_at: number | null = null;
		const result = run_economy_command(client_id, json.command_id, 'campaign-contribute', () => {
			if (is_social_only_client(client_id))
				return { success: false, error_lang: 'MOD_MP_SOCIAL_ONLY_DISABLED' };
			const contribution = db.query(
				'SELECT `item_amount` FROM `campaign_contributions` WHERE `client_id` = ? AND `campaign_id` = ?'
			).get(client_id, campaign.active_id) as db_row.campaign_contributions;
			if (contribution !== null) {
				const contributing_delta = Math.max(max_solo_contrib - contribution.item_amount, 0);
				contributing_amount = Math.min(contributing_amount, contributing_delta);
			}

			const remaining_needed = campaign.item_total - campaign.item_current;
			contributing_amount = Math.round(Math.min(contributing_amount, remaining_needed));
			if (contributing_amount > 0) {
				db.query(
					'INSERT INTO `campaign_contributions` (`client_id`, `campaign_id`, `item_amount`) VALUES(?, ?, ?) ' +
					'ON CONFLICT (`campaign_id`, `client_id`) DO UPDATE SET `item_amount` = `item_amount` + excluded.`item_amount`'
				).run(client_id, campaign.active_id, contributing_amount);
				const updated = db.query(
					'UPDATE `campaign_state` SET `item_current` = MIN(`item_amount`, `item_current` + ?) ' +
					'WHERE `id` = ? AND `guild_id` = ? RETURNING `item_current`'
				).get(contributing_amount, campaign.active_id, campaign.guild_id) as { item_current: number } | null;
				if (updated === null)
					return { success: false };
				campaign.item_current = updated.item_current;
				campaign.pct = campaign.item_current / campaign.item_total;
				record_guild_activity({ guild_id, event_type: 'campaign_contributed', actor_client_id: client_id,
					source_key: `campaign-contribution:${campaign.active_id}:${json.command_id}`, throttled: true });
				if (campaign.item_current >= campaign.item_total)
					completed_at = persist_campaign_completion(campaign);
				if (completed_at !== null)
					record_guild_activity({ guild_id, event_type: 'campaign_completed',
						source_key: `campaign:${campaign.active_id}:completed` });
			}

			return {
				success: true,
				item_id: campaign.item_id,
				item_loss: contributing_amount,
				campaign_pct: campaign.pct,
				effects: contributing_amount > 0
					? [{ storage: 'bank', item_id: campaign.item_id, qty: -contributing_amount }]
					: []
			};
		});
		if (completed_at !== null)
			apply_campaign_completion(campaign, completed_at);
		return result ?? 400;
	});
}
