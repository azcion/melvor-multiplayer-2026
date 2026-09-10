export const TRANSFER_CURRENCY_DEFINITIONS = Object.freeze([
	Object.freeze({ property: 'gp', id: 'melvorD:GP', lang_id: 'MOD_MP_CURRENCY_GOLD_PIECES', shorthand: 'GP' }),
	Object.freeze({ property: 'slayerCoins', id: 'melvorD:SlayerCoins', lang_id: 'MOD_MP_CURRENCY_SLAYER_COINS', shorthand: 'SC' }),
	Object.freeze({ property: 'abyssalPieces', id: 'melvorItA:AbyssalPieces', lang_id: 'MOD_MP_CURRENCY_ABYSSAL_PIECES', shorthand: 'AP' }),
	Object.freeze({ property: 'abyssalSlayerCoins', id: 'melvorItA:AbyssalSlayerCoins', lang_id: 'MOD_MP_CURRENCY_ABYSSAL_SLAYER_COINS', shorthand: 'ASC' })
]);

export const GP_TRANSFER_CAP = 1_000_000_000;
export const OTHER_CURRENCY_TRANSFER_CAP = 1_000_000;

export function get_transfer_currencies(game) {
	return TRANSFER_CURRENCY_DEFINITIONS
		.map(definition => {
			const currency = game?.[definition.property];
			return currency?.id === definition.id ? { ...definition, currency } : null;
		})
		.filter(Boolean);
}

export function get_available_transfer_currencies(game) {
	return get_transfer_currencies(game).filter(({ currency }) => currency.amount > 0);
}

export function get_transfer_currency(game, currency_id) {
	return get_transfer_currencies(game).find(({ id }) => id === currency_id) ?? null;
}

export function get_transfer_currency_for_currency(game, currency) {
	return get_transfer_currencies(game).find(({ currency: supported_currency }) => supported_currency === currency) ?? null;
}

export function is_transfer_currency(game, currency_id) {
	return get_transfer_currency(game, currency_id) !== null;
}

export function get_transfer_currency_cap(game, currency_id) {
	if (!is_transfer_currency(game, currency_id))
		return null;
	return currency_id === 'melvorD:GP' ? GP_TRANSFER_CAP : OTHER_CURRENCY_TRANSFER_CAP;
}

export function cap_transfer_items(game, items) {
	const accepted = new Map();
	return items.flatMap(item => {
		const cap = get_transfer_currency_cap(game, item.id);
		if (cap === null)
			return [item];
		const remaining = Math.max(cap - (accepted.get(item.id) ?? 0), 0);
		const qty = Math.min(item.qty, remaining);
		accepted.set(item.id, (accepted.get(item.id) ?? 0) + qty);
		return qty > 0 ? [{ ...item, qty }] : [];
	});
}

export function get_transfer_currency_overages(game, items) {
	const requested = new Map();
	for (const item of items) {
		const cap = get_transfer_currency_cap(game, item.id);
		if (cap !== null)
			requested.set(item.id, (requested.get(item.id) ?? 0) + item.qty);
	}
	return TRANSFER_CURRENCY_DEFINITIONS
		.map(definition => {
			const cap = get_transfer_currency_cap(game, definition.id);
			const overage = Math.max((requested.get(definition.id) ?? 0) - cap, 0);
			return overage > 0 ? { ...definition, cap, overage } : null;
		})
		.filter(Boolean);
}
