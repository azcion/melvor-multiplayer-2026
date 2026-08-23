import type { Database } from 'bun:sqlite';
import type * as db_row from './db/types/db_types';

export const ICON_CATALOG_KIND = 'skill' as const;
export const MAX_ICON_CATALOG_MANIFEST_COUNT = 64;
export const MAX_ICON_CATALOG_ICON_BYTES = 1_048_576;
export const MAX_ICON_CATALOG_BYTES = 256 * 1_048_576;
export const MAX_ICON_CATALOG_OBSERVATIONS = 16_384;
export const ICON_CATALOG_UPLOAD_REQUEST_TTL = 5 * 60 * 1000;
export const MAX_PENDING_ICON_CATALOG_UPLOADS_PER_CLIENT = 128;
export const MAX_PENDING_ICON_CATALOG_UPLOADS = 16_384;
const ICON_CATALOG_UPLOAD_SWEEP_INTERVAL = 1000;

export const ICON_CATALOG_SETTING_KEYS = {
	max_icon_bytes: 'icon_collection_max_icon_bytes',
	max_manifest_items: 'icon_collection_max_manifest_items',
	max_catalog_bytes: 'icon_collection_max_catalog_bytes',
	max_observations: 'icon_collection_max_observations'
} as const;

export type IconCatalogLimits = {
	max_icon_bytes: number;
	max_manifest_items: number;
	max_catalog_bytes: number;
	max_observations: number;
};

export const DEFAULT_ICON_CATALOG_LIMITS: Readonly<IconCatalogLimits> = {
	max_icon_bytes: MAX_ICON_CATALOG_ICON_BYTES,
	max_manifest_items: MAX_ICON_CATALOG_MANIFEST_COUNT,
	max_catalog_bytes: MAX_ICON_CATALOG_BYTES,
	max_observations: MAX_ICON_CATALOG_OBSERVATIONS
};

export function format_icon_catalog_log_fields(
	fields: Record<string, string | number | boolean>
): string {
	return Object.entries(fields)
		.map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
		.join(' ');
}

export const OFFICIAL_ICON_CATALOG_SKILL_NAMESPACES = new Set([
	'melvorD',
	'melvorF',
	'melvorAoD',
	'melvorTotH',
	'melvorItA'
]);

export type IconCatalogMediaType =
	| 'image/svg+xml'
	| 'image/png'
	| 'image/jpeg'
	| 'image/webp'
	| 'image/gif';

export type IconCatalogBlobInput = {
	content_hash: string;
	bytes: Uint8Array;
	media_type: IconCatalogMediaType;
};

export type IconCatalogSkillIconInput = IconCatalogBlobInput & {
	skill_id: string;
};

export type IconCatalogSaveResult = {
	blob_created: boolean;
	observation_created: boolean;
};

export type IconCatalogUploadRequest = {
	client_id: number;
	skill_id: string;
	content_hash: string;
	byte_length: number;
	media_type: IconCatalogMediaType;
	expires_at: number;
};

export class IconCatalogCapacityError extends Error {
	readonly capacity: 'bytes' | 'observations';

	constructor(capacity: 'bytes' | 'observations') {
		super(`icon catalog ${capacity} capacity reached`);
		this.name = 'IconCatalogCapacityError';
		this.capacity = capacity;
	}
}

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const SKILL_ID_PATTERN = /^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/;
const MEDIA_TYPES = new Set<IconCatalogMediaType>([
	'image/svg+xml',
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif'
]);

const pending_upload_requests = new Map<string, IconCatalogUploadRequest>();
const pending_upload_request_counts = new Map<number, number>();
let last_upload_request_sweep_at = 0;

export function is_valid_icon_catalog_content_hash(value: unknown): value is string {
	return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}

export function is_valid_icon_catalog_namespaced_id(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 256 && SKILL_ID_PATTERN.test(value);
}

export function is_valid_icon_catalog_skill_id(value: unknown): value is string {
	if (!is_valid_icon_catalog_namespaced_id(value))
		return false;
	return !OFFICIAL_ICON_CATALOG_SKILL_NAMESPACES.has(value.slice(0, value.indexOf(':')));
}

export function is_icon_catalog_media_type(value: unknown): value is IconCatalogMediaType {
	return typeof value === 'string' && MEDIA_TYPES.has(value as IconCatalogMediaType);
}


export function is_valid_icon_catalog_byte_length(
	value: unknown,
	maximum = MAX_ICON_CATALOG_ICON_BYTES
): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 &&
		value <= maximum;
}

function configured_limit(
	get_setting: (key: string) => string | null,
	key: string,
	fallback: number,
	maximum: number
): number {
	const parsed = Number(get_setting(key));
	return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}

