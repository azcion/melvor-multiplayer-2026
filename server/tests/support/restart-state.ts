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
	equipment_slots: Array<{ slot_id: string; item_id: string }>;
	active_petition_id: number;
	retry_petition_id: number;
	banished: RegisteredClient;
	banishment_petition_id: number;
	banishment_item_id: string;
};

export async function read_restart_state(): Promise<RestartState> {
	return Bun.file(restart_state_path).json() as Promise<RestartState>;
}
