export const CRUCIBLE_PROGRESS_MAX = 10_080;
export const CRUCIBLE_GLOOP_ID = 'melvorD:Weird_Gloop';
export const CRUCIBLE_GP_ID = 'melvorD:GP';

export type CrucibleValuation = {
	value_currency_id: string | null;
	value_per_item: number | null;
};

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function safe_number(value: bigint): number {
	if (value < 0n || value > MAX_SAFE)
		throw new RangeError('Crucible value exceeds the safe integer range');
	return Number(value);
}

export function safe_crucible_add(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0)
		throw new RangeError('Invalid Crucible value');
	return safe_number(BigInt(left) + BigInt(right));
}

export function crucible_unit_value(value: CrucibleValuation): number {
	const amount = value.value_per_item;
	if (amount === null || amount === 0)
		return 1;
	if (!Number.isSafeInteger(amount) || amount < 0 || !value.value_currency_id)
		throw new RangeError('Invalid Crucible valuation');
	return safe_number(BigInt(amount) * BigInt(value.value_currency_id === CRUCIBLE_GP_ID ? 1 : 10));
}

export function crucible_stack_value(qty: number, value: CrucibleValuation): number {
	if (!Number.isSafeInteger(qty) || qty <= 0)
		throw new RangeError('Invalid Crucible quantity');
	return safe_number(BigInt(qty) * BigInt(crucible_unit_value(value)));
}

export function crucible_heat_value(stacks: ReadonlyArray<CrucibleValuation & {
	item_id: string; qty: number; is_untimed: number | boolean;
}>): number {
	let total = 0n;
	for (const stack of stacks) {
		if (stack.is_untimed || stack.item_id === CRUCIBLE_GLOOP_ID)
			continue;
		total += BigInt(crucible_stack_value(stack.qty, stack)) + 100n;
	}
	return safe_number(total);
}

const HEAT_THRESHOLDS = [0, 1, 1_000, 10_000, 100_000, 1_000_000, 10_000_000,
	100_000_000, 1_000_000_000, 10_000_000_000] as const;
const HEAT_RATES = [0, 1, 2, 3, 5, 8, 12, 17, 22, 28] as const;

export function crucible_heat(value: number): { tier: number; points_per_minute: number } {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new RangeError('Invalid Crucible Heat value');
	let tier = 0;
	for (let index = 1; index < HEAT_THRESHOLDS.length; index++) {
		if (value < HEAT_THRESHOLDS[index]!) break;
		tier = index;
	}
	return { tier, points_per_minute: HEAT_RATES[tier]! };
}

export function crucible_gloop_quantity(residual_value: number): number {
	if (!Number.isSafeInteger(residual_value) || residual_value < 0)
		throw new RangeError('Invalid Crucible residual value');
	return residual_value === 0 ? 0 : Math.floor((residual_value - 1) / 1_000) + 1;
}

export function crucible_estimated_completion_at(points: number, points_per_minute: number,
	from_ms: number): number | null {
	if (!Number.isSafeInteger(points) || points < 0 || points > CRUCIBLE_PROGRESS_MAX ||
		!Number.isSafeInteger(points_per_minute) || points_per_minute < 0 ||
		!Number.isSafeInteger(from_ms) || from_ms < 0)
		throw new RangeError('Invalid Crucible completion estimate');
	if (points >= CRUCIBLE_PROGRESS_MAX) return from_ms;
	if (points_per_minute === 0) return null;
	return safe_crucible_add(from_ms,
		Math.ceil((CRUCIBLE_PROGRESS_MAX - points) / points_per_minute) * 60_000);
}

export function crucible_known_valuation(item_id: string): CrucibleValuation | null {
	switch (item_id) {
		case 'melvorD:GP': return { value_currency_id: CRUCIBLE_GP_ID, value_per_item: 1 };
		case 'melvorD:SlayerCoins': return { value_currency_id: 'melvorD:SlayerCoins', value_per_item: 1 };
		case 'melvorItA:AbyssalPieces': return { value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 };
		case 'melvorItA:AbyssalSlayerCoins': return { value_currency_id: 'melvorItA:AbyssalSlayerCoins', value_per_item: 1 };
		default: return null;
	}
}
