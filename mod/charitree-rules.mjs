export const CHARITREE_VALUE_LIMIT_RATIO = 0.5;
export const CHARITREE_LEAF_COVERAGE_PERCENTAGES = Object.freeze([0, 5, 15, 30, 50, 70, 85, 95, 100]);
export const CHARITREE_WEIRD_GLOOP_ID = 'melvorD:Weird_Gloop';

const HOUR_MS = 60 * 60 * 1000;
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const UINT32_RANGE = 4294967296;
const text_encoder = new TextEncoder();

export function get_charitree_whole_hours_remaining(expires_at, now) {
	if (!Number.isSafeInteger(expires_at) || expires_at < 0 || !Number.isSafeInteger(now) || now < 0)
		return null;
	return Math.floor(Math.max(0, expires_at - now) / HOUR_MS);
}

function get_active_charitree_shuffle_count(shuffle_count) {
	return Number.isSafeInteger(shuffle_count) ? Math.max(-10, Math.min(20, shuffle_count)) : 0;
}

function apply_charitree_shuffle_bonus(percentage, shuffle_count) {
	return Math.min(100, Math.max(0, percentage - get_active_charitree_shuffle_count(shuffle_count) * 5));
}

export function get_charitree_leaf_coverage_percentage(whole_hours_remaining) {
	if (!Number.isSafeInteger(whole_hours_remaining) || whole_hours_remaining < 0)
		return 0;
	if (whole_hours_remaining < 12)
		return 0;
	if (whole_hours_remaining < 24)
		return 5;
	if (whole_hours_remaining < 36)
		return 15;
	if (whole_hours_remaining < 48)
		return 30;
	if (whole_hours_remaining < 60)
		return 50;
	if (whole_hours_remaining < 72)
		return 70;
	if (whole_hours_remaining < 84)
		return 85;
	if (whole_hours_remaining <= 90)
		return 95;
	return 100;
}

export function get_charitree_leaf_roll(item_id, quantity, whole_hours_remaining, shuffled_at = null) {
	if (typeof item_id !== 'string' || item_id.length === 0 || !Number.isSafeInteger(quantity) || quantity < 1 ||
		!Number.isSafeInteger(whole_hours_remaining) || whole_hours_remaining < 0)
		return null;

	let hash = FNV_OFFSET_BASIS;
	const seed = `${item_id}\0${quantity}\0${whole_hours_remaining}` +
		(Number.isSafeInteger(shuffled_at) && shuffled_at > 0 ? `\0${shuffled_at}` : '');
	for (const byte of text_encoder.encode(seed)) {
		hash ^= byte;
		hash = Math.imul(hash, FNV_PRIME);
	}
	return Math.floor((hash >>> 0) / UINT32_RANGE * 100);
}

export function get_charitree_leaf_coverage(item, now, is_currency = () => false, is_discovered = () => true, shuffled_at = null, shuffle_count = 0) {
	if (item === null || typeof item !== 'object' || item.id === CHARITREE_WEIRD_GLOOP_ID || is_currency(item.id) === true)
		return { covered: false, percentage: 0 };

	const whole_hours_remaining = get_charitree_whole_hours_remaining(item.expires_at, now);
	if (whole_hours_remaining === null)
		return { covered: false, percentage: 0 };
	const active_shuffle_count = get_active_charitree_shuffle_count(shuffle_count);
	const percentage = get_charitree_leaf_coverage_percentage(whole_hours_remaining);
	const roll = get_charitree_leaf_roll(item.id, item.qty, whole_hours_remaining,
		Number.isSafeInteger(item.donated_at) && item.donated_at < shuffled_at ? shuffled_at : null);
	const undiscovered = is_discovered(item.id) !== true;
	const coverage_chance = apply_charitree_shuffle_bonus(undiscovered ? 100 : percentage, active_shuffle_count);
	return {
		covered: roll !== null && roll < coverage_chance,
		percentage
	};
}

function get_charitree_item_currency(item, options) {
	const currency = options.get_currency(item.id);
	if (currency !== null && currency !== undefined)
		return currency;

	const game_item = options.get_item(item.id);
	return options.get_supported_currency(game_item?.sellsFor?.currency) ?? null;
}

export function get_charitree_stack_value(item, options) {
	const currency = get_charitree_item_currency(item, options);
	if (currency === null)
		return 0;

	const item_currency = options.get_currency(item.id);
	if (item_currency !== null && item_currency !== undefined)
		return item.qty;

	const game_item = options.get_item(item.id);
	if (game_item?.sellsFor?.currency !== currency)
		return 0;
	return Math.max(0, options.get_sale_price(game_item, item.qty));
}

function get_charitree_current_currency_amount(item, options) {
	const currency = get_charitree_item_currency(item, options);
	if (currency === null)
		return null;

	const amount = options.get_currency_amount(currency);
	return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

export function get_charitree_take_block(item, options) {
	const current_currency_amount = get_charitree_current_currency_amount(item, options);
	if (current_currency_amount === null)
		return null;

	const take_quantity = get_charitree_take_quantity(item, options);
	const value = get_charitree_stack_value({ ...item, qty: take_quantity }, options);
	if (value > current_currency_amount * CHARITREE_VALUE_LIMIT_RATIO)
		return 'value_limit';
	return null;
}

export function get_charitree_take_quantity(item, options) {
	const max_quantity = item.id === 'melvorD:GP' || options.is_discovered(item.id) ? item.qty : 1;
	const stack_value = get_charitree_stack_value(item, options);
	const current_currency_amount = get_charitree_current_currency_amount(item, options);
	if (current_currency_amount === null || stack_value <= current_currency_amount * CHARITREE_VALUE_LIMIT_RATIO)
		return max_quantity;

	const value_limit = current_currency_amount * CHARITREE_VALUE_LIMIT_RATIO;
	const item_value = stack_value / item.qty;
	return Math.min(max_quantity, Math.max(1, Math.floor(value_limit / item_value)));
}

export function get_charitree_next_opportunity(last_take, last_bonus_take, bonus_unlocked, timeout) {
	const next_opportunity = last_take + timeout;
	return bonus_unlocked ? Math.min(next_opportunity, last_bonus_take + timeout) : next_opportunity;
}

export function format_charitree_remaining(expires_at, now) {
	const remaining = expires_at - now;
	if (!Number.isSafeInteger(expires_at) || remaining <= 0)
		return '0m';

	const total_minutes = Math.ceil(remaining / 60_000);
	const days = Math.floor(total_minutes / (24 * 60));
	const hours = Math.floor((total_minutes % (24 * 60)) / 60);
	const minutes = total_minutes % 60;
	if (days > 0)
		return `${days}d ${hours}h`;
	if (hours > 0)
		return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

export function get_charitree_shuffle_offer(currencies, random = Math.random) {
	const eligible = currencies.filter(({ currency }) => Number.isFinite(currency?.amount) && currency.amount > 1000 && currency.amount <= Number.MAX_SAFE_INTEGER);
	if (eligible.length === 0) return null;
	const selected = eligible[Math.min(eligible.length - 1, Math.floor(random() * eligible.length))];
	return { currency_id: selected.id, balance: selected.currency.amount, qty: Math.floor(selected.currency.amount / 1000) };
}
