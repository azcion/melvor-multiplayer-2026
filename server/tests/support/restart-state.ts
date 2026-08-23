import type { RegisteredClient } from './http';

export const restart_state_path = '/test-state/restart.json';

export type RestartState = {
	first: RegisteredClient;
	first_id: number;
	second: RegisteredClient;
	second_id: number;
	gift_id: number;
	trade_id: number;
	market_item_id: string;
	market_lot_id: number;
	charity_item_id: string;
	campaign_contribution: number;
	campaign_history_client: RegisteredClient;
	campaign_completion_id: number;
	campaign_completion_type: string;
	equipment_slots: Array<{ slot_id: string; item_id: string }>;
	status_skills: Array<{ skill_id: string; level: number }>;
	status_activity: { type: 'skill'; skill_id: string; action_id: string };
	status_activities: Array<
		| { type: 'skill'; skill_id: string; action_id: string }
		| { type: 'combat'; area_id: string | null }
	>;
	gp_amount: number;
	chat_conversation_id: number;
	chat_message_id: number;
	guild_id: number;
	guild_chat_message_id: number;
	active_petition_id: number;
	retry_petition_id: number;
	banished: RegisteredClient;
	banishment_petition_id: number;
	banishment_item_id: string;
	raid_id: number;
	raid_assault_id: string;
	support_player: RegisteredClient;
	support_member: RegisteredClient;
	support_conversation_id: number;
};

export async function read_restart_state(): Promise<RestartState> {
	return Bun.file(restart_state_path).json() as Promise<RestartState>;
}
