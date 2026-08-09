const BINDINGS_VERSION = 1;

function valid_account(account) {
	return account !== null && typeof account === 'object' &&
		typeof account.cloud_username === 'string' && account.cloud_username.length > 0 &&
		typeof account.playfab_id === 'string' && account.playfab_id.length > 0;
}

function valid_binding(binding) {
	return valid_account(binding) && typeof binding.client_identifier === 'string' &&
		typeof binding.client_key === 'string';
}

export function read_melvor_account(cloud_manager, storage) {
	const cloud_username = cloud_manager?.cloudUsername;
	const playfab_id = storage?.getItem?.('playFabID');
	if (typeof cloud_username !== 'string' || typeof playfab_id !== 'string')
		return null;
	const username = cloud_username.trim();
	const id = playfab_id.trim();
	return username.length > 0 && id.length > 0
		? { cloud_username: username, playfab_id: id }
		: null;
}

export function normalize_identity_bindings(value) {
	if (value === null || typeof value !== 'object' || value.version !== BINDINGS_VERSION ||
		!Array.isArray(value.entries))
		return { version: BINDINGS_VERSION, entries: [] };
	const playfab_ids = new Set();
	const entries = [];
	for (const binding of value.entries) {
		if (!valid_binding(binding) || playfab_ids.has(binding.playfab_id))
			continue;
		playfab_ids.add(binding.playfab_id);
		entries.push({ ...binding });
	}
	return {
		version: BINDINGS_VERSION,
		entries
	};
}

export function find_identity_binding(value, account) {
	if (!valid_account(account))
		return null;
	return normalize_identity_bindings(value).entries.find(binding =>
		binding.playfab_id === account.playfab_id
	) ?? null;
}

export function upsert_identity_binding(value, account, credentials) {
	if (!valid_account(account) || credentials === null || typeof credentials !== 'object' ||
		typeof credentials.client_identifier !== 'string' || typeof credentials.client_key !== 'string')
		return normalize_identity_bindings(value);
	const bindings = normalize_identity_bindings(value);
	const binding = {
		...account,
		client_identifier: credentials.client_identifier,
		client_key: credentials.client_key,
		...(typeof credentials.friend_code === 'string' ? { friend_code: credentials.friend_code } : {})
	};
	const index = bindings.entries.findIndex(entry =>
		entry.playfab_id === account.playfab_id
	);
	if (index === -1)
		bindings.entries.push(binding);
	else {
		bindings.entries[index] = {
			...binding,
			cloud_username: bindings.entries[index].cloud_username
		};
	}
	return bindings;
}
