function reconcile_ids(current, ids, get_id, create) {
	const cached = new Map(current.map(entry => [get_id(entry), entry]));
	return ids.map(id => cached.get(id) ?? create(id));
}

export function reconcile_event_transfers(state, events) {
	state.gifts = reconcile_ids(state.gifts, events.gifts ?? [], gift => gift.id, id => ({ id, data: null }));
	state.resolved_trades = reconcile_ids(
		state.resolved_trades,
		events.resolved_trades ?? [],
		trade => trade.trade_id,
		trade_id => ({ trade_id, data: null })
	);

	const cached_trades = new Map(state.trades.map(trade => [trade.trade_id, trade]));
	state.trades = (events.trades ?? []).map(trade => {
		const cached = cached_trades.get(trade.trade_id);
		const unchanged = cached?.state === trade.state && cached?.attending === trade.attending;
		return { ...trade, data: unchanged ? cached.data : null };
	});
}
