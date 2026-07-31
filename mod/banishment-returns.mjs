export function apply_banishment_claim(inventory, processed_claim_ids, claim, maximum_entries) {
	if (processed_claim_ids.includes(claim.claim_id))
		return false;

	const assets = [...claim.items];
	if (claim.gp > 0)
		assets.unshift({ id: 'melvorD:GP', qty: claim.gp });
	for (const asset of assets) {
		const existing = inventory.find(entry => entry.id === asset.id);
		if (existing) {
			existing.qty += asset.qty;
		} else {
			if (inventory.length >= maximum_entries)
				throw new RangeError('Banishment claim exceeds transfer inventory capacity');
			inventory.push({ id: asset.id, qty: asset.qty });
		}
	}

	processed_claim_ids.push(claim.claim_id);
	return true;
}
