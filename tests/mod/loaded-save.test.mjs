import assert from 'node:assert/strict';
import test from 'node:test';
import { create_loaded_save_tracker, install_loaded_save_capture } from '../../mod/loaded-save.mjs';

test('captures decoded save before saving and keeps it stable across reconnect reports', () => {
	let time = 200;
	let sequence = 0;
	const tracker = create_loaded_save_tracker({ uuid: () => `load-${++sequence}`, now: () => time });
	class Game { decode() { this.saveTimestamp = 100; } }
	let after;
	install_loaded_save_capture({ patch: (target, method) => {
		assert.equal(target, Game);
		assert.equal(method, 'decode');
		return { after: callback => { after = callback; } };
	} }, Game, tracker);
	const game = new Game();
	game.decode();
	after.call(game);
	game.saveTimestamp = 250;
	time = 300;
	tracker.character_loaded(game);
	const expected = { load_id: 'load-1', save_timestamp: 100, client_loaded_at: 200, capture_source: 'decode' };
	assert.deepEqual(tracker.report(), expected);
	tracker.report().save_timestamp = 999;
	game.saveTimestamp = 400;
	assert.deepEqual(tracker.report(), expected);
	tracker.clear();
	assert.equal(tracker.report(), null);
	game.saveTimestamp = 50;
	tracker.decoded(game);
	tracker.character_loaded(game);
	assert.equal(tracker.report().load_id, 'load-2');
	assert.equal(tracker.report().save_timestamp, 50);
});

test('marks fallback capture and leaves unavailable or invalid save times unknown', () => {
	for (const saveTimestamp of [0, undefined, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
		const tracker = create_loaded_save_tracker({ uuid: () => 'load', now: () => 200 });
		install_loaded_save_capture({}, null, tracker);
		tracker.character_loaded({ saveTimestamp });
		assert.equal(tracker.report().save_timestamp, null);
		assert.equal(tracker.report().capture_source, 'character_loaded');
	}
});
