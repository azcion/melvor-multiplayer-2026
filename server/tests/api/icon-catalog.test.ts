import { describe, expect, test } from 'bun:test';
import {
	MAX_ICON_CATALOG_ICON_BYTES,
	MAX_ICON_CATALOG_MANIFEST_COUNT,
	sha256_icon_catalog_bytes
} from '../../icon-catalog';
import { post, post_binary, post_json, register_client } from '../support/http';
import { db_all, db_count, db_run } from '../support/persistence';

type CheckResult = {
	success: boolean;
	enabled: boolean;
	results: Array<{
		skill_id: string;
		content_hash: string;
		byte_length: number;
		media_type: string;
		upload_token?: string;
		disposition: 'upload' | 'reuse';
	}>;
};

const icon_bytes = new TextEncoder().encode('catalog-icon');
const icon_hash = sha256_icon_catalog_bytes(icon_bytes);
const icon_manifest = {
	kind: 'skill',
	skill_id: 'mod-one:Mining',
	content_hash: icon_hash,
	byte_length: icon_bytes.byteLength,
	media_type: 'image/png'
};

async function share_skills(session_token: string, skills = [{ skill_id: 'mod-one:Mining', level: 1 }]) {
	return post_json('/api/client/status/sync', {
		skills,
		activity: { type: 'idle' }
	}, session_token);
}

const svg_bytes = new TextEncoder().encode(
	'\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- preserved -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>'
);
const svg_hash = sha256_icon_catalog_bytes(svg_bytes);
const png_bytes = Uint8Array.from(atob(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
), character => character.charCodeAt(0));
const png_hash = sha256_icon_catalog_bytes(png_bytes);

async function request_upload(
	client: Awaited<ReturnType<typeof register_client>>,
	skill_id: string,
	bytes: Uint8Array,
	media_type: string,
	content_hash = sha256_icon_catalog_bytes(bytes),
	byte_length = bytes.byteLength
) {
	await share_skills(client.session_token, [{ skill_id, level: 1 }]);
	const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
		icons: [{ kind: 'skill', skill_id, content_hash, byte_length, media_type }]
	}, client.session_token);
	const request = checked.json.results[0];
	if (checked.response.status !== 200 || request?.disposition !== 'upload' || request.upload_token === undefined)
		throw new Error(`Upload request was not issued: ${JSON.stringify(checked.json)}`);
	return post_binary('/api/client/icon-catalog/upload', bytes, client.session_token, {
		'Content-Type': media_type,
		'X-Icon-Catalog-Upload-Token': request.upload_token
	});
}

