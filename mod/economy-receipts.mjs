export const PROCESSED_ECONOMY_RECEIPT_LIMIT = 128;

function normalize_effect(effect) {
	if (typeof effect !== 'object' || effect === null || Array.isArray(effect) ||
		!['bank', 'gp', 'transfer'].includes(effect.storage) ||
		!Number.isSafeInteger(effect.qty) || effect.qty === 0)
		return null;
	if (effect.storage !== 'gp' && (typeof effect.item_id !== 'string' || effect.item_id.length === 0))
		return null;
	if (effect.destroyable !== undefined && typeof effect.destroyable !== 'boolean')
		return null;
	return {
		storage: effect.storage,
		item_id: effect.item_id,
		qty: effect.qty,
		destroyable: effect.destroyable === true
	};
}

function prepare_transfer_inventory(inventory, effects, maximum_entries) {
	const next = inventory.map(item => ({ ...item }));
	for (const effect of effects.filter(entry => entry.storage === 'transfer')) {
		const existing = next.find(item => item.id === effect.item_id);
		if (effect.qty < 0) {
			if (existing === undefined || existing.qty < -effect.qty ||
				(existing.destroyable === true) !== effect.destroyable)
				return null;
			existing.qty += effect.qty;
			if (existing.qty === 0)
				next.splice(next.indexOf(existing), 1);
		} else if (existing !== undefined) {
			if ((existing.destroyable === true) !== effect.destroyable)
				return null;
			existing.qty += effect.qty;
		} else {
			if (next.length >= maximum_entries)
				return null;
			next.push({
				id: effect.item_id,
				qty: effect.qty,
				...(effect.destroyable ? { destroyable: true } : {})
			});
		}
	}
	return next;
}

export function apply_economy_receipt(receipt, processed_ids, adapter) {
	if (typeof receipt !== 'object' || receipt === null || Array.isArray(receipt) ||
		typeof receipt.id !== 'string' || typeof receipt.kind !== 'string' || !Array.isArray(receipt.effects))
		return 'invalid';
	if (processed_ids.includes(receipt.id))
		return 'already-applied';

	const effects = receipt.effects.map(normalize_effect);
	if (effects.some(effect => effect === null))
		return 'invalid';
	for (const effect of effects) {
		if (effect.storage === 'bank') {
			if (!adapter.has_bank_item(effect.item_id) ||
				(effect.qty < 0 && adapter.get_bank_qty(effect.item_id) < -effect.qty))
				return 'blocked';
		} else if (effect.storage === 'gp' && effect.qty < 0 && adapter.get_gp() < -effect.qty) {
			return 'blocked';
		}
	}
	const transfer_inventory = prepare_transfer_inventory(
		adapter.get_transfer_inventory(),
		effects,
		adapter.maximum_transfer_entries
	);
	if (transfer_inventory === null)
		return 'blocked';

	for (const effect of effects) {
		if (effect.storage === 'bank') {
			if (effect.qty > 0)
				adapter.add_bank_item(effect.item_id, effect.qty);
			else
				adapter.remove_bank_item(effect.item_id, -effect.qty);
		} else if (effect.storage === 'gp') {
			if (effect.qty > 0)
				adapter.add_gp(effect.qty);
			else
				adapter.remove_gp(-effect.qty);
		}
	}
	if (effects.some(effect => effect.storage === 'transfer'))
		adapter.replace_transfer_inventory(transfer_inventory);

	processed_ids.push(receipt.id);
	if (processed_ids.length > PROCESSED_ECONOMY_RECEIPT_LIMIT)
		processed_ids.splice(0, processed_ids.length - PROCESSED_ECONOMY_RECEIPT_LIMIT);
	adapter.persist_processed_ids(processed_ids);
	return 'applied';
}
