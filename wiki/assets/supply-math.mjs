export function supply_unit_value(item) {
	return item.value_currency_id === 'melvorD:GP' && item.value_per_item > 0 ? item.value_per_item : 1;
}
export function supply_score_micros(value) {
	return Math.floor(10 * Math.log10(1 + value / 1000) * 1_000_000);
}
export function supply_quote(prior, value_each, qty) {
	const added = value_each * qty, total = prior + added;
	if (![prior,value_each,qty,added,total].every(Number.isSafeInteger) || prior < 0 || value_each < 1 || qty < 1)
		return null;
	return {added,total,before:supply_score_micros(prior),after:supply_score_micros(total),
		earned:supply_score_micros(total)-supply_score_micros(prior)};
}
