export const CRUCIBLE_PROGRESS_MAX = 10_080;
export const CRUCIBLE_GLOOP_ID = 'melvorD:Weird_Gloop';
const encoder = new TextEncoder();

export function compare_crucible_offerings(left, right) {
	const left_gloop = left.item_id === CRUCIBLE_GLOOP_ID;
	const right_gloop = right.item_id === CRUCIBLE_GLOOP_ID;
	if (left_gloop !== right_gloop) return left_gloop ? -1 : 1;
	return right.meld_points - left.meld_points || left.id - right.id;
}

export function get_crucible_slag_chance(points, discovered = true, clear_level = 0) {
	if (!Number.isSafeInteger(points) || points < 0 || points > CRUCIBLE_PROGRESS_MAX) return 0;
	const progress = Math.floor(points * 100 / CRUCIBLE_PROGRESS_MAX);
	const base = !discovered ? 100 : progress >= 88 ? 0 : progress >= 75 ? 5
		: progress >= 63 ? 15 : progress >= 50 ? 30 : progress >= 38 ? 50
		: progress >= 25 ? 70 : progress >= 13 ? 85 : progress >= 7 ? 95 : 100;
	return Math.max(0, Math.min(100, base - clear_level * 5));
}

export function get_crucible_slag_coverage(offering, discovered = true, clear_level = 0,
	is_currency = () => false) {
	if (!offering || offering.id === CRUCIBLE_GLOOP_ID || is_currency(offering.id))
		return { covered: false, percentage: 0 };
	const percentage = get_crucible_slag_chance(offering.meld_points, discovered, clear_level);
	let hash = 2166136261;
	const seed = `${offering.id}\0${offering.qty}\0${offering.generation}\0${Math.floor(offering.meld_points / 120)}`;
	for (const byte of encoder.encode(seed)) {
		hash ^= byte;
		hash = Math.imul(hash, 16777619);
	}
	return { covered: ((hash >>> 0) / 4294967296) * 100 < percentage, percentage };
}

export function get_crucible_reclaim_quantity(offering, options) {
	if (!offering || !Number.isSafeInteger(offering.qty) || offering.qty < 1) return 0;
	const max = options.is_discovered(offering.id) || options.is_currency(offering.id) ? offering.qty : 1;
	const currency = options.get_sale_currency(offering.id);
	if (!currency) return max;
	const balance = options.get_currency_balance(currency);
	if (!Number.isSafeInteger(balance) || balance < 0) return 0;
	let low = 0;
	let high = max;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		const value = options.get_sale_value(offering.id, middle);
		if (Number.isFinite(value) && value <= balance * 0.5) low = middle;
		else high = middle - 1;
	}
	return low;
}

// Integer milli-EP quotes; the server validates the exact quote before any payment.
export function wish_price_micros(qty, base = 100) {
	if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000 || ![100,200,300,400,500].includes(base)) return 0;
	if (qty <= base) return Math.ceil(qty * 1000 / base) * 1000;
	const steps = Math.floor((qty - base) / 100);
	const remainder = (qty - base) % 100;
	// Each remaining item costs 1/100 of the next increment. Integer micros
	// are already exact multiples of 0.001 EP for these +100 price bands.
	return (1 + steps * (steps + 3) / 2) * 1_000_000 + remainder * (steps + 2) * 10_000;
}
export function wish_gp_cost(required) {
	return Number.isSafeInteger(required) && required > 0 ? Number((BigInt(required) + 1n) / 2n) : 0;
}
