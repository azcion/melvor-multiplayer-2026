export const CHARITREE_VALUE_LIMIT_RATIO = 0.5;

export function get_charitree_stack_gp_value(item, { get_item, get_sale_price, gp_currency }) {
	if (item.id === 'melvorD:GP')
		return item.qty;

	const game_item = get_item(item.id);
	if (game_item?.sellsFor.currency !== gp_currency)
		return 0;
	return Math.max(0, get_sale_price(game_item, item.qty));
}

export function get_charitree_take_block(item, options) {
	if (item.id !== 'melvorD:GP' && item.qty > 1 && !options.is_discovered(item.id))
		return 'undiscovered_stack';

	const value = get_charitree_stack_gp_value(item, options);
	if (value > options.current_gp * CHARITREE_VALUE_LIMIT_RATIO)
		return 'value_limit';
	return null;
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
