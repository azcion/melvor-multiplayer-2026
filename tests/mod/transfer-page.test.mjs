import assert from 'node:assert/strict';
import test from 'node:test';

import { open_transfer_page } from '../../mod/transfer-page.mjs';

test('prepares the transfer page before navigating to it', async () => {
	const events = [];
	let release_events;
	let release_guild;
	const events_ready = new Promise(resolve => release_events = resolve);
	const guild_ready = new Promise(resolve => release_guild = resolve);

	const opening = open_transfer_page({
		refresh_events: async () => {
			events.push('refresh events');
			await events_ready;
			events.push('events ready');
		},
		refresh_guild: async () => {
			events.push('refresh guild');
			await guild_ready;
			events.push('guild ready');
		},
		update_contents: async () => events.push('update contents'),
		navigate: () => events.push('navigate')
	});

	await Promise.resolve();
	assert.deepEqual(events, ['refresh events', 'refresh guild']);

	release_events();
	await Promise.resolve();
	assert.deepEqual(events, ['refresh events', 'refresh guild', 'events ready']);

	release_guild();
	await opening;
	assert.deepEqual(events, [
		'refresh events',
		'refresh guild',
		'events ready',
		'guild ready',
		'update contents',
		'navigate'
	]);
});

test('still navigates when transfer-page preparation fails', async () => {
	let navigated = false;

	await assert.rejects(
		open_transfer_page({
			refresh_events: async () => {
				throw new Error('offline');
			},
			refresh_guild: async () => {},
			update_contents: async () => assert.fail('contents should not update'),
			navigate: () => navigated = true
		}),
		/offline/
	);

	assert.equal(navigated, true);
});
