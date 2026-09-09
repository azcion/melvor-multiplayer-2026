export type CharityItemValuation = {
	value_currency_id: string;
	value_per_item: number;
};

export const CHARITY_KNOWN_CURRENCY_VALUATIONS: Readonly<Record<string, CharityItemValuation>> = Object.freeze({
	'melvorD:GP': { value_currency_id: 'melvorD:GP', value_per_item: 1 },
	'melvorD:SlayerCoins': { value_currency_id: 'melvorD:GP', value_per_item: 1 },
	'melvorItA:AbyssalPieces': { value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 },
	'melvorItA:AbyssalSlayerCoins': { value_currency_id: 'melvorItA:AbyssalPieces', value_per_item: 1 }
});

export function get_charity_known_valuation(item_id: string): CharityItemValuation | null {
	return CHARITY_KNOWN_CURRENCY_VALUATIONS[item_id] ?? null;
}
