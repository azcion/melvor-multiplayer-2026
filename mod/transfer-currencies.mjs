export const TRANSFER_CURRENCY_DEFINITIONS = Object.freeze([
	Object.freeze({ property: 'gp', id: 'melvorD:GP', lang_id: 'MOD_MP_CURRENCY_GOLD_PIECES', shorthand: 'GP' }),
	Object.freeze({ property: 'slayerCoins', id: 'melvorD:SlayerCoins', lang_id: 'MOD_MP_CURRENCY_SLAYER_COINS', shorthand: 'SC' }),
	Object.freeze({ property: 'abyssalPieces', id: 'melvorItA:AbyssalPieces', lang_id: 'MOD_MP_CURRENCY_ABYSSAL_PIECES', shorthand: 'AP' }),
	Object.freeze({ property: 'abyssalSlayerCoins', id: 'melvorItA:AbyssalSlayerCoins', lang_id: 'MOD_MP_CURRENCY_ABYSSAL_SLAYER_COINS', shorthand: 'ASC' })
]);

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

export function is_transfer_currency(game, currency_id) {
	return get_transfer_currency(game, currency_id) !== null;
}
