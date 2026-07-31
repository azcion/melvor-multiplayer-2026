const CAMPAIGN_ROUNDING_TOLERANCE = 0.15;

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
	const normalized_estimate = Math.max(Math.trunc(estimate), 1);
	let increment = 10 ** Math.floor(Math.log10(normalized_estimate));

	while (increment >= 1) {
		const rounded = Math.ceil(normalized_estimate / increment) * increment;
		if (rounded <= normalized_estimate * (1 + CAMPAIGN_ROUNDING_TOLERANCE))
			return rounded;

		increment /= 10;
	}

	return normalized_estimate;
}

export function get_required_campaign_contributors(member_count: number): number {
	return Math.max(Math.ceil(member_count / 2), 1);
}

export function get_campaign_item_total(estimated_12h_output: number, required_contributors: number): number {
	return round_campaign_estimate(estimated_12h_output) * Math.max(Math.trunc(required_contributors), 1);
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
