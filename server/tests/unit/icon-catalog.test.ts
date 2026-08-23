import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { migrations } from '../../db/schema';
import {
	DEFAULT_ICON_CATALOG_LIMITS,
	ICON_CATALOG_UPLOAD_REQUEST_TTL,
	IconCatalogCapacityError,
	MAX_PENDING_ICON_CATALOG_UPLOADS_PER_CLIENT,
	clear_icon_catalog_upload_requests,
	consume_icon_catalog_upload_request,
	get_icon_catalog_limits,
	get_icon_catalog_usage,
	get_icon_catalog_blob,
	icon_catalog_blob_exists,
	icon_catalog_observation_exists,
	detect_icon_catalog_media_type,
	persist_icon_catalog_blob,
	persist_icon_catalog_skill_icon,
	observe_icon_catalog_skill,
	sha256_icon_catalog_bytes,
	format_icon_catalog_log_fields,
	issue_icon_catalog_upload_request
} from '../../icon-catalog';

function initialized_database(): Database {
	const database = new Database(':memory:', { strict: true });
	database.run('PRAGMA foreign_keys = ON');
	for (const migration of migrations) {
		database.transaction(() => database.run(migration.sql)).immediate();
		database.run(`PRAGMA user_version = ${migration.version}`);
	}
	return database;
}

function count(database: Database, table: string): number {
	return database.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM \`${table}\``).get()?.count ?? 0;
}

test('stores immutable icon bytes, deduplicates content, and tracks observations over time', () => {
	const database = initialized_database();
	const original = new Uint8Array([0, 1, 2, 255]);
	const changed = new Uint8Array([0, 1, 2, 254]);
	const original_hash = sha256_icon_catalog_bytes(original);
	const changed_hash = sha256_icon_catalog_bytes(changed);

	expect(persist_icon_catalog_skill_icon(database, {
		skill_id: 'mod-one:Mining',
		content_hash: original_hash,
		bytes: original,
		media_type: 'image/png'
	}, 100)).toEqual({ blob_created: true, observation_created: true });
	expect(persist_icon_catalog_skill_icon(database, {
		skill_id: 'mod-one:Mining',
		content_hash: original_hash,
		bytes: original,
		media_type: 'image/png'
	}, 50)).toEqual({ blob_created: false, observation_created: false });

	const stored_original = get_icon_catalog_blob(database, original_hash);
	expect(stored_original?.bytes).toEqual(original);
	expect(stored_original?.first_seen_at).toBe(100);
	expect(stored_original?.last_seen_at).toBe(100);
	expect(count(database, 'icon_catalog_blobs')).toBe(1);
	expect(count(database, 'icon_catalog_observations')).toBe(1);

	expect(persist_icon_catalog_skill_icon(database, {
		skill_id: 'mod-two:Mining',
		content_hash: original_hash,
		bytes: original,
		media_type: 'image/png'
	}, 200)).toEqual({ blob_created: false, observation_created: true });
	expect(observe_icon_catalog_skill(database, 'mod-two:Mining', original_hash, 150)).toBe(false);

	expect(persist_icon_catalog_skill_icon(database, {
		skill_id: 'mod-one:Mining',
		content_hash: changed_hash,
		bytes: changed,
		media_type: 'image/png'
	}, 300)).toEqual({ blob_created: true, observation_created: true });
	const changed_observation = database.query<{ first_seen_at: number; last_seen_at: number }, [string, string, string]>(
		'SELECT `first_seen_at`, `last_seen_at` FROM `icon_catalog_observations` ' +
		'WHERE `kind` = ? AND `object_id` = ? AND `content_hash` = ?'
	).get('skill', 'mod-one:Mining', changed_hash);
	expect(changed_observation).toEqual({ first_seen_at: 300, last_seen_at: 300 });
	const updated_original = get_icon_catalog_blob(database, original_hash);
	expect(updated_original?.last_seen_at).toBe(200);
	expect(count(database, 'icon_catalog_blobs')).toBe(2);
	expect(count(database, 'icon_catalog_observations')).toBe(3);
	expect(icon_catalog_blob_exists(database, original_hash)).toBe(true);
	expect(icon_catalog_observation_exists(database, 'mod-one:Mining', changed_hash)).toBe(true);
	database.close();
});

test('preserves SVG bytes exactly and associates a known blob without duplication', () => {
	const database = initialized_database();
	const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');
	const content_hash = sha256_icon_catalog_bytes(svg);

	expect(persist_icon_catalog_blob(database, {
		content_hash,
		bytes: svg,
		media_type: 'image/svg+xml'
	}, 400)).toBe(true);
	expect(observe_icon_catalog_skill(database, 'mod-svg:Runecrafting', content_hash, 500)).toBe(true);
	expect(persist_icon_catalog_blob(database, {
		content_hash,
		bytes: svg,
		media_type: 'image/svg+xml'
	}, 600)).toBe(false);

	const stored = get_icon_catalog_blob(database, content_hash);
	expect(stored?.bytes).toEqual(svg);
	expect(stored?.media_type).toBe('image/svg+xml');
	expect(stored?.byte_length).toBe(svg.byteLength);
	expect(stored?.first_seen_at).toBe(400);
	expect(stored?.last_seen_at).toBe(600);
	expect(count(database, 'icon_catalog_blobs')).toBe(1);
	expect(count(database, 'icon_catalog_observations')).toBe(1);
	database.close();
});

