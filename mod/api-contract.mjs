export function select_api_major(status, body) {
	if (status !== 200 || !Array.isArray(body?.api_versions) || body.api_versions.length === 0 ||
		body.api_versions.some(version => !Number.isSafeInteger(version) || version < 1))
		throw new Error('API discovery unavailable');
	if (!body.api_versions.includes(2))
		throw Object.assign(new Error('No compatible multiplayer API'), { code: 'api_incompatible' });
	return 2;
}

export function api_endpoint(endpoint, major) {
	if (!endpoint.startsWith('/api/') || /^\/api\/v\d+\//.test(endpoint))
		throw new Error('Expected a logical API endpoint');
	if (major !== 2) throw new Error('API discovery required');
	return `/api/v2/${endpoint.slice(5)}`;
}

export function validate_api_bootstrap(body, major) {
	return body?.api_version === major && Array.isArray(body.api_versions) && body.api_versions.includes(major);
}