export function get_icon_catalog_limits(get_setting: (key: string) => string | null): IconCatalogLimits {
	return {
		max_icon_bytes: configured_limit(
			get_setting,
			ICON_CATALOG_SETTING_KEYS.max_icon_bytes,
			DEFAULT_ICON_CATALOG_LIMITS.max_icon_bytes,
			MAX_ICON_CATALOG_ICON_BYTES
		),
		max_manifest_items: configured_limit(
			get_setting,
			ICON_CATALOG_SETTING_KEYS.max_manifest_items,
			DEFAULT_ICON_CATALOG_LIMITS.max_manifest_items,
			MAX_ICON_CATALOG_MANIFEST_COUNT
		),
		max_catalog_bytes: configured_limit(
			get_setting,
			ICON_CATALOG_SETTING_KEYS.max_catalog_bytes,
			DEFAULT_ICON_CATALOG_LIMITS.max_catalog_bytes,
			MAX_ICON_CATALOG_BYTES
		),
		max_observations: configured_limit(
			get_setting,
			ICON_CATALOG_SETTING_KEYS.max_observations,
			DEFAULT_ICON_CATALOG_LIMITS.max_observations,
			MAX_ICON_CATALOG_OBSERVATIONS
		)
	};
}

function is_signature(bytes: Uint8Array, signature: number[], offset = 0): boolean {
	return signature.every((value, index) => bytes[offset + index] === value);
}

function is_svg_document(bytes: Uint8Array): boolean {
	try {
		let source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
			.replace(/^\uFEFF/, '')
			.trimStart();
		while (true) {
			const prefix = /^(?:<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>)/i.exec(source);
			if (prefix !== null) {
				source = source.slice(prefix[0].length).trimStart();
				continue;
			}
			break;
		}
		return /^<svg(?:\s|\/?\s*>)/i.test(source);
	} catch {
		return false;
	}
}