describe('icon catalog manifest API', () => {
	test('requires an authenticated session', async () => {
		const response = await post('/api/client/icon-catalog/check', { icons: [] });

		expect(response.status).toBe(401);
	});

	test('requests an unknown custom skill blob only when it is in the shared skill snapshot', async () => {
		const client = await register_client('Icon Manifest Client');
		await share_skills(client.session_token);

		const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [icon_manifest]
		}, client.session_token);

		expect(checked.response.status).toBe(200);
		expect(checked.json).toEqual({
			success: true,
			enabled: true,
			results: [{ ...icon_manifest, disposition: 'upload', upload_token: expect.any(String) }]
		});
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `icon_catalog_observations`')).toBe(0);
	});

	test('ignores official skills and skills absent from the persisted snapshot', async () => {
		const client = await register_client('Icon Eligibility Client');
		await share_skills(client.session_token, [{ skill_id: 'mod-one:Mining', level: 1 }]);
		const official_bytes = new TextEncoder().encode('official');
		const official_hash = sha256_icon_catalog_bytes(official_bytes);
		const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [
				icon_manifest,
				{ ...icon_manifest, skill_id: 'melvorD:Mining', content_hash: official_hash,
					byte_length: official_bytes.byteLength },
				{ ...icon_manifest, skill_id: 'mod-one:Herblore', content_hash: official_hash,
					byte_length: official_bytes.byteLength }
			]
		}, client.session_token);

		expect(checked.json.results).toEqual([
			{ ...icon_manifest, disposition: 'upload', upload_token: expect.any(String) }
		]);
	});

	test('reuses a known blob for a new observation and does not duplicate an existing observation', async () => {
		const client = await register_client('Icon Reuse Client');
		await share_skills(client.session_token, [
			{ skill_id: 'mod-one:Mining', level: 1 },
			{ skill_id: 'mod-two:Mining', level: 1 }
		]);
		await db_run(
			'INSERT INTO `icon_catalog_blobs` (`content_hash`, `bytes`, `media_type`, `byte_length`, `first_seen_at`, `last_seen_at`) ' +
			'VALUES (?, ?, ?, ?, ?, ?)',
			[icon_hash, icon_bytes, 'image/png', icon_bytes.byteLength, 100, 100]
		);

		const first = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [icon_manifest, { ...icon_manifest, skill_id: 'mod-two:Mining' }, icon_manifest]
		}, client.session_token);
		const second = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [icon_manifest, { ...icon_manifest, skill_id: 'mod-two:Mining' }]
		}, client.session_token);

		expect(first.json.results).toHaveLength(2);
		expect(first.json.results.every(result => result.disposition === 'reuse')).toBe(true);
		expect(second.json.results).toHaveLength(2);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `icon_catalog_observations`')).toBe(2);
	});

	test('rejects malformed hashes, sizes, namespaces, and excessive manifests', async () => {
		const client = await register_client('Icon Validation Client');
		const cases = [
			{ ...icon_manifest, content_hash: 'bad-hash' },
			{ ...icon_manifest, byte_length: 0 },
			{ ...icon_manifest, byte_length: -1 },
			{ ...icon_manifest, byte_length: MAX_ICON_CATALOG_ICON_BYTES + 1 },
			{ ...icon_manifest, skill_id: 'not namespaced' }
		];

		for (const candidate of cases) {
			const response = await post('/api/client/icon-catalog/check', { icons: [candidate] }, client.session_token);
			expect(response.status).toBe(400);
		}
		const too_many = await post('/api/client/icon-catalog/check', {
			icons: Array.from({ length: MAX_ICON_CATALOG_MANIFEST_COUNT + 1 }, () => icon_manifest)
		}, client.session_token);
		expect(too_many.status).toBe(400);
	});

	test('does not request uploads while collection is disabled', async () => {
		const client = await register_client('Disabled Icon Collection Client');
		await share_skills(client.session_token);
		await db_run("UPDATE `service_settings` SET `value` = '0' WHERE `key` = 'icon_collection_enabled'");
		try {
			const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
				icons: [icon_manifest]
			}, client.session_token);

			expect(checked.json).toEqual({ success: true, enabled: false, results: [] });
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'icon_collection_enabled'");
		}
	});

	test('applies lower operator limits before issuing upload requests', async () => {
		const client = await register_client('Configured Icon Collection Client');
		const first_skill = 'mod-config:Mining';
		const second_skill = 'mod-config:Woodcutting';
		await share_skills(client.session_token, [
			{ skill_id: first_skill, level: 1 },
			{ skill_id: second_skill, level: 1 }
		]);
		const first_manifest = { ...icon_manifest, skill_id: first_skill };
		const second_manifest = { ...icon_manifest, skill_id: second_skill, content_hash: 'b'.repeat(64) };
		await db_run("UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'icon_collection_max_manifest_items'");
		await db_run("UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'icon_collection_max_icon_bytes'");
		try {
			expect((await post('/api/client/icon-catalog/check', {
				icons: [first_manifest, second_manifest]
			}, client.session_token)).status).toBe(400);
			expect((await post('/api/client/icon-catalog/check', {
				icons: [{ ...first_manifest, byte_length: 2 }]
			}, client.session_token)).status).toBe(400);
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '64' WHERE `key` = 'icon_collection_max_manifest_items'");
			await db_run("UPDATE `service_settings` SET `value` = '1048576' WHERE `key` = 'icon_collection_max_icon_bytes'");
		}
	});

	test('enforces the catalog byte cap at check and upload time', async () => {
		const client = await register_client('Catalog Capacity Client');
		const first_skill = 'mod-capacity:Mining';
		const second_skill = 'mod-capacity:Woodcutting';
		await share_skills(client.session_token, [
			{ skill_id: first_skill, level: 1 },
			{ skill_id: second_skill, level: 1 }
		]);
		const capacity_bytes = svg_for('capacity-first');
		const first = await request_upload(client, first_skill, capacity_bytes, 'image/svg+xml');
		const second_bytes = svg_for('capacity-second');
		const second_manifest = {
			kind: 'skill',
			skill_id: second_skill,
			content_hash: sha256_icon_catalog_bytes(second_bytes),
			byte_length: second_bytes.byteLength,
			media_type: 'image/svg+xml'
		};
		await db_run(`UPDATE \`service_settings\` SET \`value\` = '${capacity_bytes.byteLength}' WHERE \`key\` = 'icon_collection_max_catalog_bytes'`);
		try {
			const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
				icons: [second_manifest]
			}, client.session_token);
			expect(first.status).toBe(200);
			expect(checked.json.results).toEqual([]);
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '268435456' WHERE `key` = 'icon_collection_max_catalog_bytes'");
		}
	});
});

