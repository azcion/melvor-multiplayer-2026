export function get_item_namespace(item_id) {
	if (typeof item_id !== 'string')
		return null;

	const separator = item_id.indexOf(':');
	return separator > 0 ? item_id.slice(0, separator) : null;
}

export function get_resolved_item_namespaces(registered_items) {
	const namespaces = new Set();

	for (const entry of registered_items) {
		const item = Array.isArray(entry) ? entry[1] : entry;
		const namespace = get_item_namespace(item?.id);
		if (namespace !== null)
			namespaces.add(namespace);
	}

	return [...namespaces];
}

export function is_item_resolved(item_id, get_item) {
	return item_id === 'melvorD:GP' || get_item(item_id) !== undefined;
}

export function filter_resolved_items(items, get_item_id, is_resolved) {
	return items.filter(item => is_resolved(get_item_id(item)));
}

export function has_unresolved_item(items, get_item_id, is_resolved) {
	return items.some(item => !is_resolved(get_item_id(item)));
}
