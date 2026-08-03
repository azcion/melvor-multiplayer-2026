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

export function paginate_market_results(items, page, items_per_page) {
	const total_items = items.length;
	const page_count = Math.max(Math.ceil(total_items / items_per_page), 1);
	const current_page = Math.min(Math.max(Math.trunc(page), 1), page_count);
	const start = (current_page - 1) * items_per_page;

	return {
		current_page,
		total_items,
		items: items.slice(start, start + items_per_page)
	};
}
