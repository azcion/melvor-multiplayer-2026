export function complete_trade_cancellation(state, trade_id) {
	state.trades = state.trades.filter(trade => trade.trade_id !== trade_id);
}

export function deliver_resolved_trade(state, trade_id, items, add_bank_item) {
	for (const item of items)
		add_bank_item(item.item_id, item.qty);

	state.resolved_trades = state.resolved_trades.filter(trade => trade.trade_id !== trade_id);
}
