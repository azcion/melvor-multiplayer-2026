import { db } from './db';

export const CHARITY_PET_ID = 'Multiplayer_Pet_Charity';
export const CAMPAIGN_PET_IDS = {
	campaign_jungle: 'Multiplayer_Pet_Campaign_Jungle',
	campaign_desert: 'Multiplayer_Pet_Campaign_Desert',
	campaign_snow: 'Multiplayer_Pet_Campaign_Snow',
	campaign_volcanic: 'Multiplayer_Pet_Campaign_Volcanic',
	campaign_forsaken: 'Multiplayer_Pet_Campaign_Forsaken',
	campaign_forest: 'Multiplayer_Pet_Campaign_Forest'
} as const;

export const MULTIPLAYER_PET_IDS = [
	CHARITY_PET_ID,
	...Object.values(CAMPAIGN_PET_IDS)
] as const;

export type MultiplayerPetId = typeof MULTIPLAYER_PET_IDS[number];

export const CHARITY_PET_BASE_CHANCE = 0.001;
export const CHARITY_PET_INCREMENT_VALUE = 10_000_000;
export const CHARITY_PET_INCREMENT_CHANCE = 0.01;
export const CHARITY_PET_MAX_CHANCE = 0.1;

export function get_campaign_pet_id(campaign_id: string): MultiplayerPetId | null {
	return CAMPAIGN_PET_IDS[campaign_id as keyof typeof CAMPAIGN_PET_IDS] ?? null;
}

export function get_owned_pet_ids(client_id: number): MultiplayerPetId[] {
	return db.query<{ pet_id: MultiplayerPetId }, [number]>(
		'SELECT `pet_id` FROM `multiplayer_pet_ownership` WHERE `client_id` = ? ORDER BY `pet_id`'
	).all(client_id).map(row => row.pet_id);
}

export function has_owned_pet(client_id: number, pet_id: MultiplayerPetId): boolean {
	return db.query(
		'SELECT 1 FROM `multiplayer_pet_ownership` WHERE `client_id` = ? AND `pet_id` = ? LIMIT 1'
	).get(client_id, pet_id) !== null;
}

export function grant_pet(client_id: number, pet_id: MultiplayerPetId, now = Date.now()): boolean {
	const inserted = db.query(
		'INSERT INTO `multiplayer_pet_ownership` (`client_id`, `pet_id`, `created_at`, `updated_at`) ' +
		'VALUES(?, ?, ?, ?) ON CONFLICT (`client_id`, `pet_id`) DO NOTHING'
	).run(client_id, pet_id, now, now);
	return inserted.changes > 0;
}

export function grant_campaign_pet_if_eligible(client_id: number, campaign_id: string, now = Date.now()): boolean {
	const pet_id = get_campaign_pet_id(campaign_id);
	if (pet_id === null)
		return false;

	const completed = db.query<{ count: number }, [number, string]>(
		'SELECT COUNT(*) AS `count` FROM `campaign_completions` WHERE `client_id` = ? AND `campaign_id` = ?'
	).get(client_id, campaign_id)?.count ?? 0;
	return completed >= 4 && grant_pet(client_id, pet_id, now);
}

export function get_charity_pet_chance(donation_value: number): number {
	const value = Number.isSafeInteger(donation_value) && donation_value >= 0 ? donation_value : 0;
	const increments = Math.floor(value / CHARITY_PET_INCREMENT_VALUE);
	return Math.min(
		CHARITY_PET_BASE_CHANCE + increments * CHARITY_PET_INCREMENT_CHANCE,
		CHARITY_PET_MAX_CHANCE
	);
}

export function grant_charity_pet_if_rolled(client_id: number, donation_value: number, random_value = Math.random(), now = Date.now()): boolean {
	const chance = get_charity_pet_chance(donation_value);
	return random_value < chance && grant_pet(client_id, CHARITY_PET_ID, now);
}