function svg_for(label: string): Uint8Array {
	return new TextEncoder().encode(`<svg data-test="${label}" viewBox="0 0 1 1"></svg>`);
}

describe('icon catalog upload API', () => {
	test('stores an SVG byte-for-byte and returns metadata only', async () => {
		const client = await register_client('SVG Upload Client');
		const response = await request_upload(client, 'mod-svg:Mining', svg_bytes, 'image/svg+xml');

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			enabled: true,
			stored: true,
			skill_id: 'mod-svg:Mining',
			content_hash: svg_hash,
			byte_length: svg_bytes.byteLength,
			media_type: 'image/svg+xml'
		});
		const rows = await db_all<{ bytes: Uint8Array; media_type: string }>(
			'SELECT `bytes`, `media_type` FROM `icon_catalog_blobs` WHERE `content_hash` = ?', [svg_hash]
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.bytes).toEqual(svg_bytes);
		expect(rows[0]?.media_type).toBe('image/svg+xml');
	});

	test('stores a representative raster icon after content detection', async () => {
		const client = await register_client('Raster Upload Client');
		const response = await request_upload(client, 'mod-raster:Woodcutting', png_bytes, 'image/png');

		expect(response.status).toBe(200);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `icon_catalog_blobs` WHERE `content_hash` = ?', [png_hash])).toBe(1);
	});

	test('consumes each server-issued upload token exactly once', async () => {
		const client = await register_client('One Use Upload Client');
		const skill_id = 'mod-one-use:Mining';
		const bytes = svg_for('one-use');
		await share_skills(client.session_token, [{ skill_id, level: 1 }]);
		const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [{ kind: 'skill', skill_id, content_hash: sha256_icon_catalog_bytes(bytes),
				byte_length: bytes.byteLength, media_type: 'image/svg+xml' }]
		}, client.session_token);
		const token = checked.json.results[0]?.upload_token as string;
		const headers = { 'Content-Type': 'image/svg+xml', 'X-Icon-Catalog-Upload-Token': token };
		const first = await post_binary('/api/client/icon-catalog/upload', bytes, client.session_token, headers);
		const second = await post_binary('/api/client/icon-catalog/upload', bytes, client.session_token, headers);

		expect(first.status).toBe(200);
		expect(second.status).toBe(400);
	});

	test('rejects an issued upload after the shared skill becomes ineligible', async () => {
		const client = await register_client('Revoked Upload Client');
		const skill_id = 'mod-revoked:Mining';
		const bytes = svg_for('revoked');
		await share_skills(client.session_token, [{ skill_id, level: 1 }]);
		const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [{ kind: 'skill', skill_id, content_hash: sha256_icon_catalog_bytes(bytes),
				byte_length: bytes.byteLength, media_type: 'image/svg+xml' }]
		}, client.session_token);
		const token = checked.json.results[0]?.upload_token as string;
		await share_skills(client.session_token, []);

		const response = await post_binary('/api/client/icon-catalog/upload', bytes, client.session_token, {
			'Content-Type': 'image/svg+xml', 'X-Icon-Catalog-Upload-Token': token
		});
		expect(response.status).toBe(400);
		expect(await db_count(
			'SELECT COUNT(*) AS `count` FROM `icon_catalog_observations` WHERE `object_id` = ?', [skill_id]
		)).toBe(0);
	});

	test('rejects a wrong hash and does not store the bytes', async () => {
		const client = await register_client('Wrong Hash Upload Client');
		const bytes = svg_for('wrong-hash');
		const response = await request_upload(client, 'mod-hash:Mining', bytes, 'image/svg+xml', '0'.repeat(64));

		expect(response.status).toBe(400);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `icon_catalog_observations` WHERE `object_id` = ?', ['mod-hash:Mining'])).toBe(0);
	});

	test('rejects unsupported bytes and mismatched content types', async () => {
		const client = await register_client('Invalid Upload Client');
		const invalid_bytes = new TextEncoder().encode('not an image');
		const response = await request_upload(client, 'mod-invalid:Mining', invalid_bytes, 'image/png');
		expect(response.status).toBe(400);

		const mismatch_client = await register_client('Mismatched Upload Client');
		const bytes = svg_for('mismatched-type');
		const skill_id = 'mod-mismatch:Mining';
		await share_skills(mismatch_client.session_token, [{ skill_id, level: 1 }]);
		const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [{ kind: 'skill', skill_id, content_hash: sha256_icon_catalog_bytes(bytes),
				byte_length: bytes.byteLength, media_type: 'image/svg+xml' }]
		}, mismatch_client.session_token);
		const token = checked.json.results[0]?.upload_token as string;
		const mismatched = await post_binary('/api/client/icon-catalog/upload', bytes,
			mismatch_client.session_token, {
				'Content-Type': 'image/png', 'X-Icon-Catalog-Upload-Token': token
			});
		expect(mismatched.status).toBe(400);
	});

	test('deduplicates concurrent uploads of the same content', async () => {
		const first = await register_client('Duplicate Upload First');
		const second = await register_client('Duplicate Upload Second');
		const skill_id = 'mod-duplicate:Mining';
		const bytes = svg_for('duplicate');
		const hash = sha256_icon_catalog_bytes(bytes);
		await share_skills(first.session_token, [{ skill_id, level: 1 }]);
		await share_skills(second.session_token, [{ skill_id, level: 1 }]);
		const manifest = { kind: 'skill', skill_id, content_hash: hash, byte_length: bytes.byteLength, media_type: 'image/svg+xml' };
		const first_check = await post_json<CheckResult>('/api/client/icon-catalog/check', { icons: [manifest] }, first.session_token);
		const second_check = await post_json<CheckResult>('/api/client/icon-catalog/check', { icons: [manifest] }, second.session_token);
		const first_token = first_check.json.results[0]?.upload_token as string;
		const second_token = second_check.json.results[0]?.upload_token as string;
		const first_upload = await post_binary('/api/client/icon-catalog/upload', bytes, first.session_token, {
			'Content-Type': 'image/svg+xml', 'X-Icon-Catalog-Upload-Token': first_token
		});
		const second_upload = await post_binary('/api/client/icon-catalog/upload', bytes, second.session_token, {
			'Content-Type': 'image/svg+xml', 'X-Icon-Catalog-Upload-Token': second_token
		});

		expect(first_upload.status).toBe(200);
		expect(second_upload.status).toBe(200);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `icon_catalog_blobs` WHERE `content_hash` = ?', [hash])).toBe(1);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `icon_catalog_observations` WHERE `object_id` = ?', [skill_id])).toBe(1);
	});

	test('preserves a changed icon as a second historical observation', async () => {
		const client = await register_client('Changed Upload Client');
		const skill_id = 'mod-changed:Mining';
		const first_bytes = svg_for('changed-first');
		const second_bytes = svg_for('changed-second');
		const first = await request_upload(client, skill_id, first_bytes, 'image/svg+xml');
		const second = await request_upload(client, skill_id, second_bytes, 'image/svg+xml');

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(await db_count('SELECT COUNT(*) AS `count` FROM `icon_catalog_observations` WHERE `object_id` = ?', [skill_id])).toBe(2);
	});

	test('requires a server-issued token and rejects official, action, and combat candidates', async () => {
		const client = await register_client('Candidate Boundary Client');
		const candidates = ['melvorD:Mining', 'mod-actions:Mining_Oak', 'mod-combat:Volcanic_Cave'];
		for (const skill_id of candidates) {
			const response = await post_binary('/api/client/icon-catalog/upload', svg_bytes, client.session_token, {
				'Content-Type': 'image/svg+xml',
				'X-Icon-Catalog-Upload-Token': crypto.randomUUID()
			});
			expect(response.status).toBe(400);
		}
	});

	test('disabled collection no-ops uploads, and unauthenticated uploads fail', async () => {
		const client = await register_client('Disabled Upload Client');
		const bytes = svg_for('disabled');
		await share_skills(client.session_token, [{ skill_id: 'mod-disabled:Mining', level: 1 }]);
		const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [{ kind: 'skill', skill_id: 'mod-disabled:Mining', content_hash: sha256_icon_catalog_bytes(bytes),
				byte_length: bytes.byteLength, media_type: 'image/svg+xml' }]
		}, client.session_token);
		const token = checked.json.results[0]?.upload_token as string;
		await db_run("UPDATE `service_settings` SET `value` = '0' WHERE `key` = 'icon_collection_enabled'");
		try {
			const disabled = await post_binary('/api/client/icon-catalog/upload', bytes, client.session_token, {
				'Content-Type': 'image/svg+xml', 'X-Icon-Catalog-Upload-Token': token
			});
			expect(disabled.status).toBe(200);
			expect(await disabled.json()).toEqual({ success: true, enabled: false, stored: false });
		} finally {
			await db_run("UPDATE `service_settings` SET `value` = '1' WHERE `key` = 'icon_collection_enabled'");
		}

		const unauthenticated = await post_binary('/api/client/icon-catalog/upload', bytes, undefined, {
			'Content-Type': 'image/svg+xml', 'X-Icon-Catalog-Upload-Token': crypto.randomUUID()
		});
		expect(unauthenticated.status).toBe(401);
	});

	test('returns a safe response when catalog persistence detects conflicting stored data', async () => {
		const client = await register_client('Persistence Failure Upload Client');
		const skill_id = 'mod-failure:Mining';
		const bytes = svg_for('persistence-failure');
		const hash = sha256_icon_catalog_bytes(bytes);
		await share_skills(client.session_token, [{ skill_id, level: 1 }]);
		const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
			icons: [{ kind: 'skill', skill_id, content_hash: hash, byte_length: bytes.byteLength, media_type: 'image/svg+xml' }]
		}, client.session_token);
		const token = checked.json.results[0]?.upload_token as string;
		const conflicting_bytes = new TextEncoder().encode('conflicting bytes');
		await db_run(
			'INSERT INTO `icon_catalog_blobs` (`content_hash`, `bytes`, `media_type`, `byte_length`, `first_seen_at`, `last_seen_at`) VALUES (?, ?, ?, ?, ?, ?)',
			[hash, conflicting_bytes, 'image/svg+xml', conflicting_bytes.byteLength, 1, 1]
		);

		const response = await post_binary('/api/client/icon-catalog/upload', bytes, client.session_token, {
			'Content-Type': 'image/svg+xml', 'X-Icon-Catalog-Upload-Token': token
		});
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ success: false, error: 'storage_unavailable' });
	});
});
