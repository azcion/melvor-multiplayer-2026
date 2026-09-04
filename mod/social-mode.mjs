export const SOCIAL_MODE_FULL = 'full';
export const SOCIAL_MODE_SOCIAL = 'social';

export function normalize_social_mode(value) {
	return value === SOCIAL_MODE_SOCIAL ? SOCIAL_MODE_SOCIAL : SOCIAL_MODE_FULL;
}

export function is_social_only_mode(value) {
	return normalize_social_mode(value) === SOCIAL_MODE_SOCIAL;
}
