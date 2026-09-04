import * as runtime from '../app-runtime';
import {
	consume_icon_catalog_upload_request,
	detect_icon_catalog_media_type,
	get_icon_catalog_limits,
	get_icon_catalog_blob,
	get_icon_catalog_usage,
	IconCatalogCapacityError,
	format_icon_catalog_log_fields,
	issue_icon_catalog_upload_request,
	icon_catalog_observation_exists,
	is_icon_catalog_media_type,
	is_valid_icon_catalog_byte_length,
	is_valid_icon_catalog_content_hash,
	is_valid_icon_catalog_namespaced_id,
	is_valid_icon_catalog_skill_id,
	observe_icon_catalog_skill,
	persist_icon_catalog_skill_icon,
	sha256_icon_catalog_bytes
} from '../icon-catalog';
import { read_binary_request } from '../http';
import type { HandlerResult } from '../http';
import type { IconCatalogMediaType } from '../icon-catalog';

const { db, get_service_setting, report_error, session_binary_post_route, session_post_route, write_log } = runtime;

type IconCatalogManifestEntry = {
	kind: 'skill';
	skill_id: string;
	content_hash: string;
	byte_length: number;
	media_type: IconCatalogMediaType;
};

type IconCatalogUploadResult = {
	success: true;
	enabled: true;
	stored: true;
	skill_id: string;
	content_hash: string;
	byte_length: number;
	media_type: IconCatalogMediaType;
};

function caller_shared_skill_exists(client_id: number, skill_id: string): boolean {
	const client = db.query<{ skills_visible: number; skills_available: number }, [number]>(
		'SELECT `skills_visible`, `skills_available` FROM `clients` WHERE `id` = ? LIMIT 1'
	).get(client_id);
	if (client?.skills_visible !== 1 || client.skills_available !== 1)
		return false;
	return db.query<{ skill_id: string }, [number, string]>(
		'SELECT `skill_id` FROM `status_snapshot_skills` WHERE `client_id` = ? AND `skill_id` = ? LIMIT 1'
	).get(client_id, skill_id) !== null;
}

function log_icon_catalog_event(
	event: string,
	fields: Record<string, string | number | boolean>
): void {
	const serialized = format_icon_catalog_log_fields(fields);
	write_log('info', `type=icon_catalog event=${event}${serialized.length === 0 ? '' : ` ${serialized}`}`);
}

function parse_icon_catalog_manifest(
	value: unknown,
	max_manifest_items: number,
	max_icon_bytes: number
): IconCatalogManifestEntry[] | null {
	if (!Array.isArray(value) || value.length > max_manifest_items)
		return null;

	const entries: IconCatalogManifestEntry[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item))
			return null;
		const candidate = item as Record<string, unknown>;
		if (candidate.kind !== 'skill' || !is_valid_icon_catalog_namespaced_id(candidate.skill_id) ||
			!is_valid_icon_catalog_content_hash(candidate.content_hash) ||
			!is_valid_icon_catalog_byte_length(candidate.byte_length, max_icon_bytes) ||
			!is_icon_catalog_media_type(candidate.media_type))
			return null;

		const key = `${candidate.skill_id}\u0000${candidate.content_hash}`;
		if (seen.has(key))
			continue;
		seen.add(key);
		entries.push({
			kind: 'skill',
			skill_id: candidate.skill_id,
			content_hash: candidate.content_hash,
			byte_length: candidate.byte_length,
			media_type: candidate.media_type
		});
	}
	return entries;
}

