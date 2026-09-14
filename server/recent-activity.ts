export const RECENTLY_ACTIVE_AFTER = 4 * 24 * 60 * 60 * 1000;
export const EXPECTED_CONTRIBUTOR_RATIO = 0.4;

export function recently_active_cutoff(now = Date.now()): number {
	return now - RECENTLY_ACTIVE_AFTER;
}

export function get_expected_contributor_count(recently_active_count: number): number {
	const normalized_count = Math.max(Math.trunc(recently_active_count), 0);
	if (normalized_count <= 1)
		return 1;

	return Math.max(2, Math.ceil(normalized_count * EXPECTED_CONTRIBUTOR_RATIO));
}
