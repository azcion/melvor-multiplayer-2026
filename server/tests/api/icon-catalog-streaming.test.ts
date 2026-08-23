import { expect, test } from 'bun:test';
import { MAX_ICON_CATALOG_ICON_BYTES, sha256_icon_catalog_bytes } from '../../icon-catalog';
import { post_binary, post_json, register_client } from '../support/http';
import { db_count } from '../support/persistence';

type CheckResult = {
	results: Array<{
		upload_token?: string;
		disposition: 'upload' | 'reuse';
	}>;
};

test('icon catalog upload API enforces the streaming byte limit', async () => {
	const client = await register_client('Oversized Upload Client');
	const skill_id = 'mod-large:Mining';
	const oversized = new Uint8Array(MAX_ICON_CATALOG_ICON_BYTES + 1);
	const content_hash = sha256_icon_catalog_bytes(oversized);
	await post_json('/api/client/status/sync', {
		skills: [{ skill_id, level: 1 }],
		activity: { type: 'idle' }
	}, client.session_token);
	const checked = await post_json<CheckResult>('/api/client/icon-catalog/check', {
		icons: [{
			kind: 'skill',
			skill_id,
			content_hash,
			byte_length: MAX_ICON_CATALOG_ICON_BYTES,
			media_type: 'image/png'
		}]
	}, client.session_token);
	const request = checked.json.results[0];
	if (checked.response.status !== 200 || request?.disposition !== 'upload' || request.upload_token === undefined)
		throw new Error(`Upload request was not issued: ${JSON.stringify(checked.json)}`);

	const response = await post_binary('/api/client/icon-catalog/upload', oversized, client.session_token, {
		'Content-Type': 'image/png',
		'X-Icon-Catalog-Upload-Token': request.upload_token
	});

	expect(response.status).toBe(413);
	expect(await db_count(
		'SELECT COUNT(*) AS `count` FROM `icon_catalog_observations` WHERE `object_id` = ?',
		[skill_id]
	)).toBe(0);
});
