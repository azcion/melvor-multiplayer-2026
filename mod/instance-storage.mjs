// Only redundant identity metadata is eligible. Recovery and unknown records stay intact.
export function prune_legacy_local_character_storage(storage, legacy_prefix, current_prefix) {
	let removed = 0;
	for (const key of ['client_identifier', 'client_key', 'friend_code', 'identity_bindings']) {
		try {
			const legacy_key = legacy_prefix + key;
			const current_key = current_prefix + key;
			if (legacy_key === current_key) continue;
			const value = storage?.getItem(legacy_key);
			if (value === null || value === undefined || value !== storage.getItem(current_key)) continue;
			if (JSON.parse(value) === null) continue;
			// Recheck both copies immediately before deleting the redundant source.
			if (storage.getItem(legacy_key) !== value || storage.getItem(current_key) !== value) continue;
			storage.removeItem(legacy_key);
			removed++;
		} catch { /* Denied storage or malformed data must never block character loading. */ }
	}
	return removed;
}

export function read_instance_storage_item(
	get_item,
	set_item,
	storage_prefix,
	legacy_storage_prefixes,
	key
) {
	const value = get_item(storage_prefix + key);
	if (value !== undefined)
		return value;

	for (const legacy_storage_prefix of legacy_storage_prefixes) {
		if (legacy_storage_prefix === storage_prefix)
			continue;
		const legacy_value = get_item(legacy_storage_prefix + key);
		if (legacy_value === undefined)
			continue;
		set_item(storage_prefix + key, legacy_value);
		return legacy_value;
	}

	return undefined;
}

export function migrate_unscoped_server_storage(
	get_item,
	set_item,
	storage_prefix,
	keys,
	marker_key = 'server_storage_isolation_migrated'
) {
	const marker = storage_prefix + marker_key;
	if (get_item(marker) === true)
		return false;

	for (const key of keys) {
		const scoped_key = storage_prefix + key;
		if (get_item(scoped_key) !== undefined)
			continue;
		const legacy_value = get_item(key);
		if (legacy_value !== undefined)
			set_item(scoped_key, legacy_value);
	}

	set_item(marker, true);
	return true;
}
