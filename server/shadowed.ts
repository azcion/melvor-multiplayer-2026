export const SHADOWED_AFTER = 7 * 24 * 60 * 60 * 1000;

export function shadowed_cutoff(now = Date.now()): number {
	return now - SHADOWED_AFTER;
}

export function is_shadowed(last_multiplayer_active_at: number, now = Date.now()): boolean {
	if (!Number.isSafeInteger(last_multiplayer_active_at) || last_multiplayer_active_at < 0)
		throw new RangeError('last_multiplayer_active_at must be a non-negative safe integer');
	if (!Number.isSafeInteger(now) || now < 0)
		throw new RangeError('now must be a non-negative safe integer');
	return last_multiplayer_active_at === 0 || last_multiplayer_active_at < shadowed_cutoff(now);
}
