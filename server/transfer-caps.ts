export const GP_TRANSFER_CAP = 1_000_000_000;
export const OTHER_CURRENCY_TRANSFER_CAP = 1_000_000;

const TRANSFER_CURRENCY_IDS = new Set([
	'melvorD:GP',
	'melvorD:SlayerCoins',
	'melvorItA:AbyssalPieces',
	'melvorItA:AbyssalSlayerCoins'
]);

export function get_transfer_currency_cap(item_id: string): number | null {
	if (!TRANSFER_CURRENCY_IDS.has(item_id))
		return null;
	return item_id === 'melvorD:GP' ? GP_TRANSFER_CAP : OTHER_CURRENCY_TRANSFER_CAP;
}

export function cap_transfer_items<T extends { id: string; qty: number }>(items: T[]): T[] {
	const accepted = new Map<string, number>();
	return items.flatMap(item => {
		const cap = get_transfer_currency_cap(item.id);
		if (cap === null)
			return [item];
		const remaining = Math.max(cap - (accepted.get(item.id) ?? 0), 0);
		const qty = Math.min(item.qty, remaining);
		accepted.set(item.id, (accepted.get(item.id) ?? 0) + qty);
		return qty > 0 ? [{ ...item, qty }] : [];
	});
}

export function get_transfer_currency_overage<T extends { id: string; qty: number }>(items: T[]): number {
	const requested = new Map<string, number>();
	for (const item of items) {
		const cap = get_transfer_currency_cap(item.id);
		if (cap !== null)
			requested.set(item.id, (requested.get(item.id) ?? 0) + item.qty);
	}
	let overage = 0;
	for (const [item_id, qty] of requested) {
		const cap = get_transfer_currency_cap(item_id) as number;
		overage += Math.max(qty - cap, 0);
	}
	return overage;
}