test('detects SVG documents with BOM, XML, comment, and DOCTYPE prefixes', () => {
	const svg = new TextEncoder().encode('\uFEFF<?xml version="1.0"?>\n<!-- preserved -->\n<!DOCTYPE svg>\n<svg/>');
	expect(detect_icon_catalog_media_type(svg)).toBe('image/svg+xml');
});

test('rejects invalid DB-layer values and cannot persist action or combat kinds', () => {
	const database = initialized_database();
	const bytes = new Uint8Array([1, 2, 3]);
	const content_hash = sha256_icon_catalog_bytes(bytes);
	const missing_hash = sha256_icon_catalog_bytes(new Uint8Array([4, 5, 6]));

	expect(() => persist_icon_catalog_blob(database, {
		content_hash: 'not-a-hash',
		bytes,
		media_type: 'image/png'
	})).toThrow(RangeError);
	expect(() => persist_icon_catalog_blob(database, {
		content_hash,
		bytes,
		media_type: 'image/png'
	}, -1)).toThrow(RangeError);
	expect(persist_icon_catalog_blob(database, {
		content_hash,
		bytes,
		media_type: 'image/png'
	})).toBe(true);
	expect(() => observe_icon_catalog_skill(database, 'not namespaced', content_hash)).toThrow(RangeError);
	expect(() => observe_icon_catalog_skill(database, 'mod-one:Mining', missing_hash)).toThrow(RangeError);
	expect(() => database.query(
		'INSERT INTO `icon_catalog_observations` ' +
		'(`kind`, `object_id`, `content_hash`, `first_seen_at`, `last_seen_at`) VALUES(?, ?, ?, ?, ?)'
	).run('combat', 'mod-one:Mining', content_hash, 1, 1)).toThrow();
	expect(() => database.query(
		'INSERT INTO `icon_catalog_observations` ' +
		'(`kind`, `object_id`, `content_hash`, `first_seen_at`, `last_seen_at`) VALUES(?, ?, ?, ?, ?)'
	).run('skill', 'not-namespaced', content_hash, 1, 1)).toThrow();
	database.close();
});

test('uses safe lowerable limits and bounds catalog growth', () => {
	const limits = get_icon_catalog_limits(key => ({
		icon_collection_max_icon_bytes: '128',
		icon_collection_max_manifest_items: '8',
		icon_collection_max_catalog_bytes: '4096',
		icon_collection_max_observations: '12'
	}[key] ?? null));
	expect(limits).toEqual({
		max_icon_bytes: 128,
		max_manifest_items: 8,
		max_catalog_bytes: 4096,
		max_observations: 12
	});
	expect(get_icon_catalog_limits(() => 'not-a-number')).toEqual(DEFAULT_ICON_CATALOG_LIMITS);

	const database = initialized_database();
	const first = new Uint8Array([1, 2, 3, 4]);
	const second = new Uint8Array([5]);
	const first_hash = sha256_icon_catalog_bytes(first);
	const second_hash = sha256_icon_catalog_bytes(second);
	const bounded = { ...DEFAULT_ICON_CATALOG_LIMITS, max_catalog_bytes: 4, max_observations: 1 };
	persist_icon_catalog_skill_icon(database, {
		skill_id: 'mod-one:Mining', content_hash: first_hash, bytes: first, media_type: 'image/png'
	}, 100, bounded);
	expect(get_icon_catalog_usage(database)).toEqual({ catalog_bytes: 4, observation_count: 1 });
	expect(() => persist_icon_catalog_skill_icon(database, {
		skill_id: 'mod-two:Mining', content_hash: second_hash, bytes: second, media_type: 'image/png'
	}, 101, bounded)).toThrow(IconCatalogCapacityError);
	expect(() => observe_icon_catalog_skill(database, 'mod-two:Mining', first_hash, 102, bounded))
		.toThrow(IconCatalogCapacityError);
	expect(format_icon_catalog_log_fields({ event: 'upload_accepted', byte_length: 4, media_type: 'image/png' }))
		.toBe('event="upload_accepted" byte_length=4 media_type="image/png"');
	database.close();
});

test('bounds pending upload authorizations per client and releases capacity on consume or expiry', () => {
	clear_icon_catalog_upload_requests();
	const request = {
		client_id: 42,
		skill_id: 'mod-one:Mining',
		content_hash: 'a'.repeat(64),
		byte_length: 10,
		media_type: 'image/png' as const
	};
	const tokens = Array.from({ length: MAX_PENDING_ICON_CATALOG_UPLOADS_PER_CLIENT }, () =>
		issue_icon_catalog_upload_request(request, 100));
	expect(tokens.every(token => typeof token === 'string')).toBe(true);
	expect(issue_icon_catalog_upload_request(request, 100)).toBeNull();

	const first = tokens[0] as string;
	expect(consume_icon_catalog_upload_request(first, request.client_id, 101)?.skill_id).toBe(request.skill_id);
	expect(typeof issue_icon_catalog_upload_request(request, 101)).toBe('string');

	clear_icon_catalog_upload_requests();
	const expiring = issue_icon_catalog_upload_request(request, 200) as string;
	expect(consume_icon_catalog_upload_request(
		expiring,
		request.client_id,
		200 + ICON_CATALOG_UPLOAD_REQUEST_TTL
	)).toBeNull();
	expect(typeof issue_icon_catalog_upload_request(request, 200 + ICON_CATALOG_UPLOAD_REQUEST_TTL)).toBe('string');
	clear_icon_catalog_upload_requests();
});
