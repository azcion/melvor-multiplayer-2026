export const PETITION_LIFETIME = 1000 * 60 * 60 * 48;
export const COUNCIL_HISTORY_PAGE_SIZE = 20;
export const COUNCIL_MAINTENANCE_INTERVAL = 1000 * 30;
export const PETITION_RUNNING_STALE_AFTER = 1000 * 60 * 5;
export const PETITION_FAILED_RETRY_AFTER = 1000 * 30;

export const PETITION_TYPES = [
	'alliance_found', 'alliance_consider', 'alliance_join', 'alliance_leave', 'alliance_remove',
	'alliance_market_enable', 'alliance_market_disable', 'alliance_withdraw', 'alliance_ballot',
	'appellation',
	'heraldry',
	'banishment',
	'winnowing',
	'charitree_ingratitude',
	'charitree_sacrilege',
	'charitree_beneficence',
	'fellowship',
	'enclosure',
	'interdict',
	'heresy',
	'temperance',
	'indulgence',
	'crucible_purging',
	'crucible_sealing',
	'crucible_unsealing'
] as const;

export function is_free_fellowship_petition(type: string): boolean {
	return ['interdict', 'heresy', 'winnowing', 'temperance', 'indulgence'].includes(type) || type.startsWith('alliance_');
}

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
	if (type.startsWith('alliance_')) return `guild:${type}`;
	if (type === 'appellation')
		return 'guild:name';
	if (type === 'heraldry')
		return 'guild:icon';
	if (type.startsWith('charitree_'))
		return 'guild:charitree';
	if (type.startsWith('crucible_'))
		return 'guild:crucible';
	if (type === 'fellowship' || type === 'enclosure')
		return 'guild:admission';
	if (type === 'interdict' || type === 'heresy')
		return 'guild:cheat-policy';
	if (type === 'temperance' || type === 'indulgence')
		return 'guild:market-discovery-policy';
	if (type === 'winnowing')
		return 'guild:winnowing';
	if (!Number.isSafeInteger(target_membership_id) || (target_membership_id as number) < 1)
		throw new RangeError('target_membership_id must be a positive safe integer');
	return `membership:${target_membership_id}`;
}
