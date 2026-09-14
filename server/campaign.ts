export const CAMPAIGN_ESTIMATE_HOURS = 4;
const CAMPAIGN_SOURCE_ESTIMATE_HOURS = 12;
const CAMPAIGN_LARGE_ROUNDING_INCREMENT = 1000;

export const CAMPAIGN_AUTO_ADVANCE_MIN = 0.05;
export const CAMPAIGN_AUTO_ADVANCE_MAX = 0.15;
export const CAMPAIGN_AUTO_CONTRIBUTION_CAP = 0.8;
export const CAMPAIGN_AUTO_ADVANCE_INTERVAL = 1000 * 60 * 60 * 3;
export const CAMPAIGN_AUTO_PROGRESS_SQL =
	'UPDATE `campaign_state` SET ' +
	'`item_current` = `item_current` + MIN(?, `item_amount` - `item_current`, ? - `auto_contribution`), ' +
	'`auto_contribution` = `auto_contribution` + ' +
	'MIN(?, `item_amount` - `item_current`, ? - `auto_contribution`) ' +
	'WHERE `id` = ? AND `guild_id` = ? RETURNING `item_current`, `auto_contribution`';

export function round_campaign_estimate(estimate: number): number {
	const normalized_estimate = Math.max(estimate, 1);
	const increment = normalized_estimate >= CAMPAIGN_LARGE_ROUNDING_INCREMENT
		? CAMPAIGN_LARGE_ROUNDING_INCREMENT
		: 10 ** Math.max(Math.floor(Math.log10(normalized_estimate)), 0);
	return Math.max(Math.round(normalized_estimate / increment) * increment, 1);
}

export function get_campaign_item_total(estimated_12h_output: number, required_contributors: number): number {
	const estimated_output = estimated_12h_output * CAMPAIGN_ESTIMATE_HOURS / CAMPAIGN_SOURCE_ESTIMATE_HOURS;
	return round_campaign_estimate(estimated_output) * Math.max(Math.trunc(required_contributors), 1);
}

export function get_campaign_auto_advance(
	item_total: number,
	auto_contribution: number,
	random_value: number
): number {
	const normalized_random = Math.max(Math.min(random_value, 1), 0);
	const advance_pct = CAMPAIGN_AUTO_ADVANCE_MIN +
		normalized_random * (CAMPAIGN_AUTO_ADVANCE_MAX - CAMPAIGN_AUTO_ADVANCE_MIN);
	const contribution_cap = Math.floor(item_total * CAMPAIGN_AUTO_CONTRIBUTION_CAP);
	const remaining_allowance = Math.max(contribution_cap - auto_contribution, 0);

	return Math.min(Math.floor(item_total * advance_pct), remaining_allowance);
}
