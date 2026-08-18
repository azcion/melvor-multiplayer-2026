const GIFT_FLAG_RETURNED = 1 << 0;

export function apply_gift_content_state(gift, gift_data, has_unresolved_items) {
	gift.data = gift_data;
	gift.unresolved = has_unresolved_items;
	if (!has_unresolved_items)
		return 'ready';
	if ((gift_data.flags & GIFT_FLAG_RETURNED) !== 0)
		return 'discard';

	gift.data = null;
	gift.unresolved = false;
	return 'return';
}
