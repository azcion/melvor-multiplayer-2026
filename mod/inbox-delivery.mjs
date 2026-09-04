export const INBOX_DELIVERY_STATE_VERSION = 1;

export function get_inbox_existing_item_ids(inbox_items, bank_item_ids) {
	const inbox_ids = new Set(Array.isArray(inbox_items)
		? inbox_items.map(item => item?.item_id).filter(item_id => typeof item_id === 'string')
		: []);
	return [...new Set(Array.isArray(bank_item_ids) ? bank_item_ids : [])]
		.filter(item_id => inbox_ids.has(item_id));
}

function valid_processed_ids(value) {
	return Array.isArray(value) && value.every(id => typeof id === 'string');
}

export function load_inbox_delivery_state(stored, legacy_processed_ids) {
	if (typeof stored === 'object' && stored !== null && !Array.isArray(stored) &&
		stored.version === INBOX_DELIVERY_STATE_VERSION && valid_processed_ids(stored.processed_claim_ids))
		return {
			version: INBOX_DELIVERY_STATE_VERSION,
			processed_claim_ids: [...stored.processed_claim_ids]
		};
	return {
		version: INBOX_DELIVERY_STATE_VERSION,
		processed_claim_ids: valid_processed_ids(legacy_processed_ids) ? [...legacy_processed_ids] : []
	};
}

export function forget_inbox_claim(state, claim_id) {
	return {
		version: INBOX_DELIVERY_STATE_VERSION,
		processed_claim_ids: state.processed_claim_ids.filter(id => id !== claim_id)
	};
}

export function apply_inbox_claim(state, claim, adapter) {
	if (typeof claim !== 'object' || claim === null || Array.isArray(claim) ||
		typeof claim.claim_id !== 'string' || !Array.isArray(claim.items))
		return { status: 'invalid', state };
	if (state.processed_claim_ids.includes(claim.claim_id))
		return { status: 'already-applied', state };

	const item_ids = new Set();
	let new_bank_items = 0;
	for (const item of claim.items) {
		if (typeof item !== 'object' || item === null || Array.isArray(item) ||
			typeof item.id !== 'string' || item.id.length === 0 || item_ids.has(item.id) ||
			!Number.isSafeInteger(item.qty) || item.qty <= 0)
			return { status: 'invalid', state };
		item_ids.add(item.id);
		const is_currency = item.id === 'melvorD:GP' ||
			adapter.is_known_currency?.(item.id) === true;
		if (!is_currency) {
			if (!adapter.is_known_item(item.id))
				return { status: 'blocked', state };
			if (!adapter.has_bank_item(item.id))
				new_bank_items++;
		}
	}
	if (new_bank_items > adapter.get_bank_free_slots())
		return { status: 'blocked', state };

	return {
		status: 'applied',
		state: {
			version: INBOX_DELIVERY_STATE_VERSION,
			processed_claim_ids: [...state.processed_claim_ids, claim.claim_id]
		}
	};
}
