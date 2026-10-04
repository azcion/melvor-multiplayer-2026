import assert from 'node:assert/strict';
import test from 'node:test';
import { create_asset_url_resolver } from '../../mod/asset-urls.mjs';

test('returns hosted images directly and keeps unselected resources bundled', () => {
	const urls = { 'assets/raid-boss-t1.png': 'https://cdn.example.com/assets/0123456789abcdef/raid-boss-t1.png' };
	const calls = [];
	const resolve = create_asset_url_resolver(urls, asset => {
		calls.push(asset);
		return `blob:${asset}`;
	});
	assert.equal(resolve('assets/raid-boss-t1.png'), urls['assets/raid-boss-t1.png']);
	assert.equal(resolve('assets/crucible.png'), 'blob:assets/crucible.png');
	assert.deepEqual(calls, ['assets/crucible.png']);
});

test('bundled manifest resolves every image through the mod context', () => {
	const resolve = create_asset_url_resolver({}, asset => `blob:${asset}`);
	assert.equal(resolve('assets/raid-boss-t1.png'), 'blob:assets/raid-boss-t1.png');
	assert.equal(resolve('toString'), 'blob:toString');
});
