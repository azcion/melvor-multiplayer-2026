// Native offline statistics are incomplete until offlineLoopExited. Also detect an overdue
// online tick: load/visibility callbacks can run before Melvor enters its offline loop.
export function create_offline_work_gate({
	reconcile, on_resumed, is_loading = () => false, now = () => Date.now(), on_error = () => {}
}) {
	let game = null;
	let revision = 0;
	let dirty = true;
	let running = null;
	let retry_at = 0;
	let notices = [];
	const entered = () => { revision++; dirty = true; retry_at = 0; };
	const exited = () => { entered(); void pump(); };
	function blocked() {
		if (!game) return true;
		const overdue = !game.isGolbinRaid && (game._forceOfflineLoop === true ||
			(Number.isFinite(game.tickTimestamp) && Number.isFinite(game.MIN_OFFLINE_TIME) &&
				now() - game.tickTimestamp >= game.MIN_OFFLINE_TIME));
		const blocked = game._isInOnlineLoop === false || is_loading() || overdue;
		if (blocked) dirty = true;
		return blocked;
	}
	async function pump() {
		if (blocked() || !dirty || running || now() < retry_at) return;
		const attempt = {};
		const generation = revision;
		running = attempt;
		try {
			const complete = await reconcile();
			if (generation !== revision || blocked()) return;
			if (complete) {
				dirty = false;
				running = null;
				const queued = notices;
				notices = [];
				for (const notice of queued) notice();
				on_resumed();
			} else retry_at = now() + 5000;
		} catch (error) {
			if (generation === revision) retry_at = now() + 5000;
			on_error(error);
		} finally {
			if (running === attempt) running = null;
		}
	}
	function stop() {
		game?.off('offlineLoopEntered', entered);
		game?.off('offlineLoopExited', exited);
		game = null;
		revision++;
		dirty = true;
		running = null;
		retry_at = 0;
		notices = [];
	}
	return {
		start(next_game) {
			stop();
			game = next_game;
			game.on('offlineLoopEntered', entered);
			game.on('offlineLoopExited', exited);
		},
		defer_notice(callback) {
			if (!blocked()) return false;
			notices.push(callback);
			return true;
		},
		stop, blocked, pending: () => blocked() || dirty || running !== null, pump,
		request() { entered(); void pump(); }
	};
}
