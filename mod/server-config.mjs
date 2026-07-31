const INVALID_ORIGIN_MESSAGE =
	'Enter a complete server origin, for example https://multiplayer.example.com.';
const ORIGIN_ONLY_MESSAGE =
	'Use only the server origin without a path, query, credentials, or fragment.';
const HTTPS_MESSAGE =
	'Custom servers must use HTTPS. HTTP is supported only for localhost testing.';
export const CUSTOM_SERVER_MAX_LENGTH = 512;

export function normalize_server_origin(value) {
	if (typeof value !== 'string')
		throw new Error(INVALID_ORIGIN_MESSAGE);

	const trimmed_value = value.trim();
	if (trimmed_value.length === 0)
		return '';
	if (trimmed_value.length > CUSTOM_SERVER_MAX_LENGTH)
		throw new Error(INVALID_ORIGIN_MESSAGE);

	let url;
	try {
		url = new URL(trimmed_value);
	} catch {
		throw new Error(INVALID_ORIGIN_MESSAGE);
	}

	if (url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '')
		throw new Error(ORIGIN_ONLY_MESSAGE);

	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && is_loopback_host(url.hostname)))
		throw new Error(HTTPS_MESSAGE);

	return url.origin;
}

export function get_custom_server_validation_error(value) {
	try {
		normalize_server_origin(value);
		return undefined;
	} catch (e) {
		return e.message;
	}
}

export function resolve_server_config(default_server_host, default_storage_prefix, custom_server_host) {
	const normalized_default_host = normalize_server_origin(default_server_host);
	const normalized_custom_host = normalize_server_origin(custom_server_host ?? '');

	if (normalized_custom_host === '' || normalized_custom_host === normalized_default_host) {
		return {
			host: normalized_default_host,
			storage_prefix: default_storage_prefix,
			is_custom: false
		};
	}

	return {
		host: normalized_custom_host,
		storage_prefix: `instance:custom:${encodeURIComponent(normalized_custom_host)}:`,
		is_custom: true
	};
}

function is_loopback_host(hostname) {
	return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}
