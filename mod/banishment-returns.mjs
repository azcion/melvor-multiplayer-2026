export const TRANSFER_DELIVERY_STATE_VERSION = 1;

function valid_inventory(value) {
	return Array.isArray(value) && value.every(entry =>
		typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
		typeof entry.id === 'string' && Number.isSafeInteger(entry.qty) && entry.qty > 0
	);
}

function valid_processed_ids(value) {
	return Array.isArray(value) && value.every(id => typeof id === 'string');
}

export function load_transfer_delivery_state(stored, legacy_inventory, legacy_processed_ids) {
	if (typeof stored === 'object' && stored !== null && !Array.isArray(stored) &&
		stored.version === TRANSFER_DELIVERY_STATE_VERSION && valid_inventory(stored.inventory) &&
		valid_processed_ids(stored.processed_banishment_claim_ids))
		return {
			version: TRANSFER_DELIVERY_STATE_VERSION,
			inventory: stored.inventory.map(entry => ({ ...entry })),
			processed_banishment_claim_ids: [...stored.processed_banishment_claim_ids]
		};
	return {
		version: TRANSFER_DELIVERY_STATE_VERSION,
		inventory: valid_inventory(legacy_inventory) ? legacy_inventory.map(entry => ({ ...entry })) : [],
		processed_banishment_claim_ids: valid_processed_ids(legacy_processed_ids) ? [...legacy_processed_ids] : []
	};
}

export function replace_transfer_inventory(delivery_state, inventory) {
	return {
		version: TRANSFER_DELIVERY_STATE_VERSION,
		inventory: inventory.map(entry => ({ ...entry })),
		processed_banishment_claim_ids: [...delivery_state.processed_banishment_claim_ids]
	};
}

export function apply_banishment_claim(delivery_state, claim, maximum_entries) {
	if (delivery_state.processed_banishment_claim_ids.includes(claim.claim_id))
		return { status: 'already-applied', state: delivery_state };

	const assets = claim.items.map(item => ({ ...item }));
	if (claim.gp > 0)
		assets.unshift({ id: 'melvorD:GP', qty: claim.gp });
	const inventory = delivery_state.inventory.map(entry => ({ ...entry }));
	const new_ids = new Set(assets
		.map(asset => asset.id)
		.filter(id => !inventory.some(entry => entry.id === id))
	);
	if (inventory.length + new_ids.size > maximum_entries)
		return { status: 'blocked', state: delivery_state };

	for (const asset of assets) {
		const existing = inventory.find(entry => entry.id === asset.id);
		if (existing)
			existing.qty += asset.qty;
		else
			inventory.push({ id: asset.id, qty: asset.qty });
	}

	return {
		status: 'applied',
		state: {
			version: TRANSFER_DELIVERY_STATE_VERSION,
			inventory,
			processed_banishment_claim_ids: [
				...delivery_state.processed_banishment_claim_ids,
				claim.claim_id
			]
		}
	};
}
