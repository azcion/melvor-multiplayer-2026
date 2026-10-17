const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function pending_registration_key(account) {
	return 'pending_identity_registration:' + (account?.playfab_id ?? 'legacy');
}

export function valid_identity_credentials(value) {
	return value !== null && typeof value === 'object' &&
		UUID.test(value.client_identifier) && UUID.test(value.client_key);
}

export function read_pending_registration(value, account) {
	return valid_identity_credentials(value) && value.version === 1 &&
		value.account_id === (account?.playfab_id ?? null) ? value : null;
}

// This record must survive a failed response AND a failed promotion to the normal binding.
export function prepare_registration(read, write, account, random_uuid = () => crypto.randomUUID()) {
	const existing = read(pending_registration_key(account));
	const pending = read_pending_registration(existing, account);
	if (pending) return pending;
	if (existing !== undefined) throw new Error('Unresolved identity registration');
	const created = { version: 1, account_id: account?.playfab_id ?? null,
		client_identifier: random_uuid(), client_key: random_uuid() };
	write(pending_registration_key(account), created);
	const verified = read_pending_registration(read(pending_registration_key(account)), account);
	if (!verified || verified.client_identifier !== created.client_identifier || verified.client_key !== created.client_key)
		throw new Error('Identity storage did not persist');
	return verified;
}

export function encode_recovery_code(origin, credentials) {
	if (!valid_identity_credentials(credentials)) throw new Error('Missing identity proof');
	return 'MP1.' + btoa(JSON.stringify({ origin: new URL(origin).origin,
		client_identifier: credentials.client_identifier, client_key: credentials.client_key }));
}

export function decode_recovery_code(code, origin) {
	try {
		if (typeof code !== 'string' || code.length > 2000 || !code.trim().startsWith('MP1.')) return null;
		const value = JSON.parse(atob(code.trim().slice(4)));
		if (value.origin !== new URL(origin).origin || !valid_identity_credentials(value)) return null;
		return { client_identifier: value.client_identifier, client_key: value.client_key };
	} catch { return null; }
}
