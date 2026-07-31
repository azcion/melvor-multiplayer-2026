export const PETITION_LIFETIME = 1000 * 60 * 60 * 24;
export const COUNCIL_HISTORY_PAGE_SIZE = 20;
export const COUNCIL_MAINTENANCE_INTERVAL = 1000 * 30;
export const PETITION_RUNNING_STALE_AFTER = 1000 * 60 * 5;
export const PETITION_FAILED_RETRY_AFTER = 1000 * 30;

export const PETITION_TYPES = ['appellation', 'heraldry', 'banishment'] as const;
export const PETITION_CHOICES = ['aye', 'nay'] as const;

export type PetitionType = typeof PETITION_TYPES[number];
export type PetitionChoice = typeof PETITION_CHOICES[number];
export type PetitionLifecycle = 'active' | 'granted' | 'denied' | 'lapsed' | 'withdrawn';

export function get_petition_resolution(
	eligible_count: number,
	aye_count: number,
	nay_count: number
): 'granted' | 'denied' | null {
	if (!Number.isSafeInteger(eligible_count) || eligible_count < 1)
		throw new RangeError('eligible_count must be a positive safe integer');
	if (!Number.isSafeInteger(aye_count) || aye_count < 0 || aye_count > eligible_count)
		throw new RangeError('aye_count must be a valid safe integer');
	if (!Number.isSafeInteger(nay_count) || nay_count < 0 || aye_count + nay_count > eligible_count)
		throw new RangeError('nay_count must be a valid safe integer');

	if (2 * aye_count >= eligible_count)
		return 'granted';
	if (2 * nay_count > eligible_count)
		return 'denied';
	return null;
}

export function is_petition_type(value: unknown): value is PetitionType {
	return typeof value === 'string' && (PETITION_TYPES as readonly string[]).includes(value);
}

export function is_petition_choice(value: unknown): value is PetitionChoice {
	return typeof value === 'string' && (PETITION_CHOICES as readonly string[]).includes(value);
}

export function get_petition_conflict_subject(type: PetitionType, target_membership_id?: number): string {
	if (type === 'appellation')
		return 'guild:name';
	if (type === 'heraldry')
		return 'guild:icon';
	if (!Number.isSafeInteger(target_membership_id) || (target_membership_id as number) < 1)
		throw new RangeError('target_membership_id must be a positive safe integer');
	return `membership:${target_membership_id}`;
}
