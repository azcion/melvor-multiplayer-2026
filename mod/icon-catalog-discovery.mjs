export const MAX_ICON_CATALOG_CANDIDATES = 64;
export const MAX_ICON_CATALOG_ICON_BYTES = 1024 * 1024;
export const ICON_CATALOG_MEDIA_TIMEOUT = 15 * 1000;

export const OFFICIAL_GAME_NAMESPACES = new Set([
	'melvorD',
	'melvorF',
	'melvorAoD',
	'melvorTotH',
	'melvorItA'
]);

const NAMESPACED_ID = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function starts_with_bytes(bytes, signature) {
	return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function bytes_to_ascii(bytes, start = 0, end = bytes.length) {
	return String.fromCharCode(...bytes.slice(start, end));
}

function is_svg_bytes(bytes) {
	let text = null;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (e) {
		return false;
	}
	text = text.replace(/^\uFEFF/, '').trimStart();
	while (true) {
		const prefix = /^(?:<!--[^]*?-->|<\?xml[^]*?\?>|<!DOCTYPE[^]*?>)/i.exec(text);
		if (prefix === null)
			break;
		text = text.slice(prefix[0].length).trimStart();
	}
	return /^<svg(?:\s|\/?>)/i.test(text);
}

export function is_official_game_id(id) {
	if (typeof id !== 'string')
		return false;
	const separator = id.indexOf(':');
	return separator > 0 && OFFICIAL_GAME_NAMESPACES.has(id.slice(0, separator));
}

export function detect_icon_media_type(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0)
		return null;
	if (is_svg_bytes(bytes))
		return 'image/svg+xml';
	if (starts_with_bytes(bytes, PNG_SIGNATURE))
		return 'image/png';
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return 'image/jpeg';
	if (bytes.length >= 6 && (bytes_to_ascii(bytes, 0, 6) === 'GIF87a' || bytes_to_ascii(bytes, 0, 6) === 'GIF89a'))
		return 'image/gif';
	if (bytes.length >= 12 && bytes_to_ascii(bytes, 0, 4) === 'RIFF' && bytes_to_ascii(bytes, 8, 12) === 'WEBP')
		return 'image/webp';
	return null;
}

export async function sha256_bytes(bytes, crypto_provider = globalThis.crypto) {
	if (!(bytes instanceof Uint8Array) || !crypto_provider?.subtle?.digest)
		throw new Error('sha256_unavailable');
	const digest = new Uint8Array(await crypto_provider.subtle.digest('SHA-256', bytes));
	return [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
}

function report_diagnostic(on_diagnostic, skill_id, stage) {
	try {
		on_diagnostic({ skill_id, stage });
	} catch (e) {
		// Diagnostics must never interfere with status synchronization.
	}
}

function resolve_media_reference(media, resolve_media_url) {
	if (typeof media !== 'string' || media.length === 0)
		return null;
	if (/^(?:blob|data):/i.test(media))
		return media;
	return resolve_media_url(media);
}

async function read_icon_bytes(media, resolve_media_url, fetch_media, media_timeout) {
	const resolved_media = resolve_media_reference(media, resolve_media_url);
	if (typeof resolved_media !== 'string' || resolved_media.length === 0)
		throw new Error('media_unresolved');
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), media_timeout);
	try {
		const response = await fetch_media(resolved_media, { signal: controller.signal });
		if (response?.ok === false)
			throw new Error('media_fetch_failed');
		const declared_length = Number(response?.headers?.get?.('content-length'));
		if (Number.isSafeInteger(declared_length) && declared_length > MAX_ICON_CATALOG_ICON_BYTES)
			throw new Error('media_too_large');
		const reader = response?.body?.getReader?.();
		if (reader === undefined)
			throw new Error('media_body_unavailable');

		const chunks = [];
		let length = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;
			length += value.byteLength;
			if (length > MAX_ICON_CATALOG_ICON_BYTES) {
				await reader.cancel();
				throw new Error('media_too_large');
			}
			chunks.push(value);
		}
		if (length === 0)
			throw new Error('media_empty');

		const bytes = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return bytes;
	} finally {
		clearTimeout(timeout);
	}
}

export async function discover_skill_icon_candidates(skill_snapshot, {
	resolve_skill = () => null,
	resolve_media_url = media => media,
	fetch_media = globalThis.fetch?.bind(globalThis),
	crypto_provider = globalThis.crypto,
	maximum = MAX_ICON_CATALOG_CANDIDATES,
	media_timeout = ICON_CATALOG_MEDIA_TIMEOUT,
	on_diagnostic = () => {}
} = {}) {
	if (!Array.isArray(skill_snapshot) || typeof fetch_media !== 'function' ||
		!Number.isSafeInteger(maximum) || maximum < 1 ||
		!Number.isSafeInteger(media_timeout) || media_timeout < 1)
		return [];

	const candidates = [];
	const seen_skill_ids = new Set();
	const media_cache = new Map();
	for (const entry of skill_snapshot) {
		const skill_id = entry?.skill_id;
		if (typeof skill_id !== 'string' || !NAMESPACED_ID.test(skill_id) || is_official_game_id(skill_id) ||
			seen_skill_ids.has(skill_id))
			continue;
		seen_skill_ids.add(skill_id);
		if (candidates.length >= maximum)
			break;

		let skill = null;
		try {
			skill = resolve_skill(skill_id);
		} catch (e) {
			report_diagnostic(on_diagnostic, skill_id, 'resolve');
			continue;
		}
		const media = skill?.media;
		if (typeof media !== 'string' || media.length === 0) {
			report_diagnostic(on_diagnostic, skill_id, 'media');
			continue;
		}

		let bytes_promise = media_cache.get(media);
		if (bytes_promise === undefined) {
			bytes_promise = read_icon_bytes(media, resolve_media_url, fetch_media, media_timeout);
			media_cache.set(media, bytes_promise);
		}
		let bytes = null;
		try {
			bytes = await bytes_promise;
		} catch (e) {
			report_diagnostic(on_diagnostic, skill_id, 'read');
			continue;
		}
		const media_type = detect_icon_media_type(bytes);
		if (media_type === null) {
			report_diagnostic(on_diagnostic, skill_id, 'format');
			continue;
		}

		let content_hash = null;
		try {
			content_hash = await sha256_bytes(bytes, crypto_provider);
		} catch (e) {
			report_diagnostic(on_diagnostic, skill_id, 'hash');
			continue;
		}
		candidates.push({
			kind: 'skill',
			skill_id,
			content_hash,
			byte_length: bytes.length,
			media_type,
			bytes
		});
	}
	return candidates;
}
