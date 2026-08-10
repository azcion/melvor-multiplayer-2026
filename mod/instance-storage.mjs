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
