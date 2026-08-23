import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	ICON_CATALOG_UPLOAD_CONCURRENCY,
	collect_skill_icon_candidates
} from '../../mod/icon-catalog-collection.mjs';
import { read_client_source } from './source.mjs';

const root = new URL('../../', import.meta.url);
const svg_bytes = new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>');

function candidate(skill_id, content_hash = 'a'.repeat(64), bytes = svg_bytes) {
	return {
		kind: 'skill',
		skill_id,
		content_hash,
		byte_length: bytes.byteLength,
		media_type: 'image/svg+xml',
		bytes
	};
}

async function collect(discovered, checked, options = {}) {
	const checked_manifests = [];
	const uploads = [];
	const result = await collect_skill_icon_candidates([{ skill_id: 'mod:Shared', level: 1 }], {
		discover_candidates: async () => discovered,
		check_manifest: async manifest => {
			checked_manifests.push(manifest);
			return checked;
		},
		upload_candidate: async (item, request) => {
			uploads.push({ item, request });
			return { success: true };
		},
		...options
	});
	return { result, checked_manifests, uploads };
}

test('checks the exact metadata manifest and uploads a requested candidate without re-reading bytes', async () => {
	const item = candidate('mod:Shared');
	const { result, checked_manifests, uploads } = await collect(item ? [item] : [], {
		success: true,
		enabled: true,
		results: [{ ...item, bytes: undefined, disposition: 'upload', upload_token: 'token-1' }]
	});

	assert.deepEqual(checked_manifests, [[{ ...item, bytes: undefined }].map(({ bytes, ...metadata }) => metadata)]);
	assert.equal(uploads.length, 1);
	assert.equal(uploads[0].item.bytes, svg_bytes);
	assert.equal(uploads[0].request.upload_token, 'token-1');
	assert.deepEqual(result, { status: 'complete', candidate_count: 1, upload_count: 1, failure_count: 0 });
});

test('disabled collection does not upload and does not require parsing upload results', async () => {
	const item = candidate('mod:Disabled');
	const { result, uploads } = await collect(item ? [item] : [], {
		success: true,
		enabled: false,
		results: [{ disposition: 'upload', upload_token: 'not-used' }]
	});

	assert.deepEqual(result, { status: 'disabled', candidate_count: 1, upload_count: 0, failure_count: 0 });
	assert.equal(uploads.length, 0);
});

test('manifest failures and malformed responses remain outside the normal status path', async () => {
	const item = candidate('mod:Failure');
	const failed = await collect([item], null);
	assert.equal(failed.result.status, 'failed');
	assert.equal(failed.uploads.length, 0);

	const malformed = await collect([item], { success: true, enabled: true, results: 'not-an-array' });
	assert.equal(malformed.result.status, 'failed');
	assert.equal(malformed.uploads.length, 0);
});

test('server-requested subsets upload only missing entries and reuse sends no bytes', async () => {
	const first = candidate('mod:First');
	const second = candidate('mod:Second', 'b'.repeat(64));
	const { uploads } = await collect([first, second], {
		success: true,
		enabled: true,
		results: [
			{ ...first, disposition: 'upload', upload_token: 'first-token' },
			{ ...second, disposition: 'reuse' }
		]
	});

	assert.deepEqual(uploads.map(upload => upload.item.skill_id), ['mod:First']);
	assert.deepEqual(uploads.map(upload => upload.request.upload_token), ['first-token']);
});

test('server rejection of an absent shared skill and malformed upload instructions do not upload', async () => {
	const item = candidate('mod:NotShared');
	const malformed = await collect([item], {
		success: true,
		enabled: true,
		results: [{ ...item, disposition: 'upload' }]
	});
	assert.equal(malformed.uploads.length, 0);

	const absent = await collect([item], { success: true, enabled: true, results: [] });
	assert.equal(absent.uploads.length, 0);
});

test('one upload failure does not stop other requested uploads and concurrency stays bounded', async () => {
	const items = Array.from({ length: 7 }, (_, index) => candidate(`mod:Skill_${index}`, `${index}`.repeat(64)));
	let active = 0;
	let maximum_active = 0;
	const uploads = [];
	const result = await collect_skill_icon_candidates([], {
		discover_candidates: async () => items,
		check_manifest: async manifest => ({
			success: true,
			enabled: true,
			results: manifest.map(item => ({ ...item, disposition: 'upload', upload_token: item.skill_id }))
		}),
		upload_candidate: async item => {
			active++;
			maximum_active = Math.max(maximum_active, active);
			uploads.push(item.skill_id);
			await new Promise(resolve => setTimeout(resolve, 1));
			active--;
			if (item.skill_id === 'mod:Skill_2')
				return { success: false };
			return { success: true };
		}
	});

	assert.equal(maximum_active, ICON_CATALOG_UPLOAD_CONCURRENCY);
	assert.equal(uploads.length, items.length);
	assert.equal(result.failure_count, 1);
	assert.equal(result.upload_count, items.length - 1);
});

test('discovery failure is isolated and later attempts can run again', async () => {
	let attempts = 0;
	const result = await collect_skill_icon_candidates([], {
		discover_candidates: async () => {
			attempts++;
			if (attempts === 1)
				throw new Error('unreadable icon');
			return [];
		},
		check_manifest: async () => ({ success: true, enabled: true, results: [] }),
		upload_candidate: async () => ({ success: true })
	});
	assert.equal(result.status, 'failed');

	const retry = await collect_skill_icon_candidates([], {
		discover_candidates: async () => [],
		check_manifest: async () => ({ success: true, enabled: true, results: [] }),
		upload_candidate: async () => ({ success: true })
	});
	assert.equal(retry.status, 'empty');
});

test('collection can be cancelled before check or between bounded uploads', async () => {
	const item = candidate('mod:Cancelled');
	let allowed = false;
	const before_check = await collect([item], {
		success: true,
		enabled: true,
		results: [{ ...item, disposition: 'upload', upload_token: 'never' }]
	}, { is_collection_allowed: () => allowed });
	assert.equal(before_check.result.status, 'cancelled');
	assert.equal(before_check.checked_manifests.length, 0);
});

test('main triggers the asynchronous flow only after a successful skills status write', async () => {
	const main = await read_client_source(root);
	const status = main.slice(main.indexOf('async function flush_status_sync'), main.indexOf('function observe_status_changes'));
	const observer = main.slice(main.indexOf('function observe_status_changes'), main.indexOf('function start_status_observer'));
	const binary_api = main.slice(main.indexOf('async function api_post_binary_response'), main.indexOf('async function api_post(endpoint'));
	const collection = await readFile(new URL('mod/icon-catalog-collection.mjs', root), 'utf8');

	assert.match(status, /if \(res\?\.success\)/);
	assert.match(status, /payload\.skills !== undefined[\s\S]*queue_status_icon_collection\(snapshot\.skills\)/);
	assert.doesNotMatch(observer, /queue_status_icon_collection|collect_status_icon_catalog/);
	assert.match(binary_api, /body: bytes/);
	assert.match(binary_api, /X-Icon-Catalog-Upload-Token/);
	assert.doesNotMatch(main, /last_status_icon_manifest|status_icon_manifest/);
	assert.match(collection, /ICON_CATALOG_UPLOAD_CONCURRENCY = 3/);
	assert.match(collection, /Promise\.all\(Array\.from\(\{ length: worker_count \}/);
});