export function detect_icon_catalog_media_type(bytes: Uint8Array): IconCatalogMediaType | null {
	if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0)
		return null;
	if (is_signature(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return 'image/png';
	if (is_signature(bytes, [0xff, 0xd8, 0xff]))
		return 'image/jpeg';
	if (is_signature(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
		is_signature(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
		return 'image/gif';
	if (is_signature(bytes, [0x52, 0x49, 0x46, 0x46], 0) && is_signature(bytes, [0x57, 0x45, 0x42, 0x50], 8))
		return 'image/webp';
	if (is_svg_document(bytes))
		return 'image/svg+xml';
	return null;
}

function delete_upload_request(token: string, request: IconCatalogUploadRequest): void {
	pending_upload_requests.delete(token);
	const remaining = (pending_upload_request_counts.get(request.client_id) ?? 1) - 1;
	if (remaining === 0)
		pending_upload_request_counts.delete(request.client_id);
	else
		pending_upload_request_counts.set(request.client_id, remaining);
}

function sweep_upload_requests(now = Date.now(), force = false): void {
	if (!force && now - last_upload_request_sweep_at < ICON_CATALOG_UPLOAD_SWEEP_INTERVAL)
		return;
	last_upload_request_sweep_at = now;
	for (const [token, request] of pending_upload_requests)
		if (request.expires_at <= now)
			delete_upload_request(token, request);
}

export function issue_icon_catalog_upload_request(
	request: Omit<IconCatalogUploadRequest, 'expires_at'>,
	now = Date.now()
): string | null {
	sweep_upload_requests(now);
	let client_count = pending_upload_request_counts.get(request.client_id) ?? 0;
	if (client_count >= MAX_PENDING_ICON_CATALOG_UPLOADS_PER_CLIENT ||
		pending_upload_requests.size >= MAX_PENDING_ICON_CATALOG_UPLOADS) {
		sweep_upload_requests(now, true);
		client_count = pending_upload_request_counts.get(request.client_id) ?? 0;
		if (client_count >= MAX_PENDING_ICON_CATALOG_UPLOADS_PER_CLIENT ||
			pending_upload_requests.size >= MAX_PENDING_ICON_CATALOG_UPLOADS)
			return null;
	}
	const token = crypto.randomUUID();
	pending_upload_requests.set(token, {
		...request,
		expires_at: now + ICON_CATALOG_UPLOAD_REQUEST_TTL
	});
	pending_upload_request_counts.set(request.client_id, client_count + 1);
	return token;
}

export function consume_icon_catalog_upload_request(
	token: string | null,
	client_id: number,
	now = Date.now()
): IconCatalogUploadRequest | null {
	sweep_upload_requests(now);
	if (token === null)
		return null;
	const request = pending_upload_requests.get(token);
	if (request === undefined || request.client_id !== client_id)
		return null;
	delete_upload_request(token, request);
	if (request.expires_at <= now)
		return null;
	return request;
}

export function clear_icon_catalog_upload_requests(): void {
	pending_upload_requests.clear();
	pending_upload_request_counts.clear();
	last_upload_request_sweep_at = 0;
}

function validate_observed_at(observed_at: number): void {
	if (!Number.isSafeInteger(observed_at) || observed_at < 0)
		throw new RangeError('observed_at must be a non-negative safe integer');
}

function validate_content_hash(content_hash: string): void {
	if (!is_valid_icon_catalog_content_hash(content_hash))
		throw new RangeError('content_hash must be a lowercase SHA-256 hex digest');
}

function validate_skill_id(skill_id: string): void {
	if (!is_valid_icon_catalog_namespaced_id(skill_id))
		throw new RangeError('skill_id must be a namespaced identifier');
}

function validate_blob_input(
	input: IconCatalogBlobInput,
	observed_at: number,
	max_icon_bytes = MAX_ICON_CATALOG_ICON_BYTES
): void {
	if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0)
		throw new TypeError('bytes must be a non-empty Uint8Array');
	if (input.bytes.byteLength > max_icon_bytes)
		throw new RangeError('bytes exceed the configured icon size limit');
	validate_content_hash(input.content_hash);
	if (sha256_icon_catalog_bytes(input.bytes) !== input.content_hash)
		throw new RangeError('content_hash does not match bytes');
	if (!MEDIA_TYPES.has(input.media_type))
		throw new RangeError('media_type is not supported');
	validate_observed_at(observed_at);
}

function bytes_equal(first: Uint8Array, second: Uint8Array): boolean {
	if (first.byteLength !== second.byteLength)
		return false;
	for (let index = 0; index < first.byteLength; index++) {
		if (first[index] !== second[index])
			return false;
	}
	return true;
}

function get_blob(database: Database, content_hash: string): db_row.icon_catalog_blobs | null {
	return database.query<db_row.icon_catalog_blobs, [string]>(
		'SELECT `content_hash`, `bytes`, `media_type`, `byte_length`, `first_seen_at`, `last_seen_at` ' +
		'FROM `icon_catalog_blobs` WHERE `content_hash` = ? LIMIT 1'
	).get(content_hash);
}

function persist_blob(database: Database, input: IconCatalogBlobInput, observed_at: number): boolean {
	const existing = get_blob(database, input.content_hash);
	if (existing !== null) {
		if (existing.media_type !== input.media_type || !bytes_equal(existing.bytes, input.bytes))
			throw new RangeError('content_hash is already associated with different icon data');
		database.query(
			'UPDATE `icon_catalog_blobs` SET `last_seen_at` = MAX(`last_seen_at`, ?) WHERE `content_hash` = ?'
		).run(observed_at, input.content_hash);
		return false;
	}

	database.query(
		'INSERT INTO `icon_catalog_blobs` ' +
		'(`content_hash`, `bytes`, `media_type`, `byte_length`, `first_seen_at`, `last_seen_at`) ' +
		'VALUES(?, ?, ?, ?, ?, ?)'
	).run(
		input.content_hash,
		input.bytes,
		input.media_type,
		input.bytes.byteLength,
		observed_at,
		observed_at
	);
	return true;
}

function persist_observation(
	database: Database,
	skill_id: string,
	content_hash: string,
	observed_at: number
): boolean {
	const existing = database.query<db_row.icon_catalog_observations, [string, string, string]>(
		'SELECT `kind`, `object_id`, `content_hash`, `first_seen_at`, `last_seen_at` ' +
		'FROM `icon_catalog_observations` WHERE `kind` = ? AND `object_id` = ? AND `content_hash` = ? LIMIT 1'
	).get(ICON_CATALOG_KIND, skill_id, content_hash);

	if (existing === null) {
		database.query(
			'INSERT INTO `icon_catalog_observations` ' +
			'(`kind`, `object_id`, `content_hash`, `first_seen_at`, `last_seen_at`) VALUES(?, ?, ?, ?, ?)'
		).run(ICON_CATALOG_KIND, skill_id, content_hash, observed_at, observed_at);
	} else {
		database.query(
			'UPDATE `icon_catalog_observations` SET `last_seen_at` = MAX(`last_seen_at`, ?) ' +
			'WHERE `kind` = ? AND `object_id` = ? AND `content_hash` = ?'
		).run(observed_at, ICON_CATALOG_KIND, skill_id, content_hash);
	}

	database.query(
		'UPDATE `icon_catalog_blobs` SET `last_seen_at` = MAX(`last_seen_at`, ?) WHERE `content_hash` = ?'
	).run(observed_at, content_hash);
	return existing === null;
}

export function sha256_icon_catalog_bytes(bytes: Uint8Array): string {
	if (!(bytes instanceof Uint8Array))
		throw new TypeError('bytes must be a Uint8Array');
	const hasher = new Bun.CryptoHasher('sha256');
	hasher.update(bytes);
	return hasher.digest('hex');
}

export function icon_catalog_blob_exists(database: Database, content_hash: string): boolean {
	validate_content_hash(content_hash);
	return get_blob(database, content_hash) !== null;
}

export function icon_catalog_observation_exists(
	database: Database,
	skill_id: string,
	content_hash: string
): boolean {
	validate_skill_id(skill_id);
	validate_content_hash(content_hash);
	return database.query(
		'SELECT 1 FROM `icon_catalog_observations` WHERE `kind` = ? AND `object_id` = ? AND `content_hash` = ? LIMIT 1'
	).get(ICON_CATALOG_KIND, skill_id, content_hash) !== null;
}

export function get_icon_catalog_blob(
	database: Database,
	content_hash: string
): db_row.icon_catalog_blobs | null {
	validate_content_hash(content_hash);
	return get_blob(database, content_hash);
}

export function get_icon_catalog_usage(database: Database): {
	catalog_bytes: number;
	observation_count: number;
} {
	const blob_usage = database.query<{ catalog_bytes: number }, []>(
		'SELECT COALESCE(SUM(`byte_length`), 0) AS `catalog_bytes` FROM `icon_catalog_blobs`'
	).get();
	const observations = database.query<{ observation_count: number }, []>(
		'SELECT COUNT(*) AS `observation_count` FROM `icon_catalog_observations`'
	).get();
	return {
		catalog_bytes: blob_usage?.catalog_bytes ?? 0,
		observation_count: observations?.observation_count ?? 0
	};
}

function ensure_catalog_capacity(
	database: Database,
	input: IconCatalogSkillIconInput,
	limits: IconCatalogLimits
): void {
	const usage = get_icon_catalog_usage(database);
	if (get_blob(database, input.content_hash) === null &&
		usage.catalog_bytes + input.bytes.byteLength > limits.max_catalog_bytes)
		throw new IconCatalogCapacityError('bytes');
	if (!icon_catalog_observation_exists(database, input.skill_id, input.content_hash) &&
		usage.observation_count >= limits.max_observations)
		throw new IconCatalogCapacityError('observations');
}

export function persist_icon_catalog_blob(
	database: Database,
	input: IconCatalogBlobInput,
	observed_at = Date.now(),
	limits: IconCatalogLimits = DEFAULT_ICON_CATALOG_LIMITS
): boolean {
	validate_blob_input(input, observed_at, limits.max_icon_bytes);
	return database.transaction(() => {
		if (get_blob(database, input.content_hash) === null &&
			get_icon_catalog_usage(database).catalog_bytes + input.bytes.byteLength > limits.max_catalog_bytes)
			throw new IconCatalogCapacityError('bytes');
		return persist_blob(database, input, observed_at);
	}).immediate();
}

export function observe_icon_catalog_skill(
	database: Database,
	skill_id: string,
	content_hash: string,
	observed_at = Date.now(),
	limits: IconCatalogLimits = DEFAULT_ICON_CATALOG_LIMITS
): boolean {
	validate_skill_id(skill_id);
	validate_content_hash(content_hash);
	validate_observed_at(observed_at);
	return database.transaction(() => {
		if (get_blob(database, content_hash) === null)
			throw new RangeError('content_hash must reference a stored icon blob');
		if (!icon_catalog_observation_exists(database, skill_id, content_hash) &&
			get_icon_catalog_usage(database).observation_count >= limits.max_observations)
			throw new IconCatalogCapacityError('observations');
		return persist_observation(database, skill_id, content_hash, observed_at);
	}).immediate();
}

export function persist_icon_catalog_skill_icon(
	database: Database,
	input: IconCatalogSkillIconInput,
	observed_at = Date.now(),
	limits: IconCatalogLimits = DEFAULT_ICON_CATALOG_LIMITS
): IconCatalogSaveResult {
	validate_skill_id(input.skill_id);
	validate_blob_input(input, observed_at, limits.max_icon_bytes);
	return database.transaction(() => {
		ensure_catalog_capacity(database, input, limits);
		return {
			blob_created: persist_blob(database, input, observed_at),
			observation_created: persist_observation(database, input.skill_id, input.content_hash, observed_at)
		};
	}).immediate();
}