export function register_icon_catalog_routes(): void {
	session_post_route('/api/client/icon-catalog/check', async (req, url, client_id, json): Promise<HandlerResult> => {
		const started_at = Date.now();
		const limits = get_icon_catalog_limits(get_service_setting);
		if (get_service_setting('icon_collection_enabled') !== '1') {
			log_icon_catalog_event('collection_disabled', { operation: 'check', client_id });
			return { success: true, enabled: false, results: [] };
		}

		const manifest = parse_icon_catalog_manifest(json.icons, limits.max_manifest_items, limits.max_icon_bytes);
		if (manifest === null) {
			log_icon_catalog_event('invalid_manifest', { client_id });
			return 400;
		}

		const client = db.query<{ skills_visible: number; skills_available: number }, [number]>(
			'SELECT `skills_visible`, `skills_available` FROM `clients` WHERE `id` = ? LIMIT 1'
		).get(client_id);
		if (client?.skills_visible !== 1 || client.skills_available !== 1)
			return { success: true, enabled: true, results: [] };

		const shared_skills = new Set(db.query<{ skill_id: string }, [number]>(
			'SELECT `skill_id` FROM `status_snapshot_skills` WHERE `client_id` = ?'
		).all(client_id).map(skill => skill.skill_id));
		const results: Array<IconCatalogManifestEntry & {
			disposition: 'upload' | 'reuse';
			upload_token?: string;
		}> = [];
		let capacity_rejections = 0;

		for (const entry of manifest) {
			if (!is_valid_icon_catalog_skill_id(entry.skill_id) || !shared_skills.has(entry.skill_id))
				continue;

			const blob = get_icon_catalog_blob(db, entry.content_hash);
			if (blob === null) {
				const usage = get_icon_catalog_usage(db);
				if (usage.catalog_bytes + entry.byte_length > limits.max_catalog_bytes ||
					usage.observation_count >= limits.max_observations) {
					capacity_rejections++;
					continue;
				}
				const upload_token = issue_icon_catalog_upload_request({
					client_id,
					skill_id: entry.skill_id,
					content_hash: entry.content_hash,
					byte_length: entry.byte_length,
					media_type: entry.media_type
				});
				if (upload_token === null) {
					capacity_rejections++;
					continue;
				}
				results.push({
					...entry,
					disposition: 'upload',
					upload_token
				});
				continue;
			}
			if (blob.byte_length !== entry.byte_length || blob.media_type !== entry.media_type) {
				log_icon_catalog_event('invalid_manifest', {
					client_id,
					reason: 'known_blob_metadata_mismatch'
				});
				return 400;
			}

			if (!icon_catalog_observation_exists(db, entry.skill_id, entry.content_hash)) {
				try {
					observe_icon_catalog_skill(db, entry.skill_id, entry.content_hash, Date.now(), limits);
				} catch (error) {
					if (error instanceof IconCatalogCapacityError) {
						capacity_rejections++;
						continue;
					}
					report_error('icon catalog observation persistence failed', error);
					return Response.json({ success: false, error: 'storage_unavailable' }, { status: 503 });
				}
			}
			results.push({ ...entry, disposition: 'reuse' });
		}

		log_icon_catalog_event('manifest_checked', {
			client_id,
			candidate_count: manifest.length,
			accepted_count: results.length,
			requested_count: results.filter(result => result.disposition === 'upload').length,
			reused_count: results.filter(result => result.disposition === 'reuse').length,
			capacity_rejections,
			duration_ms: Date.now() - started_at
		});

		return { success: true, enabled: true, results };
	});

	session_binary_post_route('/api/client/icon-catalog/upload', async (req, url, client_id): Promise<HandlerResult> => {
		const started_at = Date.now();
		const limits = get_icon_catalog_limits(get_service_setting);
		if (get_service_setting('icon_collection_enabled') !== '1') {
			log_icon_catalog_event('collection_disabled', { operation: 'upload', client_id });
			return { success: true, enabled: false, stored: false };
		}

		const upload_request = consume_icon_catalog_upload_request(
			req.headers.get('X-Icon-Catalog-Upload-Token'),
			client_id
		);
		if (upload_request === null || !caller_shared_skill_exists(client_id, upload_request.skill_id)) {
			log_icon_catalog_event('rejected_upload', { client_id, reason: 'authorization' });
			return 400;
		}

		if (req.headers.get('Content-Type') !== upload_request.media_type) {
			log_icon_catalog_event('invalid_type', { client_id, skill_id: upload_request.skill_id });
			return 400;
		}

		const result = await read_binary_request(req, limits.max_icon_bytes);
		if ('response' in result) {
			log_icon_catalog_event(result.response.status === 413 ? 'oversized_asset' : 'invalid_body', {
				client_id,
				skill_id: upload_request.skill_id
			});
			return result.response;
		}
		if (result.bytes.byteLength !== upload_request.byte_length) {
			log_icon_catalog_event('invalid_size', { client_id, skill_id: upload_request.skill_id });
			return 400;
		}

		const media_type = detect_icon_catalog_media_type(result.bytes);
		if (media_type === null || media_type !== upload_request.media_type) {
			log_icon_catalog_event('invalid_type', { client_id, skill_id: upload_request.skill_id });
			return 400;
		}
		if (sha256_icon_catalog_bytes(result.bytes) !== upload_request.content_hash) {
			log_icon_catalog_event('hash_mismatch', { client_id, skill_id: upload_request.skill_id });
			return 400;
		}
		if (get_service_setting('icon_collection_enabled') !== '1') {
			log_icon_catalog_event('collection_disabled', { operation: 'upload_commit', client_id });
			return { success: true, enabled: false, stored: false };
		}
		if (!caller_shared_skill_exists(client_id, upload_request.skill_id)) {
			log_icon_catalog_event('rejected_upload', { client_id, reason: 'eligibility_changed' });
			return 400;
		}

		try {
			const current_limits = get_icon_catalog_limits(get_service_setting);
			const save_result = persist_icon_catalog_skill_icon(db, {
				skill_id: upload_request.skill_id,
				content_hash: upload_request.content_hash,
				bytes: result.bytes,
				media_type
			}, Date.now(), current_limits);
			log_icon_catalog_event('upload_accepted', {
				client_id,
				skill_id: upload_request.skill_id,
				content_hash: upload_request.content_hash,
				byte_length: result.bytes.byteLength,
				media_type,
				duplicate_content: !save_result.blob_created,
				observation_created: save_result.observation_created,
				duration_ms: Date.now() - started_at
			});
		} catch (error) {
			if (error instanceof IconCatalogCapacityError) {
				log_icon_catalog_event('capacity_rejected', {
					client_id,
					skill_id: upload_request.skill_id,
					capacity: error.capacity
				});
				return Response.json({ success: false, error: 'catalog_capacity' }, { status: 507 });
			}
			report_error('icon catalog upload persistence failed', error);
			return Response.json({ success: false, error: 'storage_unavailable' }, { status: 503 });
		}

		const response: IconCatalogUploadResult = {
			success: true,
			enabled: true,
			stored: true,
			skill_id: upload_request.skill_id,
			content_hash: upload_request.content_hash,
			byte_length: result.bytes.byteLength,
			media_type
		};
		return response;
	});
}
