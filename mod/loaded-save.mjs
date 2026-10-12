// Keep the original loaded timestamp separate from game.saveTimestamp, which saving replaces.
export function create_loaded_save_tracker({ uuid, now }) {
	let decoded = null;
	let loaded = null;
	const capture = (game, capture_source) => Object.freeze({
		load_id: uuid(),
		save_timestamp: Number.isSafeInteger(game?.saveTimestamp) && game.saveTimestamp > 0
			? game.saveTimestamp : null,
		client_loaded_at: now(),
		capture_source
	});
	return {
		decoded(game) { decoded = capture(game, 'decode'); },
		character_loaded(game) {
			loaded = decoded ?? capture(game, 'character_loaded');
			decoded = null;
		},
		clear() { decoded = null; loaded = null; },
		report() { return loaded === null ? null : { ...loaded }; }
	};
}

export function install_loaded_save_capture(ctx, game_class, tracker) {
	if (typeof game_class?.prototype?.decode !== 'function') return;
	ctx.patch(game_class, 'decode').after(function() { tracker.decoded(this); });
}
