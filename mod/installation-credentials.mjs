const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// This store is deliberately separate from diagnostic data and from the synchronized character save.
export function create_installation_credentials(storage, random_uuid = () => crypto.randomUUID()) {
	function key(origin, client_identifier) { return `multiplayer:installation-credential:${new URL(origin).origin}:${client_identifier}`; }
	function read(origin, client_identifier, installation_id) {
		try {
			const value = JSON.parse(storage?.getItem(key(origin, client_identifier)) ?? 'null');
			return value?.installation_id === installation_id && UUID.test(value?.installation_key)
				? { installation_id, installation_key: value.installation_key, enrolled: value.enrolled === true } : null;
		} catch { return null; }
	}
	function persist(origin, client_identifier, value) {
		try {
			if (!storage) return false;
			const serialized = JSON.stringify(value);
			storage.setItem(key(origin, client_identifier), serialized);
			return storage.getItem(key(origin, client_identifier)) === serialized;
		} catch { return false; }
	}
	function auth(origin, client_identifier, installation_id) {
		const value = read(origin, client_identifier, installation_id);
		return value?.enrolled ? { installation_id: value.installation_id, installation_key: value.installation_key } : null;
	}
	async function enroll(origin, client_identifier, installation_id, send) {
		const value = read(origin, client_identifier, installation_id) ?? { installation_id, installation_key: random_uuid(), enrolled: false };
		if (value.enrolled) return true;
		// Persist before sending so a lost enrollment response can be safely retried with the same key.
		if (!persist(origin, client_identifier, value)) return false;
		const result = await send({ installation_id, installation_key: value.installation_key });
		if (result?.response?.status !== 200 || result.json?.success !== true) return false;
		return persist(origin, client_identifier, { ...value, enrolled: true });
	}
	return { auth, enroll };
}
