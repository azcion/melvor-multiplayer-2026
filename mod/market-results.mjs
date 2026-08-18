export function remove_sold_out_market_result(state, listing_id, items_per_page) {
	const remaining_results = state.market_results.filter(listing => listing.id !== listing_id);
	if (remaining_results.length === state.market_results.length)
		return false;

	state.market_results = remaining_results;
	state.market_total_items = Math.max(state.market_total_items - 1, 0);

	const last_page = Math.max(Math.ceil(state.market_total_items / items_per_page), 1);
	state.market_current_page = Math.min(state.market_current_page, last_page);
	return true;
}

export function market_page_window(current_page, page_count, radius = 2) {
	const count = Math.max(Math.trunc(page_count), 1);
	const current = Math.min(Math.max(Math.trunc(current_page), 1), count);
	const start = Math.max(Math.min(current - radius, count - radius * 2), 1);
	const end = Math.min(start + radius * 2, count);
	return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
