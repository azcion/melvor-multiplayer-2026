import assert from 'node:assert/strict';
import test from 'node:test';
import { load_updates, normalize_updates } from '../../mod/updates.mjs';

test('normalizes server update sections and drops malformed entries', () => {
	assert.deepEqual(normalize_updates({ sections: [
		{ id: ' dev-message ', title: ' Message from the devs ', paragraphs: [' Notice ', '', 42] },
		{ id: 'missing-body', title: 'Missing body', paragraphs: [] },
		{ id: 'missing-title', title: '', paragraphs: ['ignored'] }
	] }), [{
		id: 'dev-message',
		title: 'Message from the devs',
		paragraphs: ['Notice']
	}]);
});

test('fetches updates from the configured multiplayer server', async () => {
	let requested_url = '';
	const sections = [{ id: 'working-on', title: "What we're working on", paragraphs: ['A server notice.'] }];
	const result = await load_updates(async url => {
		requested_url = url;
		return { ok: true, json: async () => ({ sections }) };
	}, 'https://multiplayer.example/');

	assert.equal(requested_url, 'https://multiplayer.example/api/updates');
	assert.deepEqual(result, sections);
});
